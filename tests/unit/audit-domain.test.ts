import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_DEFINITIONS,
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  classifyAuditAction,
  decodeAuditCursor,
  encodeAuditCursor,
  normalizeAuditQuery,
  projectAuditMetadata,
  type AuditCursor,
} from '@/server/modules/audit/domain';

const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const now = new Date('2026-09-08T18:00:00.000Z');

const baseCursor: AuditCursor = {
  version: 1,
  source: 'operational',
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-09-08T00:00:00.000Z',
  category: 'commercial',
  outcome: null,
  limit: 25,
  createdAt: '2026-09-07T12:00:00.000Z',
  id: '3a2f99cc-167b-4c66-9f57-000000000001',
};

describe('audit domain contracts', () => {
  it('normalizes a half-open local calendar range and default limit', () => {
    const query = normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-08' }, { now, timezone: 'UTC' });

    expect(query).toMatchObject({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-08T00:00:00.000Z'),
      timezone: 'UTC',
      category: null,
      outcome: null,
      limit: AUDIT_DEFAULT_LIMIT,
      cursor: null,
    });
  });

  it('rejects future, inverted, oversized and malformed ranges', () => {
    expect(() => normalizeAuditQuery({ from: '2026-09-08', to: '2026-09-01' }, { now, timezone: 'UTC' })).toThrow();
    expect(() => normalizeAuditQuery({ from: '2026-01-01', to: '2026-05-01' }, { now, timezone: 'UTC' })).toThrow();
    expect(() => normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-09' }, { now, timezone: 'UTC' })).toThrow();
    expect(() => normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-08', limit: 0 }, { now, timezone: 'UTC' })).toThrow();
    expect(() => normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-08', limit: AUDIT_MAX_LIMIT + 1 }, { now, timezone: 'UTC' })).toThrow();
    expect(() => normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-08', category: 'unknown' as never }, { now, timezone: 'UTC' })).toThrow();
  });

  it('uses the configured business timezone to convert calendar boundaries', () => {
    const query = normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-02' }, { now, timezone: 'America/Chihuahua' });

    expect(query.from.getTime()).toBeLessThan(query.to.getTime());
    expect(query.from.toISOString()).toMatch(/T06:00:00\.000Z|T07:00:00\.000Z/u);
  });

  it('classifies only registered actions', () => {
    expect(classifyAuditAction('quote.version.created')).toMatchObject({ category: 'commercial' });
    expect(classifyAuditAction('conversation.message_created')).toMatchObject({ category: 'communication' });
    expect(classifyAuditAction('file.rejected')).toMatchObject({ category: 'documents' });
    expect(classifyAuditAction('notification.retry')).toMatchObject({ category: 'notifications' });
    expect(classifyAuditAction('audit.future_action')).toBeNull();
    expect(Object.keys(AUDIT_ACTION_DEFINITIONS)).toContain('quote.pdf.generation_failed');
  });

  it('projects allowlisted metadata and drops sensitive or unknown values', () => {
    expect(projectAuditMetadata('quote.version.status_changed', {
      folio: 'OC-0001',
      fromStatus: 'EN_REVISION',
      toStatus: 'ENVIADA',
      reason: 'accepted_by_customer',
      email: 'private@example.test',
      phone: '+52 5555555555',
      sessionId: 'session-secret',
      storageKey: 'private/key.pdf',
      sha256: 'a'.repeat(64),
      arbitrary: 'must-not-appear',
    })).toEqual([
      { label: 'Folio', value: 'OC-0001' },
      { label: 'Estado anterior', value: 'EN_REVISION' },
      { label: 'Estado nuevo', value: 'ENVIADA' },
      { label: 'Motivo', value: 'accepted_by_customer' },
    ]);
  });

  it('returns no details for unknown actions and never stringifies objects', () => {
    const result = projectAuditMetadata('future.action', {
      nested: { email: 'private@example.test' },
      payload: 'secret',
    });

    expect(result).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('private@example.test');
  });

  it('rejects cursors altered or reused with another filter set', () => {
    const encoded = encodeAuditCursor(baseCursor, secret);
    expect(decodeAuditCursor(encoded, secret, baseCursor)).toEqual(baseCursor);
    expect(() => decodeAuditCursor(`${encoded.slice(0, -1)}x`, secret, baseCursor)).toThrow();
    expect(() => decodeAuditCursor(encoded, 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', baseCursor)).toThrow();
    expect(() => decodeAuditCursor(encoded, secret, { ...baseCursor, category: 'documents' })).toThrow();
    expect(() => decodeAuditCursor(encoded, secret, { ...baseCursor, source: 'security' })).toThrow();
  });

  it('rejects malformed, future-version and incomplete cursor payloads', () => {
    expect(() => decodeAuditCursor('not-a-cursor', secret, baseCursor)).toThrow();
    expect(() => encodeAuditCursor({ ...baseCursor, version: 2 as 1 }, secret)).toThrow();
    expect(() => encodeAuditCursor({ ...baseCursor, id: '' }, secret)).toThrow();
  });
});
