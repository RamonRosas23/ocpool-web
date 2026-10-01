import 'dotenv/config';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { publishRequestChange } from '@/server/modules/inbox/realtime-signals';
import { createQuoteVersion } from '@/server/modules/quotes/service';
import { listConversationMessages, sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';

test.describe('pantallas en vivo', () => {
  test.skip(process.env.REALTIME_E2E !== '1', 'Realtime E2E requires REALTIME_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'default' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const customerName = `Cliente Pantallas ${suffix}`;
  const salesToken = `screens-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const customerToken = `screens-e2e-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
  let secondaryRequestId = '';
  let quoteId = '';
  let quoteVersionId = '';
  let categoryId = '';
  let catalogItemId = '';
  let priceListId = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let customerId = '';
  let sales: Actor;
  let customer: Actor;
  let sent = 0;

  test.beforeAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all(['sales', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    salesId = (await prisma.user.create({ data: { email: `screens-e2e-sales-${suffix}@example.test`, emailNormalized: `screens-e2e-sales-${suffix}@example.test`, displayName: `Ventas Pantallas ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `screens-e2e-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: customerName, email: `screens-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca con cascada', location: 'Querétaro', description: 'Fixture de pantallas en vivo', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `screens-e2e-customer-${suffix}@example.test`, emailNormalized: `screens-e2e-customer-${suffix}@example.test`, displayName: customerName, type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: salesId, status: 'EN_REVISION' } });
    const secondary = await createQuoteRequest({ idempotencyKey: `screens-e2e-secondary-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: customerName, email: `screens-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Proyecto alterno en vivo', location: 'Puebla', description: 'Segundo fixture para carreras de detalle.', consentAt: now } }, { prisma, now });
    secondaryRequestId = secondary.quoteRequestId;
    sales = { userId: salesId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send']), mfaVerified: true };
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await prisma.quoteRequest.update({ where: { id: secondaryRequestId }, data: { currentAssigneeId: salesId, status: 'EN_ELABORACION' } });
    categoryId = (await prisma.catalogCategory.create({ data: { code: `SCREEN-${suffix}`, name: `Pantalla ${suffix}` } })).id;
    catalogItemId = (await prisma.catalogItem.create({ data: { code: `SCREEN-ITEM-${suffix}`, name: `Artículo en vivo ${suffix}`, unit: 'pieza', categoryId } })).id;
    priceListId = (await prisma.priceList.create({ data: { code: `SCREEN-LIST-${suffix}`, name: `Lista en vivo ${suffix}`, currencyCode: 'MXN', validFrom: now } })).id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId, unitPriceMinor: 10000n, validFrom: now } });
    const quote = await createQuoteVersion({ ...sales, permissionKeys: new Set(['requests.read', 'quotes.create', 'prices.read']) }, { quoteRequestId: secondaryRequestId, priceListId, lines: [{ catalogItemId, quantity: '1' }] }, { prisma, now });
    quoteId = quote.quoteId;
    quoteVersionId = quote.versionId;
    await prisma.quoteVersion.update({ where: { id: quoteVersionId }, data: { status: 'ENVIADA', publishedAt: now } });
    await prisma.quote.update({ where: { id: quoteId }, data: { currentVersionId: quoteVersionId, publishedVersionId: quoteVersionId, workingVersionId: null } });
    await prisma.quoteRequest.update({ where: { id: secondaryRequestId }, data: { status: 'COTIZACION_DISPONIBLE' } });
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'screens-e2e' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'screens-e2e' }, { prisma, tokenGenerator: () => customerToken });
  });

  test.afterAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    const requestIds = [requestId, secondaryRequestId].filter(Boolean);
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: { in: requestIds } }, select: { id: true } });
    const files = await prisma.fileAttachment.findMany({ where: { quoteRequestId: { in: requestIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
    const versionIds = quoteId ? (await prisma.quoteVersion.findMany({ where: { quoteId }, select: { id: true } })).map(({ id }) => id) : [];
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...requestIds, quoteId, ...conversations.map(({ id }) => id), ...files.map(({ id }) => id)].filter(Boolean) } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...requestIds, quoteId, ...versionIds].filter(Boolean) } }, { actorUserId: { in: [salesId, customerId] } }] } });
    await Promise.all(files.map(({ storageObject }) => getPrivateStorage().delete(storageObject.storageKey).catch(() => undefined)));
    await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: files.map(({ storageObjectId }) => storageObjectId) } } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    if (quoteId) await prisma.quote.delete({ where: { id: quoteId } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, customerId] } } });
    for (const userId of [salesId, customerId]) await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${userId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (priceListId) await prisma.priceList.delete({ where: { id: priceListId } });
    if (catalogItemId) await prisma.catalogItem.delete({ where: { id: catalogItemId } });
    if (categoryId) await prisma.catalogCategory.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  const next = () => { sent += 1; return `screens-e2e-${sent}-${suffix}`; };
  const liveOn = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname === '/api/realtime' && response.status() === 200);
  const signIn = (page: Page, token: string) => page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);
  const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  };

  test('el hilo del portal se actualiza solo cuando el equipo responde', async ({ page }) => {
    await signIn(page, customerToken);
    const live = liveOn(page);
    await page.goto(`/portal?request=${requestId}`);
    await live;
    await expect(page.getByRole('heading', { name: 'Conversación del expediente' })).toBeVisible();
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await sendStaffMessage(sales, requestId, { body: 'Ya quedó tu propuesta.', idempotencyKey: next() }, { prisma, rateLimit });
    await expect(page.locator('.client-messaging__list')).toContainText('Ya quedó tu propuesta.', { timeout: 5_000 });
    await expect(page.locator('.thread-divider')).toHaveText('Nuevo');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  });

  test('el equipo ve el mensaje del cliente sin flash y el Visto cuando el cliente lo lee', async ({ page }) => {
    await signIn(page, salesToken);
    const live = liveOn(page);
    await page.goto(`/staff/requests?request=${requestId}`);
    await live;
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await sendCustomerMessage(customer, requestId, { body: 'Perfecto, gracias.', idempotencyKey: next() }, { prisma, rateLimit });
    await expect(page.locator('.staff-messaging__list')).toContainText('Perfecto, gracias.', { timeout: 5_000 });
    const flashes = page.getByRole('region', { name: 'Avisos al momento' });
    await expect(flashes.getByRole('status')).toHaveCount(0);
    await sendStaffMessage(sales, requestId, { body: '¿Agendamos visita?', idempotencyKey: next() }, { prisma, rateLimit });
    await expect(page.locator('.staff-messaging__list')).toContainText('¿Agendamos visita?', { timeout: 5_000 });
    await listConversationMessages(customer, requestId, {}, { prisma });
    await expect(page.locator('.thread-seen')).toContainText('Visto', { timeout: 5_000 });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  });

  test('un archivo que sube el cliente aparece solo en el expediente del equipo', async ({ browser }) => {
    const staffContext = await browser.newContext();
    const customerContext = await browser.newContext();
    try {
      const staffPage = await staffContext.newPage();
      await staffContext.addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
      const live = liveOn(staffPage);
      await staffPage.goto(`/staff/requests?request=${requestId}`);
      await live;
      await expect(staffPage.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
      const customerPage = await customerContext.newPage();
      await customerContext.addCookies([{ name: 'ocpool_session', value: customerToken, url: origin }]);
      await customerPage.goto(`/portal?request=${requestId}`);
      await expect(customerPage.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
      await customerPage.locator('input[type="file"]').setInputFiles({ name: 'planos-en-vivo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') });
      await expect(customerPage.locator('.client-file').filter({ hasText: 'planos-en-vivo.pdf' }).getByText('Disponible', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(staffPage.getByText('planos-en-vivo.pdf').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await staffContext.close();
      await customerContext.close();
    }
  });

  test('un aviso de otro expediente no reemplaza el detalle que el cliente está abriendo', async ({ page }) => {
    await signIn(page, customerToken);
    const live = liveOn(page);
    await page.goto(`/portal?request=${requestId}`);
    await live;
    await expect(page.locator('.client-detail')).toContainText('Querétaro');

    const requestStarted = deferred<void>();
    const releaseRequest = deferred<void>();
    await page.route(`**/api/portal/requests/${secondaryRequestId}`, async (route) => {
      requestStarted.resolve();
      await releaseRequest.promise;
      await route.continue();
    });
    await page.locator('.client-request-row').filter({ hasText: 'Proyecto alterno en vivo' }).click();
    await requestStarted.promise;
    await publishRequestChange(prisma, { requestId, parts: ['status'], visibility: 'C' });
    await page.waitForTimeout(750);
    releaseRequest.resolve();

    await expect(page.locator('.client-request-row').filter({ hasText: 'Proyecto alterno en vivo' })).toHaveClass(/is-selected/);
    await expect(page.locator('.client-detail')).toContainText('Puebla', { timeout: 5_000 });
    await expect(page.locator('.client-detail')).not.toContainText('Querétaro');
  });

  test('un mensaje recibido durante la carga inicial no desaparece al llegar la respuesta anterior del portal', async ({ page }) => {
    await signIn(page, customerToken);
    const live = liveOn(page);
    const initialCaptured = deferred<{ response: APIResponse; body: Buffer }>();
    const releaseInitial = deferred<void>();
    let held = false;
    await page.route(`**/api/portal/requests/${requestId}/messages?*`, async (route) => {
      if (held) { await route.continue(); return; }
      held = true;
      const response = await route.fetch();
      const body = await response.body();
      initialCaptured.resolve({ response, body });
      await releaseInitial.promise;
      await route.fulfill({ response, body });
    });
    await page.goto(`/portal?request=${requestId}`);
    await live;
    await initialCaptured.promise;
    const body = `Respuesta durante la carga portal ${suffix}`;
    const newerResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/portal/requests/${requestId}/messages` && response.request().method() === 'GET');
    await sendStaffMessage(sales, requestId, { body, idempotencyKey: next() }, { prisma, rateLimit });
    await newerResponse;
    releaseInitial.resolve();
    await expect(page.locator('.client-messaging__list')).toContainText(body, { timeout: 5_000 });
  });

  test('un mensaje recibido durante la carga inicial no desaparece al llegar la respuesta anterior del equipo', async ({ page }) => {
    await signIn(page, salesToken);
    const live = liveOn(page);
    const initialCaptured = deferred<{ response: APIResponse; body: Buffer }>();
    const releaseInitial = deferred<void>();
    let held = false;
    await page.route(`**/api/staff/quote-requests/${requestId}/messages?*`, async (route) => {
      if (held) { await route.continue(); return; }
      held = true;
      const response = await route.fetch();
      const body = await response.body();
      initialCaptured.resolve({ response, body });
      await releaseInitial.promise;
      await route.fulfill({ response, body });
    });
    await page.goto(`/staff/requests?request=${requestId}`);
    await live;
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    await initialCaptured.promise;
    const body = `Mensaje durante la carga del equipo ${suffix}`;
    const newerResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/staff/quote-requests/${requestId}/messages` && response.request().method() === 'GET');
    await sendCustomerMessage(customer, requestId, { body, idempotencyKey: next() }, { prisma, rateLimit });
    await newerResponse;
    releaseInitial.resolve();
    await expect(page.locator('.staff-messaging__list')).toContainText(body, { timeout: 5_000 });
  });

  test('una pestaña oculta del portal no marca como leído el mensaje que no se ha visto', async ({ page }) => {
    await signIn(page, customerToken);
    const live = liveOn(page);
    await page.goto(`/portal?request=${requestId}`);
    await live;
    await expect(page.getByRole('heading', { name: 'Conversación del expediente' })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
    const sentMessage = await sendStaffMessage(sales, requestId, { body: `Sólo debe leerse al volver ${suffix}`, idempotencyKey: next() }, { prisma, rateLimit });
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { quoteRequestId: requestId }, select: { id: true } });
    await page.waitForTimeout(1_000);
    const readWhileHidden = await prisma.conversationReadState.findUnique({ where: { conversationId_userId: { conversationId: conversation.id, userId: customerId } }, select: { lastReadMessageId: true } });
    expect(readWhileHidden?.lastReadMessageId).not.toBe(sentMessage.id);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await prisma.conversationReadState.findUnique({ where: { conversationId_userId: { conversationId: conversation.id, userId: customerId } }, select: { lastReadMessageId: true } }))?.lastReadMessageId).toBe(sentMessage.id);
  });

  test('el constructor conserva la nueva versión que se está editando ante una señal remota', async ({ page }) => {
    await signIn(page, salesToken);
    const live = liveOn(page);
    await page.goto(`/staff/quotes?request=${secondaryRequestId}`);
    await live;
    const quantity = page.getByRole('textbox', { name: `Cantidad de Artículo en vivo ${suffix}` });
    await expect(quantity).toHaveValue('1');
    await quantity.fill('2');

    await publishRequestChange(prisma, { requestId: secondaryRequestId, parts: ['quote'], visibility: 'I' });
    await expect(page.getByRole('status').filter({ hasText: 'Hay cambios nuevos en esta cotización' })).toBeVisible({ timeout: 5_000 });
    await expect(quantity).toHaveValue('2');
  });

  test('una señal propia refresca el expediente abierto en las demás pestañas del equipo', async ({ context }) => {
    await context.addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
    const first = await context.newPage();
    const second = await context.newPage();
    const eitherPageLive = Promise.any([liveOn(first), liveOn(second)]);
    await Promise.all([first.goto(`/staff/requests?request=${requestId}`), second.goto(`/staff/requests?request=${requestId}`)]);
    await eitherPageLive;
    await expect.poll(async () => Promise.all([first, second].map((page) => page.evaluate(async () => (await navigator.locks.query()).pending?.some((lock) => lock.name === 'ocpool-realtime') ?? false))).then((pending) => pending.some(Boolean))).toBe(true);
    await expect(first.locator('.staff-detail__header .staff-status-pill')).toHaveText('En revisión');
    await expect(second.locator('.staff-detail__header .staff-status-pill')).toHaveText('En revisión');

    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'COTIZACION_DISPONIBLE' } });
    await publishRequestChange(prisma, { requestId, parts: ['status'], visibility: 'I', actorId: salesId });
    await expect(first.locator('.staff-detail__header .staff-status-pill')).toHaveText('Cotización disponible', { timeout: 5_000 });
    await expect(second.locator('.staff-detail__header .staff-status-pill')).toHaveText('Cotización disponible', { timeout: 5_000 });
  });
});
