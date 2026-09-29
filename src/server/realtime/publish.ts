import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

/** Canal único de tiempo real (spec 2026-09-29 §4.1). El payload lleva sólo identificadores, nunca contenido. */
export const REALTIME_CHANNEL = 'ocpool_realtime';

export type RealtimeSignal =
  | Readonly<{ t: 'n'; u: string; id: string; m: 'created' | 'updated' | 'resolved' }>
  | Readonly<{ t: 'u'; u: string }>;

type SqlClient = PrismaClient | Prisma.TransactionClient;

const MAX_PAYLOAD_LENGTH = 7_900;

export function encodeRealtimeSignal(signal: RealtimeSignal): string {
  const payload = JSON.stringify(signal);
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error('Realtime signal is too large.');
  return payload;
}

/**
 * Dentro de una transacción, PostgreSQL entrega el NOTIFY sólo al confirmar: si la transacción se revierte
 * no sale nada, así que nunca se avisa de algo que no pasó. Fuera de una transacción se entrega de inmediato.
 * `$executeRaw` (y no `$queryRaw`) porque `pg_notify` devuelve `void`, que Prisma no deserializa.
 */
export async function publishRealtime(client: SqlClient, signal: RealtimeSignal): Promise<void> {
  await client.$executeRaw(Prisma.sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${encodeRealtimeSignal(signal)})`);
}
