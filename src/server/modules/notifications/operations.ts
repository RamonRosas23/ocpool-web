import type { PrismaClient } from '@/generated/prisma/client';
import type { NotificationDeliveryStatus } from '@/server/modules/notifications/domain';

export type LatestAggregateDelivery = {
  status: NotificationDeliveryStatus;
  lastErrorCode: string | null;
  updatedAt: Date;
} | null;

export async function getLatestAggregateNotificationDelivery(prisma: PrismaClient, aggregateType: string, aggregateId: string): Promise<LatestAggregateDelivery> {
  const delivery = await prisma.notificationDelivery.findFirst({
    where: { outboxEvent: { aggregateType, aggregateId } },
    orderBy: [{ createdAt: 'desc' }],
    select: { status: true, lastErrorCode: true, updatedAt: true },
  });
  return delivery ?? null;
}

export type NotificationOperationalHealth = {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  cancelled: number;
  oldestPendingAt: Date | null;
  oldestProcessingAt: Date | null;
  oldestFailedAt: Date | null;
};

export async function getNotificationOperationalHealth(prisma: PrismaClient): Promise<NotificationOperationalHealth> {
  const [pending, processing, sent, failed, cancelled, oldestPending, oldestProcessing, oldestFailed] = await Promise.all([
    prisma.notificationDelivery.count({ where: { status: 'PENDING' } }),
    prisma.notificationDelivery.count({ where: { status: 'PROCESSING' } }),
    prisma.notificationDelivery.count({ where: { status: 'SENT' } }),
    prisma.notificationDelivery.count({ where: { status: 'FAILED' } }),
    prisma.notificationDelivery.count({ where: { status: 'CANCELLED' } }),
    prisma.notificationDelivery.findFirst({ where: { status: 'PENDING' }, orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }], select: { availableAt: true } }),
    prisma.notificationDelivery.findFirst({ where: { status: 'PROCESSING' }, orderBy: [{ processingStartedAt: 'asc' }, { createdAt: 'asc' }], select: { processingStartedAt: true } }),
    prisma.notificationDelivery.findFirst({ where: { status: 'FAILED' }, orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }], select: { updatedAt: true } }),
  ]);

  return {
    pending,
    processing,
    sent,
    failed,
    cancelled,
    oldestPendingAt: oldestPending?.availableAt ?? null,
    oldestProcessingAt: oldestProcessing?.processingStartedAt ?? null,
    oldestFailedAt: oldestFailed?.updatedAt ?? null,
  };
}
