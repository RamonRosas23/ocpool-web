import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { createSession } from '@/server/auth/sessions';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('request workspace V2 opt-in flow', () => {
  test.skip(process.env.REQUEST_WORKSPACE_V2_E2E !== '1', 'Request workspace V2 E2E requires REQUEST_WORKSPACE_V2_E2E=1 and approved local flags.');
  test.setTimeout(60_000);

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientEmail = `workspace-v2-${suffix}@example.test`;
  const sessionToken = `workspace-v2-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
  let userId = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let manualRequestId = '';
  let manualClientId = '';
  let manualContactId = '';
  let dedupeRequestId = '';
  let reassignRequestId = '';
  let reassignClientId = '';
  let reassignContactId = '';
  let reassignTargetId = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: {
        email: `workspace-v2-operator-${suffix}@example.test`,
        emailNormalized: `workspace-v2-operator-${suffix}@example.test`,
        displayName: 'Operador workspace V2',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    userId = user.id;
    const reassignTarget = await prisma.user.create({
      data: {
        email: `workspace-v2-target-${suffix}@example.test`,
        emailNormalized: `workspace-v2-target-${suffix}@example.test`,
        displayName: 'Operador alterno workspace V2',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    reassignTargetId = reassignTarget.id;
    await createSession({ userId, ipAddress: null, userAgent: 'request-workspace-v2-e2e' }, { prisma, tokenGenerator: () => sessionToken });
    const request = await createQuoteRequest({
      idempotencyKey: `workspace-v2-request-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: `Cliente workspace V2 ${suffix}`, email: clientEmail, phone: '+52 667 000 3344' },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Fixture desechable para la cola V2.', consentAt: new Date('2026-09-12T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-09-12T12:00:00.000Z') });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const reassignRequest = await createQuoteRequest({
      idempotencyKey: `workspace-v2-reassign-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: `Cliente reasignación workspace V2 ${suffix}`, email: `workspace-v2-reassign-${suffix}@example.test`, phone: '+52 667 000 5566' },
      detail: { projectType: 'Residencial', location: 'Tepic', description: 'Fixture para validar la reasignación desde el expediente.', consentAt: new Date('2026-09-12T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-09-12T12:00:00.000Z') });
    reassignRequestId = reassignRequest.quoteRequestId;
    reassignClientId = reassignRequest.clientId;
    reassignContactId = reassignRequest.contactId;
    await prisma.requestAssignment.create({
      data: { quoteRequestId: reassignRequestId, assignedToId: reassignTargetId, assignedById: userId, reason: 'Fixture de reasignación E2E', assignedAt: new Date('2026-09-12T12:01:00.000Z') },
    });
    await prisma.quoteRequest.update({ where: { id: reassignRequestId }, data: { currentAssigneeId: reassignTargetId } });
  });

  test.afterAll(async () => {
    if (dedupeRequestId) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: dedupeRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: dedupeRequestId } });
      await prisma.quoteRequest.delete({ where: { id: dedupeRequestId } });
    }
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    if (requestId) await prisma.quoteRequest.delete({ where: { id: requestId } });
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    if (manualRequestId) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: manualRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: manualRequestId } });
      await prisma.quoteRequest.delete({ where: { id: manualRequestId } });
    }
    if (manualContactId) await prisma.clientContact.delete({ where: { id: manualContactId } });
    if (manualClientId) await prisma.client.delete({ where: { id: manualClientId } });
    if (reassignRequestId) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: reassignRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: reassignRequestId } });
      await prisma.quoteRequest.delete({ where: { id: reassignRequestId } });
    }
    if (reassignContactId) await prisma.clientContact.delete({ where: { id: reassignContactId } });
    if (reassignClientId) await prisma.client.delete({ where: { id: reassignClientId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (reassignTargetId) await prisma.user.delete({ where: { id: reassignTargetId } });
    await prisma.$disconnect();
  });

  test('persists queue context across filtering, deep links and return navigation', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const query = `Cliente workspace V2 ${suffix}`;
    await page.goto(`/staff/requests?query=${encodeURIComponent(query)}&sort=oldest`);
    await expect(page.getByRole('heading', { name: 'Solicitudes', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Buscar' })).toHaveValue(query);
    await expect(page.getByRole('combobox', { name: 'Responsable' })).toBeVisible();
    await expect(page.getByText(query, { exact: true })).toBeVisible();
    await expect(page.locator('.request-workspace-v2__row')).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const expectedScrollY = await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll < 1) throw new Error('The queue fixture must be vertically scrollable to verify restoration.');
      window.scrollTo(0, Math.min(240, maxScroll));
      window.dispatchEvent(new Event('scroll'));
      return Math.round(window.scrollY);
    });
    expect(expectedScrollY).toBeGreaterThan(0);
    const detailHref = await page.locator('.request-workspace-v2__row').getAttribute('href');
    expect(detailHref).toBeTruthy();
    await page.goto(detailHref!);
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?query=`));
    await expect(page.getByRole('heading', { name: /^OCQ-/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Descripción del proyecto' })).toBeVisible();
    await expect(page.getByText('Fixture desechable para la cola V2.')).toBeVisible();
    await expect(page.locator('.request-workspace-v2__list')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Tomar solicitud' })).toHaveCount(1);
    const moreActions = page.getByRole('button', { name: 'Más acciones' });
    await moreActions.click();
    const actionMenu = page.getByRole('menu', { name: 'Más acciones del expediente' });
    await expect(actionMenu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Marcar en revisión' })).toBeVisible();
    const menuItems = actionMenu.getByRole('menuitem');
    await expect(menuItems.first()).toBeFocused();
    await menuItems.first().press('ArrowDown');
    await expect(menuItems.nth(1)).toBeFocused();
    await menuItems.nth(1).press('Home');
    await expect(menuItems.first()).toBeFocused();
    await menuItems.first().press('End');
    await expect(menuItems.last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(actionMenu).toBeHidden();
    await expect(moreActions).toBeFocused();
    await expect(page).toHaveTitle(/OCPOOL Operaciones/);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('tab', { name: 'Actividad' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?query=.*tab=activity`));
    await expect(page.getByRole('heading', { name: 'Actividad del expediente' })).toBeVisible();
    await page.getByRole('tab', { name: 'Conversación' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?query=.*tab=conversation`));
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    const conversationDraft = 'Borrador conservado entre pestañas.';
    await page.getByRole('textbox', { name: 'Mensaje visible para cliente' }).fill(conversationDraft);
    await page.getByRole('tab', { name: 'Resumen' }).click();
    await expect(page.getByRole('heading', { name: 'Descripción del proyecto' })).toBeVisible();
    await page.getByRole('tab', { name: 'Conversación' }).click();
    await expect(page.getByRole('textbox', { name: 'Mensaje visible para cliente' })).toHaveValue(conversationDraft);
    await page.getByRole('tab', { name: 'Archivos' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?query=.*tab=files`));
    await expect(page.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
    await page.getByRole('tab', { name: 'Cotización' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?query=.*tab=quote`));
    await expect(page.getByText('Todavía no hay una cotización asociada.')).toBeVisible();
    await expect(page).toHaveTitle(/OCPOOL Operaciones/);
    await expectNoSeriousA11yViolations(page);

    await page.goto(`/staff/quotes?request=${requestId}&query=${encodeURIComponent(query)}&sort=oldest`);
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?query=.*&sort=oldest&tab=quote`));
    await expect(page.getByText('Todavía no hay una cotización asociada.')).toBeVisible();

    await page.getByRole('link', { name: '← Volver a solicitudes' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests\\?query=.*&sort=oldest`));
    await expect(page.getByRole('textbox', { name: 'Buscar' })).toHaveValue(query);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(expectedScrollY);

    await page.goto(`/staff/quotes?request=${requestId}`);
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${requestId}\\?tab=quote`));
    await page.getByRole('link', { name: '← Volver a solicitudes' }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3100/staff/requests');
  });

  test('normalizes invalid URL filters and remains responsive at supported widths', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const query = `Cliente workspace V2 ${suffix}`;
    await page.goto(`/staff/requests?query=${encodeURIComponent(query)}&view=invalid&stage=invalid&age=invalid&sort=invalid&page=0&tab=invalid`);
    await expect(page.locator('.request-workspace-v2__row')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: 'Vista' })).toContainText('Todas las solicitudes');
    await expect(page.getByRole('combobox', { name: 'Antigüedad' })).toContainText('Cualquier antigüedad');
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}px`).toBe(true);
    }
    await expectNoSeriousA11yViolations(page);
  });

  test('creates a manual request after explicit consent', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `manual-workspace-${suffix}@example.test`;
    await page.goto('/staff/requests/new');
    await expect(page.getByRole('heading', { name: 'Nueva solicitud' })).toBeVisible();
    await page.getByLabel('Nombre completo').fill('Cliente manual workspace V2');
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Teléfono').fill('+52 667 000 1122');
    await page.getByLabel('Tipo de proyecto').fill('Residencial');
    await page.getByLabel('Ubicación').fill('Culiacán');
    await page.getByLabel('Descripción').fill('Solicitud manual creada desde el workspace V2.');
    await page.getByRole('checkbox', { name: /cliente autorizó/i }).check();
    const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/staff/quote-requests') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crear solicitud' }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const body = await response.json() as { quoteRequestId: string; clientId: string; contactId: string };
    manualRequestId = body.quoteRequestId;
    manualClientId = body.clientId;
    manualContactId = body.contactId;
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${manualRequestId}\\?tab=summary&created=1`));
    await expect(page.getByText('Solicitud creada correctamente.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Descripción del proyecto' })).toBeVisible();
    await page.getByRole('button', { name: 'Editar expediente' }).click();
    await page.getByLabel('Ubicación del proyecto').fill('Tepic');
    await page.getByLabel('Dimensiones del proyecto').fill('10 x 4 m');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();
    await expect(page.getByText('Tepic', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tomar solicitud' })).toBeVisible();
    await page.getByRole('button', { name: 'Tomar solicitud' }).click();
    await expect(page.getByText('Esta solicitud está tomada por ti.')).toBeVisible();
    await page.getByRole('button', { name: 'Marcar en revisión' }).click();
    await expect(page.getByText('Estado actualizado.')).toBeVisible();
    await expect(page.getByText('En revisión', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Solicitar información' }).click();
    await expect(page.getByRole('textbox', { name: 'Mensaje para el cliente' })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar y esperar información' }).click();
    await expect(page.getByText(/Solicitud de información registrada/)).toBeVisible();
    await expect(page.getByText('Información requerida', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lista para cotizar' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${manualRequestId}\\?tab=quote`));
    await expect(page.getByText('Todavía no hay una cotización asociada.')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('requires a dedupe decision before reusing an existing contact', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/staff/requests/new');
    await expect(page.getByRole('heading', { name: 'Nueva solicitud' })).toBeVisible();
    await page.getByLabel('Nombre completo').fill(`Contacto repetido ${suffix}`);
    await page.getByLabel('Correo').fill(clientEmail);
    await page.getByLabel('Teléfono').fill('+52 667 000 3344');
    await page.getByLabel('Tipo de proyecto').fill('Comercial');
    await page.getByLabel('Ubicación').fill('Los Mochis');
    await page.getByLabel('Descripción').fill('Solicitud para comprobar la revisión de duplicados en admisión.');
    await page.getByRole('checkbox', { name: /cliente autorizó/i }).check();

    let createRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/staff/quote-requests') && request.method() === 'POST') createRequests += 1;
    });
    await page.getByRole('button', { name: 'Revisar y crear solicitud' }).click();

    await expect(page.getByRole('heading', { name: 'Encontramos 1 contacto coincidente.' })).toBeVisible();
    await expect(page.getByText(`Cliente workspace V2 ${suffix}`, { exact: true })).toBeVisible();
    await expect(page.locator('input[name="contact-match"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Revisar y crear solicitud' })).toBeVisible();
    expect(createRequests).toBe(0);

    await page.locator('input[name="contact-match"]').check();
    await expect(page.getByRole('button', { name: 'Usar contacto seleccionado' })).toBeVisible();
    const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/staff/quote-requests') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Usar contacto seleccionado' }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const body = await response.json() as { quoteRequestId: string; clientId: string; contactId: string };
    dedupeRequestId = body.quoteRequestId;
    expect(body.clientId).toBe(clientId);
    expect(body.contactId).toBe(contactId);
    await expect(page).toHaveURL(new RegExp(`/staff/requests/${dedupeRequestId}\\?tab=summary&created=1`));
    await expect(page.getByText('Solicitud creada correctamente.')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('reassigns an active request with a required reason', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.setViewportSize({ width: 1440, height: 1600 });
    await page.goto(`/staff/requests/${reassignRequestId}?tab=summary`);
    await expect(page.getByRole('heading', { name: 'Operador alterno workspace V2' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Nuevo responsable' })).toBeVisible();

    const assigneeSelect = page.getByRole('combobox', { name: 'Nuevo responsable' });
    await assigneeSelect.click();
    await page.getByRole('option', { name: 'Operador workspace V2' }).first().click();
    await expect(assigneeSelect).toContainText('Operador workspace V2');
    await page.getByRole('textbox', { name: 'Motivo de reasignación' }).fill('Redistribución operativa validada.');
    await page.getByRole('button', { name: 'Reasignar solicitud' }).click();

    await expect(page.getByText('Solicitud reasignada.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Operador workspace V2' })).toBeVisible();
    await expect(page.getByText('Esta solicitud está tomada por ti.')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
