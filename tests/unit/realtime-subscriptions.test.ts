import { describe, expect, it, vi } from 'vitest';
import { ANY_REQUEST, createRequestSubscriptions } from '@/lib/realtime-subscriptions';

describe('request subscriptions', () => {
  it('notifies only the matching file and parts', () => {
    const registry = createRequestSubscriptions();
    const thread = vi.fn();
    const inbox = vi.fn();
    const unsubscribe = registry.subscribe('req-1', ['messages', 'read'], thread);
    registry.subscribe(ANY_REQUEST, ['created', 'status'], inbox);
    registry.dispatch('req-1', ['messages', 'files'], false);
    registry.dispatch('req-2', ['status'], true);
    registry.dispatch('req-3', ['files'], false);
    expect(thread).toHaveBeenCalledTimes(1);
    expect(thread).toHaveBeenCalledWith({ requestId: 'req-1', parts: ['messages'], self: false, reason: 'signal' });
    expect(inbox).toHaveBeenCalledWith({ requestId: 'req-2', parts: ['status'], self: true, reason: 'signal' });
    unsubscribe();
    registry.dispatch('req-1', ['messages'], false);
    expect(thread).toHaveBeenCalledTimes(1);
  });

  it('asks every view to re-read after a reconnection', () => {
    const registry = createRequestSubscriptions();
    const view = vi.fn();
    registry.subscribe('req-1', ['files'], view);
    registry.refreshAll();
    expect(view).toHaveBeenCalledWith({ requestId: null, parts: ['files'], self: false, reason: 'resync' });
  });
});
