import { describe, expect, it } from 'vitest';
import { isInboxReminderSweepDue, isReminderSweepOpen } from '@/server/modules/inbox/reminders';

describe('inbox reminder schedule', () => {
  it('uses the configured Mexico timezone and includes 08:00 through 18:59, Monday to Saturday', () => {
    const inTimeZone = (value: string) => isReminderSweepOpen(new Date(value), 'America/Chihuahua');

    expect(inTimeZone('2026-10-05T13:59:00.000Z')).toBe(false); // Monday 07:59
    expect(inTimeZone('2026-10-05T14:00:00.000Z')).toBe(true); // Monday 08:00
    expect(inTimeZone('2026-10-06T00:59:00.000Z')).toBe(true); // Monday 18:59
    expect(inTimeZone('2026-10-06T01:00:00.000Z')).toBe(false); // Monday 19:00
    expect(inTimeZone('2026-10-03T16:00:00.000Z')).toBe(true); // Saturday 10:00
    expect(inTimeZone('2026-10-04T16:00:00.000Z')).toBe(false); // Sunday 10:00
  });

  it('rejects invalid dates and timezones rather than running at an undefined local hour', () => {
    expect(() => isReminderSweepOpen(new Date(Number.NaN), 'America/Chihuahua')).toThrow();
    expect(() => isReminderSweepOpen(new Date('2026-10-05T15:00:00.000Z'), 'Invalid/Zone')).toThrow();
  });

  it('keeps the continuous worker sweep at five minute intervals', () => {
    const now = new Date('2026-10-05T15:00:00.000Z');
    expect(isInboxReminderSweepDue(now, null)).toBe(true);
    expect(isInboxReminderSweepDue(new Date(now.getTime() + 4 * 60_000 + 59_999), now.getTime())).toBe(false);
    expect(isInboxReminderSweepDue(new Date(now.getTime() + 5 * 60_000), now.getTime())).toBe(true);
    expect(() => isInboxReminderSweepDue(new Date(Number.NaN), null)).toThrow();
  });
});
