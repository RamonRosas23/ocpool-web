import { fingerprintToken } from '@/server/auth/crypto';

export const NOTIFICATION_CHANNELS = ['EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

const DELIVERY_TRANSITIONS: Record<NotificationDeliveryStatus, readonly NotificationDeliveryStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PENDING', 'SENT', 'FAILED', 'CANCELLED'],
  SENT: [],
  FAILED: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
};

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;

export function canTransitionNotificationDelivery(from: NotificationDeliveryStatus, to: NotificationDeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function normalizeNotificationEmail(value: string): string {
  if (typeof value !== 'string') throw new Error('Invalid notification recipient.');
  const normalized = value.normalize('NFC').trim().toLowerCase();
  if (CONTROL_CHARACTERS.test(normalized) || normalized.length < 3 || normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) throw new Error('Invalid notification recipient.');
  const separator = normalized.lastIndexOf('@');
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  if (!local || local.length > 64 || !domain || domain.length > 255 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) throw new Error('Invalid notification recipient.');
  return normalized;
}

export function notificationRecipientHash(normalizedEmail: string): string {
  return fingerprintToken(normalizeNotificationEmail(normalizedEmail));
}

export function calculateNotificationRetryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Invalid notification attempt.');
  return Math.min(3600, 30 * (2 ** Math.min(attempt - 1, 7)));
}
