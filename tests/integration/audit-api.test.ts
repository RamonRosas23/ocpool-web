import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { GET as auditGet } from '@/app/api/staff/audit/route';
import { GET as capabilitiesGet } from '@/app/api/staff/capabilities/route';

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

  it('publishes only safe audit capabilities to the staff UI', async () => {
    const manager = await capabilitiesGet(endpoint('/api/staff/capabilities', managerToken));
    expect(manager.status).toBe(200);
    await expect(manager.json()).resolves.toMatchObject({ auditRead: true, auditSecurityRead: false });

    const admin = await capabilitiesGet(endpoint('/api/staff/capabilities', adminToken));
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toMatchObject({ auditRead: true, auditSecurityRead: true });

    const sales = await capabilitiesGet(endpoint('/api/staff/capabilities', salesToken));
    expect(sales.status).toBe(200);
    await expect(sales.json()).resolves.toMatchObject({ auditRead: false, auditSecurityRead: false });
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

  it('round 11 audit fix: a request with no explicit range still surfaces an event created moments ago today', async () => {
    // Regression for a bug where the default (and even an explicit "hasta hoy") range's exclusive upper
    // bound resolved to the START of today, so the Audit Log could never show anything from today itself
    // -- confirmed live in the browser during this fix: a just-performed staff action was completely
    // absent from the default view. This proves the fix through the real HTTP route, not just the date
    // math in isolation.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folio = `OCQ-TODAY-${suffix}`;
    const freshRow = await prisma.auditLog.create({
      data: { actorUserId: null, action: 'quote_request.created', entityType: 'quote_request', entityId: null, outcome: 'SUCCESS', metadata: { folio, origin: 'PUBLIC_FORM' }, createdAt: new Date() },
    });
    try {
      const response = await auditGet(endpoint('/api/staff/audit', managerToken));
      expect(response.status).toBe(200);
      const body = await response.json() as { items: Array<{ details: Array<{ label: string; value: string }> }> };
      expect(body.items.some((item) => item.details.some((detail) => detail.value === folio))).toBe(true);
    } finally {
      await prisma.auditLog.delete({ where: { id: freshRow.id } });
    }
  });

  it('round 11 audit fix: links a request-level event straight to the staff page that opens it', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folio = `OCQ-LINK-${suffix}`;
    const requestId = '00000000-0000-4000-8000-0000000000aa';
    const freshRow = await prisma.auditLog.create({
      data: { actorUserId: null, action: 'quote_request.created', entityType: 'quote_request', entityId: requestId, outcome: 'SUCCESS', metadata: { folio, origin: 'PUBLIC_FORM' }, createdAt: new Date() },
    });
    try {
      const response = await auditGet(endpoint('/api/staff/audit', managerToken));
      expect(response.status).toBe(200);
      const body = await response.json() as { items: Array<{ entityLink: { href: string } | null; details: Array<{ label: string; value: string }> }> };
      const item = body.items.find((entry) => entry.details.some((detail) => detail.value === folio));
      expect(item?.entityLink).toEqual({ href: `/staff/requests?request=${requestId}` });
    } finally {
      await prisma.auditLog.delete({ where: { id: freshRow.id } });
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
