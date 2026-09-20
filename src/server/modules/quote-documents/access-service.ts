import type { PrismaClient } from '@/generated/prisma/client';
import { hasPermission, requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';
import { CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES, isCustomerVisibleQuoteVersionStatus } from '@/server/modules/quotes/customer-visibility';
import { getQuoteVersionDigest } from '@/server/modules/quotes/approval-service';
import { staffRequestReadScopeWhere } from '@/server/auth/request-scope';

const PDF_CONTENT_TYPE = 'application/pdf';
const DOWNLOAD_URL_EXPIRES_SECONDS = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type QuotePdfDownloadDependencies = Readonly<{
  prisma?: PrismaClient;
  storage?: PrivateStorage;
  now?: Date;
  expiresInSeconds?: number;
}>;

export type QuotePdfDownloadResult = Readonly<{
  document: Readonly<{
    id: string;
    quoteId: string;
    quoteVersionId: string;
    versionNumber: number;
    contentType: 'application/pdf';
    byteSize: number;
    templateVersion: string;
    readyAt: Date;
  }>;
  downloadUrl: string;
  expiresAt: Date;
}>;

export type QuoteDocumentOperationStatus = Readonly<{
  quoteId: string;
  quoteVersionId: string;
  versionNumber: number;
  /// P1-05: the live content digest, computed fresh on every call. The staff preflight dialog reads
  /// this once when it opens and sends it back as `expectedContentDigest` on confirm, so the publish
  /// command can detect a return-to-draft-and-edit that happened while the dialog sat open.
  contentDigest: string;
  document: Readonly<{
    id: string | null;
    status: 'MISSING' | 'PENDING' | 'READY' | 'FAILED' | 'DELETED';
    templateVersion: string | null;
    contentType: 'application/pdf' | null;
    byteSize: number | null;
    readyAt: Date | null;
  }>;
  acceptance: Readonly<{
    id: string;
    signerName: string;
    termsVersion: string;
    acceptedAt: Date;
  }> | null;
  actions: Readonly<{
    canDownload: boolean;
    canGenerate: boolean;
  }>;
}>;

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  return value;
}

function requireStaffAccess(actor: Actor): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'quotes.read');
  requirePermission(actor, 'quotes.pdf.read');
}

function requireStaffDocumentStatusAccess(actor: Actor): void {
  requireStaffAccess(actor);
}

function requireCustomerAccess(actor: Actor): string {
  if (actor.type !== 'CUSTOMER' || !actor.clientId || !UUID_PATTERN.test(actor.clientId)) throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'quotes.pdf.read');
  return actor.clientId;
}

function normalizeExpiry(value: number | undefined): number {
  const expiry = value ?? DOWNLOAD_URL_EXPIRES_SECONDS;
  if (!Number.isInteger(expiry) || expiry < 30 || expiry > 300) throw new AppError('INTERNAL_ERROR', 'No fue posible preparar la descarga.', 500);
  return expiry;
}

async function auditDownload(prisma: PrismaClient, actor: Actor, document: { id: string; quoteId: string; quoteVersionId: string; versionNumber: number }, expiresInSeconds: number): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: 'quote.pdf.download_url_created',
      entityType: 'generated_document',
      entityId: document.id,
      outcome: 'SUCCESS',
      metadata: { quoteId: document.quoteId, quoteVersionId: document.quoteVersionId, versionNumber: document.versionNumber, expiresInSeconds },
    },
  });
}

async function getDownload(
  actor: Actor,
  where: { quoteId: string; quoteVersionId: string; clientId?: string },
  dependencies: QuotePdfDownloadDependencies,
): Promise<QuotePdfDownloadResult> {
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();
  const expiresInSeconds = normalizeExpiry(dependencies.expiresInSeconds);
  const version = await prisma.quoteVersion.findFirst({
    where: {
      quoteId: where.quoteId,
      id: where.quoteVersionId,
      ...(where.clientId
        ? { quote: { clientId: where.clientId } }
        : { quote: { quoteRequest: staffRequestReadScopeWhere(actor) } }),
    },
    select: {
      id: true,
      quoteId: true,
      versionNumber: true,
      status: true,
      generatedDocuments: {
        where: { documentType: 'QUOTE_PDF' },
        include: { storageObject: true },
        take: 1,
      },
    },
  });
  if (!version) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  if (where.clientId && !isCustomerVisibleQuoteVersionStatus(version.status)) {
    throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  }
  const document = version.generatedDocuments[0];
  if (!document || document.status !== 'READY' || document.contentType !== PDF_CONTENT_TYPE || !document.byteSize || !document.readyAt || !document.storageObject || document.storageObject.deletedAt || document.storageObject.contentType !== PDF_CONTENT_TYPE || document.storageObject.scanStatus !== 'PASSED' || document.storageObject.byteSize !== document.byteSize) {
    throw new AppError('CONFLICT', 'El PDF de la cotización no está disponible.', 409);
  }
  if (document.byteSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError('CONFLICT', 'El PDF de la cotización no está disponible.', 409);
  const head = await storage.head(document.storageObject.storageKey);
  if (!head || head.contentLength !== Number(document.byteSize) || head.contentType !== PDF_CONTENT_TYPE) throw new AppError('CONFLICT', 'El PDF de la cotización no está disponible.', 409);
  const downloadUrl = await storage.createDownloadUrl({ key: document.storageObject.storageKey, expiresInSeconds });
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
  await auditDownload(prisma, actor, { id: document.id, quoteId: version.quoteId, quoteVersionId: version.id, versionNumber: version.versionNumber }, expiresInSeconds);
  return {
    document: {
      id: document.id,
      quoteId: version.quoteId,
      quoteVersionId: version.id,
      versionNumber: version.versionNumber,
      contentType: PDF_CONTENT_TYPE,
      byteSize: Number(document.byteSize),
      templateVersion: document.templateVersion,
      readyAt: document.readyAt,
    },
    downloadUrl,
    expiresAt,
  };
}

export async function getQuotePdfDownloadForQuote(actor: Actor, quoteIdInput: string, quoteVersionIdInput?: string, dependencies: QuotePdfDownloadDependencies = {}): Promise<QuotePdfDownloadResult> {
  const quoteId = requireUuid(quoteIdInput);
  const requestedVersionId = quoteVersionIdInput ? requireUuid(quoteVersionIdInput) : undefined;
  const clientId = actor.type === 'CUSTOMER' ? requireCustomerAccess(actor) : (requireStaffAccess(actor), undefined);
  const prisma = dependencies.prisma ?? getPrisma();
  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      ...(clientId ? { clientId } : { quoteRequest: staffRequestReadScopeWhere(actor) }),
    },
    select: {
      currentVersionId: true,
      publishedVersionId: true,
      ...(clientId ? {
        versions: {
          where: { status: { in: [...CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES] } },
          orderBy: [{ versionNumber: 'desc' }],
          take: 1,
          select: { id: true },
        },
      } : {}),
    },
  });
  if (!quote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  const publishedVersionId = clientId ? quote.versions[0]?.id ?? null : quote.publishedVersionId ?? quote.currentVersionId;
  const quoteVersionId = requestedVersionId ?? publishedVersionId;
  if (!quoteVersionId) throw new AppError('CONFLICT', 'La cotización no tiene una versión vigente.', 409);
  return getDownload(actor, { quoteId, quoteVersionId, ...(clientId ? { clientId } : {}) }, dependencies);
}

export async function getQuotePdfDownloadForVersion(actor: Actor, quoteVersionIdInput: string, dependencies: QuotePdfDownloadDependencies = {}): Promise<QuotePdfDownloadResult> {
  const quoteVersionId = requireUuid(quoteVersionIdInput);
  const prisma = dependencies.prisma ?? getPrisma();
  const quote = await prisma.quoteVersion.findFirst({
    where: { id: quoteVersionId, quote: { quoteRequest: staffRequestReadScopeWhere(actor) } },
    select: { quoteId: true },
  });
  if (!quote) throw new AppError('NOT_FOUND', 'La versión de cotización no existe.', 404);
  const clientId = actor.type === 'CUSTOMER' ? requireCustomerAccess(actor) : (requireStaffAccess(actor), undefined);
  return getDownload(actor, { quoteId: quote.quoteId, quoteVersionId, ...(clientId ? { clientId } : {}) }, dependencies);
}

function safeByteSize(value: bigint | null): number | null {
  if (value === null || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

export async function getQuoteDocumentStatusForVersion(actor: Actor, quoteVersionIdInput: string, dependencies: QuotePdfDownloadDependencies = {}): Promise<QuoteDocumentOperationStatus> {
  requireStaffDocumentStatusAccess(actor);
  const quoteVersionId = requireUuid(quoteVersionIdInput);
  const prisma = dependencies.prisma ?? getPrisma();
  const version = await prisma.quoteVersion.findFirst({
    where: { id: quoteVersionId, quote: { quoteRequest: staffRequestReadScopeWhere(actor) } },
    select: {
      id: true,
      quoteId: true,
      versionNumber: true,
      generatedDocuments: {
        where: { documentType: 'QUOTE_PDF' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          templateVersion: true,
          contentType: true,
          byteSize: true,
          readyAt: true,
          storageObject: { select: { storageKey: true, deletedAt: true, contentType: true, byteSize: true, scanStatus: true } },
          acceptance: { select: { id: true, signerName: true, termsVersion: true, acceptedAt: true } },
        },
      },
    },
  });
  if (!version) throw new AppError('NOT_FOUND', 'La versión de cotización no existe.', 404);

  const stored = version.generatedDocuments[0] ?? null;
  const contentType = stored?.contentType === PDF_CONTENT_TYPE ? PDF_CONTENT_TYPE : null;
  const byteSize = safeByteSize(stored?.byteSize ?? null);
  const isReady = stored?.status === 'READY';
  const documentStatus: QuoteDocumentOperationStatus['document']['status'] = stored?.status ?? 'MISSING';
  let storageVerified = false;
  if (isReady && stored?.storageObject && stored.storageObject.deletedAt === null && stored.storageObject.contentType === PDF_CONTENT_TYPE && stored.storageObject.scanStatus === 'PASSED' && byteSize !== null && stored.storageObject.byteSize === BigInt(byteSize)) {
    const storage = dependencies.storage ?? getPrivateStorage();
    const head = await storage.head(stored.storageObject.storageKey);
    storageVerified = Boolean(head && head.contentLength === byteSize && head.contentType === PDF_CONTENT_TYPE);
  }
  const canDownload = Boolean(isReady && contentType && byteSize !== null && stored?.readyAt && storageVerified);
  const canGenerate = hasPermission(actor, 'quotes.pdf.generate') && (!stored || stored.status === 'FAILED');

  return {
    quoteId: version.quoteId,
    quoteVersionId: version.id,
    versionNumber: version.versionNumber,
    contentDigest: await getQuoteVersionDigest(prisma, version.id),
    document: {
      id: stored?.id ?? null,
      status: documentStatus,
      templateVersion: stored?.templateVersion ?? null,
      contentType,
      byteSize,
      readyAt: stored?.readyAt ?? null,
    },
    acceptance: stored?.acceptance ? {
      id: stored.acceptance.id,
      signerName: stored.acceptance.signerName,
      termsVersion: stored.acceptance.termsVersion,
      acceptedAt: stored.acceptance.acceptedAt,
    } : null,
    actions: { canDownload, canGenerate },
  };
}
