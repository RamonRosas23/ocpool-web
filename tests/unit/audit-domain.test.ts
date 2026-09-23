import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_DEFINITIONS,
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  auditActionsForCategory,
  auditEntryLink,
  auditRangeUpperBound,
  classifyAuditAction,
  decodeAuditCursor,
  encodeAuditCursor,
  entityLabelForType,
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

  it('round 11 audit fix: the DB query bound extends through the end of the "hasta" day, not just its start', () => {
    // Regression for a bug where `readAuditPage`'s `dateWhere` filtered directly on `query.to` (the
    // START of the "hasta" calendar day) as an exclusive upper bound -- since that start is always <=
    // any later timestamp the same day, EVERY event from the "hasta" day itself was silently excluded,
    // including all of today whenever `to` defaulted to today (there is no way to pick "tomorrow" as a
    // workaround; future dates are rejected). `auditRangeUpperBound` is the calendar-safe fix, kept
    // separate from `query.to` so the date picker / cursor still round-trip the exact requested day.
    const query = normalizeAuditQuery({ from: '2026-09-01', to: '2026-09-08' }, { now, timezone: 'UTC' });
    const upperBound = auditRangeUpperBound(query.to, query.timezone);
    expect(upperBound).toEqual(new Date('2026-09-09T00:00:00.000Z'));
    const lastMomentOfHastaDay = new Date('2026-09-08T23:59:59.999Z');
    expect(upperBound.getTime()).toBeGreaterThan(lastMomentOfHastaDay.getTime());

    // Same check across the DST-adjacent business timezone, where a flat +24h offset (instead of
    // calendar-safe day arithmetic) would land an hour off on a transition day.
    const zonedQuery = normalizeAuditQuery({}, { now, timezone: 'America/Chihuahua' });
    const zonedUpperBound = auditRangeUpperBound(zonedQuery.to, zonedQuery.timezone);
    expect(zonedUpperBound.getTime()).toBeGreaterThan(now.getTime());
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

  it('round 11 audit fix: registers every real write-site action so it is not silently invisible from the Audit Log', () => {
    // Regression for a whitelist-drift bug: readAuditPage always filters by
    // `action: { in: auditActionsForCategory(category) }`, even with no category selected
    // (auditActionsForCategory(null) returns the full whitelist, not "no filter"). Any action string
    // written by a service that was never added here could never be returned by the API, with no error
    // anywhere -- the row exists in the DB, it just never surfaces. These are real action strings from
    // real `auditLog.create`/`audit(...)` call sites that were missing before this fix.
    const realWriteSiteActions = [
      'catalog.category.updated',
      'prices.list.updated',
      'prices.item.scheduled',
      'catalog.special_concept.promoted',
      'quote_request.updated',
      'quote_request.information_requested',
      'quote_request.customer_response_reviewed',
      'quote.version.submitted',
      'quote.version.returned_to_draft',
      'quote.version.rejected',
      'quote.version.published',
      'quote.approval.requested',
      'quote.approval.approved',
      'quote.approval.rejected',
      'project.created',
      'project.checklist_items_added',
      'project.checklist_item_completed',
      'project.checklist_item_reopened',
      'project.completed',
      'project.reopened',
      'project.owner_changed',
    ];
    for (const action of realWriteSiteActions) {
      expect(classifyAuditAction(action), `expected ${action} to be registered`).not.toBeNull();
      expect(auditActionsForCategory(null)).toContain(action);
    }
    expect(entityLabelForType('project')).toBe('Proyecto');
    expect(entityLabelForType('quote_approval')).toBe('Aprobación comercial');
  });

  it('round 11 audit fix: links entity labels to the staff page that can actually open them', () => {
    const ownId = '00000000-0000-4000-8000-000000000001';
    const parentId = '00000000-0000-4000-8000-000000000002';

    // Own id: the row's entityId IS the record to open.
    expect(auditEntryLink('quote_request', ownId, { folio: 'OCQ-2026-000001' })).toEqual({ href: `/staff/requests?request=${ownId}` });
    expect(auditEntryLink('project', ownId, {})).toEqual({ href: `/staff/projects/${ownId}` });

    // Child records: only the parent quoteRequestId (carried in metadata, not entityId) can be reached.
    expect(auditEntryLink('quote_version', ownId, { quoteRequestId: parentId, folio: 'OCQ-2026-000001' })).toEqual({ href: `/staff/quotes?request=${parentId}` });
    expect(auditEntryLink('quote_approval', ownId, { quoteRequestId: parentId, type: 'DISCOUNT' })).toEqual({ href: `/staff/quotes?request=${parentId}` });
    expect(auditEntryLink('conversation', ownId, { quoteRequestId: parentId })).toEqual({ href: `/staff/requests?request=${parentId}` });
    expect(auditEntryLink('conversation_message', ownId, { quoteRequestId: parentId })).toEqual({ href: `/staff/requests?request=${parentId}` });
    expect(auditEntryLink('file_attachment', ownId, { quoteRequestId: parentId })).toEqual({ href: `/staff/requests?request=${parentId}` });

    // No rule for this entityType (e.g. catalog/pricing -- StaffCatalogPanel has no URL-based selection yet).
    expect(auditEntryLink('catalog_category', ownId, {})).toBeNull();
    expect(auditEntryLink('auth_event', ownId, {})).toBeNull();

    // Missing/malformed id never produces a broken or unsafe link.
    expect(auditEntryLink('quote_request', null, {})).toBeNull();
    expect(auditEntryLink('quote_version', ownId, {})).toBeNull();
    expect(auditEntryLink('quote_version', ownId, { quoteRequestId: 'not-a-uuid' })).toBeNull();
    expect(auditEntryLink('quote_version', ownId, null)).toBeNull();
  });
});
