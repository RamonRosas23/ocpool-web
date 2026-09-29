import type { Prisma } from '@/generated/prisma/client';
import { NO_INBOX_EFFECTS, type InboxEffects } from '../record';
import { customerResponseReviewedEffects, requestAssignedEffects, requestReceivedEffects, requestStatusChangedEffects } from './requests';
import type { DomainEventInput } from './types';

/** Reglas por evento (spec §2.2 y §2.3). Un evento sin regla sólo queda en el outbox. */
export async function resolveInboxEffects(tx: Prisma.TransactionClient, event: DomainEventInput, _now: Date): Promise<InboxEffects> {
  switch (event.eventType) {
    case 'REQUEST.RECEIVED': return requestReceivedEffects(tx, event);
    case 'REQUEST.ASSIGNED': return requestAssignedEffects(tx, event);
    case 'REQUEST.STATUS_CHANGED': return requestStatusChangedEffects(tx, event);
    case 'REQUEST.CUSTOMER_RESPONSE': return customerResponseReviewedEffects(tx, event);
    default: return NO_INBOX_EFFECTS;
  }
}
