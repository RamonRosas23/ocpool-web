import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { hashPassword } from '@/server/auth/crypto';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff quote builder opt-in flow', () => {
  test.skip(process.env.QUOTES_E2E !== '1', 'Quote builder E2E requires QUOTES_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const email = `quotes-e2e-${suffix}@example.test`;
  const password = 'QuotesE2EEmployeePassword123!';
  const now = new Date('2026-03-12T12:00:00.000Z');
  let userId = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let categoryId = '';
  let itemId = '';
  let priceListId = '';

  test.beforeAll(async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: { email, emailNormalized: email, displayName: 'Quote builder E2E', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: managerRole.id } } },
    });
    userId = user.id;
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
    const item = await prisma.catalogItem.create({ data: { code: `E2E-ITEM-${suffix}`, name: 'E2E concept', unit: 'pieza', categoryId } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `E2E-PRICE-${suffix}`, name: 'E2E prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 15000n, validFrom: now } });
  });

  test.afterAll(async () => {
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
    await prisma.catalogItem.delete({ where: { id: itemId } });
    await prisma.catalogCategory.delete({ where: { id: categoryId } });
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
    const login = await request.post('/api/auth/employee/login', { headers: { origin: 'http://127.0.0.1:3100' }, data: { email, password } });
    expect(login.status()).toBe(200);
    const rawCookie = login.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
    expect(rawCookie).toBeTruthy();
    await page.context().addCookies([{ name: 'ocpool_session', value: rawCookie!, url: 'http://127.0.0.1:3100' }]);

    await page.goto(`/staff/quotes?request=${requestId}`);
    await expect(page.getByRole('heading', { name: new RegExp(`OCQ-\\d{4}-\\d{6}`) })).toBeVisible();
    await page.getByLabel('Lista de precios').selectOption(priceListId);
    await page.locator('.quotes-add-line select').selectOption(itemId);
    await page.getByRole('button', { name: 'Agregar línea' }).click();
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.locator('p.staff-notice')).toContainText(/Borrador actualizado|Nueva versión creada/, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Pasar a revisión' }).click();
    await expect(page.locator('p.staff-notice')).toContainText('revisión', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Enviar cotización' }).click();
    await expect(page.locator('p.staff-notice')).toContainText('enviada', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'PDF y aceptación · V1' })).toBeVisible();
    await expect(page.locator('.quote-document-status')).toHaveText(/Aún no generado/);
    await page.getByRole('button', { name: 'Generar PDF' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'PDF comercial generado y verificado.' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.quote-document-status')).toHaveText(/Listo para compartir/);
    const pdfResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/staff/quotes/versions/`) && response.url().endsWith('/pdf') && response.request().method() === 'GET');
    const pdfPopupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Descargar PDF' }).click();
    const [pdfResponse, pdfPopup] = await Promise.all([pdfResponsePromise, pdfPopupPromise]);
    expect((await pdfResponse.json() as { downloadUrl: string }).downloadUrl).toContain('X-Amz-');
    await pdfPopup.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'PDF y aceptación · V1' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    expect(staffPayloads.join('\n')).not.toContain('storageKey');
    expect(staffPayloads.join('\n')).not.toContain('sha256');
  });
});
