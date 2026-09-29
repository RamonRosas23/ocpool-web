import 'dotenv/config';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { hashPassword } from '@/server/auth/crypto';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

test.describe('quote builder: concepts por cotizar', () => {
  test.skip(process.env.QUOTES_E2E !== '1', 'Quote builder E2E requires QUOTES_E2E=1 and a disposable local database.');
  test.setTimeout(180_000);

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const password = 'PendingPriceE2EPassword123!';
  const managerEmail = `pending-price-manager-${suffix}@example.test`;
  const salesEmail = `pending-price-sales-${suffix}@example.test`;
  const now = new Date('2026-03-12T12:00:00.000Z');
  const userIds: string[] = [];
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  let categoryId = '';
  let priceListId = '';
  const itemIds = { listed: '', flow: '', convert: '' };

  async function newRequest(label: string, assigneeId: string): Promise<{ id: string; folio: string }> {
    const request = await createQuoteRequest({
      idempotencyKey: `pending-price-e2e-${suffix}-${label}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Pending price ${label} ${suffix}`, email: `pending-price-${label}-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: `Pending price ${label} fixture`, consentAt: now },
    }, { prisma, now });
    requestIds.push(request.quoteRequestId); clientIds.push(request.clientId); contactIds.push(request.contactId);
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: assigneeId } });
    return { id: request.quoteRequestId, folio: request.folio };
  }

  test.beforeAll(async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const manager = await prisma.user.create({ data: { email: managerEmail, emailNormalized: managerEmail, displayName: 'Pending price manager', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: managerRole.id } } } });
    const sales = await prisma.user.create({ data: { email: salesEmail, emailNormalized: salesEmail, displayName: 'Pending price sales', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: salesRole.id } } } });
    userIds.push(manager.id, sales.id);
    categoryId = (await prisma.catalogCategory.create({ data: { code: `PP-E2E-${suffix}`, name: 'Pending price E2E' } })).id;
    const listed = await prisma.catalogItem.create({ data: { code: `PP-LISTED-${suffix}`, name: 'PP concepto con precio', unit: 'pieza', categoryId } });
    const flow = await prisma.catalogItem.create({ data: { code: `PP-FLOW-${suffix}`, name: 'PP concepto flujo', unit: 'servicio', categoryId } });
    const convert = await prisma.catalogItem.create({ data: { code: `PP-CONVERT-${suffix}`, name: 'PP concepto convertir', unit: 'lote', categoryId } });
    itemIds.listed = listed.id; itemIds.flow = flow.id; itemIds.convert = convert.id;
    priceListId = (await prisma.priceList.create({ data: { code: `PP-PRICE-${suffix}`, name: 'PP prices', currencyCode: 'MXN', validFrom: now } })).id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: listed.id, unitPriceMinor: 15_000n, validFrom: now } });
  });

  test.afterAll(async () => {
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: requestIds } } }, select: { id: true } })).map(({ id }) => id);
    await prisma.quote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...requestIds, priceListId] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...requestIds, ...versionIds] } }, { action: { startsWith: 'prices.item' }, actorUserId: { in: userIds } }] } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.priceListItem.deleteMany({ where: { priceListId } });
    await prisma.priceList.deleteMany({ where: { id: priceListId } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: Object.values(itemIds) } } });
    await prisma.catalogCategory.deleteMany({ where: { id: categoryId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function login(page: Page, request: APIRequestContext, email: string) {
    const response = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email, password } });
    expect(response.status()).toBe(200);
    const rawCookie = response.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
    expect(rawCookie).toBeTruthy();
    await page.context().addCookies([{ name: 'ocpool_session', value: rawCookie!, url: origin }]);
  }

  async function openBuilder(page: Page, requestId: string) {
    await page.goto(`/staff/quotes?request=${requestId}`);
    await expect(page.getByRole('heading', { name: /OCQ-\d{4}-\d{6}/ })).toBeVisible({ timeout: 45_000 });
  }

  test('a seller leaves a concept por cotizar, the manager assigns its price and the quote applies it by itself', async ({ page, request, browser }) => {
    const sales = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: salesEmail }, select: { id: true } });
    const { id: requestId, folio } = await newRequest('flow', sales.id);

    // Ventas: agrega un concepto con precio y otro sin precio, que deja por cotizar.
    await login(page, request, salesEmail);
    await openBuilder(page, requestId);
    await page.getByRole('combobox', { name: 'Lista de precios' }).click();
    await page.getByRole('option', { name: 'PP prices · MXN', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Agregar concepto a la cotización' });
    await search.fill('concepto con precio');
    await page.getByRole('option', { name: 'PP concepto con precio · pieza', exact: true }).click();
    await search.fill('concepto flujo');
    await page.getByRole('option', { name: 'PP concepto flujo · servicio', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Concepto sin precio' });
    await dialog.getByRole('button', { name: 'Agregar como por cotizar' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const pendingLine = page.locator('.quotes-line', { hasText: 'PP concepto flujo' });
    await expect(pendingLine).toContainText('Por cotizar');
    await expect(pendingLine.locator('.quotes-line__total')).toHaveText('—');
    await expect(page.locator('.quotes-manual-note--pending')).toContainText('1 concepto por cotizar');
    await expect(page.locator('.quotes-next')).toContainText('Faltan precios por definir');
    await expect(page.locator('.quotes-summary__total')).toContainText('174.00');
    await expect(page.locator('#quotes-actions').getByRole('button', { name: 'Pasar a revisión' })).toBeDisabled();
    await expect(page.locator('.quotes-autosave--saved')).toBeVisible({ timeout: 20_000 });
    expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { catalogItemId: itemIds.flow, quoteVersion: { quote: { quoteRequestId: requestId } } } })).toMatchObject({ pricePending: true, unitPriceMinor: 0n });

    // Al reabrir la propuesta con el concepto todavía sin precio se conserva la lista y el concepto sigue por cotizar.
    await page.reload();
    await expect(page.getByRole('heading', { name: /OCQ-\d{4}-\d{6}/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('combobox', { name: 'Lista de precios' })).toContainText('PP prices', { timeout: 20_000 });
    await expect(page.locator('.quotes-line', { hasText: 'PP concepto flujo' })).toContainText('Por cotizar');
    await expect(page.locator('.quotes-manual-note--pending')).toContainText('1 concepto por cotizar');

    // Gerencia: lo ve en Catálogo → Precios por asignar y le pone precio a la lista.
    const managerContext = await browser.newContext({ baseURL: origin });
    try {
      const managerPage = await managerContext.newPage();
      await login(managerPage, managerContext.request, managerEmail);
      // El tablero de gerencia avisa que hay un precio esperando y lleva directo a asignarlo.
      await managerPage.goto('/staff');
      const dashboardCard = managerPage.locator('.staff-workqueue__card', { hasText: 'Precios por asignar' });
      await expect(dashboardCard).toContainText('PP concepto flujo', { timeout: 45_000 });
      await dashboardCard.getByRole('link', { name: /PP concepto flujo/ }).click();
      await expect(managerPage).toHaveURL(/\/staff\/catalog\?tab=pending-prices/, { timeout: 45_000 });
      const row = managerPage.locator('.catalog-pending-price', { hasText: 'PP concepto flujo' });
      await expect(row).toBeVisible({ timeout: 45_000 });
      await expect(row).toContainText(folio);
      await expect(row).toContainText('PP prices');
      await row.getByRole('textbox').fill('1,800.00');
      await row.getByRole('button', { name: 'Asignar precio' }).click();
      await expect(managerPage.locator('.private-toast').last()).toContainText('Precio asignado', { timeout: 20_000 });
      await expect(managerPage.locator('.catalog-pending-price', { hasText: 'PP concepto flujo' })).toHaveCount(0);
    } finally {
      await managerContext.close();
    }

    // Ventas vuelve a abrir la propuesta: el concepto ya tiene el precio de la lista, sin hacer nada más.
    await page.reload();
    await expect(page.getByRole('heading', { name: /OCQ-\d{4}-\d{6}/ })).toBeVisible({ timeout: 45_000 });
    const resolvedLine = page.locator('.quotes-line', { hasText: 'PP concepto flujo' });
    await expect(resolvedLine).not.toContainText('Por cotizar', { timeout: 45_000 });
    await expect(page.getByRole('textbox', { name: 'Precio de PP concepto flujo' })).toHaveValue('1,800.00');
    await expect(page.locator('.private-toast').last()).toContainText('ya tiene precio en la lista');
    await expect(page.locator('.quotes-manual-note--pending')).toHaveCount(0);
    await expect(page.locator('.quotes-autosave--saved')).toBeVisible({ timeout: 20_000 });
    expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { catalogItemId: itemIds.flow, quoteVersion: { quote: { quoteRequestId: requestId } } } })).toMatchObject({ pricePending: false, unitPriceMinor: 180_000n, overrideReason: null });

    // Ya sin conceptos por cotizar la propuesta puede pasar a revisión.
    const submit = page.locator('#quotes-actions').getByRole('button', { name: 'Pasar a revisión' });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.locator('.private-toast').last()).toContainText('revisión', { timeout: 20_000 });
    expect((await prisma.quoteVersion.findFirstOrThrow({ where: { quote: { quoteRequestId: requestId } }, select: { status: true } })).status).toBe('EN_REVISION');
  });

  test('a manager turns a line por cotizar into a manual price for that quote', async ({ page, request }) => {
    const manager = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: managerEmail }, select: { id: true } });
    const { id: requestId } = await newRequest('convert', manager.id);

    await login(page, request, managerEmail);
    await openBuilder(page, requestId);
    await page.getByRole('combobox', { name: 'Lista de precios' }).click();
    await page.getByRole('option', { name: 'PP prices · MXN', exact: true }).click();
    await page.getByRole('combobox', { name: 'Agregar concepto a la cotización' }).fill('concepto convertir');
    await page.getByRole('option', { name: 'PP concepto convertir · lote', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Definir precio' });
    await dialog.getByText('Todavía no lo sé: dejarlo por cotizar').click();
    await dialog.getByRole('button', { name: 'Agregar como por cotizar' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const line = page.locator('.quotes-line', { hasText: 'PP concepto convertir' });
    await expect(line).toContainText('Por cotizar');
    // Al abrir esa línea ya no se ofrece "dejarlo por cotizar", sólo ponerle precio.
    await line.getByRole('button', { name: 'Definir precio' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Todavía no lo sé: dejarlo por cotizar')).toHaveCount(0);
    await dialog.getByRole('textbox', { name: /Precio por lote/ }).fill('700.00');
    await dialog.getByLabel('Motivo del precio manual').fill('Cotizado por el proveedor');
    await dialog.getByRole('button', { name: 'Aplicar a la cotización' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(line).not.toContainText('Por cotizar');
    await expect(line).toContainText('Precio manual');
    await expect(page.getByRole('textbox', { name: 'Precio de PP concepto convertir' })).toHaveValue('700.00');
    await expect(page.locator('.quotes-autosave--saved')).toBeVisible({ timeout: 20_000 });
    expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { catalogItemId: itemIds.convert, quoteVersion: { quote: { quoteRequestId: requestId } } } })).toMatchObject({ pricePending: false, unitPriceMinor: 70_000n, baseUnitPriceMinor: null, overrideReason: 'Cotizado por el proveedor' });
  });
});
