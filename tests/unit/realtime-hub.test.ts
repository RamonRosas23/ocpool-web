import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import { RealtimeHub, requestSignalVisibleTo, type ByeReason, type RealtimeConnection, type RealtimeHubDependencies, type RealtimeServerEvent } from '@/server/realtime/hub';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '6b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const NOTICE = '7c3d4e5f-6071-4c8d-8e9f-1a2b3c4d5e6f';
const REQUEST = '8d4e5f60-7182-4d9e-9fa0-2b3c4d5e6f70';
const SESSION_A = '9e5f6071-8293-4eaf-a0b1-3c4d5e6f7081';
const SESSION_B = 'af607182-93a4-4fb0-b1c2-4d5e6f708192';

type FakeConnection = RealtimeConnection & { events: RealtimeServerEvent[]; closedWith: ByeReason | null };

const actorFor = (userId: string): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(), mfaVerified: true });

function connection(userId: string, sessionId: string, openedAt = 1): FakeConnection {
  const fake: FakeConnection = {
    userId,
    sessionId,
    openedAt,
    actor: actorFor(userId),
    events: [],
    closedWith: null,
    send(event) { fake.events.push(event); },
    close(reason) { fake.closedWith = reason; },
  };
  return fake;
}

const notice = (overrides: Partial<InboxNotificationDto> = {}): InboxNotificationDto => ({
  id: NOTICE, kind: 'customer.activity', priority: 'HIGH', title: 'Laura te escribió', body: null, actionPath: '/staff/requests', quoteRequestId: REQUEST, folio: 'OCQ-2026-000001', clientName: 'Laura',
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T20:00:00.000Z', lastActivityAt: '2026-09-29T20:00:00.000Z', updatedAt: '2026-09-29T20:00:00.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
  ...overrides,
});

function createHub(overrides: Partial<RealtimeHubDependencies> = {}) {
  const deps: RealtimeHubDependencies = {
    loadNotification: vi.fn(async () => notice()),
    loadCounts: vi.fn(async () => ({ unread: 3, actionRequired: 1 })),
    loadRequestUnread: vi.fn(async () => 2),
    maxConnectionsPerUser: () => 10,
    ...overrides,
  };
  return { hub: new RealtimeHub(deps), deps };
}

describe('realtime hub', () => {
  it('sends a notice with fresh counts only to its recipient', async () => {
    const { hub } = createHub();
    const mine = connection(USER, SESSION_A);
    const theirs = connection(OTHER, SESSION_B);
    hub.register(mine);
    hub.register(theirs);
    await hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'created' });
    expect(mine.events).toEqual([{ event: 'notification', id: `${Date.parse('2026-09-29T20:00:00.000Z')}-${NOTICE}`, data: { mode: 'created', notification: notice(), unread: 3, actionRequired: 1, requestUnread: 2 } }]);
    expect(theirs.events).toEqual([]);
  });

  it('does not ask for a per-file count when the notice has no file', async () => {
    const loadRequestUnread = vi.fn(async () => 7);
    const { hub } = createHub({ loadNotification: vi.fn(async () => notice({ quoteRequestId: null })), loadRequestUnread });
    const mine = connection(USER, SESSION_A);
    hub.register(mine);
    await hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'updated' });
    expect(loadRequestUnread).not.toHaveBeenCalled();
    expect(mine.events[0]).toMatchObject({ data: { mode: 'updated', requestUnread: null } });
  });

  it('drops a notice the person can no longer see and skips people without connections', async () => {
    const loadNotification = vi.fn(async () => null);
    const { hub } = createHub({ loadNotification });
    const mine = connection(USER, SESSION_A);
    hub.register(mine);
    await hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'updated' });
    expect(mine.events).toEqual([]);
    await hub.dispatch({ t: 'n', u: OTHER, id: NOTICE, m: 'created' });
    expect(loadNotification).toHaveBeenCalledTimes(1);
  });

  it('sends the counts after a read elsewhere to every connection of that person', async () => {
    const { hub } = createHub();
    const first = connection(USER, SESSION_A);
    const second = connection(USER, SESSION_B);
    hub.register(first);
    hub.register(second);
    await hub.dispatch({ t: 'u', u: USER });
    for (const each of [first, second]) expect(each.events).toEqual([{ event: 'counts', data: { unread: 3, actionRequired: 1 } }]);
  });

  it('keeps the order of the signals of each person even when a lookup is slow', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const { hub } = createHub({ loadNotification: vi.fn(async () => { await slow; return notice(); }) });
    const mine = connection(USER, SESSION_A);
    hub.register(mine);
    const first = hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'created' });
    const second = hub.dispatch({ t: 'u', u: USER });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(mine.events.map((event) => event.event)).toEqual(['notification', 'counts']);
  });

  it('keeps going after a failed lookup', async () => {
    const loadNotification = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(notice());
    const { hub } = createHub({ loadNotification });
    const mine = connection(USER, SESSION_A);
    hub.register(mine);
    await expect(hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'created' })).rejects.toThrow('db down');
    await hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'updated' });
    expect(mine.events).toHaveLength(1);
  });

  it('closes one session, every other one, or all of them, right away', async () => {
    const { hub } = createHub();
    const a = connection(USER, SESSION_A);
    const b = connection(USER, SESSION_B);
    hub.register(a);
    hub.register(b);
    await hub.dispatch({ t: 's', u: USER, sid: SESSION_B });
    expect([a.closedWith, b.closedWith]).toEqual([null, 'session']);
    const c = connection(USER, SESSION_B);
    hub.register(c);
    await hub.dispatch({ t: 's', u: USER, keep: SESSION_A });
    expect([a.closedWith, c.closedWith]).toEqual([null, 'session']);
    await hub.dispatch({ t: 's', u: USER });
    expect(a.closedWith).toBe('session');
    expect(hub.size).toBe(0);
  });

  it('keeps at most N connections per person, closing the oldest', () => {
    const { hub } = createHub({ maxConnectionsPerUser: () => 2 });
    const oldest = connection(USER, SESSION_A, 1);
    const middle = connection(USER, SESSION_A, 2);
    hub.register(oldest);
    hub.register(middle);
    hub.register(connection(USER, SESSION_A, 3));
    expect(oldest.closedWith).toBe('replaced');
    expect(middle.closedWith).toBeNull();
    expect(hub.size).toBe(2);
  });

  it('asks everyone to resync after a reconnection and forgets unregistered connections', () => {
    const { hub } = createHub();
    const kept = connection(USER, SESSION_A);
    const gone = connection(OTHER, SESSION_B);
    hub.register(kept);
    const unregister = hub.register(gone);
    unregister();
    unregister();
    hub.broadcastResync();
    expect(kept.events).toEqual([{ event: 'resync', data: {} }]);
    expect(gone.events).toEqual([]);
    expect(hub.size).toBe(1);
  });

  it('sends request changes only to whoever can open the file', async () => {
    const { hub } = createHub();
    const OWNER = USER;
    const CLIENT = '1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b';
    const manager = { ...connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SESSION_A), actor: { ...actorFor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), permissionKeys: new Set(['requests.read.global']) } };
    const owner = connection(OWNER, SESSION_A);
    const otherSales = connection(OTHER, SESSION_B);
    const customer = { ...connection('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SESSION_A), actor: { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', type: 'CUSTOMER' as const, clientId: CLIENT, permissionKeys: new Set<string>(), mfaVerified: false } };
    for (const each of [manager, owner, otherSales, customer]) hub.register(each);
    await hub.dispatch({ t: 'r', r: REQUEST, c: CLIENT, a: OWNER, b: OWNER, p: ['messages'], v: 'C' });
    expect(manager.events).toEqual([{ event: 'request', data: { requestId: REQUEST, parts: ['messages'], self: false, at: expect.any(String) } }]);
    expect(owner.events).toEqual([{ event: 'request', data: expect.objectContaining({ self: true }) }]);
    expect(otherSales.events).toEqual([]);
    expect(customer.events).toHaveLength(1);
    await hub.dispatch({ t: 'r', r: REQUEST, c: CLIENT, a: OWNER, p: ['approvals'], v: 'I' });
    expect(customer.events).toHaveLength(1);
  });

  it('decides the scope of a request change like the request read scope', () => {
    const signal = { t: 'r' as const, r: REQUEST, c: 'client', a: USER, p: ['status' as const], v: 'I' as const };
    expect(requestSignalVisibleTo(actorFor(USER), signal)).toBe(true);
    expect(requestSignalVisibleTo(actorFor(OTHER), signal)).toBe(false);
    expect(requestSignalVisibleTo(actorFor(OTHER), { ...signal, pa: OTHER })).toBe(true);
    expect(requestSignalVisibleTo(actorFor(OTHER), { ...signal, a: null })).toBe(true);
    expect(requestSignalVisibleTo({ userId: OTHER, type: 'CUSTOMER', clientId: 'client', permissionKeys: new Set(), mfaVerified: false }, signal)).toBe(false);
    expect(requestSignalVisibleTo({ userId: OTHER, type: 'CUSTOMER', clientId: 'client', permissionKeys: new Set(), mfaVerified: false }, { ...signal, v: 'C' })).toBe(true);
    expect(requestSignalVisibleTo({ userId: OTHER, type: 'CUSTOMER', clientId: 'another', permissionKeys: new Set(), mfaVerified: false }, { ...signal, v: 'C' })).toBe(false);
  });
});
