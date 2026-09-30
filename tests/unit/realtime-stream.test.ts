import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import type { RealtimeConnection } from '@/server/realtime/hub';
import { createRealtimeStream, type RealtimeStreamOptions } from '@/server/realtime/stream';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SESSION = '9e5f6071-8293-4eaf-a0b1-3c4d5e6f7081';
const NOTICE = '7c3d4e5f-6071-4c8d-8e9f-1a2b3c4d5e6f';
const actor: Actor = { userId: USER, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(), mfaVerified: true };

const notice: InboxNotificationDto = {
  id: NOTICE, kind: 'customer.activity', priority: 'HIGH', title: 'Laura te escribió', body: null, actionPath: '/staff/requests', quoteRequestId: null, folio: null, clientName: null,
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T20:00:00.000Z', lastActivityAt: '2026-09-29T20:00:00.000Z', updatedAt: '2026-09-29T20:00:01.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
};

async function readText(stream: ReadableStream<Uint8Array>, until: string): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(until)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  reader.releaseLock();
  return text;
}

function setup(overrides: Partial<RealtimeStreamOptions> = {}) {
  const registered: RealtimeConnection[] = [];
  const unregister = vi.fn();
  const abort = new AbortController();
  const stream = createRealtimeStream({
    hub: { register: (connection) => { registered.push(connection); return unregister; } },
    session: { sessionId: SESSION, actor },
    signal: abort.signal,
    lastEventId: null,
    heartbeatMs: 1_000,
    recheckMs: 5_000,
    counts: async () => ({ unread: 4, actionRequired: 2 }),
    revalidate: async () => actor,
    resume: async () => ({ items: [], more: false }),
    now: () => new Date('2026-09-29T20:00:00.000Z'),
    ...overrides,
  });
  return { stream, registered, unregister, abort };
}

describe('realtime stream', () => {
  afterEach(() => vi.useRealTimers());

  it('opens with retry and hello, pings, and says bye when the session stops being valid', async () => {
    vi.useFakeTimers();
    let valid = true;
    const { stream, registered, unregister } = setup({ revalidate: async () => (valid ? actor : null) });
    expect(await readText(stream, 'event: hello')).toBe('retry: 5000\n\nevent: hello\ndata: {"unread":4,"actionRequired":2,"serverTime":"2026-09-29T20:00:00.000Z"}\n\n');
    expect(registered).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await readText(stream, 'event: ping')).toContain('data: {"at":"2026-09-29T20:00:00.000Z"}');
    valid = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await readText(stream, 'event: bye')).toContain('event: bye\ndata: {"reason":"session"}');
    expect(unregister).toHaveBeenCalled();
    expect(await readText(stream, 'never')).toBe('');
  });

  it('keeps the connection when the session check fails for a moment, and takes the refreshed actor', async () => {
    vi.useFakeTimers();
    const refreshed: Actor = { ...actor, permissionKeys: new Set(['requests.read']) };
    const revalidate = vi.fn<() => Promise<Actor | null>>().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(refreshed);
    const { stream, registered, unregister } = setup({ revalidate, heartbeatMs: 60_000 });
    await readText(stream, 'event: hello');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(unregister).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(registered[0].actor).toBe(refreshed);
  });

  it('writes what the hub sends, with the event id only on notices', async () => {
    const { stream, registered } = setup();
    await readText(stream, 'event: hello');
    registered[0].send({ event: 'counts', data: { unread: 1, actionRequired: 0 } });
    registered[0].send({ event: 'notification', id: `1-${NOTICE}`, data: { mode: 'created', notification: notice, unread: 1, actionRequired: 0, requestUnread: null } });
    const text = await readText(stream, 'event: notification');
    expect(text).toContain('event: counts\ndata: {"unread":1,"actionRequired":0}\n\n');
    expect(text).toContain(`id: 1-${NOTICE}\nevent: notification\n`);
  });

  it('replays what changed after Last-Event-ID and asks for a resync when there is more', async () => {
    const resume = vi.fn(async () => ({ items: [notice], more: true }));
    const { stream } = setup({ lastEventId: `1790000000000-${NOTICE}`, resume });
    const text = await readText(stream, 'event: resync');
    expect(resume).toHaveBeenCalledWith({ at: new Date(1790000000000), id: NOTICE });
    expect(text).toContain(`id: ${Date.parse(notice.updatedAt)}-${NOTICE}\nevent: notification\n`);
    expect(text).toContain('"mode":"updated"');
    expect(text.indexOf('event: hello')).toBeLessThan(text.indexOf('event: notification'));
  });

  it('closes quietly when the counts cannot be read, so the browser retries', async () => {
    const { stream, unregister } = setup({ counts: async () => { throw new Error('db down'); } });
    expect(await readText(stream, 'never')).toBe('retry: 5000\n\n');
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('cleans up once when the browser goes away', async () => {
    const { stream, unregister, abort } = setup({ heartbeatMs: 25_000, recheckMs: 60_000 });
    await readText(stream, 'event: hello');
    abort.abort();
    await stream.cancel().catch(() => undefined);
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
