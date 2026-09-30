import type { PrismaClient } from '@/generated/prisma/client';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '@/server/auth/crypto';
import { createMfaEnrollment, protectMfaSecret, unprotectMfaSecret, verifyTotpCode } from '@/server/auth/mfa';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import { recordAuthEvent, type AuthRequestContext } from '@/server/auth/service';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { AppError } from '@/server/http/errors';
import { publishSessionsClosed } from '@/server/realtime/publish';
import { primaryTeamRole, TEAM_ROLE_LABELS, type TeamRoleKey } from '@/server/modules/team/domain';

export type AccountServiceDependencies = Readonly<{
  prisma?: PrismaClient;
  now?: Date;
}>;

/** La clave mostrada para inscribirse sirve sólo este tiempo; después hay que empezar de nuevo. */
const ENROLLMENT_TTL_MS = 15 * 60_000;
/** Lo que una persona reconoce como "actividad de mi cuenta": accesos, fallos y cambios de seguridad. */
const ACTIVITY_EVENT_TYPES = ['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'MFA_FAILURE', 'PASSWORD_CHANGED', 'PASSWORD_RESET_CONSUMED', 'MFA_ENROLLED', 'MFA_DISABLED', 'SESSION_REVOKED'] as const;

type EnrollmentSeal = { v: 1; userId: string; secret: string; issuedAt: number };

export type AccountOverview = {
  profile: { displayName: string; email: string; roleKey: TeamRoleKey | null; roleLabel: string | null; createdAt: Date };
  security: { mfaEnabled: boolean; mfaEnrolledAt: Date | null; mfaMandatory: boolean };
  sessions: Array<{ id: string; current: boolean; userAgent: string | null; ipAddress: string | null; createdAt: Date; lastSeenAt: Date }>;
  /** `origin` distingue quién hizo el cambio: tú desde Mi cuenta ('account', 'account_others') o gerencia ('team'). */
  activity: Array<{ id: string; eventType: string; outcome: string; origin: string | null; createdAt: Date; ipAddress: string | null; userAgent: string | null }>;
};

function requireEmployee(actor: Actor): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
}

async function allowAttempt(scope: string, userId: string, now: Date): Promise<void> {
  const env = readServerEnv();
  const decision = await checkAuthRateLimit({ scope, key: userId, maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS, windowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES, now });
  if (!decision.allowed) throw new AppError('RATE_LIMITED', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.', 429);
}

function eventOrigin(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const origin = (metadata as Record<string, unknown>).origin;
  return typeof origin === 'string' ? origin : null;
}

async function loadAccountUser(prisma: PrismaClient, actor: Actor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, type: true, displayName: true, email: true, createdAt: true, passwordHash: true, mfaSecretCiphertext: true, mfaEnrolledAt: true, mfaLastAcceptedCounter: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!user || user.type !== 'EMPLOYEE') throw new AppError('NOT_FOUND', 'La cuenta no existe.', 404);
  return { ...user, roleKeys: user.roles.map(({ role }) => role.key) };
}

export async function getAccountOverview(actor: Actor, currentSessionId: string, dependencies: AccountServiceDependencies = {}): Promise<AccountOverview> {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const user = await loadAccountUser(prisma, actor);
  const [sessions, activity] = await Promise.all([
    prisma.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: 'desc' }, take: 20, select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastSeenAt: true } }),
    prisma.authEvent.findMany({ where: { userId: user.id, eventType: { in: [...ACTIVITY_EVENT_TYPES] } }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, eventType: true, outcome: true, metadata: true, createdAt: true, ipAddress: true, userAgent: true } }),
  ]);
  const roleKey = primaryTeamRole(user.roleKeys);
  return {
    profile: { displayName: user.displayName, email: user.email, roleKey, roleLabel: roleKey ? TEAM_ROLE_LABELS[roleKey] : null, createdAt: user.createdAt },
    security: { mfaEnabled: Boolean(user.mfaSecretCiphertext && user.mfaEnrolledAt), mfaEnrolledAt: user.mfaEnrolledAt, mfaMandatory: user.roleKeys.includes('admin') },
    sessions: sessions.map((session) => ({ ...session, current: session.id === currentSessionId })),
    activity: activity.map(({ metadata, ...event }) => ({ ...event, origin: eventOrigin(metadata) })),
  };
}

/** El nombre con el que te ven tus compañeros y los clientes en la conversación. */
export async function updateAccountProfile(actor: Actor, input: { displayName: string }, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const displayName = input.displayName.trim().replace(/\s+/gu, ' ');
  if (displayName.length < 2 || displayName.length > 180) throw new AppError('VALIDATION_ERROR', 'Escribe tu nombre completo (2 a 180 caracteres).', 400);
  await prisma.user.update({ where: { id: actor.userId }, data: { displayName } });
  return { displayName };
}

/** Cambiar la propia contraseña con la actual. Cierra las demás sesiones y anula enlaces de recuperación pendientes. */
export async function changeAccountPassword(actor: Actor, currentSessionId: string, input: { currentPassword: string; newPassword: string }, context: AuthRequestContext, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  await allowAttempt('account-password', actor.userId, now);
  const user = await loadAccountUser(prisma, actor);
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) throw new AppError('VALIDATION_ERROR', 'La contraseña actual no es correcta.', 400);
  if (input.currentPassword === input.newPassword) throw new AppError('VALIDATION_ERROR', 'La nueva contraseña debe ser distinta de la actual.', 400);
  const passwordHash = await hashPassword(input.newPassword);
  return prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: user.id }, data: { passwordHash } });
    const revoked = await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: now } });
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: user.id, keepSessionId: currentSessionId });
    await transaction.authToken.updateMany({ where: { userId: user.id, type: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now } });
    await recordAuthEvent(transaction, { eventType: 'PASSWORD_CHANGED', outcome: 'SUCCESS', userId: user.id, context, metadata: { otherSessionsRevoked: revoked.count } });
    return { otherSessionsRevoked: revoked.count };
  });
}

/**
 * Primer paso para activar la verificación en dos pasos: una clave nueva (QR y texto) y un comprobante
 * sellado que la liga a esta persona por 15 minutos. Nada se guarda hasta confirmar el primer código.
 */
export async function startAccountMfaEnrollment(actor: Actor, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const user = await loadAccountUser(prisma, actor);
  if (user.mfaSecretCiphertext && user.mfaEnrolledAt) throw new AppError('CONFLICT', 'La verificación en dos pasos ya está activa.', 409);
  const enrollment = createMfaEnrollment({ accountLabel: user.email });
  const seal: EnrollmentSeal = { v: 1, userId: user.id, secret: enrollment.secret, issuedAt: now.getTime() };
  return {
    secret: enrollment.secret,
    uri: enrollment.uri,
    enrollmentToken: encryptSecret(JSON.stringify(seal), readServerEnv().MFA_ENCRYPTION_KEY),
    expiresAt: new Date(now.getTime() + ENROLLMENT_TTL_MS),
  };
}

function openEnrollmentSeal(token: string, userId: string, now: Date): EnrollmentSeal {
  let seal: EnrollmentSeal;
  try {
    seal = JSON.parse(decryptSecret(token, readServerEnv().MFA_ENCRYPTION_KEY)) as EnrollmentSeal;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'La activación ya no es válida. Vuelve a empezar.', 400);
  }
  const age = now.getTime() - seal.issuedAt;
  if (seal.v !== 1 || seal.userId !== userId || typeof seal.secret !== 'string' || !Number.isFinite(age) || age < -60_000 || age > ENROLLMENT_TTL_MS) {
    throw new AppError('VALIDATION_ERROR', 'La activación ya no es válida. Vuelve a empezar.', 400);
  }
  return seal;
}

/**
 * Confirma el primer código y activa la verificación: desde ahora el acceso pide el código. La sesión
 * actual queda verificada (ya probó tener el teléfono) y las demás se cierran porque se abrieron sin él.
 */
export async function confirmAccountMfaEnrollment(actor: Actor, currentSessionId: string, input: { enrollmentToken: string; code: string }, context: AuthRequestContext, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  await allowAttempt('account-mfa-confirm', actor.userId, now);
  const seal = openEnrollmentSeal(input.enrollmentToken, actor.userId, now);
  const counter = verifyTotpCode(seal.secret, input.code, now.getTime(), null);
  if (counter === null) throw new AppError('VALIDATION_ERROR', 'El código no coincide. Escribe el código que muestra tu app en este momento.', 400);
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { mfaSecretCiphertext: true, mfaEnrolledAt: true } });
    if (current.mfaSecretCiphertext && current.mfaEnrolledAt) throw new AppError('CONFLICT', 'La verificación en dos pasos ya está activa.', 409);
    await transaction.user.update({
      where: { id: actor.userId },
      data: { mfaSecretCiphertext: protectMfaSecret(seal.secret, readServerEnv().MFA_ENCRYPTION_KEY), mfaEnrolledAt: now, mfaRequired: true, mfaLastAcceptedCounter: counter },
    });
    await transaction.session.updateMany({ where: { id: currentSessionId, userId: actor.userId, revokedAt: null }, data: { mfaVerified: true } });
    const revoked = await transaction.session.updateMany({ where: { userId: actor.userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: now } });
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: actor.userId, keepSessionId: currentSessionId });
    await recordAuthEvent(transaction, { eventType: 'MFA_ENROLLED', outcome: 'SUCCESS', userId: actor.userId, context, metadata: { otherSessionsRevoked: revoked.count } });
    return { enabled: true, otherSessionsRevoked: revoked.count };
  });
}

/** Desactivar exige contraseña y un código vigente; para administradores la verificación es obligatoria. */
export async function disableAccountMfa(actor: Actor, input: { currentPassword: string; code: string }, context: AuthRequestContext, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  await allowAttempt('account-mfa-disable', actor.userId, now);
  const user = await loadAccountUser(prisma, actor);
  if (user.roleKeys.includes('admin')) throw new AppError('FORBIDDEN', 'Para administradores la verificación en dos pasos es obligatoria.', 403);
  if (!user.mfaSecretCiphertext) throw new AppError('CONFLICT', 'La verificación en dos pasos no está activa.', 409);
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) throw new AppError('VALIDATION_ERROR', 'La contraseña actual no es correcta.', 400);
  let counter: number | null = null;
  try {
    counter = verifyTotpCode(unprotectMfaSecret(user.mfaSecretCiphertext, readServerEnv().MFA_ENCRYPTION_KEY), input.code, now.getTime(), user.mfaLastAcceptedCounter);
  } catch {
    counter = null;
  }
  if (counter === null) throw new AppError('VALIDATION_ERROR', 'El código no coincide. Escribe el código que muestra tu app en este momento.', 400);
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: user.id }, data: { mfaSecretCiphertext: null, mfaEnrolledAt: null, mfaRequired: false, mfaLastAcceptedCounter: null } });
    await recordAuthEvent(transaction, { eventType: 'MFA_DISABLED', outcome: 'SUCCESS', userId: user.id, context, metadata: { origin: 'account' } });
  });
  return { enabled: false };
}

/** Cierra una sesión propia en otro equipo (la actual se cierra con "Cerrar sesión"). */
export async function revokeAccountSession(actor: Actor, currentSessionId: string, sessionId: string, context: AuthRequestContext, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  if (sessionId === currentSessionId) throw new AppError('VALIDATION_ERROR', 'Para cerrar esta sesión usa «Cerrar sesión».', 400);
  return prisma.$transaction(async (transaction) => {
    const revoked = await transaction.session.updateMany({ where: { id: sessionId, userId: actor.userId, revokedAt: null }, data: { revokedAt: now } });
    if (revoked.count !== 1) throw new AppError('NOT_FOUND', 'Esa sesión ya estaba cerrada.', 404);
    await publishSessionsClosed(transaction, { userId: actor.userId, sessionId });
    await recordAuthEvent(transaction, { eventType: 'SESSION_REVOKED', outcome: 'SUCCESS', userId: actor.userId, context, metadata: { sessionId, origin: 'account' } });
    return { revoked: 1 };
  });
}

/** Cierra todas las sesiones propias excepto la actual. */
export async function revokeOtherAccountSessions(actor: Actor, currentSessionId: string, context: AuthRequestContext, dependencies: AccountServiceDependencies = {}) {
  requireEmployee(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const revoked = await transaction.session.updateMany({ where: { userId: actor.userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: now } });
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: actor.userId, keepSessionId: currentSessionId });
    if (revoked.count > 0) await recordAuthEvent(transaction, { eventType: 'SESSION_REVOKED', outcome: 'SUCCESS', userId: actor.userId, context, metadata: { count: revoked.count, origin: 'account_others' } });
    return { revoked: revoked.count };
  });
}
