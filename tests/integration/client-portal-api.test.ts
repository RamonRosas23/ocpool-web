import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { GET as listPortalRequestsRoute } from '@/app/api/portal/requests/route';
import { GET as getPortalRequestRoute } from '@/app/api/portal/requests/[id]/route';
import { GET as getPortalQuoteRoute } from '@/app/api/portal/quotes/[id]/route';

describe('customer portal API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  let customerAToken = '';
  let customerBToken = '';
  let customerNoPermissionToken = '';
  let employeeToken = '';
  let customerASessionId = '';
  let requestAId = '';
  let requestBId = '';
  let clientAId = '';
  let clientBId = '';
  let contactAId = '';
  let contactBId = '';
  let quoteAId = '';
  let categoryId = '';
  let itemId = '';
  let priceListId = '';

  const endpoint = (path: string, token?: string) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    headers: token ? { cookie: `ocpool_session=${token}` } : {},
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    const suffix = Date.now().toString();
    const now = new Date('2026-04-02T12:00:00.000Z');
    const [requestA, requestB] = await Promise.all([
      createQuoteRequest({ idempotencyKey: `portal-api-a-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal API A ${suffix}`, email: `portal-api-a-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'API A', consentAt: now } }, { prisma, now }),
      createQuoteRequest({ idempotencyKey: `portal-api-b-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal API B ${suffix}`, email: `portal-api-b-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'API B privado', consentAt: now } }, { prisma, now }),
    ]);
    requestAId = requestA.quoteRequestId;
    requestBId = requestB.quoteRequestId;
    clientAId = requestA.clientId;
    clientBId = requestB.clientId;
    contactAId = requestA.contactId;
    contactBId = requestB.contactId;
    await prisma.quoteRequest.updateMany({ where: { id: { in: [requestAId, requestBId] } }, data: { status: 'EN_ELABORACION' } });
    const [customerA, customerB, customerNoPermission, employee] = await Promise.all([
      prisma.user.create({ data: { email: `portal-api-user-a-${suffix}@example.test`, emailNormalized: `portal-api-user-a-${suffix}@example.test`, displayName: 'Portal API A user', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `portal-api-user-b-${suffix}@example.test`, emailNormalized: `portal-api-user-b-${suffix}@example.test`, displayName: 'Portal API B user', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientBId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `portal-api-user-no-permission-${suffix}@example.test`, emailNormalized: `portal-api-user-no-permission-${suffix}@example.test`, displayName: 'Portal API user without permission', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId } }),
      prisma.user.create({ data: { email: `portal-api-employee-${suffix}@example.test`, emailNormalized: `portal-api-employee-${suffix}@example.test`, displayName: 'Portal API employee', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    userIds.push(customerA.id, customerB.id, customerNoPermission.id, employee.id);
    customerAToken = `portal-api-a-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerBToken = `portal-api-b-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerNoPermissionToken = `portal-api-no-permission-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    employeeToken = `portal-api-e-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const [customerASession] = await Promise.all([
      createSession({ userId: customerA.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerAToken }),
      createSession({ userId: customerB.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerBToken }),
      createSession({ userId: customerNoPermission.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerNoPermissionToken }),
      createSession({ userId: employee.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => employeeToken }),
    ]);
    customerASessionId = customerASession.sessionId;
    const category = await prisma.catalogCategory.create({ data: { code: `PORTAL-API-${suffix}`, name: 'Portal API' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `PORTAL-API-ITEM-${suffix}`, name: 'Portal API item', unit: 'pieza', categoryId } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `PORTAL-API-PRICE-${suffix}`, name: 'Portal API prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 7000n, validFrom: now } });
    const quoteEmployee = { userId: employee.id, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.create', 'quotes.send']), mfaVerified: true };
    const quote = await createQuoteVersion(quoteEmployee, { quoteRequestId: requestAId, priceListId, lines: [{ catalogItemId: itemId, quantity: '1' }] }, { prisma, now });
    quoteAId = quote.quoteId;
    await transitionQuoteVersion(quoteEmployee, quote.versionId, 'EN_REVISION', { prisma, now });
    await transitionQuoteVersion(quoteEmployee, quote.versionId, 'ENVIADA', { prisma, now });
  });

  it('requires a customer session, enforces client scope and returns safe public projections', async () => {
    expect((await listPortalRequestsRoute(endpoint('/api/portal/requests'))).status).toBe(401);
    expect((await listPortalRequestsRoute(endpoint('/api/portal/requests', employeeToken))).status).toBe(403);
    expect((await listPortalRequestsRoute(endpoint('/api/portal/requests', customerNoPermissionToken))).status).toBe(403);
    const list = await listPortalRequestsRoute(endpoint('/api/portal/requests', customerAToken));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ total: 1, items: [{ id: requestAId }] });

    const own = await getPortalRequestRoute(endpoint(`/api/portal/requests/${requestAId}`, customerAToken), { params: Promise.resolve({ id: requestAId }) });
    expect(own.status).toBe(200);
    const ownBody = await own.json() as { request: { id: string }; quote: { id: string } };
    expect(ownBody.request.id).toBe(requestAId);
    expect((await getPortalRequestRoute(endpoint(`/api/portal/requests/${requestBId}`, customerAToken), { params: Promise.resolve({ id: requestBId }) })).status).toBe(404);
    expect((await getPortalRequestRoute(endpoint('/api/portal/requests/not-a-uuid', customerAToken), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(404);
    expect((await getPortalQuoteRoute(endpoint(`/api/portal/quotes/${quoteAId}`, customerBToken), { params: Promise.resolve({ id: quoteAId }) })).status).toBe(404);
    const quote = await getPortalQuoteRoute(endpoint(`/api/portal/quotes/${quoteAId}`, customerAToken), { params: Promise.resolve({ id: quoteAId }) });
    expect(quote.status).toBe(200);
    const quoteBody = await quote.json() as { quote: { id: string; versions: Array<{ status: string }> } };
    expect(quoteBody).toMatchObject({ quote: { id: quoteAId, versions: [{ status: 'ENVIADA' }] } });
    expect(JSON.stringify(quoteBody)).not.toContain('tokenHash');

    await prisma.session.update({ where: { id: customerASessionId }, data: { revokedAt: new Date() } });
    expect((await listPortalRequestsRoute(endpoint('/api/portal/requests', customerAToken))).status).toBe(401);
    await prisma.client.update({ where: { id: clientBId }, data: { status: 'ARCHIVED' } });
    expect((await listPortalRequestsRoute(endpoint('/api/portal/requests', customerBToken))).status).toBe(401);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: [requestAId, requestBId] } }, }, select: { id: true } })).map(({ id }) => id);
    await prisma.quote.deleteMany({ where: { quoteRequestId: { in: [requestAId, requestBId] } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestAId, requestBId, quoteAId] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestAId, requestBId, quoteAId, ...versionIds] } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: [requestAId, requestBId] } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: [contactAId, contactBId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } });
    await prisma.priceListItem.deleteMany({ where: { priceListId } });
    await prisma.priceList.delete({ where: { id: priceListId } });
    await prisma.catalogItem.delete({ where: { id: itemId } });
    await prisma.catalogCategory.delete({ where: { id: categoryId } });
  });
});
