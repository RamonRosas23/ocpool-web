import type { Prisma } from '@/generated/prisma/client';
import { parseAnyChangeRequest } from '@/lib/change-request';
import { activeEmployees, activeStaffWithPermissions, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, POOL_PERMISSIONS, uuidOf, type InboxRecipient, type RequestInboxContext } from '../audience';
import { filePreview, messagePreview } from '../format';
import { customerRequestPath, staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent, type InboxResolution } from '../record';
import type { DomainEventInput } from './types';

const NOTE_PARTICIPANT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Quién del equipo atiende la actividad del cliente: el responsable o, si no hay, el pool. */
async function staffAudienceFor(tx: Prisma.TransactionClient, context: RequestInboxContext, actorId: string | null): Promise<InboxRecipient[]> {
  if (context.assigneeId) return excludeUser([{ id: context.assigneeId, displayName: context.assigneeName ?? '' }], actorId);
  return excludeUser(await activeStaffWithPermissions(tx, POOL_PERMISSIONS), actorId);
}

export async function messageCreatedEffects(tx: Prisma.TransactionClient, event: DomainEventInput, now: Date): Promise<InboxEffects> {
  const messageId = uuidOf(event.payload.messageId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!messageId || !requestId) return NO_INBOX_EFFECTS;
  const message = await tx.conversationMessage.findUnique({ where: { id: messageId }, select: { conversationId: true, body: true, visibility: true, sender: { select: { id: true, displayName: true, type: true } } } });
  if (!message) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = message.sender?.id ?? event.actor?.userId ?? null;
  const actorName = message.sender?.displayName;

  if (message.visibility === 'INTERNAL') {
    const since = new Date(now.getTime() - NOTE_PARTICIPANT_WINDOW_MS);
    const participants = await tx.conversationMessage.findMany({ where: { conversationId: message.conversationId, visibility: 'INTERNAL', createdAt: { gte: since }, senderUserId: { not: null } }, select: { senderUserId: true }, distinct: ['senderUserId'] });
    const recipients = excludeUser(await activeEmployees(tx, [context.assigneeId, ...participants.map((row) => row.senderUserId)]), actorId);
    return {
      intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'note.internal', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: `note:${context.id}:${actorId ?? 'system'}`, actionPath: staffRequestPath(context.id, 'conversation'), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, messages: 1, preview: messagePreview(message.body) } })),
      resolutions: [],
    };
  }

  if (message.sender?.type === 'CUSTOMER') {
    const resolutions: InboxResolution[] = context.status === 'INFORMACION_REQUERIDA' ? [{ groupKey: `info:${context.id}`, note: 'Respondiste' }] : [];
    const staff = await staffAudienceFor(tx, context, actorId);
    const change = parseAnyChangeRequest(message.body);
    if (change) {
      const data = { folio: context.folio, clientName: context.clientName, actorName, versionNumber: change.versionNumber, messages: 1, preview: messagePreview(change.message || message.body) };
      const managers = excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), actorId);
      return {
        intents: [
          ...staff.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.changes_requested', priority: 'URGENT', quoteRequestId: context.id, actorId, groupKey: `changes:${context.id}`, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: true, data })),
          ...managers.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.changes_requested', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: `changes:${context.id}`, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data })),
        ],
        resolutions,
      };
    }
    return {
      intents: staff.map((user): InboxIntent => ({ recipientId: user.id, kind: 'customer.activity', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `activity:${context.id}:${actorId ?? 'customer'}`, actionPath: staffRequestPath(context.id, 'conversation'), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, messages: 1, files: 0, preview: messagePreview(message.body) } })),
      resolutions,
    };
  }

  if (!context.customerUserId || context.customerUserId === actorId) return NO_INBOX_EFFECTS;
  return {
    intents: [{ recipientId: context.customerUserId, kind: 'team.activity', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `team-activity:${context.id}`, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined, messages: 1, files: 0, preview: messagePreview(message.body) } }],
    resolutions: [],
  };
}

export async function fileAvailableEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const fileId = uuidOf(event.payload.fileId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!fileId || !requestId) return NO_INBOX_EFFECTS;
  const file = await tx.fileAttachment.findUnique({ where: { id: fileId }, select: { originalFileName: true, visibility: true, status: true, uploadedBy: { select: { id: true, displayName: true, type: true } } } });
  if (!file || file.status !== 'AVAILABLE') return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const uploaderId = file.uploadedBy.id;
  const preview = filePreview(file.originalFileName);
  if (file.uploadedBy.type === 'CUSTOMER') {
    const staff = await staffAudienceFor(tx, context, uploaderId);
    return {
      intents: staff.map((user): InboxIntent => ({ recipientId: user.id, kind: 'customer.activity', priority: 'HIGH', quoteRequestId: context.id, actorId: uploaderId, groupKey: `activity:${context.id}:${uploaderId}`, actionPath: staffRequestPath(context.id, 'files'), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName: file.uploadedBy.displayName, messages: 0, files: 1, preview } })),
      resolutions: [],
    };
  }
  // Archivos internos: nunca llegan al cliente, y entre el equipo no generan aviso.
  if (file.visibility !== 'CUSTOMER' || !context.customerUserId) return NO_INBOX_EFFECTS;
  return {
    intents: [{ recipientId: context.customerUserId, kind: 'team.activity', priority: 'HIGH', quoteRequestId: context.id, actorId: uploaderId, groupKey: `team-activity:${context.id}`, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined, messages: 0, files: 1, preview } }],
    resolutions: [],
  };
}
