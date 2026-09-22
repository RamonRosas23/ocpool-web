import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import {
  completePrivateFile,
  cleanupExpiredPrivateFiles,
  deletePrivateFile,
  getPrivateFileDownload,
  listPrivateFiles,
  listPrivateFilesPage,
  reservePrivateFile,
} from '@/server/modules/private-files/service';
import type { PrivateStorage } from '@/server/modules/private-files/storage';

class MemoryPrivateStorage implements PrivateStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  private readonly tokens = new Map<string, string>();
  readCallCount = 0;

  async ensureBucket(): Promise<void> {}

  async createUploadUrl({ key }: { key: string; contentType: string; expiresInSeconds: number }): Promise<string> {
    const token = `upload-${crypto.randomUUID()}`;
    this.tokens.set(token, key);
    return `memory://${token}`;
  }

  async createDownloadUrl({ key }: { key: string; expiresInSeconds: number }): Promise<string> {
    const token = `download-${crypto.randomUUID()}`;
    this.tokens.set(token, key);
    return `memory://${token}`;
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null;
  }

  async read(key: string): Promise<Uint8Array> {
    this.readCallCount += 1;
    const object = this.objects.get(key);
    if (!object) throw new Error('missing');
    return object.body;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async put(input: { key: string; body: Uint8Array; contentType: string } | string, uploadBody?: Uint8Array, uploadContentType?: string): Promise<void> {
    if (typeof input !== 'string') {
      this.objects.set(input.key, { body: input.body, contentType: input.contentType });
      return;
    }
    const token = input.replace('memory://', '');
    const key = this.tokens.get(token);
    if (!key || !uploadBody || !uploadContentType) throw new Error('invalid upload token');
    this.objects.set(key, { body: uploadBody, contentType: uploadContentType });
  }

  keyForToken(tokenUrl: string): string | undefined {
    return this.tokens.get(tokenUrl.replace('memory://', ''));
  }
}

function actor(userId: string, type: Actor['type'], clientId: string | null, roles: readonly string[]): Actor {
  return { userId, type, clientId, permissionKeys: permissionKeysForRoles(roles), mfaVerified: true };
}

describe('private file transactional service', () => {
  it('reserves, verifies, completes and replays a customer upload without exposing storage keys', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const storage = new MemoryPrivateStorage();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T09:00:00.000Z');
    const request = await createQuoteRequest({ idempotencyKey: `private-files-service-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Private service ${suffix}`, email: `private-service-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Private service fixture', consentAt: now } }, { prisma, now });
    const user = await prisma.user.create({ data: { email: `private-customer-${suffix}@example.test`, emailNormalized: `private-customer-${suffix}@example.test`, displayName: 'Private customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const customer = actor(user.id, 'CUSTOMER', request.clientId, ['customer']);
    const pdf = new TextEncoder().encode('%PDF-');
    const fileIds: string[] = [];

    try {
      const reserved = await reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'planos.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'TECHNICAL_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `file-upload-${suffix}` }, { prisma, storage, now });
      fileIds.push(reserved.file.id);
      expect(reserved.file.status).toBe('PENDING_SCAN');
      expect(reserved.uploadUrl).toBeTypeOf('string');
      expect(JSON.stringify(reserved)).not.toContain('private-files/');
      const storageKey = storage.keyForToken(reserved.uploadUrl!);
      expect(storageKey).toMatch(/^private-files\//u);
      storage.put(reserved.uploadUrl!, pdf, 'application/pdf');

      const completed = await completePrivateFile(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now });
      expect(completed.file.status).toBe('AVAILABLE');
      expect(completed.file.downloadAvailable).toBe(true);
      expect(completed.file.byteSize).toBe('5');
      const replay = await reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'planos.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'TECHNICAL_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `file-upload-${suffix}` }, { prisma, storage, now: new Date(now.getTime() + 1_000) });
      expect(replay.file.id).toBe(reserved.file.id);
      expect(replay.uploadUrl).toBeNull();
      const concurrent = await Promise.all([
        reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'concurrent.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'TECHNICAL_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `concurrent-upload-${suffix}` }, { prisma, storage, now }),
        reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'concurrent.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'TECHNICAL_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `concurrent-upload-${suffix}` }, { prisma, storage, now }),
      ]);
      concurrent.forEach(({ file }) => fileIds.push(file.id));
      expect(new Set(concurrent.map(({ file }) => file.id)).size).toBe(1);

      const listed = await listPrivateFiles(customer, request.quoteRequestId, {}, { prisma });
      expect(listed).toHaveLength(2);
      expect(listed.find(({ id }) => id === reserved.file.id)).toMatchObject({ status: 'AVAILABLE' });
      const firstPage = await listPrivateFilesPage(customer, request.quoteRequestId, { limit: 1 }, { prisma });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).toBeTypeOf('string');
      const secondPage = await listPrivateFilesPage(customer, request.quoteRequestId, { limit: 1, cursor: firstPage.nextCursor! }, { prisma });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
      await expect(listPrivateFilesPage(customer, request.quoteRequestId, { cursor: 'invalid-cursor' }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const download = await getPrivateFileDownload(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now });
      expect(download.downloadUrl).toMatch(/^memory:\/\/download-/u);
      expect(JSON.stringify(download.file)).not.toContain('private-files/');
      expect(await prisma.outboxEvent.count({ where: { aggregateId: reserved.file.id, eventType: 'FILE.AVAILABLE' } })).toBe(1);
      await expect(deletePrivateFile(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).resolves.toMatchObject({ status: 'DELETED' });
      await expect(getPrivateFileDownload(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    } finally {
      const storageObjects = await prisma.fileAttachment.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { storageObjectId: true } });
      await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.storageObject.deleteMany({ where: { id: { in: storageObjects.map(({ storageObjectId }) => storageObjectId) } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      if (fileIds.length) await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: fileIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      if (fileIds.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: fileIds } } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);

  it('keeps internal files out of customer projections and blocks customer internal uploads', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const storage = new MemoryPrivateStorage();
    const suffix = `${Date.now()}-internal`;
    const now = new Date('2026-09-08T09:10:00.000Z');
    const request = await createQuoteRequest({ idempotencyKey: `private-files-internal-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Private internal ${suffix}`, email: `private-internal-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Private internal fixture', consentAt: now } }, { prisma, now });
    const [customerUser, managerUser] = await Promise.all([
      prisma.user.create({ data: { email: `private-customer-${suffix}@example.test`, emailNormalized: `private-customer-${suffix}@example.test`, displayName: 'Private customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } }),
      prisma.user.create({ data: { email: `private-manager-${suffix}@example.test`, emailNormalized: `private-manager-${suffix}@example.test`, displayName: 'Private manager', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    const customer = actor(customerUser.id, 'CUSTOMER', request.clientId, ['customer']);
    const manager = actor(managerUser.id, 'EMPLOYEE', null, ['manager']);
    const pdf = new TextEncoder().encode('%PDF-');
    let fileId: string | undefined;

    try {
      await expect(reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'interno.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'INTERNAL_DOCUMENT', visibility: 'INTERNAL', idempotencyKey: `internal-customer-${suffix}` }, { prisma, storage, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      const reserved = await reservePrivateFile(manager, { quoteRequestId: request.quoteRequestId, originalFileName: 'interno.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'INTERNAL_DOCUMENT', visibility: 'INTERNAL', idempotencyKey: `internal-manager-${suffix}` }, { prisma, storage, now });
      fileId = reserved.file.id;
      storage.put(reserved.uploadUrl!, pdf, 'application/pdf');
      await completePrivateFile(manager, request.quoteRequestId, reserved.file.id, { prisma, storage, now });
      expect(await listPrivateFiles(customer, request.quoteRequestId, {}, { prisma })).toEqual([]);
      expect((await listPrivateFiles(manager, request.quoteRequestId, {}, { prisma }))[0]).toMatchObject({ visibility: 'INTERNAL', status: 'AVAILABLE' });
      await expect(getPrivateFileDownload(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    } finally {
      const storageObjects = await prisma.fileAttachment.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { storageObjectId: true } });
      await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.storageObject.deleteMany({ where: { id: { in: storageObjects.map(({ storageObjectId }) => storageObjectId) } } });
      if (fileId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: fileId } });
        await prisma.auditLog.deleteMany({ where: { entityId: fileId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: [customerUser.id, managerUser.id] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);

  it('cleans expired reservations without exposing or retaining the object', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const storage = new MemoryPrivateStorage();
    const suffix = `${Date.now()}-expiry`;
    const now = new Date('2026-09-08T09:20:00.000Z');
    const request = await createQuoteRequest({ idempotencyKey: `private-files-expiry-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Private expiry ${suffix}`, email: `private-expiry-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Private expiry fixture', consentAt: now } }, { prisma, now });
    const user = await prisma.user.create({ data: { email: `private-expiry-user-${suffix}@example.test`, emailNormalized: `private-expiry-user-${suffix}@example.test`, displayName: 'Private expiry user', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const customer = actor(user.id, 'CUSTOMER', request.clientId, ['customer']);
    let fileId: string | undefined;

    try {
      const reserved = await reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'pending.pdf', contentType: 'application/pdf', byteSize: 5, category: 'TECHNICAL_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `expiry-${suffix}` }, { prisma, storage, now });
      fileId = reserved.file.id;
      storage.put(reserved.uploadUrl!, new TextEncoder().encode('%PDF-'), 'application/pdf');
      await expect(cleanupExpiredPrivateFiles({ prisma, storage, now: new Date(now.getTime() + 16 * 60_000) })).resolves.toEqual({ cleaned: 1 });
      await expect(listPrivateFiles(customer, request.quoteRequestId, {}, { prisma })).resolves.toEqual([]);
      const storageKey = storage.keyForToken(reserved.uploadUrl!);
      expect(storageKey).toMatch(/^private-files\//u);
      await expect(storage.head(storageKey!)).resolves.toBeNull();
      await expect(completePrivateFile(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    } finally {
      const storageObjects = await prisma.fileAttachment.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { storageObjectId: true } });
      await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.storageObject.deleteMany({ where: { id: { in: storageObjects.map(({ storageObjectId }) => storageObjectId) } } });
      if (fileId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: fileId } });
        await prisma.auditLog.deleteMany({ where: { entityId: fileId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);

  it('scopes staff file access to the request\'s assigned responsible unless requests.read.global is granted', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const storage = new MemoryPrivateStorage();
    const suffix = `${Date.now()}-staff-scope`;
    const now = new Date('2026-09-08T09:40:00.000Z');
    const request = await createQuoteRequest({ idempotencyKey: `private-files-staff-scope-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Private staff scope ${suffix}`, email: `private-staff-scope-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Private staff scope fixture', consentAt: now } }, { prisma, now });
    const [rivalUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { email: `private-scope-rival-${suffix}@example.test`, emailNormalized: `private-scope-rival-${suffix}@example.test`, displayName: 'Private scope rival', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `private-scope-outsider-${suffix}@example.test`, emailNormalized: `private-scope-outsider-${suffix}@example.test`, displayName: 'Private scope outsider', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { currentAssigneeId: rivalUser.id } });
    const rival = actor(rivalUser.id, 'EMPLOYEE', null, ['sales']);
    const outsider = actor(outsiderUser.id, 'EMPLOYEE', null, ['sales']);
    const globalOutsider = actor(outsiderUser.id, 'EMPLOYEE', null, ['manager']);
    const pdf = new TextEncoder().encode('%PDF-');
    let fileId: string | undefined;

    try {
      const reserved = await reservePrivateFile(rival, { quoteRequestId: request.quoteRequestId, originalFileName: 'scope.pdf', contentType: 'application/pdf', byteSize: pdf.byteLength, category: 'CLIENT_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `staff-scope-${suffix}` }, { prisma, storage, now });
      fileId = reserved.file.id;
      storage.put(reserved.uploadUrl!, pdf, 'application/pdf');

      await expect(completePrivateFile(outsider, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const completed = await completePrivateFile(rival, request.quoteRequestId, reserved.file.id, { prisma, storage, now });
      expect(completed.file.status).toBe('AVAILABLE');

      await expect(listPrivateFilesPage(outsider, request.quoteRequestId, {}, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(getPrivateFileDownload(outsider, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(deletePrivateFile(outsider, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      expect((await listPrivateFilesPage(globalOutsider, request.quoteRequestId, {}, { prisma })).items).toHaveLength(1);
      await expect(getPrivateFileDownload(globalOutsider, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).resolves.toMatchObject({ file: { id: reserved.file.id } });
      await expect(deletePrivateFile(rival, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).resolves.toMatchObject({ status: 'DELETED' });
    } finally {
      const storageObjects = await prisma.fileAttachment.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { storageObjectId: true } });
      await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.storageObject.deleteMany({ where: { id: { in: storageObjects.map(({ storageObjectId }) => storageObjectId) } } });
      if (fileId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: fileId } });
        await prisma.auditLog.deleteMany({ where: { entityId: fileId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: [rivalUser.id, outsiderUser.id] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);

  it('rejects an upload whose real size does not match the reservation without ever reading its body', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const prisma = getPrisma();
    const storage = new MemoryPrivateStorage();
    const suffix = `${Date.now()}-size-mismatch`;
    const now = new Date('2026-09-08T09:50:00.000Z');
    const request = await createQuoteRequest({ idempotencyKey: `private-files-size-mismatch-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Private size mismatch ${suffix}`, email: `private-size-mismatch-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Private size mismatch fixture', consentAt: now } }, { prisma, now });
    const user = await prisma.user.create({ data: { email: `private-size-mismatch-user-${suffix}@example.test`, emailNormalized: `private-size-mismatch-user-${suffix}@example.test`, displayName: 'Private size mismatch user', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const customer = actor(user.id, 'CUSTOMER', request.clientId, ['customer']);
    let fileId: string | undefined;

    try {
      // Declara 5 bytes al reservar, pero la URL prefirmada no impone ningún límite real de tamaño
      // -- sube un objeto mucho más grande, simulando lo que un cliente malicioso podría hacer para
      // forzar al servidor a cargar en memoria un archivo arbitrariamente grande antes de rechazarlo.
      const reserved = await reservePrivateFile(customer, { quoteRequestId: request.quoteRequestId, originalFileName: 'oversized.pdf', contentType: 'application/pdf', byteSize: 5, category: 'TECHNICAL_DOCUMENT', visibility: 'CUSTOMER', idempotencyKey: `size-mismatch-${suffix}` }, { prisma, storage, now });
      fileId = reserved.file.id;
      storage.put(reserved.uploadUrl!, new Uint8Array(10_000), 'application/pdf');

      await expect(completePrivateFile(customer, request.quoteRequestId, reserved.file.id, { prisma, storage, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(storage.readCallCount).toBe(0);
      const files = await listPrivateFiles(customer, request.quoteRequestId, {}, { prisma });
      expect(files).toMatchObject([{ id: reserved.file.id, status: 'REJECTED', downloadAvailable: false }]);
    } finally {
      const storageObjects = await prisma.fileAttachment.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { storageObjectId: true } });
      await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.storageObject.deleteMany({ where: { id: { in: storageObjects.map(({ storageObjectId }) => storageObjectId) } } });
      if (fileId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: fileId } });
        await prisma.auditLog.deleteMany({ where: { entityId: fileId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);
});
