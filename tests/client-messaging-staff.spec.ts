import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createInternalNote, sendStaffMessage } from '@/server/modules/messaging/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff messaging opt-in flow', () => {
  test.skip(process.env.STAFF_MESSAGING_E2E !== '1', 'Staff messaging E2E requires STAFF_MESSAGING_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date('2026-09-08T12:00:00.000Z');
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
    if (process.env.STAFF_MESSAGING_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: ['requests.read', 'messaging.read', 'messaging.send'] } }, select: { id: true } });
    const limitedRole = await prisma.role.create({
      data: {
        key: `staff-messaging-reader-${suffix}`,
        name: 'Staff messaging reader',
        description: 'Temporary E2E role with shared messaging only',
        systemManaged: false,
        permissions: { create: permissions.map(({ id: permissionId }) => ({ permissionId })) },
      },
    });
    limitedRoleId = limitedRole.id;

    const request = await createQuoteRequest({
      idempotencyKey: `staff-messaging-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Staff messaging client ${suffix}`, email: `staff-messaging-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Staff messaging E2E fixture', consentAt: now },
    }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId }, select: { folio: true } })).folio;

    const [manager, limited] = await Promise.all([
      prisma.user.create({ data: { email: `staff-messaging-manager-${suffix}@example.test`, emailNormalized: `staff-messaging-manager-${suffix}@example.test`, displayName: 'Staff messaging manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `staff-messaging-reader-${suffix}@example.test`, emailNormalized: `staff-messaging-reader-${suffix}@example.test`, displayName: 'Staff messaging reader', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: limitedRole.id } } } }),
    ]);
    managerId = manager.id;
    limitedId = limited.id;
    managerToken = `staff-messaging-manager-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    limitedToken = `staff-messaging-reader-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    await Promise.all([
      createSession({ userId: managerId, ipAddress: null, userAgent: 'staff-messaging-e2e' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: limitedId, ipAddress: null, userAgent: 'staff-messaging-e2e' }, { prisma, tokenGenerator: () => limitedToken }),
    ]);

    const actor = {
      userId: managerId,
      type: 'EMPLOYEE' as const,
      clientId: null,
      permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write', 'messaging.manage']),
      mfaVerified: true,
    };
    const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
    await sendStaffMessage(actor, requestId, { body: 'Respuesta compartida del equipo.', idempotencyKey: `staff-shared-${suffix}` }, { prisma, now, rateLimit });
    await createInternalNote(actor, requestId, { body: 'Nota privada de coordinación.', idempotencyKey: `staff-note-${suffix}` }, { prisma, now, rateLimit });
  });

  test.afterAll(async () => {
    if (process.env.STAFF_MESSAGING_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    const conversationIds = conversations.map(({ id }) => id);
    const messageIds = (await prisma.conversationMessage.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } })).map(({ id }) => id);
    const entityIds = [requestId, ...conversationIds, ...messageIds].filter(Boolean);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversationIds].filter(Boolean) } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: entityIds } }, { actorUserId: { in: [managerId, limitedId].filter(Boolean) } }] } });
    if (requestId) await prisma.quoteRequest.delete({ where: { id: requestId } });
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [managerId, limitedId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [managerId, limitedId].filter(Boolean) } } });
    for (const userId of [managerId, limitedId].filter(Boolean)) {
      await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${userId}:${requestId}`) } });
    }
    if (limitedRoleId) await prisma.role.delete({ where: { id: limitedRoleId } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  async function setSession(page: Page, token: string) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);
  }

  test('separates shared messages and private notes for an authorized manager', async ({ page }) => {
    await setSession(page, managerToken);
    const staffPayloads: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', async (response) => {
      if (!response.url().includes('/api/staff/')) return;
      try { staffPayloads.push(await response.text()); } catch { /* response may already be disposed */ }
    });

    await page.goto('/staff/requests');
    await expect(page.getByRole('heading', { name: 'Solicitudes' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(folio) }).click();
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Compartidos/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Notas internas/ })).toBeVisible();
    await expect(page.getByText('Respuesta compartida del equipo.')).toBeVisible();
    await expect(page.getByText('Nota privada de coordinación.')).toBeHidden();

    await page.getByRole('tab', { name: /Notas internas/ }).click();
    await expect(page.getByText('Nota privada de coordinación.')).toBeVisible();
    await expect(page.getByText('Respuesta compartida del equipo.')).toBeHidden();
    await page.getByRole('textbox', { name: 'Nota interna para el equipo' }).fill('Seguimiento interno confirmado.');
    await page.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(page.getByText('Seguimiento interno confirmado.')).toBeVisible();

    await page.getByRole('tab', { name: /Compartidos/ }).click();
    await page.getByRole('textbox', { name: 'Mensaje visible para cliente' }).fill('El equipo comparte la siguiente actualización.');
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByText('El equipo comparte la siguiente actualización.')).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar conversación' }).click();
    await expect(page.getByRole('button', { name: 'Confirmar cierre' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar cierre' }).click();
    await expect(page.locator('.staff-messaging__closed').getByText('Conversación cerrada.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensaje visible para cliente' })).toBeHidden();
    await page.getByRole('button', { name: 'Reabrir conversación' }).click();
    await expect(page.getByRole('button', { name: 'Confirmar reapertura' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar reapertura' }).click();
    await expect(page.locator('.staff-messaging__status')).toHaveText(/Abierta/);

    await expectNoSeriousA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    expect(staffPayloads.join('\n')).not.toContain(managerToken);
  });

  test('hides private-note and management actions for a limited staff role', async ({ page }) => {
    await setSession(page, limitedToken);
    await page.goto('/staff/requests');
    await page.getByRole('button', { name: new RegExp(folio) }).click();
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Compartidos/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Notas internas/ })).toHaveCount(0);
    await expect(page.getByText('Nota privada de coordinación.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar conversación' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Mensaje visible para cliente' })).toBeVisible();
    expect(await page.content()).not.toMatch(/Nota privada de coordinación|clientId|senderUserId/i);
  });
});
