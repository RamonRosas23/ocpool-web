export type InboxPriorityClient = 'URGENT' | 'HIGH' | 'NORMAL' | 'INFO';

/** Mismo contrato que `InboxNotificationDto` del servidor (src/server/modules/inbox/service.ts). */
export type InboxNotification = {
  id: string;
  kind: string;
  priority: InboxPriorityClient;
  title: string;
  body: string | null;
  actionPath: string;
  quoteRequestId: string | null;
  folio: string | null;
  clientName: string | null;
  occurrences: number;
  actionRequired: boolean;
  createdAt: string;
  lastActivityAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
};

export type InboxSummary = { unread: number; actionRequired: number; latest: InboxNotification[]; unreadByRequest: Record<string, number> };
export type InboxPage = { items: InboxNotification[]; nextCursor: string | null };
export type InboxFilter = 'all' | 'unread' | 'action';
export type MarkReadInput = { ids: string[]; read?: boolean } | { all: true } | { quoteRequestId: string; scope: 'activity' | 'all' };
export type InboxDayGroup = { key: 'today' | 'yesterday' | 'week' | 'older'; label: string; items: InboxNotification[] };

export class InboxRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'InboxRequestError';
  }
}

export function isUnread(item: InboxNotification): boolean {
  return !item.readAt && !item.resolvedAt;
}

export function needsAction(item: InboxNotification): boolean {
  return item.actionRequired && !item.resolvedAt;
}

export function filterInbox(items: readonly InboxNotification[], filter: InboxFilter): InboxNotification[] {
  if (filter === 'unread') return items.filter(isUnread);
  if (filter === 'action') return items.filter(needsAction);
  return [...items];
}

const DAY_LABELS: Record<InboxDayGroup['key'], string> = { today: 'Hoy', yesterday: 'Ayer', week: 'Esta semana', older: 'Antes' };

export function groupInboxByDay(items: readonly InboxNotification[], now: Date = new Date()): InboxDayGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const buckets = new Map<InboxDayGroup['key'], InboxNotification[]>();
  for (const item of items) {
    const at = new Date(item.lastActivityAt);
    const key: InboxDayGroup['key'] = at >= startOfToday ? 'today' : at >= startOfYesterday ? 'yesterday' : at >= startOfWeek ? 'week' : 'older';
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return (['today', 'yesterday', 'week', 'older'] as const).flatMap((key) => {
    const bucket = buckets.get(key);
    return bucket ? [{ key, label: DAY_LABELS[key], items: bucket }] : [];
  });
}

const BADGE_PREFIX = /^\(\d+\+?\)\s/u;

export function badgeCount(value: number): string {
  return value > 99 ? '99+' : String(value);
}

/** "(3) Solicitudes | OCPOOL Operaciones": el pendiente se ve aunque la pestaña esté en segundo plano. */
export function titleWithBadge(title: string, unread: number): string {
  const base = title.replace(BADGE_PREFIX, '');
  return unread > 0 ? `(${badgeCount(unread)}) ${base}` : base;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new InboxRequestError(data.error?.message ?? fallback, response.status);
  return data;
}

export async function fetchInboxSummary(signal?: AbortSignal): Promise<InboxSummary> {
  const response = await fetch('/api/notifications/summary', { credentials: 'include', cache: 'no-store', signal });
  return readJson<InboxSummary>(response, 'No fue posible consultar tus avisos.');
}

export async function fetchInboxPage(filter: InboxFilter, cursor?: string | null, signal?: AbortSignal): Promise<InboxPage> {
  const params = new URLSearchParams({ filter });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/notifications?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal });
  return readJson<InboxPage>(response, 'No fue posible consultar tus avisos.');
}

export async function postInboxRead(input: MarkReadInput): Promise<{ updated: number; unread: number; actionRequired: number }> {
  const response = await fetch('/api/notifications/read', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return readJson(response, 'No fue posible marcar tus avisos.');
}
