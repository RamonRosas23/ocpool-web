import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { recordInboxIntents, type InboxIntent } from '@/server/modules/inbox/record';
import { processInboxDigestDueBatch } from '@/server/modules/notifications/inbox-digest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('delayed inbox activity email', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const scheduledAt = new Date('2026-09-08T12:00:00.000Z');
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let staffId = '';
  let replacementStaffId = '';
  let customerId = '';

  const staffIntent = (groupKey: string, overrides: Partial<InboxIntent> = {}): InboxIntent => ({
    recipientId: staffId,
    kind: 'customer.activity',
    priority: 'HIGH',
    quoteRequestId: requestId,
    actorId: customerId,
    groupKey,
    actionPath: `/staff/requests?request=${requestId}`,
    actionRequired: false,
    data: { folio: 'OCQ-2026-000001', clientName: 'Cliente digest', actorName: 'Ana', messages: 1, files: 0, preview: '¿Cómo va mi solicitud?' },
    ...overrides,
  });

  const customerIntent = (groupKey: string, overrides: Partial<InboxIntent> = {}): InboxIntent => ({
    recipientId: customerId,
    kind: 'team.activity',
    priority: 'HIGH',
    quoteRequestId: requestId,
    actorId: staffId,
    groupKey,
    actionPath: `/portal?request=${requestId}`,
    actionRequired: false,
    data: { folio: 'OCQ-2026-000001', projectType: 'Alberca residencial', messages: 1, files: 0, preview: 'Ya revisamos tu solicitud.' },
    ...overrides,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    const request = await createQuoteRequest({
      idempotencyKey: `notification-digest-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Digest contact ${suffix}`, email: `digest-contact-${suffix}@example.test` },
      detail: { projectType: 'Alberca residencial', location: 'Chihuahua', description: 'Inbox digest fixture', consentAt: scheduledAt },
    }, { prisma, now: scheduledAt });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const [staff, replacement, customer] = await Promise.all([
      prisma.user.create({ data: { email: `digest-staff-${suffix}@example.test`, emailNormalized: `digest-staff-${suffix}@example.test`, displayName: 'Digest staff', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `digest-replacement-${suffix}@example.test`, emailNormalized: `digest-replacement-${suffix}@example.test`, displayName: 'Replacement staff', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `digest-customer-${suffix}@example.test`, emailNormalized: `digest-customer-${suffix}@example.test`, displayName: 'Digest customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } }),
    ]);
    staffId = staff.id;
    replacementStaffId = replacement.id;
    customerId = customer.id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: staffId } });
  });

  afterAll(async () => {
    if (!requestId) return;
    const notices = await prisma.inboxNotification.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    const notificationIds = notices.map(({ id }) => id);
    const events = await prisma.outboxEvent.findMany({ where: { eventType: 'INBOX.DIGEST_DUE', aggregateId: { in: notificationIds } }, select: { id: true } });
    await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: { in: events.map(({ id }) => id) } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: events.map(({ id }) => id) } } });
    await prisma.inboxNotification.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.inboxPreference.deleteMany({ where: { userId: { in: [staffId, replacementStaffId, customerId] } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, replacementStaffId, customerId] } } });
    await prisma.client.delete({ where: { id: clientId } });
  });

  it('schedules 10 and 15 minutes once, and does not reschedule grouped activity', async () => {
    const recorded = await prisma.$transaction((tx) => recordInboxIntents(tx, [
      staffIntent(`digest-staff:${suffix}`),
      customerIntent(`digest-customer:${suffix}`),
    ], scheduledAt));
    expect(recorded.map(({ mode }) => mode)).toEqual(['created', 'created']);

    const staffNotice = await prisma.inboxNotification.findUniqueOrThrow({ where: { id: recorded[0].id } });
    const customerNotice = await prisma.inboxNotification.findUniqueOrThrow({ where: { id: recorded[1].id } });
    const events = await prisma.outboxEvent.findMany({ where: { eventType: 'INBOX.DIGEST_DUE', aggregateId: { in: [staffNotice.id, customerNotice.id] } } });
    const byNotification = new Map(events.map((event) => [event.aggregateId, event]));
    expect(byNotification.get(staffNotice.id)?.availableAt.getTime()).toBe(scheduledAt.getTime() + readServerEnv().INBOX_DIGEST_DELAY_STAFF_MINUTES * 60_000);
    expect(byNotification.get(customerNotice.id)?.availableAt.getTime()).toBe(scheduledAt.getTime() + readServerEnv().INBOX_DIGEST_DELAY_CUSTOMER_MINUTES * 60_000);
    const originalAvailableAt = new Map(events.map((event) => [event.id, event.availableAt.getTime()]));

    await expect(prisma.$transaction((tx) => recordInboxIntents(tx, [staffIntent(`digest-staff:${suffix}`, { data: { folio: 'OCQ-2026-000001', clientName: 'Cliente digest', actorName: 'Ana', messages: 2, files: 0, preview: 'Tengo una actualización.' } })], new Date(scheduledAt.getTime() + 5 * 60_000)))).resolves.toMatchObject([{ id: staffNotice.id, mode: 'updated' }]);
    const afterGroupUpdate = await prisma.outboxEvent.findMany({ where: { eventType: 'INBOX.DIGEST_DUE', aggregateId: { in: [staffNotice.id, customerNotice.id] } } });
    expect(afterGroupUpdate).toHaveLength(2);
    for (const event of afterGroupUpdate) expect(event.availableAt.getTime()).toBe(originalAvailableAt.get(event.id));
  });

  it('materializes one activity.digest delivery for each notice that is still unread', async () => {
    const dueAt = new Date(scheduledAt.getTime() + readServerEnv().INBOX_DIGEST_DELAY_CUSTOMER_MINUTES * 60_000);
    const result = await processInboxDigestDueBatch({ prisma, now: dueAt, batchSize: 25, leaseSeconds: 60 });
    expect(result).toMatchObject({ claimed: 2, materialized: 2, cancelled: 0, failed: 0 });
    const events = await prisma.outboxEvent.findMany({ where: { eventType: 'INBOX.DIGEST_DUE' } });
    const deliveries = await prisma.notificationDelivery.findMany({ where: { outboxEventId: { in: events.map(({ id }) => id) }, templateKey: 'activity.digest' } });
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientUserId: staffId, payload: expect.objectContaining({ folio: 'OCQ-2026-000001', messages: 3, files: 0, actionPath: `/staff/requests?request=${requestId}` }) }),
      expect.objectContaining({ recipientUserId: customerId, payload: expect.objectContaining({ folio: 'OCQ-2026-000001', messages: 1, files: 0, actionPath: `/portal?request=${requestId}` }) }),
    ]));
  });

  it('cancels read or resolved notices and rechecks OFF preferences and current staff assignment', async () => {
    const group = (name: string) => `${name}:${suffix}`;
    const recorded = await prisma.$transaction((tx) => recordInboxIntents(tx, [
      staffIntent(group('digest-read')),
      staffIntent(group('digest-resolved')),
      staffIntent(group('digest-lost-scope')),
      customerIntent(group('digest-off')),
    ], scheduledAt));
    const byRecipient = new Map<string, string[]>();
    for (const item of recorded) byRecipient.set(item.recipientId, [...(byRecipient.get(item.recipientId) ?? []), item.id]);
    const staffNoticeIds = byRecipient.get(staffId) ?? [];
    const customerNoticeId = byRecipient.get(customerId)?.[0];
    await prisma.inboxNotification.update({ where: { id: staffNoticeIds[0] }, data: { readAt: new Date(scheduledAt.getTime() + 1_000) } });
    await prisma.inboxNotification.update({ where: { id: staffNoticeIds[1] }, data: { resolvedAt: new Date(scheduledAt.getTime() + 1_000), resolvedNote: 'Resuelta' } });
    await prisma.inboxPreference.upsert({ where: { userId: customerId }, create: { userId: customerId, activityEmail: 'OFF' }, update: { activityEmail: 'OFF' } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: replacementStaffId } });

    const dueAt = new Date(scheduledAt.getTime() + readServerEnv().INBOX_DIGEST_DELAY_CUSTOMER_MINUTES * 60_000);
    const result = await processInboxDigestDueBatch({ prisma, now: dueAt, batchSize: 25, leaseSeconds: 60 });
    expect(result).toMatchObject({ claimed: 4, materialized: 0, cancelled: 4, failed: 0 });
    const notificationIds = [...staffNoticeIds, ...(customerNoticeId ? [customerNoticeId] : [])];
    const events = await prisma.outboxEvent.findMany({ where: { eventType: 'INBOX.DIGEST_DUE', aggregateId: { in: notificationIds } }, select: { id: true, aggregateId: true } });
    const cancellations = await prisma.notificationDelivery.findMany({ where: { outboxEventId: { in: events.map(({ id }) => id) }, templateKey: 'system.cancelled' } });
    expect(cancellations).toHaveLength(4);
    expect(cancellations.filter(({ cancelReason }) => cancelReason === 'ALREADY_READ')).toHaveLength(2);
    expect(cancellations.filter(({ cancelReason }) => cancelReason === 'INBOX_DIGEST')).toHaveLength(2);
  });
});
