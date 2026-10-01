import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { readServerEnv } from '@/server/env';
import { cancelNotificationDelivery, upsertNotificationDelivery, type NotificationCancellationReason } from '@/server/modules/notifications/dispatcher';
import { markNotificationOutboxFailed, markNotificationOutboxSent } from '@/server/modules/notifications/fanout';
import { buildNotificationUrl } from '@/server/modules/notifications/templates';

type DbClient = PrismaClient;

type ClaimedDigestEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
};

export type ProcessInboxDigestDueBatchOptions = Readonly<{
  prisma: PrismaClient;
  now?: Date;
  batchSize: number;
  leaseSeconds: number;
}>;

export type ProcessInboxDigestDueBatchResult = {
  claimed: number;
  materialized: number;
  cancelled: number;
  failed: number;
};

type DigestResolution =
  | { kind: 'DELIVERY'; recipientUserId: string; recipientEmail: string; safePayload: Record<string, string | number> }
  | { kind: 'CANCELLED'; reason: NotificationCancellationReason };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' && value[key].trim() ? value[key] as string : null;
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (!normalized || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) return null;
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : 0;
}

async function claimInboxDigestDueEvents(prisma: DbClient, now: Date, batchSize: number, leaseSeconds: number): Promise<ClaimedDigestEvent[]> {
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
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
        WHERE "eventType" = 'INBOX.DIGEST_DUE'
          AND (
            ("status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= ${now})
            OR ("status" = 'PROCESSING'::"OutboxStatus" AND "availableAt" <= ${now})
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
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
      payload: recordValue(row.payload) ?? {},
      attempts: row.attempts,
      availableAt: row.availableAt,
      createdAt: row.createdAt,
    }));
  });
}

async function resolveDigestEvent(prisma: DbClient, event: ClaimedDigestEvent, now: Date): Promise<DigestResolution> {
  const payload = event.payload;
  const notificationId = stringValue(payload, 'notificationId');
  if (event.aggregateType !== 'INBOX_NOTIFICATION' || !notificationId || event.aggregateId !== notificationId) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };

  const notification = await prisma.inboxNotification.findUnique({
    where: { id: notificationId },
    include: {
      recipient: { select: { id: true, email: true, displayName: true, type: true, status: true, clientId: true } },
      quoteRequest: { include: { client: { select: { status: true } }, contact: { select: { userId: true, status: true } } } },
    },
  });
  if (!notification || !notification.quoteRequest || notification.quoteRequestId !== notification.quoteRequest.id || stringValue(payload, 'quoteRequestId') !== notification.quoteRequestId || stringValue(payload, 'recipientId') !== notification.recipientId) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
  if (notification.readAt || notification.resolvedAt) return { kind: 'CANCELLED', reason: 'ALREADY_READ' };

  const isStaffActivity = notification.kind === 'customer.activity';
  const isCustomerActivity = notification.kind === 'team.activity';
  if (!isStaffActivity && !isCustomerActivity) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
  const recipient = notification.recipient;
  if (recipient.status !== 'ACTIVE' || recipient.type !== (isStaffActivity ? 'EMPLOYEE' : 'CUSTOMER')) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
  if (await prisma.inboxPreference.findUnique({ where: { userId: recipient.id }, select: { activityEmail: true } }).then((preference) => preference?.activityEmail === 'OFF')) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };

  const request = notification.quoteRequest;
  if (isStaffActivity) {
    if (request.currentAssigneeId) {
      if (request.currentAssigneeId !== recipient.id) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
    } else {
      const manager = await prisma.user.findFirst({
        where: {
          id: recipient.id,
          type: 'EMPLOYEE',
          status: 'ACTIVE',
          roles: { some: { role: { permissions: { some: { permission: { key: 'requests.read.global' } } } } } },
        },
        select: { id: true },
      });
      if (!manager) return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
    }
  } else if (request.client.status !== 'ACTIVE' || request.contact.status !== 'ACTIVE' || request.contact.userId !== recipient.id || recipient.clientId !== request.clientId) {
    return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
  }

  const env = readServerEnv();
  try {
    buildNotificationUrl(env.APP_URL, notification.actionPath);
  } catch {
    return { kind: 'CANCELLED', reason: 'INBOX_DIGEST' };
  }
  const data = recordValue(notification.data) ?? {};
  const safePayload: Record<string, string | number> = {
    recipientName: safeText(recipient.displayName, 180) ?? 'Hola',
    folio: safeText(data.folio, 40) ?? request.folio,
    messages: safeCount(data.messages),
    files: safeCount(data.files),
    actionPath: notification.actionPath,
    quoteRequestId: request.id,
  };
  const preview = safeText(data.preview, 500);
  if (preview) safePayload.preview = preview;
  if (isStaffActivity) {
    const clientName = safeText(data.clientName, 180);
    if (clientName) safePayload.clientName = clientName;
  } else {
    const projectType = safeText(data.projectType, 120);
    if (projectType) safePayload.projectType = projectType;
  }
  if (Number.isNaN(now.getTime())) return { kind: 'CANCELLED', reason: 'INVALID_PAYLOAD' };
  return { kind: 'DELIVERY', recipientUserId: recipient.id, recipientEmail: recipient.email, safePayload };
}

function assertBatchOptions(options: ProcessInboxDigestDueBatchOptions): void {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) throw new Error('Invalid inbox digest batch size.');
  if (!Number.isInteger(options.leaseSeconds) || options.leaseSeconds < 5 || options.leaseSeconds > 3600) throw new Error('Invalid inbox digest lease.');
  if (options.now && Number.isNaN(options.now.getTime())) throw new Error('Invalid inbox digest processing time.');
}

export async function processInboxDigestDueBatch(options: ProcessInboxDigestDueBatchOptions): Promise<ProcessInboxDigestDueBatchResult> {
  assertBatchOptions(options);
  const now = options.now ?? new Date();
  const events = await claimInboxDigestDueEvents(options.prisma, now, options.batchSize, options.leaseSeconds);
  const result: ProcessInboxDigestDueBatchResult = { claimed: events.length, materialized: 0, cancelled: 0, failed: 0 };
  for (const event of events) {
    try {
      const resolution = await resolveDigestEvent(options.prisma, event, now);
      if (resolution.kind === 'CANCELLED') {
        await cancelNotificationDelivery(options.prisma, { outboxEventId: event.id, reason: resolution.reason, now });
        await markNotificationOutboxSent(options.prisma, event.id, event.availableAt, now);
        result.cancelled += 1;
        continue;
      }
      await upsertNotificationDelivery(options.prisma, {
        outboxEventId: event.id,
        recipientUserId: resolution.recipientUserId,
        recipientEmail: resolution.recipientEmail,
        templateKey: 'activity.digest',
        templateVersion: 'v1',
        safePayload: resolution.safePayload,
      });
      await markNotificationOutboxSent(options.prisma, event.id, event.availableAt, now);
      result.materialized += 1;
    } catch {
      if (await markNotificationOutboxFailed(options.prisma, event.id, event.availableAt, now, event.attempts)) result.failed += 1;
    }
  }
  return result;
}
