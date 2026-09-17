import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { encryptSecret, hashPassword } from '@/server/auth/crypto';
import { createMfaEnrollment, generateTotpCode } from '@/server/auth/mfa';
import { readServerEnv } from '@/server/env';

test.describe('identity API opt-in flow', () => {
  test.skip(process.env.AUTH_E2E !== '1', 'Identity E2E requires AUTH_E2E=1 and a disposable local database.');

  let prisma: ReturnType<typeof getPrisma>;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${suffix}@example.test`;
  const password = 'E2EEmployeePassword123!';
  let userId: string;

  test.beforeAll(async () => {
    prisma = getPrisma();
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'Disposable E2E Employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        passwordHash: await hashPassword(password),
      },
    });
    userId = user.id;
  });

  test.afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('logs in, resolves session, rejects foreign logout and logs out', async ({ request }) => {
    const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
    const login = await request.post('/api/auth/employee/login', {
      headers: { origin },
      data: { email, password },
    });
    expect(login.status()).toBe(200);
    expect(login.headers()['set-cookie']).toContain('ocpool_session=');
    expect(login.headers()['set-cookie']).toContain('HttpOnly');
    expect(login.headers()['set-cookie']).toMatch(/SameSite=Lax/i);
    const rawCookie = login.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
    expect(rawCookie).toBeTruthy();
    const cookieHeader = `ocpool_session=${rawCookie}`;

    const session = await request.get('/api/auth/session', { headers: { cookie: cookieHeader } });
    expect(session.status()).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ userId, type: 'EMPLOYEE' });

    const foreignLogout = await request.post('/api/auth/session', { headers: { origin: 'https://attacker.example', cookie: cookieHeader } });
    expect(foreignLogout.status()).toBe(403);
    expect((await request.get('/api/auth/session', { headers: { cookie: cookieHeader } })).status()).toBe(200);

    const logout = await request.post('/api/auth/session', { headers: { origin, cookie: cookieHeader } });
    expect(logout.status()).toBe(200);
    expect((await request.get('/api/auth/session', { headers: { cookie: cookieHeader } })).status()).toBe(401);
  });

  test('signals MFA_REQUIRED only after the password is correct, then completes the two-step login (U1)', async ({ request }) => {
    const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
    const mfaEmail = `e2e-mfa-${suffix}@example.test`;
    const enrollment = createMfaEnrollment({ accountLabel: mfaEmail });
    const mfaUser = await prisma.user.create({
      data: {
        email: mfaEmail,
        emailNormalized: mfaEmail,
        displayName: 'Disposable E2E MFA Employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        passwordHash: await hashPassword(password),
        mfaRequired: true,
        mfaSecretCiphertext: encryptSecret(enrollment.secret, readServerEnv().MFA_ENCRYPTION_KEY),
      },
    });

    try {
      const wrongPassword = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email: mfaEmail, password: 'wrong-password' } });
      expect(wrongPassword.status()).toBe(401);
      await expect(wrongPassword.json()).resolves.toMatchObject({ error: { code: 'UNAUTHORIZED' } });

      const stepOne = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email: mfaEmail, password } });
      expect(stepOne.status()).toBe(401);
      await expect(stepOne.json()).resolves.toMatchObject({ error: { code: 'MFA_REQUIRED' } });

      const stepTwo = await request.post('/api/auth/employee/login', {
        headers: { origin },
        data: { email: mfaEmail, password, mfaCode: generateTotpCode(enrollment.secret, Date.now()) },
      });
      expect(stepTwo.status()).toBe(200);
      expect(stepTwo.headers()['set-cookie']).toContain('ocpool_session=');
    } finally {
      await prisma.user.delete({ where: { id: mfaUser.id } });
    }
  });
});
