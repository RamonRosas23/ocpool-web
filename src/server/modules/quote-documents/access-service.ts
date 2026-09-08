import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';

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

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  return value;
}

function requireStaffAccess(actor: Actor): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'quotes.read');
  requirePermission(actor, 'quotes.pdf.read');
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
      ...(where.clientId ? { quote: { clientId: where.clientId } } : {}),
    },
    select: {
      id: true,
      quoteId: true,
      versionNumber: true,
      generatedDocuments: {
        where: { documentType: 'QUOTE_PDF' },
        include: { storageObject: true },
        take: 1,
      },
    },
  });
  if (!version) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
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
    where: { id: quoteId, ...(clientId ? { clientId } : {}) },
    select: { currentVersionId: true },
  });
  if (!quote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  const quoteVersionId = requestedVersionId ?? quote.currentVersionId;
  if (!quoteVersionId) throw new AppError('CONFLICT', 'La cotización no tiene una versión vigente.', 409);
  return getDownload(actor, { quoteId, quoteVersionId, ...(clientId ? { clientId } : {}) }, dependencies);
}

export async function getQuotePdfDownloadForVersion(actor: Actor, quoteVersionIdInput: string, dependencies: QuotePdfDownloadDependencies = {}): Promise<QuotePdfDownloadResult> {
  const quoteVersionId = requireUuid(quoteVersionIdInput);
  const prisma = dependencies.prisma ?? getPrisma();
  const quote = await prisma.quoteVersion.findUnique({ where: { id: quoteVersionId }, select: { quoteId: true } });
  if (!quote) throw new AppError('NOT_FOUND', 'La versión de cotización no existe.', 404);
  const clientId = actor.type === 'CUSTOMER' ? requireCustomerAccess(actor) : (requireStaffAccess(actor), undefined);
  return getDownload(actor, { quoteId: quote.quoteId, quoteVersionId, ...(clientId ? { clientId } : {}) }, dependencies);
}
