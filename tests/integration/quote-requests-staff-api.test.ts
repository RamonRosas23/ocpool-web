import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { GET as listRoute, POST as createStaffRequestRoute } from '@/app/api/staff/quote-requests/route';
import { GET as detailRoute, PATCH as updateRoute } from '@/app/api/staff/quote-requests/[id]/route';
import { GET as activityRoute } from '@/app/api/staff/quote-requests/[id]/activity/route';
import { GET as matchesRoute } from '@/app/api/staff/quote-requests/matches/route';
import { POST as assignRoute } from '@/app/api/staff/quote-requests/[id]/assign/route';
import { POST as takeRoute } from '@/app/api/staff/quote-requests/[id]/take/route';
import { POST as statusRoute } from '@/app/api/staff/quote-requests/[id]/status/route';
import { POST as requestInformationRoute } from '@/app/api/staff/quote-requests/[id]/request-information/route';
import { POST as markInformationReviewedRoute } from '@/app/api/staff/quote-requests/[id]/mark-information-reviewed/route';

describe('staff quote request API', () => {
  const prisma = getPrisma();
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const userIds: string[] = [];
  let salesToken = '';
  let customerToken = '';
  let noPermissionToken = '';
  let requestId = '';
  let assigneeId = '';
  let requestContactId = '';
  let requestEmail = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `ocpool_session=${token}` } : {}),
      ...(body ? { 'content-type': 'application/json', 'idempotency-key': `staff-api-${Date.now()}-abcdefghijklmnopqrstuvwxyz` } : {}),
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
    requestEmail = `api-request-${suffix}@example.test`;
    const [sales, customer, assignee] = await Promise.all([
      prisma.user.create({ data: { email: salesEmail, emailNormalized: salesEmail, displayName: 'API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: customerEmail, emailNormalized: customerEmail, displayName: 'API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: assigneeEmail, emailNormalized: assigneeEmail, displayName: 'API Assignee', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
    ]);
    userIds.push(sales.id, customer.id, assignee.id);
    assigneeId = assignee.id;
    salesToken = `staff-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `staff-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const noPermissionEmail = `api-no-permission-${suffix}@example.test`;
    const noPermission = await prisma.user.create({ data: { email: noPermissionEmail, emailNormalized: noPermissionEmail, displayName: 'API Without permission', type: 'EMPLOYEE', status: 'ACTIVE' } });
    userIds.push(noPermission.id);
    noPermissionToken = `staff-api-no-permission-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken });
    await createSession({ userId: noPermission.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => noPermissionToken });
    const created = await createQuoteRequest({
      idempotencyKey: `staff-api-request-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: 'API Request Client', email: requestEmail, phone: '+52 667 000 7788' },
      detail: { projectType: 'Hotel', location: 'Los Cabos', description: 'Staff API contract', consentAt: new Date('2026-01-04T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-01-04T12:00:00.000Z') });
    requestId = created.quoteRequestId;
    requestContactId = created.contactId;
    requestIds.push(created.quoteRequestId);
    clientIds.push(created.clientId);
    contactIds.push(created.contactId);
  });

  it('requires an employee session and returns authorized list/detail projections', async () => {
    const unauthenticated = await listRoute(endpoint('/api/staff/quote-requests'));
    expect(unauthenticated.status).toBe(401);

    const customer = await listRoute(endpoint('/api/staff/quote-requests', customerToken));
    expect(customer.status).toBe(403);

    const noPermission = await listRoute(endpoint('/api/staff/quote-requests', noPermissionToken));
    expect(noPermission.status).toBe(403);

    const list = await listRoute(endpoint(`/api/staff/quote-requests?query=${encodeURIComponent('API Request Client')}&pageSize=10`, salesToken));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ total: 1, items: [{ id: requestId, status: 'RECIBIDA' }] });

    const workspaceList = await listRoute(endpoint(`/api/staff/quote-requests?query=${encodeURIComponent('API Request Client')}&stage=RECIBIDA&sort=oldest&view=all&tab=summary`, salesToken));
    expect(workspaceList.status).toBe(200);
    await expect(workspaceList.json()).resolves.toMatchObject({ total: 1, items: [{ id: requestId, status: 'RECIBIDA' }] });

    const detail = await detailRoute(endpoint(`/api/staff/quote-requests/${requestId}`, salesToken), { params: Promise.resolve({ id: requestId }) });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as Record<string, unknown>;
    expect(detailBody).toMatchObject({ id: requestId, folio: expect.stringMatching(/^OCQ-/), detail: { budgetCents: null } });
    expect(JSON.stringify(detailBody)).not.toContain('idempotencyKeyHash');

    const customerDetail = await detailRoute(endpoint(`/api/staff/quote-requests/${requestId}`, customerToken), { params: Promise.resolve({ id: requestId }) });
    expect(customerDetail.status).toBe(403);

    const noPermissionDetail = await detailRoute(endpoint(`/api/staff/quote-requests/${requestId}`, noPermissionToken), { params: Promise.resolve({ id: requestId }) });
    expect(noPermissionDetail.status).toBe(403);

    const invalidDetail = await detailRoute(endpoint('/api/staff/quote-requests/not-a-uuid', salesToken), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(invalidDetail.status).toBe(400);

    const update = await updateRoute(endpoint(`/api/staff/quote-requests/${requestId}`, salesToken, 'PATCH', { detail: { location: 'La Paz' } }), { params: Promise.resolve({ id: requestId }) });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ quoteRequestId: requestId, changedFields: ['detail.location'] });

    const matches = await matchesRoute(endpoint(`/api/staff/quote-requests/matches?email=${encodeURIComponent(requestEmail)}`, salesToken));
    expect(matches.status).toBe(200);

    const freeRequest = await createQuoteRequest({
      idempotencyKey: `staff-api-take-${Date.now()}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: 'API Take Client', email: `api-take-${Date.now()}@example.test`, phone: '+52 667 000 7711' },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Solicitud libre para probar la toma operativa.', consentAt: new Date('2026-01-04T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-01-04T12:00:00.000Z') });
    requestIds.push(freeRequest.quoteRequestId);
    clientIds.push(freeRequest.clientId);
    contactIds.push(freeRequest.contactId);
    const taken = await takeRoute(endpoint(`/api/staff/quote-requests/${freeRequest.quoteRequestId}/take`, salesToken, 'POST', {}), { params: Promise.resolve({ id: freeRequest.quoteRequestId }) });
    expect(taken.status).toBe(200);
    await expect(taken.json()).resolves.toMatchObject({ quoteRequestId: freeRequest.quoteRequestId, currentAssigneeId: expect.any(String), status: 'TAKEN' });

    const created = await createStaffRequestRoute(endpoint('/api/staff/quote-requests', salesToken, 'POST', {
      displayName: 'API Contact Reused',
      email: requestEmail,
      phone: '+52 667 000 7788',
      projectType: 'Residencial',
      location: 'Chihuahua',
      description: 'Solicitud staff API creada con dedupe explícito.',
      contactMatchId: requestContactId,
      consent: true,
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { quoteRequestId: string; clientId: string; contactId: string };
    requestIds.push(createdBody.quoteRequestId);
    clientIds.push(createdBody.clientId);
    contactIds.push(createdBody.contactId);
    expect(createdBody).toMatchObject({ clientId: expect.any(String), contactId: requestContactId });
  });

  it('protects mutations with same-origin, permissions and transition rules', async () => {
    const foreign = await assignRoute(endpoint(`/api/staff/quote-requests/${requestId}/assign`, salesToken, 'POST', { assignedToId: assigneeId }, 'https://attacker.example'), { params: Promise.resolve({ id: requestId }) });
    expect(foreign.status).toBe(403);

    const assigned = await assignRoute(endpoint(`/api/staff/quote-requests/${requestId}/assign`, salesToken, 'POST', { assignedToId: assigneeId, reason: 'API assignment' }), { params: Promise.resolve({ id: requestId }) });
    expect(assigned.status).toBe(403);

    const taken = await takeRoute(endpoint(`/api/staff/quote-requests/${requestId}/take`, salesToken, 'POST', {}), { params: Promise.resolve({ id: requestId }) });
    expect(taken.status).toBe(200);
    await expect(taken.json()).resolves.toMatchObject({ currentAssigneeId: expect.any(String), status: 'TAKEN' });

    const status = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, salesToken, 'POST', { toStatus: 'EN_REVISION', reason: 'API review' }), { params: Promise.resolve({ id: requestId }) });
    expect(status.status).toBe(200);
    const directInformation = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, salesToken, 'POST', { toStatus: 'INFORMACION_REQUERIDA' }), { params: Promise.resolve({ id: requestId }) });
    expect(directInformation.status).toBe(400);
    const information = await requestInformationRoute(endpoint(`/api/staff/quote-requests/${requestId}/request-information`, salesToken, 'POST', {
      message: 'Necesitamos confirmar las dimensiones antes de preparar la propuesta.',
      idempotencyKey: `api-information-${Date.now()}-abcdefghijklmnopqrstuvwxyz`,
      missingFields: ['detail.dimensions'],
    }), { params: Promise.resolve({ id: requestId }) });
    expect(information.status).toBe(200);
    await expect(information.json()).resolves.toMatchObject({ quoteRequestId: requestId, toStatus: 'INFORMACION_REQUERIDA', status: 'REQUESTED' });
    const invalid = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, salesToken, 'POST', { toStatus: 'ACEPTADA' }), { params: Promise.resolve({ id: requestId }) });
    expect(invalid.status).toBe(409);

    const customerMutation = await statusRoute(endpoint(`/api/staff/quote-requests/${requestId}/status`, customerToken, 'POST', { toStatus: 'EN_ELABORACION' }), { params: Promise.resolve({ id: requestId }) });
    expect(customerMutation.status).toBe(403);
  });

  it('marks information reviewed through a real route handler only after a customer reply exists (D2-03)', async () => {
    const unauthenticated = await markInformationReviewedRoute(endpoint(`/api/staff/quote-requests/${requestId}/mark-information-reviewed`, undefined, 'POST', {}), { params: Promise.resolve({ id: requestId }) });
    expect(unauthenticated.status).toBe(401);

    const foreign = await markInformationReviewedRoute(endpoint(`/api/staff/quote-requests/${requestId}/mark-information-reviewed`, salesToken, 'POST', {}, 'https://attacker.example'), { params: Promise.resolve({ id: requestId }) });
    expect(foreign.status).toBe(403);

    const tooEarly = await markInformationReviewedRoute(endpoint(`/api/staff/quote-requests/${requestId}/mark-information-reviewed`, salesToken, 'POST', {}), { params: Promise.resolve({ id: requestId }) });
    expect(tooEarly.status).toBe(409);

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { quoteRequestId_clientId: { quoteRequestId: requestId, clientId: clientIds[0] } }, select: { id: true } });
    const replyCustomer = await prisma.user.create({
      data: { email: `api-mark-reviewed-${Date.now()}@example.test`, emailNormalized: `api-mark-reviewed-${Date.now()}@example.test`, displayName: 'API mark-reviewed customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientIds[0] },
    });
    await prisma.conversationMessage.create({
      data: { conversationId: conversation.id, senderUserId: replyCustomer.id, visibility: 'CUSTOMER', body: 'Las dimensiones son 12x6m.' },
    });

    const reviewed = await markInformationReviewedRoute(endpoint(`/api/staff/quote-requests/${requestId}/mark-information-reviewed`, salesToken, 'POST', {}), { params: Promise.resolve({ id: requestId }) });
    expect(reviewed.status).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({ quoteRequestId: requestId, fromStatus: 'INFORMACION_REQUERIDA', toStatus: 'EN_REVISION' });

    await prisma.user.delete({ where: { id: replyCustomer.id } });
  });

  it('exposes request activity through a real route handler, gated the same way as the rest of the workspace', async () => {
    const unauthenticated = await activityRoute(endpoint(`/api/staff/quote-requests/${requestId}/activity`), { params: Promise.resolve({ id: requestId }) });
    expect(unauthenticated.status).toBe(401);

    const customer = await activityRoute(endpoint(`/api/staff/quote-requests/${requestId}/activity`, customerToken), { params: Promise.resolve({ id: requestId }) });
    expect(customer.status).toBe(403);

    const noPermission = await activityRoute(endpoint(`/api/staff/quote-requests/${requestId}/activity`, noPermissionToken), { params: Promise.resolve({ id: requestId }) });
    expect(noPermission.status).toBe(403);

    const invalidCursor = await activityRoute(endpoint(`/api/staff/quote-requests/${requestId}/activity?cursor=not-a-cursor`, salesToken), { params: Promise.resolve({ id: requestId }) });
    expect(invalidCursor.status).toBe(400);

    const ok = await activityRoute(endpoint(`/api/staff/quote-requests/${requestId}/activity`, salesToken), { params: Promise.resolve({ id: requestId }) });
    expect(ok.status).toBe(200);
    const okBody = await ok.json() as { items: unknown[]; nextCursor: string | null };
    expect(Array.isArray(okBody.items)).toBe(true);
    expect(okBody.nextCursor === null || typeof okBody.nextCursor === 'string').toBe(true);
  });

  it('rejects a queue filter for another responsible in workspace-query mode the same as the classic filter form', async () => {
    const foreignFilter = await listRoute(endpoint(`/api/staff/quote-requests?view=all&assignee=${assigneeId}`, salesToken));
    expect(foreignFilter.status).toBe(403);
    const ownFilter = await listRoute(endpoint('/api/staff/quote-requests?view=mine&stage=RECIBIDA', salesToken));
    expect(ownFilter.status).toBe(200);
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
