import type { Prisma } from '@/generated/prisma/client';
import { NO_INBOX_EFFECTS, type InboxEffects } from '../record';
import { deliveryFailedEffects, deliveryRecoveredEffects } from './deliveries';
import { fileAvailableEffects, messageCreatedEffects } from './messages';
import { pendingPriceResolvedEffects } from './prices';
import { projectCreatedEffects, projectOwnerChangedEffects, workReassignedEffects } from './projects';
import { approvalRequestedEffects, approvalResolvedEffects, quoteAcceptedEffects, quoteDraftSavedEffects, quotePublishedEffects, quoteReturnedEffects } from './quotes';
import { customerResponseReviewedEffects, requestAssignedEffects, requestReceivedEffects, requestStatusChangedEffects } from './requests';
import type { DomainEventInput } from './types';

/** Reglas por evento (spec §2.2 y §2.3). Un evento sin regla sólo queda en el outbox. */
export async function resolveInboxEffects(tx: Prisma.TransactionClient, event: DomainEventInput, now: Date): Promise<InboxEffects> {
  switch (event.eventType) {
    case 'REQUEST.RECEIVED': return requestReceivedEffects(tx, event);
    case 'REQUEST.ASSIGNED': return requestAssignedEffects(tx, event);
    case 'REQUEST.STATUS_CHANGED': return requestStatusChangedEffects(tx, event);
    case 'REQUEST.CUSTOMER_RESPONSE': return customerResponseReviewedEffects(tx, event);
    case 'MESSAGE.CREATED': return messageCreatedEffects(tx, event, now);
    case 'FILE.AVAILABLE': return fileAvailableEffects(tx, event);
    case 'QUOTE.PUBLISHED': return quotePublishedEffects(tx, event);
    case 'QUOTE.VERSION_REOPENED':
    case 'QUOTE.VERSION_REJECTED': return quoteReturnedEffects(tx, event);
    case 'QUOTE.VERSION_CREATED':
    case 'QUOTE.VERSION_UPDATED': return quoteDraftSavedEffects(tx, event);
    case 'QUOTE.APPROVAL_REQUESTED': return approvalRequestedEffects(tx, event);
    case 'QUOTE.APPROVAL_RESOLVED': return approvalResolvedEffects(tx, event);
    case 'QUOTE.ACCEPTED': return quoteAcceptedEffects(tx, event);
    case 'PROJECT.CREATED': return projectCreatedEffects(tx, event);
    case 'PROJECT.OWNER_CHANGED': return projectOwnerChangedEffects(tx, event);
    case 'TEAM.WORK_REASSIGNED': return workReassignedEffects(tx, event);
    case 'PRICES.PENDING_RESOLVED': return pendingPriceResolvedEffects(tx, event);
    case 'EMAIL.DELIVERY_FAILED': return deliveryFailedEffects(tx, event);
    case 'EMAIL.DELIVERY_RECOVERED': return deliveryRecoveredEffects(tx, event);
    default: return NO_INBOX_EFFECTS;
  }
}
