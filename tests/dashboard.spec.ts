import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff analytics dashboard', () => {
  test.skip(process.env.DASHBOARD_E2E !== '1', 'Dashboard E2E requires DASHBOARD_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-dashboard-${suffix}@example.test`;
  let userId = '';
  let sessionId = '';
  let sessionToken = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'E2E Dashboard Manager',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    userId = user.id;
    sessionToken = `e2e-dashboard-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    ({ sessionId } = await createSession({ userId: user.id, ipAddress: '127.0.0.1', userAgent: 'playwright-dashboard-test' }, { prisma, tokenGenerator: () => sessionToken }));
  });

  test.afterAll(async () => {
    if (sessionId) await prisma.session.delete({ where: { id: sessionId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('supports restricted, empty, responsive and accessible states', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();
    consoleErrors.length = 0;

    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Pulso comercial' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Desde', exact: true }).fill('2020-01-01');
    await page.getByRole('textbox', { name: 'Hasta', exact: true }).fill('2020-02-01');
    await page.getByRole('button', { name: 'Aplicar periodo' }).click();
    await expect(page.getByText('No hay solicitudes en este periodo.')).toBeVisible();
    await expect(page.getByText('Salud de notificaciones')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(email);
    await expectNoSeriousA11yViolations(page);

    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    const reducedMotion = await page.locator('button').first().evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(['0s', '0.01ms', '1e-05s']).toContain(reducedMotion);
    expect(consoleErrors).toEqual([]);
  });
});
