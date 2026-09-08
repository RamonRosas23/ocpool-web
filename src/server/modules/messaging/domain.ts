export const CONVERSATION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_VISIBILITIES = ['CUSTOMER', 'INTERNAL'] as const;
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];

export const MAX_MESSAGE_LENGTH = 10_000;
export const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export function normalizeMessageBody(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim().replace(/[ \t]+/gu, ' ')).join('\n').trim();
  if (!normalized || normalized.length > MAX_MESSAGE_LENGTH || DISALLOWED_CONTROL_CHARACTERS.test(normalized)) {
    throw new Error('Invalid message body.');
  }
  return normalized;
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < MIN_IDEMPOTENCY_KEY_LENGTH || normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new Error('Invalid idempotency key.');
  }
  return normalized;
}

export function isConversationStatus(value: string): value is ConversationStatus {
  return (CONVERSATION_STATUSES as readonly string[]).includes(value);
}

export function isMessageVisibility(value: string): value is MessageVisibility {
  return (MESSAGE_VISIBILITIES as readonly string[]).includes(value);
}

export function assertConversationOpen(status: ConversationStatus): void {
  if (status !== 'OPEN') throw new Error('Conversation is closed.');
}
