import type { Prisma } from '@/generated/prisma/client';
import { activeEmployees, activeStaffWithPermissions, displayNameOf, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, numberOf, textOf, uuidOf } from '../audience';
import { customerRequestPath, staffProjectPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent } from '../record';
import type { DomainEventInput } from './types';

export async function projectCreatedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const projectId = uuidOf(event.payload.projectId);
  if (!projectId) return NO_INBOX_EFFECTS;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, folio: true, ownerId: true, quoteRequestId: true, owner: { select: { displayName: true } } } });
  if (!project) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, project.quoteRequestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const fromAcceptance = event.payload.source === 'customer_acceptance';
  const owner = (await activeEmployees(tx, [project.ownerId]))[0];
  const intents: InboxIntent[] = [];
  // Si nació de la aceptación del cliente y el dueño es el mismo responsable, `quote.accepted` ya le avisó.
  if (owner && owner.id !== actorId && !(fromAcceptance && owner.id === context.assigneeId)) {
    intents.push({ recipientId: owner.id, kind: 'project.assigned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffProjectPath(project.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, clientName: context.clientName, actorName } });
  }
  if (!fromAcceptance) {
    for (const manager of excludeUser(excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), actorId), owner?.id)) {
      intents.push({ recipientId: manager.id, kind: 'project.created', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffProjectPath(project.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, clientName: context.clientName, actorName, ownerName: project.owner?.displayName } });
    }
  }
  if (context.customerUserId && context.customerUserId !== actorId) {
    intents.push({ recipientId: context.customerUserId, kind: 'project.started', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: customerRequestPath(context.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, ownerName: project.owner?.displayName } });
  }
  return { intents, resolutions: [] };
}

export async function projectOwnerChangedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const projectId = uuidOf(event.payload.projectId);
  const ownerId = uuidOf(event.payload.ownerId);
  const actorId = event.actor?.userId ?? null;
  if (!projectId || !ownerId || ownerId === actorId) return NO_INBOX_EFFECTS;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, folio: true, quoteRequestId: true } });
  if (!project) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, project.quoteRequestId);
  const owner = (await activeEmployees(tx, [ownerId]))[0];
  if (!context || !owner) return NO_INBOX_EFFECTS;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  return {
    intents: [{ recipientId: owner.id, kind: 'project.assigned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffProjectPath(project.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, clientName: context.clientName, actorName } }],
    resolutions: [],
  };
}

export async function workReassignedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const heirId = uuidOf(event.payload.heirId);
  const requestsCount = numberOf(event.payload.requestsCount) ?? 0;
  const projectsCount = numberOf(event.payload.projectsCount) ?? 0;
  const actorId = event.actor?.userId ?? null;
  if (!heirId || heirId === actorId || requestsCount + projectsCount === 0) return NO_INBOX_EFFECTS;
  const heir = (await activeEmployees(tx, [heirId]))[0];
  if (!heir) return NO_INBOX_EFFECTS;
  return {
    intents: [{ recipientId: heir.id, kind: 'team.work_reassigned', priority: 'HIGH', quoteRequestId: null, actorId, groupKey: null, actionPath: '/staff/requests', actionRequired: false, data: { fromName: textOf(event.payload.fromName), actorName: (await displayNameOf(tx, actorId)) ?? undefined, requestsCount, projectsCount } }],
    resolutions: [],
  };
}
