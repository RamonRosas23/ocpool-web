import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { getPrisma } from '@/server/db/client';
import { seedCatalogDemo } from '../../prisma/seed';

describe('catalog and quote relational schema', () => {
  it('exposes the commercial tables and database-level integrity constraints', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'catalog_categories',
          'catalog_items',
          'price_lists',
          'price_list_items',
          'quotes',
          'quote_versions',
          'quote_line_snapshots',
          'quote_status_history'
        )
      ORDER BY table_name
    `;

    expect(tables.map(({ table_name }) => table_name)).toEqual([
      'catalog_categories',
      'catalog_items',
      'price_list_items',
      'price_lists',
      'quote_line_snapshots',
      'quote_status_history',
      'quote_versions',
      'quotes',
    ]);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid IN (
        'catalog_items'::regclass,
        'price_list_items'::regclass,
        'quote_versions'::regclass,
        'quote_line_snapshots'::regclass
      )
        AND conname IN (
          'catalog_items_code_check',
          'price_list_items_validity_check',
          'price_list_items_unit_price_check',
          'quote_versions_totals_check',
          'quote_line_snapshots_amounts_check',
          'quote_line_snapshots_basis_points_check',
          'quote_line_snapshots_quantity_check',
          'price_list_items_no_overlap'
        )
      ORDER BY conname
    `;

    expect(constraints.map(({ conname }) => conname)).toEqual([
      'catalog_items_code_check',
      'price_list_items_no_overlap',
      'price_list_items_unit_price_check',
      'price_list_items_validity_check',
      'quote_line_snapshots_amounts_check',
      'quote_line_snapshots_basis_points_check',
      'quote_line_snapshots_quantity_check',
      'quote_versions_totals_check',
    ]);
  });

  it('rejects negative prices, overlapping validity windows, invalid totals and cross-client quotes', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-01-10T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `schema-${suffix}-request`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Schema client ${suffix}`, email: `schema-${suffix}@example.test` },
      detail: { projectType: 'Schema test', location: 'Sinaloa', description: 'Schema integrity fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `schema-employee-${suffix}@example.test`,
        emailNormalized: `schema-employee-${suffix}@example.test`,
        displayName: 'Schema Employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const otherClient = await prisma.client.create({ data: { displayName: `Other schema client ${suffix}` } });
    const category = await prisma.catalogCategory.create({ data: { code: `SCHEMA-${suffix}`, name: 'Schema fixtures' } });
    const catalogItem = await prisma.catalogItem.create({
      data: { code: `SCHEMA-ITEM-${suffix}`, name: 'Schema item', unit: 'pieza', categoryId: category.id },
    });
    const priceList = await prisma.priceList.create({
      data: { code: `SCHEMA-PRICE-${suffix}`, name: 'Schema prices', currencyCode: 'MXN', validFrom: now },
    });
    const priceWindow = { validFrom: now, validUntil: new Date('2026-02-01T00:00:00.000Z') };

    try {
      await expect(prisma.priceListItem.create({
        data: { priceListId: priceList.id, catalogItemId: catalogItem.id, unitPriceMinor: -1n, ...priceWindow },
      })).rejects.toThrow();

      await prisma.priceListItem.create({
        data: { priceListId: priceList.id, catalogItemId: catalogItem.id, unitPriceMinor: 1000n, ...priceWindow },
      });
      await expect(prisma.priceListItem.create({
        data: {
          priceListId: priceList.id,
          catalogItemId: catalogItem.id,
          unitPriceMinor: 1100n,
          validFrom: new Date('2026-01-15T00:00:00.000Z'),
          validUntil: new Date('2026-03-01T00:00:00.000Z'),
        },
      })).rejects.toThrow();

      await expect(prisma.quote.create({
        data: { quoteRequestId: request.quoteRequestId, clientId: otherClient.id },
      })).rejects.toThrow();

      const quote = await prisma.quote.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
      await expect(prisma.quoteVersion.create({
        data: {
          quoteId: quote.id,
          currencyCode: 'MXN',
          createdById: employee.id,
          subtotalMinor: 100n,
          taxableTotalMinor: 200n,
          totalMinor: 200n,
        },
      })).rejects.toThrow();

      const version = await prisma.quoteVersion.create({ data: { quoteId: quote.id, currencyCode: 'MXN', createdById: employee.id } });
      await expect(prisma.quoteLineSnapshot.create({
        data: {
          quoteVersionId: version.id,
          catalogItemId: catalogItem.id,
          catalogItemCode: catalogItem.code,
          name: catalogItem.name,
          unit: catalogItem.unit,
          quantityMilliunits: 0n,
          currencyCode: 'MXN',
          unitPriceMinor: 1000n,
        },
      })).rejects.toThrow();
    } finally {
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.client.delete({ where: { id: otherClient.id } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: catalogItem.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('seeds the local demo catalog idempotently', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    await seedCatalogDemo(prisma);
    await seedCatalogDemo(prisma);

    const category = await prisma.catalogCategory.findUnique({ where: { code: 'DEMO-SERVICES' } });
    const item = await prisma.catalogItem.findUnique({ where: { code: 'DEMO-CONSULTA' } });
    const priceList = await prisma.priceList.findUnique({ where: { code: 'DEMO-MXN' } });

    expect(category).toMatchObject({ code: 'DEMO-SERVICES', status: 'ACTIVE' });
    expect(item).toMatchObject({ code: 'DEMO-CONSULTA', categoryId: category?.id });
    expect(priceList).toMatchObject({ code: 'DEMO-MXN', currencyCode: 'MXN' });
    expect(await prisma.catalogCategory.count({ where: { code: 'DEMO-SERVICES' } })).toBe(1);
    expect(await prisma.catalogItem.count({ where: { code: 'DEMO-CONSULTA' } })).toBe(1);
    expect(await prisma.priceList.count({ where: { code: 'DEMO-MXN' } })).toBe(1);
    expect(await prisma.priceListItem.count({ where: { priceListId: priceList?.id, catalogItemId: item?.id } })).toBe(1);

    await prisma.priceListItem.deleteMany({ where: { priceListId: priceList?.id } });
    await prisma.priceList.deleteMany({ where: { id: priceList?.id } });
    await prisma.catalogItem.deleteMany({ where: { id: item?.id } });
    await prisma.catalogCategory.deleteMany({ where: { id: category?.id } });
  });
});
