import 'dotenv/config';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { closeConversation, createInternalNote, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';
import { recordBaselineMeasurement } from './fixtures/commercial-baseline-recorder';

test.describe('customer portal opt-in flow', () => {
  test.setTimeout(120_000);
  test.skip(process.env.PORTAL_E2E !== '1', 'Customer portal E2E requires PORTAL_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date('2026-09-01T12:00:00.000Z');
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  let customerAToken = '';
  let customerBToken = '';
  let customerAUserId = '';
  let customerBUserId = '';
  let employeeId = '';
  let requestAId = '';
  let requestBId = '';
  let clientAId = '';
  let clientBId = '';
  let contactAId = '';
  let contactBId = '';
  let quoteAId = '';
  let quoteBId = '';
  let categoryId = '';
  let itemId = '';
  let priceListId = '';

  test.beforeAll(async () => {
    if (process.env.PORTAL_E2E !== '1') return;

    const requestA = await createQuoteRequest({
      idempotencyKey: `portal-e2e-a-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Portal E2E A ${suffix}`, email: `portal-e2e-a-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Expediente E2E con cotización snapshot.', consentAt: now },
    }, { prisma, now });
    const requestB = await createQuoteRequest({
      idempotencyKey: `portal-e2e-b-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Portal E2E B ${suffix}`, email: `portal-e2e-b-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Expediente E2E sin cotización.', consentAt: now },
    }, { prisma, now });
    await seedIdentityCatalog(prisma);
    const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    requestAId = requestA.quoteRequestId;
    requestBId = requestB.quoteRequestId;
    clientAId = requestA.clientId;
    clientBId = requestB.clientId;
    contactAId = requestA.contactId;
    contactBId = requestB.contactId;

    const [customerA, customerB, employee] = await Promise.all([
      prisma.user.create({ data: { email: `portal-e2e-user-a-${suffix}@example.test`, emailNormalized: `portal-e2e-user-a-${suffix}@example.test`, displayName: 'Portal E2E cliente A', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `portal-e2e-user-b-${suffix}@example.test`, emailNormalized: `portal-e2e-user-b-${suffix}@example.test`, displayName: 'Portal E2E cliente B', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientBId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `portal-e2e-employee-${suffix}@example.test`, emailNormalized: `portal-e2e-employee-${suffix}@example.test`, displayName: 'Portal E2E empleado', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    customerAUserId = customerA.id;
    customerBUserId = customerB.id;
    employeeId = employee.id;
    customerAToken = `portal-e2e-a-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    customerBToken = `portal-e2e-b-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    await Promise.all([
      createSession({ userId: customerAUserId, ipAddress: null, userAgent: 'portal-e2e' }, { prisma, tokenGenerator: () => customerAToken }),
      createSession({ userId: customerBUserId, ipAddress: null, userAgent: 'portal-e2e' }, { prisma, tokenGenerator: () => customerBToken }),
    ]);

    await prisma.quoteRequest.update({ where: { id: requestAId }, data: { status: 'EN_ELABORACION' } });
    await prisma.quoteRequest.update({ where: { id: requestBId }, data: { status: 'EN_ELABORACION' } });
    const category = await prisma.catalogCategory.create({ data: { code: `PORTAL-E2E-${suffix}`, name: 'Portal E2E' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `PORTAL-E2E-ITEM-${suffix}`, name: 'Portal E2E snapshot item', unit: 'pieza', categoryId } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `PORTAL-E2E-PRICE-${suffix}`, name: 'Portal E2E prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 30000n, validFrom: now } });

    const employeeActor = { userId: employeeId, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.read', 'quotes.create', 'quotes.send', 'quotes.pdf.generate']), mfaVerified: true };
    const quote = await createQuoteVersion(employeeActor, { quoteRequestId: requestAId, priceListId, lines: [{ catalogItemId: itemId, quantity: '1', taxBasisPoints: 1600 }], validUntil: new Date('2026-10-01T00:00:00.000Z') }, { prisma, now });
    quoteAId = quote.quoteId;
    await transitionQuoteVersion(employeeActor, quote.versionId, 'EN_REVISION', { prisma, now });
    await transitionQuoteVersion(employeeActor, quote.versionId, 'ENVIADA', { prisma, now });
    await generateQuotePdf(employeeActor, quote.versionId, { prisma, now });
    await prisma.catalogItem.update({ where: { id: itemId }, data: { name: 'Portal E2E catálogo actualizado' } });

    const messagingActor = {
      userId: employeeId,
      type: 'EMPLOYEE' as const,
      clientId: null,
      permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write', 'messaging.manage']),
      mfaVerified: true,
    };
    const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
    await sendStaffMessage(messagingActor, requestAId, { body: 'Hemos revisado el alcance de tu proyecto.', idempotencyKey: `portal-e2e-staff-${suffix}` }, { prisma, now, rateLimit });
    await createInternalNote(messagingActor, requestAId, { body: 'Nota interna: validar acabado con ingeniería.', idempotencyKey: `portal-e2e-note-${suffix}` }, { prisma, now, rateLimit });
  });

  test.afterAll(async () => {
    if (process.env.PORTAL_E2E !== '1') return;
    const requestIds = [requestAId, requestBId].filter(Boolean);
    if (requestIds.length === 0) {
      await prisma.$disconnect();
      return;
    }
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: requestIds } } }, select: { id: true } })).map(({ id }) => id);
    const conversationIds = (await prisma.conversation.findMany({ where: { quoteRequestId: { in: requestIds } }, select: { id: true } })).map(({ id }) => id);
    const messageIds = (await prisma.conversationMessage.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } })).map(({ id }) => id);
    const attachments = await prisma.fileAttachment.findMany({ where: { quoteRequestId: { in: requestIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
    const quoteIds = [quoteAId, quoteBId].filter(Boolean);
    const generatedDocuments = quoteIds.length ? await prisma.generatedDocument.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } }) : [];
    const storage = getPrivateStorage();
    for (const { storageObject } of attachments) await storage.delete(storageObject.storageKey);
    for (const document of generatedDocuments) if (document.storageObject?.storageKey) await storage.delete(document.storageObject.storageKey);
    await prisma.fileAttachment.deleteMany({ where: { id: { in: attachments.map(({ id }) => id) } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: attachments.map(({ storageObjectId }) => storageObjectId) } } });
    if (quoteIds.length) await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await prisma.generatedDocument.deleteMany({ where: { id: { in: generatedDocuments.map(({ id }) => id) } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: generatedDocuments.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });
    await prisma.quote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    const aggregateIds = [...requestIds, ...(quoteAId ? [quoteAId] : []), ...conversationIds];
    const entityIds = [...aggregateIds, ...versionIds, ...messageIds];
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: entityIds } }, { actorUserId: { in: [customerAUserId, customerBUserId, employeeId] } }] } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    const contactIds = [contactAId, contactBId].filter(Boolean);
    if (contactIds.length) await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    const userIds = [customerAUserId, customerBUserId, employeeId].filter(Boolean);
    if (userIds.length) await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (customerAUserId && requestAId) await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${customerAUserId}:${requestAId}`) } });
    const clientIds = [clientAId, clientBId].filter(Boolean);
    if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    if (priceListId) {
      await prisma.priceListItem.deleteMany({ where: { priceListId } });
      await prisma.priceList.delete({ where: { id: priceListId } });
    }
    if (itemId) await prisma.catalogItem.delete({ where: { id: itemId } });
    if (categoryId) await prisma.catalogCategory.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  async function setSession(page: Page, token: string) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);
  }

  test('renders the private snapshot view and logs out safely', async ({ page }) => {
    await setSession(page, customerAToken);
    const measurementStartedAt = new Date();
    const portalPayloads: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', async (response) => {
      if (!response.url().includes('/api/portal/')) return;
      try { portalPayloads.push(await response.text()); } catch { /* response may already be disposed */ }
    });

    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Tu proyecto, en cada etapa.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al sitio', exact: true })).toBeVisible();
    await expect(page.locator('.client-header img[alt="OCPOOL"]')).toBeVisible();
    await expect(page.locator('.client-request-row')).toHaveCount(1);
    await expect(page.getByText('Portal E2E snapshot item')).toBeVisible();
    await expect(page.locator('.client-quote__total strong')).toHaveText('MXN 348.00');
    await expect(page.getByText('Vigente hasta 01 oct 2026')).toBeVisible();
    await expect(page.locator('.client-status')).toHaveText('Cotización disponible');
    await expect(page.getByRole('button', { name: 'Descargar PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar y aceptar' })).toBeVisible();
    const pdfResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/portal/quotes/${quoteAId}/pdf`));
    const pdfPopupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Descargar PDF' }).click();
    const [pdfResponse, pdfPopup] = await Promise.all([pdfResponsePromise, pdfPopupPromise]);
    const pdfBody = await pdfResponse.json() as { downloadUrl: string };
    expect(pdfBody.downloadUrl).toContain('X-Amz-');
    await pdfPopup.close();
    await page.getByRole('button', { name: 'Revisar y aceptar' }).click();
    await expect(page.getByRole('dialog', { name: 'Aceptar versión 1' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Aceptar versión 1' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Revisar y aceptar' })).toBeFocused();
    await page.getByRole('button', { name: 'Revisar y aceptar' }).click();
    const acceptDialog = page.getByRole('dialog', { name: 'Aceptar versión 1' });
    await expect(acceptDialog).toBeVisible();
    // H1-06: foco realmente contenido dentro del diálogo -- mismo patrón que la prueba de
    // quality.spec.ts para el diálogo de proyecto, aplicado aquí al diálogo de negocio real.
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus').evaluate((element) => Boolean(element.closest('[role="dialog"]')))).resolves.toBe(true);
    }
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('textbox', { name: 'Nombre de quien acepta' }).fill('Ana López Rivera');
    await page.getByRole('button', { name: 'Aceptar propuesta' }).click();
    await expect(page.locator('.client-quote-action-error').filter({ hasText: 'Confirma que revisaste la propuesta y sus condiciones.' })).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Aceptar propuesta' }).click();
    await expect(page.getByText('Propuesta aceptada.')).toBeVisible();
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'workflow_errors',
      scenarioId: 'accepted-quote',
      actorType: 'CUSTOMER',
      surface: 'customer-portal',
      viewport: 'desktop',
      seedVersion: 'portal-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: measurementStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - measurementStartedAt.getTime(),
      errorCount: 1,
      abandoned: false,
    });
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'portal_access_to_decision',
      scenarioId: 'accepted-quote',
      actorType: 'CUSTOMER',
      surface: 'customer-portal',
      viewport: 'desktop',
      seedVersion: 'portal-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: measurementStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - measurementStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.locator('.client-status')).toHaveText('Aceptada');
    await expect(page.getByRole('heading', { name: 'Conversación del expediente' })).toBeVisible();
    await expect(page.getByText('Hemos revisado el alcance de tu proyecto.')).toBeVisible();
    await expect(page.getByText('Nota interna: validar acabado con ingeniería.')).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Escribe una actualización' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Escribe una actualización' }).fill('Tenemos una duda sobre el acabado final.');
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByText('Tenemos una duda sobre el acabado final.')).toBeVisible();
    await expect.poll(async () => prisma.conversationMessage.count({ where: { body: 'Tenemos una duda sobre el acabado final.' } })).toBe(1);
    await page.reload();
    await expect(page.getByText('Tenemos una duda sobre el acabado final.')).toBeVisible();
    await closeConversation({ userId: employeeId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'messaging.manage']), mfaVerified: true }, requestAId, { prisma, now: new Date(now.getTime() + 1_000) });
    await page.reload();
    await expect(page.getByText('Esta conversación está cerrada.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Escribe una actualización' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
    await expect(page.getByText('Aún no hay archivos.')).toBeVisible();
    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (route.request().method() === 'PUT' && requestUrl.port === '19000') {
        await route.fulfill({ status: 500, body: '' });
        return;
      }
      await route.continue();
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'planos-fallo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') });
    await expect(page.getByRole('button', { name: 'Reintentar carga' })).toBeVisible();
    await page.unroute('**/*');
    await page.getByRole('button', { name: 'Reintentar carga' }).click();
    await expect(page.getByTitle('planos-fallo.pdf')).toBeVisible();
    await expect(page.locator('.client-files__add')).toHaveText('Añadir archivo');
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles({ name: 'planos.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') });
    const uploadedPortalFile = page.locator('.client-file').filter({ hasText: 'planos.pdf' });
    await expect(uploadedPortalFile.getByText('planos.pdf', { exact: true })).toBeVisible();
    await expect(uploadedPortalFile.getByText('Disponible', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('planos.pdf', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Descargar planos.pdf' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors.filter((message) => !message.includes('status of 500 (Internal Server Error)'))).toEqual([]);
    expect(portalPayloads.join('\n')).not.toContain('tokenHash');
    expect(portalPayloads.join('\n')).not.toContain(customerAToken);
    expect(portalPayloads.join('\n')).not.toContain('Portal E2E catálogo actualizado');
    expect(portalPayloads.join('\n')).not.toContain('Nota interna: validar acabado con ingeniería.');
    expect(portalPayloads.join('\n')).not.toContain('storageKey');
    expect(await page.locator('button').evaluateAll((buttons) => buttons.map((button) => button.textContent))).not.toContain('Revisar y aceptar');

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.getByRole('heading', { name: 'Acceso privado.' })).toBeVisible();
  });

  test('renders the no-quote state and recovers from an API failure on mobile', async ({ page }) => {
    await setSession(page, customerBToken);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portal');
    await expect(page.locator('.client-request-row')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Estamos preparando los detalles.' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.route(/\/api\/portal\/requests\/[^/?]+$/u, async (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'No fue posible cargar el expediente.' } }) }));
    await page.reload();
    await expect(page.locator('.client-alert')).toHaveText('No fue posible cargar el expediente.');
    expect(await page.content()).not.toMatch(/stack|prisma|tokenHash/i);
  });

  test('explains an expired quote and completes the conversation next step', async ({ page }) => {
    const employeeActor = { userId: employeeId, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.read', 'quotes.create', 'quotes.send', 'quotes.pdf.generate']), mfaVerified: true };
    const expiredQuote = await createQuoteVersion(employeeActor, { quoteRequestId: requestBId, priceListId, lines: [{ catalogItemId: itemId, quantity: '1', taxBasisPoints: 1600 }], validUntil: new Date('2026-09-02T00:00:00.000Z') }, { prisma, now });
    quoteBId = expiredQuote.quoteId;
    await transitionQuoteVersion(employeeActor, expiredQuote.versionId, 'EN_REVISION', { prisma, now });
    await transitionQuoteVersion(employeeActor, expiredQuote.versionId, 'ENVIADA', { prisma, now });
    await generateQuotePdf(employeeActor, expiredQuote.versionId, { prisma, now });
    await prisma.quoteVersion.update({ where: { id: expiredQuote.versionId }, data: { validUntil: new Date('2026-08-15T00:00:00.000Z') } });
    await setSession(page, customerBToken);
    await page.setViewportSize({ width: 390, height: 844 });
    const measurementStartedAt = new Date();
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();
    await expect(page.getByText('Propuesta vencida', { exact: true })).toBeVisible();
    await expect(page.getByText('Vigencia expirada el 15 ago 2026')).toBeVisible();
    await expect(page.getByText('Propuesta vencida. Solicita cambios para recibir una versión actualizada.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar y aceptar' })).toBeHidden();
    // C1-04: una propuesta vencida usa la misma acción explícita "Solicitar cambios" que cualquier
    // otra, en vez de depender de que el cliente encuentre y use el chat general por su cuenta.
    const message = 'Solicito una actualización de la propuesta vencida.';
    await page.getByRole('button', { name: 'Solicitar cambios' }).click();
    const changeDialog = page.getByRole('dialog', { name: 'Solicitar cambios' });
    await expect(changeDialog).toBeVisible();
    await changeDialog.getByLabel('¿Qué te gustaría ajustar?').fill(message);
    await changeDialog.getByRole('button', { name: 'Enviar solicitud' }).click();
    await expect(changeDialog.getByText('Tu solicitud fue enviada.')).toBeVisible();
    await expect.poll(async () => prisma.conversationMessage.count({ where: { body: { contains: message } } })).toBe(1);
    await changeDialog.getByRole('button', { name: 'Continuar' }).click();
    await expect(changeDialog).toBeHidden();
    await expect(page.getByText(message)).toBeVisible();
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'expired_quote_to_next_step',
      scenarioId: 'expired-version',
      actorType: 'CUSTOMER',
      surface: 'customer-portal',
      viewport: 'mobile',
      seedVersion: 'portal-e2e-v2',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: measurementStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - measurementStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });
  });

  test('records a session abandoned before the next portal task', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const measurementStartedAt = new Date();
    try {
      await setSession(page, customerBToken);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/portal');
      await expect(page.getByText('Propuesta vencida', { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'workflow_abandonment',
      scenarioId: 'expired-version',
      actorType: 'CUSTOMER',
      surface: 'customer-portal',
      viewport: 'mobile',
      seedVersion: 'portal-e2e-v2',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: measurementStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - measurementStartedAt.getTime(),
      errorCount: 0,
      abandoned: true,
    });
  });
});
