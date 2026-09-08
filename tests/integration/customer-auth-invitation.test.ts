import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { consumeCustomerMagicLink, issueCustomerMagicLinkInTransaction } from '@/server/auth/service';
import { fingerprintToken } from '@/server/auth/crypto';

describe('customer auth invitation lifecycle', () => {
  it('activates an invited customer once without persisting the raw token', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const testIpAddress = `2001:db8::${suffix}`;
    const now = new Date('2026-09-08T14:00:00.000Z');
    const rawToken = `customer-invite-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
    const client = await prisma.client.create({ data: { displayName: `Invitation client ${suffix}` } });
    const user = await prisma.user.create({
      data: {
        email: `invited-${suffix}@example.test`,
        emailNormalized: `invited-${suffix}@example.test`,
        displayName: 'Invited customer',
        type: 'CUSTOMER',
        status: 'INVITED',
        clientId: client.id,
      },
    });

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
      expect(await consumeCustomerMagicLink(rawToken, { ipAddress: testIpAddress, userAgent: 'integration-test' }, { prisma, now })).toEqual({ ok: false });
    } finally {
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.authEvent.deleteMany({ where: { userId: user.id } });
      await prisma.authToken.deleteMany({ where: { userId: user.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: user.id } });
      await prisma.authRateLimit.deleteMany({ where: { scope: 'customer-magic-link-consume-ip', keyHash: fingerprintToken(testIpAddress) } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.client.delete({ where: { id: client.id } });
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
