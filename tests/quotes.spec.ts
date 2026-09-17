import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { hashPassword } from '@/server/auth/crypto';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { expectNoSeriousA11yViolations } from './a11y';
import { recordBaselineMeasurement } from './fixtures/commercial-baseline-recorder';

test.describe('staff quote builder opt-in flow', () => {
  test.skip(process.env.QUOTES_E2E !== '1', 'Quote builder E2E requires QUOTES_E2E=1 and a disposable local database.');
  test.setTimeout(120_000);

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const email = `quotes-e2e-${suffix}@example.test`;
  const password = 'QuotesE2EEmployeePassword123!';
  const approverEmail = `quotes-e2e-approver-${suffix}@example.test`;
  const approverPassword = 'QuotesE2EApproverPassword123!';
  const now = new Date('2026-03-12T12:00:00.000Z');
  let userId = '';
  let approverId = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let categoryId = '';
  let itemId = '';
  let itemIds: string[] = [];
  let priceListId = '';

  test.beforeAll(async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: { email, emailNormalized: email, displayName: 'Quote builder E2E', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: managerRole.id } } },
    });
    userId = user.id;
    const approver = await prisma.user.create({
      data: { email: approverEmail, emailNormalized: approverEmail, displayName: 'Quote approval E2E', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(approverPassword), roles: { create: { roleId: managerRole.id } } },
    });
    approverId = approver.id;
    const request = await createQuoteRequest({
      idempotencyKey: `quotes-e2e-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote builder client ${suffix}`, email: `quotes-e2e-client-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Quote builder E2E fixture', consentAt: now },
    }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'EN_ELABORACION' } });
    const category = await prisma.catalogCategory.create({ data: { code: `E2E-${suffix}`, name: 'E2E quotes' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `000-E2E-ITEM-${suffix}`, name: '000 E2E concept', unit: 'pieza', categoryId } });
    itemId = item.id;
    const additionalItems = await Promise.all(Array.from({ length: 9 }, (_, index) => prisma.catalogItem.create({
      data: { code: `000-E2E-ITEM-${suffix}-${String(index + 2).padStart(2, '0')}`, name: `000 E2E concept ${String(index + 2).padStart(2, '0')}`, unit: 'pieza', categoryId },
    })));
    itemIds = [itemId, ...additionalItems.map(({ id }) => id)];
    // Extra concepts (sorted well after "000 E2E concept*") prove the K1-01 search reaches past the old 50-item cap.
    const fillerItems = await Promise.all(Array.from({ length: 44 }, (_, index) => prisma.catalogItem.create({
      data: { code: `E2E-FILL-${suffix}-${String(index + 1).padStart(2, '0')}`, name: `999 E2E filler ${String(index + 1).padStart(2, '0')}`, unit: 'pieza', categoryId },
    })));
    const lateItem = await prisma.catalogItem.create({ data: { code: `E2E-LATE-${suffix}`, name: '999 E2E late concept', unit: 'pieza', categoryId } });
    itemIds = [...itemIds, ...fillerItems.map(({ id }) => id), lateItem.id];
    const priceList = await prisma.priceList.create({ data: { code: `E2E-PRICE-${suffix}`, name: 'E2E prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.createMany({ data: itemIds.map((catalogItemId) => ({ priceListId, catalogItemId, unitPriceMinor: 15000n, validFrom: now })) });
  });

  test.afterAll(async () => {
    if (!requestId) {
      await prisma.$disconnect();
      return;
    }
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: requestId } }, select: { id: true } })).map(({ id }) => id);
    const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
    const storage = getPrivateStorage();
    for (const document of documents) if (document.storageObject?.storageKey) await storage.delete(document.storageObject.storageKey);
    await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: (await prisma.quote.findMany({ where: { quoteRequestId: requestId }, select: { id: true } })).map(({ id }) => id) } } });
    await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: documents.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });
    await prisma.quote.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestId, ...versionIds] } } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.priceListItem.deleteMany({ where: { priceListId } });
    await prisma.priceList.delete({ where: { id: priceListId } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.catalogCategory.delete({ where: { id: categoryId } });
    if (approverId) await prisma.session.deleteMany({ where: { userId: approverId } });
    if (approverId) await prisma.user.delete({ where: { id: approverId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('moves a request from draft to review and sent version through the UI', async ({ page, request }) => {
    const consoleErrors: string[] = [];
    const staffPayloads: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', async (response) => {
      if (!response.url().includes('/api/staff/quotes/')) return;
      try { staffPayloads.push(await response.text()); } catch { /* response may already be disposed */ }
    });
    const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
    const login = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email, password } });
    expect(login.status()).toBe(200);
    const rawCookie = login.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
    expect(rawCookie).toBeTruthy();
    await page.context().addCookies([{ name: 'ocpool_session', value: rawCookie!, url: origin }]);

    await page.goto(`/staff/quotes?request=${requestId}`);
    await expect(page.getByRole('heading', { name: new RegExp(`OCQ-\\d{4}-\\d{6}`) })).toBeVisible();
    await page.getByRole('combobox', { name: 'Lista de precios' }).click();
    await page.getByRole('option', { name: 'E2E prices · MXN', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Vigencia hasta' });
    await page.getByRole('button', { name: 'Abrir calendario: Vigencia hasta' }).click();
    await expect(calendar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(calendar).toBeHidden();
    const tenConceptsStartedAt = new Date();
    await page.getByRole('combobox', { name: 'Agregar concepto a la cotización' }).click();
    await page.getByRole('option', { name: '000 E2E concept · pieza', exact: true }).click();
    for (let index = 2; index <= 10; index += 1) {
      const label = `000 E2E concept ${String(index).padStart(2, '0')} · pieza`;
      await page.getByRole('combobox', { name: 'Agregar concepto a la cotización' }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
    }
    await expect(page.locator('.quotes-line')).toHaveCount(10);

    // K1-01 acceptance: a concept beyond the old 50-item cap (position 56 of 56) is reachable by search text.
    await page.getByRole('combobox', { name: 'Agregar concepto a la cotización' }).fill('late concept');
    await page.getByRole('option', { name: '999 E2E late concept · pieza', exact: true }).click();
    await expect(page.locator('.quotes-line')).toHaveCount(11);
    await page.getByRole('button', { name: 'Quitar 999 E2E late concept' }).click();
    await expect(page.locator('.quotes-line')).toHaveCount(10);

    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'add_ten_concepts',
      scenarioId: 'draft-quote',
      actorType: 'SALES',
      surface: 'staff-quotes',
      viewport: 'desktop',
      seedVersion: 'quotes-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: tenConceptsStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - tenConceptsStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });
    const draftStartedAt = new Date();
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.locator('.private-toast').last()).toContainText(/Borrador actualizado|Nueva versión creada/, { timeout: 10_000 });
    await expect(page.locator('.quotes-request-row.is-selected')).toContainText('Quote builder client', { timeout: 10_000 });
    const draftVersion = await prisma.quoteVersion.findFirst({ where: { quote: { quoteRequestId: requestId }, status: 'BORRADOR' }, orderBy: { versionNumber: 'desc' }, select: { id: true } });
    expect(draftVersion).not.toBeNull();
    const staffActor = { userId, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.read', 'quotes.pdf.generate']), mfaVerified: true };
    const publishStartedAt = new Date();
    await page.getByRole('button', { name: 'Pasar a revisión' }).click();
    await expect(page.locator('.private-toast').last()).toContainText('revisión', { timeout: 10_000 });
    await expect(page.locator('.quotes-request-row.is-selected')).toContainText('Quote builder client', { timeout: 10_000 });
    const pdfRecoveryStartedAt = new Date();
    const reviewVersion = await prisma.quoteVersion.findFirst({ where: { id: draftVersion!.id, status: 'EN_REVISION' }, select: { id: true } });
    expect(reviewVersion).not.toBeNull();
    await expect(generateQuotePdf(staffActor, reviewVersion!.id, { prisma, renderer: async () => { throw new Error('synthetic PDF failure'); } })).rejects.toThrow('No fue posible preparar el PDF');
    await page.reload();
    await expect(page.locator('.quote-document-status')).toHaveText(/Requiere reintento/);
    await page.getByRole('button', { name: 'Reintentar PDF' }).click();
    await expect(page.locator('.quote-document-status')).toHaveText(/Listo para compartir/, { timeout: 10_000 });
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'document_failure_to_recovery',
      scenarioId: 'pdf-failed',
      actorType: 'SALES',
      surface: 'staff-quotes',
      viewport: 'desktop',
      seedVersion: 'quotes-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: pdfRecoveryStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - pdfRecoveryStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });
    await prisma.priceListItem.updateMany({ where: { priceListId, catalogItemId: itemId }, data: { unitPriceMinor: 25_000n } });
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Precio de 000 E2E concept', exact: true })).toHaveValue('150.00', { timeout: 10_000 });
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'request_to_draft',
      scenarioId: 'draft-quote',
      actorType: 'SALES',
      surface: 'staff-quotes',
      viewport: 'desktop',
      seedVersion: 'quotes-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: draftStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - draftStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });
    await page.getByRole('button', { name: 'Enviar cotización' }).click();
    await expect(page.locator('.private-toast').last()).toContainText('enviada', { timeout: 10_000 });
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'publish_quote',
      scenarioId: 'publish-quote',
      actorType: 'SALES',
      surface: 'staff-quotes',
      viewport: 'desktop',
      seedVersion: 'quotes-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: publishStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - publishStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });
    await expect(page.getByRole('heading', { name: 'PDF y aceptación · V1' })).toBeVisible();
    await expect(page.locator('.quote-document-status')).toHaveText(/Listo para compartir/);
    const pdfResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/staff/quotes/versions/`) && response.url().endsWith('/pdf') && response.request().method() === 'GET');
    const pdfPopupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Descargar PDF' }).click();
    const [pdfResponse, pdfPopup] = await Promise.all([pdfResponsePromise, pdfPopupPromise]);
    expect((await pdfResponse.json() as { downloadUrl: string }).downloadUrl).toContain('X-Amz-');
    await pdfPopup.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.quotes-request-row.is-selected')).toContainText('Quote builder client', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'PDF y aceptación · V1' })).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    expect(staffPayloads.join('\n')).not.toContain('storageKey');
    expect(staffPayloads.join('\n')).not.toContain('sha256');

    const newWorkingStartedAt = new Date();
    await page.getByRole('button', { name: 'Crear nueva versión' }).click();
    await expect(page.locator('.private-toast').last()).toContainText('Nueva versión creada como borrador.', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Versión 2 · Borrador' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Precio de 000 E2E concept', exact: true })).toHaveValue('150.00', { timeout: 10_000 });
    await expect(page.locator('.quotes-history')).toContainText('V1');
    await expect(page.locator('.quotes-history')).toContainText('Enviada');
    await recordBaselineMeasurement({
      schemaVersion: 1,
      metricId: 'published_to_new_working',
      scenarioId: 'new-working-version',
      actorType: 'SALES',
      surface: 'staff-quotes',
      viewport: 'mobile',
      seedVersion: 'quotes-e2e-v1',
      commit: process.env.BASELINE_COMMIT ?? 'workspace',
      startedAt: newWorkingStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - newWorkingStartedAt.getTime(),
      errorCount: 0,
      abandoned: false,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    const approvalStartedAt = new Date();
    await page.getByRole('textbox', { name: 'Descuento de 000 E2E concept', exact: true }).fill('5');

    // K1-05: a special concept line (no catalogItemId) recalculates the total and needs its
    // own SPECIAL_CONCEPT approval, alongside the discount approval, before the version can send.
    await page.getByRole('button', { name: 'Agregar concepto especial' }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Ajuste especial E2E');
    await page.getByLabel('Unidad', { exact: true }).fill('servicio');
    await page.getByRole('textbox', { name: 'Importe del concepto especial', exact: true }).fill('500.00');
    await page.getByLabel('Motivo', { exact: true }).fill('Condición de sitio no catalogada');
    await page.getByRole('button', { name: 'Agregar a la propuesta' }).click();
    await expect(page.getByLabel('Nombre del concepto especial')).toHaveValue('Ajuste especial E2E');
    await expect(page.locator('.quotes-line--special')).toContainText('Condición de sitio no catalogada');
    await expect(page.locator('.quotes-summary__total')).not.toContainText('Revisa las líneas');

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await expect(page.locator('.private-toast').last()).toContainText('Borrador actualizado.', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Pasar a revisión' }).click();
    await expect(page.locator('.private-toast').last()).toContainText('revisión', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Solicitar aprobación', exact: true }).click();
    await expect(page.locator('.private-toast').last()).toContainText('Aprobación solicitada', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Solicitar aprobación de concepto especial' }).click();
    await expect(page.locator('.private-toast').last()).toContainText('Aprobación solicitada', { timeout: 10_000 });

    const browser = page.context().browser();
    expect(browser).not.toBeNull();
    const approverContext = await browser!.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    try {
      const approverLogin = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email: approverEmail, password: approverPassword } });
      expect(approverLogin.status()).toBe(200);
      const approverCookie = approverLogin.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
      expect(approverCookie).toBeTruthy();
      await approverContext.addCookies([{ name: 'ocpool_session', value: approverCookie!, url: origin }]);
      const approverPage = await approverContext.newPage();
      await approverPage.goto(`/staff/quotes?request=${requestId}`);
      await expect(approverPage.getByRole('heading', { name: /OCQ-\d{4}-\d{6}/u })).toBeVisible();
      await expect(approverPage.getByRole('button', { name: 'Aprobar descuento' })).toBeVisible({ timeout: 10_000 });
      await approverPage.getByRole('button', { name: 'Aprobar descuento' }).click();
      await expect(approverPage.locator('.private-toast').last()).toContainText('Descuento aprobado', { timeout: 10_000 });
      await expect(approverPage.getByRole('button', { name: 'Aprobar concepto especial' })).toBeVisible({ timeout: 10_000 });
      await approverPage.getByRole('button', { name: 'Aprobar concepto especial' }).click();
      await expect(approverPage.locator('.private-toast').last()).toContainText('Concepto especial aprobado', { timeout: 10_000 });
      await approverPage.getByRole('button', { name: 'Enviar cotización' }).click();
      await expect(approverPage.locator('.private-toast').last()).toContainText('enviada', { timeout: 10_000 });
      await recordBaselineMeasurement({
        schemaVersion: 1,
        metricId: 'draft_to_approval_resolution',
        scenarioId: 'approval-required',
        actorType: 'MANAGER',
        surface: 'staff-quotes',
        viewport: 'desktop',
        seedVersion: 'quotes-e2e-v1',
        commit: process.env.BASELINE_COMMIT ?? 'workspace',
        startedAt: approvalStartedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - approvalStartedAt.getTime(),
        errorCount: 0,
        abandoned: false,
      });
    } finally {
      await approverContext.close();
    }
  });
});
