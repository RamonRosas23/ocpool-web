import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { GET as listGet } from '@/app/api/notifications/route';
import { GET as summaryGet } from '@/app/api/notifications/summary/route';
import { POST as readPost } from '@/app/api/notifications/read/route';

describe('inbox API', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const userIds: string[] = [];
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  let salesId = '';
  let otherId = '';
  let customerId = '';
  let ownRequestId = '';
  let foreignRequestId = '';
  let salesToken = '';
  let customerToken = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: { ...(token ? { cookie: `ocpool_session=${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const notice = (recipientId: string, overrides: Record<string, unknown> = {}) => prisma.inboxNotification.create({ data: { recipientId, kind: 'customer.activity', priority: 'HIGH', title: 'Aviso', actionPath: '/staff/requests', data: { folio: 'OCQ-2026-000001', clientName: 'Cliente' }, ...overrides } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }), prisma.role.findUniqueOrThrow({ where: { key: 'customer' } })]);
    for (const [index, owner] of ['own', 'foreign'].entries()) {
      const request = await createQuoteRequest({ idempotencyKey: `inbox-api-${owner}-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `API ${owner}`, email: `inbox-api-${owner}-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Chihuahua', description: 'Fixture de la API de avisos', consentAt: now } }, { prisma, now: new Date(now.getTime() + index) });
      requestIds.push(request.quoteRequestId);
      clientIds.push(request.clientId);
      contactIds.push(request.contactId);
    }
    [ownRequestId, foreignRequestId] = requestIds;
    const sales = await prisma.user.create({ data: { email: `inbox-api-sales-${suffix}@example.test`, emailNormalized: `inbox-api-sales-${suffix}@example.test`, displayName: 'API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } });
    const other = await prisma.user.create({ data: { email: `inbox-api-other-${suffix}@example.test`, emailNormalized: `inbox-api-other-${suffix}@example.test`, displayName: 'API Other', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const customer = await prisma.user.create({ data: { email: `inbox-api-customer-${suffix}@example.test`, emailNormalized: `inbox-api-customer-${suffix}@example.test`, displayName: 'API Customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientIds[0], roles: { create: { roleId: customerRole.id } } } });
    salesId = sales.id;
    otherId = other.id;
    customerId = customer.id;
    userIds.push(salesId, otherId, customerId);
    await prisma.quoteRequest.update({ where: { id: ownRequestId }, data: { currentAssigneeId: salesId } });
    await prisma.quoteRequest.update({ where: { id: foreignRequestId }, data: { currentAssigneeId: otherId } });
    salesToken = `inbox-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    customerToken = `inbox-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'inbox-api-test' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'inbox-api-test' }, { prisma, tokenGenerator: () => customerToken });
    await notice(salesId, { quoteRequestId: ownRequestId, lastActivityAt: new Date(now.getTime() - 3000) });
    await notice(salesId, { quoteRequestId: foreignRequestId, title: 'Fuera de alcance' });
    await notice(salesId, { quoteRequestId: null, kind: 'request.unassigned_from_you', priority: 'NORMAL', title: 'Te quitaron un expediente', lastActivityAt: new Date(now.getTime() - 2000) });
    await notice(salesId, { quoteRequestId: ownRequestId, kind: 'approval.requested', priority: 'HIGH', actionRequired: true, groupKey: `approval:api-${suffix}`, title: 'Aprobación', lastActivityAt: new Date(now.getTime() - 1000) });
    await notice(salesId, { quoteRequestId: ownRequestId, kind: 'request.received', priority: 'INFO', title: 'Informativo', lastActivityAt: now });
    await notice(customerId, { quoteRequestId: ownRequestId, kind: 'team.activity', title: 'El equipo OCPOOL te escribió' });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  it('requires a session and never caches', async () => {
    expect((await summaryGet(endpoint('/api/notifications/summary'))).status).toBe(401);
    const response = await summaryGet(endpoint('/api/notifications/summary', salesToken));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('counts and lists only what the person can still see', async () => {
    const summary = await (await summaryGet(endpoint('/api/notifications/summary', salesToken))).json() as { unread: number; actionRequired: number; latest: Array<{ title: string }>; unreadByRequest: Record<string, number> };
    // El informativo no cuenta en la campana; el del expediente ajeno no se ve.
    expect(summary.unread).toBe(3);
    expect(summary.actionRequired).toBe(1);
    expect(summary.latest.map((item) => item.title)).not.toContain('Fuera de alcance');
    expect(summary.unreadByRequest[ownRequestId]).toBe(2);
    const customer = await (await summaryGet(endpoint('/api/notifications/summary', customerToken))).json() as { unread: number; latest: Array<{ title: string }> };
    expect(customer).toMatchObject({ unread: 1, latest: [{ title: 'El equipo OCPOOL te escribió' }] });
  });

  it('paginates by cursor and filters', async () => {
    const first = await (await listGet(endpoint('/api/notifications?limit=2', salesToken))).json() as { items: Array<{ title: string }>; nextCursor: string | null };
    expect(first.items.map((item) => item.title)).toEqual(['Informativo', 'Aprobación']);
    const second = await (await listGet(endpoint(`/api/notifications?limit=2&cursor=${first.nextCursor}`, salesToken))).json() as { items: Array<{ title: string }>; nextCursor: string | null };
    expect(second.items.map((item) => item.title)).toEqual(['Te quitaron un expediente', 'Aviso']);
    expect(second.nextCursor).toBeNull();
    const action = await (await listGet(endpoint('/api/notifications?filter=action', salesToken))).json() as { items: Array<{ title: string }> };
    expect(action.items.map((item) => item.title)).toEqual(['Aprobación']);
    expect((await listGet(endpoint('/api/notifications?filter=nope', salesToken))).status).toBe(400);
  });

  it('marks as read only from the same origin, per file or everything', async () => {
    expect((await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { all: true }, 'https://attacker.example'))).status).toBe(403);
    const byRequest = await (await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { quoteRequestId: ownRequestId, scope: 'activity' }))).json() as { updated: number; unread: number; actionRequired: number };
    // La aprobación pendiente sigue sin leer: abrir el expediente no la da por atendida.
    expect(byRequest).toMatchObject({ unread: 2, actionRequired: 1 });
    const all = await (await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { all: true }))).json() as { unread: number; actionRequired: number };
    expect(all).toMatchObject({ unread: 0, actionRequired: 1 });
    expect((await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { ids: [] }))).status).toBe(400);
  });
});
