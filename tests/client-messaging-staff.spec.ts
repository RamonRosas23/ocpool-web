import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createInternalNote, sendStaffMessage } from '@/server/modules/messaging/service';
import { completePrivateFile, reservePrivateFile } from '@/server/modules/private-files/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('staff messaging opt-in flow', () => {
  test.skip(process.env.STAFF_MESSAGING_E2E !== '1', 'Staff messaging E2E requires STAFF_MESSAGING_E2E=1 and a disposable local database.');

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date('2026-09-08T12:00:00.000Z');
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let managerId = '';
  let limitedId = '';
  let limitedRoleId = '';
  let managerToken = '';
  let limitedToken = '';
  const fileIds: string[] = [];

  test.beforeAll(async () => {
    if (process.env.STAFF_MESSAGING_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: ['requests.read', 'messaging.read', 'messaging.send', 'files.read', 'files.download'] } }, select: { id: true } });
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

    const fileActor = { ...actor, permissionKeys: new Set([...actor.permissionKeys, 'files.read', 'files.upload', 'files.download', 'files.delete', 'files.internal.read', 'files.manage']) };
    const storage = getPrivateStorage();
    for (const [originalFileName, category, visibility] of [
      ['referencia-compartida.pdf', 'CLIENT_DOCUMENT', 'CUSTOMER'],
      ['nota-interna.pdf', 'INTERNAL_DOCUMENT', 'INTERNAL'],
    ] as const) {
      const reservation = await reservePrivateFile(fileActor, { quoteRequestId: requestId, originalFileName, contentType: 'application/pdf', byteSize: 5, category, visibility, idempotencyKey: `staff-file-${visibility.toLowerCase()}-${suffix}` }, { prisma, now, rateLimit });
      const upload = await fetch(reservation.uploadUrl!, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: Buffer.from('%PDF-') });
      if (!upload.ok) throw new Error(`Unable to seed ${originalFileName}.`);
      await completePrivateFile(fileActor, requestId, reservation.file.id, { prisma, storage, now });
      fileIds.push(reservation.file.id);
    }
  });

  test.afterAll(async () => {
    if (process.env.STAFF_MESSAGING_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    const conversationIds = conversations.map(({ id }) => id);
    const messageIds = (await prisma.conversationMessage.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } })).map(({ id }) => id);
    const attachments = await prisma.fileAttachment.findMany({ where: { quoteRequestId: requestId }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
    const storage = getPrivateStorage();
    for (const { storageObject } of attachments) await storage.delete(storageObject.storageKey);
    await prisma.fileAttachment.deleteMany({ where: { id: { in: attachments.map(({ id }) => id) } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: attachments.map(({ storageObjectId }) => storageObjectId) } } });
    const entityIds = [requestId, ...conversationIds, ...messageIds, ...fileIds].filter(Boolean);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversationIds, ...fileIds].filter(Boolean) } } });
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
    await expect(page.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
    const filesPanel = page.locator('.staff-files');
    const messagingPanel = page.locator('.staff-messaging');
    await expect(filesPanel.getByRole('tab', { name: /Compartidos/ })).toBeVisible();
    await expect(filesPanel.getByRole('tab', { name: /Internos/ })).toBeVisible();
    await expect(page.getByText('referencia-compartida.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('nota-interna.pdf', { exact: true })).toBeHidden();
    const sharedFilesTab = filesPanel.getByRole('tab', { name: /Compartidos/ });
    const internalFilesTab = filesPanel.getByRole('tab', { name: /Internos/ });
    await sharedFilesTab.focus();
    await sharedFilesTab.press('ArrowRight');
    await expect(internalFilesTab).toBeFocused();
    await expect(internalFilesTab).toHaveAttribute('aria-selected', 'true');
    await filesPanel.getByRole('tab', { name: /Internos/ }).click();
    await expect(page.getByText('nota-interna.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('referencia-compartida.pdf', { exact: true })).toBeHidden();
    await filesPanel.getByRole('tab', { name: /Compartidos/ }).click();
    await expect(filesPanel.getByRole('button', { name: 'Descargar referencia-compartida.pdf' })).toBeVisible();
    await filesPanel.getByRole('button', { name: 'Añadir archivo' }).click();
    const storageUploadPattern = '**/*';
    await page.route(storageUploadPattern, async (route) => {
      if (route.request().method() === 'PUT' && new URL(route.request().url()).port === '19000') await route.abort();
      else await route.continue();
    });
    await filesPanel.locator('input[type="file"]').setInputFiles({ name: 'staff-retry.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') });
    await filesPanel.getByRole('button', { name: 'Cargar archivo' }).click();
    await expect(filesPanel.getByRole('button', { name: 'Reintentar carga' })).toBeVisible();
    await page.unroute(storageUploadPattern);
    await filesPanel.getByRole('button', { name: 'Reintentar carga' }).click();
    await expect(filesPanel.getByTitle('staff-retry.pdf')).toBeVisible();
    await filesPanel.getByRole('button', { name: 'Añadir archivo' }).click();
    await filesPanel.locator('input[type="file"]').setInputFiles({ name: 'staff-upload.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') });
    await filesPanel.getByRole('button', { name: 'Cargar archivo' }).click();
    await expect(filesPanel.getByText('staff-upload.pdf', { exact: true })).toBeVisible();
    const uploadedRow = filesPanel.locator('.staff-file').filter({ hasText: 'staff-upload.pdf' });
    await uploadedRow.getByRole('button', { name: 'Eliminar archivo' }).click();
    await uploadedRow.getByRole('button', { name: 'Confirmar eliminación' }).click();
    await expect(uploadedRow).toHaveCount(0);
    await expect(messagingPanel.getByRole('tab', { name: /Compartidos/ })).toBeVisible();
    await expect(messagingPanel.getByRole('tab', { name: /Notas internas/ })).toBeVisible();
    await expect(page.getByText('Respuesta compartida del equipo.')).toBeVisible();
    await expect(page.getByText('Nota privada de coordinación.')).toBeHidden();

    const sharedMessagesTab = messagingPanel.getByRole('tab', { name: /Compartidos/ });
    const internalMessagesTab = messagingPanel.getByRole('tab', { name: /Notas internas/ });
    await sharedMessagesTab.focus();
    await sharedMessagesTab.press('ArrowRight');
    await expect(internalMessagesTab).toBeFocused();
    await expect(internalMessagesTab).toHaveAttribute('aria-selected', 'true');
    await messagingPanel.getByRole('tab', { name: /Notas internas/ }).click();
    await expect(page.getByText('Nota privada de coordinación.')).toBeVisible();
    await expect(page.getByText('Respuesta compartida del equipo.')).toBeHidden();
    await page.getByRole('textbox', { name: 'Nota interna para el equipo' }).fill('Seguimiento interno confirmado.');
    await page.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(page.getByRole('textbox', { name: 'Nota interna para el equipo' })).toHaveValue('', { timeout: 20_000 });
    await expect(messagingPanel.locator('.staff-message').filter({ hasText: 'Seguimiento interno confirmado.' })).toBeVisible();

    await messagingPanel.getByRole('tab', { name: /Compartidos/ }).click();
    await messagingPanel.getByRole('textbox', { name: 'Mensaje visible para cliente' }).fill('El equipo comparte la siguiente actualización.');
    await messagingPanel.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('textbox', { name: 'Mensaje visible para cliente' })).toHaveValue('', { timeout: 20_000 });
    await expect(messagingPanel.locator('.staff-message').filter({ hasText: 'El equipo comparte la siguiente actualización.' })).toBeVisible();

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
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}px`).toBe(true);
    }
    expect(consoleErrors.filter((message) => !message.includes('net::ERR_FAILED'))).toEqual([]);
    expect(staffPayloads.join('\n')).not.toContain(managerToken);
  });

  test('hides private-note and management actions for a limited staff role', async ({ page }) => {
    await setSession(page, limitedToken);
    await page.goto('/staff/requests');
    await page.getByRole('button', { name: new RegExp(folio) }).click();
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
    const filesPanel = page.locator('.staff-files');
    await expect(filesPanel.getByRole('tab', { name: /Compartidos/ })).toBeVisible();
    await expect(filesPanel.getByRole('tab', { name: /Internos/ })).toHaveCount(0);
    await expect(page.getByText('referencia-compartida.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('nota-interna.pdf', { exact: true })).toHaveCount(0);
    await expect(filesPanel.getByRole('button', { name: 'Añadir archivo' })).toHaveCount(0);
    await expect(filesPanel.getByRole('button', { name: /Eliminar archivo/ })).toHaveCount(0);
    const messagingPanel = page.locator('.staff-messaging');
    await expect(messagingPanel.getByRole('tab', { name: /Compartidos/ })).toBeVisible();
    await expect(messagingPanel.getByRole('tab', { name: /Notas internas/ })).toHaveCount(0);
    await expect(page.getByText('Nota privada de coordinación.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar conversación' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Mensaje visible para cliente' })).toBeVisible();
    expect(await page.content()).not.toMatch(/Nota privada de coordinación|nota-interna\.pdf|clientId|senderUserId|storageKey/i);
  });
});
