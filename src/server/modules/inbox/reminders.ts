import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { readServerEnv } from '@/server/env';
import { WAITING_ON_CUSTOMER_DAYS } from '@/server/modules/quote-requests/domain';
import { APPROVER_PERMISSIONS, activeEmployees, activeStaffWithPermissions, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, POOL_PERMISSIONS } from './audience';
import { recordDomainEvent } from './domain-events';
import { recordInboxIntents, type InboxIntent } from './record';
import type { InboxData, InboxKind, InboxPriority } from './kinds';

const REMINDER_LOCK_NAME = 'ocpool:inbox-reminder-sweep:v1';
const MAX_CANDIDATES_PER_RULE = 25;
export const INBOX_REMINDER_SWEEP_INTERVAL_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

const OPEN_REQUEST_STATUSES = ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION'] as const;
const FOLLOW_UP_STATUSES = ['INFORMACION_REQUERIDA', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'] as const;

type Tx = Prisma.TransactionClient;
type Recipient = { id: string; displayName: string };
type ReminderTarget = { id: string; actionPath: string };
type RequestCandidate = { requestId: string };
type WaitingCandidate = { requestId: string; conversationId: string; messageId: string; messageAt: Date };
type ApprovalCandidate = { requestId: string; approvalId: string };
type QuoteCandidate = { requestId: string; quoteId: string; versionId: string };
type FollowUpCandidate = { requestId: string; lastActivityAt: Date; localDate: string };

export type InboxReminderSweepResult = Readonly<{ acquired: boolean; examined: number; recorded: number }>;

export type RunInboxReminderSweepOptions = Readonly<{
  prisma: PrismaClient;
  now?: Date;
  timeZone: string;
  enabled?: boolean;
}>;

function assertNow(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid inbox reminder sweep time.');
}

export function isReminderSweepOpen(now: Date, timeZone: string): boolean {
  assertNow(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = value('weekday');
  const hour = Number(value('hour'));
  return weekday !== 'Sun' && hour >= 8 && hour < 19;
}

export function isInboxReminderSweepDue(now: Date, lastRunAt: number | null): boolean {
  assertNow(now);
  if (lastRunAt === null) return true;
  if (!Number.isFinite(lastRunAt)) throw new Error('Invalid prior inbox reminder sweep time.');
  return now.getTime() - lastRunAt >= INBOX_REMINDER_SWEEP_INTERVAL_MS;
}

function localDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function staffTargets(recipients: readonly Recipient[], requestId: string, area: 'requests' | 'quotes' = 'requests'): ReminderTarget[] {
  const path = area === 'quotes' ? `/staff/quotes?request=${encodeURIComponent(requestId)}` : `/staff/requests?request=${encodeURIComponent(requestId)}`;
  return recipients.map(({ id }) => ({ id, actionPath: path }));
}

function requestStaffTarget(userId: string | null, requestId: string, area: 'requests' | 'quotes' = 'requests'): ReminderTarget[] {
  return userId ? staffTargets([{ id: userId, displayName: '' }], requestId, area) : [];
}

function customerTarget(userId: string | null, requestId: string): ReminderTarget[] {
  return userId ? [{ id: userId, actionPath: `/portal?request=${encodeURIComponent(requestId)}` }] : [];
}

async function lockRequest(tx: Tx, requestId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "quote_requests" WHERE "id" = ${requestId}::uuid FOR UPDATE`);
  return rows.length > 0;
}

async function lockQuote(tx: Tx, quoteId: string, versionId: string): Promise<boolean> {
  const quoteRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "quotes" WHERE "id" = ${quoteId}::uuid FOR UPDATE`);
  if (quoteRows.length === 0) return false;
  const versionRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "quote_versions" WHERE "id" = ${versionId}::uuid AND "quoteId" = ${quoteId}::uuid FOR UPDATE`);
  return versionRows.length > 0;
}

async function recordReminder(tx: Tx, input: {
  key: string;
  kind: InboxKind;
  priority: InboxPriority;
  requestId: string;
  data: InboxData;
  targets: readonly ReminderTarget[];
  now: Date;
  allowWithoutTargets?: boolean;
}): Promise<boolean> {
  if (input.targets.length === 0 && !input.allowWithoutTargets) return false;
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "inbox_reminders" ("key", "createdAt") VALUES (${input.key}, ${input.now})
    ON CONFLICT ("key") DO NOTHING
  `);
  if (inserted === 0) return false;
  if (input.targets.length > 0) {
    const intents: InboxIntent[] = input.targets.map((target) => ({
      recipientId: target.id,
      kind: input.kind,
      priority: input.priority,
      quoteRequestId: input.requestId,
      actorId: null,
      groupKey: `reminder:${input.key}:${target.id}`,
      actionPath: target.actionPath,
      actionRequired: true,
      data: input.data,
    }));
    await recordInboxIntents(tx, intents, input.now);
  }
  return true;
}

async function waitingCandidates(tx: Tx, now: Date): Promise<WaitingCandidate[]> {
  const fourHourCutoff = new Date(now.getTime() - 4 * HOUR_MS);
  const oneDayCutoff = new Date(now.getTime() - DAY_MS);
  return tx.$queryRaw<WaitingCandidate[]>(Prisma.sql`
    SELECT qr."id" AS "requestId", c."id" AS "conversationId", last_message."id" AS "messageId", last_message."createdAt" AS "messageAt"
    FROM "conversations" c
    JOIN "quote_requests" qr ON qr."id" = c."quoteRequestId"
    JOIN LATERAL (
      SELECT cm."id", cm."createdAt", sender."type"::text AS "senderType"
      FROM "conversation_messages" cm
      LEFT JOIN "users" sender ON sender."id" = cm."senderUserId"
      WHERE cm."conversationId" = c."id" AND cm."visibility" = 'CUSTOMER'::"MessageVisibility"
      ORDER BY cm."createdAt" DESC, cm."id" DESC
      LIMIT 1
    ) last_message ON TRUE
    WHERE c."status" = 'OPEN'::"ConversationStatus"
      AND qr."status" IN ('RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION')
      AND last_message."senderType" = 'CUSTOMER'
      AND last_message."createdAt" < ${fourHourCutoff}
      AND (
        NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'waiting:' || qr."id"::text || ':' || last_message."id"::text || ':4h')
        OR (last_message."createdAt" < ${oneDayCutoff} AND NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'waiting:' || qr."id"::text || ':' || last_message."id"::text || ':24h'))
      )
    ORDER BY last_message."createdAt" ASC, qr."id" ASC
    LIMIT ${MAX_CANDIDATES_PER_RULE}
  `);
}

async function unassignedCandidates(tx: Tx, now: Date): Promise<RequestCandidate[]> {
  const cutoff = new Date(now.getTime() - 2 * HOUR_MS);
  return tx.$queryRaw<RequestCandidate[]>(Prisma.sql`
    SELECT qr."id" AS "requestId"
    FROM "quote_requests" qr
    LEFT JOIN "users" assignee ON assignee."id" = qr."currentAssigneeId"
    LEFT JOIN LATERAL (
      SELECT ra."id", ra."unassignedAt"
      FROM "request_assignments" ra
      WHERE ra."quoteRequestId" = qr."id"
      ORDER BY ra."assignedAt" DESC, ra."id" DESC
      LIMIT 1
    ) latest_assignment ON TRUE
    WHERE qr."origin" = 'PUBLIC_FORM'::"QuoteRequestOrigin"
      AND qr."status" IN ('RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION')
      AND (assignee."id" IS NULL OR assignee."type" <> 'EMPLOYEE'::"UserType" OR assignee."status" <> 'ACTIVE'::"UserStatus")
      AND COALESCE(latest_assignment."unassignedAt", CASE WHEN latest_assignment."id" IS NULL THEN qr."createdAt" ELSE qr."updatedAt" END) < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'unassigned:' || qr."id"::text || ':2h')
    ORDER BY qr."createdAt" ASC, qr."id" ASC
    LIMIT ${MAX_CANDIDATES_PER_RULE}
  `);
}

async function readUnassignedSince(tx: Tx, requestId: string): Promise<{ since: Date; activeAssignee: boolean } | null> {
  const rows = await tx.$queryRaw<Array<{ since: Date; activeAssignee: boolean }>>(Prisma.sql`
    SELECT
      COALESCE(latest_assignment."unassignedAt", CASE WHEN latest_assignment."id" IS NULL THEN qr."createdAt" ELSE qr."updatedAt" END) AS "since",
      (assignee."id" IS NOT NULL AND assignee."type" = 'EMPLOYEE'::"UserType" AND assignee."status" = 'ACTIVE'::"UserStatus") AS "activeAssignee"
    FROM "quote_requests" qr
    LEFT JOIN "users" assignee ON assignee."id" = qr."currentAssigneeId"
    LEFT JOIN LATERAL (
      SELECT ra."id", ra."unassignedAt"
      FROM "request_assignments" ra
      WHERE ra."quoteRequestId" = qr."id"
      ORDER BY ra."assignedAt" DESC, ra."id" DESC
      LIMIT 1
    ) latest_assignment ON TRUE
    WHERE qr."id" = ${requestId}::uuid
  `);
  return rows[0] ?? null;
}

async function approvalCandidates(tx: Tx, now: Date): Promise<ApprovalCandidate[]> {
  const cutoff = new Date(now.getTime() - 4 * HOUR_MS);
  return tx.$queryRaw<ApprovalCandidate[]>(Prisma.sql`
    SELECT qr."id" AS "requestId", approval."id" AS "approvalId"
    FROM "quote_approvals" approval
    JOIN "quotes" q ON q."id" = approval."quoteId"
    JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
    WHERE approval."status" = 'REQUESTED'::"QuoteApprovalStatus"
      AND approval."requestedAt" < ${cutoff}
      AND qr."status" IN ('RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION')
      AND NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'approval:' || approval."id"::text || ':4h')
    ORDER BY approval."requestedAt" ASC, approval."id" ASC
    LIMIT ${MAX_CANDIDATES_PER_RULE}
  `);
}

async function expiringCandidates(tx: Tx, now: Date): Promise<QuoteCandidate[]> {
  const twentyFourHourMark = new Date(now.getTime() + 24 * HOUR_MS);
  const seventyTwoHourMark = new Date(now.getTime() + 72 * HOUR_MS);
  return tx.$queryRaw<QuoteCandidate[]>(Prisma.sql`
    SELECT qr."id" AS "requestId", q."id" AS "quoteId", version."id" AS "versionId"
    FROM "quotes" q
    JOIN "quote_versions" version ON version."id" = q."publishedVersionId"
    JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
    WHERE version."status" IN ('ENVIADA'::"QuoteVersionStatus", 'EN_NEGOCIACION'::"QuoteVersionStatus")
      AND version."validUntil" > ${now}
      AND version."validUntil" <= ${seventyTwoHourMark}
      AND qr."status" IN ('COTIZACION_DISPONIBLE', 'EN_NEGOCIACION')
      AND (
        (version."validUntil" <= ${twentyFourHourMark} AND NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'expiring:' || version."id"::text || ':24h'))
        OR (version."validUntil" > ${twentyFourHourMark} AND NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'expiring:' || version."id"::text || ':72h'))
      )
    ORDER BY version."validUntil" ASC, version."id" ASC
    LIMIT ${MAX_CANDIDATES_PER_RULE}
  `);
}

async function expiredCandidates(tx: Tx, now: Date): Promise<QuoteCandidate[]> {
  return tx.$queryRaw<QuoteCandidate[]>(Prisma.sql`
    SELECT qr."id" AS "requestId", q."id" AS "quoteId", version."id" AS "versionId"
    FROM "quotes" q
    JOIN "quote_versions" version ON version."id" = q."publishedVersionId"
    JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
    WHERE version."status" IN ('ENVIADA'::"QuoteVersionStatus", 'EN_NEGOCIACION'::"QuoteVersionStatus", 'VENCIDA'::"QuoteVersionStatus")
      AND version."validUntil" IS NOT NULL AND version."validUntil" <= ${now}
      AND qr."status" NOT IN ('RECHAZADA', 'ACEPTADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO')
      AND NOT EXISTS (SELECT 1 FROM "inbox_reminders" r WHERE r."key" = 'expired:' || version."id"::text)
    ORDER BY version."validUntil" ASC, version."id" ASC
    LIMIT ${MAX_CANDIDATES_PER_RULE}
  `);
}

async function followUpCandidates(tx: Tx, now: Date, timeZone: string): Promise<FollowUpCandidate[]> {
  const cutoff = new Date(now.getTime() - WAITING_ON_CUSTOMER_DAYS * DAY_MS);
  return tx.$queryRaw<FollowUpCandidate[]>(Prisma.sql`
    SELECT qr."id" AS "requestId", activity."lastActivityAt", to_char(activity."lastActivityAt" AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS "localDate"
    FROM "quote_requests" qr
    LEFT JOIN "conversations" c ON c."quoteRequestId" = qr."id"
    LEFT JOIN LATERAL (
      SELECT cm."createdAt", sender."type"::text AS "senderType"
      FROM "conversation_messages" cm
      LEFT JOIN "users" sender ON sender."id" = cm."senderUserId"
      WHERE cm."conversationId" = c."id" AND cm."visibility" = 'CUSTOMER'::"MessageVisibility"
      ORDER BY cm."createdAt" DESC, cm."id" DESC
      LIMIT 1
    ) last_message ON TRUE
    CROSS JOIN LATERAL (SELECT GREATEST(qr."updatedAt", COALESCE(last_message."createdAt", qr."updatedAt")) AS "lastActivityAt") activity
    WHERE qr."status" IN ('INFORMACION_REQUERIDA', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION')
      AND (last_message."createdAt" IS NULL OR last_message."senderType" = 'EMPLOYEE')
      AND activity."lastActivityAt" < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM "inbox_reminders" r
        WHERE r."key" = 'followup:' || qr."id"::text || ':' || to_char(activity."lastActivityAt" AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')
      )
    ORDER BY activity."lastActivityAt" ASC, qr."id" ASC
    LIMIT ${MAX_CANDIDATES_PER_RULE}
  `);
}

async function currentLastSharedActivity(tx: Tx, requestId: string): Promise<{ lastActivityAt: Date; senderType: string | null } | null> {
  const rows = await tx.$queryRaw<Array<{ lastActivityAt: Date; senderType: string | null }>>(Prisma.sql`
    SELECT GREATEST(qr."updatedAt", COALESCE(last_message."createdAt", qr."updatedAt")) AS "lastActivityAt", last_message."senderType"
    FROM "quote_requests" qr
    LEFT JOIN "conversations" c ON c."quoteRequestId" = qr."id"
    LEFT JOIN LATERAL (
      SELECT cm."createdAt", sender."type"::text AS "senderType"
      FROM "conversation_messages" cm
      LEFT JOIN "users" sender ON sender."id" = cm."senderUserId"
      WHERE cm."conversationId" = c."id" AND cm."visibility" = 'CUSTOMER'::"MessageVisibility"
      ORDER BY cm."createdAt" DESC, cm."id" DESC
      LIMIT 1
    ) last_message ON TRUE
    WHERE qr."id" = ${requestId}::uuid
  `);
  return rows[0] ?? null;
}

async function runSweepInTransaction(tx: Tx, now: Date, timeZone: string): Promise<InboxReminderSweepResult> {
  const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${REMINDER_LOCK_NAME}, 0)) AS "acquired"`);
  if (!lock[0]?.acquired) return { acquired: false, examined: 0, recorded: 0 };

  const managers = await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS);
  const pool = await activeStaffWithPermissions(tx, POOL_PERMISSIONS);
  const approvers = await activeStaffWithPermissions(tx, APPROVER_PERMISSIONS);
  const waiting = await waitingCandidates(tx, now);
  const unassigned = await unassignedCandidates(tx, now);
  const approvals = await approvalCandidates(tx, now);
  const expiring = await expiringCandidates(tx, now);
  const expired = await expiredCandidates(tx, now);
  const followUps = await followUpCandidates(tx, now, timeZone);
  const examined = waiting.length + unassigned.length + approvals.length + expiring.length + expired.length + followUps.length;
  let recorded = 0;

  for (const candidate of waiting) {
    if (!await lockRequest(tx, candidate.requestId)) continue;
    const [context, conversation] = await Promise.all([
      loadRequestInboxContext(tx, candidate.requestId),
      tx.conversation.findUnique({ where: { id: candidate.conversationId }, select: {
        status: true,
        quoteRequestId: true,
        messages: { where: { visibility: 'CUSTOMER' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, createdAt: true, sender: { select: { type: true } } } },
      } }),
    ]);
    const latest = conversation?.messages[0];
    if (!context || !OPEN_REQUEST_STATUSES.includes(context.status as (typeof OPEN_REQUEST_STATUSES)[number]) || conversation?.status !== 'OPEN' || conversation.quoteRequestId !== candidate.requestId || latest?.id !== candidate.messageId || latest.sender?.type !== 'CUSTOMER') continue;
    const age = now.getTime() - latest.createdAt.getTime();
    if (age <= 4 * HOUR_MS) continue;
    const owners = context.assigneeId ? await activeEmployees(tx, [context.assigneeId]) : pool;
    const targets = staffTargets(owners, context.id);
    const reminderBase = { requestId: context.id, priority: 'HIGH' as const, targets, data: { folio: context.folio, clientName: context.clientName }, now };
    if (await recordReminder(tx, { ...reminderBase, key: `waiting:${context.id}:${latest.id}:4h`, kind: 'reminder.customer_waiting' })) recorded += 1;
    if (age > DAY_MS && await recordReminder(tx, { ...reminderBase, key: `waiting:${context.id}:${latest.id}:24h`, kind: 'reminder.customer_waiting_escalated', targets: staffTargets(managers, context.id) })) recorded += 1;
  }

  const unassignedCutoff = now.getTime() - 2 * HOUR_MS;
  for (const candidate of unassigned) {
    if (!await lockRequest(tx, candidate.requestId)) continue;
    const context = await loadRequestInboxContext(tx, candidate.requestId);
    const since = await readUnassignedSince(tx, candidate.requestId);
    if (!context || context.origin !== 'PUBLIC_FORM' || context.assigneeId || !OPEN_REQUEST_STATUSES.includes(context.status as (typeof OPEN_REQUEST_STATUSES)[number]) || !since || since.activeAssignee || since.since.getTime() >= unassignedCutoff) continue;
    if (await recordReminder(tx, {
      key: `unassigned:${context.id}:2h`, kind: 'reminder.unassigned', priority: 'HIGH', requestId: context.id,
      targets: staffTargets(managers, context.id),
      data: { folio: context.folio, clientName: context.clientName, ...(context.projectType ? { projectType: context.projectType } : {}), ...(context.location ? { location: context.location } : {}) }, now,
    })) recorded += 1;
  }

  for (const candidate of approvals) {
    if (!await lockRequest(tx, candidate.requestId)) continue;
    const context = await loadRequestInboxContext(tx, candidate.requestId);
    const approval = await tx.quoteApproval.findUnique({ where: { id: candidate.approvalId }, select: { id: true, type: true, status: true, requestedAt: true, requestedById: true, quote: { select: { quoteRequestId: true } }, quoteVersion: { select: { versionNumber: true } } } });
    if (!context || !OPEN_REQUEST_STATUSES.includes(context.status as (typeof OPEN_REQUEST_STATUSES)[number]) || !approval || approval.status !== 'REQUESTED' || approval.quote.quoteRequestId !== context.id || now.getTime() - approval.requestedAt.getTime() <= 4 * HOUR_MS) continue;
    const recipients = excludeUser(approvers, approval.requestedById);
    if (await recordReminder(tx, {
      key: `approval:${approval.id}:4h`, kind: 'reminder.approval_pending', priority: 'NORMAL', requestId: context.id,
      targets: staffTargets(recipients, context.id, 'quotes'), data: { folio: context.folio, versionNumber: approval.quoteVersion.versionNumber, approvalType: approval.type }, now,
    })) recorded += 1;
  }

  for (const candidate of expiring) {
    if (!await lockRequest(tx, candidate.requestId) || !await lockQuote(tx, candidate.quoteId, candidate.versionId)) continue;
    const [context, quote] = await Promise.all([
      loadRequestInboxContext(tx, candidate.requestId),
      tx.quote.findUnique({ where: { id: candidate.quoteId }, include: {
        publishedVersion: { select: { id: true, versionNumber: true, status: true, validUntil: true } },
        quoteRequest: { select: { id: true, folio: true, status: true, client: { select: { status: true } }, contact: { select: { status: true } } } },
      } }),
    ]);
    const version = quote?.publishedVersion;
    if (!context || !quote || !version || version.id !== candidate.versionId || !version.validUntil || !['ENVIADA', 'EN_NEGOCIACION'].includes(version.status) || !['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'].includes(context.status) || version.validUntil <= now) continue;
    const remainingMs = version.validUntil.getTime() - now.getTime();
    if (remainingMs > 72 * HOUR_MS) continue;
    const hours: 24 | 72 = remainingMs <= 24 * HOUR_MS ? 24 : 72;
    const key = `expiring:${version.id}:${hours}h`;
    const targets = [
      ...customerTarget(context.customerUserId, context.id),
      ...requestStaffTarget(context.assigneeId, context.id),
    ];
    const shouldEmail = quote.quoteRequest.client.status === 'ACTIVE' && quote.quoteRequest.contact.status === 'ACTIVE';
    const inserted = await recordReminder(tx, {
      key, kind: 'reminder.quote_expiring', priority: 'NORMAL', requestId: context.id,
      targets, allowWithoutTargets: shouldEmail,
      data: { folio: context.folio, versionNumber: version.versionNumber }, now,
    });
    if (!inserted) continue;
    recorded += 1;
    if (shouldEmail) {
      await recordDomainEvent(tx, {
        actor: null,
        eventType: 'QUOTE.EXPIRING', aggregateType: 'QUOTE', aggregateId: quote.id,
        payload: { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId: context.id, folio: context.folio, versionNumber: version.versionNumber, expiresInHours: hours },
      }, { inbox: 'skip' });
    }
  }

  for (const candidate of expired) {
    if (!await lockRequest(tx, candidate.requestId) || !await lockQuote(tx, candidate.quoteId, candidate.versionId)) continue;
    const [context, quote] = await Promise.all([
      loadRequestInboxContext(tx, candidate.requestId),
      tx.quote.findUnique({ where: { id: candidate.quoteId }, include: { publishedVersion: { select: { id: true, versionNumber: true, status: true, validUntil: true } } } }),
    ]);
    const version = quote?.publishedVersion;
    if (!context || !quote || !version || version.id !== candidate.versionId || !version.validUntil || version.validUntil > now || !['ENVIADA', 'EN_NEGOCIACION', 'VENCIDA'].includes(version.status) || ['RECHAZADA', 'ACEPTADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO'].includes(context.status)) continue;
    if (await recordReminder(tx, {
      key: `expired:${version.id}`, kind: 'reminder.quote_expired', priority: 'NORMAL', requestId: context.id,
      targets: requestStaffTarget(context.assigneeId, context.id, 'quotes'), data: { folio: context.folio, versionNumber: version.versionNumber }, now,
    })) recorded += 1;
  }

  const followUpCutoff = now.getTime() - WAITING_ON_CUSTOMER_DAYS * DAY_MS;
  for (const candidate of followUps) {
    if (!await lockRequest(tx, candidate.requestId)) continue;
    const [context, activity] = await Promise.all([
      loadRequestInboxContext(tx, candidate.requestId),
      currentLastSharedActivity(tx, candidate.requestId),
    ]);
    if (!context || !activity || !FOLLOW_UP_STATUSES.includes(context.status as (typeof FOLLOW_UP_STATUSES)[number]) || activity.lastActivityAt.getTime() >= followUpCutoff || (activity.senderType !== null && activity.senderType !== 'EMPLOYEE')) continue;
    const date = localDateKey(activity.lastActivityAt, timeZone);
    if (await recordReminder(tx, {
      key: `followup:${context.id}:${date}`, kind: 'reminder.follow_up', priority: 'INFO', requestId: context.id,
      targets: requestStaffTarget(context.assigneeId, context.id), data: { folio: context.folio, clientName: context.clientName }, now,
    })) recorded += 1;
  }

  return { acquired: true, examined, recorded };
}

export async function runInboxReminderSweep(options: RunInboxReminderSweepOptions): Promise<InboxReminderSweepResult> {
  const now = options.now ?? new Date();
  assertNow(now);
  const enabled = options.enabled ?? readServerEnv().INBOX_REMINDERS_ENABLED;
  if (!enabled || !isReminderSweepOpen(now, options.timeZone)) return { acquired: false, examined: 0, recorded: 0 };
  return options.prisma.$transaction((tx) => runSweepInTransaction(tx, now, options.timeZone), { maxWait: 5_000, timeout: 30_000 });
}
