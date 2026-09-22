import { describe, expect, it } from 'vitest';
import { BUSINESS_TIMEZONE, addCalendarDays, zonedCalendarDateEndOfDayToUtc, zonedCalendarDateToUtc } from '@/lib/calendar-timezone';

describe('calendar-timezone contracts', () => {
  it('resolves local midnight to the same UTC instant when the timezone has no offset', () => {
    expect(zonedCalendarDateToUtc('2026-03-15', 'UTC')).toEqual(new Date('2026-03-15T00:00:00.000Z'));
  });

  it('shifts local midnight by the timezone offset for a fixed, no-DST zone', () => {
    // America/Phoenix nunca observa horario de verano -- siempre UTC-7, útil para una prueba
    // determinista sin depender de si America/Chihuahua aplica DST en la fecha elegida.
    expect(zonedCalendarDateToUtc('2026-03-15', 'America/Phoenix')).toEqual(new Date('2026-03-15T07:00:00.000Z'));
  });

  it('resolves end-of-day to one millisecond before the next local midnight', () => {
    expect(zonedCalendarDateEndOfDayToUtc('2026-03-15', 'UTC')).toEqual(new Date('2026-03-15T23:59:59.999Z'));
    expect(zonedCalendarDateEndOfDayToUtc('2026-03-15', 'America/Phoenix')).toEqual(new Date('2026-03-16T06:59:59.999Z'));
  });

  it('defaults to the business timezone when none is given', () => {
    const withDefault = zonedCalendarDateToUtc('2026-03-15');
    const withExplicitBusinessZone = zonedCalendarDateToUtc('2026-03-15', BUSINESS_TIMEZONE);
    expect(withDefault).toEqual(withExplicitBusinessZone);
    expect(withDefault.getTime()).not.toBe(new Date('2026-03-15T00:00:00.000Z').getTime());
  });

  it('adds calendar days across month and year boundaries', () => {
    expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects malformed or nonexistent calendar dates', () => {
    expect(() => zonedCalendarDateToUtc('2026-02-30', 'UTC')).toThrow();
    expect(() => addCalendarDays('not-a-date', 1)).toThrow();
  });
});
