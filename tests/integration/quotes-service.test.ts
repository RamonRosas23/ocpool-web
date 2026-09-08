import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, replaceQuoteDraft, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';

const salesActor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('quote pricing and versioning service', () => {
  it('resolves the active price and preserves a historical snapshot after catalog changes', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-10T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-snapshot`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote service ${suffix}`, email: `quote-service-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Quote service fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-service-employee-${suffix}@example.test`,
        emailNormalized: `quote-service-employee-${suffix}@example.test`,
        displayName: 'Quote service employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `QUOTE-${suffix}`, name: 'Quote service' } });
    const item = await prisma.catalogItem.create({ data: { code: `QUOTE-ITEM-${suffix}`, name: 'Quote service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `QUOTE-PRICE-${suffix}`, name: 'Quote service prices', currencyCode: 'MXN', validFrom: now } });
    const price = await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const actor = salesActor(employee.id, ['quotes.create', 'prices.read']);
      const created = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', taxBasisPoints: 1600 }],
        expectedCurrentVersionNumber: null,
      }, { prisma, now });
      quoteId = created.quoteId;

      expect(created.versionNumber).toBe(1);
      expect(created.totalMinor).toBe(23200n);
      const lineBeforeChange = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId } });
      expect(lineBeforeChange).toMatchObject({ catalogItemId: item.id, unitPriceMinor: 10000n, subtotalMinor: 20000n, totalMinor: 23200n });

      await prisma.priceListItem.update({ where: { id: price.id }, data: { unitPriceMinor: 12000n } });
      const lineAfterChange = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId } });
      expect(lineAfterChange).toMatchObject({ unitPriceMinor: 10000n, subtotalMinor: 20000n, totalMinor: 23200n });
      expect(await prisma.auditLog.count({ where: { entityId: created.versionId, action: 'quote.version.created' } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_CREATED' } })).toBe(1);
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

  it('requires permissions, blocks edits after sending and serializes concurrent version creation', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-11T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-version`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote version ${suffix}`, email: `quote-version-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Quote version fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-version-employee-${suffix}@example.test`,
        emailNormalized: `quote-version-employee-${suffix}@example.test`,
        displayName: 'Quote version employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `VERSION-${suffix}`, name: 'Version service' } });
    const item = await prisma.catalogItem.create({ data: { code: `VERSION-ITEM-${suffix}`, name: 'Version service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `VERSION-PRICE-${suffix}`, name: 'Version service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 5000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read']);
      const manager = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read', 'quotes.edit_prices']);
      await expect(createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', unitPriceMinorOverride: '6000' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const first = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1' }],
      }, { prisma, now });
      quoteId = first.quoteId;
      const editedDraft = await replaceQuoteDraft(actor, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now });
      expect(editedDraft.totalMinor).toBe(10000n);
      expect(await prisma.quoteLineSnapshot.count({ where: { quoteVersionId: first.versionId } })).toBe(1);
      await transitionQuoteVersion(actor, first.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(actor, first.versionId, 'ENVIADA', { prisma, now });
      await expect(transitionQuoteVersion(actor, first.versionId, 'ACEPTADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(replaceQuoteDraft(manager, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const [second, concurrent] = await Promise.allSettled([
        createQuoteVersion(actor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '2' }],
          expectedCurrentVersionNumber: 1,
        }, { prisma, now }),
        createQuoteVersion(actor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '3' }],
          expectedCurrentVersionNumber: 1,
        }, { prisma, now }),
      ]);
      expect([second, concurrent].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect([second, concurrent].filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await prisma.quoteVersion.count({ where: { quote: { quoteRequestId: request.quoteRequestId } } })).toBe(2);
      expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toMatchObject({ status: 'COTIZACION_DISPONIBLE' });
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
