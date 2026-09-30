import { describe, expect, it } from 'vitest';
import { mergeThread, seenAt } from '@/lib/live-thread';

const message = (id: string, createdAt: string, team = true) => ({ id, createdAt, team });

describe('live thread', () => {
  it('adds only unknown messages, in order, and says which ones', () => {
    const current = [message('a', '2026-09-30T10:00:00.000Z'), message('b', '2026-09-30T10:01:00.000Z')];
    const result = mergeThread(current, [message('b', '2026-09-30T10:01:00.000Z'), message('c', '2026-09-30T10:02:00.000Z')]);
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.added).toEqual(['c']);
  });

  it('shows "Visto" only under a last message from the team that the customer already read', () => {
    const thread = [message('a', '2026-09-30T10:00:00.000Z', false), message('b', '2026-09-30T10:05:00.000Z')];
    const isTeam = (item: { team: boolean }) => item.team;
    expect(seenAt(thread, { through: '2026-09-30T10:05:00.000Z', at: '2026-09-30T10:07:00.000Z' }, isTeam)).toBe('2026-09-30T10:07:00.000Z');
    expect(seenAt(thread, { through: '2026-09-30T10:04:00.000Z', at: '2026-09-30T10:07:00.000Z' }, isTeam)).toBeNull();
    expect(seenAt([...thread, message('c', '2026-09-30T10:06:00.000Z', false)], { through: '2026-09-30T10:06:00.000Z', at: '2026-09-30T10:07:00.000Z' }, isTeam)).toBeNull();
    expect(seenAt(thread, null, isTeam)).toBeNull();
  });
});
