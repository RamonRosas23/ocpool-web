import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
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
  });

  test.afterAll(async () => {
    const aggregateIds = [categoryId, itemId, priceListId, createdItemId].filter(Boolean);
    if (aggregateIds.length) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: aggregateIds } } });
    }
    if (priceListId) await prisma.priceListItem.deleteMany({ where: { priceListId } });
    if (priceListId) await prisma.priceList.delete({ where: { id: priceListId } });
    if (createdItemId) await prisma.catalogItem.delete({ where: { id: createdItemId } });
    if (itemId) await prisma.catalogItem.delete({ where: { id: itemId } });
    if (categoryId) await prisma.catalogCategory.delete({ where: { id: categoryId } });
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

    await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al dashboard' })).toHaveAttribute('href', '/staff');
    const fixtureItemRow = page.getByRole('button', { name: new RegExp(itemCode) });
    await expect(fixtureItemRow).toBeVisible();
    await fixtureItemRow.click();
    const fixturePriceList = page.getByRole('button', { name: new RegExp(priceListCode) });
    await expect(fixturePriceList).toBeVisible();
    await fixturePriceList.click();
    await expect(page.getByRole('table', { name: 'Precios de la lista seleccionada' })).toContainText('MXN 1,250.00');
    await expectNoSeriousA11yViolations(page);

    const effectiveFrom = page.getByRole('textbox', { name: 'Vigente desde', exact: true });
    await page.getByRole('combobox', { name: 'Concepto' }).click();
    await page.getByRole('option', { name: new RegExp(`^${itemCode} ·`) }).click();
    await expect(page.locator('.catalog-form__preview')).toContainText('Se cerrará el precio vigente de MXN 1,250.00');
    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('990.00');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('Selecciona la fecha desde la que aplica el precio.');

    await effectiveFrom.fill('2026-09-20');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await page.getByRole('button', { name: 'Agregar concepto' }).click();
    await page.getByLabel('Clave', { exact: true }).fill(createdItemCode);
    await page.getByLabel('Nombre', { exact: true }).fill(`Nuevo concepto ${suffix}`);
    await page.getByLabel('Unidad', { exact: true }).fill('servicio');
    await page.getByLabel('Descripción', { exact: true }).fill('Concepto creado desde el flujo de catálogo.');
    await page.getByRole('combobox', { name: 'Categoría' }).click();
    await page.getByRole('option', { name: `E2E categoría ${suffix}`, exact: true }).click();
    await page.getByRole('button', { name: 'Guardar concepto' }).click();
    await expect(page.getByRole('status')).toContainText(`Concepto ${createdItemCode} creado.`);
    const createdRow = page.getByRole('button', { name: new RegExp(createdItemCode) });
    await expect(createdRow).toBeVisible();
    createdItemId = (await prisma.catalogItem.findUniqueOrThrow({ where: { code: createdItemCode }, select: { id: true } })).id;

    await page.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto archivado.');
    await expect(page.getByRole('button', { name: new RegExp(createdItemCode) })).toHaveCount(0);

    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}px`).toBe(true);
    }
    expect(consoleErrors).toEqual([]);
  });
});
