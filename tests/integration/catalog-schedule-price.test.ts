import { describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import {
  createCatalogCategory,
  createCatalogItem,
  createPriceList,
  schedulePrice,
  updateCatalogItem,
} from '@/server/modules/catalog/service';

const actor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('schedulePrice — atomic forward price scheduling (K1-02)', () => {
  it('closes the previous vigencia automatically, is idempotent, and rejects invalid schedules', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor('', ['catalog.manage', 'prices.manage']);
    const noPermission = actor('', []);
    const user = await prisma.user.create({
      data: { email: `catalog-schedule-${suffix}@example.test`, emailNormalized: `catalog-schedule-${suffix}@example.test`, displayName: 'Catalog schedule employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    noPermission.userId = user.id;

    const category = await createCatalogCategory(manager, { code: `K102CAT-${suffix}`, name: 'K1-02 schedule fixture' }, { prisma });
    const item = await createCatalogItem(manager, { code: `K102-${suffix}`, name: 'K1-02 concept', unit: 'pieza', categoryId: category.id }, { prisma });
    const priceList = await createPriceList(manager, { code: `K102PRICE-${suffix}`, name: 'K1-02 schedule prices', currencyCode: 'MXN', validFrom: new Date('2026-01-01T00:00:00.000Z') }, { prisma });

    try {
      await expect(schedulePrice(noPermission, priceList.id, { catalogItemId: item.id, unitPriceMinor: '10000', effectiveFrom: new Date('2026-02-01T00:00:00.000Z') }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      // First schedule: no previous price to close.
      const first = await schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '10000', effectiveFrom: new Date('2026-02-01T00:00:00.000Z'), reason: 'Precio inicial' }, { prisma });
      expect(first).toMatchObject({ unitPriceMinor: '10000', closedPreviousPriceId: null, closedPreviousValidUntil: null });

      // Second schedule: closes the first at the exact effectiveFrom of the second.
      const second = await schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '12000', effectiveFrom: new Date('2026-03-01T00:00:00.000Z') }, { prisma });
      expect(second.closedPreviousPriceId).toBe(first.priceListItemId);
      const closedFirst = await prisma.priceListItem.findUnique({ where: { id: first.priceListItemId }, select: { validUntil: true } });
      expect(closedFirst?.validUntil?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      const openSecond = await prisma.priceListItem.findUnique({ where: { id: second.priceListItemId }, select: { validUntil: true } });
      expect(openSecond?.validUntil).toBeNull();

      // Repeating the exact same schedule is a no-op — same row, no re-closing.
      const repeat = await schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '12000', effectiveFrom: new Date('2026-03-01T00:00:00.000Z') }, { prisma });
      expect(repeat).toMatchObject({ priceListItemId: second.priceListItemId, closedPreviousPriceId: null });

      // Correcting the not-yet-effective schedule updates it in place instead of creating a duplicate.
      const corrected = await schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '13500', effectiveFrom: new Date('2026-03-01T00:00:00.000Z') }, { prisma });
      expect(corrected.priceListItemId).toBe(second.priceListItemId);
      expect(corrected.unitPriceMinor).toBe('13500');
      expect(await prisma.priceListItem.count({ where: { priceListId: priceList.id, catalogItemId: item.id } })).toBe(2);

      // Scheduling before an already-scheduled date is rejected, not silently applied.
      await expect(schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '9000', effectiveFrom: new Date('2026-02-15T00:00:00.000Z') }, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      // Archiving the item blocks new schedules against it.
      await updateCatalogItem(manager, item.id, { status: 'ARCHIVED' }, { prisma });
      await expect(schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '9000', effectiveFrom: new Date('2026-04-01T00:00:00.000Z') }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      await updateCatalogItem(manager, item.id, { status: 'ACTIVE' }, { prisma });

      // A nonexistent price list is a 404, not a silent no-op.
      await expect(schedulePrice(manager, '00000000-0000-4000-8000-000000000000', { catalogItemId: item.id, unitPriceMinor: '9000', effectiveFrom: new Date('2026-04-01T00:00:00.000Z') }, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    } finally {
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('serializes concurrent identical schedules into a single idempotent row instead of a race', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const codeSuffix = Date.now().toString();
    const manager = actor('', ['catalog.manage', 'prices.manage']);
    const user = await prisma.user.create({
      data: { email: `catalog-schedule-race-${codeSuffix}@example.test`, emailNormalized: `catalog-schedule-race-${codeSuffix}@example.test`, displayName: 'Catalog schedule race employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;

    const category = await createCatalogCategory(manager, { code: `K102RACECAT-${codeSuffix}`, name: 'K1-02 race fixture' }, { prisma });
    const item = await createCatalogItem(manager, { code: `K102RACE-${codeSuffix}`, name: 'K1-02 race concept', unit: 'pieza', categoryId: category.id }, { prisma });
    const priceList = await createPriceList(manager, { code: `K102RACEPRICE-${codeSuffix}`, name: 'K1-02 race prices', currencyCode: 'MXN', validFrom: new Date('2026-01-01T00:00:00.000Z') }, { prisma });

    try {
      // Two operators submit the exact same "schedule this price" request at once (e.g. a retried click).
      // Without the price-list lock, both could read "no row yet" and race to create it.
      const [first, second] = await Promise.allSettled([
        schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '20000', effectiveFrom: new Date('2026-02-01T00:00:00.000Z') }, { prisma }),
        schedulePrice(manager, priceList.id, { catalogItemId: item.id, unitPriceMinor: '20000', effectiveFrom: new Date('2026-02-01T00:00:00.000Z') }, { prisma }),
      ]);
      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');
      const firstId = first.status === 'fulfilled' ? first.value.priceListItemId : null;
      const secondId = second.status === 'fulfilled' ? second.value.priceListItemId : null;
      expect(firstId).toBe(secondId);

      const rows = await prisma.priceListItem.findMany({ where: { priceListId: priceList.id, catalogItemId: item.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ unitPriceMinor: 20000n, validUntil: null });
    } finally {
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);
});
