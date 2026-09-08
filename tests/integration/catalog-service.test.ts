import { describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import {
  createCatalogCategory,
  createCatalogItem,
  createPriceList,
  getPriceList,
  listCatalogItems,
  updateCatalogItem,
  upsertPriceListItem,
} from '@/server/modules/catalog/service';

const actor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('catalog and price list service', () => {
  it('keeps catalog mutations protected and price history non-overlapping', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.read', 'catalog.manage', 'prices.read', 'prices.manage']);
    const sales = actor(manager.userId, ['catalog.read', 'prices.read']);
    const user = await prisma.user.create({
      data: { email: `catalog-service-${suffix}@example.test`, emailNormalized: `catalog-service-${suffix}@example.test`, displayName: 'Catalog service employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    sales.userId = user.id;
    let categoryId = '';
    let itemId = '';
    let priceListId = '';

    try {
      await expect(createCatalogItem(sales, { code: `CAT-${suffix}`, name: 'No autorizado', unit: 'pieza' }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      const category = await createCatalogCategory(manager, { code: `CAT-${suffix}`, name: 'Categoría de prueba' }, { prisma });
      categoryId = category.id;
      const item = await createCatalogItem(manager, { code: `CAT-ITEM-${suffix}`, name: 'Concepto de prueba', description: 'Descripción persistente', unit: 'pieza', categoryId }, { prisma });
      itemId = item.id;
      expect((await listCatalogItems(sales, { query: `CAT-ITEM-${suffix}` }, { prisma })).items).toHaveLength(1);
      const archived = await updateCatalogItem(manager, itemId, { status: 'ARCHIVED' }, { prisma });
      expect(archived.status).toBe('ARCHIVED');
      expect((await listCatalogItems(sales, { status: 'ACTIVE', query: `CAT-ITEM-${suffix}` }, { prisma })).items).toHaveLength(0);

      const priceList = await createPriceList(manager, { code: `CAT-PRICE-${suffix}`, name: 'Precios de prueba', currencyCode: 'MXN', validFrom: new Date('2026-03-01T00:00:00.000Z') }, { prisma });
      priceListId = priceList.id;
      await updateCatalogItem(manager, itemId, { status: 'ACTIVE' }, { prisma });
      const first = await upsertPriceListItem(manager, priceListId, { catalogItemId: itemId, unitPriceMinor: '10000', validFrom: new Date('2026-03-01T00:00:00.000Z'), validUntil: new Date('2026-04-01T00:00:00.000Z') }, { prisma });
      expect(first.unitPriceMinor).toBe('10000');
      await expect(upsertPriceListItem(manager, priceListId, { catalogItemId: itemId, unitPriceMinor: '11000', validFrom: new Date('2026-03-15T00:00:00.000Z'), validUntil: new Date('2026-05-01T00:00:00.000Z') }, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const updated = await upsertPriceListItem(manager, priceListId, { catalogItemId: itemId, unitPriceMinor: '12000', validFrom: new Date('2026-03-01T00:00:00.000Z'), validUntil: new Date('2026-04-01T00:00:00.000Z') }, { prisma });
      expect(updated.unitPriceMinor).toBe('12000');
      const detail = await getPriceList(sales, priceListId, { prisma });
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0]).toMatchObject({ catalogItemId: itemId, unitPriceMinor: '12000' });
    } finally {
      if (priceListId) {
        await prisma.priceListItem.deleteMany({ where: { priceListId } });
        await prisma.priceList.delete({ where: { id: priceListId } });
      }
      if (itemId) await prisma.catalogItem.delete({ where: { id: itemId } });
      if (categoryId) await prisma.catalogCategory.delete({ where: { id: categoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);
});
