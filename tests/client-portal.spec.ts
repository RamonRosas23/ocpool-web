import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('customer portal opt-in flow', () => {
  test.skip(process.env.PORTAL_E2E !== '1', 'Customer portal E2E requires PORTAL_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date('2026-09-01T12:00:00.000Z');
  const origin = 'http://127.0.0.1:3100';
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
  let categoryId = '';
  let itemId = '';
  let priceListId = '';

  test.beforeAll(async () => {
    if (process.env.PORTAL_E2E !== '1') return;

    const [requestA, requestB] = await Promise.all([
      createQuoteRequest({
        idempotencyKey: `portal-e2e-a-${suffix}`,
        origin: 'STAFF_CREATED',
        contact: { displayName: `Portal E2E A ${suffix}`, email: `portal-e2e-a-${suffix}@example.test` },
        detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Expediente E2E con cotización snapshot.', consentAt: now },
      }, { prisma, now }),
      createQuoteRequest({
        idempotencyKey: `portal-e2e-b-${suffix}`,
        origin: 'STAFF_CREATED',
        contact: { displayName: `Portal E2E B ${suffix}`, email: `portal-e2e-b-${suffix}@example.test` },
        detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Expediente E2E sin cotización.', consentAt: now },
      }, { prisma, now }),
    ]);
    requestAId = requestA.quoteRequestId;
    requestBId = requestB.quoteRequestId;
    clientAId = requestA.clientId;
    clientBId = requestB.clientId;
    contactAId = requestA.contactId;
    contactBId = requestB.contactId;

    const [customerA, customerB, employee] = await Promise.all([
      prisma.user.create({ data: { email: `portal-e2e-user-a-${suffix}@example.test`, emailNormalized: `portal-e2e-user-a-${suffix}@example.test`, displayName: 'Portal E2E cliente A', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId } }),
      prisma.user.create({ data: { email: `portal-e2e-user-b-${suffix}@example.test`, emailNormalized: `portal-e2e-user-b-${suffix}@example.test`, displayName: 'Portal E2E cliente B', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientBId } }),
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
    const category = await prisma.catalogCategory.create({ data: { code: `PORTAL-E2E-${suffix}`, name: 'Portal E2E' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `PORTAL-E2E-ITEM-${suffix}`, name: 'Portal E2E snapshot item', unit: 'pieza', categoryId } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `PORTAL-E2E-PRICE-${suffix}`, name: 'Portal E2E prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 30000n, validFrom: now } });

    const employeeActor = { userId: employeeId, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.create', 'quotes.send']), mfaVerified: true };
    const quote = await createQuoteVersion(employeeActor, { quoteRequestId: requestAId, priceListId, lines: [{ catalogItemId: itemId, quantity: '1', taxBasisPoints: 1600 }], validUntil: new Date('2026-10-01T00:00:00.000Z') }, { prisma, now });
    quoteAId = quote.quoteId;
    await transitionQuoteVersion(employeeActor, quote.versionId, 'EN_REVISION', { prisma, now });
    await transitionQuoteVersion(employeeActor, quote.versionId, 'ENVIADA', { prisma, now });
    await prisma.catalogItem.update({ where: { id: itemId }, data: { name: 'Portal E2E catálogo actualizado' } });
  });

  test.afterAll(async () => {
    if (process.env.PORTAL_E2E !== '1') return;
    const requestIds = [requestAId, requestBId];
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: requestIds } } }, select: { id: true } })).map(({ id }) => id);
    await prisma.quote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    const aggregateIds = [...requestIds, ...(quoteAId ? [quoteAId] : [])];
    const entityIds = [...aggregateIds, ...versionIds];
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: [contactAId, contactBId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [customerAUserId, customerBUserId, employeeId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [customerAUserId, customerBUserId, employeeId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } });
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
    const portalPayloads: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', async (response) => {
      if (!response.url().includes('/api/portal/')) return;
      try { portalPayloads.push(await response.text()); } catch { /* response may already be disposed */ }
    });

    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Tu proyecto, en cada etapa.' })).toBeVisible();
    await expect(page.locator('.client-request-row')).toHaveCount(1);
    await expect(page.getByText('Portal E2E snapshot item')).toBeVisible();
    await expect(page.locator('.client-quote__total strong')).toHaveText('MXN 348.00');
    await expect(page.getByText('Vigente hasta 01 oct 2026')).toBeVisible();
    await expect(page.locator('.client-status')).toHaveText('Cotización disponible');
    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    expect(portalPayloads.join('\n')).not.toContain('tokenHash');
    expect(portalPayloads.join('\n')).not.toContain(customerAToken);
    expect(portalPayloads.join('\n')).not.toContain('Portal E2E catálogo actualizado');
    expect(await page.locator('button').evaluateAll((buttons) => buttons.map((button) => button.textContent))).not.toContain('Aceptar');

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
});
