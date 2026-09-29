import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { reportDeliveryFailure, reportDeliveryRecovered } from '@/server/modules/notifications/delivery-inbox';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('failed customer email reaches the inbox', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const userIds: string[] = [];
  let roleId = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let assigneeId = '';
  let managerId = '';

  const delivery = (actionPath: string) => ({ id: randomUUID(), templateKey: 'quote.version_sent' as const, payload: { actionPath }, outboxEvent: { eventType: 'QUOTE.PUBLISHED', aggregateType: 'QUOTE', aggregateId: null, payload: { quoteRequestId: requestId } } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'requests.read.global' } });
    roleId = (await prisma.role.create({ data: { key: `bounce-manager-${suffix}`, name: 'Bounce manager', description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: { permissionId: permission.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `bounce-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Cliente ${suffix}`, email: `bounce-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Chihuahua', description: 'Fixture de rebotes', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    assigneeId = (await prisma.user.create({ data: { email: `bounce-assignee-${suffix}@example.test`, emailNormalized: `bounce-assignee-${suffix}@example.test`, displayName: 'Bounce assignee', type: 'EMPLOYEE', status: 'ACTIVE' } })).id;
    managerId = (await prisma.user.create({ data: { email: `bounce-manager-${suffix}@example.test`, emailNormalized: `bounce-manager-${suffix}@example.test`, displayName: 'Bounce manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId } } } })).id;
    userIds.push(assigneeId, managerId);
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: assigneeId } });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.delete({ where: { id: roleId } });
  });

  it('warns the assignee urgently and managers quietly, then closes the warning once a retry succeeds', async () => {
    const folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    await reportDeliveryFailure(prisma, delivery(`/portal?request=${requestId}`), now);
    await reportDeliveryFailure(prisma, delivery(`/staff/requests?request=${requestId}`), now);
    const [assigneeNotice] = await prisma.inboxNotification.findMany({ where: { recipientId: assigneeId } });
    expect(assigneeNotice).toMatchObject({ kind: 'email.delivery_failed', priority: 'URGENT', title: `No se pudo entregar un correo a Cliente ${suffix}`, body: `Cotización enviada al cliente · ${folio} · Revisa el correo del contacto` });
    expect(await prisma.inboxNotification.findFirst({ where: { recipientId: managerId } })).toMatchObject({ priority: 'NORMAL' });
    await reportDeliveryRecovered(prisma, delivery(`/portal?request=${requestId}`), now);
    expect(await prisma.inboxNotification.findMany({ where: { recipientId: { in: [assigneeId, managerId] } } })).toEqual(expect.arrayContaining([expect.objectContaining({ resolvedNote: 'El correo se entregó al reintentar' })]));
    expect(await prisma.inboxNotification.count({ where: { recipientId: { in: [assigneeId, managerId] }, resolvedAt: null } })).toBe(0);
  });
});
