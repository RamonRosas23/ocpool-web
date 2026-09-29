import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('bandeja de avisos por rol', () => {
  test.skip(process.env.INBOX_E2E !== '1', 'Inbox E2E requires INBOX_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'serial' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const salesName = `Ventas QA ${suffix}`;
  const salesToken = `inbox-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const managerToken = `inbox-e2e-manager-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const customerToken = `inbox-e2e-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let managerId = '';
  let customerId = '';

  test.beforeAll(async () => {
    if (process.env.INBOX_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const [salesRole, managerRole, customerRole] = await Promise.all(['sales', 'manager', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    salesId = (await prisma.user.create({ data: { email: `inbox-e2e-sales-${suffix}@example.test`, emailNormalized: `inbox-e2e-sales-${suffix}@example.test`, displayName: salesName, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    managerId = (await prisma.user.create({ data: { email: `inbox-e2e-manager-${suffix}@example.test`, emailNormalized: `inbox-e2e-manager-${suffix}@example.test`, displayName: `Gerencia QA ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `inbox-e2e-${suffix}`, origin: 'PUBLIC_FORM', contact: { displayName: `Cliente QA ${suffix}`, email: `inbox-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca con jacuzzi', location: 'Monterrey', description: 'Fixture de la bandeja de avisos', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    customerId = (await prisma.user.create({ data: { email: `inbox-e2e-customer-${suffix}@example.test`, emailNormalized: `inbox-e2e-customer-${suffix}@example.test`, displayName: `Cliente QA ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'inbox-e2e' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: managerId, ipAddress: null, userAgent: 'inbox-e2e' }, { prisma, tokenGenerator: () => managerToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'inbox-e2e' }, { prisma, tokenGenerator: () => customerToken });
  });

  test.afterAll(async () => {
    if (process.env.INBOX_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [salesId, managerId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, managerId, customerId] } } });
    for (const userId of [salesId, customerId]) await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${userId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, managerId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  async function signIn(page: Page, token: string) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);
  }

  async function openBell(page: Page, name: RegExp) {
    await page.getByRole('button', { name }).click();
    return page.getByRole('dialog', { name: name.source.startsWith('Novedades') ? 'Novedades' : 'Notificaciones' });
  }

  test('Ventas ve la solicitud nueva del sitio y la toma desde la campana', async ({ page }) => {
    await signIn(page, salesToken);
    await page.goto('/staff/requests');
    const panel = await openBell(page, /Notificaciones/);
    const notice = panel.getByRole('listitem').filter({ hasText: 'Nueva solicitud: Alberca con jacuzzi en Monterrey' });
    await expect(notice).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await notice.getByRole('button', { name: 'Tomar' }).click();
    await expect(page.getByText(`Tomaste ${folio}.`)).toBeVisible();
    await expect.poll(async () => (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).currentAssigneeId).toBe(salesId);
  });

  test('Gerencia ve quién la tomó y tiene Entregas de correo; Ventas no', async ({ page }) => {
    await signIn(page, managerToken);
    await page.goto('/staff/notifications');
    await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
    await expect(page.getByText(`Tomada por ${salesName}`).first()).toBeVisible();
    await page.getByRole('link', { name: 'Entregas de correo' }).click();
    await expect(page.getByRole('heading', { name: 'Entregas de correo' })).toBeVisible();

    await signIn(page, salesToken);
    await page.goto('/staff/notifications');
    await expect(page.getByRole('link', { name: 'Entregas de correo' })).toHaveCount(0);
    await page.goto('/staff/notifications/deliveries');
    await expect(page.getByText('Acceso restringido.')).toBeVisible();
  });

  test('dos mensajes del cliente llegan como un solo aviso y se leen al abrir el expediente', async ({ page }) => {
    const customer: Actor = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await sendCustomerMessage(customer, requestId, { body: 'Hola, ¿cómo va la propuesta?', idempotencyKey: `inbox-e2e-1-${suffix}` }, { prisma, rateLimit });
    await sendCustomerMessage(customer, requestId, { body: 'Te comparto las medidas: 8 por 4 metros.', idempotencyKey: `inbox-e2e-2-${suffix}` }, { prisma, rateLimit });
    await signIn(page, salesToken);
    await page.goto('/staff');
    const panel = await openBell(page, /Notificaciones, \d+ sin leer/);
    const notice = panel.getByRole('listitem').filter({ hasText: `Cliente QA ${suffix} te escribió 2 mensajes` });
    await expect(notice).toContainText('Te comparto las medidas: 8 por 4 metros.');
    await notice.getByRole('link', { name: new RegExp(`te escribió 2 mensajes`) }).click();
    await expect(page).toHaveURL(new RegExp(`request=${requestId}`));
    await expect.poll(async () => prisma.inboxNotification.count({ where: { recipientId: salesId, kind: 'customer.activity', readAt: null } })).toBe(0);
  });

  test('el cliente ve la respuesta del equipo en Novedades y en "Desde tu última visita"', async ({ page }) => {
    const sales: Actor = { userId: salesId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send']), mfaVerified: true };
    await sendStaffMessage(sales, requestId, { body: 'Gracias, preparamos la propuesta con esas medidas.', idempotencyKey: `inbox-e2e-staff-${suffix}` }, { prisma, rateLimit });
    await signIn(page, customerToken);
    await page.goto(`/portal?request=${requestId}`);
    await expect(page.getByRole('region', { name: 'Novedades desde tu última visita' })).toContainText('El equipo OCPOOL te escribió');
    await expect.poll(async () => prisma.inboxNotification.count({ where: { recipientId: customerId, readAt: null } })).toBe(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Novedades', exact: true })).toBeVisible();
  });

  test('el panel no desborda en móvil', async ({ page }) => {
    await signIn(page, salesToken);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/staff');
    await openBell(page, /Notificaciones/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
