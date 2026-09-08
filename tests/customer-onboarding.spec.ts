import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('customer onboarding staff flow', () => {
  test.skip(process.env.CUSTOMER_ONBOARDING_E2E !== '1', 'Customer onboarding E2E requires CUSTOMER_ONBOARDING_E2E=1 and disposable local data.');

  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const origin = 'http://127.0.0.1:3100';
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let managerId = '';
  let limitedId = '';
  let limitedRoleId = '';
  let managerToken = '';
  let limitedToken = '';

  test.beforeAll(async () => {
    if (process.env.CUSTOMER_ONBOARDING_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const permissions = await prisma.permission.findMany({ where: { key: 'requests.read' }, select: { id: true } });
    const limitedRole = await prisma.role.create({
      data: {
        key: `customer-onboarding-reader-${suffix}`,
        name: 'Customer onboarding reader',
        description: 'Temporary E2E read-only role',
        systemManaged: false,
        permissions: { create: permissions.map(({ id: permissionId }) => ({ permissionId })) },
      },
    });
    limitedRoleId = limitedRole.id;

    const request = await createQuoteRequest({
      idempotencyKey: `customer-onboarding-e2e-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Onboarding E2E client ${suffix}`, email: `customer-onboarding-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Customer onboarding UI fixture', consentAt: new Date('2026-09-08T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-09-08T12:00:00.000Z') });
    requestId = request.quoteRequestId;
    folio = request.folio;
    clientId = request.clientId;
    contactId = request.contactId;

    const [manager, limited] = await Promise.all([
      prisma.user.create({ data: { email: `customer-onboarding-manager-${suffix}@example.test`, emailNormalized: `customer-onboarding-manager-${suffix}@example.test`, displayName: 'Customer onboarding manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `customer-onboarding-reader-${suffix}@example.test`, emailNormalized: `customer-onboarding-reader-${suffix}@example.test`, displayName: 'Customer onboarding reader', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: limitedRole.id } } } }),
    ]);
    managerId = manager.id;
    limitedId = limited.id;
    managerToken = `customer-onboarding-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    limitedToken = `customer-onboarding-reader-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'customer-onboarding-e2e' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: limited.id, ipAddress: null, userAgent: 'customer-onboarding-e2e' }, { prisma, tokenGenerator: () => limitedToken }),
    ]);
  });

  test.afterAll(async () => {
    if (process.env.CUSTOMER_ONBOARDING_E2E !== '1') return;
    await prisma.session.deleteMany({ where: { userId: { in: [managerId, limitedId].filter(Boolean) } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [managerId, limitedId].filter(Boolean) } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: [managerId, limitedId].filter(Boolean) } } });
    await prisma.authToken.deleteMany({ where: { userId: { in: [managerId, limitedId].filter(Boolean) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    if (requestId) await prisma.quoteRequest.delete({ where: { id: requestId } });
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [managerId, limitedId].filter(Boolean) } } });
    if (limitedRoleId) await prisma.role.delete({ where: { id: limitedRoleId } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  async function setSession(page: Page, token: string) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);
  }

  test('manager can invite once and receives a deduplicated follow-up state', async ({ page }) => {
    await setSession(page, managerToken);
    await page.goto('/staff/requests');
    await page.getByRole('button', { name: new RegExp(folio) }).click();
    await expect(page.getByRole('button', { name: 'Habilitar portal' })).toBeVisible();
    await page.getByRole('button', { name: 'Habilitar portal' }).click();
    await expect(page.locator('.staff-notice')).toContainText('Invitación de acceso enviada.');
    await expect(page.getByText('Invitación pendiente')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reenviar acceso' })).toBeVisible();
    await page.getByRole('button', { name: 'Reenviar acceso' }).click();
    await expect(page.locator('.staff-notice')).toContainText('Ya existe una invitación vigente.');
    await expectNoSeriousA11yViolations(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}px`).toBe(true);
    }
  });

  test('read-only staff can inspect the request but cannot see onboarding action', async ({ page }) => {
    await setSession(page, limitedToken);
    await page.goto('/staff/requests');
    await page.getByRole('button', { name: new RegExp(folio) }).click();
    await expect(page.getByText(/Portal sin habilitar|Invitación pendiente/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Habilitar portal|Reenviar acceso/ })).toHaveCount(0);
  });
});
