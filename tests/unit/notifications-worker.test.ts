import { describe, expect, it } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { readServerEnv } from '@/server/env';
import { calculateNotificationRetryAt } from '@/server/modules/notifications/domain';
import { classifyNotificationError, defaultRenderNotification, runNotificationWorker } from '@/server/modules/notifications/worker';
import type { ClaimedNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import type { PrismaClient } from '@/generated/prisma/client';

function fakeMagicLinkDelivery(outboxPayload: Record<string, unknown>): ClaimedNotificationDelivery {
  const now = new Date('2026-09-17T12:00:00.000Z');
  return {
    id: 'delivery-1',
    outboxEventId: 'outbox-1',
    recipientUserId: null,
    recipientAddressCiphertext: encryptSecret('customer@example.test', readServerEnv().NOTIFICATION_RECIPIENT_ENCRYPTION_KEY),
    recipientAddressHash: null,
    templateKey: 'auth.customer.magic_link',
    templateVersion: 'v1',
    subjectSnapshot: null,
    payload: { recipientName: 'Cliente' },
    status: 'PROCESSING',
    attempts: 0,
    availableAt: now,
    processingStartedAt: now,
    processedAt: null,
    lastErrorCode: null,
    cancelReason: null,
    providerMessageId: null,
    createdAt: now,
    updatedAt: now,
    outboxEvent: { eventType: 'AUTH.CUSTOMER_MAGIC_LINK', aggregateType: 'USER', aggregateId: 'user-1', payload: outboxPayload },
  };
}

describe('notification worker policies', () => {
  it('classifies provider failures without retaining raw error text', () => {
    expect(classifyNotificationError(Object.assign(new Error('SMTP secret response must not persist'), { code: 'SMTP_PROVIDER_ERROR' }))).toEqual({ code: 'TEMPORARY_PROVIDER', retryable: true });
    expect(classifyNotificationError(Object.assign(new Error('429 provider body'), { code: 'RATE_LIMIT' }))).toEqual({ code: 'RATE_LIMIT', retryable: true });
    expect(classifyNotificationError(Object.assign(new Error('recipient is invalid'), { code: 'INVALID_RECIPIENT' }))).toEqual({ code: 'INVALID_RECIPIENT', retryable: false });
    expect(classifyNotificationError(Object.assign(new Error('template failed'), { code: 'TEMPLATE_ERROR' }))).toEqual({ code: 'TEMPLATE_ERROR', retryable: false });
    expect(classifyNotificationError(new Error('unknown internal details'))).toEqual({ code: 'CONFIGURATION', retryable: false });
  });

  it('adds bounded deterministic jitter to exponential retry times', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(calculateNotificationRetryAt(now, 1, () => 0)).toEqual(new Date('2026-09-08T12:00:24.000Z'));
    expect(calculateNotificationRetryAt(now, 1, () => 1)).toEqual(new Date('2026-09-08T12:00:36.000Z'));
    expect(calculateNotificationRetryAt(now, 99, () => 1)).toEqual(new Date('2026-09-08T13:00:00.000Z'));
    expect(() => calculateNotificationRetryAt(now, 1, () => 2)).toThrow();
  });

  it('stops a continuous worker cleanly when the abort signal arrives during an idle poll', async () => {
    const controller = new AbortController();
    let calls = 0;
    await runNotificationWorker({
      prisma: {} as PrismaClient,
      batchSize: 1,
      leaseSeconds: 60,
      maxAttempts: 3,
      pollIntervalMs: 100,
      signal: controller.signal,
      processBatch: async () => {
        calls += 1;
        controller.abort();
        return { claimed: 0, sent: 0, retried: 0, failed: 0 };
      },
    });
    expect(calls).toBe(1);
  });

  it('deep-links a customer magic link to the exact request when the outbox carries one (D2-06/U1)', async () => {
    const env = readServerEnv();
    const rawToken = 'magic-link-token-fixture';
    const tokenCiphertext = encryptSecret(rawToken, env.AUTH_DELIVERY_ENCRYPTION_KEY);
    const requestId = '00000000-0000-4000-8000-000000000042';

    const withRequest = await defaultRenderNotification(fakeMagicLinkDelivery({ tokenCiphertext, tokenType: 'MAGIC_LINK', redirectRequestId: requestId }));
    expect(withRequest.text).toContain(`/auth/customer/consume-link?token=${encodeURIComponent(rawToken)}&request=${encodeURIComponent(requestId)}`);
    expect(withRequest.html).toContain(`/auth/customer/consume-link?token=${encodeURIComponent(rawToken)}&amp;request=${encodeURIComponent(requestId)}`);

    const withoutRequest = await defaultRenderNotification(fakeMagicLinkDelivery({ tokenCiphertext, tokenType: 'MAGIC_LINK' }));
    expect(withoutRequest.text).toContain(`/auth/customer/consume-link?token=${encodeURIComponent(rawToken)}`);
    expect(withoutRequest.text).not.toContain('request=');
  });
});
