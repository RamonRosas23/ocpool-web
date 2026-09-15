import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { assignQuoteRequest } from '@/server/modules/quote-requests/staff-service';
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
      detail: {
        projectType: 'Residencial',
        location: 'Mazatlán',
        projectStage: 'REMODEL',
        dimensions: '10 x 4 m',
        timeline: 'ASAP',
        budgetRange: 'UNDER_250K',
        description: 'Workspace fixture',
        consentAt: now,
      },
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
    const incompatiblePriceList = await prisma.priceList.create({ data: { code: `STAFF-INCOMPATIBLE-${suffix}`, name: 'A incompatible workspace prices', currencyCode: 'MXN', validFrom: now } });
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
      expect(workspace.request.detail).toMatchObject({
        projectStage: 'REMODEL',
        dimensions: '10 x 4 m',
        timeline: 'ASAP',
        budgetRange: 'UNDER_250K',
      });
      expect(workspace.quote?.currentVersion).toMatchObject({ id: created.versionId, versionNumber: 1, status: 'BORRADOR', totalMinor: '29000' });
      expect(workspace.quote?.currentVersion?.lines[0]).toMatchObject({ catalogItemId: item.id, quantityMilliunits: '2000', unitPriceMinor: '12500', taxMinor: '4000', totalMinor: '29000' });
      expect(workspace.quote?.history).toHaveLength(1);
      expect(workspace.priceLists).toContainEqual({ id: priceList.id, code: priceList.code, name: priceList.name, currencyCode: 'MXN' });
      expect(workspace.priceLists).not.toContainEqual({ id: incompatiblePriceList.id, code: incompatiblePriceList.code, name: incompatiblePriceList.name, currencyCode: 'MXN' });
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
      await prisma.priceList.delete({ where: { id: incompatiblePriceList.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('scopes the workspace to the assigned responsible unless the actor has requests.read.global', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-03-12T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-staff-scope-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Workspace scope ${suffix}`, email: `workspace-scope-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Workspace scope fixture', consentAt: now },
    }, { prisma, now });
    const rival = await prisma.user.create({
      data: { email: `quote-staff-rival-${suffix}@example.test`, emailNormalized: `quote-staff-rival-${suffix}@example.test`, displayName: 'Quote staff rival', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const outsider = await prisma.user.create({
      data: { email: `quote-staff-outsider-${suffix}@example.test`, emailNormalized: `quote-staff-outsider-${suffix}@example.test`, displayName: 'Quote staff outsider', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `STAFF-SCOPE-${suffix}`, name: 'Staff workspace scope' } });
    const item = await prisma.catalogItem.create({ data: { code: `STAFF-SCOPE-ITEM-${suffix}`, name: 'Staff workspace scope item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `STAFF-SCOPE-PRICE-${suffix}`, name: 'Staff workspace scope prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 8000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const rivalActor = actor(rival.id, ['quotes.read', 'quotes.create', 'prices.read', 'requests.assign', 'requests.read.global']);
      await assignQuoteRequest(rivalActor, request.quoteRequestId, { assignedToId: rival.id }, { prisma, now });
      const created = await createQuoteVersion(rivalActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1' }],
      }, { prisma, now });
      quoteId = created.quoteId;

      const outsiderActor = actor(outsider.id, ['quotes.read']);
      await expect(getQuoteWorkspace(outsiderActor, request.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const scopedList = await listQuoteWorkspaces(outsiderActor, { query: request.folio }, { prisma });
      expect(scopedList.items).toHaveLength(0);

      const globalOutsiderActor = actor(outsider.id, ['quotes.read', 'requests.read.global']);
      await expect(getQuoteWorkspace(globalOutsiderActor, request.quoteRequestId, { prisma })).resolves.toMatchObject({ request: { id: request.quoteRequestId } });
      const globalList = await listQuoteWorkspaces(globalOutsiderActor, { query: request.folio }, { prisma });
      expect(globalList.items).toHaveLength(1);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.requestAssignment.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [rival.id, outsider.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
