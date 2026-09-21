import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { acceptCustomerQuote } from '@/server/modules/quote-documents/acceptance-service';
import type { PrivateStorage } from '@/server/modules/private-files/storage';

class MemoryAcceptanceStorage implements PrivateStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async ensureBucket(): Promise<void> {}
  async put({ key, body, contentType }: { key: string; body: Uint8Array; contentType: string }): Promise<void> { this.objects.set(key, { body, contentType }); }
  async createUploadUrl(): Promise<string> { return 'memory://upload'; }
  async createDownloadUrl(): Promise<string> { return 'memory://download'; }
  async head(key: string) { const object = this.objects.get(key); return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null; }
  async read(key: string): Promise<Uint8Array> { const object = this.objects.get(key); if (!object) throw new Error('missing'); return object.body; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}

function employeeActor(userId: string): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['sales']), mfaVerified: true };
}

function customerActor(userId: string, clientId: string): Actor {
  return { userId, type: 'CUSTOMER', clientId, permissionKeys: permissionKeysForRoles(['customer']), mfaVerified: true };
}

describe('customer quote acceptance service', () => {
  it('accepts only the current ready PDF, records immutable evidence and serializes concurrent attempts', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryAcceptanceStorage();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T15:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-acceptance-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Acceptance ${suffix}`, email: `acceptance-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Acceptance fixture', consentAt: now },
    }, { prisma, now });
    const employeeUser = await prisma.user.create({ data: { email: `acceptance-employee-${suffix}@example.test`, emailNormalized: `acceptance-employee-${suffix}@example.test`, displayName: 'Acceptance employee', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const customer = await prisma.user.create({ data: { email: `acceptance-customer-${suffix}@example.test`, emailNormalized: `acceptance-customer-${suffix}@example.test`, displayName: 'Acceptance customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const category = await prisma.catalogCategory.create({ data: { code: `ACCEPT-${suffix}`, name: 'Acceptance fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `ACCEPT-ITEM-${suffix}`, name: 'Acceptance item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `ACCEPT-PRICE-${suffix}`, name: 'Acceptance prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 100_000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const employee = employeeActor(employeeUser.id);
      const created = await createQuoteVersion(employee, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(employee, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(employee, created.versionId, 'ENVIADA', { prisma, now });
      await generateQuotePdf(employee, created.versionId, { prisma, storage, now });
      const working = await createQuoteVersion(employee, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '2', taxBasisPoints: 1600 }] }, { prisma, now });
      await transitionQuoteVersion(employee, working.versionId, 'EN_REVISION', { prisma, now });

      const customerActorValue = customerActor(customer.id, request.clientId);
      const acceptedQuoteId = quoteId;
      if (!acceptedQuoteId) throw new Error('The acceptance fixture quote was not created.');
      const concurrentInputs = [
        {
          signerName: '  Ana   López Rivera ',
          termsVersion: ' v1 ',
          idempotencyKey: `acceptance-key-${suffix}`,
          ipAddress: '203.0.113.10',
          userAgent: 'Acceptance Test Browser',
        },
        {
          signerName: 'Otro nombre',
          termsVersion: 'v1',
          idempotencyKey: `acceptance-key-concurrent-${suffix}`,
        },
      ] as const;
      const concurrentResults = await Promise.allSettled(concurrentInputs.map((acceptanceInput) => acceptCustomerQuote(customerActorValue, acceptedQuoteId, acceptanceInput, { prisma, storage, now })));
      const fulfilled = concurrentResults.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acceptCustomerQuote>>> => result.status === 'fulfilled');
      const rejected = concurrentResults.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ code: 'CONFLICT', status: 409 });
      const accepted = fulfilled[0].value;
      const winningInput = concurrentInputs.find((candidate) => candidate.idempotencyKey === (accepted.signerName === 'Ana López Rivera' ? `acceptance-key-${suffix}` : `acceptance-key-concurrent-${suffix}`));
      if (!winningInput) throw new Error('The concurrent acceptance winner could not be mapped to its idempotency key.');
      const expectedSigner = winningInput.idempotencyKey === `acceptance-key-${suffix}` ? 'Ana López Rivera' : 'Otro nombre';
      // H1-02: la reproducción debe reutilizar el mismo firmante/términos que realmente ganó la
      // carrera -- una llave con datos distintos ahora se rechaza como conflicto en vez de
      // regresar en silencio la aceptación ganadora.
      const replay = await acceptCustomerQuote(customerActorValue, acceptedQuoteId, {
        signerName: winningInput.signerName,
        termsVersion: winningInput.termsVersion,
        idempotencyKey: winningInput.idempotencyKey,
        ipAddress: '203.0.113.10',
        userAgent: 'Acceptance Test Browser',
      }, { prisma, storage, now: new Date(now.getTime() + 1_000) });
      const version = await prisma.quoteVersion.findUnique({ where: { id: created.versionId } });
      const persisted = await prisma.quoteAcceptance.findUnique({ where: { quoteVersionId_quoteId: { quoteVersionId: created.versionId, quoteId } } });
      const updatedRequest = await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId } });

      expect(accepted).toMatchObject({ quoteId, quoteVersionId: created.versionId, status: 'ACEPTADA', signerName: expectedSigner, termsVersion: 'v1' });
      expect(accepted.quoteVersionId).not.toBe(working.versionId);
      expect(replay.id).toBe(accepted.id);
      expect(version?.status).toBe('ACEPTADA');
      expect(updatedRequest?.status).toBe('ACEPTADA');
      expect(persisted).toMatchObject({ id: accepted.id, signerName: 'Ana López Rivera', termsVersion: 'v1', documentSha256: accepted.documentSha256 });
      expect(await prisma.quoteAcceptance.count({ where: { quoteVersionId: created.versionId } })).toBe(1);
      await expect(acceptCustomerQuote(customerActorValue, acceptedQuoteId, { signerName: 'Otro nombre', termsVersion: 'v1', idempotencyKey: `acceptance-key-2-${suffix}` }, { prisma, storage, now: new Date(now.getTime() + 2_000) })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      // H1-02: reutilizar la MISMA llave ganadora con un firmante distinto nunca debe regresar en
      // silencio la aceptación original.
      await expect(acceptCustomerQuote(customerActorValue, acceptedQuoteId, { signerName: 'Firmante distinto', termsVersion: winningInput.termsVersion, idempotencyKey: winningInput.idempotencyKey }, { prisma, storage, now: new Date(now.getTime() + 3_000) })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
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
      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employeeUser.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
