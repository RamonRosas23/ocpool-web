import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('customer portal signals', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let staffId = '';
  let customerId = '';
  let quoteId = '';
  let quoteVersionId = '';

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const request = await createQuoteRequest({ idempotencyKey: `customer-portal-signals-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal contact ${suffix}`, email: `portal-signal-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Chihuahua', description: 'Fixture de señales del portal', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const staffEmail = `portal-signal-staff-${suffix}@example.test`;
    staffId = (await prisma.user.create({ data: { email: staffEmail, emailNormalized: staffEmail, displayName: `Staff ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE' } })).id;
    const customerEmail = `portal-signal-customer-${suffix}@example.test`;
    customerId = (await prisma.user.create({ data: { email: customerEmail, emailNormalized: customerEmail, displayName: `Cliente ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'COTIZACION_DISPONIBLE', currentAssigneeId: staffId } });
    quoteId = (await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } })).id;
    quoteVersionId = (await prisma.quoteVersion.create({ data: { quoteId, currencyCode: 'MXN', createdById: staffId, status: 'ENVIADA', publishedAt: now } })).id;
  });

  afterAll(async () => {
    await prisma.inboxNotification.deleteMany({ where: { recipientId: { in: [staffId, customerId] } } });
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, customerId] } } });
    await prisma.client.delete({ where: { id: clientId } });
  });

  it('notifies only the responsible employee when the customer first views a quote', async () => {
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'QUOTE.VIEWED', aggregateType: 'QUOTE', aggregateId: quoteId, payload: { quoteRequestId: requestId, quoteVersionId } }, { now }));
    expect(await prisma.inboxNotification.findMany({ where: { recipientId: staffId, kind: 'quote.viewed' } })).toEqual([expect.objectContaining({ priority: 'INFO', title: `Cliente ${suffix} abrió la propuesta V1` })]);
    expect(await prisma.inboxNotification.count({ where: { recipientId: customerId, kind: 'quote.viewed' } })).toBe(0);
  });

  it('notifies the responsible employee when the customer activates the portal for an open request', async () => {
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'CUSTOMER.PORTAL_ACTIVATED', aggregateType: 'CLIENT', aggregateId: clientId, payload: { clientId } }, { now }));
    expect(await prisma.inboxNotification.findMany({ where: { recipientId: staffId, kind: 'customer.portal_activated' } })).toEqual([expect.objectContaining({ priority: 'INFO', title: `Cliente ${suffix} activó su portal` })]);
    expect(await prisma.inboxNotification.count({ where: { recipientId: customerId, kind: 'customer.portal_activated' } })).toBe(0);
  });
});
