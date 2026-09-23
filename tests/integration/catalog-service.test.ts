import { describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import {
  createCatalogCategory,
  createCatalogItem,
  createPriceList,
  getPriceList,
  listCatalogItems,
  updateCatalogCategory,
  updateCatalogItem,
  updatePriceList,
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

  it('edits and archives a category only after its active dependencies are cleared (K1-03)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.read', 'catalog.manage']);
    const sales = actor(manager.userId, ['catalog.read']);
    const user = await prisma.user.create({
      data: { email: `catalog-category-${suffix}@example.test`, emailNormalized: `catalog-category-${suffix}@example.test`, displayName: 'Catalog category employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    sales.userId = user.id;
    let parentCategoryId = '';
    let childCategoryId = '';
    let itemId = '';

    try {
      await expect(updateCatalogCategory(sales, '00000000-0000-4000-8000-000000000000', { name: 'No autorizado' }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const parent = await createCatalogCategory(manager, { code: `CAT-PARENT-${suffix}`, name: 'Categoría original' }, { prisma });
      parentCategoryId = parent.id;
      await expect(updateCatalogCategory(manager, parent.id, {}, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const renamed = await updateCatalogCategory(manager, parent.id, { name: 'Categoría renombrada', sortOrder: 5 }, { prisma });
      expect(renamed).toMatchObject({ name: 'Categoría renombrada', sortOrder: 5 });

      // Blocked by an active item directly under it.
      const item = await createCatalogItem(manager, { code: `CAT-DEP-ITEM-${suffix}`, name: 'Concepto dependiente', unit: 'pieza', categoryId: parent.id }, { prisma });
      itemId = item.id;
      await expect(updateCatalogCategory(manager, parent.id, { status: 'ARCHIVED' }, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await updateCatalogItem(manager, item.id, { status: 'ARCHIVED' }, { prisma });

      // Blocked by an active child category even once the item is archived.
      const child = await prisma.catalogCategory.create({ data: { code: `CAT-CHILD-${suffix}`, name: 'Subcategoría activa', parentId: parent.id } });
      childCategoryId = child.id;
      await expect(updateCatalogCategory(manager, parent.id, { status: 'ARCHIVED' }, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await prisma.catalogCategory.update({ where: { id: child.id }, data: { status: 'ARCHIVED' } });

      // With no active dependencies left, archiving succeeds, and can be reversed.
      const archived = await updateCatalogCategory(manager, parent.id, { status: 'ARCHIVED' }, { prisma });
      expect(archived.status).toBe('ARCHIVED');
      const reactivated = await updateCatalogCategory(manager, parent.id, { status: 'ACTIVE' }, { prisma });
      expect(reactivated.status).toBe('ACTIVE');
    } finally {
      if (itemId) await prisma.catalogItem.delete({ where: { id: itemId } });
      if (childCategoryId) await prisma.catalogCategory.delete({ where: { id: childCategoryId } });
      if (parentCategoryId) await prisma.catalogCategory.delete({ where: { id: parentCategoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('renames and archives a price list without touching its identity fields (K1-03)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['prices.read', 'prices.manage']);
    const sales = actor(manager.userId, ['prices.read']);
    const user = await prisma.user.create({
      data: { email: `catalog-pricelist-update-${suffix}@example.test`, emailNormalized: `catalog-pricelist-update-${suffix}@example.test`, displayName: 'Price list update employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    sales.userId = user.id;
    let priceListId = '';

    try {
      await expect(updatePriceList(sales, '00000000-0000-4000-8000-000000000000', { name: 'No autorizado' }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const priceList = await createPriceList(manager, { code: `PRICE-UPDATE-${suffix}`, name: 'Lista original', currencyCode: 'MXN', validFrom: new Date('2026-03-01T00:00:00.000Z') }, { prisma });
      priceListId = priceList.id;
      await expect(updatePriceList(manager, priceList.id, {}, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const renamed = await updatePriceList(manager, priceList.id, { name: 'Lista renombrada' }, { prisma });
      expect(renamed).toMatchObject({ name: 'Lista renombrada', code: priceList.code, currencyCode: 'MXN' });

      const archived = await updatePriceList(manager, priceList.id, { status: 'ARCHIVED' }, { prisma });
      expect(archived.status).toBe('ARCHIVED');
      const reactivated = await updatePriceList(manager, priceList.id, { status: 'ACTIVE' }, { prisma });
      expect(reactivated.status).toBe('ACTIVE');

      await expect(updatePriceList(manager, '00000000-0000-4000-8000-000000000000', { name: 'Nada' }, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    } finally {
      if (priceListId) await prisma.priceList.delete({ where: { id: priceListId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('autogenerates sequential codes for categories and concepts, and still honors an explicit code (K1-03 parte 2)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.read', 'catalog.manage']);
    const user = await prisma.user.create({
      data: { email: `catalog-autocode-${suffix}@example.test`, emailNormalized: `catalog-autocode-${suffix}@example.test`, displayName: 'Catalog autocode employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    let categoryId1 = '';
    let categoryId2 = '';
    let itemId1 = '';
    let itemId2 = '';
    let manualCategoryId = '';

    try {
      const category1 = await createCatalogCategory(manager, { name: 'Auto categoría uno' }, { prisma });
      categoryId1 = category1.id;
      expect(category1.code).toMatch(/^CAT-\d{6}$/);
      const category2 = await createCatalogCategory(manager, { name: 'Auto categoría dos' }, { prisma });
      categoryId2 = category2.id;
      expect(category2.code).toMatch(/^CAT-\d{6}$/);
      expect(Number(category2.code.slice(4))).toBe(Number(category1.code.slice(4)) + 1);

      const item1 = await createCatalogItem(manager, { name: 'Auto concepto uno', unit: 'pieza' }, { prisma });
      itemId1 = item1.id;
      expect(item1.code).toMatch(/^ITEM-\d{6}$/);
      const item2 = await createCatalogItem(manager, { name: 'Auto concepto dos', unit: 'pieza' }, { prisma });
      itemId2 = item2.id;
      expect(Number(item2.code.slice(5))).toBe(Number(item1.code.slice(5)) + 1);

      const manualCategory = await createCatalogCategory(manager, { code: `MANUAL-${suffix}`, name: 'Categoría manual' }, { prisma });
      manualCategoryId = manualCategory.id;
      expect(manualCategory.code).toBe(`MANUAL-${suffix}`);
    } finally {
      if (itemId1) await prisma.catalogItem.delete({ where: { id: itemId1 } });
      if (itemId2) await prisma.catalogItem.delete({ where: { id: itemId2 } });
      if (categoryId1) await prisma.catalogCategory.delete({ where: { id: categoryId1 } });
      if (categoryId2) await prisma.catalogCategory.delete({ where: { id: categoryId2 } });
      if (manualCategoryId) await prisma.catalogCategory.delete({ where: { id: manualCategoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('builds category hierarchy and rejects cycles when reassigning a parent (K1-03 parte 2)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.read', 'catalog.manage']);
    const user = await prisma.user.create({
      data: { email: `catalog-hierarchy-${suffix}@example.test`, emailNormalized: `catalog-hierarchy-${suffix}@example.test`, displayName: 'Catalog hierarchy employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    let categoryAId = '';
    let categoryBId = '';
    let categoryCId = '';

    try {
      const categoryA = await createCatalogCategory(manager, { code: `HIER-A-${suffix}`, name: 'Categoría A' }, { prisma });
      categoryAId = categoryA.id;
      const categoryB = await createCatalogCategory(manager, { code: `HIER-B-${suffix}`, name: 'Categoría B', parentId: categoryA.id }, { prisma });
      categoryBId = categoryB.id;
      expect(categoryB.parentId).toBe(categoryA.id);

      await prisma.catalogCategory.update({ where: { id: categoryA.id }, data: { status: 'ARCHIVED' } });
      await expect(createCatalogCategory(manager, { code: `HIER-X-${suffix}`, name: 'Categoría X', parentId: categoryA.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      await prisma.catalogCategory.update({ where: { id: categoryA.id }, data: { status: 'ACTIVE' } });

      const categoryC = await createCatalogCategory(manager, { code: `HIER-C-${suffix}`, name: 'Categoría C', parentId: categoryB.id }, { prisma });
      categoryCId = categoryC.id;

      await expect(updateCatalogCategory(manager, categoryA.id, { parentId: categoryA.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      await expect(updateCatalogCategory(manager, categoryA.id, { parentId: categoryC.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      await prisma.catalogCategory.update({ where: { id: categoryB.id }, data: { status: 'ARCHIVED' } });
      await expect(updateCatalogCategory(manager, categoryC.id, { parentId: categoryB.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      await prisma.catalogCategory.update({ where: { id: categoryB.id }, data: { status: 'ACTIVE' } });

      const reassigned = await updateCatalogCategory(manager, categoryC.id, { parentId: categoryA.id }, { prisma });
      expect(reassigned.parentId).toBe(categoryA.id);

      const rootAgain = await updateCatalogCategory(manager, categoryC.id, { parentId: null }, { prisma });
      expect(rootAgain.parentId).toBeNull();
    } finally {
      if (categoryCId) await prisma.catalogCategory.delete({ where: { id: categoryCId } });
      if (categoryBId) await prisma.catalogCategory.delete({ where: { id: categoryBId } });
      if (categoryAId) await prisma.catalogCategory.delete({ where: { id: categoryAId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('round 10 audit fix: never leaves an active category hanging off an archived parent when create/reparent races an archive', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.read', 'catalog.manage']);
    const user = await prisma.user.create({
      data: { email: `catalog-category-race-${suffix}@example.test`, emailNormalized: `catalog-category-race-${suffix}@example.test`, displayName: 'Catalog category race employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    let parentId = '';
    let childId = '';
    let targetId = '';
    let otherParentId = '';
    let moverId = '';

    try {
      // Same operator archives a category at the exact moment a second tab creates a child under it
      // (e.g. two open staff sessions). Without the `FOR UPDATE` lock added in this fix, both could read
      // "parent is ACTIVE" / "no active children yet" before either commits, leaving an active category
      // hanging off an archived parent -- invisible in the tree by default (it only lists status=ACTIVE).
      const parent = await createCatalogCategory(manager, { code: `RACE-P-${suffix}`, name: 'Padre de carrera' }, { prisma });
      parentId = parent.id;
      const [createResult, archiveResult] = await Promise.allSettled([
        createCatalogCategory(manager, { code: `RACE-C-${suffix}`, name: 'Hijo de carrera', parentId: parent.id }, { prisma }),
        updateCatalogCategory(manager, parent.id, { status: 'ARCHIVED' }, { prisma }),
      ]);
      if (createResult.status === 'fulfilled') childId = createResult.value.id;

      const parentAfter = await prisma.catalogCategory.findUnique({ where: { id: parent.id }, select: { status: true } });
      const activeChildrenAfter = await prisma.catalogCategory.count({ where: { parentId: parent.id, status: 'ACTIVE' } });
      if (parentAfter?.status === 'ARCHIVED') expect(activeChildrenAfter).toBe(0);
      // Exactly one side of the race should have won; the other must have failed with a clean, typed error.
      expect([createResult.status, archiveResult.status].filter((status) => status === 'fulfilled')).toHaveLength(1);

      // Same shape of race, but for reparenting an existing category into the target instead of creating
      // a fresh child under it -- a distinct code path (updateCatalogCategory's own parentId reassignment)
      // that shares the same lock now, but didn't before this fix.
      const target = await createCatalogCategory(manager, { code: `RACE-T-${suffix}`, name: 'Objetivo de carrera' }, { prisma });
      targetId = target.id;
      const otherParent = await createCatalogCategory(manager, { code: `RACE-O-${suffix}`, name: 'Otro padre' }, { prisma });
      otherParentId = otherParent.id;
      const mover = await createCatalogCategory(manager, { code: `RACE-M-${suffix}`, name: 'Categoría a mover', parentId: otherParent.id }, { prisma });
      moverId = mover.id;
      const [reparentResult, targetArchiveResult] = await Promise.allSettled([
        updateCatalogCategory(manager, mover.id, { parentId: target.id }, { prisma }),
        updateCatalogCategory(manager, target.id, { status: 'ARCHIVED' }, { prisma }),
      ]);

      const targetAfter = await prisma.catalogCategory.findUnique({ where: { id: target.id }, select: { status: true } });
      const activeUnderTargetAfter = await prisma.catalogCategory.count({ where: { parentId: target.id, status: 'ACTIVE' } });
      if (targetAfter?.status === 'ARCHIVED') expect(activeUnderTargetAfter).toBe(0);
      expect([reparentResult.status, targetArchiveResult.status].filter((status) => status === 'fulfilled')).toHaveLength(1);
    } finally {
      if (moverId) await prisma.catalogCategory.deleteMany({ where: { id: moverId } });
      if (otherParentId) await prisma.catalogCategory.deleteMany({ where: { id: otherParentId } });
      if (targetId) await prisma.catalogCategory.deleteMany({ where: { id: targetId } });
      if (childId) await prisma.catalogCategory.deleteMany({ where: { id: childId } });
      if (parentId) await prisma.catalogCategory.deleteMany({ where: { id: parentId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);
});
