import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { claimNotificationDeliveries, markNotificationSent, upsertNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import { notificationRecipientHash } from '@/server/modules/notifications/domain';
import { getNotificationOperationalHealth } from '@/server/modules/notifications/operations';

describe('notification dispatcher persistence operations', () => {
  it('deduplicates fan-out and claims each pending delivery once under contention', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `dispatcher-${suffix}@example.test`;
    const now = new Date('2000-09-08T12:00:00.000Z');
    const outbox = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { folio: `OCQ-2026-${suffix.slice(-6)}` } } });
    const hash = notificationRecipientHash(email);

    try {
      const input = {
        outboxEventId: outbox.id,
        recipientUserId: null,
        recipientEmail: email,
        templateKey: 'message.created' as const,
        templateVersion: 'v1' as const,
        subjectSnapshot: 'Nuevo mensaje',
        safePayload: { recipientName: 'Ana', folio: 'OCQ-2026-000001', senderName: 'OCPOOL', preview: 'Mensaje' },
      };
      const first = await upsertNotificationDelivery(prisma, input);
      const second = await upsertNotificationDelivery(prisma, input);
      expect(second.id).toBe(first.id);
      expect(await prisma.notificationDelivery.count({ where: { outboxEventId: outbox.id } })).toBe(1);
      await prisma.notificationDelivery.update({ where: { id: first.id }, data: { availableAt: now } });

      const [claimA, claimB] = await Promise.all([
        claimNotificationDeliveries(prisma, { now, batchSize: 1, leaseSeconds: 60 }),
        claimNotificationDeliveries(prisma, { now, batchSize: 1, leaseSeconds: 60 }),
      ]);
      expect(claimA.length + claimB.length).toBe(1);
      const claimed = [...claimA, ...claimB][0];
      expect(claimed.status).toBe('PROCESSING');
      expect(claimed.attempts).toBe(1);

      const reclaimed = await claimNotificationDeliveries(prisma, { now: new Date(now.getTime() + 61_000), batchSize: 1, leaseSeconds: 60 });
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0].attempts).toBe(2);
      const healthBeforeSent = await getNotificationOperationalHealth(prisma);
      expect(await markNotificationSent(prisma, reclaimed[0].id, reclaimed[0].processingStartedAt, new Date(now.getTime() + 62_000), 'mailpit-message-id')).toBe(true);
      expect(await markNotificationSent(prisma, reclaimed[0].id, reclaimed[0].processingStartedAt, new Date(now.getTime() + 63_000), 'duplicate')).toBe(false);
      expect(await prisma.notificationDelivery.findUnique({ where: { id: reclaimed[0].id }, select: { status: true, providerMessageId: true, recipientAddressCiphertext: true, recipientAddressHash: true } })).toMatchObject({ status: 'SENT', providerMessageId: 'mailpit-message-id', recipientAddressHash: hash });
      expect((await getNotificationOperationalHealth(prisma)).sent).toBe(healthBeforeSent.sent + 1);
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: outbox.id } });
      await prisma.outboxEvent.delete({ where: { id: outbox.id } });
    }
  }, 30_000);
});
