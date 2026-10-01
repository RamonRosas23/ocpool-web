import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { recordDomainEvent } from '@/server/modules/inbox/domain-events';
import { DeclineRequestInputError, DECLINE_REASON_CODES, declineReasonLabel, declineRequestBody, normalizeDeclineComment, type DeclineReasonCode } from '@/lib/decline-request';
import { isGeneratedQuotePdfReady } from '@/server/modules/quote-documents/domain';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';
import { sendCustomerMessageInTransaction, type CustomerMessageTransactionRequest } from '@/server/modules/messaging/service';
import { normalizeIdempotencyKey } from '@/server/modules/messaging/domain';
import { canTransitionQuoteRequest, type QuoteRequestStatus } from '@/server/modules/quote-requests/domain';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PDF_CONTENT_TYPE = 'application/pdf';
const DECLINE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'];
const DECLINE_VERSION_STATUSES = ['ENVIADA', 'EN_NEGOCIACION'] as const;

export type QuoteDeclineInput = Readonly<{
  versionId: string;
  reason: DeclineReasonCode;
  comment?: string;
  idempotencyKey: string;
}>;

export type QuoteDeclineDependencies = Readonly<{
  prisma?: PrismaClient;
  storage?: PrivateStorage;
  now?: Date;
}>;

export type QuoteDeclineResult = Readonly<{
  quoteId: string;
  quoteVersionId: string;
  quoteRequestId: string;
  versionNumber: number;
  status: 'RECHAZADA';
  declinedAt: Date;
}>;

type LockedQuote = Readonly<{
  id: string;
  clientId: string;
  quoteRequestId: string;
  publishedVersionId: string | null;
  requestStatus: QuoteRequestStatus;
  folio: string;
  currentAssigneeId: string | null;
}>;

function requireCustomerScope(actor: Actor): string {
  if (actor.type !== 'CUSTOMER' || !actor.clientId || !UUID_PATTERN.test(actor.clientId)) {
    throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  }
  requirePermission(actor, 'quotes.accept');
  return actor.clientId;
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  return value;
}

function normalizeInput(input: QuoteDeclineInput) {
  if (!input || typeof input.versionId !== 'string' || typeof input.reason !== 'string' || typeof input.idempotencyKey !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'Los datos para declinar la propuesta no son válidos.', 400);
  }
  try {
    if (!(DECLINE_REASON_CODES as readonly string[]).includes(input.reason)) throw new DeclineRequestInputError('INVALID_REASON');
    const comment = normalizeDeclineComment(input.reason, input.comment);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    return { versionId: requireUuid(input.versionId), reason: input.reason as DeclineReasonCode, comment, idempotencyKey };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', 'Los datos para declinar la propuesta no son válidos.', 400);
  }
}

async function lockQuote(transaction: Prisma.TransactionClient, quoteId: string, clientId: string): Promise<LockedQuote | null> {
  const rows = await transaction.$queryRaw<LockedQuote[]>(Prisma.sql`
    SELECT q."id", q."clientId", q."quoteRequestId",
           COALESCE(q."publishedVersionId", (SELECT qv."id" FROM "quote_versions" qv
            WHERE qv."quoteId" = q."id"
              AND qv."status" IN ('ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA')
            ORDER BY qv."versionNumber" DESC
            LIMIT 1)) AS "publishedVersionId",
           qr."status" AS "requestStatus", qr."folio", qr."currentAssigneeId"
    FROM "quotes" q
    INNER JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId" AND qr."clientId" = q."clientId"
    WHERE q."id" = ${quoteId} AND q."clientId" = ${clientId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function readyPdf(transaction: Prisma.TransactionClient, storage: PrivateStorage, quoteId: string, quoteVersionId: string) {
  const document = await transaction.generatedDocument.findUnique({
    where: { quoteVersionId_documentType: { quoteVersionId, documentType: 'QUOTE_PDF' } },
    include: { storageObject: true },
  });
  if (!document || document.quoteId !== quoteId || !isGeneratedQuotePdfReady(document)) {
    throw new AppError('CONFLICT', 'La versión no tiene un PDF comercial listo.', 409);
  }
  const object = document.storageObject!;
  const head = await storage.head(object.storageKey);
  const matches = head !== null
    && object.byteSize <= BigInt(Number.MAX_SAFE_INTEGER)
    && head.contentLength === Number(object.byteSize)
    && head.contentType === PDF_CONTENT_TYPE
    && object.sha256 === document.sha256;
  if (!matches) throw new AppError('CONFLICT', 'El PDF comercial no está disponible para declinar.', 409);
  return document;
}

function declineResult(quote: LockedQuote, version: { id: string; versionNumber: number }, declinedAt: Date): QuoteDeclineResult {
  return { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId: quote.quoteRequestId, versionNumber: version.versionNumber, status: 'RECHAZADA', declinedAt };
}

export async function declineCustomerQuote(actor: Actor, quoteIdInput: string, input: QuoteDeclineInput, dependencies: QuoteDeclineDependencies = {}): Promise<QuoteDeclineResult> {
  const clientId = requireCustomerScope(actor);
  const quoteId = requireUuid(quoteIdInput);
  const normalized = normalizeInput(input);
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const quote = await lockQuote(transaction, quoteId, clientId);
    if (!quote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
    const version = await transaction.quoteVersion.findUnique({ where: { id: normalized.versionId }, select: { id: true, quoteId: true, versionNumber: true, status: true, validUntil: true } });
    if (!version || version.quoteId !== quote.id) throw new AppError('NOT_FOUND', 'La versión de propuesta no existe.', 404);
    const messageBody = declineRequestBody(version.versionNumber, normalized.reason, normalized.comment ?? undefined);
    const lockedRequest: CustomerMessageTransactionRequest = { id: quote.quoteRequestId, folio: quote.folio, clientId: quote.clientId, currentAssigneeId: quote.currentAssigneeId };
    const message = await sendCustomerMessageInTransaction(transaction, actor, lockedRequest, { body: messageBody, idempotencyKey: normalized.idempotencyKey }, now, { inbox: 'skip' });
    const historyReason = `Declinada por el cliente · ${declineReasonLabel(normalized.reason)}${normalized.comment ? `: ${normalized.comment}` : ''}`;

    if (message.idempotent) {
      const previousDecline = await transaction.quoteStatusHistory.findFirst({ where: { quoteVersionId: version.id, fromStatus: { in: [...DECLINE_VERSION_STATUSES] }, toStatus: 'RECHAZADA', changedById: actor.userId, reason: historyReason }, select: { createdAt: true } });
      if (!previousDecline) throw new AppError('CONFLICT', 'Ya se registró un envío distinto para este intento. Recarga la página e inténtalo de nuevo.', 409);
      return declineResult(quote, version, message.createdAt);
    }

    const eligible = quote.publishedVersionId === version.id
      && DECLINE_VERSION_STATUSES.includes(version.status as (typeof DECLINE_VERSION_STATUSES)[number])
      && DECLINE_REQUEST_STATUSES.includes(quote.requestStatus)
      && (version.validUntil === null || version.validUntil > now);
    if (!eligible) throw new AppError('CONFLICT', 'La propuesta ya no está disponible para declinar.', 409);
    await readyPdf(transaction, storage, quote.id, version.id);

    await transaction.quoteVersion.update({ where: { id: version.id }, data: { status: 'RECHAZADA' } });
    await transaction.quoteStatusHistory.create({ data: { quoteVersionId: version.id, fromStatus: version.status, toStatus: 'RECHAZADA', reason: historyReason, changedById: actor.userId, createdAt: now } });
    if (quote.requestStatus === 'COTIZACION_DISPONIBLE') {
      if (!canTransitionQuoteRequest(quote.requestStatus, 'EN_NEGOCIACION')) throw new AppError('CONFLICT', 'El expediente ya no está disponible para negociar.', 409);
      await transaction.quoteRequest.update({ where: { id: quote.quoteRequestId }, data: { status: 'EN_NEGOCIACION' } });
      await transaction.requestStatusHistory.create({ data: { quoteRequestId: quote.quoteRequestId, fromStatus: quote.requestStatus, toStatus: 'EN_NEGOCIACION', changedById: actor.userId, reason: 'customer_declined_quote', createdAt: now } });
    }
    await transaction.auditLog.create({ data: { actorUserId: actor.userId, action: 'quote.declined_by_customer', entityType: 'quote_version', entityId: version.id, outcome: 'SUCCESS', metadata: { quoteId: quote.id, quoteRequestId: quote.quoteRequestId, reason: normalized.reason } } });
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'CUSTOMER' },
      eventType: 'QUOTE.DECLINED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: quote.quoteRequestId,
      payload: { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId: quote.quoteRequestId, folio: quote.folio, versionNumber: version.versionNumber, reason: normalized.reason },
    }, { now });
    return declineResult(quote, version, message.createdAt);
  });
}
