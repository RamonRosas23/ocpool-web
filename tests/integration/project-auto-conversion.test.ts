import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { acceptCustomerQuote } from '@/server/modules/quote-documents/acceptance-service';
import { convertQuoteAcceptanceToProject, createProjectForCustomerAcceptance } from '@/server/modules/projects/service';
import type { PrivateStorage } from '@/server/modules/private-files/storage';

class MemoryStorage implements PrivateStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async ensureBucket(): Promise<void> {}
  async put({ key, body, contentType }: { key: string; body: Uint8Array; contentType: string }): Promise<void> { this.objects.set(key, { body, contentType }); }
  async createUploadUrl(): Promise<string> { return 'memory://upload'; }
  async createDownloadUrl(): Promise<string> { return 'memory://download'; }
  async head(key: string) { const object = this.objects.get(key); return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null; }
  async read(key: string): Promise<Uint8Array> { const object = this.objects.get(key); if (!object) throw new Error('missing'); return object.body; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}

function employeeActor(userId: string, roles: string[] = ['sales']): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(roles), mfaVerified: true };
}

function customerActor(userId: string, clientId: string): Actor {
  return { userId, type: 'CUSTOMER', clientId, permissionKeys: permissionKeysForRoles(['customer']), mfaVerified: true };
}

describe('project created on customer acceptance', () => {
  it('creates the handoff project when the customer accepts, owned by the request assignee, and closes the sales cycle', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const storage = new MemoryStorage();
    const stamp = Date.now().toString();
    const suffix = `auto-${stamp}`;
    const now = new Date('2026-09-26T15:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `project-auto-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Auto project ${suffix}`, email: `auto-project-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Auto project fixture', consentAt: now },
    }, { prisma, now });
    const salesUser = await prisma.user.create({ data: { email: `auto-sales-${suffix}@example.test`, emailNormalized: `auto-sales-${suffix}@example.test`, displayName: 'Auto sales', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const customerUser = await prisma.user.create({ data: { email: `auto-customer-${suffix}@example.test`, emailNormalized: `auto-customer-${suffix}@example.test`, displayName: 'Auto customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const category = await prisma.catalogCategory.create({ data: { code: `AUTO-${stamp}`, name: 'Auto fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `AUTO-ITEM-${stamp}`, name: 'Auto item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `AUTO-PRICE-${stamp}`, name: 'Auto prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 50_000n, validFrom: now } });
    let quoteId: string | null = null;
    let projectId: string | null = null;
    const sales = employeeActor(salesUser.id);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesUser.id } });
      const created = await createQuoteVersion(sales, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(sales, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(sales, created.versionId, 'ENVIADA', { prisma, now });
      await generateQuotePdf(sales, created.versionId, { prisma, storage, now });
      const acceptance = await acceptCustomerQuote(customerActor(customerUser.id, request.clientId), quoteId, { signerName: 'Ana López Rivera', termsVersion: 'v1', idempotencyKey: `auto-accept-${suffix}` }, { prisma, storage, now });

      const project = await createProjectForCustomerAcceptance(acceptance.id, { prisma, now });
      projectId = project.id;
      const stored = await prisma.project.findUniqueOrThrow({ where: { id: project.id }, select: { ownerId: true, createdById: true, quoteRequestId: true } });
      // Responsable: quien llevaba el expediente; creado por la aceptación del cliente.
      expect(stored).toEqual({ ownerId: salesUser.id, createdById: customerUser.id, quoteRequestId: request.quoteRequestId });
      expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toMatchObject({ status: 'CONVERTIDA_EN_PROYECTO' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: project.id, action: 'project.created' }, select: { metadata: true } })).toMatchObject({ metadata: { source: 'customer_acceptance' } });

      // Idempotente entre caminos: la conversión manual posterior regresa el mismo proyecto.
      expect((await createProjectForCustomerAcceptance(acceptance.id, { prisma, now })).id).toBe(project.id);
      expect((await convertQuoteAcceptanceToProject(sales, acceptance.id, {}, { prisma, now })).id).toBe(project.id);
      expect(await prisma.project.count({ where: { quoteRequestId: request.quoteRequestId } })).toBe(1);
    } finally {
      if (projectId) {
        await prisma.projectChecklistItem.deleteMany({ where: { projectId } });
        await prisma.project.delete({ where: { id: projectId } });
      }
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } });
      await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: (await prisma.quote.findMany({ where: { quoteRequestId: request.quoteRequestId }, select: { id: true } })).map(({ id }) => id) } } });
      await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...(projectId ? [projectId] : [])] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...versionIds, ...(projectId ? [projectId] : [])] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.deleteMany({ where: { id: { in: [salesUser.id, customerUser.id] } } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
