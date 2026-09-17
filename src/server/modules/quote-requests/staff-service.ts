import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { hasPermission, requirePermission } from '@/server/auth/permissions';
import type { AuthRequestContext } from '@/server/auth/service';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { assertStaffAssigneeFilterScope, assertStaffAssigneeTargetScope, canReadGlobalStaffRequests, requireStaffRequestReadScope, staffRequestReadScopeWhere } from '@/server/auth/request-scope';
import { inviteCustomerPortalAccessInTransaction, type CustomerAccessResult } from '@/server/modules/customer-onboarding/service';
import { sendStaffMessageInTransaction } from '@/server/modules/messaging/service';
import { normalizeIdempotencyKey, normalizeMessageBody } from '@/server/modules/messaging/domain';
import { createQuoteRequest, type CreateQuoteRequestInput, type QuoteRequestResult } from '@/server/modules/quote-requests/service';
import {
  canStaffTransitionQuoteRequest,
  normalizeQuoteRequestEmail,
  normalizeQuoteRequestText,
  QUOTE_REQUEST_BUDGET_RANGES,
  QUOTE_REQUEST_INFORMATION_FIELDS,
  QUOTE_REQUEST_PROJECT_STAGES,
  QUOTE_REQUEST_TIMELINES,
  type QuoteRequestStatus,
  QUOTE_REQUEST_STATUSES,
} from '@/server/modules/quote-requests/domain';
import {
  REQUEST_WORKSPACE_SORTS,
  type RequestWorkspaceSort,
} from '@/lib/request-workspace-query';

export type StaffQuoteRequestListFilters = {
  status?: QuoteRequestStatus;
  assignedToId?: string | null;
  query?: string;
  createdFrom?: Date;
  createdTo?: Date;
  createdAfter?: Date;
  createdBefore?: Date;
  createdBeforeOrEqual?: Date;
  sort?: RequestWorkspaceSort;
  page?: number;
  pageSize?: number;
};

export type StaffServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  tokenGenerator?: () => string;
  context?: AuthRequestContext;
};

export type StaffQuoteRequestContactMatch = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  roleTitle: string | null;
  client: { id: string; displayName: string; status: string };
};

export type StaffCreateQuoteRequestInput = {
  idempotencyKey: string;
  contact: CreateQuoteRequestInput['contact'];
  detail: Omit<CreateQuoteRequestInput['detail'], 'consentAt'>;
  contactMatchId?: string | null;
  confirmNewContact?: boolean;
};

export type StaffUpdateQuoteRequestInput = {
  contact?: {
    displayName?: string;
    email?: string;
    phone?: string | null;
    roleTitle?: string | null;
  };
  detail?: {
    projectType?: string;
    location?: string;
    projectStage?: (typeof QUOTE_REQUEST_PROJECT_STAGES)[number] | null;
    dimensions?: string | null;
    timeline?: (typeof QUOTE_REQUEST_TIMELINES)[number] | null;
    budgetRange?: (typeof QUOTE_REQUEST_BUDGET_RANGES)[number] | null;
    description?: string;
  };
  reason?: string;
};

export type StaffRequestInformationInput = {
  message: string;
  idempotencyKey: string;
  missingFields?: readonly (typeof QUOTE_REQUEST_INFORMATION_FIELDS)[number][];
  enablePortalAccess?: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DEFAULT_ACTIVITY_PAGE_SIZE = 30;
const MAX_ACTIVITY_PAGE_SIZE = 50;
const QUOTE_BUILDER_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'];
const PUBLISHED_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO'];

type ActivityKind = 'status' | 'assignment';
type ActivityCursor = { date: string; id: string; kind: ActivityKind };
type StaffStatusHistoryRecord = {
  id: string;
  fromStatus: QuoteRequestStatus | null;
  toStatus: QuoteRequestStatus;
  reason: string | null;
  createdAt: Date;
  changedBy: { id: string; displayName: string } | null;
};
type StaffAssignmentRecord = {
  id: string;
  reason: string | null;
  assignedAt: Date;
  unassignedAt: Date | null;
  assignedTo: { id: string; displayName: string; email: string } | null;
  assignedBy: { id: string; displayName: string } | null;
};
type ActivityRecord =
  | { kind: 'status'; id: string; date: Date; value: StaffStatusHistoryRecord }
  | { kind: 'assignment'; id: string; date: Date; value: StaffAssignmentRecord };

function requireStaffPermission(actor: Actor, permission: string): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, permission);
}

function requireUuid(value: string, message = 'Identificador inválido.'): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', message, 400);
  return value;
}

function normalizeReason(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    return normalizeQuoteRequestText(value, 500);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El motivo no es válido.', 400);
  }
}

function normalizePagination(filters: StaffQuoteRequestListFilters): { page: number; pageSize: number } {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new AppError('VALIDATION_ERROR', 'La paginación no es válida.', 400);
  }
  return { page, pageSize };
}

function isQuoteRequestStatus(value: string): value is QuoteRequestStatus {
  return (QUOTE_REQUEST_STATUSES as readonly string[]).includes(value);
}

function normalizeFilters(filters: StaffQuoteRequestListFilters) {
  const pagination = normalizePagination(filters);
  const query = filters.query?.trim() || undefined;
  if (query && query.length > 100) throw new AppError('VALIDATION_ERROR', 'La búsqueda no es válida.', 400);
  if (filters.status && !isQuoteRequestStatus(filters.status)) throw new AppError('VALIDATION_ERROR', 'El estado no es válido.', 400);
  if (filters.assignedToId) requireUuid(filters.assignedToId);
  if (filters.createdFrom && Number.isNaN(filters.createdFrom.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha inicial no es válida.', 400);
  if (filters.createdTo && Number.isNaN(filters.createdTo.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha final no es válida.', 400);
  if (filters.createdAfter && Number.isNaN(filters.createdAfter.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha inicial exclusiva no es válida.', 400);
  if (filters.createdBefore && Number.isNaN(filters.createdBefore.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha límite no es válida.', 400);
  if (filters.createdBeforeOrEqual && Number.isNaN(filters.createdBeforeOrEqual.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha límite inclusiva no es válida.', 400);
  if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) throw new AppError('VALIDATION_ERROR', 'El rango de fechas no es válido.', 400);
  if (filters.createdAfter && filters.createdBefore && filters.createdAfter >= filters.createdBefore) throw new AppError('VALIDATION_ERROR', 'El rango de antigüedad no es válido.', 400);
  const sort = filters.sort ?? 'newest';
  if (!(REQUEST_WORKSPACE_SORTS as readonly string[]).includes(sort)) throw new AppError('VALIDATION_ERROR', 'El orden no es válido.', 400);
  return { ...filters, query, sort, ...pagination };
}

function normalizeActivityLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_ACTIVITY_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_PAGE_SIZE) throw new AppError('VALIDATION_ERROR', 'El límite de actividad no es válido.', 400);
  return limit;
}

function encodeActivityCursor(record: ActivityRecord): string {
  return Buffer.from(JSON.stringify({ date: record.date.toISOString(), id: record.id, kind: record.kind }), 'utf8').toString('base64url');
}

function decodeActivityCursor(value: string | undefined): ActivityCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ActivityCursor>;
    if ((decoded.kind !== 'status' && decoded.kind !== 'assignment') || typeof decoded.id !== 'string' || !UUID_PATTERN.test(decoded.id) || typeof decoded.date !== 'string' || Number.isNaN(new Date(decoded.date).getTime())) throw new Error('invalid cursor');
    return { kind: decoded.kind, id: decoded.id, date: new Date(decoded.date).toISOString() };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El cursor de actividad no es válido.', 400);
  }
}

function compareActivity(left: ActivityRecord, right: ActivityRecord): number {
  const dateDiff = right.date.getTime() - left.date.getTime();
  if (dateDiff !== 0) return dateDiff;
  if (left.kind !== right.kind) return left.kind === 'status' ? -1 : 1;
  return right.id.localeCompare(left.id);
}

function activityPage(statusHistory: StaffStatusHistoryRecord[], assignments: StaffAssignmentRecord[], limit: number) {
  const records: ActivityRecord[] = [
    ...statusHistory.map((value) => ({ kind: 'status' as const, id: value.id, date: value.createdAt, value })),
    ...assignments.map((value) => ({ kind: 'assignment' as const, id: value.id, date: value.assignedAt, value })),
  ].sort(compareActivity);
  const page = records.slice(0, limit);
  const last = page[page.length - 1];
  return {
    statusHistory: page.filter((record): record is Extract<ActivityRecord, { kind: 'status' }> => record.kind === 'status').map((record) => record.value),
    assignments: page.filter((record): record is Extract<ActivityRecord, { kind: 'assignment' }> => record.kind === 'assignment').map((record) => record.value),
    items: page,
    nextCursor: records.length > page.length && last ? encodeActivityCursor(last) : null,
  };
}

function statusActivityWhere(cursor: ActivityCursor | undefined): Prisma.RequestStatusHistoryWhereInput {
  if (!cursor) return {};
  const sameDateFilter = cursor.kind === 'status' ? { createdAt: new Date(cursor.date), id: { lt: cursor.id } } : null;
  return {
    OR: [
      { createdAt: { lt: new Date(cursor.date) } },
      ...(sameDateFilter ? [sameDateFilter] : []),
    ],
  };
}

function assignmentActivityWhere(cursor: ActivityCursor | undefined): Prisma.RequestAssignmentWhereInput {
  if (!cursor) return {};
  const sameDateFilter = cursor.kind === 'assignment' ? { assignedAt: new Date(cursor.date), id: { lt: cursor.id } } : cursor.kind === 'status' ? { assignedAt: new Date(cursor.date) } : null;
  return {
    OR: [
      { assignedAt: { lt: new Date(cursor.date) } },
      ...(sameDateFilter ? [sameDateFilter] : []),
    ],
  };
}

function normalizeEditableText(value: string, maxLength: number, message: string): string {
  try {
    return normalizeQuoteRequestText(value, maxLength);
  } catch {
    throw new AppError('VALIDATION_ERROR', message, 400);
  }
}

function normalizeEditableEmail(value: string): string {
  try {
    return normalizeQuoteRequestEmail(value);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El correo del contacto no es válido.', 400);
  }
}

function normalizeEditableNullableText(value: string | null, maxLength: number, message: string): string | null {
  if (value === null || value.trim() === '') return null;
  return normalizeEditableText(value, maxLength, message);
}

function maskedEmail(value: string): string {
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskedPhone(value: string | null): string | null {
  return value ? `***${value.slice(-2)}` : null;
}

function safeContactSnapshot(contact: { displayName: string; email: string; phone: string | null; roleTitle: string | null }) {
  return {
    displayName: contact.displayName ? `${contact.displayName.slice(0, 1)}…` : '',
    email: maskedEmail(contact.email),
    phone: maskedPhone(contact.phone),
    roleTitlePresent: Boolean(contact.roleTitle),
  };
}

function safeDetailSnapshot(detail: { projectType: string; location: string; projectStage: string | null; dimensions: string | null; timeline: string | null; budgetRange: string | null; description: string }) {
  return {
    projectType: detail.projectType,
    location: detail.location,
    projectStage: detail.projectStage,
    dimensions: detail.dimensions,
    timeline: detail.timeline,
    budgetRange: detail.budgetRange,
    descriptionLength: detail.description.length,
  };
}

async function lockQuoteRequest(transaction: Prisma.TransactionClient, quoteRequestId: string): Promise<{ id: string; folio: string; clientId: string; status: QuoteRequestStatus; currentAssigneeId: string | null } | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string; folio: string; clientId: string; status: QuoteRequestStatus; currentAssigneeId: string | null }>>(Prisma.sql`
    SELECT "id", "folio", "clientId", "status", "currentAssigneeId"
    FROM "quote_requests"
    WHERE "id" = ${quoteRequestId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function serializeDetail(detail: {
  id: string;
  projectType: string;
  location: string;
  budgetCents: bigint | null;
  currencyCode: string;
  dimensions: string | null;
  projectStage: string | null;
  timeline: string | null;
  budgetRange: string | null;
  description: string;
  consentAt: Date;
} | null) {
  if (!detail) return null;
  return { ...detail, budgetCents: detail.budgetCents === null ? null : detail.budgetCents.toString() };
}

function projectAvailableActions(actor: Actor, status: QuoteRequestStatus, currentAssigneeId: string | null) {
  const availableStatusTransitions = hasPermission(actor, 'requests.status.update')
    ? QUOTE_REQUEST_STATUSES.filter((candidate) => candidate !== 'INFORMACION_REQUERIDA' && canStaffTransitionQuoteRequest(status, candidate))
    : [];
  const availableActions = availableStatusTransitions.map((candidate) => `request.status:${candidate}`);
  if (hasPermission(actor, 'requests.status.update') && hasPermission(actor, 'messaging.send') && ['EN_REVISION', 'EN_ELABORACION'].includes(status)) {
    availableActions.push('request.information');
  }
  if (currentAssigneeId === null && hasPermission(actor, 'requests.claim')) availableActions.push('request.take');
  if (currentAssigneeId === actor.userId) availableActions.push('request.taken');
  if (currentAssigneeId !== null && currentAssigneeId !== actor.userId && hasPermission(actor, 'requests.reassign')) availableActions.push('request.reassign');
  if (hasPermission(actor, 'quotes.create') && QUOTE_BUILDER_REQUEST_STATUSES.includes(status)) {
    availableActions.push('quote.open');
  }
  return { availableStatusTransitions, availableActions };
}

export async function listStaffQuoteRequests(actor: Actor, filters: StaffQuoteRequestListFilters = {}, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const normalized = normalizeFilters(filters);
  assertStaffAssigneeFilterScope(actor, normalized.assignedToId);
  const where: Prisma.QuoteRequestWhereInput = {
    AND: [
      staffRequestReadScopeWhere(actor),
      ...(normalized.query ? [{
        OR: [
          { folio: { contains: normalized.query, mode: 'insensitive' as const } },
          { client: { displayName: { contains: normalized.query, mode: 'insensitive' as const } } },
          { contact: { displayName: { contains: normalized.query, mode: 'insensitive' as const } } },
          { contact: { emailNormalized: { contains: normalized.query.toLowerCase(), mode: 'insensitive' as const } } },
        ],
      }] : []),
    ],
    status: normalized.status,
    currentAssigneeId: normalized.assignedToId,
    createdAt: normalized.createdFrom || normalized.createdAfter || normalized.createdBefore || normalized.createdBeforeOrEqual || normalized.createdTo ? {
      gte: normalized.createdFrom,
      gt: normalized.createdAfter,
      lt: normalized.createdBefore,
      lte: normalized.createdTo,
      ...(normalized.createdBeforeOrEqual ? { lte: normalized.createdBeforeOrEqual } : {}),
    } : undefined,
  };
  const [total, items] = await Promise.all([
    prisma.quoteRequest.count({ where }),
    prisma.quoteRequest.findMany({
      where,
      orderBy: normalized.sort === 'oldest'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : normalized.sort === 'updated'
          ? [{ updatedAt: 'desc' }, { id: 'desc' }]
          : normalized.sort === 'stale'
            ? [{ updatedAt: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (normalized.page - 1) * normalized.pageSize,
      take: normalized.pageSize,
      select: {
        id: true,
        folio: true,
        origin: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, displayName: true, status: true } },
        contact: { select: { id: true, displayName: true, email: true, phone: true } },
        currentAssignee: { select: { id: true, displayName: true, email: true } },
        detail: { select: { projectType: true, location: true, projectStage: true, dimensions: true, timeline: true, budgetRange: true } },
      },
    }),
  ]);
  return {
    items,
    page: normalized.page,
    pageSize: normalized.pageSize,
    total,
    totalPages: Math.ceil(total / normalized.pageSize),
  };
}

export async function getStaffQuoteRequest(actor: Actor, quoteRequestId: string, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const request = await prisma.quoteRequest.findUnique({
    where: { id: requireUuid(quoteRequestId, 'La solicitud no es válida.') },
    select: {
      id: true,
      folio: true,
      origin: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, displayName: true, status: true } },
      contact: { select: { id: true, displayName: true, email: true, phone: true, roleTitle: true, status: true, user: { select: { id: true, type: true, status: true } } } },
      currentAssignee: { select: { id: true, displayName: true, email: true } },
      detail: true,
      assignments: {
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        take: DEFAULT_ACTIVITY_PAGE_SIZE + 1,
        select: {
          id: true,
          reason: true,
          assignedAt: true,
          unassignedAt: true,
          assignedTo: { select: { id: true, displayName: true, email: true } },
          assignedBy: { select: { id: true, displayName: true } },
        },
      },
      statusHistory: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: DEFAULT_ACTIVITY_PAGE_SIZE + 1,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
          changedBy: { select: { id: true, displayName: true } },
        },
      },
    },
  });
  if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
  requireStaffRequestReadScope(actor, request.currentAssignee?.id ?? null);
  const activity = activityPage(request.statusHistory, request.assignments, DEFAULT_ACTIVITY_PAGE_SIZE);
  return { ...request, detail: serializeDetail(request.detail), assignments: activity.assignments, statusHistory: activity.statusHistory, activityNextCursor: activity.nextCursor, ...projectAvailableActions(actor, request.status, request.currentAssignee?.id ?? null) };
}

export type StaffQuoteRequestActivityFilters = {
  cursor?: string;
  limit?: number;
};

export async function listStaffQuoteRequestActivity(actor: Actor, quoteRequestId: string, filters: StaffQuoteRequestActivityFilters = {}, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const limit = normalizeActivityLimit(filters.limit);
  const cursor = decodeActivityCursor(filters.cursor);
  const request = await prisma.quoteRequest.findFirst({ where: { id, ...staffRequestReadScopeWhere(actor) }, select: { id: true } });
  if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
  const [statusHistory, assignments] = await Promise.all([
    prisma.requestStatusHistory.findMany({
      where: { quoteRequestId: id, ...statusActivityWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        createdAt: true,
        changedBy: { select: { id: true, displayName: true } },
      },
    }),
    prisma.requestAssignment.findMany({
      where: { quoteRequestId: id, ...assignmentActivityWhere(cursor) },
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        reason: true,
        assignedAt: true,
        unassignedAt: true,
        assignedTo: { select: { id: true, displayName: true, email: true } },
        assignedBy: { select: { id: true, displayName: true } },
      },
    }),
  ]);
  const page = activityPage(statusHistory, assignments, limit);
  return {
    items: page.items.map((record) => record.kind === 'status'
      ? { kind: record.kind, id: record.id, date: record.date, statusHistory: record.value }
      : { kind: record.kind, id: record.id, date: record.date, assignment: record.value }),
    nextCursor: page.nextCursor,
  };
}

export async function listStaffAssignees(actor: Actor, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.assign');
  const prisma = dependencies.prisma ?? getPrisma();
  return prisma.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE', ...(canReadGlobalStaffRequests(actor) ? {} : { id: actor.userId }) },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, displayName: true, email: true },
  });
}

function normalizeContactLookup(input: { email: string; phone?: string | null }): { emailNormalized: string; phone: string | null } {
  try {
    return { emailNormalized: normalizeQuoteRequestEmail(input.email), phone: input.phone ? normalizeQuoteRequestText(input.phone, 40) : null };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El contacto no es válido.', 400);
  }
}

export async function findStaffQuoteRequestMatches(actor: Actor, input: { email: string; phone?: string | null }, dependencies: StaffServiceDependencies = {}): Promise<StaffQuoteRequestContactMatch[]> {
  requireStaffPermission(actor, 'requests.create');
  const prisma = dependencies.prisma ?? getPrisma();
  const lookup = normalizeContactLookup(input);
  const select = { id: true, displayName: true, email: true, phone: true, roleTitle: true, client: { select: { id: true, displayName: true, status: true } } } as const;
  const emailMatches = await prisma.clientContact.findMany({
    where: {
      status: 'ACTIVE',
      client: { status: 'ACTIVE' },
      emailNormalized: lookup.emailNormalized,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10,
    select,
  });
  if (emailMatches.length > 0 || !lookup.phone) return emailMatches;
  return prisma.clientContact.findMany({
    where: { status: 'ACTIVE', client: { status: 'ACTIVE' }, phone: lookup.phone },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10,
    select,
  });
}

export async function createStaffQuoteRequest(actor: Actor, input: StaffCreateQuoteRequestInput, dependencies: StaffServiceDependencies = {}): Promise<QuoteRequestResult> {
  requireStaffPermission(actor, 'requests.create');
  const prisma = dependencies.prisma ?? getPrisma();
  const matches = await findStaffQuoteRequestMatches(actor, input.contact, { ...dependencies, prisma });
  const contactMatchId = input.contactMatchId ? requireUuid(input.contactMatchId, 'El contacto seleccionado no es válido.') : null;
  const selectedMatch = contactMatchId ? matches.find((match) => match.id === contactMatchId) : null;

  if (contactMatchId && !selectedMatch) throw new AppError('CONFLICT', 'El contacto seleccionado ya no está disponible. Vuelve a buscar coincidencias.', 409);
  if (selectedMatch && input.confirmNewContact) throw new AppError('VALIDATION_ERROR', 'Elige un contacto existente o confirma un cliente nuevo.', 400);
  if (!selectedMatch && matches.length > 0 && !input.confirmNewContact) throw new AppError('CONFLICT', 'Hay contactos coincidentes. Selecciona uno o confirma explícitamente un cliente nuevo.', 409);
  if (!selectedMatch && !input.confirmNewContact) throw new AppError('VALIDATION_ERROR', 'Confirma la creación de un cliente nuevo.', 400);

  return createQuoteRequest({
    idempotencyKey: input.idempotencyKey,
    origin: 'STAFF_CREATED',
    actorUserId: actor.userId,
    contact: input.contact,
    contactResolution: selectedMatch ? { type: 'existing', contactId: selectedMatch.id } : { type: 'new' },
    detail: { ...input.detail, consentAt: dependencies.now ?? new Date() },
  }, { prisma, now: dependencies.now });
}

export async function updateStaffQuoteRequest(actor: Actor, quoteRequestId: string, input: StaffUpdateQuoteRequestInput, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.edit');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const reason = normalizeReason(input.reason);
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockQuoteRequest(transaction, requestId);
    if (!locked) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    requireStaffRequestReadScope(actor, locked.currentAssigneeId);
    const existing = await transaction.quoteRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        folio: true,
        clientId: true,
        status: true,
        contact: { select: { id: true, displayName: true, email: true, emailNormalized: true, phone: true, roleTitle: true } },
        detail: { select: { projectType: true, location: true, projectStage: true, dimensions: true, timeline: true, budgetRange: true, description: true } },
      },
    });
    if (!existing || !existing.detail) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);

    const nextContact = {
      displayName: input.contact?.displayName === undefined ? existing.contact.displayName : normalizeEditableText(input.contact.displayName, 180, 'El nombre del contacto no es válido.'),
      email: input.contact?.email === undefined ? existing.contact.email : normalizeEditableEmail(input.contact.email),
      phone: input.contact?.phone === undefined ? existing.contact.phone : normalizeEditableNullableText(input.contact.phone, 40, 'El teléfono no es válido.'),
      roleTitle: input.contact?.roleTitle === undefined ? existing.contact.roleTitle : normalizeEditableNullableText(input.contact.roleTitle, 120, 'El cargo no es válido.'),
    };
    const nextContactNormalized = normalizeEditableEmail(nextContact.email);
    const nextDetail = {
      projectType: input.detail?.projectType === undefined ? existing.detail.projectType : normalizeEditableText(input.detail.projectType, 120, 'El tipo de proyecto no es válido.'),
      location: input.detail?.location === undefined ? existing.detail.location : normalizeEditableText(input.detail.location, 180, 'La ubicación no es válida.'),
      projectStage: input.detail?.projectStage === undefined ? existing.detail.projectStage : input.detail.projectStage,
      dimensions: input.detail?.dimensions === undefined ? existing.detail.dimensions : normalizeEditableNullableText(input.detail.dimensions, 500, 'Las dimensiones no son válidas.'),
      timeline: input.detail?.timeline === undefined ? existing.detail.timeline : input.detail.timeline,
      budgetRange: input.detail?.budgetRange === undefined ? existing.detail.budgetRange : input.detail.budgetRange,
      description: input.detail?.description === undefined ? existing.detail.description : normalizeEditableText(input.detail.description, 10_000, 'La descripción no es válida.'),
    };
    if (nextDetail.projectStage !== null && !(QUOTE_REQUEST_PROJECT_STAGES as readonly string[]).includes(nextDetail.projectStage)) throw new AppError('VALIDATION_ERROR', 'La etapa del proyecto no es válida.', 400);
    if (nextDetail.timeline !== null && !(QUOTE_REQUEST_TIMELINES as readonly string[]).includes(nextDetail.timeline)) throw new AppError('VALIDATION_ERROR', 'El horizonte no es válido.', 400);
    if (nextDetail.budgetRange !== null && !(QUOTE_REQUEST_BUDGET_RANGES as readonly string[]).includes(nextDetail.budgetRange)) throw new AppError('VALIDATION_ERROR', 'El presupuesto no es válido.', 400);

    const changedFields: string[] = [];
    if (nextContact.displayName !== existing.contact.displayName) changedFields.push('contact.displayName');
    if (nextContact.email !== existing.contact.email) changedFields.push('contact.email');
    if (nextContact.phone !== existing.contact.phone) changedFields.push('contact.phone');
    if (nextContact.roleTitle !== existing.contact.roleTitle) changedFields.push('contact.roleTitle');
    if (nextDetail.projectType !== existing.detail.projectType) changedFields.push('detail.projectType');
    if (nextDetail.location !== existing.detail.location) changedFields.push('detail.location');
    if (nextDetail.projectStage !== existing.detail.projectStage) changedFields.push('detail.projectStage');
    if (nextDetail.dimensions !== existing.detail.dimensions) changedFields.push('detail.dimensions');
    if (nextDetail.timeline !== existing.detail.timeline) changedFields.push('detail.timeline');
    if (nextDetail.budgetRange !== existing.detail.budgetRange) changedFields.push('detail.budgetRange');
    if (nextDetail.description !== existing.detail.description) changedFields.push('detail.description');
    if (changedFields.length === 0) throw new AppError('VALIDATION_ERROR', 'No hay cambios para guardar.', 400);

    if (nextContact.email !== existing.contact.email) {
      const duplicate = await transaction.clientContact.findFirst({
        where: { id: { not: existing.contact.id }, emailNormalized: nextContactNormalized, status: 'ACTIVE', client: { status: 'ACTIVE' } },
        select: { id: true },
      });
      if (duplicate) throw new AppError('CONFLICT', 'El correo ya pertenece a otro contacto activo. Revisa la coincidencia antes de guardar.', 409);
    }

    const sensitiveChange = changedFields.some((field) => field === 'contact.email' || field === 'contact.phone');
    if ((sensitiveChange || PUBLISHED_REQUEST_STATUSES.includes(existing.status)) && !reason) {
      throw new AppError('VALIDATION_ERROR', 'Indica un motivo para este cambio comercial.', 400);
    }

    await transaction.clientContact.update({ where: { id: existing.contact.id }, data: { displayName: nextContact.displayName, email: nextContact.email, emailNormalized: nextContactNormalized, phone: nextContact.phone, roleTitle: nextContact.roleTitle } });
    await transaction.quoteRequestDetail.update({ where: { quoteRequestId: requestId }, data: nextDetail });
    await transaction.quoteRequest.update({ where: { id: requestId }, data: { updatedAt: now } });

    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote_request.updated',
        entityType: 'quote_request',
        entityId: requestId,
        outcome: 'SUCCESS',
        metadata: {
          folio: existing.folio,
          changedFields,
          reasonProvided: Boolean(reason),
          before: { contact: safeContactSnapshot(existing.contact), detail: safeDetailSnapshot(existing.detail) },
          after: { contact: safeContactSnapshot(nextContact), detail: safeDetailSnapshot(nextDetail) },
        },
      },
    });

    return { quoteRequestId: requestId, folio: existing.folio, changedFields, updatedAt: now };
  });
}

function normalizeInformationInput(input: StaffRequestInformationInput): { message: string; idempotencyKey: string; missingFields: string[]; enablePortalAccess: boolean } {
  if (!input || typeof input.message !== 'string' || typeof input.idempotencyKey !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'La solicitud de información no es válida.', 400);
  }
  try {
    const message = normalizeMessageBody(input.message);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const missingFields = [...new Set(input.missingFields ?? [])];
    if (missingFields.length > QUOTE_REQUEST_INFORMATION_FIELDS.length || missingFields.some((field) => !(QUOTE_REQUEST_INFORMATION_FIELDS as readonly string[]).includes(field))) {
      throw new Error('Invalid missing fields.');
    }
    return { message, idempotencyKey, missingFields, enablePortalAccess: input.enablePortalAccess === true };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'La solicitud de información no es válida.', 400);
  }
}

export async function requestInformationQuoteRequest(actor: Actor, quoteRequestId: string, input: StaffRequestInformationInput, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.status.update');
  requirePermission(actor, 'messaging.send');
  const normalized = normalizeInformationInput(input);
  if (normalized.enablePortalAccess) requireStaffPermission(actor, 'customer.portal.invite');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    if (request.status === 'INFORMACION_REQUERIDA') {
      const existingMessage = await sendStaffMessageInTransaction(transaction, actor, request, { body: normalized.message, idempotencyKey: normalized.idempotencyKey }, now);
      if (!existingMessage.idempotent) throw new AppError('CONFLICT', 'La solicitud ya está esperando información. Regresa a revisión para enviar una nueva solicitud.', 409);
      if (existingMessage.body !== normalized.message) throw new AppError('CONFLICT', 'La clave de idempotencia ya fue utilizada para otro mensaje.', 409);
      return {
        quoteRequestId: request.id,
        folio: request.folio,
        status: 'ALREADY_REQUESTED' as const,
        fromStatus: request.status,
        toStatus: request.status,
        messageId: existingMessage.id,
        conversationId: existingMessage.conversation.id,
        portalAccess: null as CustomerAccessResult | null,
      };
    }
    if (!['EN_REVISION', 'EN_ELABORACION'].includes(request.status)) {
      throw new AppError('CONFLICT', 'La solicitud sólo puede esperar información durante revisión o elaboración.', 409);
    }

    const message = await sendStaffMessageInTransaction(transaction, actor, request, { body: normalized.message, idempotencyKey: normalized.idempotencyKey }, now);
    if (message.idempotent) {
      if (message.body !== normalized.message) throw new AppError('CONFLICT', 'La clave de idempotencia ya fue utilizada para otro mensaje.', 409);
      throw new AppError('CONFLICT', 'La solicitud de información ya fue procesada. Recarga el expediente.', 409);
    }
    const portalAccess = normalized.enablePortalAccess
      ? await inviteCustomerPortalAccessInTransaction(actor, transaction, request.id, { ...dependencies, now })
      : null;
    await transaction.quoteRequest.update({ where: { id: request.id }, data: { status: 'INFORMACION_REQUERIDA', updatedAt: now } });
    await transaction.requestStatusHistory.create({
      data: { quoteRequestId: request.id, fromStatus: request.status, toStatus: 'INFORMACION_REQUERIDA', changedById: actor.userId, reason: 'Se solicitó información al cliente.', createdAt: now },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote_request.information_requested',
        entityType: 'quote_request',
        entityId: request.id,
        outcome: 'SUCCESS',
        metadata: {
          folio: request.folio,
          fromStatus: request.status,
          toStatus: 'INFORMACION_REQUERIDA',
          missingFields: normalized.missingFields,
          messageId: message.id,
          portalAccessStatus: portalAccess?.status ?? 'NOT_REQUESTED',
        },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'REQUEST.STATUS_CHANGED',
        aggregateType: 'QUOTE_REQUEST',
        aggregateId: request.id,
        payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus: 'INFORMACION_REQUERIDA', source: 'request_information', messageId: message.id },
      },
    });
    return {
      quoteRequestId: request.id,
      folio: request.folio,
      status: 'REQUESTED' as const,
      fromStatus: request.status,
      toStatus: 'INFORMACION_REQUERIDA' as const,
      messageId: message.id,
      conversationId: message.conversation.id,
      portalAccess,
    };
  });
}

export async function assignQuoteRequest(actor: Actor, quoteRequestId: string, input: { assignedToId: string; reason?: string }, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.assign');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const assignedToId = requireUuid(input.assignedToId, 'El responsable no es válido.');
  assertStaffAssigneeTargetScope(actor, assignedToId);
  const reason = normalizeReason(input.reason);
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const assignee = await transaction.user.findUnique({ where: { id: assignedToId }, select: { id: true, type: true, status: true } });
    if (!assignee || assignee.type !== 'EMPLOYEE' || assignee.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_ERROR', 'El responsable no está disponible.', 400);
    }
    if (request.currentAssigneeId === assignedToId) {
      return { quoteRequestId: request.id, folio: request.folio, currentAssigneeId: assignedToId };
    }
    if (request.currentAssigneeId !== null) {
      requireStaffPermission(actor, 'requests.reassign');
      if (!reason) throw new AppError('VALIDATION_ERROR', 'Indica un motivo para reasignar una solicitud activa.', 400);
    }

    await transaction.requestAssignment.updateMany({
      where: { quoteRequestId: request.id, unassignedAt: null },
      data: { unassignedAt: now },
    });
    await transaction.requestAssignment.create({
      data: { quoteRequestId: request.id, assignedToId, assignedById: actor.userId, reason, assignedAt: now },
    });
    await transaction.quoteRequest.update({ where: { id: request.id }, data: { currentAssigneeId: assignedToId } });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote_request.assigned',
        entityType: 'quote_request',
        entityId: request.id,
        outcome: 'SUCCESS',
        metadata: { folio: request.folio, assignedToId },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'REQUEST.ASSIGNED',
        aggregateType: 'QUOTE_REQUEST',
        aggregateId: request.id,
        payload: { quoteRequestId: request.id, folio: request.folio, assignedToId },
      },
    });
    return { quoteRequestId: request.id, folio: request.folio, currentAssigneeId: assignedToId, assignedAt: now };
  });
}

export async function takeQuoteRequest(actor: Actor, quoteRequestId: string, input: { reason?: string } = {}, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.claim');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const reason = normalizeReason(input.reason);
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    if (request.currentAssigneeId === actor.userId) return { quoteRequestId: request.id, folio: request.folio, currentAssigneeId: actor.userId, status: 'ALREADY_TAKEN' as const };
    if (request.currentAssigneeId !== null) throw new AppError('CONFLICT', 'La solicitud ya está tomada por otro responsable.', 409);

    await transaction.requestAssignment.create({
      data: { quoteRequestId: request.id, assignedToId: actor.userId, assignedById: actor.userId, reason, assignedAt: now },
    });
    await transaction.quoteRequest.update({ where: { id: request.id }, data: { currentAssigneeId: actor.userId } });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote_request.assigned',
        entityType: 'quote_request',
        entityId: request.id,
        outcome: 'SUCCESS',
        metadata: { folio: request.folio, assignedToId: actor.userId, mode: 'take' },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'REQUEST.ASSIGNED',
        aggregateType: 'QUOTE_REQUEST',
        aggregateId: request.id,
        payload: { quoteRequestId: request.id, folio: request.folio, assignedToId: actor.userId, mode: 'take' },
      },
    });
    return { quoteRequestId: request.id, folio: request.folio, currentAssigneeId: actor.userId, status: 'TAKEN' as const, assignedAt: now };
  });
}

export async function markInformationReviewedQuoteRequest(actor: Actor, quoteRequestId: string, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.status.update');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    if (request.status !== 'INFORMACION_REQUERIDA') {
      throw new AppError('CONFLICT', 'La solicitud no está esperando información del cliente.', 409);
    }
    const lastCustomerVisibleMessage = await transaction.conversationMessage.findFirst({
      where: { conversation: { quoteRequestId: request.id }, visibility: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      select: { sender: { select: { type: true } } },
    });
    if (lastCustomerVisibleMessage?.sender?.type !== 'CUSTOMER') {
      throw new AppError('CONFLICT', 'Todavía no hay una respuesta del cliente para revisar.', 409);
    }

    await transaction.quoteRequest.update({ where: { id: request.id }, data: { status: 'EN_REVISION' } });
    await transaction.requestStatusHistory.create({
      data: { quoteRequestId: request.id, fromStatus: 'INFORMACION_REQUERIDA', toStatus: 'EN_REVISION', changedById: actor.userId, reason: 'Se revisó la respuesta del cliente.', createdAt: now },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote_request.customer_response_reviewed',
        entityType: 'quote_request',
        entityId: request.id,
        outcome: 'SUCCESS',
        metadata: { folio: request.folio, fromStatus: 'INFORMACION_REQUERIDA', toStatus: 'EN_REVISION' },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'REQUEST.CUSTOMER_RESPONSE',
        aggregateType: 'QUOTE_REQUEST',
        aggregateId: request.id,
        payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: 'INFORMACION_REQUERIDA', toStatus: 'EN_REVISION' },
      },
    });
    return { quoteRequestId: request.id, folio: request.folio, fromStatus: 'INFORMACION_REQUERIDA' as const, toStatus: 'EN_REVISION' as const, changedAt: now };
  });
}

export async function transitionQuoteRequest(actor: Actor, quoteRequestId: string, input: { toStatus: QuoteRequestStatus; reason?: string }, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.status.update');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  if (!isQuoteRequestStatus(input.toStatus)) throw new AppError('VALIDATION_ERROR', 'El estado no es válido.', 400);
  if (input.toStatus === 'INFORMACION_REQUERIDA') throw new AppError('VALIDATION_ERROR', 'Usa Solicitar información para registrar el mensaje y el siguiente paso del cliente.', 400);
  const reason = normalizeReason(input.reason);
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    if (!canStaffTransitionQuoteRequest(request.status, input.toStatus)) {
      throw new AppError('CONFLICT', 'La transición de estado no está permitida.', 409);
    }
    await transaction.quoteRequest.update({ where: { id: request.id }, data: { status: input.toStatus } });
    await transaction.requestStatusHistory.create({
      data: { quoteRequestId: request.id, fromStatus: request.status, toStatus: input.toStatus, changedById: actor.userId, reason, createdAt: now },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote_request.status_changed',
        entityType: 'quote_request',
        entityId: request.id,
        outcome: 'SUCCESS',
        metadata: { folio: request.folio, fromStatus: request.status, toStatus: input.toStatus },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'REQUEST.STATUS_CHANGED',
        aggregateType: 'QUOTE_REQUEST',
        aggregateId: request.id,
        payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus: input.toStatus },
      },
    });
    return { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus: input.toStatus, changedAt: now };
  });
}
