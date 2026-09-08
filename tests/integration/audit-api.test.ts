import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { GET as auditGet } from '@/app/api/staff/audit/route';

describe('staff audit API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  let managerToken = '';
  let adminToken = '';
  let salesToken = '';
  let customerToken = '';

  const endpoint = (path: string, token?: string) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    headers: token ? { cookie: `ocpool_session=${token}` } : undefined,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [managerRole, adminRole, salesRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'admin' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const client = await prisma.client.create({ data: { displayName: `Audit API Client ${suffix}` } });
    const [manager, admin, sales, customer] = await Promise.all([
      prisma.user.create({ data: { email: `audit-api-manager-${suffix}@example.test`, emailNormalized: `audit-api-manager-${suffix}@example.test`, displayName: 'Audit API Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `audit-api-admin-${suffix}@example.test`, emailNormalized: `audit-api-admin-${suffix}@example.test`, displayName: 'Audit API Admin', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: adminRole.id } } } }),
      prisma.user.create({ data: { email: `audit-api-sales-${suffix}@example.test`, emailNormalized: `audit-api-sales-${suffix}@example.test`, displayName: 'Audit API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `audit-api-customer-${suffix}@example.test`, emailNormalized: `audit-api-customer-${suffix}@example.test`, displayName: 'Audit API Customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: client.id, roles: { create: { roleId: customerRole.id } } } }),
    ]);
    userIds.push(manager.id, admin.id, sales.id, customer.id);
    [managerToken, adminToken, salesToken, customerToken] = [
      `audit-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`,
      `audit-api-admin-${suffix}-abcdefghijklmnopqrstuvwxyz`,
      `audit-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`,
      `audit-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`,
    ];
    const sessions = await Promise.all([
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: admin.id, ipAddress: null, userAgent: 'integration-test', mfaVerified: true }, { prisma, tokenGenerator: () => adminToken }),
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken }),
    ]);
    sessionIds.push(...sessions.map(({ sessionId }) => sessionId));
  });

  it('enforces authentication, split RBAC and no-store responses', async () => {
    expect((await auditGet(endpoint('/api/staff/audit'))).status).toBe(401);
    expect((await auditGet(endpoint('/api/staff/audit', customerToken))).status).toBe(403);
    expect((await auditGet(endpoint('/api/staff/audit', salesToken))).status).toBe(403);

    const manager = await auditGet(endpoint('/api/staff/audit?from=2026-09-01&to=2026-09-08&category=commercial', managerToken));
    expect(manager.status).toBe(200);
    expect(manager.headers.get('cache-control')).toBe('no-store');
    await expect(manager.json()).resolves.toMatchObject({ meta: { scope: 'operational', timezone: readServerEnv().APP_TIMEZONE } });

    const managerSecurity = await auditGet(endpoint('/api/staff/audit?from=2026-09-01&to=2026-09-08&category=security', managerToken));
    expect(managerSecurity.status).toBe(403);

    const adminSecurity = await auditGet(endpoint('/api/staff/audit?from=2026-09-01&to=2026-09-08&category=security', adminToken));
    expect(adminSecurity.status).toBe(200);
    expect(adminSecurity.headers.get('cache-control')).toBe('no-store');
    const body = await adminSecurity.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/email|phone|ipAddress|userAgent|identifierHash|ciphertext|DATABASE_URL|SELECT|stack/i);
  });

  it('rejects unknown filters, invalid dates, cursors and exposes only public request IDs', async () => {
    const invalidPaths = [
      '/api/staff/audit?scope=global',
      '/api/staff/audit?category=unknown',
      '/api/staff/audit?limit=0',
      '/api/staff/audit?from=2026-02-30&to=2026-03-08',
      '/api/staff/audit?from=2026-01-01&to=2026-05-01',
      '/api/staff/audit?from=2026-09-01&to=2026-09-08&cursor=malformed',
    ];
    for (const path of invalidPaths) {
      const response = await auditGet(endpoint(path, managerToken));
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string; message: string; requestId: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/iu);
      expect(body.error.message).not.toMatch(/SQL|DATABASE_URL|stack|prisma|secret/i);
    }
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.authRateLimit.deleteMany({ where: { scope: 'audit-read', keyHash: { in: userIds.map((id) => fingerprintToken(id)) } } });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { displayName: { startsWith: 'Audit API Client ' } } });
  });
});
