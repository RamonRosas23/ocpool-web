import { describe, expect, it } from 'vitest';
import { currentPriceRows, type PriceListRow } from '@/lib/price-list-current';

const NOW = Date.parse('2026-09-28T18:00:00.000Z');

type Row = PriceListRow & { id: string };
const row = (id: string, overrides: Partial<Row> = {}): Row => ({
  id,
  catalogItemId: 'item-1',
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: null,
  catalogItem: { status: 'ACTIVE' },
  ...overrides,
});

describe('currentPriceRows', () => {
  it('keeps the row that is valid today, not an expired or a scheduled one for the same concept', () => {
    // La API devuelve las filas de la más nueva a la más vieja: la última sobreescribía a las demás.
    const rows = [
      row('scheduled', { validFrom: '2026-11-01T00:00:00.000Z' }),
      row('current', { validFrom: '2026-06-01T00:00:00.000Z', validUntil: '2026-12-31T00:00:00.000Z' }),
      row('expired', { validFrom: '2025-01-01T00:00:00.000Z', validUntil: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(currentPriceRows(rows, NOW).get('item-1')?.id).toBe('current');
  });

  it('leaves out concepts whose only rows are expired, not started or belong to an archived concept', () => {
    const rows = [
      row('expired', { catalogItemId: 'a', validUntil: '2026-09-28T18:00:00.000Z' }),
      row('future', { catalogItemId: 'b', validFrom: '2026-09-28T18:00:00.001Z' }),
      row('archived', { catalogItemId: 'c', catalogItem: { status: 'ARCHIVED' } }),
      row('broken-date', { catalogItemId: 'd', validFrom: 'not-a-date' }),
    ];
    expect([...currentPriceRows(rows, NOW).keys()]).toEqual([]);
  });

  it('treats the boundaries like the server: valid from the start instant, expired at the end instant', () => {
    const startsNow = row('starts-now', { catalogItemId: 'a', validFrom: '2026-09-28T18:00:00.000Z' });
    const endsLater = row('ends-later', { catalogItemId: 'b', validUntil: '2026-09-28T18:00:00.001Z' });
    const current = currentPriceRows([startsNow, endsLater], NOW);
    expect([...current.keys()].sort()).toEqual(['a', 'b']);
  });

  it('prefers the most recent start if legacy data ever overlaps', () => {
    const rows = [row('older', { validFrom: '2026-02-01T00:00:00.000Z' }), row('newer', { validFrom: '2026-08-01T00:00:00.000Z' })];
    expect(currentPriceRows(rows, NOW).get('item-1')?.id).toBe('newer');
  });
});
