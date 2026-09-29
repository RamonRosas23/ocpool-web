import type { Prisma } from '@/generated/prisma/client';
import { templateLabel } from '@/lib/notification-labels';
import { activeEmployees, activeStaffWithPermissions, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, textOf, uuidOf } from '../audience';
import { staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent } from '../record';
import type { DomainEventInput } from './types';

export async function deliveryFailedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const templateKey = textOf(event.payload.templateKey);
  const data = { folio: context.folio, clientName: context.clientName, templateLabel: templateKey ? templateLabel(templateKey) : undefined };
  const notice = (recipientId: string, priority: 'URGENT' | 'NORMAL'): InboxIntent => ({ recipientId, kind: 'email.delivery_failed', priority, quoteRequestId: context.id, actorId: null, groupKey: `email-failed:${context.id}`, actionPath: staffRequestPath(context.id), actionRequired: false, data });
  const assignee = await activeEmployees(tx, [context.assigneeId]);
  const managers = excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), context.assigneeId);
  return { intents: [...assignee.map((user) => notice(user.id, 'URGENT')), ...managers.map((user) => notice(user.id, 'NORMAL'))], resolutions: [] };
}

export async function deliveryRecoveredEffects(_tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  return { intents: [], resolutions: [{ groupKey: `email-failed:${requestId}`, note: 'El correo se entregó al reintentar' }] };
}
