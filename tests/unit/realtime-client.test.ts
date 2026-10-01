import { describe, expect, it } from 'vitest';
import type { InboxNotification, InboxSummary } from '@/lib/inbox-client';
import { anyTabVisible, applyNotificationEvent, electLeader, parseRealtimeEvent, RealtimeController, shouldFlash, type EventSourceLike, type LockManagerLike, type RealtimeEvent, type RealtimeMode, type RealtimeNotificationEvent } from '@/lib/realtime-client';

const REQUEST = '8d4e5f60-7182-4d9e-9fa0-2b3c4d5e6f70';

const notice = (overrides: Partial<InboxNotification> = {}): InboxNotification => ({
  id: 'n1', kind: 'customer.activity', priority: 'HIGH', title: 'Laura te escribió', body: null, actionPath: '/staff/requests', quoteRequestId: REQUEST, folio: 'OCQ-1', clientName: 'Laura',
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T10:00:00.000Z', lastActivityAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
  ...overrides,
});
const event = (overrides: Partial<RealtimeNotificationEvent> = {}): RealtimeNotificationEvent => ({ type: 'notification', mode: 'created', notification: notice(), unread: 5, actionRequired: 1, requestUnread: 2, ...overrides });

class FakeSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void { this.listeners.set(type, listener); }
  close(): void { this.closed = true; this.readyState = 2; }
  emit(type: string, data: unknown): void { this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>); }
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')); }
  fail(closedByServer = false): void { this.readyState = closedByServer ? 2 : 0; this.onerror?.(new Event('error')); }
}

function fakeTimers() {
  let now = 0;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    timers: { set: (callback: () => void, ms: number) => { sequence += 1; pending.set(sequence, { at: now + ms, callback }); return sequence; }, clear: (handle: unknown) => { pending.delete(handle as number); } },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
  };
}

function controller() {
  const sources: FakeSource[] = [];
  const events: RealtimeEvent[] = [];
  const modes: RealtimeMode[] = [];
  const clock = fakeTimers();
  const instance = new RealtimeController({ open: () => { const source = new FakeSource(); sources.push(source); return source; }, onEvent: (received) => events.push(received), onMode: (mode) => modes.push(mode), timers: clock.timers });
  return { instance, sources, events, modes, clock };
}

/** Candados de la Web Locks API en memoria: exclusivos, en orden de llegada y cancelables mientras esperan. */
function fakeLocks() {
  const held = new Map<string, boolean>();
  const queues = new Map<string, Array<{ callback: () => Promise<void>; resolve: () => void }>>();
  const grant = (name: string) => {
    if (held.get(name)) return;
    const next = queues.get(name)?.shift();
    if (!next) return;
    held.set(name, true);
    void next.callback().then(() => {
      held.set(name, false);
      next.resolve();
      grant(name);
    });
  };
  const locks: LockManagerLike = {
    request: (name, options, callback) => new Promise<void>((resolve, reject) => {
      const entry = { callback, resolve };
      const queue = queues.get(name) ?? [];
      queues.set(name, queue);
      options.signal?.addEventListener('abort', () => {
        const index = queue.indexOf(entry);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      });
      queue.push(entry);
      grant(name);
    }),
    query: async () => ({ held: [...held.entries()].filter(([, isHeld]) => isHeld).map(([name]) => ({ name })) }),
  };
  return locks;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('realtime client', () => {
  it('parses only well-formed events', () => {
    expect(parseRealtimeEvent('hello', '{"unread":2,"actionRequired":1,"serverTime":"x"}')).toEqual({ type: 'hello', unread: 2, actionRequired: 1 });
    expect(parseRealtimeEvent('notification', JSON.stringify({ mode: 'created', notification: notice(), unread: 1, actionRequired: 0, requestUnread: null }))).toMatchObject({ type: 'notification', requestUnread: null });
    expect(parseRealtimeEvent('notification', JSON.stringify({ mode: 'created', notification: { id: 'x' }, unread: 1, actionRequired: 0 }))).toBeNull();
    expect(parseRealtimeEvent('notification', JSON.stringify({ mode: 'created', notification: notice({ actionPath: '//evil.example/x' }), unread: 1, actionRequired: 0 }))).toBeNull();
    expect(parseRealtimeEvent('notification', JSON.stringify({ mode: 'deleted', notification: notice(), unread: 1, actionRequired: 0 }))).toBeNull();
    expect(parseRealtimeEvent('counts', '{"unread":-1,"actionRequired":0}')).toBeNull();
    expect(parseRealtimeEvent('bye', '{"reason":"session"}')).toEqual({ type: 'bye', reason: 'session' });
    expect(parseRealtimeEvent('request', JSON.stringify({ requestId: REQUEST, parts: ['messages', 'bogus'], self: true, at: 'x' }))).toEqual({ type: 'request', requestId: REQUEST, parts: ['messages'], self: true });
    expect(parseRealtimeEvent('request', JSON.stringify({ requestId: REQUEST, parts: ['bogus'] }))).toBeNull();
    expect(parseRealtimeEvent('resync', '{}')).toEqual({ type: 'resync' });
    expect(parseRealtimeEvent('ping', '{"at":"x"}')).toBeNull();
    expect(parseRealtimeEvent('counts', 'not json')).toBeNull();
  });

  it('upserts a notice without duplicates and keeps the per-file count', () => {
    const summary: InboxSummary = { unread: 1, actionRequired: 0, latest: [notice({ id: 'old', lastActivityAt: '2026-09-29T09:00:00.000Z' }), notice({ id: 'n1', title: 'Antes' })], unreadByRequest: { [REQUEST]: 1 } };
    const next = applyNotificationEvent(summary, event({ notification: notice({ title: 'Después', lastActivityAt: '2026-09-29T11:00:00.000Z' }) }));
    expect(next.latest.map((item) => [item.id, item.title])).toEqual([['n1', 'Después'], ['old', 'Laura te escribió']]);
    expect(next).toMatchObject({ unread: 5, actionRequired: 1, unreadByRequest: { [REQUEST]: 2 } });
    expect(applyNotificationEvent(next, event({ requestUnread: 0 })).unreadByRequest).toEqual({});
    expect(applyNotificationEvent(next, event({ requestUnread: null })).unreadByRequest).toEqual({ [REQUEST]: 2 });
    const many = Array.from({ length: 20 }, (_, index) => notice({ id: `m${index}`, lastActivityAt: `2026-09-28T${String(index).padStart(2, '0')}:00:00.000Z` }));
    expect(applyNotificationEvent({ ...summary, latest: many }, event()).latest).toHaveLength(20);
  });

  it('flashes only what deserves it', () => {
    expect(shouldFlash(event(), null)).toBe(true);
    expect(shouldFlash(event({ mode: 'updated' }), null)).toBe(true);
    expect(shouldFlash(event({ mode: 'resolved' }), null)).toBe(false);
    expect(shouldFlash(event({ notification: notice({ readAt: '2026-09-29T10:01:00.000Z' }) }), null)).toBe(false);
    expect(shouldFlash(event({ notification: notice({ priority: 'NORMAL' }) }), null)).toBe(false);
    // La actividad del expediente abierto no destella, salvo lo urgente.
    expect(shouldFlash(event(), REQUEST)).toBe(false);
    // Una pestaña oculta no cuenta como alguien que está mirando el expediente; si ninguna otra lo muestra, el escritorio puede avisar.
    expect(shouldFlash(event(), REQUEST, false)).toBe(true);
    expect(shouldFlash(event({ notification: notice({ kind: 'quote.changes_requested', priority: 'URGENT' }) }), REQUEST)).toBe(true);
    expect(shouldFlash(event({ notification: notice({ kind: 'approval.resolved' }) }), REQUEST)).toBe(true);
  });

  it('elects a single leader and hands over when it leaves', async () => {
    const locks = fakeLocks();
    const leaders: string[] = [];
    const stopFirst = electLeader(locks, () => { leaders.push('first'); return () => leaders.push('first stops'); });
    const stopSecond = electLeader(locks, () => { leaders.push('second'); return () => leaders.push('second stops'); });
    await settle();
    expect(leaders).toEqual(['first']);
    stopFirst();
    await settle();
    expect(leaders).toEqual(['first', 'first stops', 'second']);
    stopSecond();
    await settle();
    expect(leaders).toEqual(['first', 'first stops', 'second', 'second stops']);
  });

  it('gives up waiting without ever leading when it leaves first', async () => {
    const locks = fakeLocks();
    const leaders: string[] = [];
    const stopFirst = electLeader(locks, () => { leaders.push('first'); return () => undefined; });
    const stopWaiting = electLeader(locks, () => { leaders.push('waiting'); return () => undefined; });
    await settle();
    stopWaiting();
    stopFirst();
    await settle();
    expect(leaders).toEqual(['first']);
  });

  it('knows whether some tab is on screen', async () => {
    const locks = fakeLocks();
    expect(await anyTabVisible(locks, true)).toBe(true);
    expect(await anyTabVisible(locks, false)).toBe(false);
    void locks.request('ocpool-visible:tab-2', { mode: 'exclusive' }, () => new Promise(() => undefined));
    await settle();
    expect(await anyTabVisible(locks, false)).toBe(true);
  });

  it('goes live on the first event and forwards it', () => {
    const { instance, sources, events, modes } = controller();
    instance.start();
    sources[0].open();
    sources[0].emit('hello', { unread: 1, actionRequired: 0 });
    sources[0].emit('ping', { at: 'x' });
    expect(modes).toEqual(['connecting', 'live']);
    expect(events).toEqual([{ type: 'hello', unread: 1, actionRequired: 0 }]);
  });

  it('falls back to polling after three errors in a row or a server refusal, and retries in five minutes', () => {
    const { instance, sources, modes, clock } = controller();
    instance.start();
    sources[0].fail();
    sources[0].fail();
    expect(modes.at(-1)).toBe('connecting');
    sources[0].fail();
    expect(modes.at(-1)).toBe('polling');
    expect(sources[0].closed).toBe(true);
    clock.advance(5 * 60_000);
    expect(sources).toHaveLength(2);
    expect(modes.at(-1)).toBe('connecting');
    sources[1].fail(true);
    expect(modes.at(-1)).toBe('polling');
  });

  it('falls back after sixty seconds of silence and stops for good on bye', () => {
    const { instance, sources, events, modes, clock } = controller();
    instance.start();
    sources[0].emit('hello', { unread: 0, actionRequired: 0 });
    clock.advance(59_000);
    sources[0].emit('ping', {});
    clock.advance(59_000);
    expect(modes.at(-1)).toBe('live');
    clock.advance(1_000);
    expect(modes.at(-1)).toBe('polling');
    clock.advance(5 * 60_000);
    sources[1].emit('bye', { reason: 'session' });
    expect(modes.at(-1)).toBe('closed');
    expect(events.at(-1)).toEqual({ type: 'bye', reason: 'session' });
    clock.advance(10 * 60_000);
    expect(sources).toHaveLength(2);
  });

  it('stops cleanly and ignores late events from a closed source', () => {
    const { instance, sources, events, modes } = controller();
    instance.start();
    instance.stop();
    sources[0].emit('hello', { unread: 0, actionRequired: 0 });
    expect(events).toEqual([]);
    expect(modes).toEqual(['connecting', 'closed']);
  });
});
