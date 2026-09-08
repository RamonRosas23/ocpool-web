import { describe, expect, it } from 'vitest';
import { buildReadinessResponse } from '@/server/db/readiness';

describe('buildReadinessResponse', () => {
  it('returns a public ready response when the database is available', () => {
    expect(buildReadinessResponse({ status: 'ok' }, 'request-ready')).toEqual({
      status: 'ok',
      requestId: 'request-ready',
      services: { database: 'ok' },
      httpStatus: 200,
    });
  });

  it('returns a degraded response without diagnostics when the database is unavailable', () => {
    const result = buildReadinessResponse({ status: 'unavailable' }, 'request-degraded');

    expect(result).toEqual({
      status: 'degraded',
      requestId: 'request-degraded',
      services: { database: 'unavailable' },
      httpStatus: 503,
    });
    expect(JSON.stringify(result)).not.toMatch(/DATABASE_URL|SELECT|stack|password/i);
  });
});
