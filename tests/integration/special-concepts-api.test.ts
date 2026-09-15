import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion } from '@/server/modules/quotes/service';
import { GET as listSpecialConceptsRoute } from '@/app/api/staff/catalog/special-concepts/route';
import { POST as promoteSpecialConceptRoute } from '@/app/api/staff/catalog/special-concepts/promote/route';

describe('staff special concepts API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const quoteIds: string[] = [];
  let salesToken = '';
  let managerToken = '';
  let priceListId = '';
  let promotedCatalogItemId = '';
  let fixtureSuffix = '';

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
    const [salesRole, managerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
    ]);
    const suffix = Date.now().toString();
    fixtureSuffix = suffix;
    const [sales, manager] = await Promise.all([
      prisma.user.create({ data: { email: `special-api-sales-${suffix}@example.test`, emailNormalized: `special-api-sales-${suffix}@example.test`, displayName: 'Special API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `special-api-manager-${suffix}@example.test`, emailNormalized: `special-api-manager-${suffix}@example.test`, displayName: 'Special API Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
    ]);
    userIds.push(sales.id, manager.id);
    salesToken = `special-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `special-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
    ]);

    const now = new Date('2026-04-02T12:00:00.000Z');
    const priceList = await prisma.priceList.create({ data: { code: `SPECIAL-API-PRICE-${suffix}`, name: 'Special API prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    const request = await createQuoteRequest({
      idempotencyKey: `special-api-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Special API ${suffix}`, email: `special-api-contact-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Special concepts API fixture', consentAt: now },
    }, { prisma, now });
    requestIds.push(request.quoteRequestId);
    clientIds.push(request.clientId);
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
    const version = await createQuoteVersion(
      { userId: manager.id, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['quotes.create']), mfaVerified: true },
      { quoteRequestId: request.quoteRequestId, priceListId, lines: [{ special: true, name: `Concepto API especial ${suffix}`, unit: 'servicio', quantity: '1', unitPriceMinor: '4000', reason: 'Fixture API' }] },
      { prisma, now },
    );
    quoteIds.push(version.quoteId);
  });

  it('lists special concepts and promotes one only for catalog.manage', async () => {
    const suffix = fixtureSuffix;

    expect((await listSpecialConceptsRoute(endpoint('/api/staff/catalog/special-concepts'))).status).toBe(401);
    expect((await listSpecialConceptsRoute(endpoint('/api/staff/catalog/special-concepts', salesToken))).status).toBe(403);

    const listResponse = await listSpecialConceptsRoute(endpoint('/api/staff/catalog/special-concepts', managerToken));
    expect(listResponse.status).toBe(200);
    const groups = await listResponse.json() as Array<{ normalizedName: string; unit: string; name: string; status: string }>;
    const group = groups.find((candidate) => candidate.normalizedName === `concepto api especial ${suffix}`.toLowerCase());
    expect(group).toBeTruthy();
    expect(group!.status).toBe('PENDING');

    const salesPromote = await promoteSpecialConceptRoute(endpoint('/api/staff/catalog/special-concepts/promote', salesToken, 'POST', { name: group!.name, unit: group!.unit }));
    expect(salesPromote.status).toBe(403);

    const foreignOrigin = await promoteSpecialConceptRoute(endpoint('/api/staff/catalog/special-concepts/promote', managerToken, 'POST', { name: group!.name, unit: group!.unit }, 'https://attacker.example'));
    expect(foreignOrigin.status).toBe(403);

    const promoteResponse = await promoteSpecialConceptRoute(endpoint('/api/staff/catalog/special-concepts/promote', managerToken, 'POST', { name: group!.name, unit: group!.unit }));
    expect(promoteResponse.status).toBe(201);
    const promoted = await promoteResponse.json() as { catalogItem: { id: string; code: string }; alreadyPromoted: boolean };
    expect(promoted.alreadyPromoted).toBe(false);
    expect(promoted.catalogItem.code).toMatch(/^ITEM-\d{6}$/);
    promotedCatalogItemId = promoted.catalogItem.id;

    const secondPromote = await promoteSpecialConceptRoute(endpoint('/api/staff/catalog/special-concepts/promote', managerToken, 'POST', { name: group!.name, unit: group!.unit }));
    expect(secondPromote.status).toBe(201);
    const secondBody = await secondPromote.json() as { catalogItem: { id: string }; alreadyPromoted: boolean };
    expect(secondBody.alreadyPromoted).toBe(true);
    expect(secondBody.catalogItem.id).toBe(promotedCatalogItemId);

    const listAfter = await listSpecialConceptsRoute(endpoint('/api/staff/catalog/special-concepts', managerToken));
    const groupsAfter = await listAfter.json() as Array<{ normalizedName: string; status: string }>;
    expect(groupsAfter.find((candidate) => candidate.normalizedName === `concepto api especial ${suffix}`.toLowerCase())?.status).toBe('PROMOTED');
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    if (promotedCatalogItemId) {
      await prisma.specialConceptPromotion.deleteMany({ where: { catalogItemId: promotedCatalogItemId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: promotedCatalogItemId } });
      await prisma.auditLog.deleteMany({ where: { entityId: promotedCatalogItemId } });
      await prisma.catalogItem.delete({ where: { id: promotedCatalogItemId } });
    }
    for (const quoteId of quoteIds) {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quoteId }, select: { id: true } })).map(({ id }) => id);
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: quoteId } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [quoteId, ...versionIds] } } });
    }
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    for (const requestId of requestIds) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    }
    const contactIds = requestIds.length ? (await prisma.quoteRequest.findMany({ where: { id: { in: requestIds } }, select: { contactId: true } })).map(({ contactId }) => contactId) : [];
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.priceListItem.deleteMany({ where: { priceListId } });
    await prisma.priceList.delete({ where: { id: priceListId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
});
