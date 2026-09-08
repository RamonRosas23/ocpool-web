import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion } from '@/server/modules/quotes/service';
import { getQuoteWorkspace, listQuoteWorkspaces } from '@/server/modules/quotes/staff-service';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';

const actor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('staff quote workspace service', () => {
  it('lists and reads a protected quote workspace with serialized monetary values and history', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-03-10T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-staff-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Workspace ${suffix}`, email: `workspace-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Workspace fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-staff-employee-${suffix}@example.test`,
        emailNormalized: `quote-staff-employee-${suffix}@example.test`,
        displayName: 'Quote staff employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `STAFF-${suffix}`, name: 'Staff workspace' } });
    const item = await prisma.catalogItem.create({ data: { code: `STAFF-ITEM-${suffix}`, name: 'Staff workspace item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `STAFF-PRICE-${suffix}`, name: 'Staff workspace prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 12500n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const employeeActor = actor(employee.id, ['quotes.read', 'quotes.create', 'prices.read']);
      const created = await createQuoteVersion(employeeActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', taxBasisPoints: 1600 }],
      }, { prisma, now });
      quoteId = created.quoteId;

      const listed = await listQuoteWorkspaces(employeeActor, { query: request.folio }, { prisma });
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).toMatchObject({ id: request.quoteRequestId, folio: request.folio, status: 'EN_ELABORACION', quote: { currentVersion: { totalMinor: '29000' } } });

      const workspace = await getQuoteWorkspace(employeeActor, request.quoteRequestId, { prisma });
      expect(workspace.request.client.id).toBe(request.clientId);
      expect(workspace.quote?.currentVersion).toMatchObject({ id: created.versionId, versionNumber: 1, status: 'BORRADOR', totalMinor: '29000' });
      expect(workspace.quote?.currentVersion?.lines[0]).toMatchObject({ catalogItemId: item.id, quantityMilliunits: '2000', unitPriceMinor: '12500', taxMinor: '4000', totalMinor: '29000' });
      expect(workspace.quote?.history).toHaveLength(1);
      expect(workspace.priceLists).toContainEqual({ id: priceList.id, code: priceList.code, name: priceList.name, currencyCode: 'MXN' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
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
