import { Prisma } from '@/generated/prisma/client';
import { publishRealtime } from '@/server/realtime/publish';
import { sanitizeInboxData, type InboxData, type InboxKind, type InboxPriority } from './kinds';
import { inboxOccurrences, mergeInboxData, renderInboxText } from './text';

export type InboxIntent = Readonly<{
  recipientId: string;
  kind: InboxKind;
  priority: InboxPriority;
  quoteRequestId: string | null;
  actorId: string | null;
  groupKey: string | null;
  actionPath: string;
  actionRequired: boolean;
  data: InboxData;
}>;

/** Cierra los avisos abiertos de un grupo (p. ej. "Tomada por Ana"). `actorNote` es lo que ve quien lo cerró. */
export type InboxResolution = Readonly<{ groupKey: string; note: string; actorId?: string | null; actorNote?: string }>;

export type InboxEffects = Readonly<{ intents: readonly InboxIntent[]; resolutions: readonly InboxResolution[] }>;

export const NO_INBOX_EFFECTS: InboxEffects = Object.freeze({ intents: [], resolutions: [] });

export type RecordedInboxNotification = Readonly<{ id: string; recipientId: string; mode: 'created' | 'updated' | 'resolved' }>;

const PRIORITY_RANK: Readonly<Record<InboxPriority, number>> = { URGENT: 3, HIGH: 2, NORMAL: 1, INFO: 0 };
const NOTE_LIMIT = 160;

function higher(left: InboxPriority, right: InboxPriority): InboxPriority {
  return PRIORITY_RANK[left] >= PRIORITY_RANK[right] ? left : right;
}

/** Si una regla apunta dos veces a la misma persona y grupo (responsable que además es gestor), gana la prioridad más alta. */
export function dedupeInboxIntents(intents: readonly InboxIntent[]): InboxIntent[] {
  const byKey = new Map<string, InboxIntent>();
  for (const intent of intents) {
    const key = `${intent.recipientId}|${intent.kind}|${intent.groupKey ?? intent.quoteRequestId ?? ''}`;
    const current = byKey.get(key);
    if (!current || PRIORITY_RANK[intent.priority] > PRIORITY_RANK[current.priority]) byKey.set(key, intent);
  }
  return [...byKey.values()];
}

function jsonData(value: Prisma.JsonValue | null): InboxData {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InboxData : {};
}

function newRow(intent: InboxIntent, data: InboxData, now: Date) {
  const text = renderInboxText(intent.kind, data);
  return {
    recipientId: intent.recipientId,
    kind: intent.kind,
    priority: intent.priority,
    groupKey: intent.groupKey,
    quoteRequestId: intent.quoteRequestId,
    actorId: intent.actorId,
    title: text.title,
    body: text.body,
    actionPath: intent.actionPath,
    data: data as Prisma.InputJsonValue,
    occurrences: inboxOccurrences(intent.kind, data, 0),
    actionRequired: intent.actionRequired,
    createdAt: now,
    lastActivityAt: now,
    updatedAt: now,
  };
}

type OpenRow = { id: string; data: Prisma.JsonValue | null; occurrences: number; priority: InboxPriority };

async function lockOpenGroup(tx: Prisma.TransactionClient, recipientId: string, groupKey: string): Promise<OpenRow | null> {
  const rows = await tx.$queryRaw<OpenRow[]>(Prisma.sql`
    SELECT "id", "data", "occurrences", "priority"::text AS "priority"
    FROM "inbox_notifications"
    WHERE "recipientId" = ${recipientId}::uuid AND "groupKey" = ${groupKey} AND "readAt" IS NULL AND "resolvedAt" IS NULL
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Guarda los avisos dentro de la transacción del cambio. Con `groupKey`, la actividad nueva se suma al aviso
 * abierto del grupo (un solo aviso sin leer por persona y grupo); sin él, cada intención es un aviso nuevo.
 * Cada aviso creado o actualizado emite su señal `n`, que PostgreSQL entrega al confirmar.
 */
export async function recordInboxIntents(tx: Prisma.TransactionClient, intents: readonly InboxIntent[], now: Date): Promise<RecordedInboxNotification[]> {
  const recorded: RecordedInboxNotification[] = [];
  for (const intent of dedupeInboxIntents(intents)) {
    const data = sanitizeInboxData(intent.kind, intent.data);
    if (!intent.groupKey) {
      const created = await tx.inboxNotification.create({ data: newRow(intent, data, now), select: { id: true } });
      recorded.push({ id: created.id, recipientId: intent.recipientId, mode: 'created' });
      continue;
    }
    // ON CONFLICT DO NOTHING sobre el índice único parcial: si ya hay un aviso abierto del grupo, no inserta.
    const inserted = await tx.inboxNotification.createManyAndReturn({ data: [newRow(intent, data, now)], skipDuplicates: true, select: { id: true } });
    if (inserted[0]) {
      recorded.push({ id: inserted[0].id, recipientId: intent.recipientId, mode: 'created' });
      continue;
    }
    const open = await lockOpenGroup(tx, intent.recipientId, intent.groupKey);
    if (!open) {
      // Se leyó o resolvió entre el INSERT y el SELECT: la actividad nueva abre otro aviso.
      const created = await tx.inboxNotification.create({ data: newRow(intent, data, now), select: { id: true } });
      recorded.push({ id: created.id, recipientId: intent.recipientId, mode: 'created' });
      continue;
    }
    const merged = mergeInboxData(intent.kind, jsonData(open.data), data);
    if (!merged.changed) continue;
    const mergedData = sanitizeInboxData(intent.kind, merged.data);
    const text = renderInboxText(intent.kind, mergedData);
    await tx.inboxNotification.update({
      where: { id: open.id },
      data: {
        priority: higher(open.priority, intent.priority),
        actorId: intent.actorId,
        title: text.title,
        body: text.body,
        actionPath: intent.actionPath,
        data: mergedData as Prisma.InputJsonValue,
        occurrences: inboxOccurrences(intent.kind, mergedData, open.occurrences),
        lastActivityAt: now,
        updatedAt: now,
      },
    });
    recorded.push({ id: open.id, recipientId: intent.recipientId, mode: 'updated' });
  }
  for (const entry of recorded) await publishRealtime(tx, { t: 'n', u: entry.recipientId, id: entry.id, m: entry.mode });
  return recorded;
}

export async function resolveInboxGroups(tx: Prisma.TransactionClient, resolutions: readonly InboxResolution[], now: Date): Promise<RecordedInboxNotification[]> {
  const recorded: RecordedInboxNotification[] = [];
  for (const resolution of resolutions) {
    const note = resolution.note.slice(0, NOTE_LIMIT);
    const actorNote = (resolution.actorNote ?? resolution.note).slice(0, NOTE_LIMIT);
    const actorId = resolution.actorId ?? null;
    const rows = await tx.$queryRaw<Array<{ id: string; recipientId: string }>>(Prisma.sql`
      UPDATE "inbox_notifications"
      SET "resolvedAt" = ${now},
          "updatedAt" = ${now},
          "resolvedNote" = CASE WHEN "recipientId" = ${actorId}::uuid THEN ${actorNote} ELSE ${note} END
      WHERE "groupKey" = ${resolution.groupKey} AND "resolvedAt" IS NULL
      RETURNING "id", "recipientId"
    `);
    for (const row of rows) recorded.push({ id: row.id, recipientId: row.recipientId, mode: 'resolved' });
  }
  for (const entry of recorded) await publishRealtime(tx, { t: 'n', u: entry.recipientId, id: entry.id, m: 'resolved' });
  return recorded;
}

/** Primero se cierran los grupos (p. ej. el pool de una solicitud tomada) y luego se crean los avisos nuevos. */
export async function applyInboxEffects(tx: Prisma.TransactionClient, effects: InboxEffects, now: Date): Promise<void> {
  if (effects.resolutions.length > 0) await resolveInboxGroups(tx, effects.resolutions, now);
  if (effects.intents.length > 0) await recordInboxIntents(tx, effects.intents, now);
}
