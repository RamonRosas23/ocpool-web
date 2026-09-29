import type { InboxActor } from '../audience';

/** Un evento de dominio tal como lo escribe el emisor. `actor: null` = el sistema (formulario público, worker). */
export type DomainEventInput = Readonly<{
  actor: InboxActor | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Readonly<Record<string, unknown>>;
}>;
