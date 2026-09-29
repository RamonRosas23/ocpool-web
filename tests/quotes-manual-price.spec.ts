import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { hashPassword } from '@/server/auth/crypto';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

test.describe('quote builder: pricing a concept that is not in the list', () => {
  test.skip(process.env.QUOTES_E2E !== '1', 'Quote builder E2E requires QUOTES_E2E=1 and a disposable local database.');
  test.setTimeout(120_000);

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const password = 'ManualPriceE2EPassword123!';
  const managerEmail = `manual-price-manager-${suffix}@example.test`;
  const salesEmail = `manual-price-sales-${suffix}@example.test`;
  const now = new Date('2026-03-12T12:00:00.000Z');
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let categoryId = '';
  let priceListId = '';
  const itemIds: Record<'listed' | 'manual' | 'inList' | 'blocked', string> = { listed: '', manual: '', inList: '', blocked: '' };

  test.beforeAll(async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const manager = await prisma.user.create({ data: { email: managerEmail, emailNormalized: managerEmail, displayName: 'Manual price manager', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: managerRole.id } } } });
    const sales = await prisma.user.create({ data: { email: salesEmail, emailNormalized: salesEmail, displayName: 'Manual price sales', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: salesRole.id } } } });
    userIds.push(manager.id, sales.id);
    const request = await createQuoteRequest({
      idempotencyKey: `manual-price-e2e-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Manual price client ${suffix}`, email: `manual-price-client-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Manual price E2E fixture', consentAt: now },
    }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: sales.id } });
    categoryId = (await prisma.catalogCategory.create({ data: { code: `MP-E2E-${suffix}`, name: 'Manual price E2E' } })).id;
    const listed = await prisma.catalogItem.create({ data: { code: `MP-LISTED-${suffix}`, name: 'MP concepto con precio', unit: 'pieza', categoryId } });
    const manual = await prisma.catalogItem.create({ data: { code: `MP-MANUAL-${suffix}`, name: 'MP concepto manual', unit: 'servicio', categoryId } });
    const inList = await prisma.catalogItem.create({ data: { code: `MP-INLIST-${suffix}`, name: 'MP concepto a lista', unit: 'lote', categoryId } });
    const blocked = await prisma.catalogItem.create({ data: { code: `MP-BLOCKED-${suffix}`, name: 'MP concepto bloqueado', unit: 'pieza', categoryId } });
    itemIds.blocked = blocked.id;
    itemIds.listed = listed.id; itemIds.manual = manual.id; itemIds.inList = inList.id;
    priceListId = (await prisma.priceList.create({ data: { code: `MP-PRICE-${suffix}`, name: 'MP prices', currencyCode: 'MXN', validFrom: now } })).id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: listed.id, unitPriceMinor: 15_000n, validFrom: now } });
  });

  test.afterAll(async () => {
    if (requestId) {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: requestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: requestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, priceListId] } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [requestId, ...versionIds] } }, { action: { startsWith: 'prices.item' }, actorUserId: { in: userIds } }] } });
      await prisma.quoteRequest.delete({ where: { id: requestId } });
      await prisma.clientContact.delete({ where: { id: contactId } });
      await prisma.client.delete({ where: { id: clientId } });
      await prisma.priceListItem.deleteMany({ where: { priceListId } });
      await prisma.priceList.delete({ where: { id: priceListId } });
      await prisma.catalogItem.deleteMany({ where: { id: { in: Object.values(itemIds) } } });
      await prisma.catalogCategory.delete({ where: { id: categoryId } });
    }
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function signIn(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext, email: string) {
    const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
    const login = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email, password } });
    expect(login.status()).toBe(200);
    const rawCookie = login.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
    expect(rawCookie).toBeTruthy();
    await page.context().addCookies([{ name: 'ocpool_session', value: rawCookie!, url: origin }]);
    await page.goto(`/staff/quotes?request=${requestId}`);
    await expect(page.getByRole('heading', { name: /OCQ-\d{4}-\d{6}/ })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('combobox', { name: 'Lista de precios' }).click();
    await page.getByRole('option', { name: 'MP prices · MXN', exact: true }).click();
  }

  test('a manager defines the price inline: manual for this quote, or also in the list', async ({ page, request }) => {
    await signIn(page, request, managerEmail);
    const search = page.getByRole('combobox', { name: 'Agregar concepto a la cotización' });

    // Precio manual: sólo esta cotización, con motivo obligatorio.
    await search.fill('concepto manual');
    const unpricedOption = page.getByRole('option', { name: 'MP concepto manual · servicio', exact: true });
    await expect(unpricedOption).toContainText('Definir precio');
    await expect(unpricedOption).toHaveAttribute('aria-disabled', 'false');
    await unpricedOption.click();
    const dialog = page.getByRole('dialog', { name: 'Definir precio' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /Precio por servicio/ })).toBeFocused();
    await dialog.getByRole('textbox', { name: /Precio por servicio/ }).fill('2,500.00');
    await dialog.getByLabel('Motivo del precio manual').fill('ab');
    await dialog.getByRole('button', { name: 'Agregar a la cotización' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Motivo del precio manual').fill('Cotizado por el proveedor');
    await dialog.getByRole('button', { name: 'Agregar a la cotización' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    // Al cerrarse el diálogo el foco vuelve al buscador, pero sin reabrir el desplegable.
    await expect(search).toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Agregar concepto a la cotización' })).toHaveCount(0);
    const manualLine = page.locator('.quotes-line', { hasText: 'MP concepto manual' });
    await expect(manualLine).toContainText('Precio manual');
    await expect(manualLine).toContainText('Cotizado por el proveedor');
    await expect(page.getByRole('textbox', { name: 'Precio de MP concepto manual' })).toHaveValue('2,500.00');
    await expect(page.locator('.quotes-manual-note')).toContainText('1 concepto con precio manual');

    // Guardar también en la lista: el concepto queda con precio de lista, sin marca de precio manual.
    await search.fill('concepto a lista');
    await page.getByRole('option', { name: 'MP concepto a lista · lote', exact: true }).click();
    await dialog.getByRole('textbox', { name: /Precio por lote/ }).fill('900.00');
    await dialog.getByText('Guardar también en la lista').click();
    await expect(dialog.getByLabel('Motivo del precio manual')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Guardar en la lista y agregar' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const listLine = page.locator('.quotes-line', { hasText: 'MP concepto a lista' });
    await expect(listLine).toBeVisible();
    await expect(listLine).not.toContainText('Precio manual');
    await expect(page.locator('.quotes-manual-note')).toContainText('1 concepto con precio manual');

    await search.fill('concepto con precio');
    await page.getByRole('option', { name: 'MP concepto con precio · pieza', exact: true }).click();
    await expect(page.locator('.quotes-line')).toHaveCount(3);

    await expect(page.locator('.quotes-autosave--saved')).toBeVisible({ timeout: 15_000 });
    const manualSnapshot = await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { catalogItemId: itemIds.manual, quoteVersion: { quote: { quoteRequestId: requestId } } } });
    expect(manualSnapshot).toMatchObject({ unitPriceMinor: 250_000n, baseUnitPriceMinor: null, overrideReason: 'Cotizado por el proveedor' });
    // La lista sólo cambió donde se pidió expresamente.
    expect(await prisma.priceListItem.count({ where: { priceListId, catalogItemId: itemIds.manual } })).toBe(0);
    expect(await prisma.priceListItem.findFirst({ where: { priceListId, catalogItemId: itemIds.inList } })).toMatchObject({ unitPriceMinor: 90_000n });
    const listSnapshot = await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { catalogItemId: itemIds.inList, quoteVersion: { quote: { quoteRequestId: requestId } } } });
    expect(listSnapshot).toMatchObject({ unitPriceMinor: 90_000n, overrideReason: null });

    // Al recargar, la marca de precio manual sigue ahí.
    await page.reload();
    await expect(page.locator('.quotes-line', { hasText: 'MP concepto manual' })).toContainText('Cotizado por el proveedor');
  });

  test('a seller without price permissions can only leave an unpriced concept por cotizar', async ({ page, request }) => {
    await signIn(page, request, salesEmail);
    await page.getByRole('combobox', { name: 'Agregar concepto a la cotización' }).fill('concepto bloqueado');
    const option = page.getByRole('option', { name: 'MP concepto bloqueado · pieza', exact: true });
    await expect(option).toContainText('Por cotizar');
    await option.click();
    // Sin permiso para fijar precios no hay precio ni motivo que capturar: sólo dejarlo por cotizar.
    const dialog = page.getByRole('dialog', { name: 'Concepto sin precio' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Agregar como por cotizar' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('.quotes-line', { hasText: 'MP concepto bloqueado' })).toContainText('Por cotizar');
  });
});
