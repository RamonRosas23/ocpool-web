import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { getInboxNotificationForActor, getRequestUnreadCount, listInboxUpdatedSince } from '@/server/modules/inbox/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('inbox queries for the realtime channel', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const userIds: string[] = [];
  let sales: Actor;
  let ownNoticeId = '';
  let foreignNoticeId = '';
  let ownRequestId = '';
  let foreignRequestId = '';

  const notice = (recipientId: string, overrides: Record<string, unknown>) => prisma.inboxNotification.create({ data: { recipientId, kind: 'customer.activity', priority: 'HIGH', title: 'Aviso', actionPath: '/staff/requests', data: {}, ...overrides } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const salesUser = await prisma.user.create({ data: { email: `rt-queries-sales-${suffix}@example.test`, emailNormalized: `rt-queries-sales-${suffix}@example.test`, displayName: 'RT Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } });
    const otherUser = await prisma.user.create({ data: { email: `rt-queries-other-${suffix}@example.test`, emailNormalized: `rt-queries-other-${suffix}@example.test`, displayName: 'RT Other', type: 'EMPLOYEE', status: 'ACTIVE' } });
    userIds.push(salesUser.id, otherUser.id);
    sales = { userId: salesUser.id, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'requests.claim']), mfaVerified: true };
    for (const [index, owner] of ['own', 'foreign'].entries()) {
      const request = await createQuoteRequest({ idempotencyKey: `rt-queries-${owner}-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `RT ${owner}`, email: `rt-queries-${owner}-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'León', description: 'Fixture de consultas en vivo', consentAt: now } }, { prisma, now: new Date(now.getTime() + index) });
      requestIds.push(request.quoteRequestId);
      clientIds.push(request.clientId);
      contactIds.push(request.contactId);
    }
    [ownRequestId, foreignRequestId] = requestIds;
    await prisma.quoteRequest.update({ where: { id: ownRequestId }, data: { currentAssigneeId: salesUser.id } });
    await prisma.quoteRequest.update({ where: { id: foreignRequestId }, data: { currentAssigneeId: otherUser.id } });
    ownNoticeId = (await notice(salesUser.id, { quoteRequestId: ownRequestId, title: 'Del expediente propio' })).id;
    await notice(salesUser.id, { quoteRequestId: ownRequestId, kind: 'request.received', priority: 'INFO', title: 'Informativo' });
    foreignNoticeId = (await notice(salesUser.id, { quoteRequestId: foreignRequestId, title: 'Fuera de alcance' })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  it('reads one notice only within the current scope', async () => {
    expect(await getInboxNotificationForActor(sales, ownNoticeId, { prisma })).toMatchObject({ id: ownNoticeId, title: 'Del expediente propio', updatedAt: expect.any(String) });
    expect(await getInboxNotificationForActor(sales, foreignNoticeId, { prisma })).toBeNull();
    expect(await getInboxNotificationForActor(sales, randomUUID(), { prisma })).toBeNull();
    expect(await getInboxNotificationForActor(sales, 'not-an-id', { prisma })).toBeNull();
  });

  it('counts unread per file like the bell does', async () => {
    // El informativo no cuenta; el del expediente ajeno está fuera de alcance.
    expect(await getRequestUnreadCount(sales, ownRequestId, { prisma })).toBe(1);
    expect(await getRequestUnreadCount(sales, foreignRequestId, { prisma })).toBe(0);
    expect(await getRequestUnreadCount(sales, 'not-an-id', { prisma })).toBe(0);
  });

  it('resumes after a cursor in update order, 50 at a time', async () => {
    const base = new Date(Date.now() + 60_000);
    await prisma.inboxNotification.createMany({ data: Array.from({ length: 52 }, (_, index) => ({ recipientId: sales.userId, kind: 'team.work_reassigned', priority: 'HIGH' as const, title: `Resume ${index}`, actionPath: '/staff/requests', data: {}, createdAt: base, lastActivityAt: base, updatedAt: new Date(base.getTime() + index * 1000) })) });
    const resumed = await prisma.inboxNotification.findMany({ where: { recipientId: sales.userId, title: { startsWith: 'Resume ' } }, orderBy: { updatedAt: 'asc' } });
    const first = await listInboxUpdatedSince(sales, { at: resumed[0].updatedAt, id: resumed[0].id }, { prisma });
    expect(first.items.map((item) => item.title)).toEqual(Array.from({ length: 50 }, (_, index) => `Resume ${index + 1}`));
    expect(first.more).toBe(true);
    const second = await listInboxUpdatedSince(sales, { at: resumed[50].updatedAt, id: resumed[50].id }, { prisma });
    expect(second).toMatchObject({ items: [{ title: 'Resume 51' }], more: false });
  });
});
