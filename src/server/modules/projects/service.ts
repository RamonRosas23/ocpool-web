import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { BUSINESS_TIMEZONE, timeZoneParts } from '@/lib/calendar-timezone';
import { requireStaffRequestReadScope, staffRequestReadScopeWhere } from '@/server/auth/request-scope';
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
  // Mismo ajuste que `allocateFolio` de quote-requests/service.ts: el prefijo de año debe venir del
  // año calendario de negocio (America/Chihuahua), no del año UTC.
  return formatProjectFolio(timeZoneParts(now, BUSINESS_TIMEZONE).year, sequence);
}

async function findExistingProjectByAcceptance(prisma: PrismaClient | Prisma.TransactionClient, quoteAcceptanceId: string): Promise<ProjectSummary | null> {
  const project = await prisma.project.findUnique({ where: { quoteAcceptanceId }, select: { id: true, folio: true, status: true, createdAt: true, completedAt: true } });
  return project;
}

type CreateProjectInput = Readonly<{
  quoteAcceptanceId: string;
  createdById: string;
  /** `undefined` = el responsable del expediente (si es un empleado activo); `null` = sin responsable. */
  ownerId: string | null | undefined;
  checklistLabels: readonly string[];
  source: 'staff' | 'customer_acceptance';
  /** Sólo en la conversión manual: el actor debe poder leer el expediente. */
  scopeActor: Actor | null;
  now: Date;
}>;

async function activeEmployeeId(transaction: Prisma.TransactionClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await transaction.user.findUnique({ where: { id: userId }, select: { type: true, status: true } });
  return user?.type === 'EMPLOYEE' && user.status === 'ACTIVE' ? userId : null;
}

/**
 * Crea el proyecto de arranque de una aceptación y cierra el ciclo comercial del expediente
 * (ACEPTADA → CONVERTIDA_EN_PROYECTO) en la misma transacción. Antes la conversión nunca movía la
 * solicitud: se quedaba "Aceptada" para siempre, el portal nunca llegaba a "Proyecto" y el
 * constructor seguía pidiendo convertir un expediente ya convertido.
 */
async function createProjectFromAcceptance(prisma: PrismaClient, input: CreateProjectInput): Promise<ProjectSummary> {
  const existing = await findExistingProjectByAcceptance(prisma, input.quoteAcceptanceId);
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (transaction) => {
      const acceptance = await transaction.quoteAcceptance.findUnique({
        where: { id: input.quoteAcceptanceId },
        select: {
          id: true,
          quote: {
            select: {
              clientId: true,
              quoteRequestId: true,
              quoteRequest: { select: { folio: true, status: true, contactId: true, currentAssigneeId: true } },
            },
          },
        },
      });
      if (!acceptance) throw new AppError('NOT_FOUND', 'La aceptación no existe.', 404);
      const request = acceptance.quote.quoteRequest;
      if (input.scopeActor) requireStaffRequestReadScope(input.scopeActor, request.currentAssigneeId);

      let ownerId: string | null;
      if (input.ownerId === undefined) {
        ownerId = await activeEmployeeId(transaction, request.currentAssigneeId);
      } else if (input.ownerId === null) {
        ownerId = null;
      } else {
        ownerId = await activeEmployeeId(transaction, input.ownerId);
        if (!ownerId) conflict('El responsable indicado no es válido.');
      }

      const folio = await allocateProjectFolio(transaction, input.now);
      const project = await transaction.project.create({
        data: {
          folio,
          quoteAcceptanceId: acceptance.id,
          quoteRequestId: acceptance.quote.quoteRequestId,
          clientId: acceptance.quote.clientId,
          contactId: request.contactId,
          ownerId,
          createdById: input.createdById,
        },
        select: { id: true, folio: true, status: true, createdAt: true, completedAt: true },
      });
      if (input.checklistLabels.length > 0) {
        await transaction.projectChecklistItem.createMany({
          data: input.checklistLabels.map((label, position) => ({ projectId: project.id, label, position })),
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: input.createdById,
          action: 'project.created',
          entityType: 'project',
          entityId: project.id,
          outcome: 'SUCCESS',
          metadata: { folio: project.folio, quoteAcceptanceId: acceptance.id, quoteRequestId: acceptance.quote.quoteRequestId, source: input.source },
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
      if (request.status === 'ACEPTADA') {
        await transaction.quoteRequest.update({ where: { id: acceptance.quote.quoteRequestId }, data: { status: 'CONVERTIDA_EN_PROYECTO', updatedAt: input.now } });
        await transaction.requestStatusHistory.create({ data: { quoteRequestId: acceptance.quote.quoteRequestId, fromStatus: 'ACEPTADA', toStatus: 'CONVERTIDA_EN_PROYECTO', changedById: input.createdById, reason: `Proyecto ${project.folio} creado.`, createdAt: input.now } });
        await transaction.auditLog.create({ data: { actorUserId: input.createdById, action: 'quote_request.status_changed', entityType: 'quote_request', entityId: acceptance.quote.quoteRequestId, outcome: 'SUCCESS', metadata: { folio: request.folio, fromStatus: 'ACEPTADA', toStatus: 'CONVERTIDA_EN_PROYECTO', source: 'project.created' } } });
        await transaction.outboxEvent.create({ data: { eventType: 'REQUEST.STATUS_CHANGED', aggregateType: 'QUOTE_REQUEST', aggregateId: acceptance.quote.quoteRequestId, payload: { quoteRequestId: acceptance.quote.quoteRequestId, folio: request.folio, fromStatus: 'ACEPTADA', toStatus: 'CONVERTIDA_EN_PROYECTO' } } });
      }
      return project;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findExistingProjectByAcceptance(prisma, input.quoteAcceptanceId);
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * J1-02: idempotent by design -- retrying (a second click, a network retry) after the first attempt
 * already committed returns that same project rather than erroring, and a first attempt that fails
 * partway never leaves the acceptance "converted" without a real Project row: the insert either
 * fully commits inside its own transaction or the unique constraint on `quoteAcceptanceId` rejects a
 * concurrent duplicate outright, which is caught below and resolved to the row the other request won.
 * Sin `ownerId`, el responsable es quien lleva el expediente (si sigue activo).
 */
export async function convertQuoteAcceptanceToProject(actor: Actor, quoteAcceptanceIdInput: string, input: ConvertQuoteAcceptanceInput = {}, dependencies: ProjectServiceDependencies = {}): Promise<ProjectSummary> {
  requirePermission(actor, 'projects.create');
  const quoteAcceptanceId = requireUuid(quoteAcceptanceIdInput, 'La aceptación no es válida.');
  const checklistLabels = (input.checklistLabels ?? []).map(normalizeChecklistLabel);
  if (checklistLabels.length > MAX_CHECKLIST_ITEMS) throw new AppError('VALIDATION_ERROR', 'No se pueden crear más de 30 tareas de checklist.', 400);
  const ownerId = input.ownerId === undefined ? undefined : input.ownerId === null ? null : requireUuid(input.ownerId, 'El responsable no es válido.');
  return createProjectFromAcceptance(dependencies.prisma ?? getPrisma(), {
    quoteAcceptanceId,
    createdById: actor.userId,
    ownerId,
    checklistLabels,
    source: 'staff',
    scopeActor: actor,
    now: dependencies.now ?? new Date(),
  });
}

/**
 * La aceptación del cliente es el cierre de la venta: el proyecto de arranque se crea en ese momento
 * (lo llama la ruta de aceptación del portal, ya confirmada la aceptación). Así "Aceptada" nunca se
 * queda esperando a que alguien recuerde convertirla. Si esto fallara, el expediente queda
 * "Aceptada" y el equipo ve "Convertir en proyecto" en Solicitudes, Cotizaciones y el dashboard.
 */
export async function createProjectForCustomerAcceptance(quoteAcceptanceIdInput: string, dependencies: ProjectServiceDependencies = {}): Promise<ProjectSummary> {
  const quoteAcceptanceId = requireUuid(quoteAcceptanceIdInput, 'La aceptación no es válida.');
  const prisma = dependencies.prisma ?? getPrisma();
  const acceptance = await prisma.quoteAcceptance.findUnique({ where: { id: quoteAcceptanceId }, select: { acceptedById: true } });
  if (!acceptance) throw new AppError('NOT_FOUND', 'La aceptación no existe.', 404);
  return createProjectFromAcceptance(prisma, {
    quoteAcceptanceId,
    createdById: acceptance.acceptedById,
    ownerId: undefined,
    checklistLabels: [],
    source: 'customer_acceptance',
    scopeActor: null,
    now: dependencies.now ?? new Date(),
  });
}

export type ProjectWorkspace = Readonly<{
  id: string;
  folio: string;
  status: ProjectHandoffStatus;
  createdAt: Date;
  completedAt: Date | null;
  owner: Readonly<{ id: string; displayName: string }> | null;
  /** `type` distingue un proyecto creado por la aceptación del cliente (CUSTOMER) de uno manual. */
  createdBy: Readonly<{ id: string; displayName: string; type: string }>;
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

export type ProjectListFilters = Readonly<{ page?: number; pageSize?: number; status?: ProjectHandoffStatus; query?: string }>;

export type ProjectListItem = Readonly<{
  id: string;
  folio: string;
  status: ProjectHandoffStatus;
  createdAt: Date;
  completedAt: Date | null;
  owner: { id: string; displayName: string } | null;
  client: { displayName: string };
  quoteRequest: { id: string; folio: string; projectType: string | null; location: string | null };
  acceptedTotal: { totalMinor: string; currencyCode: string };
  checklist: { total: number; completed: number };
}>;

/**
 * Índice de proyectos para staff. Sólo lectura, con exactamente el mismo alcance que
 * `getProjectWorkspace`: quien no puede abrir un proyecto tampoco lo ve listado
 * (`staffRequestReadScopeWhere` sobre el expediente de origen).
 */
export async function listProjects(actor: Actor, filters: ProjectListFilters = {}, dependencies: ProjectServiceDependencies = {}): Promise<{ items: ProjectListItem[]; page: number; pageSize: number; total: number; totalPages: number }> {
  requirePermission(actor, 'projects.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const page = Number.isInteger(filters.page) && (filters.page ?? 0) > 0 ? filters.page as number : 1;
  const pageSize = Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0 ? Math.min(filters.pageSize as number, 50) : 20;
  const query = filters.query?.trim() || undefined;
  if (query && query.length > 100) throw new AppError('VALIDATION_ERROR', 'La búsqueda no es válida.', 400);

  const where: Prisma.ProjectWhereInput = {
    AND: [
      { quoteRequest: staffRequestReadScopeWhere(actor) },
      ...(filters.status ? [{ status: filters.status }] : []),
      ...(query ? [{ OR: [
        { folio: { contains: query, mode: 'insensitive' as const } },
        { client: { displayName: { contains: query, mode: 'insensitive' as const } } },
        { quoteRequest: { folio: { contains: query, mode: 'insensitive' as const } } },
      ] }] : []),
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        folio: true,
        status: true,
        createdAt: true,
        completedAt: true,
        owner: { select: { id: true, displayName: true } },
        client: { select: { displayName: true } },
        quoteRequest: { select: { id: true, folio: true, detail: { select: { projectType: true, location: true } } } },
        quoteAcceptance: { select: { quoteVersion: { select: { totalMinor: true, currencyCode: true } } } },
        checklistItems: { select: { completedAt: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      folio: row.folio,
      status: row.status,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      owner: row.owner,
      client: row.client,
      quoteRequest: { id: row.quoteRequest.id, folio: row.quoteRequest.folio, projectType: row.quoteRequest.detail?.projectType ?? null, location: row.quoteRequest.detail?.location ?? null },
      acceptedTotal: { totalMinor: row.quoteAcceptance.quoteVersion.totalMinor.toString(), currencyCode: row.quoteAcceptance.quoteVersion.currencyCode },
      checklist: { total: row.checklistItems.length, completed: row.checklistItems.filter((item) => item.completedAt !== null).length },
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
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
      createdBy: { select: { id: true, displayName: true, type: true } },
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

// U1-05: acepta varias etiquetas a la vez (una por línea en el textarea del cliente) en vez de
// obligar a repetir la misma acción de un solo campo tarea por tarea -- la única forma real de
// "aplicación masiva" que no exige inventar el contenido de una plantilla de negocio que este
// repositorio no tiene autoridad para definir.
export async function addProjectChecklistItems(actor: Actor, projectIdInput: string, labelsInput: readonly string[], dependencies: ProjectServiceDependencies = {}): Promise<void> {
  requirePermission(actor, 'projects.manage');
  const projectId = requireUuid(projectIdInput, 'El proyecto no es válido.');
  const labels = labelsInput.map(normalizeChecklistLabel);
  if (labels.length === 0) throw new AppError('VALIDATION_ERROR', 'Escribe al menos una tarea.', 400);
  const prisma = dependencies.prisma ?? getPrisma();

  await prisma.$transaction(async (transaction) => {
    await lockAndScopeProject(transaction, actor, projectId);
    const count = await transaction.projectChecklistItem.count({ where: { projectId } });
    if (count + labels.length > MAX_CHECKLIST_ITEMS) conflict('No se pueden crear más de 30 tareas de checklist.');
    await transaction.projectChecklistItem.createMany({
      data: labels.map((label, index) => ({ projectId, label, position: count + index })),
    });
    // Mismo patrón que `setProjectHandoffStatus`/`setProjectOwner` -- sin esta entrada, el checklist
    // era la única mutación de este archivo invisible en el feed "Actividad" del expediente
    // (`getProjectWorkspace`'s `activity`, que lee directamente de `auditLog`).
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'project.checklist_items_added',
        entityType: 'project',
        entityId: projectId,
        outcome: 'SUCCESS',
        metadata: { labels, count: labels.length },
      },
    });
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
    const item = await transaction.projectChecklistItem.findUnique({ where: { id: itemId }, select: { projectId: true, label: true } });
    if (!item || item.projectId !== projectId) throw new AppError('NOT_FOUND', 'La tarea no existe.', 404);
    await transaction.projectChecklistItem.update({
      where: { id: itemId },
      data: completed ? { completedAt: now, completedById: actor.userId } : { completedAt: null, completedById: null },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: completed ? 'project.checklist_item_completed' : 'project.checklist_item_reopened',
        entityType: 'project',
        entityId: projectId,
        outcome: 'SUCCESS',
        metadata: { itemId, label: item.label },
      },
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
