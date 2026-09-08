import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { calculateNotificationRetryAt } from '@/server/modules/notifications/domain';
import { cancelNotificationDelivery, upsertNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import { resolveNotificationEvent } from '@/server/modules/notifications/event-resolver';
import { mapNotificationEvent, SUPPORTED_NOTIFICATION_EVENT_TYPES, type NotificationEventInput } from '@/server/modules/notifications/templates';

type DbClient = PrismaClient;

export type ClaimNotificationOutboxOptions = Readonly<{
  now?: Date;
  batchSize: number;
  leaseSeconds: number;
}>;

export type ClaimedNotificationOutbox = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
};

export type NotificationFanoutBatchResult = {
  claimed: number;
  materialized: number;
  cancelled: number;
  failed: number;
};

function assertOptions(options: ClaimNotificationOutboxOptions): void {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('Invalid notification outbox batch size.');
  if (!Number.isInteger(options.leaseSeconds) || options.leaseSeconds < 5 || options.leaseSeconds > 3600) throw new Error('Invalid notification outbox lease.');
  if (options.now && Number.isNaN(options.now.getTime())) throw new Error('Invalid notification outbox time.');
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function claimNotificationOutboxEvents(prisma: DbClient, options: ClaimNotificationOutboxOptions): Promise<ClaimedNotificationOutbox[]> {
  assertOptions(options);
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseSeconds * 1000));
  return prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{
      id: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string | null;
      payload: unknown;
      attempts: number;
      availableAt: Date;
      createdAt: Date;
    }>>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "outbox_events"
        WHERE "eventType" IN (${Prisma.join([...SUPPORTED_NOTIFICATION_EVENT_TYPES])})
          AND (
            ("status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= ${now})
            OR ("status" = 'PROCESSING'::"OutboxStatus" AND "availableAt" <= ${now})
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${options.batchSize}
      )
      UPDATE "outbox_events" AS event
      SET
        "status" = 'PROCESSING'::"OutboxStatus",
        "attempts" = event."attempts" + 1,
        "availableAt" = ${leaseUntil},
        "processedAt" = NULL,
        "lastError" = NULL
      FROM candidates
      WHERE event."id" = candidates."id"
      RETURNING event.*
    `);
    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      payload: jsonRecord(row.payload),
      attempts: row.attempts,
      availableAt: row.availableAt,
      createdAt: row.createdAt,
    }));
  });
}

export async function markNotificationOutboxSent(prisma: DbClient, eventId: string, leaseUntil: Date, now = new Date()): Promise<boolean> {
  const result = await prisma.outboxEvent.updateMany({ where: { id: eventId, status: 'PROCESSING', availableAt: leaseUntil }, data: { status: 'SENT', processedAt: now, availableAt: now, lastError: null } });
  return result.count === 1;
}

export async function markNotificationOutboxFailed(prisma: DbClient, eventId: string, leaseUntil: Date, now: Date, attempts: number): Promise<boolean> {
  const retryAt = calculateNotificationRetryAt(now, Math.max(1, attempts));
  const result = await prisma.outboxEvent.updateMany({ where: { id: eventId, status: 'PROCESSING', availableAt: leaseUntil }, data: { status: 'FAILED', processedAt: null, availableAt: retryAt, lastError: 'NOTIFICATION_FANOUT_FAILED' } });
  return result.count === 1;
}

export async function fanOutNotificationEvent(prisma: DbClient, event: ClaimedNotificationOutbox, leaseUntil: Date, now = new Date()): Promise<{ materialized: number; cancelled: boolean }> {
  const eventInput: NotificationEventInput = {
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
  };
  const resolution = await resolveNotificationEvent(prisma, eventInput);
  if (resolution.kind === 'CANCELLED') {
    await cancelNotificationDelivery(prisma, { outboxEventId: event.id, reason: resolution.reason, now });
    await markNotificationOutboxSent(prisma, event.id, leaseUntil, now);
    return { materialized: 0, cancelled: true };
  }

  const intents = resolution.contexts.map((context) => mapNotificationEvent(eventInput, context));
  if (intents.some((intent) => intent.kind !== 'INTENT')) {
    const rejected = intents.find((intent) => intent.kind !== 'INTENT');
    const reason = rejected?.kind === 'REJECTED' ? rejected.reason : 'UNSUPPORTED_EVENT';
    await cancelNotificationDelivery(prisma, { outboxEventId: event.id, reason, now });
    await markNotificationOutboxSent(prisma, event.id, leaseUntil, now);
    return { materialized: 0, cancelled: true };
  }

  for (const intent of intents) {
    if (intent.kind !== 'INTENT') continue;
    await upsertNotificationDelivery(prisma, {
      outboxEventId: event.id,
      recipientUserId: intent.recipient.userId,
      recipientEmail: intent.recipient.email,
      templateKey: intent.templateKey,
      templateVersion: intent.templateVersion,
      safePayload: intent.safePayload,
    });
  }
  await markNotificationOutboxSent(prisma, event.id, leaseUntil, now);
  return { materialized: intents.length, cancelled: false };
}

export type ProcessNotificationFanoutBatchInput = Readonly<{
  prisma: PrismaClient;
  now?: Date;
  batchSize: number;
  leaseSeconds: number;
}>;

export async function processNotificationFanoutBatch(input: ProcessNotificationFanoutBatchInput): Promise<NotificationFanoutBatchResult> {
  const now = input.now ?? new Date();
  const events = await claimNotificationOutboxEvents(input.prisma, { now, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds });
  const result: NotificationFanoutBatchResult = { claimed: events.length, materialized: 0, cancelled: 0, failed: 0 };
  for (const event of events) {
    try {
      const outcome = await fanOutNotificationEvent(input.prisma, event, event.availableAt, now);
      result.materialized += outcome.materialized;
      if (outcome.cancelled) result.cancelled += 1;
    } catch {
      if (await markNotificationOutboxFailed(input.prisma, event.id, event.availableAt, now, event.attempts)) result.failed += 1;
    }
  }
  return result;
}
