import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff audit workspace', () => {
  test.skip(process.env.AUDIT_E2E !== '1', 'Audit E2E requires AUDIT_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const auditIds: string[] = [];
  const authEventIds: string[] = [];
  const sessionTokens = new Map<string, string>();
  const secretEmail = `private-audit-${suffix}@example.test`;
  const secretIp = '192.0.2.44';
  const secretUserAgent = `private-audit-agent-${suffix}`;

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const [managerRole, adminRole, salesRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'admin' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);

    const users = await Promise.all([
      prisma.user.create({ data: { email: `audit-e2e-manager-${suffix}@example.test`, emailNormalized: `audit-e2e-manager-${suffix}@example.test`, displayName: 'E2E Audit Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `audit-e2e-admin-${suffix}@example.test`, emailNormalized: `audit-e2e-admin-${suffix}@example.test`, displayName: 'E2E Audit Admin', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: adminRole.id } } } }),
      prisma.user.create({ data: { email: `audit-e2e-sales-${suffix}@example.test`, emailNormalized: `audit-e2e-sales-${suffix}@example.test`, displayName: 'E2E Audit Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `audit-e2e-customer-${suffix}@example.test`, emailNormalized: `audit-e2e-customer-${suffix}@example.test`, displayName: 'E2E Audit Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
    ]);
    userIds.push(...users.map(({ id }) => id));

    const sessionDefinitions = [
      ['manager', users[0].id, false],
      ['admin', users[1].id, true],
      ['sales', users[2].id, false],
      ['customer', users[3].id, false],
    ] as const;
    for (const [key, userId, mfaVerified] of sessionDefinitions) {
      const token = `audit-e2e-${key}-${suffix}-abcdefghijklmnopqrstuvwxyz`;
      const session = await createSession({ userId, ipAddress: '127.0.0.1', userAgent: 'playwright-audit-test', mfaVerified }, { prisma, tokenGenerator: () => token });
      sessionIds.push(session.sessionId);
      sessionTokens.set(key, token);
    }

    const operational = await prisma.auditLog.createManyAndReturn({
      data: Array.from({ length: 26 }, (_, index) => ({
        actorUserId: users[0].id,
        action: 'quote.pdf.generation_failed',
        entityType: 'generated_document',
        entityId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        outcome: 'FAILURE' as const,
        metadata: { failureCode: `OC-E2E-${String(index + 1).padStart(3, '0')}`, email: secretEmail },
        createdAt: new Date(Date.parse('2026-09-07T12:00:00.000Z') - index * 60_000),
      })),
    });
    auditIds.push(...operational.map(({ id }) => id));

    const security = await prisma.authEvent.create({
      data: {
        userId: users[1].id,
        eventType: 'LOGIN_SUCCESS',
        outcome: 'SUCCESS',
        identifierHash: 'b'.repeat(64),
        ipAddress: secretIp,
        userAgent: secretUserAgent,
        metadata: { email: secretEmail, tokenId: 'private-token' },
        createdAt: new Date('2026-09-07T10:00:00.000Z'),
      },
    });
    authEventIds.push(security.id);
  });

  test.afterAll(async () => {
    await prisma.authRateLimit.deleteMany({ where: { scope: 'audit-read', keyHash: { in: userIds.map((id) => fingerprintToken(id)) } } });
    await prisma.authEvent.deleteMany({ where: { id: { in: authEventIds } } });
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const setSession = async (page: Page, key: string) => {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionTokens.get(key)!, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  };

  test('covers access, filters, pagination, recovery, accessibility and responsive states', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/staff/audit');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();

    await setSession(page, 'customer');
    await page.goto('/staff/audit');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();

    await setSession(page, 'sales');
    await page.goto('/staff/audit');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();
    consoleErrors.length = 0;

    await setSession(page, 'manager');
    let failedOnce = false;
    await page.route('**/api/staff/audit**', async (route) => {
      if (failedOnce) return route.continue();
      failedOnce = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'No fue posible consultar la auditoría.' } }) });
    });
    await page.goto('/staff/audit');
    await expect(page.getByRole('heading', { name: 'No fue posible cargar la auditoría.' })).toBeVisible();
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('heading', { name: 'Auditoría operativa' }).first()).toBeVisible();
    consoleErrors.length = 0;
    await page.getByLabel('Desde').fill('2026-09-07');
    await page.getByLabel('Hasta').fill('2026-09-08');
    await page.getByLabel('Filtrar por categoría').selectOption('documents');
    await page.getByLabel('Filtrar por resultado').selectOption('FAILURE');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByTestId('audit-entry')).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Cargar eventos anteriores' })).toBeVisible();
    await page.getByRole('button', { name: 'Cargar eventos anteriores' }).click();
    await expect(page.getByTestId('audit-entry')).toHaveCount(26);
    await expect(page.getByText('OC-E2E-001')).toBeVisible();
    await expect(page.getByText('OC-E2E-026')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secretEmail);
    await expect(page.locator('body')).not.toContainText(secretIp);
    await expect(page.locator('body')).not.toContainText(secretUserAgent);
    await expectNoSeriousA11yViolations(page);

    await page.getByLabel('Desde').fill('2020-01-01');
    await page.getByLabel('Hasta').fill('2020-02-01');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByText('No hay eventos en este periodo.')).toBeVisible();

    await setSession(page, 'admin');
    await page.goto('/staff/audit');
    await page.getByLabel('Filtrar por categoría').selectOption('security');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByRole('heading', { name: 'Eventos de seguridad' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inicio de sesión exitoso' }).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secretEmail);
    await expect(page.locator('body')).not.toContainText(secretIp);
    await expect(page.locator('body')).not.toContainText(secretUserAgent);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('button', { name: 'Aplicar filtros' }).focus();
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeFocused();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    const reducedMotion = await page.getByRole('button', { name: 'Aplicar filtros' }).evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(['0s', '0.01ms', '1e-05s']).toContain(reducedMotion);
    expect(consoleErrors).toEqual([]);
  });
});
