import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { createMfaEnrollment, generateTotpCode } from '@/server/auth/mfa';
import { encryptSecret, fingerprintToken, hashPassword } from '@/server/auth/crypto';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe.configure({ mode: 'serial' });

test.describe('auth browser surfaces', () => {
  test.skip(process.env.AUTH_SURFACES_E2E !== '1', 'Auth surfaces E2E requires AUTH_SURFACES_E2E=1 and disposable local data.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const employeeEmail = `auth-surface-employee-${suffix}@example.test`;
  const adminEmail = `auth-surface-admin-${suffix}@example.test`;
  const customerEmail = `auth-surface-customer-${suffix}@example.test`;
  const employeePassword = 'AuthSurfaceEmployee123!';
  const adminPassword = 'AuthSurfaceAdmin123!';
  const customerToken = `auth-surface-customer-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
  const recoveryToken = `auth-surface-recovery-token-${suffix}-abcdefghijklmnopqrstuvwxyz`;
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const tokenIds: string[] = [];
  const employeeMfa = createMfaEnrollment({ accountLabel: adminEmail, issuer: 'OCPOOL' });

  test.beforeAll(async () => {
    const [managerRole, adminRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'admin' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const client = await prisma.client.create({ data: { displayName: `Auth Surface Client ${suffix}` } });
    clientIds.push(client.id);
    const [employee, admin, customer] = await Promise.all([
      prisma.user.create({ data: { email: employeeEmail, emailNormalized: employeeEmail, displayName: 'Auth Surface Employee', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(employeePassword), roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: adminEmail, emailNormalized: adminEmail, displayName: 'Auth Surface Admin', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(adminPassword), mfaRequired: true, mfaSecretCiphertext: encryptSecret(employeeMfa.secret, readServerEnv().MFA_ENCRYPTION_KEY), roles: { create: { roleId: adminRole.id } } } }),
      prisma.user.create({ data: { email: customerEmail, emailNormalized: customerEmail, displayName: 'Auth Surface Customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: client.id, roles: { create: { roleId: customerRole.id } } } }),
    ]);
    userIds.push(employee.id, admin.id, customer.id);

    const tokens = await Promise.all([
      prisma.authToken.create({ data: { userId: customer.id, type: 'MAGIC_LINK', tokenHash: fingerprintToken(customerToken), expiresAt: new Date(Date.now() + 15 * 60_000) } }),
      prisma.authToken.create({ data: { userId: employee.id, type: 'PASSWORD_RESET', tokenHash: fingerprintToken(recoveryToken), expiresAt: new Date(Date.now() + 15 * 60_000) } }),
    ]);
    tokenIds.push(...tokens.map(({ id }) => id));
  });

  test.afterAll(async () => {
    await prisma.authRateLimit.deleteMany({ where: { keyHash: { in: [fingerprintToken(employeeEmail), fingerprintToken(adminEmail), fingerprintToken(customerEmail)] } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authToken.deleteMany({ where: { id: { in: tokenIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.$disconnect();
  });

  test('offers safe entry points and a complete employee login surface', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/staff/requests');
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Acceso interno' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al sitio', exact: true })).toBeVisible();
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();
    await page.getByLabel('Correo').fill(employeeEmail);
    await page.getByLabel('Contraseña').fill(employeePassword);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/staff\/?$/);
    await page.context().clearCookies();

    await page.goto('/login');
    await page.getByLabel('Correo').fill(`unknown-${suffix}@example.test`);
    await page.getByLabel('Contraseña').fill('WrongAuthSurface123!');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('.auth-feedback--error')).toContainText('No fue posible iniciar sesión.');
    await expect(page.locator('body')).not.toContainText(/no existe|no registrado|inactivo/i);
    await expectNoSeriousA11yViolations(page);

    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    const transition = await page.getByRole('button', { name: 'Entrar' }).evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(['0s', '0.01ms', '1e-05s']).toContain(transition);
  });

  test('H1-06: completes the whole login flow with keyboard only, no click anywhere', async ({ page }) => {
    await page.goto('/login');
    // Se ancla el foco inicial en el primer campo (la alcanzabilidad de ESE primer salto ya la
    // cubre la prueba de skip-link de quality.spec.ts) para poder afirmar, sin ambigüedad, que
    // TODO lo que sigue -- moverse entre campos y enviar -- ocurre por teclado, sin un solo click.
    await page.getByLabel('Correo').focus();
    await page.keyboard.type(employeeEmail);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Contraseña')).toBeFocused();
    await page.keyboard.type(employeePassword);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/staff\/?$/);
    await page.context().clearCookies();
  });

  test('supports administrator MFA without relaxing the existing backend contract', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo').fill(adminEmail);
    await page.getByLabel('Contraseña').fill(adminPassword);
    await page.getByLabel('Código de autenticación').fill(generateTotpCode(employeeMfa.secret, Date.now()));
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/staff\/?$/);
  });

  test('requests and consumes customer magic links without leaving the token in the browser', async ({ page }) => {
    await page.goto('/portal/access');
    await expect(page.getByRole('heading', { name: 'Accede a tu portal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al sitio', exact: true })).toBeVisible();
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();
    await page.getByLabel('Correo').fill(customerEmail);
    await page.getByRole('button', { name: 'Solicitar acceso' }).click();
    await expect(page.getByRole('status')).toContainText('Si tu cuenta ya está habilitada');
    await expect(page.getByRole('status')).toContainText('Si eres cliente nuevo');

    await page.goto(`/auth/customer/consume-link?token=${encodeURIComponent(customerToken)}`);
    await expect(page).toHaveURL(/\/portal\/?$/);
    expect(page.url()).not.toContain(customerToken);
    await expect(page.locator('body')).not.toContainText(customerToken);
  });

  test('requests and consumes password recovery safely', async ({ page }) => {
    await page.goto('/login/recovery');
    await expect(page.getByRole('heading', { name: 'Recupera tu acceso' })).toBeVisible();
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();
    await page.getByLabel('Correo').fill(`unknown-recovery-${suffix}@example.test`);
    await page.getByRole('button', { name: 'Enviar solicitud' }).click();
    await expect(page.getByRole('status')).toContainText('Si el correo está asociado');

    await page.goto(`/auth/recovery?token=${encodeURIComponent(recoveryToken)}`);
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();
    await page.getByLabel('Nueva contraseña').fill('AuthSurfaceReset123!');
    await page.getByLabel('Confirmar contraseña').fill('AuthSurfaceReset123!');
    await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
    await expect(page.getByRole('status')).toContainText('contraseña fue actualizada');
    expect(page.url()).not.toContain(recoveryToken);
    await expect(page.locator('body')).not.toContainText(recoveryToken);
  });

  test('renders invalid and replayed links as safe non-authenticated states', async ({ page }) => {
    await page.goto('/auth/customer/consume-link?token=invalid-token');
    await expect(page.getByRole('heading', { name: 'Enlace no disponible' })).toBeVisible();
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/UUID|tokenHash|stack|DATABASE_URL/i);
    await page.goto('/auth/recovery');
    await expect(page.getByRole('heading', { name: 'Enlace no disponible' })).toBeVisible();
    await expect(page.locator('img[alt="OCPOOL"]')).toBeVisible();
  });
});
