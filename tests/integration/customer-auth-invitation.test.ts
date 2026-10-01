import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { consumeCustomerMagicLink, issueCustomerMagicLinkInTransaction } from '@/server/auth/service';
import { fingerprintToken } from '@/server/auth/crypto';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('customer auth invitation lifecycle', () => {
  it('activates an invited customer once without persisting the raw token', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const testIpAddress = `2001:db8::${suffix}`;
    const now = new Date('2026-09-08T14:00:00.000Z');
    const rawToken = `customer-invite-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    const request = await createQuoteRequest({ idempotencyKey: `invitation-open-request-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Invitation client ${suffix}`, email: `invitation-client-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Open request for portal activation signal', consentAt: now } }, { prisma, now });
    const employee = await prisma.user.create({ data: { email: `invitation-assignee-${suffix}@example.test`, emailNormalized: `invitation-assignee-${suffix}@example.test`, displayName: 'Invitation assignee', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const user = await prisma.user.create({
      data: {
        email: `invited-${suffix}@example.test`,
        emailNormalized: `invited-${suffix}@example.test`,
        displayName: 'Invited customer',
        type: 'CUSTOMER',
        status: 'INVITED',
        clientId: request.clientId,
      },
    });
    await prisma.clientContact.update({ where: { id: request.contactId }, data: { userId: user.id } });
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { currentAssigneeId: employee.id } });

    try {
      await prisma.$transaction(async (transaction) => {
        await issueCustomerMagicLinkInTransaction(transaction, {
          userId: user.id,
          context: { ipAddress: testIpAddress, userAgent: 'integration-test' },
          now,
          rawToken,
        });
      });

      const token = await prisma.authToken.findFirst({ where: { userId: user.id, type: 'MAGIC_LINK' } });
      const outbox = await prisma.outboxEvent.findFirst({ where: { aggregateId: user.id, eventType: 'AUTH.CUSTOMER_MAGIC_LINK' } });
      expect(token?.tokenHash).toBeTruthy();
      expect(token?.tokenHash).not.toContain(rawToken);
      expect(outbox?.payload).not.toMatchObject({ token: rawToken });
      expect(JSON.stringify(outbox?.payload)).not.toContain(rawToken);

      const consumed = await consumeCustomerMagicLink(rawToken, { ipAddress: testIpAddress, userAgent: 'integration-test' }, { prisma, now, sessionTokenGenerator: () => `session-${suffix}-abcdefghijklmnopqrstuvwxyz-123456` });
      expect(consumed.ok).toBe(true);
      expect((await prisma.user.findUnique({ where: { id: user.id } }))?.status).toBe('ACTIVE');
      expect(await prisma.inboxNotification.findMany({ where: { recipientId: employee.id, kind: 'customer.portal_activated' } })).toHaveLength(1);
      expect(await consumeCustomerMagicLink(rawToken, { ipAddress: testIpAddress, userAgent: 'integration-test' }, { prisma, now })).toEqual({ ok: false });
      const secondRawToken = `customer-active-link-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
      await prisma.$transaction((transaction) => issueCustomerMagicLinkInTransaction(transaction, { userId: user.id, context: { ipAddress: testIpAddress, userAgent: 'integration-test' }, now, rawToken: secondRawToken }));
      const activeLinkConsumed = await consumeCustomerMagicLink(secondRawToken, { ipAddress: testIpAddress, userAgent: 'integration-test' }, { prisma, now, sessionTokenGenerator: () => `active-session-${suffix}-abcdefghijklmnopqrstuvwxyz-123456` });
      expect(activeLinkConsumed.ok).toBe(true);
      expect(await prisma.inboxNotification.count({ where: { recipientId: employee.id, kind: 'customer.portal_activated' } })).toBe(1);
    } finally {
      await prisma.inboxNotification.deleteMany({ where: { recipientId: employee.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.authEvent.deleteMany({ where: { userId: user.id } });
      await prisma.authToken.deleteMany({ where: { userId: user.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [user.id, request.quoteRequestId] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.authRateLimit.deleteMany({ where: { scope: 'customer-magic-link-consume-ip', keyHash: fingerprintToken(testIpAddress) } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
    }
  }, 15_000);

  it('rejects expired invitations and magic links belonging to employees', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const testIpAddress = `2001:db8::${suffix}`;
    const now = new Date('2026-09-08T15:00:00.000Z');
    const client = await prisma.client.create({ data: { displayName: `Invitation negative client ${suffix}` } });
    const invited = await prisma.user.create({ data: { email: `expired-${suffix}@example.test`, emailNormalized: `expired-${suffix}@example.test`, displayName: 'Expired invitation', type: 'CUSTOMER', status: 'INVITED', clientId: client.id } });
    const employee = await prisma.user.create({ data: { email: `employee-token-${suffix}@example.test`, emailNormalized: `employee-token-${suffix}@example.test`, displayName: 'Employee token', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const expiredRawToken = `expired-invite-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    const employeeRawToken = `employee-magic-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;

    try {
      await prisma.$transaction(async (transaction) => {
        await issueCustomerMagicLinkInTransaction(transaction, {
          userId: invited.id,
          context: { ipAddress: testIpAddress, userAgent: 'integration-test' },
          now,
          rawToken: expiredRawToken,
        });
        await transaction.authToken.updateMany({ where: { userId: invited.id, type: 'MAGIC_LINK' }, data: { expiresAt: new Date(now.getTime() - 1_000) } });
        await transaction.authToken.create({ data: { userId: employee.id, type: 'MAGIC_LINK', tokenHash: fingerprintToken(employeeRawToken), expiresAt: new Date(now.getTime() + 60_000) } });
      });

      await expect(consumeCustomerMagicLink(expiredRawToken, { ipAddress: testIpAddress, userAgent: 'integration-test' }, { prisma, now })).resolves.toEqual({ ok: false });
      await expect(consumeCustomerMagicLink(employeeRawToken, { ipAddress: testIpAddress, userAgent: 'integration-test' }, { prisma, now })).resolves.toEqual({ ok: false });
      expect((await prisma.user.findUnique({ where: { id: invited.id } }))?.status).toBe('INVITED');
    } finally {
      await prisma.session.deleteMany({ where: { userId: { in: [invited.id, employee.id] } } });
      await prisma.authEvent.deleteMany({ where: { userId: { in: [invited.id, employee.id] } } });
      await prisma.authToken.deleteMany({ where: { userId: { in: [invited.id, employee.id] } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [invited.id, employee.id] } } });
      await prisma.authRateLimit.deleteMany({ where: { scope: 'customer-magic-link-consume-ip', keyHash: fingerprintToken(testIpAddress) } });
      await prisma.user.deleteMany({ where: { id: { in: [invited.id, employee.id] } } });
      await prisma.client.delete({ where: { id: client.id } });
      await prisma.$disconnect();
    }
  }, 15_000);
});
