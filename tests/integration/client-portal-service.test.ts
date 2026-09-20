import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { getCustomerQuoteRequest, listCustomerQuoteRequests } from '@/server/modules/client-portal/service';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';

const actor = (userId: string, clientId: string | null, type: Actor['type'], permissions: string[] = []): Actor => ({
  userId,
  clientId,
  type,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('customer portal scoped service', () => {
  it('returns only the authenticated customer resources and safe quote snapshots', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-04-01T12:00:00.000Z');
    const requestA = await createQuoteRequest({ idempotencyKey: `portal-a-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal A ${suffix}`, email: `portal-a-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Cliente A alcance compartido', consentAt: now } }, { prisma, now });
    const requestB = await createQuoteRequest({ idempotencyKey: `portal-b-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal B ${suffix}`, email: `portal-b-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Cliente B privado', consentAt: now } }, { prisma, now });
    const employee = await prisma.user.create({ data: { email: `portal-employee-${suffix}@example.test`, emailNormalized: `portal-employee-${suffix}@example.test`, displayName: 'Portal fixture employee', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const category = await prisma.catalogCategory.create({ data: { code: `PORTAL-${suffix}`, name: 'Portal fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `PORTAL-ITEM-${suffix}`, name: 'Portal snapshot item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PORTAL-PRICE-${suffix}`, name: 'Portal fixture prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 8000n, validFrom: now } });
    let quoteIds: string[] = [];

    try {
      await prisma.quoteRequest.updateMany({ where: { id: { in: [requestA.quoteRequestId, requestB.quoteRequestId] } }, data: { status: 'EN_ELABORACION' } });
      const employeeActor = actor(employee.id, null, 'EMPLOYEE', ['quotes.create', 'quotes.send']);
      const quoteA = await createQuoteVersion(employeeActor, { quoteRequestId: requestA.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '2', taxBasisPoints: 1600 }] }, { prisma, now });
      const quoteB = await createQuoteVersion(employeeActor, { quoteRequestId: requestB.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      quoteIds = [quoteA.quoteId, quoteB.quoteId];
      await transitionQuoteVersion(employeeActor, quoteA.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(employeeActor, quoteA.versionId, 'ENVIADA', { prisma, now });
      const quoteAWorking = await createQuoteVersion(employeeActor, { quoteRequestId: requestA.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '3', taxBasisPoints: 1600 }] }, { prisma, now });
      await transitionQuoteVersion(employeeActor, quoteAWorking.versionId, 'EN_REVISION', { prisma, now });
      await prisma.catalogItem.update({ where: { id: item.id }, data: { name: 'Portal catálogo actualizado' } });
      const customerActor = actor('customer-user-a', requestA.clientId, 'CUSTOMER', ['portal.self.read']);

      const list = await listCustomerQuoteRequests(customerActor, {}, { prisma });
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ id: requestA.quoteRequestId, folio: requestA.folio, client: { id: requestA.clientId }, quote: { currentVersion: { totalMinor: '18560' } } });

      const detail = await getCustomerQuoteRequest(customerActor, requestA.quoteRequestId, { prisma });
      expect(detail.request).toMatchObject({ id: requestA.quoteRequestId, client: { id: requestA.clientId }, detail: { description: 'Cliente A alcance compartido' } });
      expect(detail.quote?.currentVersion).toMatchObject({ id: quoteA.versionId, totalMinor: '18560', termsVersion: 'v1', termsLabel: 'Condiciones comerciales y aviso de privacidad OCPOOL' });
      expect(detail.quote?.currentVersion?.pdfReady).toBe(false);
      expect(detail.quote?.currentVersion?.lines[0]).toMatchObject({ name: 'Portal snapshot item', quantityMilliunits: '2000', unitPriceMinor: '8000', taxMinor: '2560', totalMinor: '18560' });
      expect(detail.quote?.versions.map((version) => version.id)).toContain(quoteA.versionId);
      expect(detail.quote?.versions.map((version) => version.id)).not.toContain(quoteAWorking.versionId);
      expect(JSON.stringify(detail)).not.toContain('Portal B privado');
      expect(JSON.stringify(detail)).not.toContain('createdBy');
      await expect(getCustomerQuoteRequest(customerActor, requestB.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(listCustomerQuoteRequests(actor('customer-no-permission', requestA.clientId, 'CUSTOMER'), {}, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(listCustomerQuoteRequests(employeeActor, {}, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    } finally {
      const requestIds = [requestA.quoteRequestId, requestB.quoteRequestId];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: requestIds } } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...requestIds, ...quoteIds] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...requestIds, ...quoteIds, ...versionIds] } } });
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: [requestA.contactId, requestB.contactId] } } });
      await prisma.client.deleteMany({ where: { id: { in: [requestA.clientId, requestB.clientId] } } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
