import { describe, expect, it } from 'vitest';
import {
  agingBucketForSeconds,
  calculateAcceptanceRateBps,
  calculatePercentileSeconds,
  dashboardRangeUpperBound,
  normalizeDashboardQuery,
} from '@/server/modules/analytics/domain';

describe('analytics domain contracts', () => {
  it('normalizes an explicit UTC calendar range with an inclusive last day', () => {
    const query = normalizeDashboardQuery({
      from: '2026-09-01',
      to: '2026-09-08',
      timezone: 'UTC',
      now: new Date('2026-09-08T18:00:00.000Z'),
    });

    expect(query).toMatchObject({
      timezone: 'UTC',
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-08T00:00:00.000Z'),
    });
    expect(query.from.getTime()).toBeLessThan(query.to.getTime());
    // Las consultas cubren el día de "Hasta" completo: el límite exclusivo es el inicio del siguiente.
    expect(dashboardRangeUpperBound(query)).toEqual(new Date('2026-09-09T00:00:00.000Z'));
  });

  it('counts the last day in the business timezone, including today by default', () => {
    const now = new Date('2026-09-08T18:00:00.000Z');
    const query = normalizeDashboardQuery({ timezone: 'America/Chihuahua', now });
    const until = dashboardRangeUpperBound(query);
    expect(until.getTime()).toBeGreaterThan(now.getTime());
    expect(until.getTime() - query.to.getTime()).toBe(86_400_000);
  });

  it('accepts a single day and caps the range at 93 inclusive days', () => {
    const now = new Date('2026-09-08T18:00:00.000Z');
    const single = normalizeDashboardQuery({ from: '2026-09-08', to: '2026-09-08', timezone: 'UTC', now });
    expect(single.from).toEqual(single.to);
    expect(dashboardRangeUpperBound(single)).toEqual(new Date('2026-09-09T00:00:00.000Z'));
    expect(() => normalizeDashboardQuery({ from: '2026-06-08', to: '2026-09-08', timezone: 'UTC', now })).not.toThrow();
    expect(() => normalizeDashboardQuery({ from: '2026-06-07', to: '2026-09-08', timezone: 'UTC', now })).toThrow();
    expect(() => normalizeDashboardQuery({ from: '2026-09-01', to: '2026-09-09', timezone: 'UTC', now })).toThrow();
  });

  it('defaults to the last 30 days including today and rejects invalid ranges', () => {
    const query = normalizeDashboardQuery({
      timezone: 'UTC',
      now: new Date('2026-09-08T18:00:00.000Z'),
    });

    expect(query.from).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(query.to).toEqual(new Date('2026-09-08T00:00:00.000Z'));
    expect(() => normalizeDashboardQuery({ from: '2026-09-08', to: '2026-09-01', timezone: 'UTC' })).toThrow();
    expect(() => normalizeDashboardQuery({ from: '2026-01-01', to: '2026-05-01', timezone: 'UTC' })).toThrow();
    expect(() => normalizeDashboardQuery({ from: '2026-09-01', to: '2026-09-08', timezone: 'Invalid/Zone' })).toThrow();
  });

  it('calculates bounded acceptance rates and nulls empty denominators', () => {
    expect(calculateAcceptanceRateBps(3, 1)).toBe(3333);
    expect(calculateAcceptanceRateBps(0, 0)).toBeNull();
    expect(calculateAcceptanceRateBps(2, 3)).toBe(10000);
  });

  it('calculates deterministic percentiles and suppresses insufficient samples', () => {
    expect(calculatePercentileSeconds([30, 10, 20, 40, 50], 0.5)).toBe(30);
    expect(calculatePercentileSeconds([30, 10, 20, 40, 50], 0.9)).toBe(50);
    expect(calculatePercentileSeconds([30, 10, 20, 40], 0.5)).toBeNull();
  });

  it('assigns aging buckets at exact operational boundaries', () => {
    expect(agingBucketForSeconds(0)).toBe('0–1');
    expect(agingBucketForSeconds(2 * 86_400)).toBe('2–3');
    expect(agingBucketForSeconds(4 * 86_400)).toBe('4–7');
    expect(agingBucketForSeconds(8 * 86_400)).toBe('8–14');
    expect(agingBucketForSeconds(15 * 86_400)).toBe('15–30');
    expect(agingBucketForSeconds(31 * 86_400)).toBe('31+');
  });
});
