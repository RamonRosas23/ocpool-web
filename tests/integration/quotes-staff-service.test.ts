import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { assignQuoteRequest } from '@/server/modules/quote-requests/staff-service';
import { createQuoteVersion, returnQuoteToDraft, submitQuoteForReview, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { getQuoteWorkspace, listQuoteVersionHistory, listQuoteWorkspaces } from '@/server/modules/quotes/staff-service';
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
      expect(workspace.quote?.workingVersion).toMatchObject({ id: created.versionId, versionNumber: 1, status: 'BORRADOR' });
      expect(workspace.quote?.publishedVersion).toBeNull();
      expect(workspace.projection).toMatchObject({
        stage: 'BORRADOR_GUARDADO',
        actorExpected: 'STAFF',
        primaryAction: 'QUOTE_SUBMIT_FOR_REVIEW',
        blockers: [],
        documentStatus: 'NOT_CREATED',
        deliveryStatus: 'NONE',
      });
      expect(workspace.priceLists).toContainEqual({ id: priceList.id, code: priceList.code, name: priceList.name, currencyCode: 'MXN' });
      expect(workspace.priceLists).not.toContainEqual({ id: incompatiblePriceList.id, code: incompatiblePriceList.code, name: incompatiblePriceList.name, currencyCode: 'MXN' });

      expect(workspace.meta.timezone).toEqual(expect.any(String));
      expect(new Date(workspace.meta.revision).getTime()).toBeGreaterThanOrEqual(request.quoteRequestId ? new Date(now).getTime() : 0);
      expect(workspace.quote?.versions[0]).toMatchObject({ id: created.versionId, versionNumber: 1, status: 'BORRADOR', totalMinor: '29000' });
      expect(workspace.quote?.versions[0]).not.toHaveProperty('lines');
      expect(workspace.quote?.versions[0]).not.toHaveProperty('approvals');
      expect(workspace.quote?.historyNextCursor).toBeNull();
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

  it('still lists candidate price lists for a version made only of special concept lines (K1-05)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-03-15T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-staff-special-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Workspace special ${suffix}`, email: `workspace-special-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special-only workspace fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-staff-special-employee-${suffix}@example.test`, emailNormalized: `quote-staff-special-employee-${suffix}@example.test`, displayName: 'Quote staff special employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const priceList = await prisma.priceList.create({ data: { code: `STAFF-SPECIAL-PRICE-${suffix}`, name: 'Staff special-only prices', currencyCode: 'MXN', validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const employeeActor = actor(employee.id, ['quotes.read', 'quotes.create', 'prices.read']);
      const created = await createQuoteVersion(employeeActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ special: true, name: 'Concepto especial único', unit: 'servicio', quantity: '1', unitPriceMinor: '10000', reason: 'Sin equivalente en catálogo' }],
      }, { prisma, now });
      quoteId = created.quoteId;

      const workspace = await getQuoteWorkspace(employeeActor, request.quoteRequestId, { prisma });
      expect(workspace.quote?.currentVersion?.lines[0]).toMatchObject({ catalogItemId: null, catalogItemCode: null, specialReason: 'Sin equivalente en catálogo' });
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
      await prisma.priceList.delete({ where: { id: priceList.id } });
    }
  }, 30_000);

  it('keeps the published version visible and projects REVISANDO_CAMBIOS once a new working draft starts (D2-01 bridge)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-03-20T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-staff-projection-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Workspace projection ${suffix}`, email: `workspace-projection-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Workspace projection fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-staff-projection-employee-${suffix}@example.test`, emailNormalized: `quote-staff-projection-employee-${suffix}@example.test`, displayName: 'Quote staff projection employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `STAFF-PROJ-${suffix}`, name: 'Staff projection workspace' } });
    const item = await prisma.catalogItem.create({ data: { code: `STAFF-PROJ-ITEM-${suffix}`, name: 'Staff projection item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `STAFF-PROJ-PRICE-${suffix}`, name: 'Staff projection prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 5000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const employeeActor = actor(employee.id, ['quotes.read', 'quotes.create', 'quotes.send', 'prices.read']);
      const firstVersion = await createQuoteVersion(employeeActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1' }],
      }, { prisma, now });
      quoteId = firstVersion.quoteId;

      await transitionQuoteVersion(employeeActor, firstVersion.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(employeeActor, firstVersion.versionId, 'ENVIADA', { prisma, now });

      const publishedWorkspace = await getQuoteWorkspace(employeeActor, request.quoteRequestId, { prisma });
      expect(publishedWorkspace.quote?.publishedVersion).toMatchObject({ id: firstVersion.versionId, status: 'ENVIADA' });
      expect(publishedWorkspace.quote?.workingVersion).toBeNull();
      expect(publishedWorkspace.projection).toMatchObject({ stage: 'PROPUESTA_PUBLICADA', actorExpected: 'SYSTEM', primaryAction: null });

      const secondVersion = await createQuoteVersion(employeeActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now });

      const revisingWorkspace = await getQuoteWorkspace(employeeActor, request.quoteRequestId, { prisma });
      expect(revisingWorkspace.quote?.publishedVersion).toMatchObject({ id: firstVersion.versionId, status: 'ENVIADA' });
      expect(revisingWorkspace.quote?.workingVersion).toMatchObject({ id: secondVersion.versionId, versionNumber: 2, status: 'BORRADOR' });
      expect(revisingWorkspace.projection).toMatchObject({ stage: 'REVISANDO_CAMBIOS', actorExpected: 'STAFF', primaryAction: 'QUOTE_SUBMIT_FOR_REVIEW' });
      expect(revisingWorkspace.projection.publishedVersion).toMatchObject({ id: firstVersion.versionId });
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

  it('paginates quote version history by cursor once it grows past the default page (D2-05)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-staff-history-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Workspace history ${suffix}`, email: `workspace-history-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'History pagination fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-staff-history-employee-${suffix}@example.test`, emailNormalized: `quote-staff-history-employee-${suffix}@example.test`, displayName: 'Quote staff history employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const outsider = await prisma.user.create({
      data: { email: `quote-staff-history-outsider-${suffix}@example.test`, emailNormalized: `quote-staff-history-outsider-${suffix}@example.test`, displayName: 'Quote staff history outsider', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `HIST-${suffix}`, name: 'History service' } });
    const item = await prisma.catalogItem.create({ data: { code: `HIST-ITEM-${suffix}`, name: 'History service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `HIST-PRICE-${suffix}`, name: 'History service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 5000n, validFrom: now } });
    let quoteId: string | null = null;
    const employeeActor = actor(employee.id, ['quotes.read', 'quotes.create', 'quotes.send', 'prices.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      await assignQuoteRequest(actor(employee.id, ['requests.assign']), request.quoteRequestId, { assignedToId: employee.id }, { prisma, now });
      const created = await createQuoteVersion(employeeActor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      quoteId = created.quoteId;
      // 1 creation entry + 32 submit/return round-trips = 33 total, forcing a second page past the 30-item default.
      for (let index = 0; index < 16; index += 1) {
        await submitQuoteForReview(employeeActor, created.versionId, { prisma, now });
        await returnQuoteToDraft(employeeActor, created.versionId, { reason: `Ajuste ${index}` }, { prisma, now });
      }

      const workspace = await getQuoteWorkspace(employeeActor, request.quoteRequestId, { prisma });
      expect(workspace.quote?.history).toHaveLength(30);
      expect(workspace.quote?.historyNextCursor).toEqual(expect.any(String));

      const outsiderActor = actor(outsider.id, ['quotes.read']);
      await expect(listQuoteVersionHistory(outsiderActor, request.quoteRequestId, {}, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(listQuoteVersionHistory(employeeActor, '00000000-0000-4000-8000-000000000000', {}, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(listQuoteVersionHistory(employeeActor, request.quoteRequestId, { cursor: 'not-a-cursor' }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      const collected = [...workspace.quote!.history];
      let cursor: string | null | undefined = workspace.quote?.historyNextCursor;
      while (cursor) {
        const page = await listQuoteVersionHistory(employeeActor, request.quoteRequestId, { cursor }, { prisma });
        collected.push(...page.items);
        cursor = page.nextCursor;
      }
      expect(collected).toHaveLength(33);
      expect(new Set(collected.map((entry) => entry.id)).size).toBe(33);
      const sorted = [...collected].sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
      expect(collected.map((entry) => entry.id)).toEqual(sorted.map((entry) => entry.id));
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
      await prisma.user.deleteMany({ where: { id: { in: [employee.id, outsider.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
