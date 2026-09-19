import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff analytics dashboard', () => {
  test.skip(process.env.DASHBOARD_E2E !== '1', 'Dashboard E2E requires DASHBOARD_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-09-19T12:00:00.000Z');
  const email = `e2e-dashboard-${suffix}@example.test`;
  let userId = '';
  let sessionId = '';
  let sessionToken = '';
  let mineRequestId = '';
  let mineContactId = '';
  let mineClientId = '';
  let mineFolio = '';
  let unassignedRequestId = '';
  let unassignedContactId = '';
  let unassignedClientId = '';
  let unassignedFolio = '';

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

    const mine = await createQuoteRequest({
      idempotencyKey: `dashboard-mine-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Dashboard queue mine ${suffix}`, email: `dashboard-mine-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'W1-02 mine queue fixture', consentAt: now },
    }, { prisma, now });
    mineRequestId = mine.quoteRequestId;
    mineClientId = mine.clientId;
    mineContactId = mine.contactId;
    mineFolio = mine.folio;
    await prisma.quoteRequest.update({ where: { id: mineRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: userId } });

    const unassigned = await createQuoteRequest({
      idempotencyKey: `dashboard-unassigned-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Dashboard queue unassigned ${suffix}`, email: `dashboard-unassigned-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'W1-02 unassigned queue fixture', consentAt: now },
    }, { prisma, now });
    unassignedRequestId = unassigned.quoteRequestId;
    unassignedClientId = unassigned.clientId;
    unassignedContactId = unassigned.contactId;
    unassignedFolio = unassigned.folio;
    await prisma.quoteRequest.update({ where: { id: unassignedRequestId }, data: { status: 'EN_ELABORACION' } });
    // El dashboard ordena "Sin asignar" por más antigua primero (la más urgente); este entorno
    // compartido ya acumula decenas de solicitudes sin asignar de corridas previas, así que se
    // retrasa el reloj de esta fixture para garantizar que quede entre las primeras sin depender
    // de vaciar datos ajenos. `updatedAt` es `@updatedAt`, por eso se fuerza con SQL directo.
    await prisma.$executeRaw`UPDATE quote_requests SET "updatedAt" = '2000-01-01T00:00:00.000Z' WHERE id = ${unassignedRequestId}::uuid`;
  });

  test.afterAll(async () => {
    for (const id of [mineRequestId, unassignedRequestId]) {
      if (!id) continue;
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: id } });
      await prisma.auditLog.deleteMany({ where: { entityId: id } });
      await prisma.quoteRequest.delete({ where: { id } });
    }
    if (mineContactId) await prisma.clientContact.delete({ where: { id: mineContactId } });
    if (mineClientId) await prisma.client.delete({ where: { id: mineClientId } });
    if (unassignedContactId) await prisma.clientContact.delete({ where: { id: unassignedContactId } });
    if (unassignedClientId) await prisma.client.delete({ where: { id: unassignedClientId } });
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

  test('W1-02: work queues surface the exact request and deep-link into it', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Mi trabajo' })).toBeVisible();
    const mineCard = page.locator('.staff-workqueue__card', { has: page.getByRole('heading', { name: 'Mi trabajo' }) });
    const unassignedCard = page.locator('.staff-workqueue__card', { has: page.getByRole('heading', { name: 'Sin asignar' }) });
    await expect(mineCard.getByText(mineFolio)).toBeVisible({ timeout: 10_000 });
    await expect(mineCard.getByText(`Dashboard queue mine ${suffix}`)).toBeVisible();
    await expect(unassignedCard.getByText(unassignedFolio)).toBeVisible();
    await expect(unassignedCard.getByText(`Dashboard queue unassigned ${suffix}`)).toBeVisible();
    // La solicitud asignada a este actor nunca debe aparecer también en "Sin asignar", ni viceversa.
    await expect(mineCard.getByText(unassignedFolio)).toHaveCount(0);
    await expect(unassignedCard.getByText(mineFolio)).toHaveCount(0);

    await mineCard.getByText(mineFolio).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests\\?request=${mineRequestId}$`));
    await expect(page.getByRole('heading', { name: mineFolio })).toBeVisible({ timeout: 10_000 });
  });
});
