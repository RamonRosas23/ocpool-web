import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { readServerEnv } from '@/server/env';
import { encryptNotificationRecipient } from '@/server/modules/notifications/recipient-crypto';
import { normalizeNotificationEmail, notificationRecipientHash } from '@/server/modules/notifications/domain';
import type { NotificationTemplateKey, NotificationTemplateVersion } from '@/server/modules/notifications/templates';

type DbClient = PrismaClient;

export type NotificationDeliveryInput = Readonly<{
  outboxEventId: string;
  recipientUserId: string | null;
  recipientEmail: string;
  templateKey: NotificationTemplateKey;
  templateVersion: NotificationTemplateVersion;
  subjectSnapshot?: string | null;
  safePayload: Record<string, string | number>;
}>;

export type ClaimNotificationOptions = Readonly<{
  now?: Date;
  batchSize: number;
  leaseSeconds: number;
}>;

export type ClaimedNotificationDelivery = {
  id: string;
  outboxEventId: string;
  recipientUserId: string | null;
  recipientAddressCiphertext: string | null;
  recipientAddressHash: string | null;
  templateKey: NotificationTemplateKey;
  templateVersion: NotificationTemplateVersion;
  subjectSnapshot: string | null;
  payload: Record<string, unknown> | null;
  status: 'PROCESSING';
  attempts: number;
  availableAt: Date;
  processingStartedAt: Date;
  processedAt: Date | null;
  lastErrorCode: string | null;
  cancelReason: string | null;
  providerMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  outboxEvent: {
    eventType: string;
    aggregateType: string;
    aggregateId: string | null;
    payload: Record<string, unknown>;
  };
};

type ClaimedRow = Omit<ClaimedNotificationDelivery, 'outboxEvent' | 'payload'> & { payload: Record<string, unknown> | null };

function assertClaimOptions(options: ClaimNotificationOptions): void {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('Invalid notification batch size.');
  if (!Number.isInteger(options.leaseSeconds) || options.leaseSeconds < 5 || options.leaseSeconds > 3600) throw new Error('Invalid notification lease.');
  if (options.now && Number.isNaN(options.now.getTime())) throw new Error('Invalid notification time.');
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function upsertNotificationDelivery(prisma: DbClient, input: NotificationDeliveryInput): Promise<{ id: string; status: string; attempts: number }> {
  const normalizedEmail = normalizeNotificationEmail(input.recipientEmail);
  const recipientAddressHash = notificationRecipientHash(normalizedEmail);
  const encryptionKey = readServerEnv().NOTIFICATION_RECIPIENT_ENCRYPTION_KEY;
  const recipientAddressCiphertext = encryptNotificationRecipient(normalizedEmail, encryptionKey);

  return prisma.notificationDelivery.upsert({
    where: {
      outboxEventId_channel_recipientAddressHash_templateKey_templateVersion: {
        outboxEventId: input.outboxEventId,
        channel: 'EMAIL',
        recipientAddressHash,
        templateKey: input.templateKey,
        templateVersion: input.templateVersion,
      },
    },
    update: {},
    create: {
      outboxEventId: input.outboxEventId,
      channel: 'EMAIL',
      recipientUserId: input.recipientUserId,
      recipientAddressCiphertext,
      recipientAddressHash,
      templateKey: input.templateKey,
      templateVersion: input.templateVersion,
      subjectSnapshot: input.subjectSnapshot ?? null,
      payload: input.safePayload,
    },
    select: { id: true, status: true, attempts: true },
  });
}

export type NotificationCancellationReason = 'UNSUPPORTED_EVENT' | 'INVALID_PAYLOAD' | 'INVALID_RECIPIENT' | 'INVALID_RECIPIENT_SCOPE' | 'INTERNAL_VISIBILITY' | 'NO_RECIPIENT';

export async function cancelNotificationDelivery(prisma: DbClient, input: { outboxEventId: string; reason: NotificationCancellationReason; now?: Date }): Promise<{ id: string; status: string }> {
  const now = input.now ?? new Date();
  const cancellationHash = fingerprintToken(`notification-cancel:${input.outboxEventId}:${input.reason}`);
  return prisma.notificationDelivery.upsert({
    where: {
      outboxEventId_channel_recipientAddressHash_templateKey_templateVersion: {
        outboxEventId: input.outboxEventId,
        channel: 'EMAIL',
        recipientAddressHash: cancellationHash,
        templateKey: 'system.cancelled',
        templateVersion: 'v1',
      },
    },
    update: { status: 'CANCELLED', processedAt: now, cancelReason: input.reason, updatedAt: now },
    create: {
      outboxEventId: input.outboxEventId,
      channel: 'EMAIL',
      recipientAddressHash: cancellationHash,
      templateKey: 'system.cancelled',
      templateVersion: 'v1',
      status: 'CANCELLED',
      processedAt: now,
      cancelReason: input.reason,
      payload: { reason: input.reason },
    },
    select: { id: true, status: true },
  });
}

export async function claimNotificationDeliveries(prisma: DbClient, options: ClaimNotificationOptions): Promise<ClaimedNotificationDelivery[]> {
  assertClaimOptions(options);
  const now = options.now ?? new Date();
  const leaseCutoff = new Date(now.getTime() - (options.leaseSeconds * 1000));

  return prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "notification_deliveries"
        WHERE (
          "status" = 'PENDING'::"NotificationDeliveryStatus"
          AND "availableAt" <= ${now}
        ) OR (
          "status" = 'PROCESSING'::"NotificationDeliveryStatus"
          AND "processingStartedAt" IS NOT NULL
          AND "processingStartedAt" <= ${leaseCutoff}
        )
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${options.batchSize}
      )
      UPDATE "notification_deliveries" AS delivery
      SET
        "status" = 'PROCESSING'::"NotificationDeliveryStatus",
        "attempts" = delivery."attempts" + 1,
        "processingStartedAt" = ${now},
        "processedAt" = NULL,
        "availableAt" = ${now},
        "updatedAt" = ${now}
      FROM candidates
      WHERE delivery."id" = candidates."id"
      RETURNING delivery.*
    `);
    if (rows.length === 0) return [];

    const loaded = await transaction.notificationDelivery.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { outboxEvent: { select: { eventType: true, aggregateType: true, aggregateId: true, payload: true } } },
    });
    const byId = new Map(loaded.map((delivery) => [delivery.id, delivery]));
    return rows.flatMap((row) => {
      const delivery = byId.get(row.id);
      if (!delivery || delivery.status !== 'PROCESSING' || !delivery.processingStartedAt) return [];
      return [{
        id: delivery.id,
        outboxEventId: delivery.outboxEventId,
        recipientUserId: delivery.recipientUserId,
        recipientAddressCiphertext: delivery.recipientAddressCiphertext,
        recipientAddressHash: delivery.recipientAddressHash,
        templateKey: delivery.templateKey as NotificationTemplateKey,
        templateVersion: delivery.templateVersion as NotificationTemplateVersion,
        subjectSnapshot: delivery.subjectSnapshot,
        payload: asJsonRecord(delivery.payload),
        status: 'PROCESSING' as const,
        attempts: delivery.attempts,
        availableAt: delivery.availableAt,
        processingStartedAt: delivery.processingStartedAt,
        processedAt: delivery.processedAt,
        lastErrorCode: delivery.lastErrorCode,
        cancelReason: delivery.cancelReason,
        providerMessageId: delivery.providerMessageId,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        outboxEvent: {
          eventType: delivery.outboxEvent.eventType,
          aggregateType: delivery.outboxEvent.aggregateType,
          aggregateId: delivery.outboxEvent.aggregateId,
          payload: asJsonRecord(delivery.outboxEvent.payload) ?? {},
        },
      }];
    });
  });
}

export async function markNotificationSent(prisma: DbClient, deliveryId: string, processingStartedAt: Date, now: Date, providerMessageId: string | null): Promise<boolean> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, status: 'PROCESSING', processingStartedAt },
    data: { status: 'SENT', processedAt: now, processingStartedAt: null, providerMessageId, lastErrorCode: null, updatedAt: now },
  });
  return result.count === 1;
}

export async function markNotificationFailure(prisma: DbClient, deliveryId: string, processingStartedAt: Date, now: Date, input: { code: string; retryable: boolean; retryAt: Date; attempts: number; maxAttempts: number }): Promise<'PENDING' | 'FAILED' | null> {
  const nextStatus = input.retryable && input.attempts < input.maxAttempts ? 'PENDING' : 'FAILED';
  const result = await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, status: 'PROCESSING', processingStartedAt },
    data: {
      status: nextStatus,
      availableAt: input.retryAt,
      processingStartedAt: null,
      processedAt: null,
      lastErrorCode: input.code,
      updatedAt: now,
    },
  });
  if (result.count !== 1) return null;
  return nextStatus;
}
