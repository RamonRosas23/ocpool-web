import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { GET as dashboardGet } from '@/app/api/staff/dashboard/route';

describe('staff analytics dashboard API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  let salesToken = '';
  let managerToken = '';
  let customerToken = '';
  let employeeWithoutMetricsToken = '';

  const endpoint = (path: string, token?: string) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    headers: token ? { cookie: `ocpool_session=${token}` } : undefined,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, managerRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [sales, manager, customer, employeeWithoutMetrics] = await Promise.all([
      prisma.user.create({ data: { email: `analytics-api-sales-${suffix}@example.test`, emailNormalized: `analytics-api-sales-${suffix}@example.test`, displayName: 'Analytics API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `analytics-api-manager-${suffix}@example.test`, emailNormalized: `analytics-api-manager-${suffix}@example.test`, displayName: 'Analytics API Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `analytics-api-customer-${suffix}@example.test`, emailNormalized: `analytics-api-customer-${suffix}@example.test`, displayName: 'Analytics API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `analytics-api-no-metrics-${suffix}@example.test`, emailNormalized: `analytics-api-no-metrics-${suffix}@example.test`, displayName: 'Analytics API No Metrics', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    userIds.push(sales.id, manager.id, customer.id, employeeWithoutMetrics.id);
    salesToken = `analytics-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `analytics-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `analytics-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    employeeWithoutMetricsToken = `analytics-api-no-metrics-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const sessions = await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken }),
      createSession({ userId: employeeWithoutMetrics.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => employeeWithoutMetricsToken }),
    ]);
    sessionIds.push(...sessions.map(({ sessionId }) => sessionId));
  });

  it('enforces authentication, RBAC, scope and no-store responses', async () => {
    expect((await dashboardGet(endpoint('/api/staff/dashboard'))).status).toBe(401);
    expect((await dashboardGet(endpoint('/api/staff/dashboard', customerToken))).status).toBe(403);
    expect((await dashboardGet(endpoint('/api/staff/dashboard', employeeWithoutMetricsToken))).status).toBe(403);

    const sales = await dashboardGet(endpoint('/api/staff/dashboard?from=2026-09-01&to=2026-09-08', salesToken));
    expect(sales.status).toBe(200);
    expect(sales.headers.get('cache-control')).toBe('no-store');
    const salesBody = await sales.json() as Record<string, unknown>;
    expect(salesBody).toMatchObject({ meta: { scope: 'self', timezone: readServerEnv().APP_TIMEZONE } });

    const manager = await dashboardGet(endpoint('/api/staff/dashboard?from=2026-09-01&to=2026-09-08', managerToken));
    expect(manager.status).toBe(200);
    expect(manager.headers.get('cache-control')).toBe('no-store');
    await expect(manager.json()).resolves.toMatchObject({ meta: { scope: 'global' } });

    expect(JSON.stringify(salesBody)).not.toMatch(/clientId|email|phone|payload|ciphertext|secret|DATABASE_URL|SELECT|stack/i);
  });

  it('rejects arbitrary filters, invalid ranges and oversized periods with a safe request id', async () => {
    const invalidRequests = [
      '/api/staff/dashboard?scope=global',
      '/api/staff/dashboard?clientId=00000000-0000-0000-0000-000000000000',
      '/api/staff/dashboard?from=2026-09-08&to=2026-09-01',
      '/api/staff/dashboard?from=2026-02-30&to=2026-03-08',
      '/api/staff/dashboard?from=2026-01-01&to=2026-05-01',
    ];
    for (const path of invalidRequests) {
      const response = await dashboardGet(endpoint(path, salesToken));
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string; message: string; requestId: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.error.message).not.toMatch(/SQL|DATABASE_URL|stack|prisma/i);
    }
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
});
