import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession, revokeAllUserSessions } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { sendCustomerMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('avisos en tiempo real', () => {
  test.skip(process.env.REALTIME_E2E !== '1', 'Realtime E2E requires REALTIME_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'serial' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const customerName = `Cliente RT ${suffix}`;
  const salesToken = `realtime-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let customerId = '';
  let customer: Actor;
  let sent = 0;

  test.beforeAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all(['sales', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    salesId = (await prisma.user.create({ data: { email: `realtime-e2e-sales-${suffix}@example.test`, emailNormalized: `realtime-e2e-sales-${suffix}@example.test`, displayName: `Ventas RT ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    // Creada por el equipo: no avisa al pool de la base compartida.
    const request = await createQuoteRequest({ idempotencyKey: `realtime-e2e-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: customerName, email: `realtime-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Hermosillo', description: 'Fixture de tiempo real', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `realtime-e2e-customer-${suffix}@example.test`, emailNormalized: `realtime-e2e-customer-${suffix}@example.test`, displayName: customerName, type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: salesId, status: 'EN_REVISION' } });
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'realtime-e2e' }, { prisma, tokenGenerator: () => salesToken });
  });

  test.afterAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [salesId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, customerId] } } });
    await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${customerId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  const customerWrites = async (body: string) => {
    sent += 1;
    await sendCustomerMessage(customer, requestId, { body, idempotencyKey: `realtime-e2e-${sent}-${suffix}` }, { prisma, rateLimit });
  };
  const isRealtime = (url: string) => new URL(url).pathname === '/api/realtime';
  // El canal está listo cuando llegan sus encabezados: la conexión ya quedó registrada en el servidor.
  const liveOn = (page: Page) => page.waitForResponse((response) => isRealtime(response.url()) && response.status() === 200);
  const flashes = (page: Page) => page.getByRole('region', { name: 'Avisos al momento' });

  test('el equipo ve el contador y el flash en menos de 5 s, sin recargar', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
    const live = liveOn(page);
    await page.goto('/staff');
    await live;
    await customerWrites('Te comparto las medidas finales del terreno.');
    const flash = flashes(page).getByRole('status').filter({ hasText: `${customerName} te escribió` });
    await expect(flash).toBeVisible({ timeout: 5_000 });
    await expect(flash).toContainText('Te comparto las medidas finales del terreno.');
    await expect(page.getByRole('button', { name: /Notificaciones, \d+ sin leer/ })).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveTitle(/^\(\d+\) /);
    await expectNoSeriousA11yViolations(page);
    await flash.getByRole('button', { name: /Cerrar aviso/ }).click();
    await expect(flash).toHaveCount(0);
  });

  test('dos pestañas comparten una conexión y una lectura limpia ambas', async ({ context }) => {
    await context.addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
    const first = await context.newPage();
    const second = await context.newPage();
    const opened: string[] = [];
    for (const [name, page] of [['first', first], ['second', second]] as const) page.on('request', (request) => { if (isRealtime(request.url())) opened.push(name); });
    const live = liveOn(first);
    await first.goto('/staff');
    await live;
    await second.goto('/staff/notifications');
    // La segunda pestaña ya escucha cuando espera su turno por el candado: nunca abre una segunda conexión.
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.some((lock) => lock.name === 'ocpool-realtime') ?? false)).toBe(true);
    expect(opened).toEqual(['first']);
    await customerWrites('¿Ya tienen la propuesta?');
    // Le llega por la pestaña que tiene la conexión.
    await expect(flashes(second).getByRole('status').filter({ hasText: `${customerName} te escribió 2 mensajes` })).toBeVisible({ timeout: 5_000 });
    await expect(flashes(first).getByRole('status').filter({ hasText: `${customerName} te escribió 2 mensajes` })).toBeVisible({ timeout: 5_000 });
    await second.getByRole('button', { name: /Notificaciones, \d+ sin leer/ }).click();
    await second.getByRole('dialog', { name: 'Notificaciones' }).getByRole('button', { name: 'Marcar todo como leído' }).click();
    await expect(first.getByRole('button', { name: 'Notificaciones', exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(first).not.toHaveTitle(/^\(\d+\) /);
  });

  test('en teléfono el flash ocupa el ancho sin desbordar', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
    await page.setViewportSize({ width: 390, height: 844 });
    const live = liveOn(page);
    await page.goto('/staff');
    await live;
    await customerWrites('Mensaje desde el teléfono.');
    const flash = flashes(page).getByRole('status').filter({ hasText: customerName });
    await expect(flash).toBeVisible({ timeout: 5_000 });
    // Se mide la pila (la tarjeta entra deslizándose y su caja incluye esa animación): 16 px por lado.
    const box = await flashes(page).boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(15);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('una sesión revocada sale al momento a la pantalla de acceso', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
    const live = liveOn(page);
    await page.goto('/staff');
    await live;
    await revokeAllUserSessions(salesId, { prisma });
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 5_000 });
  });
});
