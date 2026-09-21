import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { requireStaffRequestReadScope } from '@/server/auth/request-scope';
import { formatProjectFolio, normalizeChecklistLabel, type ProjectHandoffStatus } from '@/server/modules/projects/domain';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FOLIO_SEQUENCE_KEY = 'project';
const MAX_CHECKLIST_ITEMS = 30;

export type ProjectServiceDependencies = Readonly<{ prisma?: PrismaClient; now?: Date }>;

export type ConvertQuoteAcceptanceInput = Readonly<{
  ownerId?: string | null;
  checklistLabels?: readonly string[];
}>;

export type ProjectSummary = Readonly<{
  id: string;
  folio: string;
  status: ProjectHandoffStatus;
  createdAt: Date;
  completedAt: Date | null;
}>;

function requireUuid(value: string, message: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', message, 400);
  return value;
}

function conflict(message: string): never {
  throw new AppError('CONFLICT', message, 409);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function allocateProjectFolio(transaction: Prisma.TransactionClient, now: Date): Promise<string> {
  await transaction.folioSequence.upsert({ where: { key: FOLIO_SEQUENCE_KEY }, update: {}, create: { key: FOLIO_SEQUENCE_KEY, nextValue: 1 } });
  const rows = await transaction.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
    SELECT "nextValue" FROM "folio_sequences" WHERE "key" = ${FOLIO_SEQUENCE_KEY} FOR UPDATE
  `);
  const sequence = rows[0]?.nextValue;
  if (!sequence) throw new Error('Project folio sequence is unavailable.');
  await transaction.folioSequence.update({ where: { key: FOLIO_SEQUENCE_KEY }, data: { nextValue: { increment: 1 } } });
  return formatProjectFolio(now.getUTCFullYear(), sequence);
}

async function findExistingProjectByAcceptance(prisma: PrismaClient | Prisma.TransactionClient, quoteAcceptanceId: string): Promise<ProjectSummary | null> {
  const project = await prisma.project.findUnique({ where: { quoteAcceptanceId }, select: { id: true, folio: true, status: true, createdAt: true, completedAt: true } });
  return project;
}

/**
 * J1-02: idempotent by design -- retrying (a second click, a network retry) after the first attempt
 * already committed returns that same project rather than erroring, and a first attempt that fails
 * partway never leaves the acceptance "converted" without a real Project row: the insert either
 * fully commits inside its own transaction or the unique constraint on `quoteAcceptanceId` rejects a
 * concurrent duplicate outright, which is caught below and resolved to the row the other request won.
 */
export async function convertQuoteAcceptanceToProject(actor: Actor, quoteAcceptanceIdInput: string, input: ConvertQuoteAcceptanceInput = {}, dependencies: ProjectServiceDependencies = {}): Promise<ProjectSummary> {
  requirePermission(actor, 'projects.create');
  const quoteAcceptanceId = requireUuid(quoteAcceptanceIdInput, 'La aceptación no es válida.');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();

  const existing = await findExistingProjectByAcceptance(prisma, quoteAcceptanceId);
  if (existing) return existing;

  const checklistLabels = (input.checklistLabels ?? []).map(normalizeChecklistLabel);
  if (checklistLabels.length > MAX_CHECKLIST_ITEMS) throw new AppError('VALIDATION_ERROR', 'No se pueden crear más de 30 tareas de checklist.', 400);
  const ownerId = input.ownerId ? requireUuid(input.ownerId, 'El responsable no es válido.') : null;

  try {
    return await prisma.$transaction(async (transaction) => {
      const acceptance = await transaction.quoteAcceptance.findUnique({
        where: { id: quoteAcceptanceId },
        select: {
          id: true,
          quote: {
            select: {
              clientId: true,
              quoteRequestId: true,
              quoteRequest: { select: { contactId: true, currentAssigneeId: true } },
            },
          },
        },
      });
      if (!acceptance) throw new AppError('NOT_FOUND', 'La aceptación no existe.', 404);
      requireStaffRequestReadScope(actor, acceptance.quote.quoteRequest.currentAssigneeId);

      if (ownerId) {
        const owner = await transaction.user.findUnique({ where: { id: ownerId }, select: { id: true, type: true, status: true } });
        if (!owner || owner.type !== 'EMPLOYEE' || owner.status !== 'ACTIVE') conflict('El responsable indicado no es válido.');
      }

      const folio = await allocateProjectFolio(transaction, now);
      const project = await transaction.project.create({
        data: {
          folio,
          quoteAcceptanceId: acceptance.id,
          quoteRequestId: acceptance.quote.quoteRequestId,
          clientId: acceptance.quote.clientId,
          contactId: acceptance.quote.quoteRequest.contactId,
          ownerId,
          createdById: actor.userId,
        },
        select: { id: true, folio: true, status: true, createdAt: true, completedAt: true },
      });
      if (checklistLabels.length > 0) {
        await transaction.projectChecklistItem.createMany({
          data: checklistLabels.map((label, position) => ({ projectId: project.id, label, position })),
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: 'project.created',
          entityType: 'project',
          entityId: project.id,
          outcome: 'SUCCESS',
          metadata: { folio: project.folio, quoteAcceptanceId: acceptance.id, quoteRequestId: acceptance.quote.quoteRequestId },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'PROJECT.CREATED',
          aggregateType: 'PROJECT',
          aggregateId: project.id,
          payload: { projectId: project.id, folio: project.folio, quoteRequestId: acceptance.quote.quoteRequestId },
        },
      });
      return project;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findExistingProjectByAcceptance(prisma, quoteAcceptanceId);
      if (raced) return raced;
    }
    throw error;
  }
}

export type ProjectWorkspace = Readonly<{
  id: string;
  folio: string;
  status: ProjectHandoffStatus;
  createdAt: Date;
  completedAt: Date | null;
  owner: Readonly<{ id: string; displayName: string }> | null;
  createdBy: Readonly<{ id: string; displayName: string }>;
  client: Readonly<{ id: string; displayName: string }>;
  contact: Readonly<{ id: string; displayName: string; email: string; phone: string | null }>;
  quoteRequest: Readonly<{ id: string; folio: string; projectType: string; location: string; description: string }>;
  acceptedVersion: Readonly<{
    versionNumber: number;
    currencyCode: string;
    totalMinor: string;
    acceptedAt: Date;
    signerName: string;
    sections: ReadonlyArray<Readonly<{ id: string; title: string; description: string | null }>>;
    lines: ReadonlyArray<Readonly<{ id: string; name: string; description: string | null; unit: string; quantityMilliunits: string; totalMinor: string; sectionId: string | null }>>;
  }>;
  checklistItems: ReadonlyArray<Readonly<{ id: string; label: string; position: number; completedAt: Date | null; completedBy: Readonly<{ displayName: string }> | null }>>;
  activity: ReadonlyArray<Readonly<{ id: string; action: string; createdAt: Date }>>;
}>;

async function loadProjectScope(prisma: PrismaClient, projectId: string): Promise<{ currentAssigneeId: string | null } | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { quoteRequest: { select: { currentAssigneeId: true } } } });
  return project ? { currentAssigneeId: project.quoteRequest.currentAssigneeId } : null;
}

export async function getProjectWorkspace(actor: Actor, projectIdInput: string, dependencies: ProjectServiceDependencies = {}): Promise<ProjectWorkspace> {
  requirePermission(actor, 'projects.read');
  const projectId = requireUuid(projectIdInput, 'El proyecto no es válido.');
  const prisma = dependencies.prisma ?? getPrisma();

  const scope = await loadProjectScope(prisma, projectId);
  if (!scope) throw new AppError('NOT_FOUND', 'El proyecto no existe.', 404);
  requireStaffRequestReadScope(actor, scope.currentAssigneeId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      folio: true,
      status: true,
      createdAt: true,
      completedAt: true,
      owner: { select: { id: true, displayName: true } },
      createdBy: { select: { id: true, displayName: true } },
      client: { select: { id: true, displayName: true } },
      contact: { select: { id: true, displayName: true, email: true, phone: true } },
      quoteRequest: { select: { id: true, folio: true, detail: { select: { projectType: true, location: true, description: true } } } },
      quoteAcceptance: {
        select: {
          signerName: true,
          acceptedAt: true,
          quoteVersion: {
            select: {
              versionNumber: true,
              currencyCode: true,
              totalMinor: true,
              sections: { orderBy: { position: 'asc' }, select: { id: true, title: true, description: true } },
              lines: { orderBy: { position: 'asc' }, select: { id: true, name: true, description: true, unit: true, quantityMilliunits: true, totalMinor: true, sectionId: true } },
            },
          },
        },
      },
      checklistItems: { orderBy: { position: 'asc' }, select: { id: true, label: true, position: true, completedAt: true, completedBy: { select: { displayName: true } } } },
    },
  });
  if (!project) throw new AppError('NOT_FOUND', 'El proyecto no existe.', 404);

  const activity = await prisma.auditLog.findMany({
    where: { entityType: 'project', entityId: project.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, action: true, createdAt: true },
  });

  return {
    id: project.id,
    folio: project.folio,
    status: project.status,
    createdAt: project.createdAt,
    completedAt: project.completedAt,
    owner: project.owner,
    createdBy: project.createdBy,
    client: project.client,
    contact: project.contact,
    quoteRequest: {
      id: project.quoteRequest.id,
      folio: project.quoteRequest.folio,
      projectType: project.quoteRequest.detail?.projectType ?? '',
      location: project.quoteRequest.detail?.location ?? '',
      description: project.quoteRequest.detail?.description ?? '',
    },
    acceptedVersion: {
      versionNumber: project.quoteAcceptance.quoteVersion.versionNumber,
      currencyCode: project.quoteAcceptance.quoteVersion.currencyCode,
      totalMinor: project.quoteAcceptance.quoteVersion.totalMinor.toString(),
      acceptedAt: project.quoteAcceptance.acceptedAt,
      signerName: project.quoteAcceptance.signerName,
      sections: project.quoteAcceptance.quoteVersion.sections,
      lines: project.quoteAcceptance.quoteVersion.lines.map((line) => ({
        id: line.id,
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantityMilliunits: line.quantityMilliunits.toString(),
        totalMinor: line.totalMinor.toString(),
        sectionId: line.sectionId,
      })),
    },
    checklistItems: project.checklistItems,
    activity,
  };
}

async function lockAndScopeProject(transaction: Prisma.TransactionClient, actor: Actor, projectId: string): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ currentAssigneeId: string | null }>>(Prisma.sql`
    SELECT qr."currentAssigneeId"
    FROM "projects" p
    INNER JOIN "quote_requests" qr ON qr."id" = p."quoteRequestId"
    WHERE p."id" = ${projectId}
    FOR UPDATE OF p
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'El proyecto no existe.', 404);
  requireStaffRequestReadScope(actor, row.currentAssigneeId);
}

export async function addProjectChecklistItem(actor: Actor, projectIdInput: string, label: string, dependencies: ProjectServiceDependencies = {}): Promise<void> {
  requirePermission(actor, 'projects.manage');
  const projectId = requireUuid(projectIdInput, 'El proyecto no es válido.');
  const normalizedLabel = normalizeChecklistLabel(label);
  const prisma = dependencies.prisma ?? getPrisma();

  await prisma.$transaction(async (transaction) => {
    await lockAndScopeProject(transaction, actor, projectId);
    const count = await transaction.projectChecklistItem.count({ where: { projectId } });
    if (count >= MAX_CHECKLIST_ITEMS) conflict('No se pueden crear más de 30 tareas de checklist.');
    await transaction.projectChecklistItem.create({ data: { projectId, label: normalizedLabel, position: count } });
  });
}

export async function setProjectChecklistItemCompletion(actor: Actor, projectIdInput: string, itemIdInput: string, completed: boolean, dependencies: ProjectServiceDependencies = {}): Promise<void> {
  requirePermission(actor, 'projects.manage');
  const projectId = requireUuid(projectIdInput, 'El proyecto no es válido.');
  const itemId = requireUuid(itemIdInput, 'La tarea no es válida.');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();

  await prisma.$transaction(async (transaction) => {
    await lockAndScopeProject(transaction, actor, projectId);
    const item = await transaction.projectChecklistItem.findUnique({ where: { id: itemId }, select: { projectId: true } });
    if (!item || item.projectId !== projectId) throw new AppError('NOT_FOUND', 'La tarea no existe.', 404);
    await transaction.projectChecklistItem.update({
      where: { id: itemId },
      data: completed ? { completedAt: now, completedById: actor.userId } : { completedAt: null, completedById: null },
    });
  });
}

export async function setProjectHandoffStatus(actor: Actor, projectIdInput: string, status: ProjectHandoffStatus, dependencies: ProjectServiceDependencies = {}): Promise<void> {
  requirePermission(actor, 'projects.manage');
  const projectId = requireUuid(projectIdInput, 'El proyecto no es válido.');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();

  await prisma.$transaction(async (transaction) => {
    await lockAndScopeProject(transaction, actor, projectId);
    await transaction.project.update({
      where: { id: projectId },
      data: { status, completedAt: status === 'COMPLETADO' ? now : null },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: status === 'COMPLETADO' ? 'project.completed' : 'project.reopened',
        entityType: 'project',
        entityId: projectId,
        outcome: 'SUCCESS',
        metadata: { status },
      },
    });
  });
}

export type ProjectAssignableEmployee = Readonly<{ id: string; displayName: string; email: string }>;

export async function listProjectAssignableEmployees(actor: Actor, dependencies: ProjectServiceDependencies = {}): Promise<ProjectAssignableEmployee[]> {
  requirePermission(actor, 'projects.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  return prisma.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE' },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, displayName: true, email: true },
  });
}

export async function setProjectOwner(actor: Actor, projectIdInput: string, ownerIdInput: string | null, dependencies: ProjectServiceDependencies = {}): Promise<void> {
  requirePermission(actor, 'projects.manage');
  const projectId = requireUuid(projectIdInput, 'El proyecto no es válido.');
  const ownerId = ownerIdInput ? requireUuid(ownerIdInput, 'El responsable no es válido.') : null;
  const prisma = dependencies.prisma ?? getPrisma();

  await prisma.$transaction(async (transaction) => {
    await lockAndScopeProject(transaction, actor, projectId);
    if (ownerId) {
      const owner = await transaction.user.findUnique({ where: { id: ownerId }, select: { id: true, type: true, status: true } });
      if (!owner || owner.type !== 'EMPLOYEE' || owner.status !== 'ACTIVE') conflict('El responsable indicado no es válido.');
    }
    await transaction.project.update({ where: { id: projectId }, data: { ownerId } });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'project.owner_changed',
        entityType: 'project',
        entityId: projectId,
        outcome: 'SUCCESS',
        metadata: { ownerId },
      },
    });
  });
}
