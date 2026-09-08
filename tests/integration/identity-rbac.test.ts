import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from '@/server/auth/constants';
import { seedIdentityCatalog } from '../../prisma/seed';
import { createSession, getActorFromSession, revokeSession } from '@/server/auth/sessions';
import { consumeSingleUseToken, issueAuthToken } from '@/server/auth/tokens';
import { fingerprintToken } from '@/server/auth/crypto';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';

describe('identity and RBAC foundation', () => {
  it('persists the identity relationships and unique security records', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `identity-${suffix}@example.test`;

    const client = await prisma.client.create({
      data: { displayName: `Identity test ${suffix}` },
    });
    const role = await prisma.role.create({
      data: {
        key: `identity-test-${suffix}`,
        name: 'Identity test role',
        description: 'Disposable role for the identity integration contract',
        systemManaged: false,
      },
    });
    const permission = await prisma.permission.create({
      data: {
        key: `identity.test.${suffix}`,
        description: 'Disposable permission for the identity integration contract',
      },
    });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'Identity Test',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        clientId: client.id,
        roles: { create: { roleId: role.id } },
      },
    });

    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(user.clientId).toBe(client.id);
    expect((await prisma.userRole.findUnique({ where: { userId_roleId: { userId: user.id, roleId: role.id } } }))?.roleId).toBe(role.id);
    expect((await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } }))?.permissionId).toBe(permission.id);
    await expect(prisma.user.create({
      data: { email, emailNormalized: email, displayName: 'Duplicate', type: 'CUSTOMER', clientId: client.id },
    })).rejects.toThrow();

    await prisma.session.delete({ where: { id: session.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    await prisma.permission.delete({ where: { id: permission.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.client.delete({ where: { id: client.id } });
  }, 15_000);

  it('seeds the catalog idempotently without duplicating system records', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    await seedIdentityCatalog(prisma);
    await seedIdentityCatalog(prisma);

    const permissionKeys = PERMISSION_CATALOG.map(({ key }) => key);
    const roles = await prisma.role.findMany({ where: { key: { in: Object.keys(ROLE_DEFINITIONS) } } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });

    expect(roles).toHaveLength(Object.keys(ROLE_DEFINITIONS).length);
    expect(permissions).toHaveLength(PERMISSION_CATALOG.length);

    for (const [roleKey, definition] of Object.entries(ROLE_DEFINITIONS)) {
      const role = roles.find((candidate) => candidate.key === roleKey);
      expect(role).toBeDefined();
      const assignments = await prisma.rolePermission.count({ where: { roleId: role?.id } });
      expect(assignments).toBe(definition.permissions.length);
    }
  }, 15_000);

  it('resolves active actors, rejects expired or revoked sessions and consumes tokens once', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `session-${suffix}@example.test`;
    const client = await prisma.client.create({ data: { displayName: `Session test ${suffix}` } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'Session Test',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        clientId: client.id,
      },
    });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const rawSessionToken = `session-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const session = await createSession({ userId: user.id, ipAddress: '127.0.0.1', userAgent: 'integration-test' }, {
      prisma,
      now,
      tokenGenerator: () => rawSessionToken,
    });

    const storedSession = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(storedSession?.tokenHash).toBe(fingerprintToken(rawSessionToken));
    expect(storedSession?.tokenHash).not.toContain(rawSessionToken);
    expect(await getActorFromSession(rawSessionToken, { prisma, now })).toMatchObject({
      userId: user.id,
      type: 'CUSTOMER',
      clientId: client.id,
    });

    await prisma.session.update({ where: { id: session.sessionId }, data: { expiresAt: new Date(now.getTime() - 1) } });
    expect(await getActorFromSession(rawSessionToken, { prisma, now })).toBeNull();
    await prisma.session.update({ where: { id: session.sessionId }, data: { expiresAt: session.expiresAt } });
    await revokeSession(session.sessionId, 'integration-test', { prisma, now });
    expect(await getActorFromSession(rawSessionToken, { prisma, now })).toBeNull();

    const rawAuthToken = `magic-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const issued = await issueAuthToken({ userId: user.id, type: 'MAGIC_LINK', requestedIp: '127.0.0.1', userAgent: 'integration-test' }, {
      prisma,
      now,
      tokenGenerator: () => rawAuthToken,
    });
    const storedAuthToken = await prisma.authToken.findUnique({ where: { tokenHash: fingerprintToken(rawAuthToken) } });
    expect(storedAuthToken?.tokenHash).not.toContain(rawAuthToken);
    expect(await consumeSingleUseToken(rawAuthToken, 'MAGIC_LINK', { prisma, now })).toEqual({ userId: user.id });
    expect(await consumeSingleUseToken(rawAuthToken, 'MAGIC_LINK', { prisma, now })).toBeNull();
    expect(issued.expiresAt.getTime()).toBeGreaterThan(now.getTime());

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.client.delete({ where: { id: client.id } });
  }, 15_000);

  it('does not resolve an employee session until required MFA is verified', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `mfa-${suffix}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'MFA Test',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        mfaRequired: true,
      },
    });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const rawToken = `mfa-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const session = await createSession({ userId: user.id, ipAddress: null, userAgent: null }, {
      prisma,
      now,
      tokenGenerator: () => rawToken,
    });

    expect(await getActorFromSession(rawToken, { prisma, now })).toBeNull();
    await prisma.session.update({ where: { id: session.sessionId }, data: { mfaVerified: true } });
    expect(await getActorFromSession(rawToken, { prisma, now })).toMatchObject({ userId: user.id, type: 'EMPLOYEE', mfaVerified: true });

    await prisma.user.delete({ where: { id: user.id } });
  }, 15_000);

  it('persists authentication rate-limit buckets in PostgreSQL', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const options = { scope: `integration-${suffix}`, key: `rate-${suffix}@example.test`, maxAttempts: 2, windowMinutes: 15, now };

    await expect(checkAuthRateLimit(options)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(checkAuthRateLimit({ ...options, now: new Date(now.getTime() + 1_000) })).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(checkAuthRateLimit({ ...options, now: new Date(now.getTime() + 2_000) })).resolves.toMatchObject({ allowed: false });

    const keyHash = fingerprintToken(options.key);
    expect(await prisma.authRateLimit.count({ where: { scope: options.scope, keyHash } })).toBe(1);
    await prisma.authRateLimit.delete({ where: { scope_keyHash: { scope: options.scope, keyHash } } });
  }, 15_000);

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS === '1') await getPrisma().$disconnect();
  });
});
