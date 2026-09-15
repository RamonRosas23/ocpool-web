import { describe, expect, it } from 'vitest';
import {
  normalizeRequestWorkspaceQuery,
  requestWorkspaceAgeRange,
  requestWorkspaceQueryToListFilters,
  serializeRequestWorkspaceQuery,
} from '@/lib/request-workspace-query';

const actorId = '3a2f99cc-167b-4c66-9f57-000000000001';
const now = new Date('2026-09-12T18:00:00.000Z');

describe('request workspace URL query contract', () => {
  it('uses stable safe defaults and removes invalid URL values', () => {
    const query = normalizeRequestWorkspaceQuery(new URLSearchParams({
      view: 'operator-only',
      stage: 'not-a-status',
      assignee: 'not-a-uuid',
      age: 'tomorrow',
      sort: 'random',
      page: '0',
      tab: 'internal-debug',
      query: '  folio cliente  ',
    }));

    expect(query).toEqual({
      view: 'all',
      query: 'folio cliente',
      stage: null,
      assigneeId: null,
      age: 'all',
      sort: 'newest',
      page: 1,
      tab: 'summary',
    });
  });

  it('keeps the query bounded and recognizes only the canonical UUID shape', () => {
    const query = normalizeRequestWorkspaceQuery({
      query: 'x'.repeat(140),
      assignee: actorId,
      page: '12',
      stage: 'EN_REVISION',
      view: 'mine',
      age: '8-14',
      sort: 'stale',
      tab: 'activity',
    });

    expect(query.query).toHaveLength(100);
    expect(query).toMatchObject({
      assigneeId: actorId,
      page: 12,
      stage: 'EN_REVISION',
      view: 'mine',
      age: '8-14',
      sort: 'stale',
      tab: 'activity',
    });
  });

  it('serializes only non-default values in deterministic order', () => {
    const params = serializeRequestWorkspaceQuery({
      view: 'unassigned',
      query: '  OCQ-0001  ',
      stage: 'EN_REVISION',
      assigneeId: null,
      age: '31+',
      sort: 'oldest',
      page: 3,
      tab: 'files',
    });

    expect(params.toString()).toBe('view=unassigned&query=OCQ-0001&stage=EN_REVISION&age=31%2B&sort=oldest&page=3&tab=files');
    expect(serializeRequestWorkspaceQuery(normalizeRequestWorkspaceQuery(params)).toString()).toBe(params.toString());
  });

  it('maps view and assignee filters without widening the requested scope', () => {
    expect(requestWorkspaceQueryToListFilters({
      view: 'mine',
      query: '',
      stage: null,
      assigneeId: null,
      age: 'all',
      sort: 'newest',
      page: 1,
      tab: 'summary',
    }, actorId, now)).toMatchObject({ assignedToId: actorId, page: 1, pageSize: 20, sort: 'newest' });

    expect(requestWorkspaceQueryToListFilters({
      view: 'unassigned',
      query: '',
      stage: 'RECIBIDA',
      assigneeId: actorId,
      age: 'all',
      sort: 'updated',
      page: 2,
      tab: 'summary',
    }, actorId, now)).toMatchObject({ assignedToId: null, status: 'RECIBIDA', page: 2, sort: 'updated' });

    expect(requestWorkspaceQueryToListFilters({
      view: 'all',
      query: 'cliente',
      stage: null,
      assigneeId: actorId,
      age: 'all',
      sort: 'newest',
      page: 1,
      tab: 'summary',
    }, actorId, now)).toMatchObject({ assignedToId: actorId, query: 'cliente' });
  });

  it('builds non-overlapping half-open age ranges from the approved operational buckets', () => {
    expect(requestWorkspaceAgeRange('0-1', now)).toEqual({
      createdAfter: new Date('2026-09-10T18:00:00.000Z'),
      createdBefore: now,
    });
    expect(requestWorkspaceAgeRange('2-3', now)).toEqual({
      createdAfter: new Date('2026-09-08T18:00:00.000Z'),
      createdBefore: new Date('2026-09-10T18:00:00.000Z'),
    });
    expect(requestWorkspaceAgeRange('31+', now)).toEqual({
      createdBeforeOrEqual: new Date('2026-08-12T18:00:00.000Z'),
    });
    expect(requestWorkspaceAgeRange('all', now)).toEqual({});
  });
});
