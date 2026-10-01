import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { createSession } from '@/server/auth/sessions';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { POST as portalDeclinePost } from '@/app/api/portal/quotes/[id]/decline/route';

describe('customer quote decline API', () => {
  const prisma = getPrisma();
  let requestId = '';
  let foreignRequestId = '';
  let clientId = '';
  let foreignClientId = '';
  let contactId = '';
  let foreignContactId = '';
  let customerId = '';
  let foreignCustomerId = '';
  let employeeId = '';
  let quoteId = '';
  let versionId = '';
  let storageObjectId = '';
  let storageKey = '';
  let customerToken = '';
  let foreignCustomerToken = '';
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-10-01T19:00:00.000Z');

  const endpoint = (path: string, token?: string, body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { cookie: `ocpool_session=${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const routeContext = () => ({ params: Promise.resolve({ id: quoteId }) });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    const [request, foreignRequest] = await Promise.all([
      createQuoteRequest({ idempotencyKey: `quote-decline-api-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'API customer', email: `quote-decline-api-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Quote decline API fixture', consentAt: now } }, { prisma, now }),
      createQuoteRequest({ idempotencyKey: `quote-decline-api-foreign-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'API foreign customer', email: `quote-decline-api-foreign-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Foreign API fixture', consentAt: now } }, { prisma, now }),
    ]);
    requestId = request.quoteRequestId;
    foreignRequestId = foreignRequest.quoteRequestId;
    clientId = request.clientId;
    foreignClientId = foreignRequest.clientId;
    contactId = request.contactId;
    foreignContactId = foreignRequest.contactId;
    employeeId = (await prisma.user.create({ data: { email: `quote-decline-api-staff-${suffix}@example.test`, emailNormalized: `quote-decline-api-staff-${suffix}@example.test`, displayName: 'API staff', type: 'EMPLOYEE', status: 'ACTIVE' } })).id;
    const [customer, foreignCustomer] = await Promise.all([
      prisma.user.create({ data: { email: `quote-decline-api-customer-${suffix}@example.test`, emailNormalized: `quote-decline-api-customer-${suffix}@example.test`, displayName: 'API customer', type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `quote-decline-api-foreign-customer-${suffix}@example.test`, emailNormalized: `quote-decline-api-foreign-customer-${suffix}@example.test`, displayName: 'API foreign customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: foreignClientId, roles: { create: { roleId: customerRole.id } } } }),
    ]);
    customerId = customer.id;
    foreignCustomerId = foreignCustomer.id;
    await Promise.all([
      prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } }),
      prisma.clientContact.update({ where: { id: foreignContactId }, data: { userId: foreignCustomerId } }),
      prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'COTIZACION_DISPONIBLE', currentAssigneeId: employeeId } }),
    ]);
    customerToken = `quote-decline-api-${suffix}-customer-session-token`;
    foreignCustomerToken = `quote-decline-api-${suffix}-foreign-session-token`;
    await Promise.all([
      createSession({ userId: customerId, ipAddress: null, userAgent: 'quote-decline-api-test' }, { prisma, tokenGenerator: () => customerToken }),
      createSession({ userId: foreignCustomerId, ipAddress: null, userAgent: 'quote-decline-api-test' }, { prisma, tokenGenerator: () => foreignCustomerToken }),
    ]);

    quoteId = (await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } })).id;
    const version = await prisma.quoteVersion.create({ data: { quoteId, currencyCode: 'MXN', createdById: employeeId, status: 'ENVIADA', publishedAt: now } });
    versionId = version.id;
    await prisma.quote.update({ where: { id: quoteId }, data: { publishedVersionId: versionId } });
    const pdf = Buffer.from('%PDF-quote-decline-api');
    storageKey = `private-files/quote-decline-api/${suffix}.pdf`;
    const storage = getPrivateStorage();
    await storage.put({ key: storageKey, body: pdf, contentType: 'application/pdf' });
    const object = await prisma.storageObject.create({ data: { storageKey, contentType: 'application/pdf', byteSize: BigInt(pdf.byteLength), sha256: 'b'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = object.id;
    await prisma.generatedDocument.create({ data: { quoteId, quoteVersionId: versionId, storageObjectId, templateVersion: 'quote-decline-api-v1', status: 'READY', contentType: 'application/pdf', byteSize: BigInt(pdf.byteLength), sha256: 'b'.repeat(64), generatedAt: now, readyAt: now } });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const conversation = requestId ? await prisma.conversation.findUnique({ where: { quoteRequestId: requestId }, select: { id: true } }) : null;
    const messageIds = conversation ? (await prisma.conversationMessage.findMany({ where: { conversationId: conversation.id }, select: { id: true } })).map(({ id }) => id) : [];
    await prisma.inboxNotification.deleteMany({ where: { recipientId: { in: [employeeId, customerId, foreignCustomerId] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestId, foreignRequestId, quoteId, versionId, ...messageIds] } } });
    if (conversation) await prisma.conversation.delete({ where: { id: conversation.id } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, foreignRequestId, quoteId, ...(conversation ? [conversation.id] : [])] } } });
    if (quoteId) await prisma.quote.delete({ where: { id: quoteId } });
    if (storageObjectId) await prisma.storageObject.delete({ where: { id: storageObjectId } });
    if (requestId) await prisma.quoteRequest.delete({ where: { id: requestId } });
    if (foreignRequestId) await prisma.quoteRequest.delete({ where: { id: foreignRequestId } });
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    if (foreignContactId) await prisma.clientContact.delete({ where: { id: foreignContactId } });
    await prisma.user.deleteMany({ where: { id: { in: [employeeId, customerId, foreignCustomerId] } } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    if (foreignClientId) await prisma.client.delete({ where: { id: foreignClientId } });
    if (storageKey) await getPrivateStorage().delete(storageKey);
  });

  it('enforces same-origin, strict input, customer ownership, and idempotent replay', async () => {
    const path = `/api/portal/quotes/${quoteId}/decline`;
    const body = { versionId, reason: 'PRICE', comment: 'Precio elevado', idempotencyKey: 'decline-api-attempt-01' };
    expect((await portalDeclinePost(endpoint(path, customerToken, body, 'https://attacker.example'), routeContext())).status).toBe(403);
    expect((await portalDeclinePost(endpoint(path, undefined, body), routeContext())).status).toBe(401);
    expect((await portalDeclinePost(endpoint(path, customerToken, { ...body, unexpected: true }), routeContext())).status).toBe(400);
    expect((await portalDeclinePost(endpoint(path, customerToken, { ...body, reason: 'UNKNOWN' }), routeContext())).status).toBe(400);
    expect((await portalDeclinePost(endpoint(path, foreignCustomerToken, body), routeContext())).status).toBe(404);

    const response = await portalDeclinePost(endpoint(path, customerToken, body), routeContext());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const first = await response.json() as Record<string, unknown>;
    expect(first).toMatchObject({ quoteId, quoteVersionId: versionId, quoteRequestId: requestId, versionNumber: 1, status: 'RECHAZADA' });
    const replay = await portalDeclinePost(endpoint(path, customerToken, body), routeContext());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(first);
    expect((await portalDeclinePost(endpoint(path, customerToken, { ...body, reason: 'SCOPE' }), routeContext())).status).toBe(409);
    expect(await prisma.conversationMessage.count({ where: { conversation: { quoteRequestId: requestId } } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'QUOTE.DECLINED', aggregateId: requestId } })).toBe(1);
  });
});
