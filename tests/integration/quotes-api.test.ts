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
import { POST as requestApprovalRoute } from '@/app/api/staff/quotes/versions/[versionId]/approvals/route';
import { POST as decideApprovalRoute } from '@/app/api/staff/quotes/approvals/[approvalId]/decision/route';
import { POST as cloneRoute } from '@/app/api/staff/quotes/[quoteRequestId]/clone/route';

describe('staff quotes API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  let salesToken = '';
  let customerToken = '';
  let managerToken = '';
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
    const [salesRole, customerRole, managerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
    ]);
    const suffix = Date.now().toString();
    const [sales, customer, manager] = await Promise.all([
      prisma.user.create({ data: { email: `quotes-api-sales-${suffix}@example.test`, emailNormalized: `quotes-api-sales-${suffix}@example.test`, displayName: 'Quotes API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `quotes-api-customer-${suffix}@example.test`, emailNormalized: `quotes-api-customer-${suffix}@example.test`, displayName: 'Quotes API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `quotes-api-manager-${suffix}@example.test`, emailNormalized: `quotes-api-manager-${suffix}@example.test`, displayName: 'Quotes API Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
    ]);
    userIds.push(sales.id, customer.id, manager.id);
    salesToken = `quotes-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `quotes-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `quotes-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
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
    expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${versionId}/status`, salesToken, 'POST', { toStatus: 'EN_REVISION' }), { params: Promise.resolve({ versionId }) })).status).toBe(400);
    expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${versionId}/status`, salesToken, 'POST', { action: 'submit_for_review' }), { params: Promise.resolve({ versionId }) })).status).toBe(200);
    expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${versionId}/status`, salesToken, 'POST', { action: 'publish' }), { params: Promise.resolve({ versionId }) })).status).toBe(200);
    expect(await prisma.generatedDocument.findUnique({ where: { quoteVersionId_documentType: { quoteVersionId: versionId, documentType: 'QUOTE_PDF' } }, select: { status: true, readyAt: true } })).toMatchObject({ status: 'READY', readyAt: expect.any(Date) });
    expect((await replaceDraftRoute(endpoint(`/api/staff/quotes/versions/${versionId}`, salesToken, 'PATCH', { priceListId, lines: [{ catalogItemId: itemId, quantity: '3' }] }), { params: Promise.resolve({ versionId }) })).status).toBe(409);
    expect(await prisma.quoteRequest.findUnique({ where: { id: requestId }, select: { status: true } })).toMatchObject({ status: 'COTIZACION_DISPONIBLE' });
  });

  it('accepts a special concept line through the API and gates sending behind a SPECIAL_CONCEPT approval (K1-05)', async () => {
    const suffix = Date.now().toString();
    const now = new Date('2026-03-16T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quotes-api-special-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quotes API special ${suffix}`, email: `quotes-api-special-contact-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Special concept API fixture', consentAt: now },
    }, { prisma, now });
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
    const params = { params: Promise.resolve({ quoteRequestId: request.quoteRequestId }) };

    try {
      const created = await createQuoteRoute(endpoint(`/api/staff/quotes/${request.quoteRequestId}`, salesToken, 'POST', {
        priceListId,
        lines: [{ special: true, name: 'Concepto especial API', unit: 'servicio', quantity: '1', unitPriceMinor: '7500', reason: 'Ajuste solicitado por el cliente' }],
      }), params);
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { versionId: string; totalMinor: string };
      const specialVersionId = createdBody.versionId;
      expect(createdBody.totalMinor).toBe('7500');

      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${specialVersionId}/status`, salesToken, 'POST', { action: 'submit_for_review' }), { params: Promise.resolve({ versionId: specialVersionId }) })).status).toBe(200);
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${specialVersionId}/status`, salesToken, 'POST', { action: 'publish' }), { params: Promise.resolve({ versionId: specialVersionId }) })).status).toBe(409);

      const approvalResponse = await requestApprovalRoute(endpoint(`/api/staff/quotes/versions/${specialVersionId}/approvals`, salesToken, 'POST', { type: 'SPECIAL_CONCEPT', policyVersion: 'special-concept-v1' }), { params: Promise.resolve({ versionId: specialVersionId }) });
      expect(approvalResponse.status).toBe(201);
      const approval = await approvalResponse.json() as { id: string };

      expect((await decideApprovalRoute(endpoint(`/api/staff/quotes/approvals/${approval.id}/decision`, salesToken, 'POST', { decision: 'APPROVED' }), { params: Promise.resolve({ approvalId: approval.id }) })).status).toBe(403);
      const decided = await decideApprovalRoute(endpoint(`/api/staff/quotes/approvals/${approval.id}/decision`, managerToken, 'POST', { decision: 'APPROVED' }), { params: Promise.resolve({ approvalId: approval.id }) });
      expect(decided.status).toBe(200);

      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${specialVersionId}/status`, salesToken, 'POST', { action: 'publish' }), { params: Promise.resolve({ versionId: specialVersionId }) })).status).toBe(200);
    } finally {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  });

  it('names return-to-draft and reject as closed actions requiring a reason (D2-04)', async () => {
    const suffix = Date.now().toString();
    const now = new Date('2026-03-18T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quotes-api-named-actions-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quotes API named actions ${suffix}`, email: `quotes-api-named-actions-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Named actions fixture', consentAt: now },
    }, { prisma, now });
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
    const params = { params: Promise.resolve({ quoteRequestId: request.quoteRequestId }) };

    try {
      const created = await createQuoteRoute(endpoint(`/api/staff/quotes/${request.quoteRequestId}`, salesToken, 'POST', {
        priceListId,
        lines: [{ catalogItemId: itemId, quantity: '1' }],
      }), params);
      const draftVersionId = (await created.json() as { versionId: string }).versionId;
      const versionParams = { params: Promise.resolve({ versionId: draftVersionId }) };

      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${draftVersionId}/status`, salesToken, 'POST', { action: 'submit_for_review' }), versionParams)).status).toBe(200);
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${draftVersionId}/status`, salesToken, 'POST', { action: 'return_to_draft' }), versionParams)).status).toBe(400);
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${draftVersionId}/status`, salesToken, 'POST', { action: 'return_to_draft', reason: 'Falta ajustar una línea.' }), versionParams)).status).toBe(200);
      const history = await prisma.quoteStatusHistory.findFirst({ where: { quoteVersionId: draftVersionId, toStatus: 'BORRADOR' }, orderBy: { createdAt: 'desc' } });
      expect(history).toMatchObject({ reason: 'Falta ajustar una línea.' });

      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${draftVersionId}/status`, salesToken, 'POST', { action: 'submit_for_review' }), versionParams)).status).toBe(200);
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${draftVersionId}/status`, salesToken, 'POST', { action: 'reject' }), versionParams)).status).toBe(400);
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${draftVersionId}/status`, salesToken, 'POST', { action: 'reject', reason: 'El cliente ya no continuará.' }), versionParams)).status).toBe(200);
      expect(await prisma.quoteVersion.findUnique({ where: { id: draftVersionId }, select: { status: true } })).toMatchObject({ status: 'RECHAZADA' });
    } finally {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  });

  it('clones a published version into a fresh working draft (D2-04)', async () => {
    const suffix = Date.now().toString();
    const now = new Date('2026-03-19T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quotes-api-clone-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quotes API clone ${suffix}`, email: `quotes-api-clone-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Clone fixture', consentAt: now },
    }, { prisma, now });
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
    const params = { params: Promise.resolve({ quoteRequestId: request.quoteRequestId }) };
    const cloneParams = { params: Promise.resolve({ quoteRequestId: request.quoteRequestId }) };

    try {
      const noPublicationYet = await cloneRoute(endpoint(`/api/staff/quotes/${request.quoteRequestId}/clone`, salesToken, 'POST', { priceListId }), cloneParams);
      expect(noPublicationYet.status).toBe(409);

      const created = await createQuoteRoute(endpoint(`/api/staff/quotes/${request.quoteRequestId}`, salesToken, 'POST', {
        priceListId,
        lines: [{ catalogItemId: itemId, quantity: '1' }],
      }), params);
      const firstVersionId = (await created.json() as { versionId: string }).versionId;
      const firstVersionParams = { params: Promise.resolve({ versionId: firstVersionId }) };
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${firstVersionId}/status`, salesToken, 'POST', { action: 'submit_for_review' }), firstVersionParams)).status).toBe(200);
      expect((await transitionQuoteRoute(endpoint(`/api/staff/quotes/versions/${firstVersionId}/status`, salesToken, 'POST', { action: 'publish' }), firstVersionParams)).status).toBe(200);

      const cloned = await cloneRoute(endpoint(`/api/staff/quotes/${request.quoteRequestId}/clone`, salesToken, 'POST', { priceListId }), cloneParams);
      expect(cloned.status).toBe(201);
      const clonedBody = await cloned.json() as { versionId: string; status: string };
      expect(clonedBody.status).toBe('BORRADOR');
      expect(clonedBody.versionId).not.toBe(firstVersionId);

      const workingConflict = await cloneRoute(endpoint(`/api/staff/quotes/${request.quoteRequestId}/clone`, salesToken, 'POST', { priceListId }), cloneParams);
      expect(workingConflict.status).toBe(409);
    } finally {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
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
