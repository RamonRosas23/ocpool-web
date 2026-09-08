import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import type { PrivateStorage } from '@/server/modules/private-files/storage';

class MemoryGeneratedStorage implements PrivateStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async ensureBucket(): Promise<void> {}

  async put({ key, body, contentType }: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async createUploadUrl(): Promise<string> { return 'memory://upload'; }
  async createDownloadUrl(): Promise<string> { return 'memory://download'; }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null;
  }

  async read(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error('missing');
    return object.body;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

function salesActor(userId: string): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['sales']), mfaVerified: true };
}

describe('quote PDF generation service', () => {
  it('renders from the immutable snapshot, verifies private storage and replays idempotently', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryGeneratedStorage();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T14:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-pdf-service-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `PDF service ${suffix}`, email: `pdf-service-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'PDF service fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `pdf-service-employee-${suffix}@example.test`,
        emailNormalized: `pdf-service-employee-${suffix}@example.test`,
        displayName: 'PDF service employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `PDF-${suffix}`, name: 'PDF fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `PDF-ITEM-${suffix}`, name: 'PDF fixture item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PDF-PRICE-${suffix}`, name: 'PDF fixture prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 100_000n, validFrom: now } });
    const actor = salesActor(employee.id);
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(actor, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(actor, created.versionId, 'ENVIADA', { prisma, now });

      const first = await generateQuotePdf(actor, created.versionId, { prisma, storage, now });
      const replay = await generateQuotePdf(actor, created.versionId, { prisma, storage, now: new Date(now.getTime() + 60_000) });
      const stored = await prisma.generatedDocument.findUnique({ where: { id: first.id }, include: { storageObject: true } });

      expect(first).toMatchObject({ status: 'READY', quoteId, quoteVersionId: created.versionId, contentType: 'application/pdf' });
      expect(first.byteSize).toBeGreaterThan(1_000);
      expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(replay.id).toBe(first.id);
      expect(replay.sha256).toBe(first.sha256);
      expect(stored).toMatchObject({ status: 'READY', sha256: first.sha256, byteSize: BigInt(first.byteSize), storageObject: { contentType: 'application/pdf', storageKey: first.storageKey } });
      expect(await prisma.outboxEvent.count({ where: { aggregateId: first.id, eventType: 'QUOTE.PDF_READY' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: first.id, action: 'quote.pdf.generated', outcome: 'SUCCESS' } })).toBe(1);
      expect(await storage.head(first.storageKey)).toMatchObject({ contentLength: first.byteSize, contentType: 'application/pdf' });
      expect(Buffer.from(await storage.read(first.storageKey)).includes(Buffer.from('internal'))).toBe(false);
    } finally {
      const versions = quoteId ? await prisma.quoteVersion.findMany({ where: { quoteId }, select: { id: true } }) : [];
      const documentIds = versions.length ? (await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versions.map(({ id }) => id) } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } })) : [];
      for (const document of documentIds) if (document.storageObject?.storageKey) await storage.delete(document.storageObject.storageKey);
      if (quoteId) await prisma.quoteAcceptance.deleteMany({ where: { quoteId } });
      await prisma.generatedDocument.deleteMany({ where: { id: { in: documentIds.map(({ id }) => id) } } });
      await prisma.storageObject.deleteMany({ where: { id: { in: documentIds.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });
      if (quoteId) await prisma.quote.delete({ where: { id: quoteId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...documentIds.map(({ id }) => id)] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...documentIds.map(({ id }) => id)] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
