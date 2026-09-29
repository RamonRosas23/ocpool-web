import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';
import { changeRequestBody } from '@/lib/change-request';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { createInternalNote, sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { requestInformationQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const staffPermissions = ['requests.read', 'requests.read.global', 'requests.status.update', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write'];
const staffActor = (userId: string): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(staffPermissions), mfaVerified: true });
const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });

describe('inbox rules for messages and files', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let assigneeId = '';
  let colleagueId = '';
  let managerId = '';
  let customerId = '';
  let storageObjectId = '';
  let fileId = '';
  let customerActor: Actor;

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function user(name: string, type: 'EMPLOYEE' | 'CUSTOMER', roleId?: string): Promise<string> {
    const email = `inbox-msg-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type, status: 'ACTIVE', ...(type === 'CUSTOMER' ? { clientId } : {}), ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(created.id);
    return created.id;
  }

  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId, quoteRequestId: requestId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const staffRole = await role('inbox-msg-staff', ['requests.read', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write']);
    const managerRole = await role('inbox-msg-manager', ['requests.read', 'requests.read.global']);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-messages-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Laura ${suffix}`, email: `inbox-msg-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Zapopan', description: 'Fixture de reglas de mensajes', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    assigneeId = await user('assignee', 'EMPLOYEE', staffRole);
    colleagueId = await user('colleague', 'EMPLOYEE', staffRole);
    managerId = await user('manager', 'EMPLOYEE', managerRole);
    customerId = await user('customer', 'CUSTOMER');
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: assigneeId, status: 'EN_REVISION' } });
    customerActor = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
  });

  afterAll(async () => {
    if (fileId) await prisma.fileAttachment.delete({ where: { id: fileId } });
    if (storageObjectId) await prisma.storageObject.delete({ where: { id: storageObjectId } });
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('groups two customer messages into one notice for the assignee only', async () => {
    await sendCustomerMessage(customerActor, requestId, { body: 'Hola, ¿cómo va la propuesta?', idempotencyKey: `inbox-msg-1-${suffix}` }, { prisma, now, rateLimit });
    await sendCustomerMessage(customerActor, requestId, { body: 'Te comparto el plano con las medidas finales.', idempotencyKey: `inbox-msg-2-${suffix}` }, { prisma, now: new Date(now.getTime() + 1000), rateLimit });
    const inbox = await inboxOf(assigneeId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'customer.activity', priority: 'HIGH', occurrences: 2, title: `customer ${suffix} te escribió 2 mensajes`, body: '“Te comparto el plano con las medidas finales.”' });
    expect(await inboxOf(colleagueId)).toHaveLength(0);
    expect(await inboxOf(customerId)).toHaveLength(0);
  });

  it('adds a customer upload to the same open notice', async () => {
    const storage = await prisma.storageObject.create({ data: { storageKey: `private-files/inbox-msg/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 5n, sha256: 'd'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = storage.id;
    const file = await prisma.fileAttachment.create({ data: { quoteRequestId: requestId, clientId, storageObjectId: storage.id, originalFileName: 'plano.pdf', category: 'CLIENT_DOCUMENT', visibility: 'CUSTOMER', status: 'AVAILABLE', uploadedById: customerId } });
    fileId = file.id;
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'FILE.AVAILABLE', aggregateType: 'FILE_ATTACHMENT', aggregateId: file.id, payload: { fileId: file.id, quoteRequestId: requestId, visibility: 'CUSTOMER', category: 'CLIENT_DOCUMENT' } }, { now }));
    const [notice] = await inboxOf(assigneeId);
    expect(notice).toMatchObject({ occurrences: 3, title: `customer ${suffix} subió un archivo y dejó 2 mensajes`, body: 'Archivo: plano.pdf' });
  });

  it('tells the customer about a team reply and never echoes it to its author', async () => {
    await sendStaffMessage(staffActor(assigneeId), requestId, { body: 'Ya revisamos el plano, gracias.', idempotencyKey: `inbox-msg-staff-${suffix}` }, { prisma, now, rateLimit });
    expect(await inboxOf(customerId)).toEqual([expect.objectContaining({ kind: 'team.activity', title: 'El equipo OCPOOL te escribió', actionPath: `/portal?request=${requestId}` })]);
    expect((await inboxOf(assigneeId)).filter((row) => row.kind === 'team.activity')).toHaveLength(0);
  });

  it('flags a change request as urgent for the assignee and informs managers', async () => {
    await sendCustomerMessage(customerActor, requestId, { body: changeRequestBody(1, '¿Pueden incluir calentador solar?'), idempotencyKey: `inbox-msg-change-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(assigneeId)).find((row) => row.kind === 'quote.changes_requested')).toMatchObject({ priority: 'URGENT', actionRequired: true, title: `customer ${suffix} pidió cambios a la propuesta V1`, body: '“¿Pueden incluir calentador solar?”' });
    expect((await inboxOf(managerId)).find((row) => row.kind === 'quote.changes_requested')).toMatchObject({ priority: 'NORMAL', actionRequired: false });
  });

  it('routes internal notes to the assignee and to recent note participants, never to their author', async () => {
    await createInternalNote(staffActor(colleagueId), requestId, { body: 'Ojo con el acceso para maquinaria.', idempotencyKey: `inbox-note-1-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(assigneeId)).find((row) => row.kind === 'note.internal')).toMatchObject({ title: `colleague ${suffix} dejó una nota interna en ${(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio}` });
    await createInternalNote(staffActor(assigneeId), requestId, { body: 'Enterado, lo reviso.', idempotencyKey: `inbox-note-2-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(colleagueId)).find((row) => row.kind === 'note.internal')).toMatchObject({ body: '“Enterado, lo reviso.”' });
    expect((await inboxOf(assigneeId)).filter((row) => row.kind === 'note.internal')).toHaveLength(1);
    expect((await inboxOf(customerId)).some((row) => row.kind === 'note.internal')).toBe(false);
  });

  it('closes the information request when the customer answers', async () => {
    await requestInformationQuoteRequest(staffActor(assigneeId), requestId, { message: 'Necesitamos las medidas del terreno.', missingFields: ['detail.dimensions'], idempotencyKey: `inbox-msg-info-${suffix}` }, { prisma, now });
    await sendCustomerMessage(customerActor, requestId, { body: 'Son 8 por 4 metros.', idempotencyKey: `inbox-msg-answer-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(customerId)).find((row) => row.kind === 'request.information_needed')).toMatchObject({ resolvedNote: 'Respondiste' });
  });

  it('sends customer activity to the pool when nobody owns the file', async () => {
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: null } });
    await sendCustomerMessage(customerActor, requestId, { body: '¿Alguien me puede atender?', idempotencyKey: `inbox-msg-pool-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(managerId)).find((row) => row.kind === 'customer.activity')).toMatchObject({ body: '“¿Alguien me puede atender?”' });
  });
});
