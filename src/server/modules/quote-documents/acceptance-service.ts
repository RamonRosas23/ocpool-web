import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { canAcceptQuoteVersion, normalizeAcceptanceName, normalizeAcceptanceTermsVersion } from '@/server/modules/quote-documents/domain';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';
import { normalizeIdempotencyKey } from '@/server/modules/messaging/domain';
import { canTransitionQuoteRequest, type QuoteRequestStatus } from '@/server/modules/quote-requests/domain';
import { isCustomerVisibleQuoteVersionStatus } from '@/server/modules/quotes/customer-visibility';
import { resolveCommercialTermsRecord } from '@/server/modules/quotes/service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PDF_CONTENT_TYPE = 'application/pdf';
const ACCEPTABLE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION'];

export type QuoteAcceptanceInput = Readonly<{
  signerName: string;
  termsVersion: string;
  idempotencyKey: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}>;

export type QuoteAcceptanceDependencies = Readonly<{
  prisma?: PrismaClient;
  storage?: PrivateStorage;
  now?: Date;
}>;

export type QuoteAcceptanceResult = Readonly<{
  id: string;
  quoteId: string;
  quoteVersionId: string;
  versionNumber: number;
  status: 'ACEPTADA';
  signerName: string;
  termsVersion: string;
  documentSha256: string;
  acceptedAt: Date;
}>;

type AcceptanceRecord = {
  id: string;
  quoteId: string;
  quoteVersionId: string;
  signerName: string;
  termsVersion: string;
  documentSha256: string;
  acceptedAt: Date;
  quoteVersion: { versionNumber: number };
};

type LockedQuote = {
  id: string;
  clientId: string;
  quoteRequestId: string;
  currentVersionId: string | null;
  publishedVersionId: string | null;
  requestStatus: QuoteRequestStatus;
  folio: string;
};

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

function normalizeInput(input: QuoteAcceptanceInput): QuoteAcceptanceInput & { idempotencyKeyHash: string } {
  if (!input || typeof input.signerName !== 'string' || typeof input.termsVersion !== 'string' || typeof input.idempotencyKey !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'Los datos de aceptación no son válidos.', 400);
  }
  try {
    const signerName = normalizeAcceptanceName(input.signerName);
    // C1-05: format-only here -- the version's own frozen terms (or, for a version published
    // before that existed, whatever is active) are the real source of truth, checked once the
    // version is actually locked inside the transaction below, not against a hardcoded constant.
    const termsVersion = normalizeAcceptanceTermsVersion(input.termsVersion);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    return {
      signerName,
      termsVersion,
      idempotencyKey,
      idempotencyKeyHash: fingerprintToken(idempotencyKey),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', 'Los datos de aceptación no son válidos.', 400);
  }
}

function fingerprintHeader(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) return null;
  return fingerprintToken(normalized);
}

function serializeAcceptance(record: AcceptanceRecord): QuoteAcceptanceResult {
  return {
    id: record.id,
    quoteId: record.quoteId,
    quoteVersionId: record.quoteVersionId,
    versionNumber: record.quoteVersion.versionNumber,
    status: 'ACEPTADA',
    signerName: record.signerName,
    termsVersion: record.termsVersion,
    documentSha256: record.documentSha256,
    acceptedAt: record.acceptedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function findReplay(prisma: PrismaClient, acceptedById: string, idempotencyKeyHash: string, quoteId: string): Promise<QuoteAcceptanceResult | null> {
  const existing = await prisma.quoteAcceptance.findUnique({
    where: { acceptedById_idempotencyKeyHash: { acceptedById, idempotencyKeyHash } },
    include: { quoteVersion: { select: { versionNumber: true } } },
  });
  if (!existing) return null;
  if (existing.quoteId !== quoteId) throw new AppError('CONFLICT', 'La llave de idempotencia ya fue utilizada.', 409);
  return serializeAcceptance(existing);
}

async function lockQuote(transaction: Prisma.TransactionClient, quoteId: string, clientId: string): Promise<LockedQuote | null> {
  const rows = await transaction.$queryRaw<LockedQuote[]>(Prisma.sql`
    SELECT q."id", q."clientId", q."quoteRequestId", q."currentVersionId",
           COALESCE(q."publishedVersionId", (SELECT qv."id" FROM "quote_versions" qv
            WHERE qv."quoteId" = q."id"
              AND qv."status" IN ('ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA')
            ORDER BY qv."versionNumber" DESC
            LIMIT 1)) AS "publishedVersionId",
           qr."status" AS "requestStatus", qr."folio"
    FROM "quotes" q
    INNER JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId" AND qr."clientId" = q."clientId"
    WHERE q."id" = ${quoteId} AND q."clientId" = ${clientId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function assertRequestCanBeAccepted(status: QuoteRequestStatus): void {
  if (!ACCEPTABLE_REQUEST_STATUSES.includes(status)) throw new AppError('CONFLICT', 'La cotización ya no está disponible para aceptación.', 409);
}

async function loadReadyDocument(transaction: Prisma.TransactionClient, quoteId: string, quoteVersionId: string) {
  const document = await transaction.generatedDocument.findUnique({
    where: { quoteVersionId_documentType: { quoteVersionId, documentType: 'QUOTE_PDF' } },
    include: { storageObject: true },
  });
  if (!document || document.quoteId !== quoteId) throw new AppError('CONFLICT', 'La versión no tiene un PDF comercial listo.', 409);
  if (document.status !== 'READY' || document.contentType !== PDF_CONTENT_TYPE || !document.byteSize || !document.sha256 || !document.readyAt || !document.storageObject) {
    throw new AppError('CONFLICT', 'La versión no tiene un PDF comercial listo.', 409);
  }
  if (document.storageObject.deletedAt || document.storageObject.scanStatus !== 'PASSED' || document.storageObject.contentType !== PDF_CONTENT_TYPE || !document.storageObject.sha256 || document.storageObject.sha256 !== document.sha256 || document.storageObject.byteSize !== document.byteSize) {
    throw new AppError('CONFLICT', 'El PDF comercial no está disponible para aceptación.', 409);
  }
  return document;
}

async function writeAcceptanceEvents(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  quote: LockedQuote,
  quoteVersionId: string,
  versionNumber: number,
  acceptance: { id: string; generatedDocumentId: string; termsVersion: string },
  now: Date,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: 'quote.accepted',
      entityType: 'quote',
      entityId: quote.id,
      outcome: 'SUCCESS',
      metadata: { quoteId: quote.id, quoteVersionId, quoteRequestId: quote.quoteRequestId, folio: quote.folio, versionNumber, termsVersion: acceptance.termsVersion },
    },
  });
  await transaction.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: 'quote.acceptance.created',
      entityType: 'quote_acceptance',
      entityId: acceptance.id,
      outcome: 'SUCCESS',
      metadata: { quoteId: quote.id, quoteVersionId, generatedDocumentId: acceptance.generatedDocumentId, versionNumber, termsVersion: acceptance.termsVersion },
    },
  });
  await transaction.outboxEvent.create({
    data: {
      eventType: 'QUOTE.ACCEPTED',
      aggregateType: 'QUOTE',
      aggregateId: quote.id,
      payload: { quoteId: quote.id, quoteVersionId, quoteRequestId: quote.quoteRequestId, folio: quote.folio, versionNumber, acceptanceId: acceptance.id, generatedDocumentId: acceptance.generatedDocumentId, termsVersion: acceptance.termsVersion },
    },
  });
  void now;
}

export async function acceptCustomerQuote(actor: Actor, quoteIdInput: string, input: QuoteAcceptanceInput, dependencies: QuoteAcceptanceDependencies = {}): Promise<QuoteAcceptanceResult> {
  const clientId = requireCustomerScope(actor);
  const quoteId = requireUuid(quoteIdInput);
  const normalized = normalizeInput(input);
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();

  try {
    const existingReplay = await findReplay(prisma, actor.userId, normalized.idempotencyKeyHash, quoteId);
    if (existingReplay) return existingReplay;

    const result = await prisma.$transaction(async (transaction) => {
      const quote = await lockQuote(transaction, quoteId, clientId);
      if (!quote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
      if (!quote.publishedVersionId) throw new AppError('CONFLICT', 'La cotización no tiene una versión vigente.', 409);

      const replay = await transaction.quoteAcceptance.findUnique({
        where: { acceptedById_idempotencyKeyHash: { acceptedById: actor.userId, idempotencyKeyHash: normalized.idempotencyKeyHash } },
        include: { quoteVersion: { select: { versionNumber: true } } },
      });
      if (replay) {
        if (replay.quoteId !== quote.id) throw new AppError('CONFLICT', 'La llave de idempotencia ya fue utilizada.', 409);
        return serializeAcceptance(replay);
      }

      const version = await transaction.quoteVersion.findUnique({ where: { id: quote.publishedVersionId }, select: { id: true, quoteId: true, versionNumber: true, status: true, validUntil: true, termsVersionId: true } });
      if (!version || version.quoteId !== quote.id) throw new AppError('CONFLICT', 'La cotización no tiene una versión vigente.', 409);
      assertRequestCanBeAccepted(quote.requestStatus);
      // C1-05: the exact terms this version was frozen to at publish time, not "whatever is
      // active right now" -- a legal update to the active terms after this was published must
      // never invalidate (or silently swap) what the customer is actually accepting.
      const expectedTerms = await resolveCommercialTermsRecord(transaction, version.termsVersionId);
      if (normalized.termsVersion !== expectedTerms.versionTag) {
        throw new AppError('CONFLICT', `La versión de términos vigente es ${expectedTerms.versionTag}.`, 409);
      }
      const document = await loadReadyDocument(transaction, quote.id, version.id);
      const head = await storage.head(document.storageObject!.storageKey);
      const storageSizeSafe = document.storageObject!.byteSize <= BigInt(Number.MAX_SAFE_INTEGER);
      const documentHashMatches = head !== null
        && storageSizeSafe
        && head.contentLength === Number(document.storageObject!.byteSize)
        && head.contentType === PDF_CONTENT_TYPE
        && document.storageObject!.sha256 === document.sha256;
      if (!documentHashMatches) throw new AppError('CONFLICT', 'El PDF comercial no está disponible para aceptación.', 409);

      const eligible = canAcceptQuoteVersion({
        versionStatus: version.status,
        isCurrent: quote.publishedVersionId === version.id && isCustomerVisibleQuoteVersionStatus(version.status),
        isExpired: version.validUntil !== null && version.validUntil <= now,
        documentStatus: document.status,
        documentHashMatches,
      });
      if (!eligible) throw new AppError('CONFLICT', 'La versión de cotización ya no está disponible para aceptación.', 409);

      const ipFingerprint = fingerprintHeader(normalized.ipAddress);
      const userAgentFingerprint = fingerprintHeader(normalized.userAgent);
      const created = await transaction.quoteAcceptance.create({
        data: {
          quoteId: quote.id,
          quoteVersionId: version.id,
          generatedDocumentId: document.id,
          acceptedById: actor.userId,
          documentSha256: document.sha256!,
          signerName: normalized.signerName,
          termsVersion: normalized.termsVersion,
          idempotencyKeyHash: normalized.idempotencyKeyHash,
          ipFingerprint,
          userAgentFingerprint,
          acceptedAt: now,
        },
      });

      await transaction.quoteVersion.update({ where: { id: version.id }, data: { status: 'ACEPTADA' } });
      await transaction.quoteStatusHistory.create({ data: { quoteVersionId: version.id, fromStatus: version.status, toStatus: 'ACEPTADA', changedById: actor.userId, reason: 'accepted_by_customer', createdAt: now } });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: 'quote.version.status_changed',
          entityType: 'quote_version',
          entityId: version.id,
          outcome: 'SUCCESS',
          metadata: { quoteId: quote.id, quoteRequestId: quote.quoteRequestId, folio: quote.folio, fromStatus: version.status, toStatus: 'ACEPTADA', reason: 'accepted_by_customer' },
        },
      });

      let currentRequestStatus = quote.requestStatus;
      if (currentRequestStatus !== 'PENDIENTE_DE_APROBACION') {
        if (!canTransitionQuoteRequest(currentRequestStatus, 'PENDIENTE_DE_APROBACION')) throw new AppError('CONFLICT', 'La solicitud no está lista para aceptación.', 409);
        await transaction.quoteRequest.update({ where: { id: quote.quoteRequestId }, data: { status: 'PENDIENTE_DE_APROBACION' } });
        await transaction.requestStatusHistory.create({ data: { quoteRequestId: quote.quoteRequestId, fromStatus: currentRequestStatus, toStatus: 'PENDIENTE_DE_APROBACION', changedById: actor.userId, reason: 'customer_acceptance_started', createdAt: now } });
        currentRequestStatus = 'PENDIENTE_DE_APROBACION';
      }
      if (!canTransitionQuoteRequest(currentRequestStatus, 'ACEPTADA')) throw new AppError('CONFLICT', 'La solicitud no está lista para aceptación.', 409);
      await transaction.quoteRequest.update({ where: { id: quote.quoteRequestId }, data: { status: 'ACEPTADA' } });
      await transaction.requestStatusHistory.create({ data: { quoteRequestId: quote.quoteRequestId, fromStatus: currentRequestStatus, toStatus: 'ACEPTADA', changedById: actor.userId, reason: 'accepted_by_customer', createdAt: now } });

      await writeAcceptanceEvents(transaction, actor, quote, version.id, version.versionNumber, { id: created.id, generatedDocumentId: document.id, termsVersion: normalized.termsVersion }, now);
      return serializeAcceptance({ ...created, quoteVersion: { versionNumber: version.versionNumber } });
    });
    return result;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const replay = await findReplay(prisma, actor.userId, normalized.idempotencyKeyHash, quoteId);
      if (replay) return replay;
      throw new AppError('CONFLICT', 'La cotización ya fue aceptada o la operación ya no está disponible.', 409);
    }
    throw error;
  }
}
