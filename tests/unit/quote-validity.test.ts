import { describe, expect, it } from 'vitest';
import { zonedCalendarDateEndOfDayToUtc } from '@/lib/calendar-timezone';
import { builderValidUntil } from '@/lib/quote-validity';

const NOW = new Date('2026-09-27T18:00:00.000Z');

describe('builderValidUntil', () => {
  it('keeps a validity that has not passed, as the business calendar date', () => {
    expect(builderValidUntil({ validUntil: zonedCalendarDateEndOfDayToUtc('2026-10-17').toISOString(), createdAt: '2026-09-17T18:00:00.000Z' }, NOW)).toBe('2026-10-17');
  });

  it('proposes the same window from today when the validity already passed (the server rejects past dates)', () => {
    // Enviada el 10 de septiembre con 14 días de vigencia: la nueva versión propone 14 días desde hoy.
    expect(builderValidUntil({ validUntil: '2026-09-24T18:00:00.000Z', createdAt: '2026-09-10T18:00:00.000Z' }, NOW)).toBe('2026-10-11');
    // Sin un plazo razonable que deducir, usa el plazo por defecto (30 días).
    expect(builderValidUntil({ validUntil: '2026-09-24T18:00:00.000Z', createdAt: '2026-09-24T12:00:00.000Z' }, NOW)).toBe('2026-10-27');
  });

  it('leaves the validity empty when the version had none', () => {
    expect(builderValidUntil({ validUntil: null, createdAt: '2026-09-10T18:00:00.000Z' }, NOW)).toBe('');
    expect(builderValidUntil(null, NOW)).toBe('');
  });
});
