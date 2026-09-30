import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import { issueEmployeeAccessTokenInTransaction, recordAuthEvent, type AuthRequestContext } from '@/server/auth/service';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { publishSessionsClosed } from '@/server/realtime/publish';
import {
  isTeamRole,
  primaryTeamRole,
  TEAM_MEMBER_LOCK_MESSAGES,
  TEAM_ROLE_LABELS,
  TEAM_ROLES,
  TEAM_VIEWS,
  teamMemberLock,
  teamMemberState,
  teamViewIncludes,
  type TeamMemberLock,
  type TeamMemberState,
  type TeamRoleKey,
  type TeamView,
} from '@/server/modules/team/domain';

export type TeamServiceDependencies = Readonly<{
  prisma?: PrismaClient;
  now?: Date;
  tokenGenerator?: () => string;
}>;

type Tx = Prisma.TransactionClient;

/** Expedientes que todavía esperan a su responsable (los cerrados o convertidos ya no). */
const OPEN_REQUEST_STATUSES = ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'ACEPTADA'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type TeamMemberSummary = Readonly<{
  id: string;
  displayName: string;
  email: string;
  status: string;
  state: TeamMemberState;
  roleKey: TeamRoleKey | null;
  roleLabel: string | null;
  mfaEnabled: boolean;
  lastSignInAt: Date | null;
  activeSessions: number;
  openRequests: number;
  projectsInTransition: number;
  invitation: { sentAt: Date; expiresAt: Date } | null;
  createdAt: Date;
  lock: TeamMemberLock | null;
}>;

function requireTeamManager(actor: Actor): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'identity.users.manage');
}

function requireUuid(value: string, message: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', message, 400);
  return value;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length < 2 || normalized.length > 180) throw new AppError('VALIDATION_ERROR', 'Escribe el nombre completo (2 a 180 caracteres).', 400);
  return normalized;
}

function normalizeEmail(value: string): { email: string; emailNormalized: string } {
  const email = value.trim();
  const emailNormalized = email.toLowerCase();
  if (emailNormalized.length > 320 || !EMAIL_PATTERN.test(emailNormalized)) throw new AppError('VALIDATION_ERROR', 'El correo no es válido.', 400);
  return { email, emailNormalized };
}

function normalizeReason(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, ' ') ?? '';
  if (!normalized) return null;
  if (normalized.length > 300) throw new AppError('VALIDATION_ERROR', 'El motivo no puede exceder 300 caracteres.', 400);
  return normalized;
}

async function actorDisplayName(client: PrismaClient | Tx, actor: Actor): Promise<string> {
  const user = await client.user.findUnique({ where: { id: actor.userId }, select: { displayName: true } });
  return user?.displayName ?? 'El equipo de OCPOOL';
}

async function audit(transaction: Tx, actor: Actor, action: string, entityId: string, metadata: Record<string, string | number>): Promise<void> {
  await transaction.auditLog.create({ data: { actorUserId: actor.userId, action, entityType: 'user', entityId, outcome: 'SUCCESS', metadata } });
}

type LoadedMember = { id: string; displayName: string; email: string; status: string; passwordHash: string | null; roleKeys: string[] };

/** Carga a la persona y aplica los candados de Equipo (propia cuenta, administradores, clientes). */
async function loadManageableMember(transaction: Tx, actor: Actor, userIdInput: string): Promise<LoadedMember> {
  const userId = requireUuid(userIdInput, 'La persona no es válida.');
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { id: true, type: true, displayName: true, email: true, status: true, passwordHash: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!user || user.type !== 'EMPLOYEE') throw new AppError('NOT_FOUND', 'La persona no forma parte del equipo.', 404);
  const roleKeys = user.roles.map(({ role }) => role.key);
  const lock = teamMemberLock({ actorUserId: actor.userId, memberId: user.id, roleKeys });
  if (lock) throw new AppError('FORBIDDEN', TEAM_MEMBER_LOCK_MESSAGES[lock], 403);
  return { id: user.id, displayName: user.displayName, email: user.email, status: user.status, passwordHash: user.passwordHash, roleKeys };
}

async function roleIdFor(transaction: Tx, role: string): Promise<string> {
  const record = await transaction.role.findUnique({ where: { key: role }, select: { id: true } });
  if (!record) throw new AppError('CONFLICT', 'El rol no está disponible. Ejecuta la sincronización de permisos (db:seed).', 409);
  return record.id;
}

export async function listTeamMembers(actor: Actor, filters: { view?: string; query?: string } = {}, dependencies: TeamServiceDependencies = {}): Promise<{ items: TeamMemberSummary[]; counts: Record<TeamView, number> }> {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const view: TeamView = (TEAM_VIEWS as readonly string[]).includes(filters.view ?? '') ? filters.view as TeamView : 'active';
  const query = filters.query?.trim().toLowerCase() ?? '';

  const users = await prisma.user.findMany({
    where: { type: 'EMPLOYEE' },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    take: 500,
    select: { id: true, displayName: true, email: true, status: true, mfaEnrolledAt: true, createdAt: true, roles: { select: { role: { select: { key: true } } } } },
  });
  const ids = users.map(({ id }) => id);
  const [signIns, sessions, requests, projects, invitations] = ids.length === 0 ? [[], [], [], [], []] : await Promise.all([
    prisma.authEvent.groupBy({ by: ['userId'], where: { userId: { in: ids }, eventType: 'LOGIN_SUCCESS' }, _max: { createdAt: true } }),
    prisma.session.groupBy({ by: ['userId'], where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: now } }, _count: { _all: true } }),
    prisma.quoteRequest.groupBy({ by: ['currentAssigneeId'], where: { currentAssigneeId: { in: ids }, status: { in: [...OPEN_REQUEST_STATUSES] } }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ['ownerId'], where: { ownerId: { in: ids }, status: 'EN_TRANSICION' }, _count: { _all: true } }),
    prisma.authToken.findMany({
      where: { userId: { in: users.filter(({ status }) => status === 'INVITED').map(({ id }) => id) }, type: 'PASSWORD_RESET', consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, createdAt: true, expiresAt: true },
    }),
  ]);
  const lastSignIn = new Map(signIns.map((entry) => [entry.userId, entry._max.createdAt ?? null]));
  const sessionCount = new Map(sessions.map((entry) => [entry.userId, entry._count._all]));
  const requestCount = new Map(requests.map((entry) => [entry.currentAssigneeId, entry._count._all]));
  const projectCount = new Map(projects.map((entry) => [entry.ownerId, entry._count._all]));
  const latestInvitation = new Map<string, { sentAt: Date; expiresAt: Date }>();
  for (const token of invitations) if (!latestInvitation.has(token.userId)) latestInvitation.set(token.userId, { sentAt: token.createdAt, expiresAt: token.expiresAt });

  const all: TeamMemberSummary[] = users.map((user) => {
    const roleKeys = user.roles.map(({ role }) => role.key);
    const roleKey = primaryTeamRole(roleKeys);
    const invitation = user.status === 'INVITED' ? latestInvitation.get(user.id) ?? null : null;
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      status: user.status,
      state: teamMemberState({ status: user.status, invitationExpiresAt: invitation?.expiresAt ?? null }, now),
      roleKey,
      roleLabel: roleKey ? TEAM_ROLE_LABELS[roleKey] : null,
      mfaEnabled: user.mfaEnrolledAt !== null,
      lastSignInAt: lastSignIn.get(user.id) ?? null,
      activeSessions: sessionCount.get(user.id) ?? 0,
      openRequests: requestCount.get(user.id) ?? 0,
      projectsInTransition: projectCount.get(user.id) ?? 0,
      invitation,
      createdAt: user.createdAt,
      lock: teamMemberLock({ actorUserId: actor.userId, memberId: user.id, roleKeys }),
    };
  });
  const counts = Object.fromEntries(TEAM_VIEWS.map((candidate) => [candidate, all.filter((member) => teamViewIncludes(candidate, member.state)).length])) as Record<TeamView, number>;
  const items = all.filter((member) => teamViewIncludes(view, member.state) && (!query || member.displayName.toLowerCase().includes(query) || member.email.toLowerCase().includes(query)));
  return { items, counts };
}

/**
 * Invita a alguien al equipo: la cuenta nace "invitada" (sin contraseña) y recibe por correo un
 * enlace de 72 h para crearla; al hacerlo queda activa. El enlace nunca se muestra en pantalla.
 */
export async function inviteTeamMember(actor: Actor, input: { displayName: string; email: string; role: string }, context: AuthRequestContext, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const displayName = normalizeDisplayName(input.displayName);
  const { email, emailNormalized } = normalizeEmail(input.email);
  if (!isTeamRole(input.role)) throw new AppError('VALIDATION_ERROR', 'Elige el rol: Ventas o Gerencia.', 400);
  const role = input.role;
  const inviterName = await actorDisplayName(prisma, actor);

  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.user.findUnique({ where: { emailNormalized }, select: { type: true, status: true } });
      if (existing?.type === 'CUSTOMER') throw new AppError('CONFLICT', 'Ese correo pertenece a un cliente del portal. Usa otro correo para la cuenta interna.', 409);
      if (existing) {
        const message = existing.status === 'INVITED'
          ? 'Esa persona ya tiene una invitación pendiente: usa «Reenviar invitación».'
          : existing.status === 'ACTIVE' ? 'Esa persona ya forma parte del equipo.' : 'Esa persona está suspendida: reactívala desde Equipo.';
        throw new AppError('CONFLICT', message, 409);
      }
      const roleId = await roleIdFor(transaction, role);
      const user = await transaction.user.create({
        data: { email, emailNormalized, displayName, type: 'EMPLOYEE', status: 'INVITED', roles: { create: { roleId } } },
        select: { id: true, displayName: true, email: true },
      });
      const delivery = await issueEmployeeAccessTokenInTransaction(transaction, {
        userId: user.id,
        purpose: 'invitation',
        context,
        now,
        extraPayload: { invitedByName: inviterName, roleLabel: TEAM_ROLE_LABELS[role] },
        ...(dependencies.tokenGenerator ? { tokenGenerator: dependencies.tokenGenerator } : {}),
      });
      await audit(transaction, actor, 'team.member_invited', user.id, { member: user.displayName, email: user.email, role: TEAM_ROLE_LABELS[role] });
      return { id: user.id, displayName: user.displayName, email: user.email, state: 'invited' as const, invitationExpiresAt: delivery.expiresAt };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('CONFLICT', 'Esa persona ya forma parte del equipo.', 409);
    throw error;
  }
}

/** Nuevo enlace de bienvenida (el anterior deja de funcionar). */
export async function resendTeamInvitation(actor: Actor, userId: string, context: AuthRequestContext, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const inviterName = await actorDisplayName(prisma, actor);
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    if (member.status !== 'INVITED') throw new AppError('CONFLICT', 'Sólo se reenvía la invitación de alguien que aún no crea su contraseña.', 409);
    const roleKey = primaryTeamRole(member.roleKeys);
    const delivery = await issueEmployeeAccessTokenInTransaction(transaction, {
      userId: member.id,
      purpose: 'invitation',
      context,
      now,
      extraPayload: { invitedByName: inviterName, ...(roleKey ? { roleLabel: TEAM_ROLE_LABELS[roleKey] } : {}) },
      ...(dependencies.tokenGenerator ? { tokenGenerator: dependencies.tokenGenerator } : {}),
    });
    await audit(transaction, actor, 'team.invitation_resent', member.id, { member: member.displayName, email: member.email });
    return { id: member.id, invitationExpiresAt: delivery.expiresAt };
  });
}

/** Cancela una invitación: el enlace deja de funcionar y la cuenta queda deshabilitada (se puede volver a invitar). */
export async function cancelTeamInvitation(actor: Actor, userId: string, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    if (member.status !== 'INVITED') throw new AppError('CONFLICT', 'Sólo se cancela una invitación pendiente.', 409);
    await transaction.user.update({ where: { id: member.id }, data: { status: 'DISABLED' } });
    await transaction.authToken.updateMany({ where: { userId: member.id, consumedAt: null }, data: { consumedAt: now } });
    await audit(transaction, actor, 'team.invitation_canceled', member.id, { member: member.displayName, email: member.email });
    return { id: member.id, status: 'DISABLED' as const };
  });
}

/** Cambia entre Ventas y Gerencia. Los permisos se leen en cada petición: aplica de inmediato. */
export async function changeTeamMemberRole(actor: Actor, userId: string, input: { role: string }, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  if (!isTeamRole(input.role)) throw new AppError('VALIDATION_ERROR', 'Elige el rol: Ventas o Gerencia.', 400);
  const role = input.role;
  const prisma = dependencies.prisma ?? getPrisma();
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    if (member.status === 'DISABLED') throw new AppError('CONFLICT', 'Vuelve a invitar a esta persona antes de cambiar su rol.', 409);
    const current = primaryTeamRole(member.roleKeys);
    if (current === role && member.roleKeys.length === 1) return { id: member.id, roleKey: role, changed: false };
    const roleId = await roleIdFor(transaction, role);
    await transaction.userRole.deleteMany({ where: { userId: member.id, role: { key: { in: [...TEAM_ROLES] } } } });
    await transaction.userRole.create({ data: { userId: member.id, roleId } });
    await audit(transaction, actor, 'team.role_changed', member.id, { member: member.displayName, fromRole: current ? TEAM_ROLE_LABELS[current] : 'Sin rol', toRole: TEAM_ROLE_LABELS[role] });
    return { id: member.id, roleKey: role, changed: true };
  });
}

/**
 * Suspende el acceso: no puede entrar, sus sesiones se cierran y sus enlaces pendientes dejan de
 * funcionar. Su trabajo abierto no se queda detenido: expedientes y proyectos en arranque pasan a otra
 * persona activa (o quedan sin responsable), con historial y auditoría por cada uno.
 */
export async function suspendTeamMember(actor: Actor, userId: string, input: { reassignToId?: string | null; reason?: string }, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const reason = normalizeReason(input.reason);
  const reassignToId = input.reassignToId ? requireUuid(input.reassignToId, 'La persona que recibe el trabajo no es válida.') : null;

  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    if (member.status !== 'ACTIVE') throw new AppError('CONFLICT', member.status === 'INVITED' ? 'Esa persona aún no activa su cuenta: cancela la invitación.' : 'Esa cuenta ya está suspendida.', 409);
    let heir: { id: string; displayName: string } | null = null;
    if (reassignToId) {
      if (reassignToId === member.id) throw new AppError('VALIDATION_ERROR', 'Elige a otra persona para recibir el trabajo.', 400);
      const candidate = await transaction.user.findUnique({ where: { id: reassignToId }, select: { id: true, type: true, status: true, displayName: true } });
      if (!candidate || candidate.type !== 'EMPLOYEE' || candidate.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'La persona que recibe el trabajo no está activa.', 400);
      heir = { id: candidate.id, displayName: candidate.displayName };
    }

    await transaction.user.update({ where: { id: member.id }, data: { status: 'SUSPENDED' } });
    const revoked = await transaction.session.updateMany({ where: { userId: member.id, revokedAt: null }, data: { revokedAt: now } });
    await publishSessionsClosed(transaction, { userId: member.id });
    await transaction.authToken.updateMany({ where: { userId: member.id, consumedAt: null }, data: { consumedAt: now } });

    const requests = await transaction.quoteRequest.findMany({ where: { currentAssigneeId: member.id, status: { in: [...OPEN_REQUEST_STATUSES] } }, select: { id: true, folio: true } });
    const assignmentReason = `Reasignado al suspender el acceso de ${member.displayName}.`.slice(0, 500);
    for (const request of requests) {
      await transaction.requestAssignment.updateMany({ where: { quoteRequestId: request.id, unassignedAt: null }, data: { unassignedAt: now } });
      if (heir) {
        await transaction.requestAssignment.create({ data: { quoteRequestId: request.id, assignedToId: heir.id, assignedById: actor.userId, reason: assignmentReason, assignedAt: now } });
        await transaction.quoteRequest.update({ where: { id: request.id }, data: { currentAssigneeId: heir.id } });
        await transaction.auditLog.create({ data: { actorUserId: actor.userId, action: 'quote_request.assigned', entityType: 'quote_request', entityId: request.id, outcome: 'SUCCESS', metadata: { folio: request.folio, assignedToId: heir.id, source: 'team.suspension' } } });
      } else {
        await transaction.quoteRequest.update({ where: { id: request.id }, data: { currentAssigneeId: null } });
        await transaction.auditLog.create({ data: { actorUserId: actor.userId, action: 'quote_request.unassigned', entityType: 'quote_request', entityId: request.id, outcome: 'SUCCESS', metadata: { folio: request.folio, source: 'team.suspension' } } });
      }
    }
    const projects = await transaction.project.findMany({ where: { ownerId: member.id, status: 'EN_TRANSICION' }, select: { id: true, folio: true } });
    for (const project of projects) {
      await transaction.project.update({ where: { id: project.id }, data: { ownerId: heir?.id ?? null } });
      await transaction.auditLog.create({ data: { actorUserId: actor.userId, action: 'project.owner_changed', entityType: 'project', entityId: project.id, outcome: 'SUCCESS', metadata: { folio: project.folio, ownerId: heir?.id ?? null, source: 'team.suspension' } } });
    }

    if (heir && requests.length + projects.length > 0) {
      await notifyInbox(transaction, { actor: { userId: actor.userId, type: 'EMPLOYEE' }, eventType: 'TEAM.WORK_REASSIGNED', aggregateType: 'USER', aggregateId: member.id, payload: { heirId: heir.id, fromName: member.displayName, requestsCount: requests.length, projectsCount: projects.length } }, { now });
    }
    await audit(transaction, actor, 'team.member_suspended', member.id, {
      member: member.displayName,
      ...(reason ? { reason } : {}),
      reassignedTo: heir?.displayName ?? 'Sin responsable',
      requestsReassigned: requests.length,
      projectsReassigned: projects.length,
    });
    return { id: member.id, status: 'SUSPENDED' as const, sessionsRevoked: revoked.count, requestsReassigned: requests.length, projectsReassigned: projects.length, reassignedTo: heir };
  });
}

/** Reactiva: vuelve a entrar con su contraseña; si nunca la creó, se le reenvía la invitación. */
export async function reactivateTeamMember(actor: Actor, userId: string, context: AuthRequestContext, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const inviterName = await actorDisplayName(prisma, actor);
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    if (member.status !== 'SUSPENDED' && member.status !== 'DISABLED') throw new AppError('CONFLICT', 'Esa cuenta no está suspendida.', 409);
    const toStatus = member.passwordHash ? 'ACTIVE' as const : 'INVITED' as const;
    await transaction.user.update({ where: { id: member.id }, data: { status: toStatus } });
    let invitationExpiresAt: Date | null = null;
    if (toStatus === 'INVITED') {
      const roleKey = primaryTeamRole(member.roleKeys);
      const delivery = await issueEmployeeAccessTokenInTransaction(transaction, {
        userId: member.id,
        purpose: 'invitation',
        context,
        now,
        extraPayload: { invitedByName: inviterName, ...(roleKey ? { roleLabel: TEAM_ROLE_LABELS[roleKey] } : {}) },
        ...(dependencies.tokenGenerator ? { tokenGenerator: dependencies.tokenGenerator } : {}),
      });
      invitationExpiresAt = delivery.expiresAt;
    }
    await audit(transaction, actor, 'team.member_reactivated', member.id, { member: member.displayName, toStatus: toStatus === 'ACTIVE' ? 'Activa' : 'Invitación reenviada' });
    return { id: member.id, status: toStatus, invitationExpiresAt };
  });
}

/** Enlace para crear una nueva contraseña (la persona lo recibe por correo; el anterior deja de funcionar). */
export async function sendTeamMemberPasswordReset(actor: Actor, userId: string, context: AuthRequestContext, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    if (member.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Sólo se envía a una cuenta activa; para una invitación, reenvíala.', 409);
    const delivery = await issueEmployeeAccessTokenInTransaction(transaction, {
      userId: member.id,
      purpose: 'reset',
      context,
      now,
      ...(dependencies.tokenGenerator ? { tokenGenerator: dependencies.tokenGenerator } : {}),
    });
    await audit(transaction, actor, 'team.access_reset_sent', member.id, { member: member.displayName });
    return { id: member.id, expiresAt: delivery.expiresAt };
  });
}

/**
 * Quita la verificación en dos pasos de alguien que perdió su teléfono: vuelve a entrar sólo con su
 * contraseña y puede activarla de nuevo en Mi cuenta. Nunca a administradores ni a la propia cuenta.
 */
export async function resetTeamMemberMfa(actor: Actor, userId: string, context: AuthRequestContext, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    const user = await transaction.user.findUniqueOrThrow({ where: { id: member.id }, select: { mfaSecretCiphertext: true } });
    if (!user.mfaSecretCiphertext) throw new AppError('CONFLICT', 'Esa persona no tiene activa la verificación en dos pasos.', 409);
    await transaction.user.update({ where: { id: member.id }, data: { mfaSecretCiphertext: null, mfaEnrolledAt: null, mfaRequired: false, mfaLastAcceptedCounter: null } });
    await recordAuthEvent(transaction, { eventType: 'MFA_DISABLED', outcome: 'SUCCESS', userId: member.id, context, metadata: { origin: 'team' } });
    await audit(transaction, actor, 'team.mfa_reset', member.id, { member: member.displayName });
    return { id: member.id, mfaEnabled: false };
  });
}

/** Cierra todas sus sesiones abiertas (equipo perdido o robado); puede volver a entrar con su contraseña. */
export async function revokeTeamMemberSessions(actor: Actor, userId: string, dependencies: TeamServiceDependencies = {}) {
  requireTeamManager(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const member = await loadManageableMember(transaction, actor, userId);
    const revoked = await transaction.session.updateMany({ where: { userId: member.id, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: member.id });
    await audit(transaction, actor, 'team.sessions_revoked', member.id, { member: member.displayName, sessions: revoked.count });
    return { id: member.id, sessionsRevoked: revoked.count };
  });
}
