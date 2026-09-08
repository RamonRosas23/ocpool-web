import { describe, expect, it } from 'vitest';
import { normalizeDashboardQuery } from '@/server/modules/analytics/domain';
import { serializeDashboardResponse } from '@/server/modules/analytics/serialization';
import type { DashboardAggregates } from '@/server/modules/analytics/repository';

describe('analytics response serialization', () => {
  it('preserves safe numeric contracts without leaking identifiers or BigInt values', () => {
    const now = new Date('2026-09-08T18:00:00.000Z');
    const query = normalizeDashboardQuery({ from: '2026-09-01', to: '2026-09-08', now, timezone: 'America/Chihuahua' });
    const aggregates: DashboardAggregates = {
      requests: {
        received: 4,
        unassigned: 1,
        byStatus: [{ status: 'RECIBIDA', count: 4 }],
        byOrigin: [{ origin: 'PUBLIC_FORM', count: 4 }],
        agingSeconds: [60],
        assignmentSeconds: [120, 180, 240, 300],
      },
      quotes: {
        sent: 5,
        accepted: 2,
        acceptedTotals: [
          { currencyCode: 'MXN', totalMinor: 12345678901234567890n, count: 1 },
          { currencyCode: 'USD', totalMinor: 987654321n, count: 1 },
        ],
        byStatus: [{ status: 'ENVIADA', count: 5 }],
        sentSeconds: [60, 90, 120, 180, 240],
        acceptanceSeconds: [600, 900, 1200, 1500, 1800],
      },
      workload: [
        { actorId: 'employee-sensitive-internal-id', activeRequests: 3, draftQuotes: 1, oldestOpenAt: new Date('2026-09-02T18:00:00.000Z') },
        { actorId: 'employee-operational-id', activeRequests: 3, draftQuotes: 2, oldestOpenAt: new Date('2026-09-01T18:00:00.000Z') },
      ],
      users: [
        { id: 'employee-sensitive-internal-id', displayName: 'Responsable uno' },
        { id: 'employee-operational-id', displayName: 'Responsable dos' },
      ],
      notifications: {
        byStatus: [{ status: 'FAILED', count: 1 }],
        oldestPendingAt: new Date('2026-09-07T18:00:00.000Z'),
        failedInPeriod: 1,
      },
    };

    const response = serializeDashboardResponse({ aggregates, query, scope: 'global', now });
    const json = JSON.stringify(response);

    expect(response.quotes.acceptedTotals).toEqual([
      { currencyCode: 'MXN', totalMinor: '12345678901234567890', count: 1 },
      { currencyCode: 'USD', totalMinor: '987654321', count: 1 },
    ]);
    expect(response.quotes.acceptanceRateBps).toBe(4000);
    expect(response.timing.assignment).toMatchObject({ sampleSize: null, p50Seconds: null, p90Seconds: null, suppressed: true });
    expect(response.workload[0]).toMatchObject({ activeRequests: null, draftQuotes: null, oldestOpenAt: null, suppressed: true });
    expect(response.workload[1]).toMatchObject({ activeRequests: 3, draftQuotes: 2, suppressed: false });
    expect(response.workload[0].actorKey).toMatch(/^[a-f0-9]{16}$/u);
    expect(json).not.toContain('employee-sensitive-internal-id');
    expect(json).not.toContain('@');
    expect(json).not.toContain('payload');
    expect(json).not.toContain('ciphertext');
    expect(json).not.toContain('storageKey');
    expect(() => JSON.stringify(response)).not.toThrow();
  });
});
