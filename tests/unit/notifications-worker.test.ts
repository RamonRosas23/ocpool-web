import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
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

function fakeApprovalDelivery(templateKey: 'quote.approval_requested' | 'quote.approval_resolved', payload: Record<string, unknown>): ClaimedNotificationDelivery {
  const now = new Date('2026-09-17T12:00:00.000Z');
  return {
    id: 'delivery-approval-1',
    outboxEventId: 'outbox-approval-1',
    recipientUserId: 'staff-1',
    recipientAddressCiphertext: encryptSecret('manager@example.test', readServerEnv().NOTIFICATION_RECIPIENT_ENCRYPTION_KEY),
    recipientAddressHash: null,
    templateKey,
    templateVersion: 'v1',
    subjectSnapshot: null,
    payload,
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
    outboxEvent: { eventType: 'QUOTE.APPROVAL_REQUESTED', aggregateType: 'QUOTE', aggregateId: 'quote-1', payload: {} },
  };
}

function fakeDigestDelivery(payload: Record<string, unknown>): ClaimedNotificationDelivery {
  return { ...fakeApprovalDelivery('quote.approval_requested', payload), templateKey: 'activity.digest' };
}

describe('notification worker policies', () => {
  it('classifies provider failures without retaining raw error text', () => {
    expect(classifyNotificationError(Object.assign(new Error('SMTP secret response must not persist'), { code: 'SMTP_PROVIDER_ERROR' }))).toEqual({ code: 'TEMPORARY_PROVIDER', retryable: true });
    expect(classifyNotificationError(Object.assign(new Error('429 provider body'), { code: 'RATE_LIMIT' }))).toEqual({ code: 'RATE_LIMIT', retryable: true });
    expect(classifyNotificationError(Object.assign(new Error('recipient is invalid'), { code: 'INVALID_RECIPIENT' }))).toEqual({ code: 'INVALID_RECIPIENT', retryable: false });
    expect(classifyNotificationError(Object.assign(new Error('template failed'), { code: 'TEMPLATE_ERROR' }))).toEqual({ code: 'TEMPLATE_ERROR', retryable: false });
    expect(classifyNotificationError(new Error('unknown internal details'))).toEqual({ code: 'CONFIGURATION', retryable: false });
  });

  it('H1-03 SMTP fix: routes the differentiated SMTP error codes to the correct retry policy', () => {
    expect(classifyNotificationError(Object.assign(new Error('permanent bounce'), { code: 'SMTP_INVALID_RECIPIENT' }))).toEqual({ code: 'INVALID_RECIPIENT', retryable: false });
    expect(classifyNotificationError(Object.assign(new Error('bad credentials'), { code: 'SMTP_CONFIGURATION_ERROR' }))).toEqual({ code: 'CONFIGURATION', retryable: false });
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
      reminderSweep: async () => ({ acquired: false, examined: 0, recorded: 0 }),
      processBatch: async () => {
        calls += 1;
        controller.abort();
        return { claimed: 0, sent: 0, retried: 0, failed: 0 };
      },
    });
    expect(calls).toBe(1);
  });

  it('waits between idle polls without piling abort listeners on the shutdown signal', async () => {
    // Antes cada ciclo ocioso dejaba colgado un listener de "abort" (43 mil al día con el intervalo de
    // 2 s): Node lo reportaba como MaxListenersExceededWarning en producción.
    const controller = new AbortController();
    let calls = 0;
    let listenersSeen = 0;
    const startedAt = Date.now();
    await runNotificationWorker({
      prisma: {} as PrismaClient,
      batchSize: 1,
      leaseSeconds: 60,
      maxAttempts: 3,
      pollIntervalMs: 100,
      signal: controller.signal,
      reminderSweep: async () => ({ acquired: false, examined: 0, recorded: 0 }),
      processBatch: async () => {
        calls += 1;
        listenersSeen = Math.max(listenersSeen, getEventListeners(controller.signal, 'abort').length);
        if (calls === 4) controller.abort();
        // Sin `fanoutClaimed` (es opcional): un lote vacío igual debe esperar el intervalo, no girar en seco.
        return { claimed: 0, sent: 0, retried: 0, failed: 0 };
      },
    });
    expect(calls).toBe(4);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3 * 100 - 20);
    expect(listenersSeen).toBe(0);
  });

  it('runs the reminder sweep immediately and no more than once every five minutes', async () => {
    const controller = new AbortController();
    const first = new Date('2026-10-05T15:00:00.000Z');
    const times = [first, new Date(first.getTime() + 4 * 60_000 + 59_999), new Date(first.getTime() + 5 * 60_000)];
    let clockIndex = 0;
    let batches = 0;
    const sweptAt: Date[] = [];
    await runNotificationWorker({
      prisma: {} as PrismaClient,
      batchSize: 1,
      leaseSeconds: 60,
      maxAttempts: 3,
      pollIntervalMs: 100,
      signal: controller.signal,
      clock: () => times[clockIndex++] ?? times[times.length - 1],
      reminderSweep: async ({ now: sweepAt, timeZone, enabled }) => {
        expect(timeZone).toBe(readServerEnv().APP_TIMEZONE);
        expect(enabled).toBe(true);
        if (sweepAt) sweptAt.push(sweepAt);
        return { acquired: true, examined: 0, recorded: 0 };
      },
      processBatch: async () => {
        batches += 1;
        if (batches === 3) controller.abort();
        return { claimed: 1, sent: 0, retried: 0, failed: 0 };
      },
    });
    expect(sweptAt).toEqual([first, times[2]]);
  });

  it('skips the reminder sweep when INBOX_REMINDERS_ENABLED is false', async () => {
    vi.stubEnv('INBOX_REMINDERS_ENABLED', 'false');
    try {
      const controller = new AbortController();
      const reminderSweep = vi.fn(async () => ({ acquired: false, examined: 0, recorded: 0 }));
      await runNotificationWorker({
        prisma: {} as PrismaClient,
        batchSize: 1,
        leaseSeconds: 60,
        maxAttempts: 3,
        pollIntervalMs: 100,
        signal: controller.signal,
        reminderSweep,
        processBatch: async () => {
          controller.abort();
          return { claimed: 1, sent: 0, retried: 0, failed: 0 };
        },
      });
      expect(reminderSweep).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('UX audit fix: threads the persisted approvalType/approvalStatus into the rendered email instead of dropping them', async () => {
    const requested = await defaultRenderNotification(fakeApprovalDelivery('quote.approval_requested', {
      recipientName: 'Gerencia',
      folio: 'OCQ-2026-000003',
      versionNumber: 2,
      approvalType: 'SPECIAL_CONCEPT',
      actionPath: '/staff/quotes',
    }));
    expect(requested.text).toContain('concepto especial');
    expect(requested.text).not.toContain('ajuste de precio');

    const resolved = await defaultRenderNotification(fakeApprovalDelivery('quote.approval_resolved', {
      recipientName: 'Gerencia',
      folio: 'OCQ-2026-000003',
      versionNumber: 2,
      approvalType: 'DISCOUNT',
      approvalStatus: 'APPROVED',
      actionPath: '/staff/quotes',
    }));
    expect(resolved.subject).toContain('Aprobación autorizada');
    expect(resolved.text).toContain('fue autorizada');
    expect(resolved.text).not.toContain('fue rechazada');
  });

  it('renders activity digest deliveries from their persisted staff/customer-safe fields', async () => {
    const staff = await defaultRenderNotification(fakeDigestDelivery({
      recipientName: 'Laura', folio: 'OCQ-2026-000001', clientName: 'Ana & familia', messages: 2, files: 1,
      preview: '¿Cómo va mi solicitud?', actionPath: '/staff/requests?request=00000000-0000-4000-8000-000000000001',
    }));
    expect(staff.to).toBe('manager@example.test');
    expect(staff.text).toContain('2 mensajes y 1 archivo');
    expect(staff.html).toContain('Ana &amp; familia');
    expect(staff.text).toContain('/staff/requests?request=00000000-0000-4000-8000-000000000001');

    const customer = await defaultRenderNotification(fakeDigestDelivery({
      recipientName: 'Ana', folio: 'OCQ-2026-000001', projectType: 'Alberca residencial', messages: 1, files: 0,
      preview: 'Ya revisamos tu solicitud.', actionPath: '/portal?request=00000000-0000-4000-8000-000000000001',
    }));
    expect(customer.text).toContain('1 mensaje');
    expect(customer.html).toContain('Alberca residencial');
    expect(customer.text).toContain('/portal?request=00000000-0000-4000-8000-000000000001');
  });
});
