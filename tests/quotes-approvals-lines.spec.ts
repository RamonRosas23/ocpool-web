import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { hashPassword } from '@/server/auth/crypto';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { requestQuoteApproval } from '@/server/modules/quotes/approval-service';
import type { Actor } from '@/server/auth/types';

test.describe('approval queue shows the concepts of the version under review', () => {
  test.skip(process.env.QUOTES_E2E !== '1', 'Approval queue E2E requires QUOTES_E2E=1 and a disposable local database.');
  test.setTimeout(120_000);
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const password = 'ApprovalLinesPassword123!';
  const managerEmail = `approval-lines-manager-${suffix}@example.test`;
  const now = new Date('2026-03-12T12:00:00.000Z');
  const ids: { manager: string; requester: string; request: string; client: string; contact: string; category: string; list: string; items: string[] } = { manager: '', requester: '', request: '', client: '', contact: '', category: '', list: '', items: [] };

  test.beforeAll(async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    ids.manager = (await prisma.user.create({ data: { email: managerEmail, emailNormalized: managerEmail, displayName: 'Approval lines manager', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash: await hashPassword(password), roles: { create: { roleId: managerRole.id } } } })).id;
    ids.requester = (await prisma.user.create({ data: { email: `approval-lines-req-${suffix}@example.test`, emailNormalized: `approval-lines-req-${suffix}@example.test`, displayName: 'Approval lines requester', type: 'EMPLOYEE', status: 'ACTIVE' } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `approval-lines-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Approval lines ${suffix}`, email: `approval-lines-c-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Approval lines fixture', consentAt: now } }, { prisma, now });
    ids.request = request.quoteRequestId; ids.client = request.clientId; ids.contact = request.contactId;
    await prisma.quoteRequest.update({ where: { id: ids.request }, data: { status: 'EN_ELABORACION' } });
    ids.category = (await prisma.catalogCategory.create({ data: { code: `AL-${suffix}`, name: 'Approval lines' } })).id;
    const listed = await prisma.catalogItem.create({ data: { code: `AL-LISTED-${suffix}`, name: 'AL concepto con precio', unit: 'pieza', categoryId: ids.category } });
    const unpriced = await prisma.catalogItem.create({ data: { code: `AL-UNPRICED-${suffix}`, name: 'AL concepto manual', unit: 'servicio', categoryId: ids.category } });
    ids.items = [listed.id, unpriced.id];
    ids.list = (await prisma.priceList.create({ data: { code: `AL-PRICE-${suffix}`, name: 'AL prices', currencyCode: 'MXN', validFrom: now } })).id;
    await prisma.priceListItem.create({ data: { priceListId: ids.list, catalogItemId: listed.id, unitPriceMinor: 100_000n, validFrom: now } });
    const requester: Actor = { userId: ids.requester, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['quotes.create', 'quotes.send', 'quotes.edit_prices', 'quotes.apply_discount', 'prices.read']), mfaVerified: true };
    const created = await createQuoteVersion(requester, { quoteRequestId: ids.request, priceListId: ids.list, lines: [
      { catalogItemId: listed.id, quantity: '2', discountBasisPoints: 1500 },
      { catalogItemId: unpriced.id, quantity: '1', unitPriceMinorOverride: '250000', manualPriceReason: 'Cotizado por el proveedor' },
    ] }, { prisma, now });
    await transitionQuoteVersion(requester, created.versionId, 'EN_REVISION', { prisma, now });
    await requestQuoteApproval(requester, created.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: 500, reason: 'Cliente frecuente.' }, { prisma, now });
  });

  test.afterAll(async () => {
    const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: ids.request } }, select: { id: true } })).map(({ id }) => id);
    const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
    const quoteIds = (await prisma.quote.findMany({ where: { quoteRequestId: ids.request }, select: { id: true } })).map(({ id }) => id);
    await prisma.quote.deleteMany({ where: { quoteRequestId: ids.request } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [ids.request, ...quoteIds, ...versionIds] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [ids.request, ...versionIds, ...approvalIds] } } });
    await prisma.quoteRequest.delete({ where: { id: ids.request } });
    await prisma.clientContact.delete({ where: { id: ids.contact } });
    await prisma.client.delete({ where: { id: ids.client } });
    await prisma.priceListItem.deleteMany({ where: { priceListId: ids.list } });
    await prisma.priceList.delete({ where: { id: ids.list } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: ids.items } } });
    await prisma.catalogCategory.delete({ where: { id: ids.category } });
    await prisma.session.deleteMany({ where: { userId: { in: [ids.manager, ids.requester] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.manager, ids.requester] } } });
    await prisma.$disconnect();
  });

  test('lists the concepts and flags a manual price for the approver', async ({ page, request }) => {
    const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
    const login = await request.post('/api/auth/employee/login', { headers: { origin }, data: { email: managerEmail, password } });
    expect(login.status()).toBe(200);
    const rawCookie = login.headers()['set-cookie'].match(/ocpool_session=([^;]+)/)?.[1];
    await page.context().addCookies([{ name: 'ocpool_session', value: rawCookie!, url: origin }]);
    await page.goto('/staff/approvals');
    await page.getByRole('button', { name: 'Ver conceptos de la versión' }).first().click();
    const flagged = page.locator('.approval-lines li.is-flagged', { hasText: 'AL concepto manual' });
    await expect(flagged).toContainText('Precio manual', { timeout: 30_000 });
    await expect(flagged).toContainText('Cotizado por el proveedor');
  });
});
