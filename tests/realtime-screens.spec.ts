import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { listConversationMessages, sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';

test.describe('pantallas en vivo', () => {
  test.skip(process.env.REALTIME_E2E !== '1', 'Realtime E2E requires REALTIME_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'serial' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const customerName = `Cliente Pantallas ${suffix}`;
  const salesToken = `screens-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const customerToken = `screens-e2e-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
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
    sales = { userId: salesId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send']), mfaVerified: true };
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'screens-e2e' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'screens-e2e' }, { prisma, tokenGenerator: () => customerToken });
  });

  test.afterAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    const files = await prisma.fileAttachment.findMany({ where: { quoteRequestId: requestId }, select: { id: true, storageObjectId: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id), ...files.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [salesId, customerId] } }] } });
    await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.storageObject.deleteMany({ where: { id: { in: files.map(({ storageObjectId }) => storageObjectId) } } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, customerId] } } });
    for (const userId of [salesId, customerId]) await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${userId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  const next = () => { sent += 1; return `screens-e2e-${sent}-${suffix}`; };
  const liveOn = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname === '/api/realtime' && response.status() === 200);
  const signIn = (page: Page, token: string) => page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);

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
});
