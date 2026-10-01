import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { getCustomerQuoteRequest } from '@/server/modules/client-portal/service';
import { seedIdentityCatalog } from '../../prisma/seed';

describe('customer portal signals', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  let requestId = '';
  let foreignRequestId = '';
  let clientId = '';
  let foreignClientId = '';
  let contactId = '';
  let foreignContactId = '';
  let staffId = '';
  let managerId = '';
  let customerId = '';
  let quoteId = '';
  let quoteVersionId = '';

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const request = await createQuoteRequest({ idempotencyKey: `customer-portal-signals-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal contact ${suffix}`, email: `portal-signal-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Chihuahua', description: 'Fixture de señales del portal', consentAt: now } }, { prisma, now });
    const foreignRequest = await createQuoteRequest({ idempotencyKey: `customer-portal-signals-foreign-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Portal foreign contact ${suffix}`, email: `portal-signal-foreign-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Expediente de otro cliente', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    foreignRequestId = foreignRequest.quoteRequestId;
    clientId = request.clientId;
    foreignClientId = foreignRequest.clientId;
    contactId = request.contactId;
    foreignContactId = foreignRequest.contactId;
    const staffEmail = `portal-signal-staff-${suffix}@example.test`;
    staffId = (await prisma.user.create({ data: { email: staffEmail, emailNormalized: staffEmail, displayName: `Staff ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE' } })).id;
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const managerEmail = `portal-signal-manager-${suffix}@example.test`;
    managerId = (await prisma.user.create({ data: { email: managerEmail, emailNormalized: managerEmail, displayName: `Manager ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    const customerEmail = `portal-signal-customer-${suffix}@example.test`;
    customerId = (await prisma.user.create({ data: { email: customerEmail, emailNormalized: customerEmail, displayName: `Cliente ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'COTIZACION_DISPONIBLE', currentAssigneeId: staffId } });
    quoteId = (await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } })).id;
    const terms = await prisma.commercialTermsVersion.findFirstOrThrow({ where: { active: true }, select: { id: true } });
    quoteVersionId = (await prisma.quoteVersion.create({ data: { quoteId, currencyCode: 'MXN', createdById: staffId, status: 'ENVIADA', publishedAt: now, termsVersionId: terms.id } })).id;
    await prisma.quote.update({ where: { id: quoteId }, data: { publishedVersionId: quoteVersionId } });
  });

  afterAll(async () => {
    await prisma.inboxNotification.deleteMany({ where: { recipientId: { in: [staffId, managerId, customerId] } } });
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, foreignRequestId] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestId, foreignRequestId, quoteId, quoteVersionId] } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: [requestId, foreignRequestId] } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: [contactId, foreignContactId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, managerId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, foreignClientId] } } });
  });

  it('records first and latest view timestamps, emits one notice under concurrent opens, and enforces request scope', async () => {
    const customerActor = { userId: customerId, type: 'CUSTOMER' as const, clientId, permissionKeys: new Set(['portal.self.read']), mfaVerified: true };
    const first = new Date(now.getTime() + 1000);
    const second = new Date(now.getTime() + 2000);
    await getCustomerQuoteRequest(customerActor, requestId, { prisma, now: first });
    await getCustomerQuoteRequest(customerActor, requestId, { prisma, now: second });
    await Promise.all([
      getCustomerQuoteRequest(customerActor, requestId, { prisma, now: new Date(now.getTime() + 3000) }),
      getCustomerQuoteRequest(customerActor, requestId, { prisma, now: new Date(now.getTime() + 4000) }),
    ]);
    const view = await prisma.quoteVersionView.findUniqueOrThrow({ where: { quoteVersionId_userId: { quoteVersionId, userId: customerId } } });
    expect(view.firstViewedAt).toEqual(first);
    expect(view.lastViewedAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 4000);
    expect(await prisma.inboxNotification.findMany({ where: { recipientId: staffId, kind: 'quote.viewed' } })).toEqual([expect.objectContaining({ priority: 'INFO', title: `Cliente ${suffix} abrió la propuesta V1` })]);
    expect(await prisma.inboxNotification.count({ where: { recipientId: customerId, kind: 'quote.viewed' } })).toBe(0);
    expect(await prisma.inboxNotification.count({ where: { recipientId: managerId, kind: 'quote.viewed' } })).toBe(0);
    await expect(getCustomerQuoteRequest(customerActor, foreignRequestId, { prisma, now: second })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('notifies the responsible employee when the customer activates the portal for an open request', async () => {
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'CUSTOMER.PORTAL_ACTIVATED', aggregateType: 'CLIENT', aggregateId: clientId, payload: { clientId } }, { now }));
    expect(await prisma.inboxNotification.findMany({ where: { recipientId: staffId, kind: 'customer.portal_activated' } })).toEqual([expect.objectContaining({ priority: 'INFO', title: `Cliente ${suffix} activó su portal` })]);
    expect(await prisma.inboxNotification.count({ where: { recipientId: customerId, kind: 'customer.portal_activated' } })).toBe(0);
    await prisma.inboxNotification.deleteMany({ where: { recipientId: staffId, kind: 'customer.portal_activated' } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'PENDIENTE_DE_APROBACION' } });
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'CUSTOMER.PORTAL_ACTIVATED', aggregateType: 'CLIENT', aggregateId: clientId, payload: { clientId } }, { now }));
    expect(await prisma.inboxNotification.count({ where: { kind: 'customer.portal_activated', recipientId: staffId } })).toBe(1);
    await prisma.inboxNotification.deleteMany({ where: { recipientId: staffId, kind: 'customer.portal_activated' } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'ACEPTADA' } });
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'CUSTOMER.PORTAL_ACTIVATED', aggregateType: 'CLIENT', aggregateId: clientId, payload: { clientId } }, { now }));
    expect(await prisma.inboxNotification.count({ where: { kind: 'customer.portal_activated', recipientId: staffId } })).toBe(0);
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'COTIZACION_DISPONIBLE' } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: null } });
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'CUSTOMER.PORTAL_ACTIVATED', aggregateType: 'CLIENT', aggregateId: clientId, payload: { clientId } }, { now }));
    expect(await prisma.inboxNotification.count({ where: { kind: 'customer.portal_activated', recipientId: { in: [staffId, managerId] } } })).toBe(0);
  });
});
