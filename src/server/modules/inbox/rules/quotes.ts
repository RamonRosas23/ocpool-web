import type { Prisma } from '@/generated/prisma/client';
import { DECLINE_REASON_CODES, declineReasonLabel, type DeclineReasonCode } from '@/lib/decline-request';
import type { QuoteRequestStatus } from '@/server/modules/quote-requests/domain';
import { activeEmployees, activeStaffWithPermissions, APPROVER_PERMISSIONS, displayNameOf, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, PRICE_MANAGER_PERMISSIONS, textOf, uuidOf } from '../audience';
import { totalLabel } from '../format';
import { customerRequestPath, STAFF_APPROVALS_PATH, STAFF_PENDING_PRICES_PATH, staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent, type InboxResolution } from '../record';
import type { DomainEventInput } from './types';

async function loadVersion(tx: Prisma.TransactionClient, versionId: string | null) {
  if (!versionId) return null;
  return tx.quoteVersion.findUnique({ where: { id: versionId }, select: { id: true, versionNumber: true, totalMinor: true, currencyCode: true, createdById: true } });
}

/** Aprobaciones que dejaron de aplicar porque la versión cambió: su aviso a quienes aprueban se cierra. */
async function staleApprovalResolutions(tx: Prisma.TransactionClient, quoteVersionId: string, keepApprovalId?: string): Promise<InboxResolution[]> {
  const stale = await tx.quoteApproval.findMany({ where: { quoteVersionId, status: { in: ['SUPERSEDED', 'CANCELLED'] }, ...(keepApprovalId ? { id: { not: keepApprovalId } } : {}) }, select: { id: true } });
  return stale.map((approval) => ({ groupKey: `approval:${approval.id}`, note: 'Ya no aplica: la cotización cambió' }));
}

async function customerActionStaff(tx: Prisma.TransactionClient, assigneeId: string | null, actorId: string | null) {
  if (!assigneeId) return [];
  return excludeUser(await activeEmployees(tx, [assigneeId]), actorId);
}

const PORTAL_OPEN_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION'];

export async function quoteDeclinedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? context.contactName;
  const rawReason = textOf(event.payload.reason);
  const reason = rawReason && (DECLINE_REASON_CODES as readonly string[]).includes(rawReason)
    ? declineReasonLabel(rawReason as DeclineReasonCode)
    : undefined;
  const byRecipient = new Map<string, { id: string; priority: 'URGENT' | 'NORMAL' }>();
  for (const user of await customerActionStaff(tx, context.assigneeId, actorId)) byRecipient.set(user.id, { id: user.id, priority: 'URGENT' });
  for (const user of excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), actorId)) {
    if (!byRecipient.has(user.id)) byRecipient.set(user.id, { id: user.id, priority: 'NORMAL' });
  }
  return {
    intents: [...byRecipient.values()].map(({ id, priority }): InboxIntent => ({ recipientId: id, kind: 'quote.declined', priority, quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data: { folio: context.folio, actorName, versionNumber: version.versionNumber, reason } })),
    resolutions: [],
  };
}

export async function quoteViewedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? context.contactName;
  const recipients = await customerActionStaff(tx, context.assigneeId, actorId);
  return {
    intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.viewed', priority: 'INFO', quoteRequestId: context.id, actorId, groupKey: `quote-viewed:${version.id}:${actorId ?? 'customer'}`, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data: { folio: context.folio, actorName, versionNumber: version.versionNumber } })),
    resolutions: [],
  };
}

export async function portalActivatedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const clientId = uuidOf(event.payload.clientId) ?? (event.aggregateType === 'CLIENT' ? uuidOf(event.aggregateId) : null);
  if (!clientId) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'El cliente';
  const requests = await tx.quoteRequest.findMany({ where: { clientId, status: { in: [...PORTAL_OPEN_REQUEST_STATUSES] } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const intents: InboxIntent[] = [];
  for (const request of requests) {
    const context = await loadRequestInboxContext(tx, request.id);
    if (!context) continue;
    const recipients = await customerActionStaff(tx, context.assigneeId, actorId);
    intents.push(...recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'customer.portal_activated', priority: 'INFO', quoteRequestId: context.id, actorId, groupKey: `portal-activated:${context.id}`, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, actorName } })));
  }
  return { intents, resolutions: [] };
}

export async function quotePublishedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const intents: InboxIntent[] = context.customerUserId && context.customerUserId !== actorId
    ? [{ recipientId: context.customerUserId, kind: 'quote.ready', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined, versionNumber: version.versionNumber, totalLabel: `Total: ${totalLabel(version.totalMinor, version.currencyCode)}` } }]
    : [];
  return { intents, resolutions: [{ groupKey: `changes:${context.id}`, note: `Se envió la propuesta V${version.versionNumber}` }] };
}

export async function quoteReturnedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const recipients = excludeUser(await activeEmployees(tx, [version.createdById, context.assigneeId]), actorId);
  const outcome = event.eventType === 'QUOTE.VERSION_REJECTED' ? 'REJECTED' : 'REOPENED';
  return {
    intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.returned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data: { folio: context.folio, actorName, versionNumber: version.versionNumber, reason: textOf(event.payload.reason), outcome } })),
    resolutions: await staleApprovalResolutions(tx, version.id),
  };
}

/** Cada guardado del borrador (incluido el autoguardado): conceptos "por cotizar" y aprobaciones que dejaron de aplicar. */
export async function quoteDraftSavedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const versionId = uuidOf(event.payload.quoteVersionId);
  const folio = textOf(event.payload.folio);
  if (!requestId || !versionId || !folio) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const lines = await tx.quoteLineSnapshot.findMany({
    where: { quoteVersionId: versionId, pricePending: true, catalogItemId: { not: null }, quoteVersion: { status: 'BORRADOR' } },
    select: { catalogItem: { select: { id: true, name: true } }, quoteVersion: { select: { sourcePriceList: { select: { id: true, name: true, status: true } } } } },
  });
  const pairs = new Map<string, { listId: string; listName: string; itemId: string; itemName: string }>();
  for (const line of lines) {
    const list = line.quoteVersion.sourcePriceList;
    if (!line.catalogItem || !list || list.status !== 'ACTIVE') continue;
    pairs.set(`${list.id}:${line.catalogItem.id}`, { listId: list.id, listName: list.name, itemId: line.catalogItem.id, itemName: line.catalogItem.name });
  }
  const managers = pairs.size > 0 ? excludeUser(await activeStaffWithPermissions(tx, PRICE_MANAGER_PERMISSIONS), actorId) : [];
  const intents = [...pairs.values()].flatMap((pair) => managers.map((user): InboxIntent => ({ recipientId: user.id, kind: 'price.pending', priority: 'NORMAL', quoteRequestId: null, actorId, groupKey: `price:${pair.listId}:${pair.itemId}`, actionPath: STAFF_PENDING_PRICES_PATH, actionRequired: true, data: { itemName: pair.itemName, priceListName: pair.listName, requestIds: [requestId], requestFolios: [folio] } })));
  return { intents, resolutions: await staleApprovalResolutions(tx, versionId) };
}

export async function approvalRequestedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const approvalId = uuidOf(event.payload.approvalId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!approvalId || !requestId) return NO_INBOX_EFFECTS;
  const approval = await tx.quoteApproval.findUnique({ where: { id: approvalId }, select: { id: true, status: true, type: true, requestedById: true, quoteVersionId: true, quoteVersion: { select: { versionNumber: true } } } });
  if (!approval || approval.status !== 'REQUESTED') return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? approval.requestedById;
  const actorName = (await displayNameOf(tx, approval.requestedById)) ?? 'Alguien del equipo';
  const approvers = excludeUser(excludeUser(await activeStaffWithPermissions(tx, APPROVER_PERMISSIONS), approval.requestedById), actorId);
  return {
    intents: approvers.map((user): InboxIntent => ({ recipientId: user.id, kind: 'approval.requested', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `approval:${approval.id}`, actionPath: STAFF_APPROVALS_PATH, actionRequired: true, data: { folio: context.folio, clientName: context.clientName, actorName, versionNumber: approval.quoteVersion.versionNumber, approvalType: approval.type } })),
    resolutions: await staleApprovalResolutions(tx, approval.quoteVersionId, approval.id),
  };
}

export async function approvalResolvedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const approvalId = uuidOf(event.payload.approvalId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!approvalId || !requestId) return NO_INBOX_EFFECTS;
  const approval = await tx.quoteApproval.findUnique({ where: { id: approvalId }, select: { id: true, status: true, type: true, reason: true, requestedById: true, quoteVersion: { select: { versionNumber: true } } } });
  if (!approval || (approval.status !== 'APPROVED' && approval.status !== 'REJECTED')) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Gerencia';
  const approved = approval.status === 'APPROVED';
  const requester = excludeUser(await activeEmployees(tx, [approval.requestedById]), actorId);
  return {
    intents: requester.map((user): InboxIntent => ({ recipientId: user.id, kind: 'approval.resolved', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data: { folio: context.folio, actorName, versionNumber: approval.quoteVersion.versionNumber, approvalType: approval.type, approvalStatus: approval.status, reason: approved ? undefined : approval.reason ?? undefined } })),
    resolutions: [{ groupKey: `approval:${approval.id}`, note: approved ? `Aprobada por ${actorName}` : `Rechazada por ${actorName}`, actorId, actorNote: approved ? 'La aprobaste' : 'La rechazaste' }],
  };
}

export async function quoteAcceptedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? context.contactName;
  const recipients = excludeUser([...(await activeEmployees(tx, [context.assigneeId])), ...(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS))], actorId);
  return {
    intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.accepted', priority: 'URGENT', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, versionNumber: version.versionNumber, totalLabel: `Total aceptado: ${totalLabel(version.totalMinor, version.currencyCode)}` } })),
    resolutions: [{ groupKey: `changes:${context.id}`, note: 'El cliente aceptó la propuesta' }],
  };
}
