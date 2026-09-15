import { describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import {
  createCatalogCategory,
  createCatalogItem,
  createPriceList,
  searchQuoteCatalogItems,
  upsertPriceListItem,
} from '@/server/modules/catalog/service';

const actor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('contextual catalog search for the quote builder (K1-01)', () => {
  it('paginates the full catalog by cursor, resolves the current price and never silently drops a match', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const sales = actor('', ['catalog.read', 'prices.read']);
    const noPermission = actor('', []);
    const user = await prisma.user.create({
      data: { email: `catalog-search-${suffix}@example.test`, emailNormalized: `catalog-search-${suffix}@example.test`, displayName: 'Catalog search employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    sales.userId = user.id;
    noPermission.userId = user.id;
    const now = new Date('2026-04-01T12:00:00.000Z');

    const category = await createCatalogCategory(actor(user.id, ['catalog.manage']), { code: `K101CAT-${suffix}`, name: 'K1-01 search fixture' }, { prisma });
    const otherCategory = await createCatalogCategory(actor(user.id, ['catalog.manage']), { code: `K101OTH-${suffix}`, name: 'K1-01 other category' }, { prisma });
    const priceList = await createPriceList(actor(user.id, ['prices.manage']), { code: `K101PRICE-${suffix}`, name: 'K1-01 search prices', currencyCode: 'MXN', validFrom: new Date('2026-01-01T00:00:00.000Z') }, { prisma });

    const TOTAL_ITEMS = 60;
    const items = await Promise.all(Array.from({ length: TOTAL_ITEMS }, (_, index) => {
      const position = String(index + 1).padStart(2, '0');
      return createCatalogItem(actor(user.id, ['catalog.manage']), { code: `K101-${suffix}-${position}`, name: `Concepto búsqueda ${suffix} ${position}`, unit: 'pieza', categoryId: category.id }, { prisma });
    }));
    const itemWithoutPrice = items[59];
    const itemWithHistoricalPrice = items[54];
    const itemInOtherCategory = await createCatalogItem(actor(user.id, ['catalog.manage']), { code: `K101X-${suffix}`, name: `Concepto ajeno ${suffix}`, unit: 'pieza', categoryId: otherCategory.id }, { prisma });

    for (const item of items.filter((candidate) => candidate.id !== itemWithoutPrice.id)) {
      await upsertPriceListItem(actor(user.id, ['prices.manage']), priceList.id, { catalogItemId: item.id, unitPriceMinor: '10000', validFrom: new Date('2026-01-01T00:00:00.000Z'), validUntil: null }, { prisma });
    }
    // Give item #55 a superseded (expired) price before its current one, to prove only the effective price resolves.
    await prisma.priceListItem.update({ where: { priceListId_catalogItemId_validFrom: { priceListId: priceList.id, catalogItemId: itemWithHistoricalPrice.id, validFrom: new Date('2026-01-01T00:00:00.000Z') } }, data: { validUntil: new Date('2026-02-01T00:00:00.000Z') } });
    await upsertPriceListItem(actor(user.id, ['prices.manage']), priceList.id, { catalogItemId: itemWithHistoricalPrice.id, unitPriceMinor: '25000', validFrom: new Date('2026-02-01T00:00:00.000Z'), validUntil: null }, { prisma });
    await upsertPriceListItem(actor(user.id, ['prices.manage']), priceList.id, { catalogItemId: itemInOtherCategory.id, unitPriceMinor: '10000', validFrom: new Date('2026-01-01T00:00:00.000Z'), validUntil: null }, { prisma });

    try {
      await expect(searchQuoteCatalogItems(noPermission, priceList.id, {}, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(searchQuoteCatalogItems(sales, '00000000-0000-4000-8000-000000000000', {}, { prisma, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(searchQuoteCatalogItems(sales, priceList.id, { cursor: 'not-a-real-cursor' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      // Walks every page via cursor and collects the full catalog — nothing is truncated at 50.
      const collected: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await searchQuoteCatalogItems(sales, priceList.id, { query: `búsqueda ${suffix}`, cursor, limit: 20 }, { prisma, now });
        collected.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(collected).toHaveLength(TOTAL_ITEMS);
      expect(new Set(collected).size).toBe(TOTAL_ITEMS);
      expect(collected).toContain(items[50].id); // concept #51 — unreachable with the old 50-item cap.

      // Direct search finds a single late concept without paging through the whole catalog.
      const direct = await searchQuoteCatalogItems(sales, priceList.id, { query: `${suffix} 55` }, { prisma, now });
      expect(direct.items.map((item) => item.id)).toEqual([itemWithHistoricalPrice.id]);
      expect(direct.items[0].price).toMatchObject({ unitPriceMinor: '25000' });
      expect(direct.items[0].blocker).toBeNull();

      // A concept with no price in this list is still returned, tagged with a typed blocker instead of vanishing.
      const missingPrice = await searchQuoteCatalogItems(sales, priceList.id, { query: `${suffix} 60` }, { prisma, now });
      expect(missingPrice.items).toEqual([expect.objectContaining({ id: itemWithoutPrice.id, price: null, blocker: 'NO_PRICE_IN_LIST' })]);

      // categoryId scopes the search away from concepts in another category.
      const scoped = await searchQuoteCatalogItems(sales, priceList.id, { categoryId: category.id, query: 'ajeno' }, { prisma, now });
      expect(scoped.items).toHaveLength(0);
      const unscoped = await searchQuoteCatalogItems(sales, priceList.id, { query: 'ajeno' }, { prisma, now });
      expect(unscoped.items.map((item) => item.id)).toEqual([itemInOtherCategory.id]);
    } finally {
      const allItemIds = [...items.map(({ id }) => id), itemInOtherCategory.id];
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.deleteMany({ where: { id: { in: allItemIds } } });
      await prisma.catalogCategory.deleteMany({ where: { id: { in: [category.id, otherCategory.id] } } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 60_000);
});
