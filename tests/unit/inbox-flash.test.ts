import { describe, expect, it } from 'vitest';
import type { InboxNotification } from '@/lib/inbox-client';
import { FLASH_HIGH_MS, FLASH_QUEUE_LIMIT, flashReducer, visibleFlashes, type FlashItem } from '@/lib/inbox-flash';
import { defaultPreferences, readPreferences, writePreference } from '@/lib/inbox-preferences';
import { createSoundGate } from '@/lib/inbox-sound';

const notice = (id: string, priority: InboxNotification['priority'] = 'HIGH'): InboxNotification => ({
  id, kind: 'customer.activity', priority, title: `Aviso ${id}`, body: null, actionPath: '/staff/requests', quoteRequestId: null, folio: null, clientName: null,
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T10:00:00.000Z', lastActivityAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
});

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const show = (state: FlashItem[], id: string, priority: InboxNotification['priority'] = 'HIGH') => flashReducer(state, { type: 'show', notification: notice(id, priority) });

describe('flash queue, preferences and sound', () => {
  it('shows the newest first and replaces a grouped notice instead of duplicating it', () => {
    let state: FlashItem[] = [];
    state = show(state, 'a');
    state = show(state, 'b', 'URGENT');
    state = show(state, 'a');
    expect(state.map((item) => [item.notification.id, item.revision, item.remainingMs])).toEqual([['a', 2, FLASH_HIGH_MS], ['b', 1, null]]);
    state = flashReducer(state, { type: 'pause', id: 'a', paused: true, remainingMs: 3000 });
    expect(state[0]).toMatchObject({ paused: true, remainingMs: 3000 });
    state = flashReducer(state, { type: 'pause', id: 'a', paused: false });
    expect(state[0]).toMatchObject({ paused: false, remainingMs: 3000 });
    // Al volver a llegar, el tiempo se reinicia.
    state = show(state, 'a');
    expect(state[0]).toMatchObject({ revision: 3, remainingMs: FLASH_HIGH_MS, paused: false });
  });

  it('dismisses one, several or all', () => {
    let state = ['a', 'b', 'c'].reduce<FlashItem[]>((current, id) => show(current, id), []);
    state = flashReducer(state, { type: 'dismiss', ids: ['b'] });
    expect(state.map((item) => item.notification.id)).toEqual(['c', 'a']);
    state = flashReducer(state, { type: 'dismiss', ids: ['a', 'missing'] });
    expect(state.map((item) => item.notification.id)).toEqual(['c']);
    expect(flashReducer(state, { type: 'clear' })).toEqual([]);
    expect(flashReducer(state, { type: 'dismiss', ids: [] })).toBe(state);
  });

  it('shows three on desktop and two on mobile, counting the rest, and never grows without limit', () => {
    const state = ['a', 'b', 'c', 'd'].reduce<FlashItem[]>((current, id) => show(current, id), []);
    expect(visibleFlashes(state, false).shown.map((item) => item.notification.id)).toEqual(['d', 'c', 'b']);
    expect(visibleFlashes(state, false).overflow).toBe(1);
    expect(visibleFlashes(state, true)).toMatchObject({ overflow: 2 });
    const burst = Array.from({ length: FLASH_QUEUE_LIMIT + 5 }, (_, index) => `n${index}`).reduce<FlashItem[]>((current, id) => show(current, id), []);
    expect(burst).toHaveLength(FLASH_QUEUE_LIMIT);
    expect(burst[0].notification.id).toBe(`n${FLASH_QUEUE_LIMIT + 4}`);
  });

  it('keeps sound on for the team and off for customers until each person changes it', () => {
    expect(defaultPreferences('staff')).toEqual({ sound: true, desktop: false });
    expect(defaultPreferences('portal')).toEqual({ sound: false, desktop: false });
    const storage = new MemoryStorage();
    writePreference('portal', 'sound', true, storage);
    writePreference('portal', 'desktop', true, storage);
    expect(readPreferences('portal', storage)).toEqual({ sound: true, desktop: true });
    expect(readPreferences('staff', storage)).toEqual({ sound: true, desktop: false });
    writePreference('staff', 'sound', false, storage);
    expect(readPreferences('staff', storage)).toEqual({ sound: false, desktop: false });
    expect(readPreferences('staff', null)).toEqual({ sound: true, desktop: false });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readPreferences('staff', broken)).toEqual({ sound: true, desktop: false });
    expect(() => writePreference('staff', 'sound', false, broken)).not.toThrow();
  });

  it('plays at most one sound every three seconds', () => {
    let now = 0;
    const gate = createSoundGate(() => now);
    expect(gate()).toBe(true);
    now = 2_999;
    expect(gate()).toBe(false);
    now = 3_000;
    expect(gate()).toBe(true);
  });
});
