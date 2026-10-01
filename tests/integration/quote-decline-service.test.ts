import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { declineCustomerQuote } from '@/server/modules/quote-documents/decline-service';
import type { PrivateStorage } from '@/server/modules/private-files/storage';

class MemoryDeclineStorage implements PrivateStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async ensureBucket(): Promise<void> {}
  async put({ key, body, contentType }: { key: string; body: Uint8Array; contentType: string }): Promise<void> { this.objects.set(key, { body, contentType }); }
  async createUploadUrl(): Promise<string> { return 'memory://upload'; }
  async createDownloadUrl(): Promise<string> { return 'memory://download'; }
  async head(key: string) { const object = this.objects.get(key); return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null; }
  async read(key: string): Promise<Uint8Array> { const object = this.objects.get(key); if (!object) throw new Error('missing'); return object.body; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}

type FixtureOptions = Readonly<{
  requestStatus?: 'COTIZACION_DISPONIBLE' | 'EN_NEGOCIACION' | 'PENDIENTE_DE_APROBACION' | 'ACEPTADA';
  versionStatus?: 'ENVIADA' | 'EN_NEGOCIACION' | 'BORRADOR' | 'RECHAZADA';
  expired?: boolean;
  documentReady?: boolean;
  secondPublishedVersion?: boolean;
}>;

async function makeFixture(options: FixtureOptions = {}) {
  const prisma = getPrisma();
  const storage = new MemoryDeclineStorage();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-10-01T18:00:00.000Z');
  const request = await createQuoteRequest({ idempotencyKey: `quote-decline-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Decline ${suffix}`, email: `decline-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Quote decline fixture', consentAt: now } }, { prisma, now });
  const employee = await prisma.user.create({ data: { email: `decline-employee-${suffix}@example.test`, emailNormalized: `decline-employee-${suffix}@example.test`, displayName: `Employee ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE' } });
  const customer = await prisma.user.create({ data: { email: `decline-customer-${suffix}@example.test`, emailNormalized: `decline-customer-${suffix}@example.test`, displayName: `Customer ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
  await prisma.clientContact.update({ where: { id: request.contactId }, data: { userId: customer.id } });
  await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: options.requestStatus ?? 'COTIZACION_DISPONIBLE', currentAssigneeId: employee.id } });
  const quote = await prisma.quote.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
  const version = await prisma.quoteVersion.create({ data: { quoteId: quote.id, currencyCode: 'MXN', createdById: employee.id, status: options.versionStatus ?? 'ENVIADA', validUntil: options.expired ? new Date(now.getTime() - 1000) : null, publishedAt: now } });
  let publishedVersionId = version.id;
  if (options.secondPublishedVersion) {
    const otherVersion = await prisma.quoteVersion.create({ data: { quoteId: quote.id, versionNumber: 2, currencyCode: 'MXN', createdById: employee.id, status: 'ENVIADA', publishedAt: now } });
    publishedVersionId = otherVersion.id;
  }
  await prisma.quote.update({ where: { id: quote.id }, data: { publishedVersionId } });
  const body = Buffer.from('%PDF-decline-test');
  const storageKey = `private-files/decline-tests/${suffix}.pdf`;
  await storage.put({ key: storageKey, body, contentType: 'application/pdf' });
  const storageObject = await prisma.storageObject.create({ data: { storageKey, contentType: 'application/pdf', byteSize: BigInt(body.byteLength), sha256: 'a'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
  const document = await prisma.generatedDocument.create({ data: { quoteId: quote.id, quoteVersionId: version.id, storageObjectId: storageObject.id, templateVersion: 'quote-pdf-test', status: options.documentReady === false ? 'PENDING' : 'READY', contentType: 'application/pdf', byteSize: BigInt(body.byteLength), sha256: 'a'.repeat(64), generatedAt: now, readyAt: options.documentReady === false ? null : now } });
  const actor: Actor = { userId: customer.id, type: 'CUSTOMER', clientId: request.clientId, permissionKeys: permissionKeysForRoles(['customer']), mfaVerified: true };
  const input = { versionId: version.id, reason: 'PRICE' as const, comment: '  Excede el presupuesto  ', idempotencyKey: `decline-key-${suffix}` };

  return {
    prisma, storage, now, request, employee, customer, quote, version, document, storageObject, actor, input,
    async cleanup() {
      const conversation = await prisma.conversation.findUnique({ where: { quoteRequestId: request.quoteRequestId }, select: { id: true } });
      const messageIds = conversation ? (await prisma.conversationMessage.findMany({ where: { conversationId: conversation.id }, select: { id: true } })).map(({ id }) => id) : [];
      await prisma.inboxNotification.deleteMany({ where: { recipientId: { in: [employee.id, customer.id] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, quote.id, version.id, ...messageIds] } } });
      if (conversation) await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId, quote.id, ...(conversation ? [conversation.id] : [])] } } });
      await prisma.quote.delete({ where: { id: quote.id } });
      await prisma.storageObject.delete({ where: { id: storageObject.id } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await storage.delete(storageKey);
    },
  };
}

describe('customer quote decline service', () => {
  it('declines a current quote atomically, replays the same attempt, and conflicts on changed content', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const fixture = await makeFixture();
    const { prisma, storage, now, request, customer, quote, version, actor, input } = fixture;
    try {
      const first = await declineCustomerQuote(actor, quote.id, input, { prisma, storage, now });
      expect(first).toMatchObject({ quoteId: quote.id, quoteVersionId: version.id, quoteRequestId: request.quoteRequestId, versionNumber: 1, status: 'RECHAZADA' });
      expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: request.quoteRequestId } })).toMatchObject({ status: 'EN_NEGOCIACION' });
      expect(await prisma.quoteVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ status: 'RECHAZADA' });
      expect(await prisma.conversationMessage.findMany({ where: { conversation: { quoteRequestId: request.quoteRequestId }, senderUserId: customer.id } })).toEqual([expect.objectContaining({ body: 'Propuesta V1 declinada: El precio. Excede el presupuesto' })]);
      expect(await prisma.quoteStatusHistory.count({ where: { quoteVersionId: version.id, toStatus: 'RECHAZADA' } })).toBe(1);
      expect(await prisma.requestStatusHistory.count({ where: { quoteRequestId: request.quoteRequestId, toStatus: 'EN_NEGOCIACION' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'quote.declined_by_customer', entityId: version.id } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { eventType: 'QUOTE.DECLINED', aggregateId: request.quoteRequestId } })).toBe(1);

      const replay = await declineCustomerQuote(actor, quote.id, input, { prisma, storage, now: new Date(now.getTime() + 5000) });
      expect(replay).toEqual(first);
      await expect(declineCustomerQuote(actor, quote.id, { ...input, comment: 'Cambió el comentario' }, { prisma, storage, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(await prisma.conversationMessage.count({ where: { conversation: { quoteRequestId: request.quoteRequestId }, senderUserId: customer.id } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { eventType: 'QUOTE.DECLINED', aggregateId: request.quoteRequestId } })).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('accepts an already-negotiating request and serializes identical concurrent submissions', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const fixture = await makeFixture({ requestStatus: 'EN_NEGOCIACION', versionStatus: 'EN_NEGOCIACION' });
    try {
      const results = await Promise.all([
        declineCustomerQuote(fixture.actor, fixture.quote.id, fixture.input, { prisma: fixture.prisma, storage: fixture.storage, now: fixture.now }),
        declineCustomerQuote(fixture.actor, fixture.quote.id, fixture.input, { prisma: fixture.prisma, storage: fixture.storage, now: fixture.now }),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(await fixture.prisma.conversationMessage.count({ where: { conversation: { quoteRequestId: fixture.request.quoteRequestId } } })).toBe(1);
      expect(await fixture.prisma.requestStatusHistory.count({ where: { quoteRequestId: fixture.request.quoteRequestId, toStatus: 'EN_NEGOCIACION' } })).toBe(0);
      expect(await fixture.prisma.outboxEvent.count({ where: { eventType: 'QUOTE.DECLINED', aggregateId: fixture.request.quoteRequestId } })).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects invalid state, non-current version, expired validity, and a PDF that is not ready without partial writes', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const cases: FixtureOptions[] = [
      { requestStatus: 'PENDIENTE_DE_APROBACION' },
      { requestStatus: 'ACEPTADA' },
      { versionStatus: 'BORRADOR' },
      { expired: true },
      { documentReady: false },
      { secondPublishedVersion: true },
    ];
    for (const options of cases) {
      const fixture = await makeFixture(options);
      try {
        await expect(declineCustomerQuote(fixture.actor, fixture.quote.id, fixture.input, { prisma: fixture.prisma, storage: fixture.storage, now: fixture.now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
        expect(await fixture.prisma.conversationMessage.count({ where: { conversation: { quoteRequestId: fixture.request.quoteRequestId } } })).toBe(0);
        expect(await fixture.prisma.outboxEvent.count({ where: { aggregateId: fixture.request.quoteRequestId, eventType: 'QUOTE.DECLINED' } })).toBe(0);
        expect(await fixture.prisma.quoteVersion.findUniqueOrThrow({ where: { id: fixture.version.id }, select: { status: true } })).toEqual({ status: options.versionStatus ?? 'ENVIADA' });
      } finally {
        await fixture.cleanup();
      }
    }
  }, 60_000);
});
