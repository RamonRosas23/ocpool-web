import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion } from '@/server/modules/quotes/service';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff catalog operations', () => {
  test.skip(process.env.CATALOG_E2E !== '1', 'Catalog E2E requires CATALOG_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const categoryCode = `E2E-CAT-${suffix}`;
  const itemCode = `E2E-ITEM-${suffix}`;
  const createdItemCode = `E2E-NEW-${suffix}`;
  const priceListCode = `E2E-PRICE-${suffix}`;
  const email = `e2e-catalog-${suffix}@example.test`;
  const sessionToken = `e2e-catalog-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
  let userId = '';
  let sessionId = '';
  let categoryId = '';
  let itemId = '';
  let priceListId = '';
  let createdItemId = '';
  let newCategoryId = '';
  let childCategoryId = '';
  const specialConceptName = `Concepto especial E2E ${suffix}`;
  let specialQuoteRequestId = '';
  let specialClientId = '';
  let specialQuoteId = '';
  let promotedItemId = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const category = await prisma.catalogCategory.create({ data: { code: categoryCode, name: `E2E categoría ${suffix}`, description: 'Fixture de catálogo E2E' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: itemCode, name: `Concepto E2E ${suffix}`, description: 'Concepto sintético para validar catálogo y precios.', unit: 'pieza', categoryId } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: priceListCode, name: `Lista E2E ${suffix}`, currencyCode: 'MXN', validFrom: new Date('2026-01-01T00:00:00.000Z') } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 125000n, validFrom: new Date('2026-01-01T00:00:00.000Z') } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'E2E Catalog Manager',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    userId = user.id;
    ({ sessionId } = await createSession({ userId, ipAddress: '127.0.0.1', userAgent: 'playwright-catalog-test' }, { prisma, tokenGenerator: () => sessionToken }));

    // K1-05 parte 2 fixture: a quote with a special (non-catalog) line, so the E2E flow
    // can exercise "Ver conceptos especiales" -> "Promover a catálogo".
    const now = new Date('2026-04-04T12:00:00.000Z');
    const specialRequest = await createQuoteRequest({
      idempotencyKey: `catalog-e2e-special-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Concepto especial ${suffix}`, email: `catalog-e2e-special-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special concept promotion fixture', consentAt: now },
    }, { prisma, now });
    specialQuoteRequestId = specialRequest.quoteRequestId;
    specialClientId = specialRequest.clientId;
    await prisma.quoteRequest.update({ where: { id: specialQuoteRequestId }, data: { status: 'EN_ELABORACION' } });
    const specialActor = { userId, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.create']), mfaVerified: true };
    const specialVersion = await createQuoteVersion(specialActor, {
      quoteRequestId: specialQuoteRequestId,
      priceListId,
      lines: [{ special: true, name: specialConceptName, unit: 'servicio', quantity: '1', unitPriceMinor: '4500', reason: 'Fixture E2E de concepto especial' }],
    }, { prisma, now });
    specialQuoteId = specialVersion.quoteId;
  });

  test.afterAll(async () => {
    const aggregateIds = [categoryId, itemId, priceListId, createdItemId, newCategoryId, childCategoryId, promotedItemId].filter(Boolean);
    if (aggregateIds.length) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: aggregateIds } } });
    }
    if (promotedItemId) await prisma.specialConceptPromotion.deleteMany({ where: { catalogItemId: promotedItemId } });
    if (specialQuoteId) {
      const specialVersionIds = (await prisma.quoteVersion.findMany({ where: { quoteId: specialQuoteId }, select: { id: true } })).map(({ id }) => id);
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: specialQuoteId } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [specialQuoteId, ...specialVersionIds] } } });
    }
    if (specialQuoteId) await prisma.quote.delete({ where: { id: specialQuoteId } });
    if (specialQuoteRequestId) {
      const specialContactId = (await prisma.quoteRequest.findUnique({ where: { id: specialQuoteRequestId }, select: { contactId: true } }))?.contactId;
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: specialQuoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: specialQuoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: specialQuoteRequestId } });
      if (specialContactId) await prisma.clientContact.delete({ where: { id: specialContactId } });
    }
    if (specialClientId) await prisma.client.delete({ where: { id: specialClientId } });
    if (promotedItemId) await prisma.catalogItem.delete({ where: { id: promotedItemId } });
    if (priceListId) await prisma.priceListItem.deleteMany({ where: { priceListId } });
    if (priceListId) await prisma.priceList.delete({ where: { id: priceListId } });
    if (createdItemId) await prisma.catalogItem.delete({ where: { id: createdItemId } });
    if (itemId) await prisma.catalogItem.delete({ where: { id: itemId } });
    if (childCategoryId) await prisma.catalogCategory.delete({ where: { id: childCategoryId } });
    if (categoryId) await prisma.catalogCategory.delete({ where: { id: categoryId } });
    if (newCategoryId) await prisma.catalogCategory.delete({ where: { id: newCategoryId } });
    if (sessionId) await prisma.session.delete({ where: { id: sessionId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('manages concepts and dated prices without losing responsive usability', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/staff/catalog');

    await expect(page.getByRole('heading', { name: 'Catálogo', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al dashboard' })).toHaveAttribute('href', '/staff');
    const fixtureItemRow = page.getByRole('button', { name: new RegExp(itemCode) });
    await expect(fixtureItemRow).toBeVisible();
    await fixtureItemRow.click();
    const fixturePriceList = page.getByRole('button', { name: new RegExp(priceListCode) });
    await expect(fixturePriceList).toBeVisible();
    await fixturePriceList.click();
    await expect(page.getByRole('table', { name: 'Precios vigentes' })).toContainText('MXN 1,250.00');
    await expectNoSeriousA11yViolations(page);

    const effectiveFrom = page.getByRole('textbox', { name: 'Vigente desde', exact: true });
    await page.getByRole('combobox', { name: 'Concepto' }).click();
    await page.getByRole('option', { name: new RegExp(`^${itemCode} ·`) }).click();
    await expect(page.locator('.catalog-form__preview')).toContainText('Se cerrará el precio vigente de MXN 1,250.00');

    // K1-03 parte 2: an intermediate schedule (already in the past relative to "now") so that,
    // once the schedule below closes it out too, the price table exercises all three
    // actuales/futuros/históricos buckets from a single fixture.
    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('1100.00');
    await effectiveFrom.fill('2026-02-01');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await effectiveFrom.fill('');
    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('990.00');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('Selecciona la fecha desde la que aplica el precio.');

    await effectiveFrom.fill('2026-09-20');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await expect(page.locator('.catalog-price-group', { hasText: 'Históricos' })).toContainText('MXN 1,250.00');
    await expect(page.locator('.catalog-price-group', { hasText: 'Vigentes' })).toContainText('MXN 1,100.00');
    await expect(page.locator('.catalog-price-group', { hasText: 'Programados' })).toContainText('MXN 990.00');

    await page.getByRole('button', { name: 'Agregar concepto' }).click();
    await page.getByRole('checkbox', { name: 'Especificar clave manualmente' }).check();
    await page.getByLabel('Clave', { exact: true }).fill(createdItemCode);
    await page.getByLabel('Nombre', { exact: true }).fill(`Nuevo concepto ${suffix}`);
    await page.getByRole('combobox', { name: 'Unidad', exact: true }).click();
    await page.getByRole('option', { name: 'servicio', exact: true }).click();
    await page.getByLabel('Descripción', { exact: true }).fill('Concepto creado desde el flujo de catálogo.');
    await page.getByRole('combobox', { name: 'Categoría' }).click();
    await page.getByRole('option', { name: `E2E categoría ${suffix}`, exact: true }).click();
    await page.getByRole('button', { name: 'Guardar concepto' }).click();
    await expect(page.getByRole('status')).toContainText(`Concepto ${createdItemCode} creado.`);
    const createdRow = page.getByRole('button', { name: new RegExp(createdItemCode) });
    await expect(createdRow).toBeVisible();
    createdItemId = (await prisma.catalogItem.findUniqueOrThrow({ where: { code: createdItemCode }, select: { id: true } })).id;

    const itemActions = page.locator('.catalog-main__top .catalog-main__actions');
    await itemActions.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto archivado.');
    await expect(page.getByRole('button', { name: new RegExp(createdItemCode) })).toHaveCount(0);

    // K1-03: create a category from the UI (previously impossible), then edit/archive/reactivate
    // the fixture item and price list, using "Mostrar archivados" to see them reappear.
    // K1-03 parte 2: the code is left to autogenerate (read back from the success notice) and a
    // second category is created as its child via the new "Categoría padre" picker.
    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    await page.getByLabel('Nombre', { exact: true }).fill(`Categoría nueva ${suffix}`);
    await page.getByRole('button', { name: 'Crear categoría' }).click();
    const categoryNotice = await page.getByRole('status').innerText();
    const categoryMatch = /Categoría (CAT-\d{6}) creada\./.exec(categoryNotice);
    expect(categoryMatch).not.toBeNull();
    const newCategoryCode = categoryMatch![1];
    newCategoryId = (await prisma.catalogCategory.findUniqueOrThrow({ where: { code: newCategoryCode }, select: { id: true } })).id;
    await expect(page.locator('.catalog-category-row', { hasText: newCategoryCode })).toBeVisible();

    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    await page.getByLabel('Nombre', { exact: true }).fill(`Subcategoría E2E ${suffix}`);
    await page.getByRole('combobox', { name: 'Categoría padre' }).click();
    await page.getByRole('option', { name: `Categoría nueva ${suffix}`, exact: true }).click();
    await page.getByRole('button', { name: 'Crear categoría' }).click();
    const childNotice = await page.getByRole('status').innerText();
    const childMatch = /Categoría (CAT-\d{6}) creada\./.exec(childNotice);
    expect(childMatch).not.toBeNull();
    const childCategoryCode = childMatch![1];
    childCategoryId = (await prisma.catalogCategory.findUniqueOrThrow({ where: { code: childCategoryCode }, select: { id: true } })).id;
    await expect(page.locator('.catalog-category-row', { hasText: childCategoryCode })).toContainText(`en Categoría nueva ${suffix}`);

    await fixtureItemRow.click();
    await itemActions.getByRole('button', { name: 'Editar' }).click();
    const editedItemName = `Concepto E2E editado ${suffix}`;
    await page.getByLabel('Nombre', { exact: true }).fill(editedItemName);
    await page.getByRole('combobox', { name: 'Unidad (editar concepto)', exact: true }).click();
    await page.getByRole('option', { name: 'lote', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto actualizado.');
    await expect(fixtureItemRow).toContainText(editedItemName);

    await itemActions.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto archivado.');
    await expect(page.getByRole('button', { name: new RegExp(itemCode) })).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Mostrar archivados' }).check();
    await expect(fixtureItemRow).toBeVisible();
    await expect(fixtureItemRow).toContainText('Archivado');
    await fixtureItemRow.click();
    await itemActions.getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto reactivado.');
    await page.getByRole('checkbox', { name: 'Mostrar archivados' }).uncheck();

    const priceListActions = page.locator('.catalog-price-summary .catalog-main__actions');
    await fixturePriceList.click();
    await priceListActions.getByRole('button', { name: 'Editar' }).click();
    const editedPriceListName = `Lista E2E editada ${suffix}`;
    await page.getByLabel('Nombre', { exact: true }).fill(editedPriceListName);
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Lista actualizada.');
    await expect(fixturePriceList).toContainText(editedPriceListName);

    await priceListActions.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Lista archivada.');
    await expect(page.getByText('Esta lista está archivada.')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Mostrar archivados' }).check();
    await expect(fixturePriceList).toContainText('Archivada');
    await priceListActions.getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByRole('status')).toContainText('Lista reactivada.');
    await page.getByRole('checkbox', { name: 'Mostrar archivados' }).uncheck();

    // K1-05 parte 2: promote a special quote-line concept (no catalogItemId) into a real
    // catalog item, linking it to the category created earlier in this same test.
    await page.getByRole('button', { name: 'Ver conceptos especiales' }).click();
    const specialRow = page.locator('.catalog-category-row', { hasText: specialConceptName });
    await expect(specialRow).toBeVisible();
    await specialRow.getByRole('combobox').click();
    await page.getByRole('option', { name: `Categoría nueva ${suffix}`, exact: true }).click();
    await specialRow.getByRole('button', { name: 'Promover a catálogo' }).click();
    await expect(page.getByRole('status')).toContainText('vinculado.');
    await expect(specialRow).toContainText('Promovido a');

    await page.getByLabel('Buscar concepto', { exact: true }).fill(specialConceptName);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(specialConceptName) })).toBeVisible();
    promotedItemId = (await prisma.catalogItem.findFirstOrThrow({ where: { name: specialConceptName }, select: { id: true } })).id;

    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}px`).toBe(true);
    }
    expect(consoleErrors).toEqual([]);
  });
});
