import { describe, expect, it } from 'vitest';
import { calculateNotificationRetryAt } from '@/server/modules/notifications/domain';
import { classifyNotificationError, runNotificationWorker } from '@/server/modules/notifications/worker';
import type { PrismaClient } from '@/generated/prisma/client';

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
});
