import { describe, expect, it } from 'vitest';
import * as preferences from '@/lib/inbox-preferences';

type PreferenceStorage = {
  getItem: (key: string) => string | null;
};

describe('inbox preferences client defaults and migration', () => {
  it('uses the approved role defaults including digest email', () => {
    expect(preferences.defaultPreferences('staff')).toEqual({ sound: true, desktop: false, activityEmail: 'DIGEST' });
    expect(preferences.defaultPreferences('portal')).toEqual({ sound: false, desktop: false, activityEmail: 'DIGEST' });
  });

  it('reads old per-browser sound and desktop values only for one-time import', () => {
    const values = new Map([
      ['ocpool.inbox.staff.sound', 'off'],
      ['ocpool.inbox.staff.desktop', 'on'],
    ]);
    const storage: PreferenceStorage = { getItem: (key) => values.get(key) ?? null };
    const reader = (preferences as unknown as {
      readLegacyPreferences?: (surface: 'staff' | 'portal', storage: PreferenceStorage) => Partial<{ sound: boolean; desktop: boolean }> | null;
    }).readLegacyPreferences;

    expect(reader).toBeTypeOf('function');
    if (!reader) return;
    expect(reader('staff', storage)).toEqual({ sound: false, desktop: true });
    expect(reader('portal', storage)).toBeNull();
  });
});