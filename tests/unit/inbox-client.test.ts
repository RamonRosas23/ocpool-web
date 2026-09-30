import { afterEach, describe, expect, it, vi } from 'vitest';
import { badgeCount, fetchInboxSummary, filterInbox, groupInboxByDay, InboxRequestError, titleWithBadge, type InboxNotification } from '@/lib/inbox-client';

const item = (overrides: Partial<InboxNotification>): InboxNotification => ({
  id: 'n1', kind: 'customer.activity', priority: 'HIGH', title: 'Aviso', body: null, actionPath: '/staff/requests', quoteRequestId: null, folio: null, clientName: null,
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T10:00:00', lastActivityAt: '2026-09-29T10:00:00', updatedAt: '2026-09-29T10:00:00', readAt: null, resolvedAt: null, resolvedNote: null,
  ...overrides,
});

describe('inbox client helpers', () => {
  it('prefixes the tab title with the unread count and removes it at zero', () => {
    expect(titleWithBadge('Solicitudes | OCPOOL Operaciones', 3)).toBe('(3) Solicitudes | OCPOOL Operaciones');
    expect(titleWithBadge('(3) Solicitudes | OCPOOL Operaciones', 120)).toBe('(99+) Solicitudes | OCPOOL Operaciones');
    expect(titleWithBadge('(99+) Solicitudes | OCPOOL Operaciones', 0)).toBe('Solicitudes | OCPOOL Operaciones');
    expect(badgeCount(7)).toBe('7');
  });

  it('filters unread and action-required notices', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', readAt: '2026-09-29T11:00:00' }), item({ id: 'c', actionRequired: true, readAt: '2026-09-29T11:00:00' }), item({ id: 'd', actionRequired: true, resolvedAt: '2026-09-29T11:00:00' })];
    expect(filterInbox(items, 'all').map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterInbox(items, 'unread').map(({ id }) => id)).toEqual(['a']);
    expect(filterInbox(items, 'action').map(({ id }) => id)).toEqual(['c']);
  });

  it('groups by local day', () => {
    const now = new Date('2026-09-29T15:00:00');
    const groups = groupInboxByDay([
      item({ id: 'today', lastActivityAt: '2026-09-29T09:00:00' }),
      item({ id: 'yesterday', lastActivityAt: '2026-09-28T22:00:00' }),
      item({ id: 'week', lastActivityAt: '2026-09-25T10:00:00' }),
      item({ id: 'older', lastActivityAt: '2026-09-01T10:00:00' }),
    ], now);
    expect(groups.map(({ label, items }) => [label, items.map(({ id }) => id)])).toEqual([['Hoy', ['today']], ['Ayer', ['yesterday']], ['Esta semana', ['week']], ['Antes', ['older']]]);
  });

  describe('reading responses', () => {
    afterEach(() => vi.unstubAllGlobals());
    const respondWith = (response: Partial<Response>) => vi.stubGlobal('fetch', vi.fn(async () => response as Response));

    it('never turns a body cut by a cancelled request into an empty summary', async () => {
      // Una consulta nueva cancela la anterior: si ya había encabezados, la lectura del cuerpo falla con AbortError.
      respondWith({ ok: true, status: 200, json: () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')) });
      await expect(fetchInboxSummary()).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects an unreadable successful body and keeps the server message on errors', async () => {
      respondWith({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) });
      await expect(fetchInboxSummary()).rejects.toBeInstanceOf(SyntaxError);
      respondWith({ ok: false, status: 403, json: () => Promise.resolve({ error: { message: 'Sin permiso.' } }) });
      await expect(fetchInboxSummary()).rejects.toEqual(new InboxRequestError('Sin permiso.', 403));
    });
  });
});
