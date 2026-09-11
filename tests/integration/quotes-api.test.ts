import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { GET as listQuotesRoute } from '@/app/api/staff/quotes/route';
import { GET as getQuoteRoute, POST as createQuoteRoute } from '@/app/api/staff/quotes/[quoteRequestId]/route';
import { PATCH as replaceDraftRoute } from '@/app/api/staff/quotes/versions/[versionId]/route';
import { POST as transitionQuoteRoute } from '@/app/api/staff/quotes/versions/[versionId]/status/route';

describe('staff quotes API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  let salesToken = '';
  let customerToken = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let categoryId = '';
  let itemId = '';
  let priceListId = '';
  let versionId = '';

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
    const [salesRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const suffix = Date.now().toString();
    const [sales, customer] = await Promise.all([
      prisma.user.create({ data: { email: `quotes-api-sales-${suffix}@example.test`, emailNormalized: `quotes-api-sales-${suffix}@example.test`, displayName: 'Quotes API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `quotes-api-customer-${suffix}@example.test`, emailNormalized: `quotes-api-customer-${suffix}@example.test`, displayName: 'Quotes API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
    ]);
    userIds.push(sales.id, customer.id);
    salesToken = `quotes-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `quotes-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken }),
    ]);

    const now = new Date('2026-03-11T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quotes-api-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quotes API ${suffix}`, email: `quotes-api-contact-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Quotes API fixture', consentAt: now },
    }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'EN_ELABORACION' } });
    const category = await prisma.catalogCategory.create({ data: { code: `APIQ-${suffix}`, name: 'API quotes' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `APIQ-ITEM-${suffix}`, name: 'API quote item', unit: 'pieza', categoryId: category.id } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `APIQ-PRICE-${suffix}`, name: 'API quote prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 10000n, validFrom: now } });
  });

  it('protects the builder, creates a draft, edits it and sends only through allowed operations', async () => {
    const params = { params: Promise.resolve({ quoteRequestId: requestId }) };
    expect((await listQuotesRoute(endpoint('/api/staff/quotes'))).status).toBe(401);
    expect((await listQuotesRoute(endpoint('/api/staff/quotes', customerToken))).status).toBe(403);
    expect((await listQuotesRoute(endpoint('/api/staff/quotes', salesToken))).status).toBe(200);

    const foreignOrigin = await createQuoteRoute(endpoint(`/api/staff/quotes/${requestId}`, salesToken, 'POST', { priceListId, lines: [{ catalogItemId: itemId, quantity: '1' }] }, 'https://attacker.example'), params);
    expect(foreignOrigin.status).toBe(403);
    const overrideForbidden = await createQuoteRoute(endpoint(`/api/staff/quotes/${requestId}`, salesToken, 'POST', { priceListId, lines: [{ catalogItemId: itemId, quantity: '1', unitPriceMinorOverride: '12000' }] }), params);
    expect(overrideForbidden.status).toBe(403);

    const created = await createQuoteRoute(endpoint(`/api/staff/quotes/${requestId}`, salesToken, 'POST', { priceListId, lines: [{ catalogItemId: itemId, quantity: '1', taxBasisPoints: 1600 }] }), params);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { versionId: string; totalMinor: string };
    versionId = createdBody.versionId;
    expect(createdBody.totalMinor).toBe('11600');

    const workspace = await getQuoteRoute(endpoint(`/api/staff/quotes/${requestId}`, salesToken), params);
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({ request: { id: requestId }, quote: { currentVersion: { id: versionId, totalMinor: '11600' } } });

    const replaced = await replaceDraftRoute(endpoint(`/api/staff/quotes/versions/${versionId}`, salesToken, 'PATCH', { priceListId, lines: [{ catalogItemId: itemId, quantity: '2' }] }), { params: Promise.resolve({ versionId }) });
    expect(replaced.status).toBe(200);
    await expect(replaced.json()).resolves.toMatchObject({ versionId, totalMinor: '20000' });
    expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${versionId}/status`, salesToken, 'POST', { toStatus: 'EN_REVISION' }), { params: Promise.resolve({ versionId }) })).status).toBe(200);
    expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${versionId}/status`, salesToken, 'POST', { toStatus: 'ENVIADA' }), { params: Promise.resolve({ versionId }) })).status).toBe(200);
    expect(await prisma.generatedDocument.findUnique({ where: { quoteVersionId_documentType: { quoteVersionId: versionId, documentType: 'QUOTE_PDF' } }, select: { status: true, readyAt: true } })).toMatchObject({ status: 'READY', readyAt: expect.any(Date) });
    expect((await replaceDraftRoute(endpoint(`/api/staff/quotes/versions/${versionId}`, salesToken, 'PATCH', { priceListId, lines: [{ catalogItemId: itemId, quantity: '3' }] }), { params: Promise.resolve({ versionId }) })).status).toBe(409);
    expect(await prisma.quoteRequest.findUnique({ where: { id: requestId }, select: { status: true } })).toMatchObject({ status: 'COTIZACION_DISPONIBLE' });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: requestId } }, select: { id: true } })).map(({ id }) => id);
    await prisma.quote.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestId, ...versionIds] } } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.priceListItem.deleteMany({ where: { priceListId } });
    await prisma.priceList.delete({ where: { id: priceListId } });
    await prisma.catalogItem.delete({ where: { id: itemId } });
    await prisma.catalogCategory.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });
});
