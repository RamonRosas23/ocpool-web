import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { hasPermission, requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import {
  canStaffTransitionQuoteRequest,
  normalizeQuoteRequestText,
  type QuoteRequestStatus,
  QUOTE_REQUEST_STATUSES,
} from '@/server/modules/quote-requests/domain';

export type StaffQuoteRequestListFilters = {
  status?: QuoteRequestStatus;
  assignedToId?: string;
  query?: string;
  createdFrom?: Date;
  createdTo?: Date;
  page?: number;
  pageSize?: number;
};

export type StaffServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const QUOTE_BUILDER_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'];

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
  if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) throw new AppError('VALIDATION_ERROR', 'El rango de fechas no es válido.', 400);
  return { ...filters, query, ...pagination };
}

async function lockQuoteRequest(transaction: Prisma.TransactionClient, quoteRequestId: string): Promise<{ id: string; folio: string; status: QuoteRequestStatus; currentAssigneeId: string | null } | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string; folio: string; status: QuoteRequestStatus; currentAssigneeId: string | null }>>(Prisma.sql`
    SELECT "id", "folio", "status", "currentAssigneeId"
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

function projectAvailableActions(actor: Actor, status: QuoteRequestStatus) {
  const availableStatusTransitions = hasPermission(actor, 'requests.status.update')
    ? QUOTE_REQUEST_STATUSES.filter((candidate) => canStaffTransitionQuoteRequest(status, candidate))
    : [];
  const availableActions = availableStatusTransitions.map((candidate) => `request.status:${candidate}`);
  if (hasPermission(actor, 'quotes.create') && QUOTE_BUILDER_REQUEST_STATUSES.includes(status)) {
    availableActions.push('quote.open');
  }
  return { availableStatusTransitions, availableActions };
}

export async function listStaffQuoteRequests(actor: Actor, filters: StaffQuoteRequestListFilters = {}, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const normalized = normalizeFilters(filters);
  const where: Prisma.QuoteRequestWhereInput = {
    status: normalized.status,
    currentAssigneeId: normalized.assignedToId,
    createdAt: normalized.createdFrom || normalized.createdTo ? { gte: normalized.createdFrom, lte: normalized.createdTo } : undefined,
    ...(normalized.query ? {
      OR: [
        { folio: { contains: normalized.query, mode: 'insensitive' } },
        { client: { displayName: { contains: normalized.query, mode: 'insensitive' } } },
        { contact: { displayName: { contains: normalized.query, mode: 'insensitive' } } },
        { contact: { emailNormalized: { contains: normalized.query.toLowerCase(), mode: 'insensitive' } } },
      ],
    } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.quoteRequest.count({ where }),
    prisma.quoteRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        orderBy: { assignedAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
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
  return { ...request, detail: serializeDetail(request.detail), ...projectAvailableActions(actor, request.status) };
}

export async function listStaffAssignees(actor: Actor, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.assign');
  const prisma = dependencies.prisma ?? getPrisma();
  return prisma.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE' },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, displayName: true, email: true },
  });
}

export async function assignQuoteRequest(actor: Actor, quoteRequestId: string, input: { assignedToId: string; reason?: string }, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.assign');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const assignedToId = requireUuid(input.assignedToId, 'El responsable no es válido.');
  const reason = normalizeReason(input.reason);
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    const assignee = await transaction.user.findUnique({ where: { id: assignedToId }, select: { id: true, type: true, status: true } });
    if (!assignee || assignee.type !== 'EMPLOYEE' || assignee.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_ERROR', 'El responsable no está disponible.', 400);
    }
    if (request.currentAssigneeId === assignedToId) {
      return { quoteRequestId: request.id, folio: request.folio, currentAssigneeId: assignedToId };
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

export async function transitionQuoteRequest(actor: Actor, quoteRequestId: string, input: { toStatus: QuoteRequestStatus; reason?: string }, dependencies: StaffServiceDependencies = {}) {
  requireStaffPermission(actor, 'requests.status.update');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  if (!isQuoteRequestStatus(input.toStatus)) throw new AppError('VALIDATION_ERROR', 'El estado no es válido.', 400);
  const reason = normalizeReason(input.reason);
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, requestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
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
