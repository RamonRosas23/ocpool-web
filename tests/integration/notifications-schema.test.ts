import { describe, expect, it } from 'vitest';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { encryptNotificationRecipient } from '@/server/modules/notifications/recipient-crypto';
import { notificationRecipientHash } from '@/server/modules/notifications/domain';

describe('notification delivery relational schema', () => {
  it('keeps delivery deduplication, encrypted recipient snapshots and lifecycle invariants at database level', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `notification-schema-${suffix}@example.test`;
    const hash = notificationRecipientHash(email);
    const ciphertext = encryptNotificationRecipient(email, readServerEnv().NOTIFICATION_RECIPIENT_ENCRYPTION_KEY);
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'QUOTE.VERSION.SENT',
        aggregateType: 'QUOTE_VERSION',
        payload: { quoteVersionId: crypto.randomUUID(), folio: `COT-${suffix}` },
      },
    });
    const recipient = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'Notification schema recipient',
        type: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    try {
      const delivery = await prisma.notificationDelivery.create({
        data: {
          outboxEventId: event.id,
          recipientUserId: recipient.id,
          recipientAddressCiphertext: ciphertext,
          recipientAddressHash: hash,
          templateKey: 'quote.version.sent',
          templateVersion: 'v1',
          subjectSnapshot: 'Nueva cotización',
          payload: { folio: `COT-${suffix}` },
        },
      });

      expect(delivery.status).toBe('PENDING');
      expect(delivery.recipientAddressCiphertext).toBe(ciphertext);
      await expect(prisma.notificationDelivery.create({
        data: {
          outboxEventId: event.id,
          recipientUserId: recipient.id,
          recipientAddressCiphertext: ciphertext,
          recipientAddressHash: hash,
          templateKey: 'quote.version.sent',
          templateVersion: 'v1',
        },
      })).rejects.toThrow();

      await expect(prisma.notificationDelivery.create({
        data: {
          outboxEventId: event.id,
          recipientAddressCiphertext: ciphertext,
          recipientAddressHash: 'not-a-hash',
          templateKey: 'quote.version.other',
          templateVersion: 'v1',
        },
      })).rejects.toThrow();
      await expect(prisma.notificationDelivery.create({
        data: {
          outboxEventId: event.id,
          recipientAddressHash: hash,
          templateKey: 'quote.version.missing-recipient',
          templateVersion: 'v1',
        },
      })).rejects.toThrow();
      await expect(prisma.notificationDelivery.create({
        data: {
          outboxEventId: event.id,
          recipientAddressCiphertext: ciphertext,
          recipientAddressHash: notificationRecipientHash(`other-${suffix}@example.test`),
          templateKey: 'quote.version.processing',
          templateVersion: 'v1',
          status: 'PROCESSING',
        },
      })).rejects.toThrow();
      await expect(prisma.notificationDelivery.create({
        data: {
          outboxEventId: event.id,
          recipientAddressCiphertext: ciphertext,
          recipientAddressHash: notificationRecipientHash(`sent-${suffix}@example.test`),
          templateKey: 'quote.version.sent-without-evidence',
          templateVersion: 'v1',
          status: 'SENT',
        },
      })).rejects.toThrow();
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: event.id } });
      await prisma.outboxEvent.delete({ where: { id: event.id } });
      await prisma.user.delete({ where: { id: recipient.id } });
    }
  }, 30_000);
});
