import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { hashPassword } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { upsertNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff notification operations', () => {
  test.skip(process.env.AUTH_E2E !== '1', 'Notification E2E requires AUTH_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-notifications-${suffix}@example.test`;
  const password = 'E2ENotificationPassword123!';
  const recipient = `e2e-recipient-${suffix}@example.test`;
  let userId = '';
  let sessionId = '';
  let sessionToken = '';
  let outboxId = '';
  let deliveryId = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'E2E Notification Manager',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        passwordHash: await hashPassword(password),
        roles: { create: { roleId: managerRole.id } },
      },
    });
    userId = user.id;
    sessionToken = `e2e-notification-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    ({ sessionId } = await createSession({ userId: user.id, ipAddress: '127.0.0.1', userAgent: 'playwright-notification-test' }, { prisma, tokenGenerator: () => sessionToken }));
    const outbox = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `e2e-notifications-${suffix}` } } });
    outboxId = outbox.id;
    const delivery = await upsertNotificationDelivery(prisma, {
      outboxEventId: outbox.id,
      recipientUserId: null,
      recipientEmail: recipient,
      templateKey: 'message.created',
      templateVersion: 'v1',
      safePayload: { recipientName: 'No exponer en interfaz', folio: 'OCQ-2026-E2E', preview: 'Contenido privado no visible' },
    });
    deliveryId = delivery.id;
    await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', lastErrorCode: 'TEMPORARY_PROVIDER' } });
  });

  test.afterAll(async () => {
    if (deliveryId) await prisma.auditLog.deleteMany({ where: { action: 'notification.retry', entityId: deliveryId } });
    if (outboxId) await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: outboxId } });
    if (outboxId) await prisma.outboxEvent.delete({ where: { id: outboxId } });
    if (sessionId) await prisma.session.delete({ where: { id: sessionId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('is accessible, responsive, secret-free and supports keyboard retry', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/staff/notifications');
    await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
    await page.getByLabel('Filtrar por estado').selectOption('FAILED');
    await expect(page.locator('.staff-notification-row').filter({ hasText: 'message.created' }).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(recipient);
    await expect(page.locator('body')).not.toContainText('No exponer en interfaz');
    await expect(page.locator('body')).not.toContainText('Contenido privado no visible');
    await expectNoSeriousA11yViolations(page);

    const focusedRetry = page.getByRole('button', { name: 'Reintentar entrega' }).first();
    await focusedRetry.focus();
    await expect(focusedRetry).toBeFocused();
    await focusedRetry.press('Enter');
    await expect(page.locator('.staff-notice')).toContainText('La entrega fue devuelta a la cola.');
    expect(consoleErrors).toEqual([]);

    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    const reducedMotion = await page.locator('#notification-status').evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(['0s', '0.01ms', '1e-05s']).toContain(reducedMotion);
  });
});
