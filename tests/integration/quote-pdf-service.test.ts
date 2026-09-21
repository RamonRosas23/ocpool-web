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

function managerActor(userId: string): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['manager']), mfaVerified: true };
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

  it('scopes PDF generation to the request\'s assigned responsible unless requests.read.global is granted', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryGeneratedStorage();
    const suffix = `${Date.now()}-scope`;
    const now = new Date('2026-09-08T14:10:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-pdf-scope-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `PDF scope ${suffix}`, email: `pdf-scope-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'PDF scope fixture', consentAt: now },
    }, { prisma, now });
    const [rivalUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { email: `pdf-scope-rival-${suffix}@example.test`, emailNormalized: `pdf-scope-rival-${suffix}@example.test`, displayName: 'PDF scope rival', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `pdf-scope-outsider-${suffix}@example.test`, emailNormalized: `pdf-scope-outsider-${suffix}@example.test`, displayName: 'PDF scope outsider', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    const codeSuffix = Date.now().toString();
    const category = await prisma.catalogCategory.create({ data: { code: `PDF-SCOPE-${codeSuffix}`, name: 'PDF scope fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `PDF-SCOPE-ITEM-${codeSuffix}`, name: 'PDF scope item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PDF-SCOPE-PRICE-${codeSuffix}`, name: 'PDF scope prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 100_000n, validFrom: now } });
    const rival = salesActor(rivalUser.id);
    const outsider = salesActor(outsiderUser.id);
    const globalOutsider = managerActor(outsiderUser.id);
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: rivalUser.id } });
      const created = await createQuoteVersion(rival, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(rival, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(rival, created.versionId, 'ENVIADA', { prisma, now });

      await expect(generateQuotePdf(outsider, created.versionId, { prisma, storage, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const generated = await generateQuotePdf(globalOutsider, created.versionId, { prisma, storage, now });
      expect(generated.status).toBe('READY');
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
      await prisma.user.deleteMany({ where: { id: { in: [rivalUser.id, outsiderUser.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('H1-03: reclaims a stale PENDING lease left behind by a crashed worker, but not a fresh one', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryGeneratedStorage();
    const suffix = `${Date.now()}-stale-lease`;
    const now = new Date('2026-09-20T21:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-pdf-stale-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `PDF stale lease ${suffix}`, email: `pdf-stale-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'PDF stale lease fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({ data: { email: `pdf-stale-employee-${suffix}@example.test`, emailNormalized: `pdf-stale-employee-${suffix}@example.test`, displayName: 'PDF stale lease employee', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const codeSuffix = Date.now().toString();
    const category = await prisma.catalogCategory.create({ data: { code: `PDFSTALE-${codeSuffix}`, name: 'PDF stale lease fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `PDFSTALE-ITEM-${codeSuffix}`, name: 'PDF stale lease item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PDFSTALE-PRICE-${codeSuffix}`, name: 'PDF stale lease prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 100_000n, validFrom: now } });
    const actor = salesActor(employee.id);
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(actor, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(actor, created.versionId, 'ENVIADA', { prisma, now });

      // Un PENDING recién dejado (el worker apenas empezó) sigue protegido: un segundo intento
      // mientras la preparación "en curso" todavía es reciente debe rechazarse, no reclamarse.
      const freshPending = await prisma.generatedDocument.create({ data: { quoteId, quoteVersionId: created.versionId, templateVersion: 'quote-pdf-v1' } });
      await expect(generateQuotePdf(actor, created.versionId, { prisma, storage, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(await prisma.generatedDocument.count({ where: { quoteVersionId: created.versionId } })).toBe(1);

      // P1-03: pasado el umbral de "lease" (el worker que la dejó a medias se cayó), el mismo
      // PENDING debe reclamarse y completarse -- reutilizando la fila existente, sin crear otra.
      await prisma.$executeRaw`UPDATE "generated_documents" SET "updatedAt" = ${new Date(now.getTime() - 4 * 60_000)} WHERE "id" = ${freshPending.id}::uuid`;
      const reclaimed = await generateQuotePdf(actor, created.versionId, { prisma, storage, now });
      expect(reclaimed).toMatchObject({ id: freshPending.id, status: 'READY', quoteId, quoteVersionId: created.versionId });
      expect(await prisma.generatedDocument.count({ where: { quoteVersionId: created.versionId } })).toBe(1);
      expect(await prisma.generatedDocument.findUnique({ where: { id: freshPending.id }, select: { status: true } })).toMatchObject({ status: 'READY' });
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

  it('H1-05: renders a valid multi-page PDF at the real 100-line ceiling', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryGeneratedStorage();
    const suffix = `${Date.now()}-hundred-lines`;
    const codeSuffix = Date.now().toString();
    const now = new Date('2026-09-20T21:15:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-pdf-hundred-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `PDF hundred lines ${suffix}`, email: `pdf-hundred-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'PDF de 100 líneas reales, el techo exacto que createQuoteVersion permite.', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({ data: { email: `pdf-hundred-employee-${suffix}@example.test`, emailNormalized: `pdf-hundred-employee-${suffix}@example.test`, displayName: 'PDF hundred lines employee', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const category = await prisma.catalogCategory.create({ data: { code: `PDFHUNDRED-${codeSuffix}`, name: 'PDF hundred lines fixture' } });
    const items = await Promise.all(Array.from({ length: 100 }, (_, index) => prisma.catalogItem.create({
      data: { code: `PDFHUNDRED-ITEM-${codeSuffix}-${String(index + 1).padStart(3, '0')}`, name: `Concepto ${String(index + 1).padStart(3, '0')} de instalación de alberca con una descripción larga para forzar el ajuste de línea (wrap) en la tabla del PDF`, unit: 'pieza', categoryId: category.id },
    })));
    const priceList = await prisma.priceList.create({ data: { code: `PDFHUNDRED-PRICE-${codeSuffix}`, name: 'PDF hundred lines prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.createMany({ data: items.map((item) => ({ priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 12_345n, validFrom: now })) });
    const actor = salesActor(employee.id);
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: items.map((item) => ({ catalogItemId: item.id, quantity: '1' })) }, { prisma, now });
      quoteId = created.quoteId;
      expect(await prisma.quoteLineSnapshot.count({ where: { quoteVersionId: created.versionId } })).toBe(100);
      await transitionQuoteVersion(actor, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(actor, created.versionId, 'ENVIADA', { prisma, now });

      const document = await generateQuotePdf(actor, created.versionId, { prisma, storage, now });
      expect(document.status).toBe('READY');
      expect(document.byteSize).toBeGreaterThan(1_000);
      const bytes = await storage.read(document.storageKey);
      // pdf-lib puede volver a parsear su propia salida; si la paginación de 100 líneas produjera
      // un PDF corrupto (offsets de xref rotos, objetos huérfanos), esto fallaría de inmediato.
      const { PDFDocument } = await import('pdf-lib');
      const reparsed = await PDFDocument.load(bytes);
      expect(reparsed.getPageCount()).toBeGreaterThan(1);
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
      await prisma.catalogItem.deleteMany({ where: { id: { in: items.map((item) => item.id) } } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
