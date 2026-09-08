import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STATUSES,
  MAX_MESSAGE_LENGTH,
  MESSAGE_VISIBILITIES,
  normalizeIdempotencyKey,
  normalizeMessageBody,
  type ConversationStatus,
  type MessageVisibility,
} from '@/server/modules/messaging/domain';

describe('messaging domain contracts', () => {
  it('defines explicit conversation statuses and message visibilities', () => {
    expect(CONVERSATION_STATUSES).toEqual(['OPEN', 'CLOSED']);
    expect(MESSAGE_VISIBILITIES).toEqual(['CUSTOMER', 'INTERNAL']);
    expect(['OPEN', 'CLOSED'] satisfies readonly ConversationStatus[]).toHaveLength(2);
    expect(['CUSTOMER', 'INTERNAL'] satisfies readonly MessageVisibility[]).toHaveLength(2);
  });

  it('normalizes plain text while preserving intentional line breaks', () => {
    expect(normalizeMessageBody('  Hola  equipo\r\n\r\nNecesito revisar el acabado.  ')).toBe('Hola equipo\n\nNecesito revisar el acabado.');
    expect(() => normalizeMessageBody('   ')).toThrow();
    expect(() => normalizeMessageBody(`x`.repeat(MAX_MESSAGE_LENGTH + 1))).toThrow();
    expect(() => normalizeMessageBody('texto\u0000prohibido')).toThrow();
  });

  it('accepts bounded retry keys and rejects malformed or oversized keys', () => {
    expect(normalizeIdempotencyKey(' portal.message.01 ')).toBe('portal.message.01');
    expect(() => normalizeIdempotencyKey('short')).toThrow();
    expect(() => normalizeIdempotencyKey('x'.repeat(129))).toThrow();
    expect(() => normalizeIdempotencyKey('portal message 01')).toThrow();
  });
});
