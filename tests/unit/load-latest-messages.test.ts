import { describe, expect, it } from 'vitest';
import { loadThroughLatest, type MessagePage } from '@/lib/load-latest-messages';

type Message = { id: string };

function pager(total: number, size: number) {
  const calls: Array<string | undefined> = [];
  const load = async (cursor?: string): Promise<MessagePage<Message, { status: string }>> => {
    calls.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    const items = Array.from({ length: Math.min(size, total - start) }, (_, index) => ({ id: `m${start + index}` }));
    const end = start + items.length;
    return { conversation: { status: `after-${end}` }, items, nextCursor: end < total ? String(end) : null };
  };
  return { load, calls };
}

describe('loadThroughLatest', () => {
  it('follows the cursor until the newest message so the thread opens current', async () => {
    const { load, calls } = pager(250, 100);
    const result = await loadThroughLatest(load);
    expect(result.items).toHaveLength(250);
    expect(result.items.at(-1)).toEqual({ id: 'm249' });
    expect(result.nextCursor).toBeNull();
    expect(result.conversation).toEqual({ status: 'after-250' });
    expect(calls).toEqual([undefined, '100', '200']);
  });

  it('stops at the page cap and reports that more remain', async () => {
    const { load, calls } = pager(1000, 100);
    const result = await loadThroughLatest(load, 3);
    expect(result.items).toHaveLength(300);
    expect(result.nextCursor).toBe('300');
    expect(calls).toHaveLength(3);
  });

  it('makes a single request for short threads and never duplicates messages', async () => {
    const { load, calls } = pager(12, 100);
    const result = await loadThroughLatest(load);
    expect(calls).toEqual([undefined]);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(12);
  });

  it('keeps the extra fields of the last page', async () => {
    const pages = [
      { conversation: null, items: [{ id: 'a' }], nextCursor: '1', latestCursor: 'cursor-a' },
      { conversation: null, items: [{ id: 'b' }], nextCursor: null, latestCursor: 'cursor-b' },
    ];
    const result = await loadThroughLatest(async (cursor?: string) => pages[cursor ? 1 : 0]);
    expect(result).toEqual({ conversation: null, items: [{ id: 'a' }, { id: 'b' }], nextCursor: null, latestCursor: 'cursor-b' });
  });
});
