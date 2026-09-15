import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { GET as listItemsRoute, POST as createItemRoute } from '@/app/api/staff/catalog/items/route';
import { PATCH as updateItemRoute } from '@/app/api/staff/catalog/items/[id]/route';
import { POST as createCategoryRoute } from '@/app/api/staff/catalog/categories/route';
import { GET as priceListRoute } from '@/app/api/staff/catalog/price-lists/[id]/route';
import { POST as createPriceListRoute } from '@/app/api/staff/catalog/price-lists/route';
import { POST as priceItemRoute } from '@/app/api/staff/catalog/price-lists/[id]/items/route';
import { GET as searchRoute } from '@/app/api/staff/catalog/price-lists/[id]/search/route';

describe('staff catalog API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const categoryIds: string[] = [];
  const itemIds: string[] = [];
  const priceListIds: string[] = [];
  let salesToken = '';
  let customerToken = '';
  let managerToken = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `ocpool_session=${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole, managerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [sales, customer, manager] = await Promise.all([
      prisma.user.create({ data: { email: `catalog-api-sales-${suffix}@example.test`, emailNormalized: `catalog-api-sales-${suffix}@example.test`, displayName: 'Catalog API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `catalog-api-customer-${suffix}@example.test`, emailNormalized: `catalog-api-customer-${suffix}@example.test`, displayName: 'Catalog API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `catalog-api-manager-${suffix}@example.test`, emailNormalized: `catalog-api-manager-${suffix}@example.test`, displayName: 'Catalog API Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
    ]);
    userIds.push(sales.id, customer.id, manager.id);
    salesToken = `catalog-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `catalog-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `catalog-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
    ]);
  });

  it('enforces employee authentication and separates read from manage permissions', async () => {
    expect((await listItemsRoute(endpoint('/api/staff/catalog/items'))).status).toBe(401);
    expect((await listItemsRoute(endpoint('/api/staff/catalog/items', customerToken))).status).toBe(403);
    expect((await listItemsRoute(endpoint('/api/staff/catalog/items', salesToken))).status).toBe(200);
    expect((await createItemRoute(endpoint('/api/staff/catalog/items', salesToken, 'POST', { code: 'FORBIDDEN-ITEM', name: 'No', unit: 'pieza' }))).status).toBe(403);
  });

  it('protects catalog and price mutations with same-origin and backend permissions', async () => {
    const foreignCategory = await createCategoryRoute(endpoint('/api/staff/catalog/categories', managerToken, 'POST', { code: `API-CAT-${Date.now()}`, name: 'Foreign origin' }, 'https://attacker.example'));
    expect(foreignCategory.status).toBe(403);

    const categoryResponse = await createCategoryRoute(endpoint('/api/staff/catalog/categories', managerToken, 'POST', { code: `API-CAT-${Date.now()}`, name: 'API category' }));
    expect(categoryResponse.status).toBe(201);
    const category = await categoryResponse.json() as { id: string };
    categoryIds.push(category.id);
    const itemResponse = await createItemRoute(endpoint('/api/staff/catalog/items', managerToken, 'POST', { code: `API-ITEM-${Date.now()}`, name: 'API item', description: 'API item description', unit: 'pieza', categoryId: category.id }));
    expect(itemResponse.status).toBe(201);
    const item = await itemResponse.json() as { id: string };
    itemIds.push(item.id);
    const archiveResponse = await updateItemRoute(endpoint(`/api/staff/catalog/items/${item.id}`, managerToken, 'PATCH', { status: 'ARCHIVED' }), { params: Promise.resolve({ id: item.id }) });
    expect(archiveResponse.status).toBe(200);

    const listResponse = await createPriceListRoute(endpoint('/api/staff/catalog/price-lists', managerToken, 'POST', { code: `API-PRICE-${Date.now()}`, name: 'API prices', currencyCode: 'MXN', validFrom: '2026-03-01T00:00:00.000Z' }));
    expect(listResponse.status).toBe(201);
    const priceList = await listResponse.json() as { id: string };
    priceListIds.push(priceList.id);
    const archivedItem = await priceItemRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}/items`, managerToken, 'POST', { catalogItemId: item.id, unitPriceMinor: '1000', validFrom: '2026-03-01T00:00:00.000Z' }), { params: Promise.resolve({ id: priceList.id }) });
    expect(archivedItem.status).toBe(400);
    await updateItemRoute(endpoint(`/api/staff/catalog/items/${item.id}`, managerToken, 'PATCH', { status: 'ACTIVE' }), { params: Promise.resolve({ id: item.id }) });
    const priceItem = await priceItemRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}/items`, managerToken, 'POST', { catalogItemId: item.id, unitPriceMinor: '1000', validFrom: '2026-03-01T00:00:00.000Z' }), { params: Promise.resolve({ id: priceList.id }) });
    expect(priceItem.status).toBe(201);
    const salesRead = await priceListRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}`, salesToken), { params: Promise.resolve({ id: priceList.id }) });
    expect(salesRead.status).toBe(200);
    await expect(salesRead.json()).resolves.toMatchObject({ id: priceList.id, items: [{ catalogItemId: item.id, unitPriceMinor: '1000' }] });

    const unauthenticatedSearch = await searchRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}/search`), { params: Promise.resolve({ id: priceList.id }) });
    expect(unauthenticatedSearch.status).toBe(401);
    const customerSearch = await searchRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}/search`, customerToken), { params: Promise.resolve({ id: priceList.id }) });
    expect(customerSearch.status).toBe(403);
    const invalidLimit = await searchRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}/search?limit=0`, salesToken), { params: Promise.resolve({ id: priceList.id }) });
    expect(invalidLimit.status).toBe(400);
    const search = await searchRoute(endpoint(`/api/staff/catalog/price-lists/${priceList.id}/search?query=${encodeURIComponent('API item')}`, salesToken), { params: Promise.resolve({ id: priceList.id }) });
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({ items: [{ id: item.id, price: { unitPriceMinor: '1000' }, blocker: null }], nextCursor: null });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...categoryIds, ...itemIds, ...priceListIds] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...categoryIds, ...itemIds, ...priceListIds] } } });
    await prisma.priceListItem.deleteMany({ where: { priceListId: { in: priceListIds } } });
    await prisma.priceList.deleteMany({ where: { id: { in: priceListIds } } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.catalogCategory.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
});
