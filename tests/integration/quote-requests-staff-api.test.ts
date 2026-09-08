import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { GET as listRoute } from '@/app/api/staff/quote-requests/route';
import { GET as detailRoute } from '@/app/api/staff/quote-requests/[id]/route';
import { POST as assignRoute } from '@/app/api/staff/quote-requests/[id]/assign/route';
import { POST as statusRoute } from '@/app/api/staff/quote-requests/[id]/status/route';

describe('staff quote request API', () => {
  const prisma = getPrisma();
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const userIds: string[] = [];
  let salesToken = '';
  let customerToken = '';
  let requestId = '';
  let assigneeId = '';

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
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const salesEmail = `api-sales-${suffix}@example.test`;
    const customerEmail = `api-customer-${suffix}@example.test`;
    const assigneeEmail = `api-assignee-${suffix}@example.test`;
    const [sales, customer, assignee] = await Promise.all([
      prisma.user.create({ data: { email: salesEmail, emailNormalized: salesEmail, displayName: 'API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: customerEmail, emailNormalized: customerEmail, displayName: 'API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: assigneeEmail, emailNormalized: assigneeEmail, displayName: 'API Assignee', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
    ]);
    userIds.push(sales.id, customer.id, assignee.id);
    assigneeId = assignee.id;
    salesToken = `staff-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `staff-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken });
    const created = await createQuoteRequest({
      idempotencyKey: `staff-api-request-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: 'API Request Client', email: `api-request-${suffix}@example.test`, phone: '+52 667 000 7788' },
      detail: { projectType: 'Hotel', location: 'Los Cabos', description: 'Staff API contract', consentAt: new Date('2026-01-04T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-01-04T12:00:00.000Z') });
    requestId = created.quoteRequestId;
    requestIds.push(created.quoteRequestId);
    clientIds.push(created.clientId);
    contactIds.push(created.contactId);
  });

  it('requires an employee session and returns authorized list/detail projections', async () => {
    const unauthenticated = await listRoute(endpoint('/api/staff/quote-requests'));
    expect(unauthenticated.status).toBe(401);

    const customer = await listRoute(endpoint('/api/staff/quote-requests', customerToken));
    expect(customer.status).toBe(403);

    const list = await listRoute(endpoint(`/api/staff/quote-requests?query=${encodeURIComponent('API Request Client')}&pageSize=10`, salesToken));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ total: 1, items: [{ id: requestId, status: 'RECIBIDA' }] });

    const detail = await detailRoute(endpoint(`/api/staff/quote-requests/${requestId}`, salesToken), { params: Promise.resolve({ id: requestId }) });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as Record<string, unknown>;
    expect(detailBody).toMatchObject({ id: requestId, folio: expect.stringMatching(/^OCQ-/), detail: { budgetCents: null } });
    expect(JSON.stringify(detailBody)).not.toContain('idempotencyKeyHash');
  });

  it('protects mutations with same-origin, permissions and transition rules', async () => {
    const foreign = await assignRoute(endpoint(`/api/staff/quote-requests/${requestId}/assign`, salesToken, 'POST', { assignedToId: assigneeId }, 'https://attacker.example'), { params: Promise.resolve({ id: requestId }) });
    expect(foreign.status).toBe(403);

    const assigned = await assignRoute(endpoint(`/api/staff/quote-requests/${requestId}/assign`, salesToken, 'POST', { assignedToId: assigneeId, reason: 'API assignment' }), { params: Promise.resolve({ id: requestId }) });
    expect(assigned.status).toBe(200);
    await expect(assigned.json()).resolves.toMatchObject({ currentAssigneeId: assigneeId });

    const status = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, salesToken, 'POST', { toStatus: 'EN_REVISION', reason: 'API review' }), { params: Promise.resolve({ id: requestId }) });
    expect(status.status).toBe(200);
    const invalid = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, salesToken, 'POST', { toStatus: 'ACEPTADA' }), { params: Promise.resolve({ id: requestId }) });
    expect(invalid.status).toBe(409);

    const customerMutation = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, customerToken, 'POST', { toStatus: 'EN_ELABORACION' }), { params: Promise.resolve({ id: requestId }) });
    expect(customerMutation.status).toBe(403);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
});
