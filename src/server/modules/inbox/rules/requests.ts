import type { Prisma } from '@/generated/prisma/client';
import { activeStaffWithPermissions, displayNameOf, excludeUser, loadRequestInboxContext, POOL_PERMISSIONS, textOf, uuidOf } from '../audience';
import { messagePreview } from '../format';
import { customerRequestPath, staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent, type InboxResolution } from '../record';
import type { DomainEventInput } from './types';

const REOPEN_SOURCES: ReadonlySet<string> = new Set(['RECHAZADA', 'VENCIDA']);

export async function requestReceivedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const intents: InboxIntent[] = [];
  // Sólo las solicitudes que llegan del sitio van al pool: una capturada por alguien del equipo ya tiene quién la atienda.
  if (context.origin === 'PUBLIC_FORM' && !context.assigneeId) {
    for (const user of excludeUser(await activeStaffWithPermissions(tx, POOL_PERMISSIONS), actorId)) {
      intents.push({ recipientId: user.id, kind: 'request.new_unassigned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `pool:${context.id}`, actionPath: staffRequestPath(context.id), actionRequired: true, data: { folio: context.folio, clientName: context.clientName, projectType: context.projectType ?? undefined, location: context.location ?? undefined } });
    }
  }
  if (context.customerUserId && context.customerUserId !== actorId) {
    intents.push({ recipientId: context.customerUserId, kind: 'request.received', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined } });
  }
  return { intents, resolutions: [] };
}

export async function requestAssignedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const assignedToId = uuidOf(event.payload.assignedToId);
  if (!requestId || !assignedToId) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const assigneeName = (await displayNameOf(tx, assignedToId)) ?? 'otra persona';
  const previousAssigneeId = uuidOf(event.payload.previousAssigneeId);
  const intents: InboxIntent[] = [];
  if (assignedToId !== actorId) {
    intents.push({ recipientId: assignedToId, kind: 'request.assigned_to_you', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, projectType: context.projectType ?? undefined, location: context.location ?? undefined } });
  }
  if (previousAssigneeId && previousAssigneeId !== assignedToId && previousAssigneeId !== actorId) {
    // Sin expediente a propósito: quien lo perdió ya no puede abrirlo y el aviso no debe ocultarse por alcance.
    intents.push({ recipientId: previousAssigneeId, kind: 'request.unassigned_from_you', priority: 'NORMAL', quoteRequestId: null, actorId, groupKey: null, actionPath: '/staff/requests', actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, toName: assigneeName } });
  }
  const taken = event.payload.mode === 'take';
  return {
    intents,
    resolutions: [{ groupKey: `pool:${context.id}`, note: taken ? `Tomada por ${actorName}` : `Asignada a ${assigneeName}`, actorId, actorNote: taken ? 'La tomaste' : `Asignada a ${assigneeName}` }],
  };
}

export async function requestStatusChangedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const toStatus = textOf(event.payload.toStatus);
  const fromStatus = textOf(event.payload.fromStatus);
  if (!requestId || !toStatus) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const intents: InboxIntent[] = [];
  const resolutions: InboxResolution[] = [];

  if (event.payload.source === 'request_information') {
    if (context.customerUserId) {
      const messageId = uuidOf(event.payload.messageId);
      const message = messageId ? await tx.conversationMessage.findUnique({ where: { id: messageId }, select: { body: true, visibility: true } }) : null;
      intents.push({ recipientId: context.customerUserId, kind: 'request.information_needed', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `info:${context.id}`, actionPath: customerRequestPath(context.id), actionRequired: true, data: { folio: context.folio, projectType: context.projectType ?? undefined, preview: message?.visibility === 'CUSTOMER' ? messagePreview(message.body) : undefined } });
    }
    return { intents, resolutions };
  }

  if (fromStatus === 'INFORMACION_REQUERIDA' && toStatus !== 'INFORMACION_REQUERIDA') resolutions.push({ groupKey: `info:${context.id}`, note: 'El equipo continuó con tu solicitud' });
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  if (toStatus === 'RECHAZADA') {
    resolutions.push({ groupKey: `pool:${context.id}`, note: 'Se cerró la solicitud' }, { groupKey: `changes:${context.id}`, note: 'Se cerró el expediente' });
    if (context.assigneeId && context.assigneeId !== actorId) intents.push({ recipientId: context.assigneeId, kind: 'request.closed', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, reason: textOf(event.payload.reason) } });
  } else if (fromStatus && REOPEN_SOURCES.has(fromStatus) && context.assigneeId && context.assigneeId !== actorId) {
    intents.push({ recipientId: context.assigneeId, kind: 'request.reopened', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName } });
  }
  return { intents, resolutions };
}

export async function customerResponseReviewedEffects(_tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  return { intents: [], resolutions: [{ groupKey: `info:${requestId}`, note: 'El equipo revisó tu respuesta' }] };
}
