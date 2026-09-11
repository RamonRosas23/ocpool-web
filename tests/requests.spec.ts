import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';
import { recordBaselineMeasurement } from './fixtures/commercial-baseline-recorder';

test.describe('staff request workflow opt-in flow', () => {
  test.skip(process.env.REQUESTS_E2E !== '1', 'Requests E2E requires REQUESTS_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-09-10T12:00:00.000Z');
  const email = `e2e-requests-${suffix}@example.test`;
  const sessionToken = `e2e-requests-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
  let userId = '';
  let sessionId = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let folio = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'E2E Request Sales',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: salesRole.id } },
      },
    });
    userId = user.id;
    ({ sessionId } = await createSession({ userId, ipAddress: '127.0.0.1', userAgent: 'playwright-requests-test' }, { prisma, tokenGenerator: () => sessionToken }));

    const request = await createQuoteRequest({
      idempotencyKey: `requests-e2e-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Request E2E ${suffix}`, email },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Solicitud sintética para medir la siguiente tarea.', consentAt: now },
    }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = request.folio;
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'EN_REVISION' } });
  });

  test.afterAll(async () => {
    if (requestId) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      await prisma.quoteRequest.delete({ where: { id: requestId } });
    }
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    if (sessionId) await prisma.session.delete({ where: { id: sessionId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('moves a request to information required with a clear next task', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const measurementStartedAt = new Date();

    await page.goto('/staff/requests');
    await expect(page.getByRole('heading', { name: 'Solicitudes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al dashboard' })).toHaveAttribute('href', '/staff');
    await expect(page.getByRole('button', { name: new RegExp(folio) })).toBeVisible();
    await expect(page.getByRole('heading', { name: folio })).toBeVisible();
    await expect(page.locator('.staff-status-pill')).toHaveText('En revisión');
    await expect(page.getByRole('combobox', { name: 'Siguiente estado' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Siguiente estado' }).click();
    await page.getByRole('option', { name: 'Información requerida', exact: true }).click();
    await page.getByPlaceholder('Motivo opcional').last().fill('Faltan medidas aproximadas del proyecto.');
    await page.getByRole('button', { name: 'Actualizar estado' }).click();
    await expect(page.locator('.staff-notice')).toContainText('Estado actualizado.');
    await expect(page.locator('.staff-status-pill')).toHaveText('Información requerida');
    await expect(page.getByRole('heading', { name: 'Historial del expediente' })).toBeVisible();
    await expect(page.getByText('Faltan medidas aproximadas del proyecto.')).toBeVisible();

    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'request_to_next_task',
      scenarioId: 'waiting-for-customer',
      actorType: 'SALES',
      surface: 'staff-requests',
      viewport: 'desktop',
      seedVersion: 'requests-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: measurementStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - measurementStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });

      await expectNoSeriousA11yViolations(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll<HTMLElement>('*')]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > viewportWidth + 1 || rect.left < -1)
          .slice(0, 20)
          .map(({ element, rect }) => ({ tag: element.tagName, className: element.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), text: element.textContent?.trim().slice(0, 80) }));
        return { scrollWidth: document.documentElement.scrollWidth, viewportWidth, offenders };
      });
      expect(layout.scrollWidth <= layout.viewportWidth, `horizontal overflow at ${width}px: ${JSON.stringify(layout)}`).toBe(true);
    }
    expect(consoleErrors).toEqual([]);
  });
});
