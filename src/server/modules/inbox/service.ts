import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import { staffRequestReadScopeWhere } from '@/server/auth/request-scope';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { publishRealtime } from '@/server/realtime/publish';
import type { InboxCategory } from '@/lib/inbox-categories';
import { inboxKindsInCategory, isInboxKind, type InboxKind, type InboxPriority } from './kinds';

export const INBOX_FILTERS = ['all', 'unread', 'action'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export type InboxNotificationDto = Readonly<{
  id: string;
  kind: InboxKind;
  priority: InboxPriority;
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
}>;

export type InboxCounts = Readonly<{ unread: number; actionRequired: number }>;
export type InboxSummary = InboxCounts & Readonly<{ latest: InboxNotificationDto[]; unreadByRequest: Record<string, number> }>;
export type InboxPage = Readonly<{ items: InboxNotificationDto[]; nextCursor: string | null }>;
export type MarkInboxReadInput =
  | Readonly<{ ids: readonly string[]; read?: boolean }>
  | Readonly<{ all: true }>
  | Readonly<{ quoteRequestId: string; scope: 'activity' | 'all' }>;

type Dependencies = Readonly<{ prisma?: PrismaClient; now?: Date }>;

const SUMMARY_LATEST = 20;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_IDS = 100;
const MAX_SEARCH_LENGTH = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Lo que cuenta la campana: sin leer, sin resolver y no informativo. */
const BADGE_WHERE: Prisma.InboxNotificationWhereInput = { readAt: null, resolvedAt: null, priority: { not: 'INFO' } };
/** "Sin leer" en la lista sí muestra lo informativo. */
const UNREAD_LIST_WHERE: Prisma.InboxNotificationWhereInput = { readAt: null, resolvedAt: null };
/** "Requieren acción": sin resolver, aunque ya se haya leído. */
const ACTION_WHERE: Prisma.InboxNotificationWhereInput = { actionRequired: true, resolvedAt: null };

const DTO_SELECT = {
  id: true, kind: true, priority: true, title: true, body: true, actionPath: true, quoteRequestId: true, data: true,
  occurrences: true, actionRequired: true, createdAt: true, lastActivityAt: true, readAt: true, resolvedAt: true, resolvedNote: true,
} as const;

type DtoRow = Prisma.InboxNotificationGetPayload<{ select: typeof DTO_SELECT }>;

function requireInboxActor(actor: Actor): void {
  if (actor.type !== 'CUSTOMER') return;
  if (!actor.clientId) throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'portal.self.read');
}

/** Cada quien ve lo suyo; el equipo, además, sólo mientras siga pudiendo abrir el expediente (spec §2.5). */
export function inboxScopeWhere(actor: Actor): Prisma.InboxNotificationWhereInput {
  if (actor.type !== 'EMPLOYEE') return { recipientId: actor.userId };
  return { recipientId: actor.userId, OR: [{ quoteRequestId: null }, { quoteRequest: { is: staffRequestReadScopeWhere(actor) } }] };
}

function toDto(row: DtoRow): InboxNotificationDto | null {
  if (!isInboxKind(row.kind)) return null;
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {};
  return {
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    body: row.body,
    actionPath: row.actionPath,
    quoteRequestId: row.quoteRequestId,
    folio: typeof data.folio === 'string' ? data.folio : null,
    clientName: typeof data.clientName === 'string' ? data.clientName : null,
    occurrences: row.occurrences,
    actionRequired: row.actionRequired,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedNote: row.resolvedNote,
  };
}

function encodeCursor(row: { lastActivityAt: Date; id: string }): string {
  return Buffer.from(`${row.lastActivityAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): { at: Date; id: string } | null {
  if (!value) return null;
  const [iso, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !id || !UUID_PATTERN.test(id)) throw new AppError('VALIDATION_ERROR', 'El cursor no es válido.', 400);
  return { at, id };
}

export async function getInboxCounts(actor: Actor, dependencies: Dependencies = {}): Promise<InboxCounts> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const scope = inboxScopeWhere(actor);
  const [unread, actionRequired] = await Promise.all([
    prisma.inboxNotification.count({ where: { AND: [scope, BADGE_WHERE] } }),
    prisma.inboxNotification.count({ where: { AND: [scope, ACTION_WHERE] } }),
  ]);
  return { unread, actionRequired };
}

export async function getInboxSummary(actor: Actor, dependencies: Dependencies = {}): Promise<InboxSummary> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const scope = inboxScopeWhere(actor);
  const [counts, latest, byRequest] = await Promise.all([
    getInboxCounts(actor, { prisma }),
    prisma.inboxNotification.findMany({ where: scope, orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }], take: SUMMARY_LATEST, select: DTO_SELECT }),
    prisma.inboxNotification.groupBy({ by: ['quoteRequestId'], where: { AND: [scope, BADGE_WHERE, { quoteRequestId: { not: null } }] }, _count: { _all: true } }),
  ]);
  const unreadByRequest: Record<string, number> = {};
  for (const group of byRequest) if (group.quoteRequestId) unreadByRequest[group.quoteRequestId] = group._count._all;
  return { ...counts, latest: latest.flatMap((row) => toDto(row) ?? []), unreadByRequest };
}

/** Búsqueda de la página: folio (en mayúsculas, como se guarda), cliente, título o cuerpo. */
function searchWhere(query: string | undefined): Prisma.InboxNotificationWhereInput | null {
  const search = query?.replace(/[\u0000-\u001F\u007F]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, MAX_SEARCH_LENGTH);
  if (!search) return null;
  return {
    OR: [
      { data: { path: ['folio'], string_contains: search.toUpperCase() } },
      { data: { path: ['clientName'], string_contains: search } },
      { title: { contains: search, mode: 'insensitive' } },
      { body: { contains: search, mode: 'insensitive' } },
    ],
  };
}

export async function listInbox(actor: Actor, input: Readonly<{ filter?: InboxFilter; cursor?: string; limit?: number; category?: InboxCategory; q?: string }> = {}, dependencies: Dependencies = {}): Promise<InboxPage> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = decodeCursor(input.cursor);
  const filterWhere = input.filter === 'unread' ? UNREAD_LIST_WHERE : input.filter === 'action' ? ACTION_WHERE : {};
  const search = searchWhere(input.q);
  const rows = await prisma.inboxNotification.findMany({
    where: {
      AND: [
        inboxScopeWhere(actor),
        filterWhere,
        ...(input.category ? [{ kind: { in: inboxKindsInCategory(input.category) } }] : []),
        ...(search ? [search] : []),
        ...(cursor ? [{ OR: [{ lastActivityAt: { lt: cursor.at } }, { lastActivityAt: cursor.at, id: { lt: cursor.id } }] }] : []),
      ],
    },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: DTO_SELECT,
  });
  const page = rows.slice(0, limit);
  return { items: page.flatMap((row) => toDto(row) ?? []), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

export async function markInboxRead(actor: Actor, input: MarkInboxReadInput, dependencies: Dependencies = {}): Promise<InboxCounts & Readonly<{ updated: number }>> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  let where: Prisma.InboxNotificationWhereInput;
  let readAt: Date | null = now;
  if ('ids' in input) {
    const ids = [...new Set(input.ids)].filter((id) => UUID_PATTERN.test(id)).slice(0, MAX_IDS);
    if (ids.length === 0) throw new AppError('VALIDATION_ERROR', 'Indica qué avisos marcar.', 400);
    const read = input.read !== false;
    readAt = read ? now : null;
    where = { recipientId: actor.userId, id: { in: ids }, readAt: read ? null : { not: null } };
  } else if ('all' in input) {
    where = { recipientId: actor.userId, readAt: null };
  } else {
    if (!UUID_PATTERN.test(input.quoteRequestId)) throw new AppError('VALIDATION_ERROR', 'El expediente no es válido.', 400);
    // Abrir el expediente no da por atendido lo que pide una acción (aprobar, tomar, responder cambios).
    where = { recipientId: actor.userId, readAt: null, quoteRequestId: input.quoteRequestId, ...(input.scope === 'activity' ? { actionRequired: false } : {}) };
  }
  const result = await prisma.inboxNotification.updateMany({ where, data: { readAt, updatedAt: now } });
  // Otros dispositivos de la misma persona recalculan su contador (lo escucha el bloque 2).
  if (result.count > 0) await publishRealtime(prisma, { t: 'u', u: actor.userId });
  return { updated: result.count, ...(await getInboxCounts(actor, { prisma })) };
}
