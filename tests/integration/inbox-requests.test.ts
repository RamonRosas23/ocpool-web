import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { assignQuoteRequest, closeQuoteRequest, reopenQuoteRequest, requestInformationQuoteRequest, takeQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const actor = (userId: string, permissions: string[]): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(permissions), mfaVerified: true });

describe('inbox rules for requests', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let managerId = '';
  let otherSalesId = '';
  let bystanderId = '';
  let customerId = '';

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function employee(name: string, roleId: string | null): Promise<string> {
    const email = `inbox-req-${name}-${suffix}@example.test`;
    const user = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(user.id);
    return user.id;
  }

  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId, quoteRequestId: requestId } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const poolRole = await role('inbox-pool', ['requests.read', 'requests.claim', 'requests.assign', 'requests.status.update', 'messaging.send', 'messaging.read']);
    const managerRole = await role('inbox-manager', ['requests.read', 'requests.read.global', 'requests.assign', 'requests.reassign', 'requests.status.update']);
    salesId = await employee('sales', poolRole);
    otherSalesId = await employee('other', poolRole);
    managerId = await employee('manager', managerRole);
    bystanderId = await employee('bystander', null);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-requests-${suffix}`, origin: 'PUBLIC_FORM', contact: { displayName: `Cliente ${suffix}`, email: `inbox-req-client-${suffix}@example.test` }, detail: { projectType: 'Alberca con jacuzzi', location: 'Monterrey', description: 'Fixture de reglas de solicitudes', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const customer = await prisma.user.create({ data: { email: `inbox-req-customer-${suffix}@example.test`, emailNormalized: `inbox-req-customer-${suffix}@example.test`, displayName: `Cliente ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId } });
    customerId = customer.id;
    userIds.push(customer.id);
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
  });

  afterAll(async () => {
    if (requestId) {
      await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      await prisma.quoteRequest.delete({ where: { id: requestId } });
    }
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('alerts the whole pool about a web lead and nobody else', async () => {
    for (const recipientId of [salesId, otherSalesId, managerId]) {
      const [notice] = await inboxOf(recipientId);
      expect(notice, recipientId).toMatchObject({ kind: 'request.new_unassigned', priority: 'HIGH', actionRequired: true, groupKey: `pool:${requestId}`, title: 'Nueva solicitud: Alberca con jacuzzi en Monterrey' });
    }
    expect(await inboxOf(bystanderId)).toHaveLength(0);
  });

  it('resolves the pool when someone takes it and never notifies the taker', async () => {
    await takeQuoteRequest(actor(salesId, ['requests.read', 'requests.claim']), requestId, {}, { prisma, now });
    const [mine] = await inboxOf(salesId);
    const [theirs] = await inboxOf(otherSalesId);
    expect(mine).toMatchObject({ kind: 'request.new_unassigned', resolvedNote: 'La tomaste' });
    expect(theirs).toMatchObject({ resolvedNote: `Tomada por sales ${suffix}` });
    expect((await inboxOf(salesId)).some((row) => row.kind === 'request.assigned_to_you')).toBe(false);
  });

  it('tells the new owner and the previous one on a reassignment', async () => {
    await assignQuoteRequest(actor(managerId, ['requests.read', 'requests.read.global', 'requests.assign', 'requests.reassign']), requestId, { assignedToId: otherSalesId, reason: 'Balance de carga' }, { prisma, now });
    expect(await inboxOf(otherSalesId)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'request.assigned_to_you', title: expect.stringContaining(`manager ${suffix} te asignó`) })]));
    // El aviso de "te lo quitaron" no depende del expediente: queda visible aunque ya no lo pueda abrir.
    const lost = await prisma.inboxNotification.findFirst({ where: { recipientId: salesId, kind: 'request.unassigned_from_you' } });
    expect(lost).toMatchObject({ quoteRequestId: null, actionPath: '/staff/requests', title: expect.stringContaining(`a other ${suffix}`) });
  });

  it('tells the owner when someone else closes or reopens the file', async () => {
    const managerActor = actor(managerId, ['requests.read', 'requests.read.global', 'requests.status.update']);
    await closeQuoteRequest(managerActor, requestId, { reason: 'CHOSE_ALTERNATIVE' }, { prisma, now });
    await reopenQuoteRequest(managerActor, requestId, {}, { prisma, now: new Date(now.getTime() + 1000) });
    const kinds = (await inboxOf(otherSalesId)).map((row) => row.kind);
    expect(kinds).toEqual(expect.arrayContaining(['request.closed', 'request.reopened']));
    expect((await inboxOf(otherSalesId)).find((row) => row.kind === 'request.closed')).toMatchObject({ body: 'Motivo: Eligió otra opción' });
  });

  it('asks the customer for information without also sending a team-activity notice', async () => {
    await requestInformationQuoteRequest(actor(otherSalesId, ['requests.read', 'requests.status.update', 'messaging.send']), requestId, { message: 'Necesitamos las medidas del terreno.', missingFields: ['detail.dimensions'], idempotencyKey: `inbox-info-${suffix}` }, { prisma, now: new Date(now.getTime() + 2000) });
    const customerInbox = await inboxOf(customerId);
    expect(customerInbox.map((row) => row.kind)).toEqual(['request.information_needed']);
    expect(customerInbox[0]).toMatchObject({ actionRequired: true, groupKey: `info:${requestId}`, body: '“Necesitamos las medidas del terreno.”', actionPath: `/portal?request=${requestId}` });
  });
});
