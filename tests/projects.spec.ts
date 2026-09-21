import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { seedIdentityCatalog } from '../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { acceptCustomerQuote } from '@/server/modules/quote-documents/acceptance-service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('project handoff (J1)', () => {
  test.skip(process.env.PROJECTS_E2E !== '1', 'Project handoff E2E requires PROJECTS_E2E=1 and a disposable local database.');
  test.setTimeout(60_000);

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const codeSuffix = suffix.toUpperCase();
  const now = new Date('2026-09-20T15:00:00.000Z');
  const email = `e2e-projects-${suffix}@example.test`;
  let userId = '';
  let sessionId = '';
  let sessionToken = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let quoteId = '';
  let categoryId = '';
  let itemId = '';
  let priceListId = '';
  let projectId = '';
  let projectFolio = '';
  let quoteFolio = '';

  test.beforeAll(async () => {
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'E2E Project Handoff Manager',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: managerRole.id } },
      },
    });
    userId = user.id;
    sessionToken = `e2e-projects-session-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    ({ sessionId } = await createSession({ userId: user.id, ipAddress: '127.0.0.1', userAgent: 'playwright-projects-test' }, { prisma, tokenGenerator: () => sessionToken }));

    const request = await createQuoteRequest({
      idempotencyKey: `projects-e2e-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Project handoff client ${suffix}`, email: `projects-e2e-client-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'J1 handoff E2E fixture', consentAt: now },
    }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    quoteFolio = request.folio;
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: userId } });

    const category = await prisma.catalogCategory.create({ data: { code: `PROJ-E2E-${codeSuffix}`, name: 'Project handoff E2E' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `PROJ-E2E-ITEM-${codeSuffix}`, name: 'Project handoff item', unit: 'pieza', categoryId } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `PROJ-E2E-PRICE-${codeSuffix}`, name: 'Project handoff prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 100_000n, validFrom: now } });

    const staffActor: Actor = { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['manager']), mfaVerified: true };
    const created = await createQuoteVersion(staffActor, { quoteRequestId: requestId, priceListId, lines: [{ catalogItemId: itemId, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
    quoteId = created.quoteId;
    await transitionQuoteVersion(staffActor, created.versionId, 'EN_REVISION', { prisma, now });
    await transitionQuoteVersion(staffActor, created.versionId, 'ENVIADA', { prisma, now });
    await generateQuotePdf(staffActor, created.versionId, { prisma, storage: getPrivateStorage(), now });

    const customerUser = await prisma.user.create({
      data: { email: `projects-e2e-customer-${suffix}@example.test`, emailNormalized: `projects-e2e-customer-${suffix}@example.test`, displayName: 'Project handoff customer', type: 'CUSTOMER', status: 'ACTIVE', clientId },
    });
    const customerActor: Actor = { userId: customerUser.id, type: 'CUSTOMER', clientId, permissionKeys: permissionKeysForRoles(['customer']), mfaVerified: true };
    await acceptCustomerQuote(customerActor, quoteId, { signerName: 'Ana López Rivera', termsVersion: 'v1', idempotencyKey: `projects-e2e-accept-${suffix}` }, { prisma, storage: getPrivateStorage(), now });
  });

  test.afterAll(async () => {
    if (!requestId) {
      await prisma.$disconnect();
      return;
    }
    if (projectId) {
      await prisma.projectChecklistItem.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } });
    }
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: requestId } }, select: { id: true } })).map(({ id }) => id);
    const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
    const storage = getPrivateStorage();
    for (const document of documents) if (document.storageObject?.storageKey) await storage.delete(document.storageObject.storageKey);
    await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: (await prisma.quote.findMany({ where: { quoteRequestId: requestId }, select: { id: true } })).map(({ id }) => id) } } });
    await prisma.quotePublication.deleteMany({ where: { documentId: { in: documents.map(({ id }) => id) } } });
    await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: documents.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });
    await prisma.quote.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, quoteId, ...(projectId ? [projectId] : [])] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestId, quoteId, ...versionIds, ...(projectId ? [projectId] : [])] } } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { clientId, type: 'CUSTOMER' } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.priceListItem.deleteMany({ where: { priceListId } });
    await prisma.priceList.delete({ where: { id: priceListId } });
    await prisma.catalogItem.delete({ where: { id: itemId } });
    await prisma.catalogCategory.delete({ where: { id: categoryId } });
    if (sessionId) await prisma.session.delete({ where: { id: sessionId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('converts an accepted quote into a project and drives the handoff workspace', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    // Un expediente ya aceptado sale de la lista "en construcción" del panel -- exactamente como
    // lo entrega un enlace real (notificación de aceptación, cola de aprobaciones, dashboard), no
    // se navega por búsqueda en la barra lateral.
    await page.goto(`/staff/quotes?request=${requestId}`);
    await expect(page.getByRole('heading', { name: quoteFolio })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Cotización aceptada')).toBeVisible({ timeout: 10_000 });

    // J1-02: la conversión es una decisión explícita del staff, no automática al aceptar.
    await page.getByRole('button', { name: 'Convertir a proyecto' }).click();
    const projectLink = page.getByRole('link', { name: /Ver proyecto PRJ-\d{4}-\d{6}/u });
    await expect(projectLink).toBeVisible({ timeout: 10_000 });
    // .textContent() (no .innerText()) porque el enlace se muestra en mayúsculas vía CSS
    // (text-transform), y .innerText() refleja ese estilo en vez del texto real del DOM.
    projectFolio = ((await projectLink.textContent()) ?? '').replace('Ver proyecto ', '').trim();

    await projectLink.click();
    await expect(page).toHaveURL(/\/staff\/projects\/[0-9a-f-]+$/u);
    projectId = page.url().split('/staff/projects/')[1]!;

    const statusPill = page.locator('.staff-status-pill');
    await expect(page.getByRole('heading', { name: `Project handoff client ${suffix}` })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(projectFolio)).toBeVisible();
    await expect(statusPill).toHaveText('En transición');
    await expect(page.getByText('Alcance aceptado · V1')).toBeVisible();
    await expect(page.getByText('Firmado por Ana López Rivera')).toBeVisible();

    // UX audit fix: el workspace de proyecto no tenía ningún enlace de regreso al expediente
    // original -- sólo "Volver al dashboard". Ahora el propio folio de "Expediente" es un enlace real.
    const sourceRequestLink = page.getByRole('link', { name: quoteFolio });
    await expect(sourceRequestLink).toBeVisible();
    await sourceRequestLink.click();
    await expect(page).toHaveURL(new RegExp(`/staff/requests\\?request=${requestId}$`));
    await expect(page.getByRole('heading', { name: quoteFolio })).toBeVisible({ timeout: 10_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/projects\/[0-9a-f-]+$/u);
    await expect(page.getByText('Sin tareas de checklist todavía.')).toBeVisible();

    // Checklist: agregar una tarea real de transición y completarla.
    const taskLabel = `Agendar visita de medición ${suffix}`;
    await page.getByLabel('Nuevas tareas').fill(taskLabel);
    await page.getByRole('button', { name: 'Agregar tarea' }).click();
    const checklistItem = page.locator('.staff-checklist__item', { hasText: taskLabel });
    await expect(checklistItem).toBeVisible({ timeout: 10_000 });
    await expect(checklistItem).not.toHaveClass(/is-complete/);

    // .click(), no .check(): el checkbox está controlado por React y sólo refleja completedAt
    // después de que la petición PATCH resuelve, así que Playwright vería el "check" revertirse
    // en el siguiente render y lo reportaría como fallido aunque el flujo real sí funcione.
    await checklistItem.getByRole('checkbox').click();
    await expect(checklistItem).toHaveClass(/is-complete/, { timeout: 10_000 });
    await expect(checklistItem.getByText('E2E Project Handoff Manager')).toBeVisible({ timeout: 10_000 });

    // Handoff: marcar completado y reabrir -- ambas transiciones deben reflejarse sin recargar la página.
    await page.getByRole('button', { name: 'Marcar handoff completado' }).click();
    await expect(statusPill).toHaveText('Handoff completado', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Reabrir handoff' })).toBeVisible();

    await page.getByRole('button', { name: 'Reabrir handoff' }).click();
    await expect(statusPill).toHaveText('En transición', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Marcar handoff completado' })).toBeVisible();

    await expectNoSeriousA11yViolations(page);
    expect(consoleErrors).toEqual([]);
  });
});
