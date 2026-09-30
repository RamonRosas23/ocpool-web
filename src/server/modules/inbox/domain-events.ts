import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/server/logging/logger';
import { publishRequestChange, requestSignalFor, type RequestChangeInput } from './realtime-signals';
import { applyInboxEffects } from './record';
import { resolveInboxEffects } from './rules';
import type { DomainEventInput } from './rules/types';

export type OutboxPayload = Record<string, string | number | boolean | null>;
export type RecordDomainEventInput = DomainEventInput & Readonly<{ payload: OutboxPayload }>;
export type RecordDomainEventOptions = Readonly<{ now?: Date; inbox?: 'default' | 'skip' }>;

/**
 * Los avisos nunca deben tumbar la operación que los provoca: si una regla falla, un SAVEPOINT deshace sólo
 * su parte y el cambio de dominio se confirma igual (el outbox, y por tanto el correo, ya quedó escrito).
 */
export async function withInboxSavepoint(tx: Prisma.TransactionClient, source: string, work: () => Promise<void>, name = 'inbox_effects'): Promise<void> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    await work();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    logger.error({ source, error: error instanceof Error ? error.message : String(error) }, 'Inbox effects failed; the domain change was kept');
  }
}

/** Las pantallas abiertas del expediente se enteran al confirmar (señal `r`); una falla aquí nunca tumba el cambio. */
export async function signalRequestChange(tx: Prisma.TransactionClient, input: RequestChangeInput): Promise<void> {
  await withInboxSavepoint(tx, 'realtime_signal', () => publishRequestChange(tx, input), 'realtime_signal');
}

async function signalFromEvent(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<void> {
  const intent = requestSignalFor(event);
  if (!intent) return;
  await signalRequestChange(tx, { ...intent, actorId: event.actor?.userId ?? null });
}

/** Punto único de emisión (spec §2.1): outbox de siempre + avisos por rol en la misma transacción. */
export async function recordDomainEvent(tx: Prisma.TransactionClient, event: RecordDomainEventInput, options: RecordDomainEventOptions = {}): Promise<void> {
  await tx.outboxEvent.create({ data: { eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, payload: event.payload } });
  // Aunque el evento no genere avisos (p. ej. pedir datos al cliente), las pantallas abiertas se enteran.
  await signalFromEvent(tx, event);
  if (options.inbox === 'skip') return;
  const now = options.now ?? new Date();
  await withInboxSavepoint(tx, event.eventType, async () => applyInboxEffects(tx, await resolveInboxEffects(tx, event, now), now));
}

/** Señales que sólo viven en la aplicación (sin correo ni outbox): proyecto con nuevo dueño, trabajo reasignado, precio asignado… */
export async function notifyInbox(tx: Prisma.TransactionClient, event: DomainEventInput, options: Readonly<{ now?: Date }> = {}): Promise<void> {
  const now = options.now ?? new Date();
  await signalFromEvent(tx, event);
  await withInboxSavepoint(tx, event.eventType, async () => applyInboxEffects(tx, await resolveInboxEffects(tx, event, now), now));
}
