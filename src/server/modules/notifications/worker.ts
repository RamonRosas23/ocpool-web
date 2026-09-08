import type { PrismaClient } from '@/generated/prisma/client';
import { readServerEnv } from '@/server/env';
import { decryptSecret } from '@/server/auth/crypto';
import { calculateNotificationRetryAt } from '@/server/modules/notifications/domain';
import {
  claimNotificationDeliveries,
  markNotificationFailure,
  markNotificationSent,
  type ClaimedNotificationDelivery,
} from '@/server/modules/notifications/dispatcher';
import { processNotificationFanoutBatch } from '@/server/modules/notifications/fanout';
import { createSmtpEmailProviderFromEnv, type EmailMessage, type EmailProvider } from '@/server/modules/notifications/email-provider';
import { buildNotificationUrl, renderNotificationTemplate, type NotificationTemplateData } from '@/server/modules/notifications/templates';

export type NotificationFailureCode = 'TEMPORARY_PROVIDER' | 'RATE_LIMIT' | 'INVALID_RECIPIENT' | 'TEMPLATE_ERROR' | 'CONFIGURATION';

export type NotificationFailureClassification = {
  code: NotificationFailureCode;
  retryable: boolean;
};

const RETRYABLE_CODES = new Map<string, NotificationFailureClassification>([
  ['SMTP_PROVIDER_ERROR', { code: 'TEMPORARY_PROVIDER', retryable: true }],
  ['RATE_LIMIT', { code: 'RATE_LIMIT', retryable: true }],
]);

const PERMANENT_CODES = new Map<string, NotificationFailureClassification>([
  ['INVALID_RECIPIENT', { code: 'INVALID_RECIPIENT', retryable: false }],
  ['TEMPLATE_ERROR', { code: 'TEMPLATE_ERROR', retryable: false }],
  ['CONFIGURATION', { code: 'CONFIGURATION', retryable: false }],
]);

export function classifyNotificationError(error: unknown): NotificationFailureClassification {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
  return RETRYABLE_CODES.get(code) ?? PERMANENT_CODES.get(code) ?? { code: 'CONFIGURATION', retryable: false };
}

export type NotificationRender = (delivery: ClaimedNotificationDelivery) => Promise<EmailMessage>;

function stringValue(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === 'string' ? payload[key] : undefined;
}

function numberValue(payload: Record<string, unknown>, key: string): number | undefined {
  return typeof payload[key] === 'number' && Number.isFinite(payload[key]) ? payload[key] : undefined;
}

function defaultNotificationPath(delivery: ClaimedNotificationDelivery): string {
  if (delivery.templateKey === 'request.assigned' || delivery.templateKey === 'quote.accepted') return '/staff/requests';
  return '/portal';
}

async function defaultRenderNotification(delivery: ClaimedNotificationDelivery): Promise<EmailMessage> {
  const env = readServerEnv();
  if (!delivery.recipientAddressCiphertext) throw Object.assign(new Error('Notification recipient is unavailable.'), { code: 'INVALID_RECIPIENT' });
  const recipient = decryptSecret(delivery.recipientAddressCiphertext, env.NOTIFICATION_RECIPIENT_ENCRYPTION_KEY);
  const payload = delivery.payload ?? {};
  let actionPath = stringValue(payload, 'actionPath') ?? defaultNotificationPath(delivery);
  if (delivery.templateKey === 'auth.customer.magic_link' || delivery.templateKey === 'auth.employee.password_reset') {
    const tokenCiphertext = stringValue(delivery.outboxEvent.payload, 'tokenCiphertext');
    if (!tokenCiphertext) throw Object.assign(new Error('Authentication delivery material is unavailable.'), { code: 'TEMPLATE_ERROR' });
    const rawToken = decryptSecret(tokenCiphertext, env.AUTH_DELIVERY_ENCRYPTION_KEY);
    actionPath = delivery.templateKey === 'auth.customer.magic_link'
      ? `/auth/customer/consume-link?token=${encodeURIComponent(rawToken)}`
      : `/auth/recovery?token=${encodeURIComponent(rawToken)}`;
  }
  const actionUrl = buildNotificationUrl(env.APP_URL, actionPath);
  const templateData: NotificationTemplateData = {
    appUrl: env.APP_URL,
    recipientName: stringValue(payload, 'recipientName') ?? 'Hola',
    actionUrl,
    ...(stringValue(payload, 'folio') ? { folio: stringValue(payload, 'folio') } : {}),
    ...(numberValue(payload, 'versionNumber') !== undefined ? { versionNumber: numberValue(payload, 'versionNumber') } : {}),
    ...(stringValue(payload, 'totalLabel') ? { totalLabel: stringValue(payload, 'totalLabel') } : {}),
    ...(stringValue(payload, 'senderName') ? { senderName: stringValue(payload, 'senderName') } : {}),
    ...(stringValue(payload, 'preview') ? { preview: stringValue(payload, 'preview') } : {}),
    ...(stringValue(payload, 'fileName') ? { fileName: stringValue(payload, 'fileName') } : {}),
    ...(numberValue(payload, 'expiresMinutes') !== undefined ? { expiresMinutes: numberValue(payload, 'expiresMinutes') } : {}),
  };
  const rendered = renderNotificationTemplate({ templateKey: delivery.templateKey, templateVersion: delivery.templateVersion, data: templateData });
  return { to: recipient, subject: rendered.subject, text: rendered.text, html: rendered.html };
}

export type ProcessNotificationBatchInput = Readonly<{
  prisma: PrismaClient;
  provider?: EmailProvider;
  render?: NotificationRender;
  now?: Date;
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
}>;

export type ProcessNotificationBatchResult = {
  fanoutClaimed?: number;
  fanoutMaterialized?: number;
  fanoutCancelled?: number;
  fanoutFailed?: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
};

export async function processNotificationBatch(input: ProcessNotificationBatchInput): Promise<ProcessNotificationBatchResult> {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 20) throw new Error('Invalid notification max attempts.');
  const now = input.now ?? new Date();
  const fanout = await processNotificationFanoutBatch({ prisma: input.prisma, now, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds });
  const deliveries = await claimNotificationDeliveries(input.prisma, { now, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds });
  const provider = input.provider ?? createSmtpEmailProviderFromEnv();
  const render = input.render ?? defaultRenderNotification;
  const result: ProcessNotificationBatchResult = {
    fanoutClaimed: fanout.claimed,
    fanoutMaterialized: fanout.materialized,
    fanoutCancelled: fanout.cancelled,
    fanoutFailed: fanout.failed,
    claimed: deliveries.length,
    sent: 0,
    retried: 0,
    failed: 0,
  };

  for (const delivery of deliveries) {
    try {
      const message = await render(delivery);
      const providerResult = await provider.send(message);
      const marked = await markNotificationSent(input.prisma, delivery.id, delivery.processingStartedAt, now, providerResult.providerMessageId);
      if (marked) result.sent += 1;
    } catch (error) {
      const classification = classifyNotificationError(error);
      const retryAt = calculateNotificationRetryAt(now, delivery.attempts);
      const outcome = await markNotificationFailure(input.prisma, delivery.id, delivery.processingStartedAt, now, { code: classification.code, retryable: classification.retryable, retryAt, attempts: delivery.attempts, maxAttempts: input.maxAttempts });
      if (outcome === 'PENDING') result.retried += 1;
      if (outcome === 'FAILED') result.failed += 1;
    }
  }

  return result;
}

export type RunNotificationWorkerInput = ProcessNotificationBatchInput & Readonly<{
  pollIntervalMs: number;
  signal?: AbortSignal;
  onBatch?: (result: ProcessNotificationBatchResult) => void;
  processBatch?: (input: ProcessNotificationBatchInput) => Promise<ProcessNotificationBatchResult>;
}>;

function assertPollInterval(pollIntervalMs: number): void {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) throw new Error('Invalid notification poll interval.');
}

function waitForPoll(signal: AbortSignal | undefined, pollIntervalMs: number): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, pollIntervalMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export async function runNotificationWorker(input: RunNotificationWorkerInput): Promise<void> {
  assertPollInterval(input.pollIntervalMs);
  const processBatch = input.processBatch ?? processNotificationBatch;
  while (!input.signal?.aborted) {
    const result = await processBatch(input);
    input.onBatch?.(result);
    if (result.claimed === 0 && result.fanoutClaimed === 0) await waitForPoll(input.signal, input.pollIntervalMs);
  }
}
