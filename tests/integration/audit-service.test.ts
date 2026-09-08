import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import type { Actor } from '@/server/auth/types';
import { getStaffAudit } from '@/server/modules/audit/service';

describe('staff audit read service', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const auditIds: string[] = [];
  const authEventIds: string[] = [];
  const rateLimitActorIds: string[] = [];
  const cursorSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const now = new Date('2026-09-08T18:00:00.000Z');
  let manager: { id: string };
  let admin: { id: string };
  let sales: { id: string };
  let customer: { id: string };

  const actor = (userId: string, permissions: string[], type: Actor['type'] = 'EMPLOYEE'): Actor => ({
    userId,
    type,
    clientId: type === 'CUSTOMER' ? 'customer-scope' : null,
    permissionKeys: new Set(permissions),
    mfaVerified: true,
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
    const client = await prisma.client.create({ data: { displayName: `Audit Client ${suffix}` } });
    [manager, admin, sales, customer] = await Promise.all([
      prisma.user.create({ data: { email: `audit-manager-${suffix}@example.test`, emailNormalized: `audit-manager-${suffix}@example.test`, displayName: 'Audit Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `audit-admin-${suffix}@example.test`, emailNormalized: `audit-admin-${suffix}@example.test`, displayName: 'Audit Admin', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: adminRole.id } } } }),
      prisma.user.create({ data: { email: `audit-sales-${suffix}@example.test`, emailNormalized: `audit-sales-${suffix}@example.test`, displayName: 'Audit Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `audit-customer-${suffix}@example.test`, emailNormalized: `audit-customer-${suffix}@example.test`, displayName: 'Audit Customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: client.id, roles: { create: { roleId: customerRole.id } } } }),
    ]);
    userIds.push(manager.id, admin.id, sales.id, customer.id);

    const operational = await prisma.auditLog.createManyAndReturn({
      data: [
        { actorUserId: manager.id, action: 'quote_request.created', entityType: 'quote_request', entityId: '00000000-0000-4000-8000-000000000001', outcome: 'SUCCESS', metadata: { folio: 'OC-9001', origin: 'PUBLIC_FORM', email: `private-${suffix}@example.test` }, createdAt: new Date('2026-09-07T12:00:00.000Z') },
        { actorUserId: admin.id, action: 'quote.version.status_changed', entityType: 'quote_version', entityId: '00000000-0000-4000-8000-000000000002', outcome: 'SUCCESS', metadata: { folio: 'OC-9001', fromStatus: 'EN_REVISION', toStatus: 'ENVIADA', sha256: 'a'.repeat(64) }, createdAt: new Date('2026-09-07T12:00:00.000Z') },
        { actorUserId: null, action: 'file.rejected', entityType: 'file_attachment', entityId: '00000000-0000-4000-8000-000000000003', outcome: 'FAILURE', metadata: { folio: 'OC-9001', category: 'PLANO', reason: 'signature_mismatch', storageKey: 'private/object.key' }, createdAt: new Date('2026-09-06T12:00:00.000Z') },
        { actorUserId: sales.id, action: 'notification.retry', entityType: 'notification_delivery', entityId: '00000000-0000-4000-8000-000000000004', outcome: 'SUCCESS', metadata: { previousStatus: 'FAILED', previousErrorCode: 'TEMPORARY_PROVIDER', templateKey: 'quote.sent', eventType: 'QUOTE.SENT' }, createdAt: new Date('2026-09-05T12:00:00.000Z') },
        { actorUserId: manager.id, action: 'audit.unknown_future_action', entityType: 'unknown', entityId: '00000000-0000-4000-8000-000000000005', outcome: 'SUCCESS', metadata: { email: `unknown-${suffix}@example.test` }, createdAt: new Date('2026-09-04T12:00:00.000Z') },
      ],
    });
    auditIds.push(...operational.map((row) => row.id));

    const security = await prisma.authEvent.createManyAndReturn({
      data: [
        { userId: admin.id, eventType: 'LOGIN_SUCCESS', outcome: 'SUCCESS', identifierHash: 'b'.repeat(64), ipAddress: '192.0.2.10', userAgent: 'private-browser', metadata: { email: `security-${suffix}@example.test`, tokenId: 'private-token' }, createdAt: new Date('2026-09-07T10:00:00.000Z') },
        { userId: customer.id, eventType: 'LOGIN_FAILURE', outcome: 'DENIED', identifierHash: 'c'.repeat(64), ipAddress: '192.0.2.11', userAgent: 'private-browser-2', metadata: { password: 'private-password' }, createdAt: new Date('2026-09-06T10:00:00.000Z') },
      ],
    });
    authEventIds.push(...security.map((row) => row.id));
    rateLimitActorIds.push(manager.id, admin.id, sales.id, customer.id);
  });

  const dependencies = { prisma, now, timezone: 'UTC', cursorSecret };

  it('returns a paginated redacted operational page with stable cursor semantics', async () => {
    const first = await getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-09-08', category: 'commercial', limit: 1 }, dependencies);
    expect(first.items).toHaveLength(1);
    expect(first.meta).toMatchObject({ scope: 'operational', timezone: 'UTC', freshness: 'fresh' });
    expect(first.items[0]).toMatchObject({ category: 'commercial', action: 'Solicitud creada', actorLabel: 'Audit Manager', entityLabel: 'Solicitud comercial' });
    expect(first.items[0].actorKey).toMatch(/^[a-f0-9]{16}$/u);
    expect(first.nextCursor).toBeTruthy();

    const second = await getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-09-08', category: 'commercial', limit: 1, cursor: first.nextCursor! }, dependencies);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].eventKey).not.toBe(first.items[0].eventKey);
    expect(JSON.stringify({ first, second })).not.toMatch(/@example|192\.0\.2|private-browser|storage\.key|[a-f0-9]{64}/iu);
  });

  it('maps system actors and applies outcome/category filters in the backend', async () => {
    const result = await getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-09-08', category: 'documents', outcome: 'FAILURE', limit: 10 }, dependencies);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ action: 'Archivo rechazado', actorLabel: 'Sistema', actorKey: null, outcome: 'FAILURE' });
    expect(result.items[0].details).toEqual([
      { label: 'Folio', value: 'OC-9001' },
      { label: 'Categoría', value: 'PLANO' },
      { label: 'Motivo', value: 'signature_mismatch' },
    ]);
  });

  it('keeps security events admin-only and redacts network and identity signals', async () => {
    await expect(getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-09-08', category: 'security' }, dependencies)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const result = await getStaffAudit(actor(admin.id, ['audit.read', 'audit.security.read']), { from: '2026-09-01', to: '2026-09-08', category: 'security' }, dependencies);
    const json = JSON.stringify(result);
    expect(result.meta.scope).toBe('security');
    expect(result.items.map((item) => item.action)).toEqual(['Inicio de sesión exitoso', 'Intento de inicio de sesión fallido']);
    expect(json).not.toMatch(/192\.0\.2|private-browser|identifierHash|private-token|@example|password/i);
    expect(result.items.every((item) => item.entityLabel === 'Identidad' && item.details.length === 0)).toBe(true);
  });

  it('denies actors outside staff audit capabilities and applies rate limit before reads', async () => {
    await expect(getStaffAudit(actor(sales.id, []), { from: '2026-09-01', to: '2026-09-08' }, dependencies)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(getStaffAudit(actor(customer.id, ['audit.read'], 'CUSTOMER'), { from: '2026-09-01', to: '2026-09-08' }, dependencies)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-09-08' }, {
      ...dependencies,
      rateLimit: async () => ({ allowed: false, retryAfterSeconds: 60 }),
    })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('rejects a cursor reused with a different filter instead of broadening the query', async () => {
    const first = await getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-09-08', category: 'commercial', limit: 1 }, dependencies);
    await expect(getStaffAudit(actor(manager.id, ['audit.read']), { from: '2026-09-01', to: '2026-08-08', category: 'commercial', limit: 1, cursor: first.nextCursor! }, dependencies)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.authRateLimit.deleteMany({ where: { scope: 'audit-read', keyHash: { in: rateLimitActorIds.map((id) => fingerprintToken(id)) } } });
    await prisma.authEvent.deleteMany({ where: { id: { in: authEventIds } } });
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { displayName: { startsWith: 'Audit Client ' } } });
  });
});
