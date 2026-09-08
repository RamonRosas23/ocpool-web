import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { upsertNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import { processNotificationBatch } from '@/server/modules/notifications/worker';
import type { EmailMessage, EmailProvider } from '@/server/modules/notifications/email-provider';

const emailMessage: EmailMessage = { to: 'worker@example.test', subject: 'OCPOOL', text: 'Texto', html: '<p>Texto</p>' };

describe('notification worker delivery processing', () => {
  it('marks accepted provider submissions as SENT and retries temporary failures', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2000-09-08T12:00:00.000Z');
    const sentEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `sent-${suffix}` } } });
    const retryEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `retry-${suffix}` } } });
    const maxEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `max-${suffix}` } } });

    try {
      const sentDelivery = await upsertNotificationDelivery(prisma, {
        outboxEventId: sentEvent.id,
        recipientUserId: null,
        recipientEmail: `worker-sent-${suffix}@example.test`,
        templateKey: 'message.created',
        templateVersion: 'v1',
        safePayload: { recipientName: 'Ana', folio: 'OCQ-2026-000001', senderName: 'OCPOOL', preview: 'Mensaje' },
      });
      const retryDelivery = await upsertNotificationDelivery(prisma, {
        outboxEventId: retryEvent.id,
        recipientUserId: null,
        recipientEmail: `worker-retry-${suffix}@example.test`,
        templateKey: 'message.created',
        templateVersion: 'v1',
        safePayload: { recipientName: 'Ana', folio: 'OCQ-2026-000002', senderName: 'OCPOOL', preview: 'Mensaje' },
      });
      const maxDelivery = await upsertNotificationDelivery(prisma, {
        outboxEventId: maxEvent.id,
        recipientUserId: null,
        recipientEmail: `worker-max-${suffix}@example.test`,
        templateKey: 'message.created',
        templateVersion: 'v1',
        safePayload: { recipientName: 'Ana', folio: 'OCQ-2026-000003', senderName: 'OCPOOL', preview: 'Mensaje' },
      });
      await prisma.notificationDelivery.updateMany({ where: { id: { in: [sentDelivery.id, retryDelivery.id, maxDelivery.id] } }, data: { availableAt: now } });
      await prisma.notificationDelivery.update({ where: { id: maxDelivery.id }, data: { attempts: 2 } });
      const provider: EmailProvider = {
        async send(message) {
          if (message.to.includes('retry-') || message.to.includes('max-')) throw Object.assign(new Error('provider body is never persisted'), { code: 'SMTP_PROVIDER_ERROR' });
          return { providerMessageId: 'provider-message-id' };
        },
      };

      const result = await processNotificationBatch({
        prisma,
        provider,
        now,
        batchSize: 10,
        leaseSeconds: 60,
        maxAttempts: 3,
        render: async (delivery) => ({ ...emailMessage, to: delivery.payload?.folio === 'OCQ-2026-000002' ? `worker-retry-${suffix}@example.test` : delivery.payload?.folio === 'OCQ-2026-000003' ? `worker-max-${suffix}@example.test` : `worker-sent-${suffix}@example.test` }),
      });

      expect(result).toMatchObject({ claimed: 3, sent: 1, retried: 1, failed: 1 });
      expect(await prisma.notificationDelivery.findUnique({ where: { id: sentDelivery.id }, select: { status: true, providerMessageId: true, attempts: true } })).toEqual({ status: 'SENT', providerMessageId: 'provider-message-id', attempts: 1 });
      expect(await prisma.notificationDelivery.findUnique({ where: { id: retryDelivery.id }, select: { status: true, lastErrorCode: true, attempts: true } })).toEqual({ status: 'PENDING', lastErrorCode: 'TEMPORARY_PROVIDER', attempts: 1 });
      expect(await prisma.notificationDelivery.findUnique({ where: { id: maxDelivery.id }, select: { status: true, lastErrorCode: true, attempts: true } })).toEqual({ status: 'FAILED', lastErrorCode: 'TEMPORARY_PROVIDER', attempts: 3 });
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: { in: [sentEvent.id, retryEvent.id, maxEvent.id] } } });
      await prisma.outboxEvent.deleteMany({ where: { id: { in: [sentEvent.id, retryEvent.id, maxEvent.id] } } });
    }
  }, 30_000);
});
