import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { requireStaffRequestReadScope, staffRequestReadScopeWhere } from '@/server/auth/request-scope';
import { normalizeIdempotencyKey } from '@/server/modules/messaging/domain';
import {
  assertUploadMetadata,
  buildStorageKey,
  isFileDeliverable,
  type FileCategory,
  type FileVisibility,
} from '@/server/modules/private-files/domain';
import { scanPrivateFile } from '@/server/modules/private-files/scanner';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESERVATION_TTL_MINUTES = 15;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60;
const MAX_LIST_LIMIT = 100;
const UPLOAD_RATE_LIMIT_SCOPE = 'private-file-reserve';
const UPLOAD_RATE_LIMIT_MAX_ATTEMPTS = 10;
const UPLOAD_RATE_LIMIT_WINDOW_MINUTES = 10;

export type PrivateFilesServiceDependencies = Readonly<{
  prisma?: PrismaClient;
  storage?: PrivateStorage;
  now?: Date;
  rateLimit?: (input: { key: string; now: Date }) => Promise<{ allowed: boolean }>;
}>;

export type ReservePrivateFileInput = Readonly<{
  quoteRequestId: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  category: FileCategory;
  visibility: FileVisibility;
  idempotencyKey: string;
}>;

export type PrivateFileListFilters = Readonly<{
  cursor?: string;
  limit?: number;
}>;

type LockedRequest = {
  id: string;
  folio: string;
  clientId: string;
  currentAssigneeId: string | null;
};

type AttachmentWithObject = Prisma.FileAttachmentGetPayload<{ include: { storageObject: true } }>;

function requireUuid(value: string, message: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', message, 400);
  return value;
}

function requireActorScope(actor: Actor, permission: string, quoteRequestId: string): string | undefined {
  requireUuid(quoteRequestId, 'El expediente no es válido.');
  if (actor.type === 'CUSTOMER') {
    if (!actor.clientId) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
    requirePermission(actor, permission);
    return actor.clientId;
  }
  requirePermission(actor, 'requests.read');
  requirePermission(actor, permission);
  return undefined;
}

function normalizeReservationInput(input: ReservePrivateFileInput) {
  if (!input || typeof input.idempotencyKey !== 'string') throw new AppError('VALIDATION_ERROR', 'El archivo no es válido.', 400);
  try {
    const metadata = assertUploadMetadata({
      originalFileName: input.originalFileName,
      contentType: input.contentType,
      byteSize: input.byteSize,
      category: input.category,
      visibility: input.visibility,
    });
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    return { ...metadata, idempotencyKeyHash: fingerprintToken(idempotencyKey) };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El archivo no es válido.', 400);
  }
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new AppError('VALIDATION_ERROR', 'El límite de archivos no es válido.', 400);
  return limit;
}

function encodeCursor(file: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: file.createdAt.toISOString(), id: file.id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string' || !UUID_PATTERN.test(decoded.id)) throw new Error('Invalid cursor.');
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error('Invalid cursor.');
    return { createdAt, id: decoded.id };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El cursor no es válido.', 400);
  }
}

async function lockQuoteRequest(transaction: Prisma.TransactionClient, quoteRequestId: string, clientId?: string): Promise<LockedRequest | null> {
  const rows = await transaction.$queryRaw<LockedRequest[]>(Prisma.sql`
    SELECT "id", "folio", "clientId", "currentAssigneeId"
    FROM "quote_requests"
    WHERE "id" = ${quoteRequestId}
      ${clientId ? Prisma.sql`AND "clientId" = ${clientId}` : Prisma.empty}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

// UX audit fix: `files.delete` sólo autoriza borrar archivos PROPIOS (ver su descripción en
// `auth/constants.ts`) -- `deletePrivateFile` ya lo exige (`canManage || uploadedById === actor.userId`),
// pero el archivo serializado nunca traía esa información, así que tanto el panel de staff como el
// del cliente mostraban "Eliminar archivo" en CUALQUIER fila con sólo tener el permiso, sin importar
// quién lo subió -- un callejón sin salida garantizado (confirmación irreversible seguida de un 403)
// para cualquier rol sin `files.manage` (el rol "Ventas" por defecto, y todo cliente) en cuanto
// intentaran borrar un archivo ajeno. `canDelete` se calcula aquí, con la misma regla exacta que el
// borrado real, en vez de exponer `uploadedById` crudo al cliente.
function serializeFile(attachment: AttachmentWithObject, actor: Actor, includeInternal: boolean) {
  const canManage = actor.type === 'EMPLOYEE' && actor.permissionKeys.has('files.manage');
  const canDelete = actor.permissionKeys.has('files.delete') && (canManage || attachment.uploadedById === actor.userId);
  return {
    id: attachment.id,
    originalFileName: attachment.originalFileName,
    category: attachment.category,
    ...(includeInternal ? { visibility: attachment.visibility } : {}),
    status: attachment.status,
    contentType: attachment.storageObject.contentType,
    byteSize: attachment.storageObject.byteSize.toString(),
    scanStatus: attachment.storageObject.scanStatus,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    downloadAvailable: attachment.status === 'AVAILABLE' && attachment.storageObject.scanStatus === 'PASSED',
    canDelete,
  };
}

function sameReservation(attachment: AttachmentWithObject, input: ReturnType<typeof normalizeReservationInput>, quoteRequestId: string, clientId: string): boolean {
  return attachment.quoteRequestId === quoteRequestId
    && attachment.clientId === clientId
    && attachment.originalFileName === input.originalFileName
    && attachment.storageObject.contentType === input.contentType
    && attachment.storageObject.byteSize === BigInt(input.byteSize)
    && attachment.category === input.category
    && attachment.visibility === input.visibility;
}

async function audit(transaction: Prisma.TransactionClient, actorUserId: string | null, action: string, entityId: string, metadata: Record<string, string | number | null>): Promise<void> {
  await transaction.auditLog.create({ data: { actorUserId, action, entityType: 'file_attachment', entityId, outcome: 'SUCCESS', metadata } });
}

async function outbox(transaction: Prisma.TransactionClient, eventType: string, attachment: { id: string; quoteRequestId: string; visibility: FileVisibility; category: FileCategory }): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      eventType,
      aggregateType: 'FILE_ATTACHMENT',
      aggregateId: attachment.id,
      payload: { fileId: attachment.id, quoteRequestId: attachment.quoteRequestId, visibility: attachment.visibility, category: attachment.category },
    },
  });
}

export async function reservePrivateFile(actor: Actor, input: ReservePrivateFileInput, dependencies: PrivateFilesServiceDependencies = {}) {
  const clientId = requireActorScope(actor, 'files.upload', input.quoteRequestId);
  const normalized = normalizeReservationInput(input);
  if (actor.type === 'CUSTOMER' && normalized.visibility === 'INTERNAL') throw new AppError('FORBIDDEN', 'No tienes permisos para cargar archivos internos.', 403);
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();
  const reservationExpiresAt = new Date(now.getTime() + RESERVATION_TTL_MINUTES * 60_000);
  const rateLimit = dependencies.rateLimit ?? (async ({ key, now: rateLimitNow }) => checkAuthRateLimit({ scope: UPLOAD_RATE_LIMIT_SCOPE, key, maxAttempts: UPLOAD_RATE_LIMIT_MAX_ATTEMPTS, windowMinutes: UPLOAD_RATE_LIMIT_WINDOW_MINUTES, now: rateLimitNow }));
  const rateLimitDecision = await rateLimit({ key: `${actor.userId}:${input.quoteRequestId}`, now });
  if (!rateLimitDecision.allowed) throw new AppError('RATE_LIMITED', 'Has alcanzado el límite temporal de cargas.', 429);

  await storage.ensureBucket();
  const attachment = await prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, input.quoteRequestId, clientId);
    if (!request) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
    if (actor.type === 'EMPLOYEE') requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const existing = await transaction.fileAttachment.findUnique({
      where: { uploadedById_reservationKeyHash: { uploadedById: actor.userId, reservationKeyHash: normalized.idempotencyKeyHash } },
      include: { storageObject: true },
    });
    if (existing) {
      if (!sameReservation(existing, normalized, request.id, request.clientId)) throw new AppError('CONFLICT', 'La clave de carga ya fue utilizada.', 409);
      if (existing.status === 'DELETED' || existing.status === 'REJECTED') throw new AppError('CONFLICT', 'La reserva de archivo ya no está disponible.', 409);
      return existing;
    }
    const attachmentId = crypto.randomUUID();
    const storageObject = await transaction.storageObject.create({
      data: {
        id: crypto.randomUUID(),
        storageKey: buildStorageKey(attachmentId),
        contentType: normalized.contentType,
        byteSize: BigInt(normalized.byteSize),
        sha256: null,
      },
    });
    const created = await transaction.fileAttachment.create({
      data: {
        id: attachmentId,
        quoteRequestId: request.id,
        clientId: request.clientId,
        storageObjectId: storageObject.id,
        originalFileName: normalized.originalFileName,
        category: normalized.category,
        visibility: normalized.visibility,
        uploadedById: actor.userId,
        reservationKeyHash: normalized.idempotencyKeyHash,
        reservationExpiresAt,
      },
      include: { storageObject: true },
    });
    await audit(transaction, actor.userId, 'file.reserved', created.id, { quoteRequestId: request.id, folio: request.folio, category: created.category, byteSize: normalized.byteSize });
    await outbox(transaction, 'FILE.UPLOAD_RESERVED', created);
    return created;
  });

  if (attachment.status === 'AVAILABLE') {
    return { file: serializeFile(attachment, actor, actor.type === 'EMPLOYEE'), uploadUrl: null, uploadExpiresAt: null };
  }
  const uploadUrl = await storage.createUploadUrl({ key: attachment.storageObject.storageKey, contentType: attachment.storageObject.contentType, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
  return { file: serializeFile(attachment, actor, actor.type === 'EMPLOYEE'), uploadUrl, uploadExpiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000) };
}

async function markRejected(actor: Actor, attachmentId: string, quoteRequestId: string, reason: string, dependencies: PrivateFilesServiceDependencies, storageKey: string) {
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  await prisma.$transaction(async (transaction) => {
    const existing = await transaction.fileAttachment.findUnique({ where: { id: attachmentId } });
    if (!existing || existing.status === 'DELETED') return;
    await transaction.storageObject.update({ where: { id: existing.storageObjectId }, data: { scanStatus: 'REJECTED', scannerName: 'basic-signature-v1', scanReason: reason, scannedAt: now } });
    const rejected = await transaction.fileAttachment.update({ where: { id: existing.id }, data: { status: 'REJECTED' }, include: { storageObject: true } });
    await audit(transaction, actor.userId, 'file.rejected', rejected.id, { quoteRequestId, reason, category: rejected.category });
  });
  try { await (dependencies.storage ?? getPrivateStorage()).delete(storageKey); } catch { /* metadata remains inaccessible; cleanup can retry by key */ }
}

export async function completePrivateFile(actor: Actor, quoteRequestId: string, fileId: string, dependencies: PrivateFilesServiceDependencies = {}) {
  const clientId = requireActorScope(actor, 'files.upload', quoteRequestId);
  requireUuid(fileId, 'El archivo no es válido.');
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();
  const scopedRequest = await prisma.quoteRequest.findFirst({
    where: {
      id: quoteRequestId,
      ...(clientId ? { clientId } : {}),
      ...(actor.type === 'EMPLOYEE' ? staffRequestReadScopeWhere(actor) : {}),
    },
    select: { id: true },
  });
  if (!scopedRequest) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
  const pending = await prisma.fileAttachment.findFirst({ where: { id: fileId, quoteRequestId, ...(clientId ? { clientId } : {}), deletedAt: null }, include: { storageObject: true } });
  if (!pending) throw new AppError('NOT_FOUND', 'El archivo no existe.', 404);
  if (pending.status === 'AVAILABLE') return { file: serializeFile(pending, actor, actor.type === 'EMPLOYEE') };
  if (pending.status !== 'PENDING_SCAN') throw new AppError('CONFLICT', 'El archivo ya no puede completarse.', 409);
  if (pending.reservationExpiresAt && pending.reservationExpiresAt < now) {
    await prisma.$transaction(async (transaction) => {
      await transaction.fileAttachment.update({ where: { id: pending.id }, data: { status: 'DELETED', deletedAt: now } });
      await transaction.storageObject.update({ where: { id: pending.storageObjectId }, data: { deletedAt: now } });
    });
    try { await storage.delete(pending.storageObject.storageKey); } catch { /* cleanup may retry */ }
    throw new AppError('CONFLICT', 'La reserva del archivo expiró.', 409);
  }
  const head = await storage.head(pending.storageObject.storageKey);
  if (!head) {
    await markRejected(actor, pending.id, quoteRequestId, 'OBJECT_NOT_FOUND', dependencies, pending.storageObject.storageKey);
    throw new AppError('VALIDATION_ERROR', 'El archivo no está disponible para validación.', 400);
  }
  // La URL prefirmada de subida no impone un límite de tamaño (S3 no lo soporta sin una condición
  // de política explícita), así que quien sube el archivo puede mandar un objeto arbitrariamente
  // grande sin importar el `byteSize` declarado al reservar -- rechazar aquí con el `contentLength`
  // barato de HEAD evita cargar en memoria un objeto de varios GB sólo para descubrir después, ya
  // con todo leído, que `scanPrivateFile` lo iba a rechazar por el mismo motivo (`SIZE_MISMATCH`).
  if (head.contentLength !== Number(pending.storageObject.byteSize)) {
    await markRejected(actor, pending.id, quoteRequestId, 'SIZE_MISMATCH', dependencies, pending.storageObject.storageKey);
    throw new AppError('VALIDATION_ERROR', 'El archivo no superó la validación.', 400);
  }
  let scanResult: ReturnType<typeof scanPrivateFile>;
  try {
    const bytes = await storage.read(pending.storageObject.storageKey);
    scanResult = scanPrivateFile({ originalFileName: pending.originalFileName, contentType: head.contentType ?? pending.storageObject.contentType, byteSize: Number(pending.storageObject.byteSize), category: pending.category, visibility: pending.visibility }, bytes);
  } catch {
    await markRejected(actor, pending.id, quoteRequestId, 'VALIDATION_ERROR', dependencies, pending.storageObject.storageKey);
    throw new AppError('VALIDATION_ERROR', 'El archivo no superó la validación.', 400);
  }
  const result = await prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, quoteRequestId, clientId);
    if (!request) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
    if (actor.type === 'EMPLOYEE') requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const current = await transaction.fileAttachment.findUnique({ where: { id: pending.id }, include: { storageObject: true } });
    if (!current) throw new AppError('NOT_FOUND', 'El archivo no existe.', 404);
    if (current.status === 'AVAILABLE') return current;
    if (current.status !== 'PENDING_SCAN') throw new AppError('CONFLICT', 'El archivo ya no puede completarse.', 409);
    const updatedObject = await transaction.storageObject.update({ where: { id: current.storageObjectId }, data: { sha256: scanResult.sha256, scanStatus: scanResult.status, scannerName: scanResult.scannerName, scanReason: scanResult.reason, scannedAt: now, verifiedAt: scanResult.status === 'PASSED' ? now : null } });
    const updated = await transaction.fileAttachment.update({ where: { id: current.id }, data: { status: scanResult.status === 'PASSED' ? 'AVAILABLE' : 'REJECTED', reservationExpiresAt: null }, include: { storageObject: true } });
    await audit(transaction, actor.userId, scanResult.status === 'PASSED' ? 'file.available' : 'file.rejected', updated.id, { quoteRequestId: request.id, folio: request.folio, category: updated.category, reason: scanResult.reason });
    if (scanResult.status === 'PASSED') await outbox(transaction, 'FILE.AVAILABLE', updated);
    return { ...updated, storageObject: updatedObject };
  });
  if (!isFileDeliverable(result.status)) {
    try { await storage.delete(result.storageObject.storageKey); } catch { /* cleanup can retry */ }
    throw new AppError('VALIDATION_ERROR', 'El archivo no superó la validación.', 400);
  }
  return { file: serializeFile(result, actor, actor.type === 'EMPLOYEE') };
}

export async function listPrivateFilesPage(actor: Actor, quoteRequestId: string, filters: PrivateFileListFilters = {}, dependencies: PrivateFilesServiceDependencies = {}) {
  const clientId = requireActorScope(actor, 'files.read', quoteRequestId);
  const prisma = dependencies.prisma ?? getPrisma();
  const limit = normalizeLimit(filters.limit);
  const cursor = decodeCursor(filters.cursor);
  const request = await prisma.quoteRequest.findFirst({
    where: {
      id: quoteRequestId,
      ...(clientId ? { clientId } : {}),
      ...(actor.type === 'EMPLOYEE' ? staffRequestReadScopeWhere(actor) : {}),
    },
    select: { id: true },
  });
  if (!request) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
  const includeInternal = actor.type === 'EMPLOYEE' && actor.permissionKeys.has('files.internal.read');
  const files = await prisma.fileAttachment.findMany({
    where: {
      quoteRequestId,
      ...(clientId ? { clientId } : {}),
      status: { not: 'DELETED' },
      ...(includeInternal ? {} : { visibility: 'CUSTOMER' }),
      ...(cursor ? {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      } : {}),
    },
    include: { storageObject: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const hasNext = files.length > limit;
  const items = (hasNext ? files.slice(0, limit) : files).map((file) => serializeFile(file, actor, actor.type === 'EMPLOYEE'));
  return { items, nextCursor: hasNext ? encodeCursor(files[limit - 1]) : null };
}

export async function listPrivateFiles(actor: Actor, quoteRequestId: string, filters: PrivateFileListFilters = {}, dependencies: PrivateFilesServiceDependencies = {}) {
  const page = await listPrivateFilesPage(actor, quoteRequestId, filters, dependencies);
  return page.items;
}

export async function getPrivateFileDownload(actor: Actor, quoteRequestId: string, fileId: string, dependencies: PrivateFilesServiceDependencies = {}) {
  const clientId = requireActorScope(actor, 'files.download', quoteRequestId);
  requireUuid(fileId, 'El archivo no es válido.');
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const scopedRequest = await prisma.quoteRequest.findFirst({
    where: {
      id: quoteRequestId,
      ...(clientId ? { clientId } : {}),
      ...(actor.type === 'EMPLOYEE' ? staffRequestReadScopeWhere(actor) : {}),
    },
    select: { id: true },
  });
  if (!scopedRequest) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
  const file = await prisma.fileAttachment.findFirst({ where: { id: fileId, quoteRequestId, ...(clientId ? { clientId } : {}), status: 'AVAILABLE', deletedAt: null, storageObject: { is: { scanStatus: 'PASSED', deletedAt: null } }, ...(actor.type === 'EMPLOYEE' && actor.permissionKeys.has('files.internal.read') ? {} : { visibility: 'CUSTOMER' }) }, include: { storageObject: true } });
  if (!file) throw new AppError('NOT_FOUND', 'El archivo no existe.', 404);
  const downloadUrl = await storage.createDownloadUrl({ key: file.storageObject.storageKey, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
  await prisma.auditLog.create({ data: { actorUserId: actor.userId, action: 'file.download_url_created', entityType: 'file_attachment', entityId: file.id, outcome: 'SUCCESS', metadata: { quoteRequestId, category: file.category } } });
  return { file: serializeFile(file, actor, actor.type === 'EMPLOYEE'), downloadUrl, expiresAt: new Date((dependencies.now ?? new Date()).getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
}

export async function deletePrivateFile(actor: Actor, quoteRequestId: string, fileId: string, dependencies: PrivateFilesServiceDependencies = {}) {
  const clientId = requireActorScope(actor, 'files.delete', quoteRequestId);
  requireUuid(fileId, 'El archivo no es válido.');
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();
  const deleted = await prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, quoteRequestId, clientId);
    if (!request) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
    if (actor.type === 'EMPLOYEE') requireStaffRequestReadScope(actor, request.currentAssigneeId);
    const current = await transaction.fileAttachment.findFirst({ where: { id: fileId, quoteRequestId, ...(clientId ? { clientId } : {}), deletedAt: null }, include: { storageObject: true } });
    if (!current) throw new AppError('NOT_FOUND', 'El archivo no existe.', 404);
    const canManage = actor.type === 'EMPLOYEE' && actor.permissionKeys.has('files.manage');
    if (!canManage && current.uploadedById !== actor.userId) throw new AppError('FORBIDDEN', 'No tienes permisos para borrar este archivo.', 403);
    const updated = await transaction.fileAttachment.update({ where: { id: current.id }, data: { status: 'DELETED', deletedAt: now }, include: { storageObject: true } });
    await transaction.storageObject.update({ where: { id: current.storageObjectId }, data: { deletedAt: now } });
    await audit(transaction, actor.userId, 'file.deleted', updated.id, { quoteRequestId: request.id, folio: request.folio, category: updated.category });
    await outbox(transaction, 'FILE.DELETED', updated);
    return updated;
  });
  try { await storage.delete(deleted.storageObject.storageKey); } catch { /* metadata remains inaccessible; cleanup can retry */ }
  return { fileId: deleted.id, status: 'DELETED' as const };
}

export async function cleanupExpiredPrivateFiles(dependencies: PrivateFilesServiceDependencies = {}) {
  const prisma = dependencies.prisma ?? getPrisma();
  const storage = dependencies.storage ?? getPrivateStorage();
  const now = dependencies.now ?? new Date();
  const expired = await prisma.fileAttachment.findMany({ where: { status: 'PENDING_SCAN', reservationExpiresAt: { lt: now }, deletedAt: null }, include: { storageObject: true }, take: 100 });
  let cleaned = 0;
  for (const candidate of expired) {
    const deleted = await prisma.$transaction(async (transaction) => {
      const current = await transaction.fileAttachment.findFirst({ where: { id: candidate.id, status: 'PENDING_SCAN', reservationExpiresAt: { lt: now }, deletedAt: null }, include: { storageObject: true } });
      if (!current) return null;
      const updated = await transaction.fileAttachment.update({ where: { id: current.id }, data: { status: 'DELETED', deletedAt: now }, include: { storageObject: true } });
      await transaction.storageObject.update({ where: { id: current.storageObjectId }, data: { deletedAt: now } });
      await audit(transaction, null, 'file.reservation_expired', updated.id, { quoteRequestId: updated.quoteRequestId, category: updated.category });
      await outbox(transaction, 'FILE.RESERVATION_EXPIRED', updated);
      return updated;
    });
    if (!deleted) continue;
    cleaned += 1;
    try { await storage.delete(deleted.storageObject.storageKey); } catch { /* a future reconciliation can retry physical cleanup */ }
  }
  return { cleaned };
}
