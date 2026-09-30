import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeListener, type ListenerClient } from '@/server/realtime/listener';
import type { RealtimeSignal } from '@/server/realtime/publish';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

class FakeClient extends EventEmitter {
  queries: string[] = [];
  ended = false;
  constructor(private readonly failConnect = false) { super(); }
  async connect(): Promise<void> { if (this.failConnect) throw new Error('down'); }
  async query(sql: string): Promise<void> { this.queries.push(sql); }
  async end(): Promise<void> { this.ended = true; }
}

const asClient = (client: FakeClient) => client as unknown as ListenerClient;

describe('realtime listener', () => {
  afterEach(() => vi.useRealTimers());

  it('listens on the channel and forwards only valid signals', async () => {
    const client = new FakeClient();
    const signals: RealtimeSignal[] = [];
    const onReconnected = vi.fn();
    const listener = new RealtimeListener({ createClient: () => asClient(client), onSignal: (signal) => signals.push(signal), onReconnected });
    await listener.start();
    expect(client.queries).toEqual(['LISTEN ocpool_realtime']);
    client.emit('notification', { channel: 'ocpool_realtime', payload: JSON.stringify({ t: 'u', u: USER }) });
    client.emit('notification', { channel: 'ocpool_realtime', payload: 'garbage' });
    client.emit('notification', { channel: 'ocpool_realtime' });
    expect(signals).toEqual([{ t: 'u', u: USER }]);
    expect(onReconnected).not.toHaveBeenCalled();
    await listener.stop();
    expect(client.ended).toBe(true);
  });

  it('reconnects with a growing wait when the connection drops and asks for a resync', async () => {
    vi.useFakeTimers();
    const clients = [new FakeClient(), new FakeClient(true), new FakeClient()];
    let index = 0;
    const onReconnected = vi.fn();
    const listener = new RealtimeListener({ createClient: () => asClient(clients[index++]), onSignal: () => undefined, onReconnected });
    await listener.start();
    clients[0].emit('error', new Error('socket closed'));
    clients[0].emit('end');
    expect(clients[0].ended).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(index).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(index).toBe(2);
    expect(onReconnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(index).toBe(3);
    expect(clients[2].queries).toEqual(['LISTEN ocpool_realtime']);
    expect(onReconnected).toHaveBeenCalledTimes(1);
    await listener.stop();
  });

  it('keeps retrying in the background when the first connection fails, and stops for good on stop()', async () => {
    vi.useFakeTimers();
    const created: FakeClient[] = [];
    const listener = new RealtimeListener({ createClient: () => { const client = new FakeClient(true); created.push(client); return asClient(client); }, onSignal: () => undefined, onReconnected: () => undefined });
    await expect(listener.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(created).toHaveLength(2);
    await listener.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(2);
  });
});
