import { describe, expect, it } from 'vitest';
import { relativeTimeLabel } from '@/lib/relative-time';

const now = new Date('2026-09-25T18:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('relativeTimeLabel', () => {
  it('reads recent moments in minutes and hours', () => {
    expect(relativeTimeLabel(ago(20_000), now)).toBe('Hace un momento');
    expect(relativeTimeLabel(ago(5 * 60_000), now)).toBe('Hace 5 min');
    expect(relativeTimeLabel(ago(3 * 3_600_000), now)).toBe('Hace 3 h');
  });

  it('switches to days within the week', () => {
    expect(relativeTimeLabel(ago(26 * 3_600_000), now)).toBe('Ayer');
    expect(relativeTimeLabel(ago(4 * 86_400_000), now)).toBe('Hace 4 días');
  });

  it('falls back to the calendar date after a week and for invalid input', () => {
    expect(relativeTimeLabel(ago(10 * 86_400_000), now)).toMatch(/^15 sept? 2026$/u);
    expect(relativeTimeLabel(null, now)).toBe('Fecha por confirmar');
    expect(relativeTimeLabel('no-es-fecha', now)).toBe('Fecha por confirmar');
  });
});
