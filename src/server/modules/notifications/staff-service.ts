import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { getNotificationOperationalHealth } from '@/server/modules/notifications/operations';
import { NOTIFICATION_DELIVERY_STATUSES, type NotificationDeliveryStatus } from '@/server/modules/notifications/domain';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const RECOVERABLE_ERROR_CODES = ['TEMPORARY_PROVIDER', 'RATE_LIMIT'] as const;
type RecoverableNotificationErrorCode = (typeof RECOVERABLE_ERROR_CODES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type StaffNotificationListFilters = {
  status?: NotificationDeliveryStatus;
  page?: number;
  pageSize?: number;
};

export type StaffNotificationServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
};

export type StaffNotificationProjection = {
  id: string;
  channel: string;
  status: NotificationDeliveryStatus;
  templateKey: string;
  templateVersion: string;
  attempts: number;
  availableAt: Date;
  processingStartedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  errorCategory: string | null;
  cancelReason: string | null;
  ageSeconds: number;
  retryable: boolean;
  eventType: string;
  aggregateType: string;
};

export type StaffNotificationListResult = {
  items: StaffNotificationProjection[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  health: Awaited<ReturnType<typeof getNotificationOperationalHealth>>;
};

export type StaffNotificationRetryResult = {
  outcome: 'REQUEUED' | 'ALREADY_PENDING';
  delivery: StaffNotificationProjection;
};

function requireStaffPermission(actor: Actor, permission: string): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, permission);
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', 'La notificación no es válida.', 400);
  return value;
}

function normalizeFilters(filters: StaffNotificationListFilters): { status?: NotificationDeliveryStatus; page: number; pageSize: number } {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new AppError('VALIDATION_ERROR', 'La paginación no es válida.', 400);
  }
  if (filters.status && !(NOTIFICATION_DELIVERY_STATUSES as readonly string[]).includes(filters.status)) {
    throw new AppError('VALIDATION_ERROR', 'El estado de notificación no es válido.', 400);
  }
  return { status: filters.status, page, pageSize };
}

function isRecoverableErrorCode(value: string | null): value is RecoverableNotificationErrorCode {
  return value !== null && (RECOVERABLE_ERROR_CODES as readonly string[]).includes(value);
}

function safeErrorCategory(value: string | null): string | null {
  if (!value) return null;
  if (isRecoverableErrorCode(value)) return value;
  if (value === 'INVALID_RECIPIENT' || value === 'TEMPLATE_ERROR' || value === 'CONFIGURATION') return value;
  return 'OTHER';
}

type StaffNotificationRow = {
  id: string;
  channel: string;
  status: NotificationDeliveryStatus;
  templateKey: string;
  templateVersion: string;
  attempts: number;
  availableAt: Date;
  processingStartedAt: Date | null;
  processedAt: Date | null;
  lastErrorCode: string | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  outboxEvent: { eventType: string; aggregateType: string };
};

function toProjection(row: StaffNotificationRow, now: Date): StaffNotificationProjection {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    attempts: row.attempts,
    availableAt: row.availableAt,
    processingStartedAt: row.processingStartedAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    errorCategory: safeErrorCategory(row.lastErrorCode),
    cancelReason: row.cancelReason,
    ageSeconds: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 1000)),
    retryable: row.status === 'FAILED' && isRecoverableErrorCode(row.lastErrorCode),
    eventType: row.outboxEvent.eventType,
    aggregateType: row.outboxEvent.aggregateType,
  };
}

const projectionSelect = {
  id: true,
  channel: true,
  status: true,
  templateKey: true,
  templateVersion: true,
  attempts: true,
  availableAt: true,
  processingStartedAt: true,
  processedAt: true,
  lastErrorCode: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  outboxEvent: { select: { eventType: true, aggregateType: true } },
} as const;

export async function listStaffNotificationDeliveries(
  actor: Actor,
  filters: StaffNotificationListFilters = {},
  dependencies: StaffNotificationServiceDependencies = {},
): Promise<StaffNotificationListResult> {
  requireStaffPermission(actor, 'notifications.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha de operación no es válida.', 400);
  const normalized = normalizeFilters(filters);
  const where = { status: normalized.status };
  const [total, rows, health] = await Promise.all([
    prisma.notificationDelivery.count({ where }),
    prisma.notificationDelivery.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (normalized.page - 1) * normalized.pageSize,
      take: normalized.pageSize,
      select: projectionSelect,
    }),
    getNotificationOperationalHealth(prisma),
  ]);
  return {
    items: rows.map((row) => toProjection(row as unknown as StaffNotificationRow, now)),
    page: normalized.page,
    pageSize: normalized.pageSize,
    total,
    totalPages: Math.ceil(total / normalized.pageSize),
    health,
  };
}

export async function retryStaffNotificationDelivery(
  actor: Actor,
  deliveryId: string,
  dependencies: StaffNotificationServiceDependencies = {},
): Promise<StaffNotificationRetryResult> {
  requireStaffPermission(actor, 'notifications.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(deliveryId);
  const now = dependencies.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new AppError('VALIDATION_ERROR', 'La fecha de operación no es válida.', 400);

  return prisma.$transaction(async (transaction) => {
    const current = await transaction.notificationDelivery.findUnique({ where: { id }, select: projectionSelect }) as unknown as StaffNotificationRow | null;
    if (!current) throw new AppError('NOT_FOUND', 'La notificación no existe.', 404);

    if (current.status === 'PENDING') {
      return { outcome: 'ALREADY_PENDING' as const, delivery: toProjection(current, now) };
    }
    if (current.status !== 'FAILED') {
      throw new AppError('CONFLICT', 'Sólo se pueden reintentar entregas fallidas.', 409);
    }
    if (!isRecoverableErrorCode(current.lastErrorCode)) {
      throw new AppError('CONFLICT', 'La entrega falló por una causa que no admite reintento manual.', 409);
    }

    const changed = await transaction.notificationDelivery.updateMany({
      where: { id, status: 'FAILED', lastErrorCode: { in: [...RECOVERABLE_ERROR_CODES] } },
      data: {
        status: 'PENDING',
        attempts: 0,
        availableAt: now,
        processingStartedAt: null,
        processedAt: null,
        lastErrorCode: null,
        providerMessageId: null,
        updatedAt: now,
      },
    });

    if (changed.count !== 1) {
      const after = await transaction.notificationDelivery.findUnique({ where: { id }, select: projectionSelect }) as unknown as StaffNotificationRow | null;
      if (after?.status === 'PENDING') return { outcome: 'ALREADY_PENDING' as const, delivery: toProjection(after, now) };
      throw new AppError('CONFLICT', 'La entrega cambió mientras se procesaba el reintento.', 409);
    }

    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'notification.retry',
        entityType: 'notification_delivery',
        entityId: id,
        outcome: 'SUCCESS',
        metadata: {
          previousStatus: 'FAILED',
          previousErrorCode: current.lastErrorCode,
          templateKey: current.templateKey,
          eventType: current.outboxEvent.eventType,
        },
      },
    });

    const updated = await transaction.notificationDelivery.findUnique({ where: { id }, select: projectionSelect }) as unknown as StaffNotificationRow | null;
    if (!updated) throw new AppError('INTERNAL_ERROR', 'No se pudo confirmar el reintento.', 500);
    return { outcome: 'REQUEUED' as const, delivery: toProjection(updated, now) };
  });
}
