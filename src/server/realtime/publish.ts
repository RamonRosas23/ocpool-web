import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

/** Canal único de tiempo real (spec 2026-09-29 §4.1). El payload lleva sólo identificadores, nunca contenido. */
export const REALTIME_CHANNEL = 'ocpool_realtime';

/** Partes de un expediente que una pantalla puede estar mostrando (spec §4.1). */
export const REQUEST_PARTS = ['created', 'messages', 'files', 'status', 'assignment', 'quote', 'approvals', 'read', 'project'] as const;
export type RequestPart = (typeof REQUEST_PARTS)[number];
/** `C`: el cliente puede verlo; `I`: sólo el equipo. */
export type RequestVisibility = 'C' | 'I';

export type RealtimeSignal =
  | Readonly<{ t: 'n'; u: string; id: string; m: 'created' | 'updated' | 'resolved' }>
  | Readonly<{ t: 'u'; u: string }>
  /** Cerrar conexiones: con `sid`, sólo las de esa sesión; con `keep`, todas menos esa; sin ninguno, todas. */
  | Readonly<{ t: 's'; u: string; sid?: string; keep?: string }>
  /** Cambió algo del expediente `r` (cliente `c`, responsable `a`, anterior `pa`, autor `b`). Sin contenido. */
  | Readonly<{ t: 'r'; r: string; c: string; a: string | null; pa?: string; b?: string; p: readonly RequestPart[]; v: RequestVisibility }>;

type SqlClient = PrismaClient | Prisma.TransactionClient;

const MAX_PAYLOAD_LENGTH = 7_900;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NOTIFICATION_MODES: ReadonlySet<string> = new Set(['created', 'updated', 'resolved']);
const PART_SET: ReadonlySet<string> = new Set(REQUEST_PARTS);

export function encodeRealtimeSignal(signal: RealtimeSignal): string {
  const payload = JSON.stringify(signal);
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error('Realtime signal is too large.');
  return payload;
}

function uuidField(value: Readonly<Record<string, unknown>>, key: string): string | null {
  const field = value[key];
  return typeof field === 'string' && UUID_PATTERN.test(field) ? field : null;
}

/** undefined = ausente; null = presente pero inválido. */
function optionalUuid(value: Readonly<Record<string, unknown>>, key: string): string | null | undefined {
  return value[key] === undefined ? undefined : uuidField(value, key);
}

function decodeRequestSignal(value: Readonly<Record<string, unknown>>): RealtimeSignal | null {
  const requestId = uuidField(value, 'r');
  const clientId = uuidField(value, 'c');
  const assigneeId = value.a === null ? null : uuidField(value, 'a');
  const previousAssigneeId = optionalUuid(value, 'pa');
  const actorId = optionalUuid(value, 'b');
  const parts = Array.isArray(value.p) ? [...new Set(value.p.filter((part): part is RequestPart => typeof part === 'string' && PART_SET.has(part)))] : [];
  if (!requestId || !clientId || (value.a !== null && !assigneeId) || previousAssigneeId === null || actorId === null) return null;
  if (parts.length === 0 || (value.v !== 'C' && value.v !== 'I')) return null;
  return { t: 'r', r: requestId, c: clientId, a: assigneeId, ...(previousAssigneeId ? { pa: previousAssigneeId } : {}), ...(actorId ? { b: actorId } : {}), p: parts, v: value.v };
}

/** El hub sólo actúa sobre señales bien formadas: un payload ajeno o dañado se ignora. */
export function decodeRealtimeSignal(payload: string): RealtimeSignal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value.t === 'r') return decodeRequestSignal(value);
  const userId = uuidField(value, 'u');
  if (!userId) return null;
  if (value.t === 'n') {
    const id = uuidField(value, 'id');
    return id && typeof value.m === 'string' && NOTIFICATION_MODES.has(value.m) ? { t: 'n', u: userId, id, m: value.m as 'created' | 'updated' | 'resolved' } : null;
  }
  if (value.t === 'u') return { t: 'u', u: userId };
  if (value.t === 's') {
    const sid = value.sid === undefined ? undefined : uuidField(value, 'sid');
    const keep = value.keep === undefined ? undefined : uuidField(value, 'keep');
    if (sid === null || keep === null) return null;
    return { t: 's', u: userId, ...(sid ? { sid } : {}), ...(keep ? { keep } : {}) };
  }
  return null;
}

/**
 * Dentro de una transacción, PostgreSQL entrega el NOTIFY sólo al confirmar: si la transacción se revierte
 * no sale nada, así que nunca se avisa de algo que no pasó. Fuera de una transacción se entrega de inmediato.
 * `$executeRaw` (y no `$queryRaw`) porque `pg_notify` devuelve `void`, que Prisma no deserializa.
 */
export async function publishRealtime(client: SqlClient, signal: RealtimeSignal): Promise<void> {
  await client.$executeRaw(Prisma.sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${encodeRealtimeSignal(signal)})`);
}

/** Una sesión revocada deja de recibir eventos al momento, sin esperar a la revalidación periódica (spec §4.2). */
export async function publishSessionsClosed(client: SqlClient, input: Readonly<{ userId: string; sessionId?: string; keepSessionId?: string }>): Promise<void> {
  await publishRealtime(client, { t: 's', u: input.userId, ...(input.sessionId ? { sid: input.sessionId } : {}), ...(input.keepSessionId ? { keep: input.keepSessionId } : {}) });
}
