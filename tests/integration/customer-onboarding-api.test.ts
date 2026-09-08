import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { POST } from '@/app/api/staff/quote-requests/[id]/customer-access/route';

describe('customer onboarding API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  let managerToken = '';
  let salesToken = '';
  let requestId = '';

  const endpoint = (token: string, body: unknown = {}, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}/api/staff/quote-requests/${requestId}/customer-access`, {
    method: 'POST',
    headers: { cookie: `ocpool_session=${token}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [managerRole, salesRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const manager = await prisma.user.create({ data: { email: `onboarding-api-manager-${suffix}@example.test`, emailNormalized: `onboarding-api-manager-${suffix}@example.test`, displayName: 'Onboarding API manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } });
    const sales = await prisma.user.create({ data: { email: `onboarding-api-sales-${suffix}@example.test`, emailNormalized: `onboarding-api-sales-${suffix}@example.test`, displayName: 'Onboarding API sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } });
    userIds.push(manager.id, sales.id);
    managerToken = `onboarding-api-manager-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    salesToken = `onboarding-api-sales-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken });
    await createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken });

    const request = await createQuoteRequest({
      idempotencyKey: `onboarding-api-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: 'Onboarding API contact', email: `onboarding-api-contact-${suffix}@example.test`, phone: '+52 667 000 7788' },
      detail: { projectType: 'Hotel', location: 'Los Cabos', description: 'Onboarding API contract', consentAt: new Date('2026-09-08T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-09-08T12:00:00.000Z') });
    requestId = request.quoteRequestId;
    requestIds.push(request.quoteRequestId);
    clientIds.push(request.clientId);
    contactIds.push(request.contactId);
  });

  it('protects onboarding with same-origin, session and permission checks', async () => {
    expect((await POST(endpoint(managerToken, {}, 'https://attacker.example'), { params: Promise.resolve({ id: requestId }) })).status).toBe(403);
    expect((await POST(endpoint(salesToken), { params: Promise.resolve({ id: requestId }) })).status).toBe(403);
    expect((await POST(new NextRequest(`${readServerEnv().APP_URL}/api/staff/quote-requests/${requestId}/customer-access`, { method: 'POST', headers: { origin: readServerEnv().APP_URL, 'content-type': 'application/json' }, body: '{}' }), { params: Promise.resolve({ id: requestId }) })).status).toBe(401);
  });

  it('returns a safe result and rejects unknown body fields', async () => {
    const invalid = await POST(endpoint(managerToken, { email: 'override@example.test' }), { params: Promise.resolve({ id: requestId }) });
    expect(invalid.status).toBe(400);

    const response = await POST(endpoint(managerToken), { params: Promise.resolve({ id: requestId }) });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ accepted: true, quoteRequestId: requestId, status: 'INVITED' });
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('tokenHash');
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: userIds } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.user.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.$disconnect();
  });
});
