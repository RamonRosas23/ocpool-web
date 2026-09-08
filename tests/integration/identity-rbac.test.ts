import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from '@/server/auth/constants';
import { seedIdentityCatalog } from '../../prisma/seed';
import { createSession, getActorFromSession, revokeSession } from '@/server/auth/sessions';
import { consumeSingleUseToken, issueAuthToken } from '@/server/auth/tokens';
import { decryptSecret, encryptSecret, fingerprintToken, hashPassword } from '@/server/auth/crypto';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import { createMfaEnrollment, generateTotpCode } from '@/server/auth/mfa';
import { loginEmployee, requestCustomerMagicLink, consumeCustomerMagicLink, requestPasswordRecovery, consumePasswordRecovery } from '@/server/auth/service';
import { readServerEnv } from '@/server/env';
import { NextRequest } from 'next/server';
import { POST as employeeLoginRoute } from '@/app/api/auth/employee/login/route';
import { GET as sessionGetRoute, POST as sessionPostRoute } from '@/app/api/auth/session/route';

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
    const sequenceBeforeSeed = await prisma.folioSequence.findUnique({ where: { key: 'quote_request' } });
    await seedIdentityCatalog(prisma);
    await seedIdentityCatalog(prisma);

    const permissionKeys = PERMISSION_CATALOG.map(({ key }) => key);
    const roles = await prisma.role.findMany({ where: { key: { in: Object.keys(ROLE_DEFINITIONS) } } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });

    expect(roles).toHaveLength(Object.keys(ROLE_DEFINITIONS).length);
    expect(permissions).toHaveLength(PERMISSION_CATALOG.length);
    const sequenceAfterSeed = await prisma.folioSequence.findUnique({ where: { key: 'quote_request' } });
    expect(sequenceAfterSeed?.key).toBe('quote_request');
    expect(sequenceAfterSeed?.nextValue).toBeGreaterThanOrEqual(sequenceBeforeSeed?.nextValue ?? 1);

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

    const concurrentRawToken = `concurrent-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await issueAuthToken({ userId: user.id, type: 'MAGIC_LINK', requestedIp: null, userAgent: null }, { prisma, now, tokenGenerator: () => concurrentRawToken });
    const concurrentResults = await Promise.all([
      consumeSingleUseToken(concurrentRawToken, 'MAGIC_LINK', { prisma, now }),
      consumeSingleUseToken(concurrentRawToken, 'MAGIC_LINK', { prisma, now }),
    ]);
    expect(concurrentResults.filter((result) => result !== null)).toHaveLength(1);

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.client.delete({ where: { id: client.id } });
  }, 15_000);

  it('does not resolve an employee session until required MFA is verified', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    await seedIdentityCatalog(prisma);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'admin' } });
    const suffix = Date.now().toString();
    const email = `mfa-${suffix}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'MFA Test',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: adminRole.id } },
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

  it('does not share a global IP bucket when the request has no trusted address', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-01-03T00:00:00.000Z');
    const password = 'NoIpRateLimitPassword123!';
    const firstEmail = `no-ip-first-${suffix}@example.test`;
    const secondEmail = `no-ip-second-${suffix}@example.test`;
    const [firstUser, secondUser] = await Promise.all([
      prisma.user.create({ data: { email: firstEmail, emailNormalized: firstEmail, displayName: 'No IP First', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password) } }),
      prisma.user.create({ data: { email: secondEmail, emailNormalized: secondEmail, displayName: 'No IP Second', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password) } }),
    ]);

    const context = { ipAddress: null, userAgent: 'integration-no-ip-test' };
    for (let attempt = 0; attempt < readServerEnv().AUTH_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      expect((await loginEmployee({ email: firstEmail, password: 'WrongPassword123!', context }, { prisma, now: new Date(now.getTime() + attempt * 1_000) })).ok).toBe(false);
    }
    expect((await loginEmployee({ email: secondEmail, password, context }, { prisma, now: new Date(now.getTime() + 10_000), sessionTokenGenerator: () => `no-ip-session-${suffix}-abcdefghijklmnopqrstuvwxyz` })).ok).toBe(true);

    await prisma.authRateLimit.deleteMany({ where: { scope: { in: ['employee-login-email', 'employee-login-ip'] }, keyHash: { in: [fingerprintToken(firstEmail), fingerprintToken(secondEmail), fingerprintToken('unknown-client')] } } });
    await prisma.user.deleteMany({ where: { id: { in: [firstUser.id, secondUser.id] } } });
  }, 30_000);

  it('runs employee login, admin MFA, customer magic link and transactional recovery', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    await seedIdentityCatalog(prisma);
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'admin' } });
    const suffix = Date.now().toString();
    const now = new Date('2026-01-02T00:00:00.000Z');
    const hostOctet = Number(suffix.slice(-3)) % 200 + 1;
    const context = { ipAddress: `10.0.0.${hostOctet}`, userAgent: 'integration-auth-test' };
    const password = 'EmployeePassword123!';
    const passwordHash = await hashPassword(password);

    const employeeEmail = `employee-${suffix}@example.test`;
    const adminEmail = `admin-${suffix}@example.test`;
    const authIpAddresses = [
      context.ipAddress,
      `10.0.1.${hostOctet}`,
      `10.0.1.${(hostOctet % 200) + 1}`,
      `10.0.1.${(hostOctet % 198) + 3}`,
      `10.0.2.${hostOctet}`,
      `10.0.2.${(hostOctet % 200) + 1}`,
      `10.0.3.${hostOctet}`,
      `10.0.3.${(hostOctet % 200) + 1}`,
    ];
    await prisma.authRateLimit.deleteMany({
      where: {
        scope: { in: ['employee-login-email', 'employee-login-ip'] },
        keyHash: { in: [fingerprintToken(employeeEmail), fingerprintToken(adminEmail), ...authIpAddresses.map((ip) => fingerprintToken(ip))] },
      },
    });
    const employee = await prisma.user.create({
      data: {
        email: employeeEmail,
        emailNormalized: employeeEmail,
        displayName: 'Employee Auth Test',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        passwordHash,
        roles: { create: { roleId: salesRole.id } },
      },
    });
    const login = await loginEmployee({ email: employeeEmail, password, context }, { prisma, now, sessionTokenGenerator: () => `employee-session-${suffix}-abcdefghijklmnopqrstuvwxyz` });
    expect(login.ok).toBe(true);
    if (login.ok) {
      expect(await getActorFromSession(login.rawToken, { prisma, now })).toMatchObject({ userId: employee.id, type: 'EMPLOYEE' });
    }
    expect((await loginEmployee({ email: employeeEmail, password: 'wrong-password', context }, { prisma, now: new Date(now.getTime() + 1), sessionTokenGenerator: () => `wrong-session-${suffix}-abcdefghijklmnopqrstuvwxyz` })).ok).toBe(false);

    const enrollment = createMfaEnrollment({ accountLabel: adminEmail });
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        emailNormalized: adminEmail,
        displayName: 'Admin Auth Test',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        passwordHash,
        mfaRequired: true,
        mfaSecretCiphertext: encryptSecret(enrollment.secret, readServerEnv().MFA_ENCRYPTION_KEY),
        roles: { create: { roleId: adminRole.id } },
      },
    });
    expect((await loginEmployee({ email: adminEmail, password, context: { ...context, ipAddress: `10.0.1.${hostOctet}` } }, { prisma, now, sessionTokenGenerator: () => `admin-no-mfa-${suffix}-abcdefghijklmnopqrstuvwxyz` })).ok).toBe(false);
    const adminContext = { ...context, ipAddress: `10.0.1.${(hostOctet % 200) + 1}` };
    const adminCode = generateTotpCode(enrollment.secret, now.getTime());
    const adminLogin = await loginEmployee({ email: adminEmail, password, mfaCode: adminCode, context: adminContext }, { prisma, now, sessionTokenGenerator: () => `admin-session-${suffix}-abcdefghijklmnopqrstuvwxyz` });
    expect(adminLogin.ok).toBe(true);
    expect((await loginEmployee({ email: adminEmail, password, mfaCode: adminCode, context: { ...adminContext, ipAddress: `10.0.1.${(hostOctet % 198) + 3}` } }, { prisma, now, sessionTokenGenerator: () => `admin-replay-${suffix}-abcdefghijklmnopqrstuvwxyz` })).ok).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: admin.id } }))?.mfaLastAcceptedCounter).not.toBeNull();

    const client = await prisma.client.create({ data: { displayName: `Customer Auth ${suffix}` } });
    const customerEmail = `customer-${suffix}@example.test`;
    const customer = await prisma.user.create({
      data: { email: customerEmail, emailNormalized: customerEmail, displayName: 'Customer Auth Test', type: 'CUSTOMER', status: 'ACTIVE', clientId: client.id },
    });
    await requestCustomerMagicLink({ email: customerEmail, context: { ...context, ipAddress: `10.0.2.${hostOctet}` } }, { prisma, now, tokenGenerator: () => `customer-link-${suffix}-abcdefghijklmnopqrstuvwxyz` });
    const customerOutbox = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: customer.id, eventType: 'AUTH.CUSTOMER_MAGIC_LINK' }, orderBy: { createdAt: 'desc' } });
    const customerPayload = customerOutbox.payload as { tokenCiphertext: string };
    const customerToken = decryptSecret(customerPayload.tokenCiphertext, readServerEnv().AUTH_DELIVERY_ENCRYPTION_KEY);
    expect(JSON.stringify(customerOutbox.payload)).not.toContain(customerToken);
    const customerLogin = await consumeCustomerMagicLink(customerToken, { ...context, ipAddress: `10.0.2.${(hostOctet % 200) + 1}` }, { prisma, now, sessionTokenGenerator: () => `customer-session-${suffix}-abcdefghijklmnopqrstuvwxyz` });
    expect(customerLogin.ok).toBe(true);
    expect((await consumeCustomerMagicLink(customerToken, context, { prisma, now, sessionTokenGenerator: () => `customer-replay-${suffix}-abcdefghijklmnopqrstuvwxyz` })).ok).toBe(false);

    await requestPasswordRecovery({ email: employeeEmail, context: { ...context, ipAddress: `10.0.3.${hostOctet}` } }, { prisma, now, tokenGenerator: () => `recovery-${suffix}-abcdefghijklmnopqrstuvwxyz` });
    const recoveryOutbox = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: employee.id, eventType: 'AUTH.EMPLOYEE_PASSWORD_RESET' }, orderBy: { createdAt: 'desc' } });
    const recoveryPayload = recoveryOutbox.payload as { tokenCiphertext: string };
    const recoveryToken = decryptSecret(recoveryPayload.tokenCiphertext, readServerEnv().AUTH_DELIVERY_ENCRYPTION_KEY);
    expect(JSON.stringify(recoveryOutbox.payload)).not.toContain(recoveryToken);
    await requestPasswordRecovery({ email: employeeEmail, context: { ...context, ipAddress: `10.0.3.${(hostOctet % 200) + 1}` } }, { prisma, now, tokenGenerator: () => `recovery-two-${suffix}-abcdefghijklmnopqrstuvwxyz` });
    const secondRecoveryOutbox = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: employee.id, eventType: 'AUTH.EMPLOYEE_PASSWORD_RESET', id: { not: recoveryOutbox.id } }, orderBy: { createdAt: 'desc' } });
    const secondRecoveryPayload = secondRecoveryOutbox.payload as { tokenCiphertext: string };
    const secondRecoveryToken = decryptSecret(secondRecoveryPayload.tokenCiphertext, readServerEnv().AUTH_DELIVERY_ENCRYPTION_KEY);
    expect(await consumePasswordRecovery({ rawToken: recoveryToken, newPassword: 'NewEmployeePassword123!', context }, { prisma, now })).toBe(true);
    expect(await consumePasswordRecovery({ rawToken: secondRecoveryToken, newPassword: 'AnotherPassword123!', context }, { prisma, now })).toBe(false);
    if (login.ok) expect(await getActorFromSession(login.rawToken, { prisma, now })).toBeNull();
    const authEvents = await prisma.authEvent.findMany({ where: { userId: { in: [employee.id, admin.id, customer.id] } } });
    const serializedEvents = JSON.stringify(authEvents);
    expect(serializedEvents).not.toContain(password);
    expect(serializedEvents).not.toContain(adminCode);
    expect(serializedEvents).not.toContain(customerToken);
    expect(serializedEvents).not.toContain(recoveryToken);
    expect(serializedEvents).not.toContain(secondRecoveryToken);

    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [employee.id, customer.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [employee.id, admin.id, customer.id] } } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.authRateLimit.deleteMany({
      where: {
        scope: { in: ['auth-global', 'employee-login-email', 'employee-login-ip'] },
        keyHash: { in: [fingerprintToken(employeeEmail), fingerprintToken(adminEmail), fingerprintToken(customerEmail), ...authIpAddresses.map((ip) => fingerprintToken(ip))] },
      },
    });
  }, 30_000);

  it('keeps authentication API errors generic and rejects foreign-origin logout', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `route-${suffix}@example.test`;
    const password = 'RoutePassword123!';
    const routeIp = `10.10.0.${Number(suffix.slice(-3)) % 200 + 1}`;
    const previousTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';
    await prisma.authRateLimit.deleteMany({
      where: {
        scope: { in: ['auth-global', 'employee-login-email', 'employee-login-ip'] },
        keyHash: { in: [fingerprintToken('service'), fingerprintToken(email), fingerprintToken(`unknown-${suffix}@example.test`), fingerprintToken(routeIp)] },
      },
    });
    const user = await prisma.user.create({
      data: { email, emailNormalized: email, displayName: 'Route Test', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password) },
    });
    const request = (body: Record<string, unknown>) => new NextRequest('http://localhost:3000/api/auth/employee/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-real-ip': routeIp },
      body: JSON.stringify(body),
    });

    const unknownResponse = await employeeLoginRoute(request({ email: `unknown-${suffix}@example.test`, password }));
    const wrongResponse = await employeeLoginRoute(request({ email, password: 'WrongRoutePassword123!' }));
    expect(unknownResponse.status).toBe(401);
    expect(wrongResponse.status).toBe(401);
    expect((await unknownResponse.json()).error.message).toBe((await wrongResponse.json()).error.message);
    const foreignLogin = await employeeLoginRoute(new NextRequest('http://localhost:3000/api/auth/employee/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example', 'x-real-ip': routeIp },
      body: JSON.stringify({ email, password }),
    }));
    expect(foreignLogin.status).toBe(403);

    const loginResponse = await employeeLoginRoute(request({ email, password }));
    expect(loginResponse.status).toBe(200);
    expect(await prisma.authRateLimit.findUnique({ where: { scope_keyHash: { scope: 'auth-global', keyHash: fingerprintToken('service') } } })).toBeNull();
    const sessionCookie = loginResponse.cookies.get('ocpool_session')?.value;
    expect(sessionCookie).toBeTruthy();
    expect(loginResponse.headers.get('set-cookie')).toContain('HttpOnly');

    const foreignLogout = await sessionPostRoute(new NextRequest('http://localhost:3000/api/auth/session', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', cookie: `ocpool_session=${sessionCookie}` },
    }));
    expect(foreignLogout.status).toBe(403);
    expect((await sessionGetRoute(new NextRequest('http://localhost:3000/api/auth/session', { headers: { cookie: `ocpool_session=${sessionCookie}` } }))).status).toBe(200);

    const logout = await sessionPostRoute(new NextRequest('http://localhost:3000/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', cookie: `ocpool_session=${sessionCookie}` },
    }));
    expect(logout.status).toBe(200);
    expect((await sessionGetRoute(new NextRequest('http://localhost:3000/api/auth/session', { headers: { cookie: `ocpool_session=${sessionCookie}` } }))).status).toBe(401);

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.authRateLimit.deleteMany({
      where: {
        scope: { in: ['auth-global', 'employee-login-email', 'employee-login-ip'] },
        keyHash: { in: [fingerprintToken('service'), fingerprintToken(email), fingerprintToken(`unknown-${suffix}@example.test`), fingerprintToken(routeIp)] },
      },
    });
    if (previousTrustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = previousTrustProxyHeaders;
  }, 30_000);

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS === '1') await getPrisma().$disconnect();
  });
});
