import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { requestQuoteApproval } from '@/server/modules/quotes/approval-service';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff analytics dashboard', () => {
  test.skip(process.env.DASHBOARD_E2E !== '1', 'Dashboard E2E requires DASHBOARD_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-09-19T12:00:00.000Z');
  const email = `e2e-dashboard-${suffix}@example.test`;
  let userId = '';
  let sessionId = '';
  let sessionToken = '';
  let mineRequestId = '';
  let mineContactId = '';
  let mineClientId = '';
  let mineFolio = '';
  let unassignedRequestId = '';
  let unassignedContactId = '';
  let unassignedClientId = '';
  let unassignedFolio = '';
  let approvalRequestId = '';
  let approvalContactId = '';
  let approvalClientId = '';
  let approvalFolio = '';
  let approvalRequesterId = '';
  let approvalCategoryId = '';
  let approvalItemId = '';
  let approvalPriceListId = '';
  let customerRepliedRequestId = '';
  let customerRepliedContactId = '';
  let customerRepliedClientId = '';
  let customerRepliedFolio = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'E2E Dashboard Manager',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    userId = user.id;
    sessionToken = `e2e-dashboard-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    ({ sessionId } = await createSession({ userId: user.id, ipAddress: '127.0.0.1', userAgent: 'playwright-dashboard-test' }, { prisma, tokenGenerator: () => sessionToken }));

    const mine = await createQuoteRequest({
      idempotencyKey: `dashboard-mine-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Dashboard queue mine ${suffix}`, email: `dashboard-mine-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'W1-02 mine queue fixture', consentAt: now },
    }, { prisma, now });
    mineRequestId = mine.quoteRequestId;
    mineClientId = mine.clientId;
    mineContactId = mine.contactId;
    mineFolio = mine.folio;
    await prisma.quoteRequest.update({ where: { id: mineRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: userId } });

    const unassigned = await createQuoteRequest({
      idempotencyKey: `dashboard-unassigned-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Dashboard queue unassigned ${suffix}`, email: `dashboard-unassigned-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'W1-02 unassigned queue fixture', consentAt: now },
    }, { prisma, now });
    unassignedRequestId = unassigned.quoteRequestId;
    unassignedClientId = unassigned.clientId;
    unassignedContactId = unassigned.contactId;
    unassignedFolio = unassigned.folio;
    await prisma.quoteRequest.update({ where: { id: unassignedRequestId }, data: { status: 'EN_ELABORACION' } });
    // El dashboard ordena "Sin asignar" por más antigua primero (la más urgente); este entorno
    // compartido ya acumula decenas de solicitudes sin asignar de corridas previas, así que se
    // retrasa el reloj de esta fixture para garantizar que quede entre las primeras sin depender
    // de vaciar datos ajenos. `updatedAt` es `@updatedAt`, por eso se fuerza con SQL directo.
    await prisma.$executeRaw`UPDATE quote_requests SET "updatedAt" = '2000-01-01T00:00:00.000Z' WHERE id = ${unassignedRequestId}::uuid`;

    // W1-02: cola de aprobaciones pendientes — el manager de este dashboard es el aprobador
    // elegible, pero la aprobación debe solicitarla otro actor (separación de funciones).
    const requester = await prisma.user.create({
      data: {
        email: `e2e-dashboard-requester-${suffix}@example.test`,
        emailNormalized: `e2e-dashboard-requester-${suffix}@example.test`,
        displayName: 'E2E Dashboard Requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    approvalRequesterId = requester.id;
    const approvalRequest = await createQuoteRequest({
      idempotencyKey: `dashboard-approval-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Dashboard queue approval ${suffix}`, email: `dashboard-approval-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'W1-02 approval queue fixture', consentAt: now },
    }, { prisma, now });
    approvalRequestId = approvalRequest.quoteRequestId;
    approvalClientId = approvalRequest.clientId;
    approvalContactId = approvalRequest.contactId;
    approvalFolio = approvalRequest.folio;
    await prisma.quoteRequest.update({ where: { id: approvalRequestId }, data: { status: 'EN_ELABORACION' } });
    // catalog_categories/catalog_items/price_lists exigen códigos en mayúsculas (CHECK ^[A-Z0-9][A-Z0-9_-]*$);
    // el `suffix` de este archivo incluye letras en minúscula (base36), así que se normaliza aquí.
    const codeSuffix = suffix.toUpperCase();
    const category = await prisma.catalogCategory.create({ data: { code: `DASH-APPROVAL-${codeSuffix}`, name: 'Dashboard approval queue' } });
    approvalCategoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `DASH-APPROVAL-ITEM-${codeSuffix}`, name: 'Dashboard approval item', unit: 'pieza', categoryId: category.id } });
    approvalItemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `DASH-APPROVAL-PRICE-${codeSuffix}`, name: 'Dashboard approval prices', currencyCode: 'MXN', validFrom: now } });
    approvalPriceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 20_000n, validFrom: now } });
    const requesterActor = { userId: approvalRequesterId, type: 'EMPLOYEE' as const, clientId: null, permissionKeys: new Set(['quotes.create', 'quotes.send', 'quotes.apply_discount']), mfaVerified: true };
    const approvalQuote = await createQuoteVersion(requesterActor, { quoteRequestId: approvalRequestId, priceListId: approvalPriceListId, lines: [{ catalogItemId: approvalItemId, quantity: '1', discountBasisPoints: 500 }] }, { prisma, now });
    await transitionQuoteVersion(requesterActor, approvalQuote.versionId, 'EN_REVISION', { prisma, now });
    await requestQuoteApproval(requesterActor, approvalQuote.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: 500 }, { prisma, now });

    // W1-01: "cliente respondió" -- asignado a este actor, con un mensaje visible para el cliente
    // más reciente que cualquier lectura suya (ninguna existe todavía para este expediente).
    const customerRepliedRequest = await createQuoteRequest({
      idempotencyKey: `dashboard-customer-replied-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Dashboard queue customer replied ${suffix}`, email: `dashboard-customer-replied-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'W1-01 customer replied queue fixture', consentAt: now },
    }, { prisma, now });
    customerRepliedRequestId = customerRepliedRequest.quoteRequestId;
    customerRepliedClientId = customerRepliedRequest.clientId;
    customerRepliedContactId = customerRepliedRequest.contactId;
    customerRepliedFolio = customerRepliedRequest.folio;
    await prisma.quoteRequest.update({ where: { id: customerRepliedRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: userId } });
    const customerRepliedConversation = await prisma.conversation.create({ data: { quoteRequestId: customerRepliedRequestId, clientId: customerRepliedClientId } });
    await prisma.conversationMessage.create({ data: { conversationId: customerRepliedConversation.id, visibility: 'CUSTOMER', body: 'Ya tengo el terreno listo, cuando gusten pasar.' } });
  });

  test.afterAll(async () => {
    if (approvalRequestId) {
      await prisma.quoteApproval.deleteMany({ where: { quote: { quoteRequestId: approvalRequestId } } });
      await prisma.quote.deleteMany({ where: { quoteRequestId: approvalRequestId } });
    }
    if (customerRepliedRequestId) {
      await prisma.conversationMessage.deleteMany({ where: { conversation: { quoteRequestId: customerRepliedRequestId } } });
      await prisma.conversation.deleteMany({ where: { quoteRequestId: customerRepliedRequestId } });
    }
    for (const id of [mineRequestId, unassignedRequestId, approvalRequestId, customerRepliedRequestId]) {
      if (!id) continue;
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: id } });
      await prisma.auditLog.deleteMany({ where: { entityId: id } });
      await prisma.quoteRequest.delete({ where: { id } });
    }
    if (mineContactId) await prisma.clientContact.delete({ where: { id: mineContactId } });
    if (mineClientId) await prisma.client.delete({ where: { id: mineClientId } });
    if (unassignedContactId) await prisma.clientContact.delete({ where: { id: unassignedContactId } });
    if (unassignedClientId) await prisma.client.delete({ where: { id: unassignedClientId } });
    if (approvalContactId) await prisma.clientContact.delete({ where: { id: approvalContactId } });
    if (approvalClientId) await prisma.client.delete({ where: { id: approvalClientId } });
    if (customerRepliedContactId) await prisma.clientContact.delete({ where: { id: customerRepliedContactId } });
    if (customerRepliedClientId) await prisma.client.delete({ where: { id: customerRepliedClientId } });
    if (approvalPriceListId) await prisma.priceListItem.deleteMany({ where: { priceListId: approvalPriceListId } });
    if (approvalPriceListId) await prisma.priceList.delete({ where: { id: approvalPriceListId } });
    if (approvalItemId) await prisma.catalogItem.delete({ where: { id: approvalItemId } });
    if (approvalCategoryId) await prisma.catalogCategory.delete({ where: { id: approvalCategoryId } });
    if (approvalRequesterId) await prisma.user.delete({ where: { id: approvalRequesterId } });
    if (sessionId) await prisma.session.delete({ where: { id: sessionId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('supports restricted, empty, responsive and accessible states', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Acceso restringido.' })).toBeVisible();
    consoleErrors.length = 0;

    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Pulso comercial' })).toBeVisible();
    // Investigated a real, reproducible flake here: server-side logging confirmed the six parallel
    // work-queue fetches this panel fires on mount consistently arrive with NO Cookie header at
    // all, right after `addCookies()` + `goto()` -- a CDP cookie-injection/first-navigation timing
    // gap, not an app bug (StaffDashboardPanel's own fetches already correctly pass
    // credentials: 'include', and every other E2E spec's cookie-injected session works reliably
    // for its own single-fetch panels). A reload guarantees the cookie is fully settled in the
    // browser before the panel's mount-time fetches fire again.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pulso comercial' })).toBeVisible();
    consoleErrors.length = 0;
    await page.getByRole('textbox', { name: 'Desde', exact: true }).fill('2020-01-01');
    await page.getByRole('textbox', { name: 'Hasta', exact: true }).fill('2020-02-01');
    await page.getByRole('button', { name: 'Aplicar periodo' }).click();
    await expect(page.getByText('No hay solicitudes en este periodo.')).toBeVisible();
    await expect(page.getByText('Salud de notificaciones')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(email);
    await expectNoSeriousA11yViolations(page);

    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    const reducedMotion = await page.locator('button').first().evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(['0s', '0.01ms', '1e-05s']).toContain(reducedMotion);
    expect(consoleErrors).toEqual([]);
  });

  test('W1-02: work queues surface the exact request and deep-link into it', async ({ page }) => {
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Mi trabajo' })).toBeVisible();
    const mineCard = page.locator('.staff-workqueue__card', { has: page.getByRole('heading', { name: 'Mi trabajo' }) });
    const unassignedCard = page.locator('.staff-workqueue__card', { has: page.getByRole('heading', { name: 'Sin asignar' }) });
    await expect(mineCard.getByText(mineFolio)).toBeVisible({ timeout: 10_000 });
    await expect(mineCard.getByText(`Dashboard queue mine ${suffix}`)).toBeVisible();
    await expect(unassignedCard.getByText(unassignedFolio)).toBeVisible();
    await expect(unassignedCard.getByText(`Dashboard queue unassigned ${suffix}`)).toBeVisible();
    // La solicitud asignada a este actor nunca debe aparecer también en "Sin asignar", ni viceversa.
    await expect(mineCard.getByText(unassignedFolio)).toHaveCount(0);
    await expect(unassignedCard.getByText(mineFolio)).toHaveCount(0);

    // W1-02: la cola de aprobaciones sólo aparece porque este actor puede resolverlas (nunca la que
    // él mismo hubiera solicitado) y enlaza al constructor de cotizaciones, no al panel de solicitudes.
    const approvalsCard = page.locator('.staff-workqueue__card', { has: page.getByRole('heading', { name: 'Aprobaciones' }) });
    await expect(approvalsCard.getByText(approvalFolio)).toBeVisible({ timeout: 10_000 });
    await expect(approvalsCard.getByText(`Dashboard queue approval ${suffix}`)).toBeVisible();
    await expect(approvalsCard.getByText('Descuento')).toBeVisible();
    await approvalsCard.getByText(approvalFolio).click();
    await expect(page).toHaveURL(new RegExp(`/staff/quotes\\?request=${approvalRequestId}$`));
    await expect(page.getByRole('heading', { name: approvalFolio })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Aprobar descuento' })).toBeVisible({ timeout: 10_000 });

    // W1-01: "cliente respondió" enlaza al expediente (solicitud), no al constructor —
    // la razón es la conversación, no una decisión de cotización.
    await page.goto('/staff');
    const customerRepliedCard = page.locator('.staff-workqueue__card', { has: page.getByRole('heading', { name: 'Cliente respondió' }) });
    await expect(customerRepliedCard.getByText(customerRepliedFolio)).toBeVisible({ timeout: 10_000 });
    await expect(customerRepliedCard.getByText(`Dashboard queue customer replied ${suffix}`)).toBeVisible();
    await customerRepliedCard.getByText(customerRepliedFolio).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests\\?request=${customerRepliedRequestId}$`));
    await expect(page.getByRole('heading', { name: customerRepliedFolio })).toBeVisible({ timeout: 10_000 });

    await page.goto('/staff');
    await mineCard.getByText(mineFolio).click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests\\?request=${mineRequestId}$`));
    await expect(page.getByRole('heading', { name: mineFolio })).toBeVisible({ timeout: 10_000 });
  });
});
