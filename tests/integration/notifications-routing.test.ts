import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { changeRequestBody } from '@/lib/change-request';
import { resolveNotificationEvent } from '@/server/modules/notifications/event-resolver';
import { mapNotificationEvent, type NotificationEventInput } from '@/server/modules/notifications/templates';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('email routing corrections', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const userIds: string[] = [];
  let roleId = '';
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let managerId = '';
  let customerId = '';
  let conversationId = '';
  let storageObjectId = '';
  let fileId = '';

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'requests.read.global' } });
    roleId = (await prisma.role.create({ data: { key: `routing-manager-${suffix}`, name: 'Routing manager', description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: { permissionId: permission.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `routing-${suffix}`, origin: 'PUBLIC_FORM', contact: { displayName: `Sofía ${suffix}`, email: `routing-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca con jacuzzi', location: 'Monterrey', description: 'Fixture de enrutamiento', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    managerId = (await prisma.user.create({ data: { email: `routing-manager-${suffix}@example.test`, emailNormalized: `routing-manager-${suffix}@example.test`, displayName: 'Routing manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId } } } })).id;
    customerId = (await prisma.user.create({ data: { email: `routing-customer-${suffix}@example.test`, emailNormalized: `routing-customer-${suffix}@example.test`, displayName: 'Routing customer', type: 'CUSTOMER', status: 'ACTIVE', clientId } })).id;
    userIds.push(managerId, customerId);
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    conversationId = (await prisma.conversation.create({ data: { quoteRequestId: requestId, clientId } })).id;
  });

  afterAll(async () => {
    if (fileId) await prisma.fileAttachment.delete({ where: { id: fileId } });
    if (storageObjectId) await prisma.storageObject.delete({ where: { id: storageObjectId } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.delete({ where: { id: roleId } });
  });

  const staffContextFor = async (event: NotificationEventInput, userId: string) => {
    const resolution = await resolveNotificationEvent(prisma, event);
    if (resolution.kind !== 'RECIPIENTS') throw new Error(`Expected recipients, got ${resolution.reason}`);
    const context = resolution.contexts.find((candidate) => candidate.recipient.userId === userId);
    if (!context) throw new Error('The manager did not receive the event.');
    return context;
  };

  it('tells managers about a new web request', async () => {
    const event = { eventType: 'REQUEST.RECEIVED', aggregateType: 'QUOTE_REQUEST', aggregateId: requestId, payload: { quoteRequestId: requestId, folio, origin: 'PUBLIC_FORM' } };
    const context = await staffContextFor(event, managerId);
    expect(context).toMatchObject({ senderName: `Sofía ${suffix}`, messagePreview: 'Alberca con jacuzzi en Monterrey' });
    expect(mapNotificationEvent(event, context)).toMatchObject({ kind: 'INTENT', templateKey: 'request.new_for_team' });
  });

  it('never emails someone about a request they took themselves', async () => {
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: managerId } });
    const resolution = await resolveNotificationEvent(prisma, { eventType: 'REQUEST.ASSIGNED', aggregateType: 'QUOTE_REQUEST', aggregateId: requestId, payload: { quoteRequestId: requestId, folio, assignedToId: managerId, assignedById: managerId, mode: 'take' } });
    expect(resolution).toEqual({ kind: 'CANCELLED', reason: 'SELF_ACTION' });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: null } });
  });

  it('sends an unassigned customer message to managers and a change request with its own template', async () => {
    const plain = await prisma.conversationMessage.create({ data: { conversationId, senderUserId: customerId, visibility: 'CUSTOMER', body: '¿Alguien me atiende?' } });
    const plainEvent = { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: conversationId, payload: { conversationId, quoteRequestId: requestId, clientId, messageId: plain.id, visibility: 'CUSTOMER', folio } };
    expect(mapNotificationEvent(plainEvent, await staffContextFor(plainEvent, managerId))).toMatchObject({ templateKey: 'message.created' });

    const change = await prisma.conversationMessage.create({ data: { conversationId, senderUserId: customerId, visibility: 'CUSTOMER', body: changeRequestBody(2, 'Agreguen calentador solar.') } });
    const changeEvent = { ...plainEvent, payload: { ...plainEvent.payload, messageId: change.id } };
    const context = await staffContextFor(changeEvent, managerId);
    expect(context).toMatchObject({ versionNumber: 2, messagePreview: 'Agreguen calentador solar.' });
    expect(mapNotificationEvent(changeEvent, context)).toMatchObject({ templateKey: 'quote.changes_requested', safePayload: expect.objectContaining({ versionNumber: 2 }) });
  });

  it('does not email customers about files they uploaded', async () => {
    const storage = await prisma.storageObject.create({ data: { storageKey: `private-files/routing/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 5n, sha256: 'c'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = storage.id;
    fileId = (await prisma.fileAttachment.create({ data: { quoteRequestId: requestId, clientId, storageObjectId: storage.id, originalFileName: 'plano.pdf', category: 'CLIENT_DOCUMENT', visibility: 'CUSTOMER', status: 'AVAILABLE', uploadedById: customerId } })).id;
    const resolution = await resolveNotificationEvent(prisma, { eventType: 'FILE.AVAILABLE', aggregateType: 'FILE_ATTACHMENT', aggregateId: fileId, payload: { fileId, quoteRequestId: requestId, visibility: 'CUSTOMER', category: 'CLIENT_DOCUMENT' } });
    expect(resolution).toEqual({ kind: 'CANCELLED', reason: 'SELF_ACTION' });
  });
});
