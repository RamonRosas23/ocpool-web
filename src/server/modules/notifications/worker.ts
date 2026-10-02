import type { PrismaClient } from '@/generated/prisma/client';
import { readServerEnv } from '@/server/env';
import { decryptSecret } from '@/server/auth/crypto';
import { calculateNotificationRetryAt } from '@/server/modules/notifications/domain';
import { reportDeliveryFailure, reportDeliveryRecovered } from '@/server/modules/notifications/delivery-inbox';
import {
  claimNotificationDeliveries,
  markNotificationFailure,
  markNotificationSent,
  type ClaimedNotificationDelivery,
} from '@/server/modules/notifications/dispatcher';
import { processNotificationFanoutBatch } from '@/server/modules/notifications/fanout';
import { processInboxDigestDueBatch } from '@/server/modules/notifications/inbox-digest';
import { isInboxReminderSweepDue, runInboxReminderSweep } from '@/server/modules/inbox/reminders';
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
  ['SMTP_INVALID_RECIPIENT', { code: 'INVALID_RECIPIENT', retryable: false }],
  ['SMTP_CONFIGURATION_ERROR', { code: 'CONFIGURATION', retryable: false }],
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

const STAFF_TEMPLATE_KEYS: ReadonlySet<string> = new Set(['request.assigned', 'quote.accepted', 'request.new_for_team', 'quote.changes_requested', 'quote.declined', 'project.assigned']);

function defaultNotificationPath(delivery: ClaimedNotificationDelivery): string {
  return STAFF_TEMPLATE_KEYS.has(delivery.templateKey) ? '/staff/requests' : '/portal';
}

export async function defaultRenderNotification(delivery: ClaimedNotificationDelivery): Promise<EmailMessage> {
  const env = readServerEnv();
  if (!delivery.recipientAddressCiphertext) throw Object.assign(new Error('Notification recipient is unavailable.'), { code: 'INVALID_RECIPIENT' });
  const recipient = decryptSecret(delivery.recipientAddressCiphertext, env.NOTIFICATION_RECIPIENT_ENCRYPTION_KEY);
  const payload = delivery.payload ?? {};
  let actionPath = stringValue(payload, 'actionPath') ?? defaultNotificationPath(delivery);
  if (delivery.templateKey === 'auth.customer.magic_link' || delivery.templateKey === 'auth.employee.password_reset' || delivery.templateKey === 'auth.employee.invitation') {
    const tokenCiphertext = stringValue(delivery.outboxEvent.payload, 'tokenCiphertext');
    if (!tokenCiphertext) throw Object.assign(new Error('Authentication delivery material is unavailable.'), { code: 'TEMPLATE_ERROR' });
    const rawToken = decryptSecret(tokenCiphertext, env.AUTH_DELIVERY_ENCRYPTION_KEY);
    if (delivery.templateKey === 'auth.customer.magic_link') {
      const redirectRequestId = stringValue(delivery.outboxEvent.payload, 'redirectRequestId');
      actionPath = `/auth/customer/consume-link?token=${encodeURIComponent(rawToken)}${redirectRequestId ? `&request=${encodeURIComponent(redirectRequestId)}` : ''}`;
    } else {
      // La invitación usa la misma pantalla segura, con el texto de bienvenida ("Crea tu contraseña").
      actionPath = `/auth/recovery?token=${encodeURIComponent(rawToken)}${delivery.templateKey === 'auth.employee.invitation' ? '&invite=1' : ''}`;
    }
  }
  const actionUrl = buildNotificationUrl(env.APP_URL, actionPath);
  const templateData: NotificationTemplateData = {
    appUrl: env.APP_URL,
    recipientName: stringValue(payload, 'recipientName') ?? 'Hola',
    actionUrl,
    ...(stringValue(payload, 'actionLabel') ? { actionLabel: stringValue(payload, 'actionLabel') } : {}),
    ...(stringValue(payload, 'folio') ? { folio: stringValue(payload, 'folio') } : {}),
    ...(numberValue(payload, 'versionNumber') !== undefined ? { versionNumber: numberValue(payload, 'versionNumber') } : {}),
    ...(stringValue(payload, 'totalLabel') ? { totalLabel: stringValue(payload, 'totalLabel') } : {}),
    ...(stringValue(payload, 'senderName') ? { senderName: stringValue(payload, 'senderName') } : {}),
    ...(stringValue(payload, 'preview') ? { preview: stringValue(payload, 'preview') } : {}),
    ...(stringValue(payload, 'fileName') ? { fileName: stringValue(payload, 'fileName') } : {}),
    ...(stringValue(payload, 'roleLabel') ? { roleLabel: stringValue(payload, 'roleLabel') } : {}),
    ...(stringValue(payload, 'projectFolio') ? { projectFolio: stringValue(payload, 'projectFolio') } : {}),
    ...(stringValue(payload, 'projectType') ? { projectType: stringValue(payload, 'projectType') } : {}),
    ...(stringValue(payload, 'ownerName') ? { ownerName: stringValue(payload, 'ownerName') } : {}),
    ...(stringValue(payload, 'clientName') ? { clientName: stringValue(payload, 'clientName') } : {}),
    ...(stringValue(payload, 'reason') ? { reason: stringValue(payload, 'reason') } : {}),
    ...(numberValue(payload, 'expiresInHours') !== undefined ? { expiresInHours: numberValue(payload, 'expiresInHours') } : {}),
    ...(numberValue(payload, 'messages') !== undefined ? { messages: numberValue(payload, 'messages') } : {}),
    ...(numberValue(payload, 'files') !== undefined ? { files: numberValue(payload, 'files') } : {}),
    ...(numberValue(payload, 'expiresMinutes') !== undefined ? { expiresMinutes: numberValue(payload, 'expiresMinutes') } : {}),
    // UX audit fix: `NotificationTemplateData` ya declaraba estos dos campos y
    // `renderNotificationTemplate` ya los lee (quote.approval_requested/_resolved), pero nunca se
    // copiaban del payload persistido -- así que todo correo de aprobación de cotización mostraba
    // "Tipo: ajuste de precio" sin importar el tipo real, y todo correo de resolución mostraba
    // "Aprobación rechazada" incluso cuando se acababa de aprobar.
    ...(stringValue(payload, 'approvalType') ? { approvalType: stringValue(payload, 'approvalType') } : {}),
    ...(stringValue(payload, 'approvalStatus') ? { approvalStatus: stringValue(payload, 'approvalStatus') } : {}),
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
  digestClaimed?: number;
  digestMaterialized?: number;
  digestCancelled?: number;
  digestFailed?: number;
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
  const digest = await processInboxDigestDueBatch({ prisma: input.prisma, now, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds });
  const fanout = await processNotificationFanoutBatch({ prisma: input.prisma, now, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds });
  const deliveries = await claimNotificationDeliveries(input.prisma, { now, batchSize: input.batchSize, leaseSeconds: input.leaseSeconds });
  const provider = input.provider ?? createSmtpEmailProviderFromEnv();
  const render = input.render ?? defaultRenderNotification;
  const result: ProcessNotificationBatchResult = {
    digestClaimed: digest.claimed,
    digestMaterialized: digest.materialized,
    digestCancelled: digest.cancelled,
    digestFailed: digest.failed,
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
      if (marked) {
        result.sent += 1;
        await reportDeliveryRecovered(input.prisma, delivery, now);
      }
    } catch (error) {
      const classification = classifyNotificationError(error);
      const retryAt = calculateNotificationRetryAt(now, delivery.attempts);
      const outcome = await markNotificationFailure(input.prisma, delivery.id, delivery.processingStartedAt, now, { code: classification.code, retryable: classification.retryable, retryAt, attempts: delivery.attempts, maxAttempts: input.maxAttempts });
      if (outcome === 'PENDING') result.retried += 1;
      if (outcome === 'FAILED') {
        result.failed += 1;
        await reportDeliveryFailure(input.prisma, delivery, now);
      }
    }
  }

  return result;
}

export type RunNotificationWorkerInput = ProcessNotificationBatchInput & Readonly<{
  pollIntervalMs: number;
  signal?: AbortSignal;
  onBatch?: (result: ProcessNotificationBatchResult) => void;
  processBatch?: (input: ProcessNotificationBatchInput) => Promise<ProcessNotificationBatchResult>;
  reminderSweep?: typeof runInboxReminderSweep;
  clock?: () => Date;
}>;

function assertPollInterval(pollIntervalMs: number): void {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) throw new Error('Invalid notification poll interval.');
}

function waitForPoll(signal: AbortSignal | undefined, pollIntervalMs: number): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    // El listener de "abort" se retira cuando vence el intervalo: antes quedaba colgado del AbortSignal
    // en cada ciclo ocioso (cada 2 s) y Node lo reportaba como MaxListenersExceededWarning.
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, pollIntervalMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runNotificationWorker(input: RunNotificationWorkerInput): Promise<void> {
  assertPollInterval(input.pollIntervalMs);
  const processBatch = input.processBatch ?? processNotificationBatch;
  const env = readServerEnv();
  const reminderSweep = input.reminderSweep ?? runInboxReminderSweep;
  let lastReminderSweepAt: number | null = null;
  while (!input.signal?.aborted) {
    const now = input.clock?.() ?? new Date();
    if (env.INBOX_REMINDERS_ENABLED && isInboxReminderSweepDue(now, lastReminderSweepAt)) {
      lastReminderSweepAt = now.getTime();
      await reminderSweep({ prisma: input.prisma, now, timeZone: env.APP_TIMEZONE, enabled: true });
    }
    const result = await processBatch(input);
    input.onBatch?.(result);
    // `fanoutClaimed` es opcional: si falta, el lote igual cuenta como vacío (antes giraba sin pausa).
    if (result.claimed === 0 && (result.digestClaimed ?? 0) === 0 && (result.fanoutClaimed ?? 0) === 0) await waitForPoll(input.signal, input.pollIntervalMs);
  }
}
