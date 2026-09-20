import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { canGenerateQuotePdf } from '@/server/modules/quote-documents/domain';
import { renderQuotePdf, type QuotePdfSnapshot, type RenderedQuotePdf } from '@/server/modules/quote-documents/pdf-renderer';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';
import { requireStaffRequestReadScope } from '@/server/auth/request-scope';

const PDF_CONTENT_TYPE = 'application/pdf';
const PDF_FAILURE_CODE = 'PDF_GENERATION_FAILED';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/// P1-03: a PENDING row past this age can only mean the process that created it crashed or was
/// redeployed mid-render (no real render legitimately takes this long) -- without this, that row
/// stays wedged forever and every future attempt hits the 409 below, with no way to recover short
/// of a manual DB fix.
const PDF_PENDING_STALE_MS = 3 * 60_000;

export type QuotePdfGenerationDependencies = Readonly<{
  prisma?: PrismaClient;
  storage?: PrivateStorage;
  now?: Date;
  renderer?: (snapshot: QuotePdfSnapshot) => Promise<RenderedQuotePdf>;
}>;

export type GeneratedQuotePdfResult = Readonly<{
  id: string;
  quoteId: string;
  quoteVersionId: string;
  status: 'READY';
  templateVersion: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  readyAt: Date;
  storageKey: string;
}>;

type StoredDocument = {
  id: string;
  quoteId: string;
  quoteVersionId: string;
  status: 'PENDING' | 'READY' | 'FAILED' | 'DELETED';
  templateVersion: string;
  contentType: string;
  byteSize: bigint | null;
  sha256: string | null;
  readyAt: Date | null;
  storageObject: { storageKey: string } | null;
};

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', 'La versión no es válida.', 400);
  return value;
}

function isPrismaUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function serializeReadyDocument(document: StoredDocument): GeneratedQuotePdfResult {
  if (document.status !== 'READY' || !document.byteSize || !document.sha256 || !document.readyAt || !document.storageObject) {
    throw new AppError('CONFLICT', 'El PDF de la cotización todavía no está disponible.', 409);
  }
  return {
    id: document.id,
    quoteId: document.quoteId,
    quoteVersionId: document.quoteVersionId,
    status: 'READY',
    templateVersion: document.templateVersion,
    contentType: document.contentType,
    byteSize: Number(document.byteSize),
    sha256: document.sha256,
    readyAt: document.readyAt,
    storageKey: document.storageObject.storageKey,
  };
}

async function audit(transaction: Prisma.TransactionClient, actorUserId: string | null, action: string, entityId: string, outcome: 'SUCCESS' | 'FAILURE', metadata: Record<string, string | number | null>): Promise<void> {
  await transaction.auditLog.create({ data: { actorUserId, action, entityType: 'generated_document', entityId, outcome, metadata } });
}

async function outbox(transaction: Prisma.TransactionClient, eventType: string, document: { id: string; quoteId: string; quoteVersionId: string; templateVersion: string; byteSize: number; sha256: string; quoteRequestId: string; folio: string }): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      eventType,
      aggregateType: 'GENERATED_DOCUMENT',
      aggregateId: document.id,
      payload: {
        documentId: document.id,
        quoteId: document.quoteId,
        quoteVersionId: document.quoteVersionId,
        quoteRequestId: document.quoteRequestId,
        folio: document.folio,
        templateVersion: document.templateVersion,
        byteSize: document.byteSize,
        sha256: document.sha256,
      },
    },
  });
}

async function lockQuoteVersion(transaction: Prisma.TransactionClient, quoteVersionId: string): Promise<{ id: string; quoteId: string; status: string; currentAssigneeId: string | null } | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string; quoteId: string; status: string; currentAssigneeId: string | null }>>(Prisma.sql`
    SELECT qv."id", qv."quoteId", qv."status", qr."currentAssigneeId"
    FROM "quote_versions" qv
    INNER JOIN "quotes" q ON q."id" = qv."quoteId"
    INNER JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
    WHERE qv."id" = ${quoteVersionId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function loadSnapshot(transaction: Prisma.TransactionClient, quoteVersionId: string): Promise<{ snapshot: QuotePdfSnapshot; quoteRequestId: string }> {
  const version = await transaction.quoteVersion.findUnique({
    where: { id: quoteVersionId },
    include: {
      quote: { include: { client: true, quoteRequest: { include: { detail: true } } } },
      lines: { orderBy: { id: 'asc' } },
    },
  });
  if (!version || !version.quote.quoteRequest.detail) throw new AppError('CONFLICT', 'La cotización no tiene un expediente comercial completo.', 409);
  const detail = version.quote.quoteRequest.detail;
  return {
    quoteRequestId: version.quote.quoteRequestId,
    snapshot: {
      folio: version.quote.quoteRequest.folio,
      versionNumber: version.versionNumber,
      clientName: version.quote.client.displayName,
      projectType: detail.projectType,
      location: detail.location,
      description: detail.description,
      currencyCode: version.currencyCode,
      validUntil: version.validUntil,
      lines: version.lines.map((line) => ({
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantityMilliunits: line.quantityMilliunits,
        unitPriceMinor: line.unitPriceMinor,
        discountMinor: line.discountMinor,
        taxMinor: line.taxMinor,
        totalMinor: line.totalMinor,
      })),
      subtotalMinor: version.subtotalMinor,
      discountTotalMinor: version.discountTotalMinor,
      taxableTotalMinor: version.taxableTotalMinor,
      taxTotalMinor: version.taxTotalMinor,
      totalMinor: version.totalMinor,
    },
  };
}

function documentStorageKey(documentId: string): string {
  return `private-files/generated-documents/${documentId}.pdf`;
}

async function markFailed(prisma: PrismaClient, documentId: string, actorUserId: string | null, now: Date): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.generatedDocument.updateMany({ where: { id: documentId, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'FAILED', failureCode: PDF_FAILURE_CODE, updatedAt: now } });
    if (updated.count > 0) await audit(transaction, actorUserId, 'quote.pdf.generation_failed', documentId, 'FAILURE', { failureCode: PDF_FAILURE_CODE });
  });
}

/**
 * Invalida el PDF ya generado de una versión que vuelve a edición: `generateQuotePdf` es idempotente
 * por diseño (regresa el documento existente si ya está `READY`), así que sin este paso una versión
 * que vuelve a BORRADOR, se edita y se reenvía habría publicado el PDF viejo con el contenido previo
 * a la corrección. El borrado de la fila en base de datos es la parte que debe garantizarse (permite
 * que la siguiente generación arranque desde cero); el borrado del objeto en storage es mejor esfuerzo,
 * ya que un huérfano ahí no compromete la corrección, sólo limpieza pendiente.
 */
export async function invalidateQuoteVersionDocument(quoteVersionId: string, dependencies: QuotePdfGenerationDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const existing = await prisma.generatedDocument.findUnique({
    where: { quoteVersionId_documentType: { quoteVersionId, documentType: 'QUOTE_PDF' } },
    include: { storageObject: true },
  });
  if (!existing) return;
  const storageKey = existing.storageObject?.storageKey ?? null;
  const storageObjectId = existing.storageObjectId;
  await prisma.$transaction([
    prisma.generatedDocument.delete({ where: { id: existing.id } }),
    ...(storageObjectId ? [prisma.storageObject.delete({ where: { id: storageObjectId } })] : []),
  ]);
  if (storageKey) {
    try {
      await storage.delete(storageKey);
    } catch {
      // Huérfano en storage; limpieza best-effort. La fila ya fue eliminada, que es lo que importa para la corrección.
    }
  }
}

export async function generateQuotePdf(actor: Actor | null, quoteVersionIdInput: string, dependencies: QuotePdfGenerationDependencies = {}): Promise<GeneratedQuotePdfResult> {
  if (!actor || actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'quotes.read');
  requirePermission(actor, 'quotes.pdf.generate');
  const quoteVersionId = requireUuid(quoteVersionIdInput);
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const renderer = dependencies.renderer ?? renderQuotePdf;
  const now = dependencies.now ?? new Date();
  const actorUserId = actor.userId;

  let pendingDocument: StoredDocument;
  let snapshot: QuotePdfSnapshot;
  let snapshotQuoteRequestId: string;
  try {
    const prepared = await prisma.$transaction(async (transaction) => {
      const lockedVersion = await lockQuoteVersion(transaction, quoteVersionId);
      if (!lockedVersion) throw new AppError('NOT_FOUND', 'La versión de cotización no existe.', 404);
      requireStaffRequestReadScope(actor, lockedVersion.currentAssigneeId);
      if (!canGenerateQuotePdf(lockedVersion.status)) throw new AppError('CONFLICT', 'La versión todavía no puede convertirse en PDF comercial.', 409);

      const existing = await transaction.generatedDocument.findUnique({
        where: { quoteVersionId_documentType: { quoteVersionId, documentType: 'QUOTE_PDF' } },
        include: { storageObject: true },
      });
      if (existing?.status === 'READY') return { existing: existing as StoredDocument };
      if (existing?.status === 'PENDING' && now.getTime() - existing.updatedAt.getTime() < PDF_PENDING_STALE_MS) {
        throw new AppError('CONFLICT', 'El PDF de la cotización está en preparación.', 409);
      }
      if (existing?.status === 'DELETED') throw new AppError('CONFLICT', 'El PDF de la cotización fue retirado y no puede regenerarse desde este flujo.', 409);

      const document = existing
        ? await transaction.generatedDocument.update({ where: { id: existing.id }, data: { status: 'PENDING', failureCode: null, deletedAt: null }, include: { storageObject: true } })
        : await transaction.generatedDocument.create({ data: { quoteId: lockedVersion.quoteId, quoteVersionId, templateVersion: 'quote-pdf-v1', contentType: PDF_CONTENT_TYPE, generatedAt: now }, include: { storageObject: true } });
      ({ snapshot, quoteRequestId: snapshotQuoteRequestId } = await loadSnapshot(transaction, quoteVersionId));
      return { pending: document as StoredDocument };
    });
    if ('existing' in prepared && prepared.existing) return serializeReadyDocument(prepared.existing);
    if (!('pending' in prepared) || !prepared.pending) throw new AppError('CONFLICT', 'El PDF de la cotización no pudo iniciar su preparación.', 409);
    pendingDocument = prepared.pending;
  } catch (error) {
    if (isPrismaUniqueError(error)) throw new AppError('CONFLICT', 'El PDF de la cotización ya está siendo preparado.', 409);
    throw error;
  }

  let rendered: RenderedQuotePdf;
  let uploadedKey: string | null = null;
  try {
    rendered = await renderer(snapshot!);
    const key = documentStorageKey(pendingDocument.id);
    await storage.ensureBucket();
    await storage.put({ key, body: rendered.bytes, contentType: PDF_CONTENT_TYPE });
    uploadedKey = key;
    const head = await storage.head(key);
    if (!head || head.contentLength !== rendered.byteSize || head.contentType !== PDF_CONTENT_TYPE) throw new Error('Generated PDF storage verification failed.');

    const ready = await prisma.$transaction(async (transaction) => {
      const current = await transaction.generatedDocument.findUnique({ where: { id: pendingDocument.id }, include: { storageObject: true } });
      if (!current) throw new AppError('NOT_FOUND', 'El documento generado no existe.', 404);
      if (current.status === 'READY') return current as StoredDocument;
      if (current.status !== 'PENDING') throw new AppError('CONFLICT', 'El documento generado ya no puede finalizarse.', 409);
      const storageObject = await transaction.storageObject.create({
        data: {
          storageKey: key,
          contentType: PDF_CONTENT_TYPE,
          byteSize: BigInt(rendered.byteSize),
          sha256: rendered.sha256,
          scanStatus: 'PASSED',
          scannerName: 'quote-pdf-renderer',
          verifiedAt: now,
        },
      });
      const updated = await transaction.generatedDocument.update({ where: { id: current.id }, data: { status: 'READY', storageObjectId: storageObject.id, byteSize: BigInt(rendered.byteSize), sha256: rendered.sha256, readyAt: now, failureCode: null }, include: { storageObject: true } });
      await audit(transaction, actorUserId, 'quote.pdf.generated', updated.id, 'SUCCESS', { quoteId: updated.quoteId, quoteVersionId: updated.quoteVersionId, templateVersion: updated.templateVersion, byteSize: rendered.byteSize, sha256: rendered.sha256 });
      await outbox(transaction, 'QUOTE.PDF_READY', { id: updated.id, quoteId: updated.quoteId, quoteVersionId: updated.quoteVersionId, quoteRequestId: snapshotQuoteRequestId, folio: snapshot.folio, templateVersion: updated.templateVersion, byteSize: rendered.byteSize, sha256: rendered.sha256 });
      return updated as StoredDocument;
    });
    return serializeReadyDocument(ready);
  } catch (error) {
    if (uploadedKey) {
      try { await storage.delete(uploadedKey); } catch { /* reconciliation can retry the orphaned object */ }
    }
    await markFailed(prisma, pendingDocument.id, actorUserId, now);
    if (error instanceof AppError) throw error;
    throw new AppError('CONFLICT', 'No fue posible preparar el PDF de la cotización.', 409);
  }
}
