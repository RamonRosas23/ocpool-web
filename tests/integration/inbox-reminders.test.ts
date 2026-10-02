import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { activeStaffWithPermissions, APPROVER_PERMISSIONS, MANAGER_PERMISSIONS } from '@/server/modules/inbox/audience';
import { runInboxReminderSweep } from '@/server/modules/inbox/reminders';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('scheduled inbox reminders', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const timeZone = 'America/Chihuahua';
  const now = new Date('2001-10-01T16:00:00.000Z'); // Monday, 09:00 in America/Chihuahua
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const userIds: string[] = [];
  const roleIds: string[] = [];
  const quoteIds: string[] = [];
  const versionIds: string[] = [];
  const approvalIds: string[] = [];
  const messageIds: string[] = [];
  let assigneeId = '';
  let managerId = '';
  let poolId = '';
  let approverId = '';
  let requesterId = '';
  let waitingRequestId = '';
  let unassignedRequestId = '';
  let approvalRequestId = '';
  let expiring72RequestId = '';
  let expiring24RequestId = '';
  let expiredRequestId = '';
  let followUpRequestId = '';
  let boundaryRequestId = '';
  let closedRequestId = '';
  let staffLastMessageRequestId = '';
  let waitingCustomerId = '';
  let expiring72CustomerId = '';
  let expiring24CustomerId = '';
  let boundaryCustomerId = '';
  let closedCustomerId = '';
  let staffLastMessageCustomerId = '';

  async function role(name: string, permissionKeys: string[]): Promise<string> {
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } }, select: { id: true } });
    const created = await prisma.role.create({ data: {
      key: `reminders-${name}-${suffix}`,
      name: `Recordatorios ${name}`,
      description: 'Rol temporal para pruebas de recordatorios',
      systemManaged: false,
      permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) },
    } });
    roleIds.push(created.id);
    return created.id;
  }

  async function employee(name: string, roleId?: string): Promise<string> {
    const email = `reminders-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: {
      email, emailNormalized: email, displayName: `Reminders ${name}`, type: 'EMPLOYEE', status: 'ACTIVE',
      ...(roleId ? { roles: { create: { roleId } } } : {}),
    } });
    userIds.push(created.id);
    return created.id;
  }

  async function request(name: string, options: { origin?: 'PUBLIC_FORM' | 'STAFF_CREATED'; createdAt: Date; updatedAt?: Date; assigneeId?: string; status?: 'RECIBIDA' | 'EN_REVISION' | 'INFORMACION_REQUERIDA' | 'COTIZACION_DISPONIBLE' | 'EN_NEGOCIACION' | 'RECHAZADA' }): Promise<{ id: string; clientId: string; contactId: string; folio: string }> {
    const created = await createQuoteRequest({
      idempotencyKey: `reminders-${name}-${suffix}`,
      origin: options.origin ?? 'STAFF_CREATED',
      contact: { displayName: `Cliente ${name} ${suffix}`, email: `reminders-contact-${name}-${suffix}@example.test` },
      detail: { projectType: 'Alberca residencial', location: 'Chihuahua', description: `Fixture de recordatorios ${name}`, consentAt: options.createdAt },
    }, { prisma, now: options.createdAt });
    requestIds.push(created.quoteRequestId);
    clientIds.push(created.clientId);
    contactIds.push(created.contactId);
    await prisma.quoteRequest.update({ where: { id: created.quoteRequestId }, data: {
      createdAt: options.createdAt,
      updatedAt: options.updatedAt ?? options.createdAt,
      ...(options.assigneeId ? { currentAssigneeId: options.assigneeId } : {}),
      ...(options.status ? { status: options.status } : {}),
    } });
    return { id: created.quoteRequestId, clientId: created.clientId, contactId: created.contactId, folio: created.folio };
  }

  async function customerFor(fixture: { clientId: string; contactId: string }, name: string): Promise<string> {
    const email = `reminders-customer-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `Cliente ${name}`, type: 'CUSTOMER', status: 'ACTIVE', clientId: fixture.clientId } });
    userIds.push(created.id);
    await prisma.clientContact.update({ where: { id: fixture.contactId }, data: { userId: created.id } });
    return created.id;
  }

  async function message(fixture: { id: string; clientId: string }, senderUserId: string, createdAt: Date): Promise<string> {
    const conversation = await prisma.conversation.create({ data: { quoteRequestId: fixture.id, clientId: fixture.clientId, status: 'OPEN', createdAt, updatedAt: createdAt } });
    const created = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId, visibility: 'CUSTOMER', body: '¿Cómo va mi solicitud?', createdAt } });
    messageIds.push(created.id);
    return created.id;
  }

  async function quoteVersion(fixture: { id: string; clientId: string }, name: string, status: 'EN_REVISION' | 'ENVIADA' | 'EN_NEGOCIACION', validUntil?: Date): Promise<{ quoteId: string; versionId: string }> {
    const quote = await prisma.quote.create({ data: { quoteRequestId: fixture.id, clientId: fixture.clientId } });
    quoteIds.push(quote.id);
    const version = await prisma.quoteVersion.create({ data: {
      quoteId: quote.id,
      versionNumber: 1,
      status,
      currencyCode: 'MXN',
      validUntil,
      createdById: assigneeId,
      publishedAt: status === 'ENVIADA' || status === 'EN_NEGOCIACION' ? new Date(now.getTime() - 5 * 86_400_000) : null,
    } });
    versionIds.push(version.id);
    await prisma.quote.update({ where: { id: quote.id }, data: {
      currentVersionId: version.id,
      ...(status === 'ENVIADA' || status === 'EN_NEGOCIACION' ? { publishedVersionId: version.id } : {}),
    } });
    return { quoteId: quote.id, versionId: version.id };
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [managerRole, poolRole, approverRole] = await Promise.all([
      role('manager', ['requests.read.global']),
      role('pool', ['requests.claim']),
      role('approver', ['quotes.approve_discount']),
    ]);
    [assigneeId, managerId, poolId, approverId, requesterId] = await Promise.all([
      employee('assignee'), employee('manager', managerRole), employee('pool', poolRole), employee('approver', approverRole), employee('requester'),
    ]);

    const old25h = new Date(now.getTime() - 25 * 60 * 60_000);
    const waiting = await request('waiting', { createdAt: old25h, assigneeId });
    waitingRequestId = waiting.id;
    waitingCustomerId = await customerFor(waiting, 'waiting');
    await message(waiting, waitingCustomerId, old25h);

    const unassigned = await request('unassigned', { origin: 'PUBLIC_FORM', createdAt: new Date(now.getTime() - 3 * 60 * 60_000) });
    unassignedRequestId = unassigned.id;

    const approvalFixture = await request('approval', { createdAt: new Date(now.getTime() - 5 * 60 * 60_000), assigneeId });
    approvalRequestId = approvalFixture.id;
    const approvalQuote = await quoteVersion(approvalFixture, 'approval', 'EN_REVISION');
    const approvalRow = await prisma.quoteApproval.create({ data: {
      quoteId: approvalQuote.quoteId,
      quoteVersionId: approvalQuote.versionId,
      type: 'DISCOUNT',
      status: 'REQUESTED',
      policyVersion: 'test-v1',
      digest: 'a'.repeat(64),
      requestedById: requesterId,
      requestedAt: new Date(now.getTime() - 5 * 60 * 60_000),
    } });
    approvalIds.push(approvalRow.id);

    const recentActivity = new Date(now.getTime() - 60 * 60_000);
    const expiring72 = await request('expiring72', { createdAt: new Date(now.getTime() - 5 * 86_400_000), updatedAt: recentActivity, assigneeId, status: 'COTIZACION_DISPONIBLE' });
    expiring72RequestId = expiring72.id;
    expiring72CustomerId = await customerFor(expiring72, 'expiring72');
    await quoteVersion(expiring72, 'expiring72', 'ENVIADA', new Date(now.getTime() + 72 * 60 * 60_000));

    const expiring24 = await request('expiring24', { createdAt: new Date(now.getTime() - 5 * 86_400_000), updatedAt: recentActivity, assigneeId, status: 'EN_NEGOCIACION' });
    expiring24RequestId = expiring24.id;
    expiring24CustomerId = await customerFor(expiring24, 'expiring24');
    await quoteVersion(expiring24, 'expiring24', 'EN_NEGOCIACION', new Date(now.getTime() + 24 * 60 * 60_000));

    const expired = await request('expired', { createdAt: new Date(now.getTime() - 8 * 86_400_000), updatedAt: recentActivity, assigneeId, status: 'COTIZACION_DISPONIBLE' });
    expiredRequestId = expired.id;
    await quoteVersion(expired, 'expired', 'ENVIADA', new Date(now.getTime() - 1));

    const followUp = await request('follow-up', { createdAt: new Date(now.getTime() - 5 * 86_400_000), assigneeId, status: 'INFORMACION_REQUERIDA' });
    followUpRequestId = followUp.id;

    const boundary = await request('boundary', { createdAt: new Date(now.getTime() - 4 * 60 * 60_000), assigneeId });
    boundaryRequestId = boundary.id;
    boundaryCustomerId = await customerFor(boundary, 'boundary');
    await message(boundary, boundaryCustomerId, new Date(now.getTime() - 4 * 60 * 60_000));

    const closed = await request('closed', { createdAt: old25h, assigneeId, status: 'RECHAZADA' });
    closedRequestId = closed.id;
    closedCustomerId = await customerFor(closed, 'closed');
    await message(closed, closedCustomerId, old25h);

    const staffLast = await request('staff-last-message', { createdAt: old25h, assigneeId });
    staffLastMessageRequestId = staffLast.id;
    staffLastMessageCustomerId = await customerFor(staffLast, 'staff-last-message');
    const staffConversation = await prisma.conversation.create({ data: { quoteRequestId: staffLast.id, clientId: staffLast.clientId, status: 'OPEN', createdAt: old25h, updatedAt: old25h } });
    await prisma.conversationMessage.create({ data: { conversationId: staffConversation.id, senderUserId: staffLastMessageCustomerId, visibility: 'CUSTOMER', body: 'Pregunta inicial', createdAt: old25h } });
    await prisma.conversationMessage.create({ data: { conversationId: staffConversation.id, senderUserId: assigneeId, visibility: 'CUSTOMER', body: 'Ya enviamos la respuesta', createdAt: new Date(old25h.getTime() + 60_000) } });
  });

  afterAll(async () => {
    const identifiers = [...requestIds, ...quoteIds, ...versionIds, ...approvalIds, ...messageIds];
    if (identifiers.length > 0) {
      await prisma.inboxReminder.deleteMany({ where: { OR: identifiers.map((id) => ({ key: { contains: id } })) } });
    }
    if (requestIds.length > 0) {
      await prisma.inboxNotification.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: { in: [...requestIds, ...quoteIds] } }, select: { id: true } });
      const eventIds = events.map(({ id }) => id);
      if (eventIds.length > 0) {
        await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: { in: eventIds } } });
        await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
      }
      await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    }
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('records all seven due reminder rules once, routes each to the current audience, and leaves closed/boundary cases alone', async () => {
    const [managers, approvers] = await Promise.all([
      activeStaffWithPermissions(prisma, MANAGER_PERMISSIONS),
      activeStaffWithPermissions(prisma, APPROVER_PERMISSIONS),
    ]);
    const [first, second] = await Promise.all([
      runInboxReminderSweep({ prisma, now, timeZone }),
      runInboxReminderSweep({ prisma, now, timeZone }),
    ]);
    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
    expect([first.recorded, second.recorded].sort((a, b) => a - b)).toEqual([0, 8]);
    expect([first.examined, second.examined].sort((a, b) => a - b)).toEqual([0, 7]);

    const requestIdsUnderTest = [waitingRequestId, unassignedRequestId, approvalRequestId, expiring72RequestId, expiring24RequestId, expiredRequestId, followUpRequestId, boundaryRequestId, closedRequestId, staffLastMessageRequestId];
    const notices = await prisma.inboxNotification.findMany({ where: { quoteRequestId: { in: requestIdsUnderTest }, kind: { startsWith: 'reminder.' } } });
    expect(notices).toHaveLength(7 + 2 * managers.length + approvers.filter(({ id }) => id !== requesterId).length);
    expect(notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reminder.customer_waiting', recipientId: assigneeId, quoteRequestId: waitingRequestId }),
      expect.objectContaining({ kind: 'reminder.customer_waiting_escalated', recipientId: managerId, quoteRequestId: waitingRequestId }),
      expect.objectContaining({ kind: 'reminder.unassigned', recipientId: managerId, quoteRequestId: unassignedRequestId }),
      expect.objectContaining({ kind: 'reminder.approval_pending', recipientId: approverId, quoteRequestId: approvalRequestId }),
      expect.objectContaining({ kind: 'reminder.quote_expiring', recipientId: expiring72CustomerId, quoteRequestId: expiring72RequestId }),
      expect.objectContaining({ kind: 'reminder.quote_expiring', recipientId: assigneeId, quoteRequestId: expiring72RequestId }),
      expect.objectContaining({ kind: 'reminder.quote_expiring', recipientId: expiring24CustomerId, quoteRequestId: expiring24RequestId }),
      expect.objectContaining({ kind: 'reminder.quote_expiring', recipientId: assigneeId, quoteRequestId: expiring24RequestId }),
      expect.objectContaining({ kind: 'reminder.quote_expired', recipientId: assigneeId, quoteRequestId: expiredRequestId }),
      expect.objectContaining({ kind: 'reminder.follow_up', recipientId: assigneeId, quoteRequestId: followUpRequestId }),
    ]));
    expect(notices.filter(({ kind }) => kind === 'reminder.customer_waiting_escalated').map(({ recipientId }) => recipientId).sort()).toEqual(managers.map(({ id }) => id).sort());
    expect(notices.filter(({ kind, quoteRequestId }) => kind === 'reminder.unassigned' && quoteRequestId === unassignedRequestId).map(({ recipientId }) => recipientId).sort()).toEqual(managers.map(({ id }) => id).sort());
    expect(notices.filter(({ kind }) => kind === 'reminder.approval_pending').map(({ recipientId }) => recipientId).sort()).toEqual(approvers.filter(({ id }) => id !== requesterId).map(({ id }) => id).sort());
    expect(notices.some((row) => row.quoteRequestId === boundaryRequestId || row.quoteRequestId === closedRequestId || row.quoteRequestId === staffLastMessageRequestId)).toBe(false);
    expect(notices.some((row) => row.recipientId === requesterId)).toBe(false);
    expect(notices.some((row) => row.recipientId === poolId && row.quoteRequestId === unassignedRequestId)).toBe(false);

    const expiryEvents = await prisma.outboxEvent.findMany({ where: { eventType: 'QUOTE.EXPIRING', aggregateId: { in: quoteIds } } });
    expect(expiryEvents).toHaveLength(2);
    expect(expiryEvents.map(({ payload }) => (payload as { expiresInHours: number }).expiresInHours).sort()).toEqual([24, 72]);

    const rerun = await runInboxReminderSweep({ prisma, now, timeZone });
    expect(rerun).toMatchObject({ acquired: true, examined: 0, recorded: 0 });
    expect(await prisma.inboxNotification.count({ where: { quoteRequestId: { in: requestIdsUnderTest }, kind: { startsWith: 'reminder.' } } })).toBe(7 + 2 * managers.length + approvers.filter(({ id }) => id !== requesterId).length);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'QUOTE.EXPIRING', aggregateId: { in: quoteIds } } })).toBe(2);
  });

  it('does not acquire or inspect candidates when disabled or outside the local sweep window', async () => {
    await expect(runInboxReminderSweep({ prisma, now, timeZone, enabled: false })).resolves.toMatchObject({ acquired: false, examined: 0, recorded: 0 });
    await expect(runInboxReminderSweep({ prisma, now: new Date('2026-10-04T16:00:00.000Z'), timeZone })).resolves.toMatchObject({ acquired: false, examined: 0, recorded: 0 });
  });
});
