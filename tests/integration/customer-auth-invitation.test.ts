import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { consumeCustomerMagicLink, issueCustomerMagicLinkInTransaction } from '@/server/auth/service';

describe('customer auth invitation lifecycle', () => {
  it('activates an invited customer once without persisting the raw token', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
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
          context: { ipAddress: '127.0.0.1', userAgent: 'integration-test' },
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

      const consumed = await consumeCustomerMagicLink(rawToken, { ipAddress: '127.0.0.1', userAgent: 'integration-test' }, { prisma, now, sessionTokenGenerator: () => `session-${suffix}-abcdefghijklmnopqrstuvwxyz-123456` });
      expect(consumed.ok).toBe(true);
      expect((await prisma.user.findUnique({ where: { id: user.id } }))?.status).toBe('ACTIVE');
      expect(await consumeCustomerMagicLink(rawToken, { ipAddress: '127.0.0.1', userAgent: 'integration-test' }, { prisma, now })).toEqual({ ok: false });
    } finally {
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.authEvent.deleteMany({ where: { userId: user.id } });
      await prisma.authToken.deleteMany({ where: { userId: user.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.client.delete({ where: { id: client.id } });
    }
  }, 15_000);
});
