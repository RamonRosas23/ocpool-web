import type { PrismaClient } from '@/generated/prisma/client';
import { parseAnyChangeRequest } from '@/lib/change-request';
import { parseDeclineRequest } from '@/lib/decline-request';
import { readCommercialV2Flags, type CommercialV2Flags } from '@/server/flags/commercial-v2';
import type { NotificationCancellationReason } from '@/server/modules/notifications/dispatcher';
import type { NotificationEventInput, NotificationMappingContext, NotificationRecipientContext } from '@/server/modules/notifications/templates';
import { staffProjectPath } from '@/server/modules/inbox/paths';
import { requestWorkspaceNotificationPath, type StaffRequestTab } from '@/server/modules/notifications/paths';

type DbClient = PrismaClient;

export type NotificationEventResolution =
  | { kind: 'RECIPIENTS'; contexts: NotificationMappingContext[] }
  | { kind: 'CANCELLED'; reason: NotificationCancellationReason };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(payload: Record<string, unknown>, key: string): string | null {
  return typeof payload[key] === 'string' && payload[key].trim() ? payload[key] : null;
}

function isUuid(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function cancellation(reason: NotificationCancellationReason): NotificationEventResolution {
  return { kind: 'CANCELLED', reason };
}

function activeStaff(user: { id: string; email: string; displayName: string; type: string; status: string } | null | undefined): NotificationRecipientContext | null {
  if (!user || user.type !== 'EMPLOYEE' || user.status !== 'ACTIVE') return null;
  return { userId: user.id, email: user.email, displayName: user.displayName, audience: 'STAFF' };
}

function contactRecipient(contact: { id: string; email: string; displayName: string; status: string; user: { id: string; email: string; displayName: string; type: string; status: string } | null } | null | undefined): NotificationRecipientContext | null {
  if (!contact || contact.status !== 'ACTIVE') return null;
  if (contact.user?.type === 'CUSTOMER' && contact.user.status === 'ACTIVE') {
    return { userId: contact.user.id, email: contact.user.email, displayName: contact.user.displayName, audience: 'CUSTOMER' };
  }
  return { userId: null, email: contact.email, displayName: contact.displayName, audience: 'CUSTOMER' };
}

export function customerContext(recipient: NotificationRecipientContext, quoteRequestId?: string): NotificationMappingContext {
  const actionPath = quoteRequestId ? `/portal?request=${encodeURIComponent(quoteRequestId)}` : '/portal';
  return recipient.userId
    ? { recipient, actionPath }
    : { recipient, actionPath: '/portal/access', actionLabel: 'Solicitar acceso' };
}

export { requestWorkspaceNotificationPath } from '@/server/modules/notifications/paths';

function staffContext(recipient: NotificationRecipientContext, quoteRequestId: string, tab: 'summary' | 'quote' | 'conversation' | 'files' | 'activity' = 'summary', flags: CommercialV2Flags = readCommercialV2Flags()): NotificationMappingContext {
  return { recipient, actionPath: requestWorkspaceNotificationPath(quoteRequestId, tab, flags) };
}

/** Gerencia y Administración (`requests.read.global`): reciben lo que no tiene responsable y los cierres de venta. */
async function managerContexts(prisma: DbClient, quoteRequestId: string, tab: StaffRequestTab, flags: CommercialV2Flags, exclude: ReadonlySet<string> = new Set()): Promise<NotificationMappingContext[]> {
  const users = await prisma.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: 'requests.read.global' } } } } } } },
    select: { id: true, email: true, displayName: true, type: true, status: true },
    orderBy: { id: 'asc' },
  });
  return users
    .filter((user) => !exclude.has(user.id))
    .map(activeStaff)
    .filter((recipient): recipient is NotificationRecipientContext => Boolean(recipient))
    .map((recipient) => staffContext(recipient, quoteRequestId, tab, flags));
}

function staffApprovalContext(recipient: NotificationRecipientContext, quoteRequestId: string, flags: CommercialV2Flags = readCommercialV2Flags()): NotificationMappingContext {
  return { recipient, actionPath: flags.commercialWorkspaceV2 && flags.requestWorkspaceV2 ? requestWorkspaceNotificationPath(quoteRequestId, 'quote', flags) : `/staff/quotes?request=${encodeURIComponent(quoteRequestId)}` };
}

function totalLabel(totalMinor: bigint, currencyCode: string): string {
  const negative = totalMinor < 0n;
  const absolute = negative ? -totalMinor : totalMinor;
  const major = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  const groupedMajor = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(major);
  return `${negative ? '-' : ''}${groupedMajor}.${cents} ${currencyCode}`;
}

async function resolveAuthRecipient(prisma: DbClient, event: NotificationEventInput): Promise<NotificationEventResolution> {
  if (!isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
  const user = await prisma.user.findUnique({ where: { id: event.aggregateId }, include: { client: true } });
  const payload = recordValue(event.payload);
  const tokenId = payload ? stringValue(payload, 'tokenId') : null;
  const tokenType = event.eventType === 'AUTH.CUSTOMER_MAGIC_LINK' ? 'MAGIC_LINK' : 'PASSWORD_RESET';
  const token = isUuid(tokenId) ? await prisma.authToken.findUnique({ where: { id: tokenId }, select: { userId: true, type: true, consumedAt: true, expiresAt: true } }) : null;
  if (!token || token.userId !== event.aggregateId || token.type !== tokenType || token.consumedAt || token.expiresAt <= new Date()) return cancellation('INVALID_PAYLOAD');
  const recipient = event.eventType === 'AUTH.CUSTOMER_MAGIC_LINK'
    ? user?.type === 'CUSTOMER' && ['ACTIVE', 'INVITED'].includes(user.status) && user.client?.status === 'ACTIVE'
      ? { userId: user.id, email: user.email, displayName: user.displayName, audience: 'CUSTOMER' as const }
      : null
    // Invitación: sólo mientras la cuenta sigue invitada. Recuperación: activa o invitada (quien perdió
    // su bienvenida puede pedir el enlace). Suspendidas o deshabilitadas nunca reciben enlaces.
    : user?.type === 'EMPLOYEE' && (event.eventType === 'AUTH.EMPLOYEE_INVITATION' ? user.status === 'INVITED' : ['ACTIVE', 'INVITED'].includes(user.status))
      ? { userId: user.id, email: user.email, displayName: user.displayName, audience: 'STAFF' as const }
      : null;
  if (!recipient) return cancellation('NO_RECIPIENT');
  return { kind: 'RECIPIENTS', contexts: [{ recipient }] };
}

export async function resolveNotificationEvent(prisma: DbClient, event: NotificationEventInput, flags: CommercialV2Flags = readCommercialV2Flags()): Promise<NotificationEventResolution> {
  const payload = recordValue(event.payload);
  if (!payload) return cancellation('INVALID_PAYLOAD');

  if (event.eventType === 'AUTH.CUSTOMER_MAGIC_LINK' || event.eventType === 'AUTH.EMPLOYEE_PASSWORD_RESET' || event.eventType === 'AUTH.EMPLOYEE_INVITATION') return resolveAuthRecipient(prisma, event);

  switch (event.eventType) {
    case 'REQUEST.RECEIVED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const request = await prisma.quoteRequest.findUnique({ where: { id: event.aggregateId }, include: { client: true, contact: { include: { user: true } }, detail: { select: { projectType: true, location: true } } } });
      if (!request || stringValue(payload, 'quoteRequestId') !== request.id || stringValue(payload, 'folio') !== request.folio) return cancellation('INVALID_PAYLOAD');
      const customer = request.client.status === 'ACTIVE' ? contactRecipient(request.contact) : null;
      const contexts: NotificationMappingContext[] = customer ? [customerContext(customer, request.id)] : [];
      if (request.origin === 'PUBLIC_FORM') {
        const project = request.detail ? `${request.detail.projectType} en ${request.detail.location}` : undefined;
        for (const context of await managerContexts(prisma, request.id, 'summary', flags)) contexts.push({ ...context, senderName: request.client.displayName, ...(project ? { messagePreview: project } : {}) });
      }
      return contexts.length > 0 ? { kind: 'RECIPIENTS', contexts } : cancellation('NO_RECIPIENT');
    }
    case 'REQUEST.ASSIGNED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const assignedToId = stringValue(payload, 'assignedToId');
      const request = await prisma.quoteRequest.findUnique({ where: { id: event.aggregateId }, include: { currentAssignee: true } });
      if (!request || stringValue(payload, 'quoteRequestId') !== request.id || stringValue(payload, 'folio') !== request.folio || !isUuid(assignedToId) || request.currentAssigneeId !== assignedToId) return cancellation('INVALID_PAYLOAD');
      if (stringValue(payload, 'assignedById') === assignedToId) return cancellation('SELF_ACTION');
      const recipient = activeStaff(request.currentAssignee);
      return recipient ? { kind: 'RECIPIENTS', contexts: [staffContext(recipient, request.id, 'summary', flags)] } : cancellation('NO_RECIPIENT');
    }
    case 'REQUEST.STATUS_CHANGED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      if (stringValue(payload, 'source') !== 'request_information' || stringValue(payload, 'toStatus') !== 'INFORMACION_REQUERIDA') return cancellation('UNSUPPORTED_EVENT');
      const request = await prisma.quoteRequest.findUnique({ where: { id: event.aggregateId }, include: { client: true, contact: { include: { user: true } }, detail: { select: { projectType: true } } } });
      const messageId = stringValue(payload, 'messageId');
      const message = isUuid(messageId) ? await prisma.conversationMessage.findUnique({ where: { id: messageId }, select: { body: true, visibility: true, conversation: { select: { quoteRequestId: true } }, sender: { select: { type: true } } } }) : null;
      if (!request || request.id !== stringValue(payload, 'quoteRequestId') || request.folio !== stringValue(payload, 'folio') || request.status !== 'INFORMACION_REQUERIDA' || !message || message.visibility !== 'CUSTOMER' || message.conversation.quoteRequestId !== request.id || message.sender?.type !== 'EMPLOYEE') return cancellation('INVALID_PAYLOAD');
      const recipient = request.client.status === 'ACTIVE' ? contactRecipient(request.contact) : null;
      return recipient ? { kind: 'RECIPIENTS', contexts: [{ ...customerContext(recipient, request.id), folio: request.folio, projectType: request.detail?.projectType ?? undefined, messagePreview: message.body }] } : cancellation('NO_RECIPIENT');
    }
    case 'QUOTE.VERSION_STATUS_CHANGED':
    case 'QUOTE.PUBLISHED': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const quoteRequestId = stringValue(payload, 'quoteRequestId');
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, include: { quoteRequest: { include: { client: true, contact: { include: { user: true } } } } } });
      const quoteVersion = quote && quoteVersionId ? await prisma.quoteVersion.findFirst({ where: { id: quoteVersionId, quoteId: quote.id }, select: { id: true } }) : null;
      const recipient = quote?.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(quote.quoteRequest.contact) : null;
      if (!quote || !quoteVersionId || !quoteRequestId || stringValue(payload, 'folio') !== quote.quoteRequest.folio || quote.quoteRequestId !== quoteRequestId || !quoteVersion) return cancellation('INVALID_PAYLOAD');
      return recipient ? { kind: 'RECIPIENTS', contexts: [customerContext(recipient, quoteRequestId)] } : cancellation('NO_RECIPIENT');
    }
    case 'QUOTE.DECLINED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const quoteId = stringValue(payload, 'quoteId');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const quoteRequestId = stringValue(payload, 'quoteRequestId');
      const versionNumber = typeof payload.versionNumber === 'number' && Number.isInteger(payload.versionNumber) ? payload.versionNumber : null;
      const quote = isUuid(quoteId) ? await prisma.quote.findUnique({ where: { id: quoteId }, include: { quoteRequest: { include: { currentAssignee: true, client: true, contact: { include: { user: true } } } } } }) : null;
      const version = quote && isUuid(quoteVersionId) ? await prisma.quoteVersion.findFirst({ where: { id: quoteVersionId, quoteId: quote.id }, select: { id: true, versionNumber: true, status: true } }) : null;
      if (!quote || quote.quoteRequestId !== event.aggregateId || quote.quoteRequestId !== quoteRequestId || quote.quoteRequest.folio !== stringValue(payload, 'folio') || !version || version.status !== 'RECHAZADA' || version.versionNumber !== versionNumber) return cancellation('INVALID_PAYLOAD');
      const staffRecipient = activeStaff(quote.quoteRequest.currentAssignee);
      const contexts = staffRecipient
        ? [staffContext(staffRecipient, quote.quoteRequestId, 'quote', flags)]
        : await managerContexts(prisma, quote.quoteRequestId, 'quote', flags);
      if (contexts.length === 0) return cancellation('NO_RECIPIENT');
      const message = await prisma.conversationMessage.findFirst({
        where: { conversation: { quoteRequestId: quote.quoteRequestId }, visibility: 'CUSTOMER', body: { startsWith: `Propuesta V${version.versionNumber} declinada:` }, sender: { type: 'CUSTOMER' } },
        orderBy: { createdAt: 'desc' },
        select: { body: true },
      });
      const decline = message ? parseDeclineRequest(message.body) : null;
      const preview = decline?.versionNumber === version.versionNumber ? decline.comment ?? undefined : undefined;
      const senderName = quote.quoteRequest.contact.displayName || quote.quoteRequest.client.displayName;
      return { kind: 'RECIPIENTS', contexts: contexts.map((context) => ({ ...context, folio: quote.quoteRequest.folio, versionNumber: version.versionNumber, senderName, ...(preview ? { messagePreview: preview } : {}) })) };
    }
    case 'QUOTE.EXPIRING': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const quoteRequestId = stringValue(payload, 'quoteRequestId');
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, include: { quoteRequest: { include: { client: true, contact: { include: { user: true } } } }, publishedVersion: { select: { id: true, versionNumber: true, status: true, validUntil: true } } } });
      const version = quote?.publishedVersion;
      if (!quote || quoteRequestId !== quote.quoteRequestId || stringValue(payload, 'quoteId') !== quote.id || stringValue(payload, 'folio') !== quote.quoteRequest.folio || !version || version.id !== quoteVersionId || version.versionNumber !== payload.versionNumber || !['ENVIADA', 'EN_NEGOCIACION'].includes(version.status) || !version.validUntil || version.validUntil <= new Date()) return cancellation('INVALID_PAYLOAD');
      const recipient = quote.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(quote.quoteRequest.contact) : null;
      return recipient ? { kind: 'RECIPIENTS', contexts: [{ ...customerContext(recipient, quote.quoteRequestId), folio: quote.quoteRequest.folio, versionNumber: version.versionNumber, expiresInHours: typeof payload.expiresInHours === 'number' ? payload.expiresInHours : undefined }] } : cancellation('NO_RECIPIENT');
    }
    case 'QUOTE.APPROVAL_REQUESTED': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const approvalId = stringValue(payload, 'approvalId');
      const quoteRequestId = stringValue(payload, 'quoteRequestId');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const approval = isUuid(approvalId) ? await prisma.quoteApproval.findUnique({ where: { id: approvalId }, select: { id: true, quoteId: true, quoteVersionId: true, type: true, status: true, requestedById: true } }) : null;
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, select: { id: true, quoteRequestId: true, quoteRequest: { select: { folio: true } } } });
      if (!approval || approval.status !== 'REQUESTED' || approval.quoteId !== event.aggregateId || approval.quoteVersionId !== quoteVersionId || !quote || quote.quoteRequestId !== quoteRequestId || stringValue(payload, 'folio') !== quote.quoteRequest.folio || stringValue(payload, 'type') !== approval.type) return cancellation('INVALID_PAYLOAD');
      const users = await prisma.user.findMany({
        where: {
          id: { not: approval.requestedById },
          type: 'EMPLOYEE',
          status: 'ACTIVE',
          roles: { some: { role: { permissions: { some: { permission: { key: 'quotes.approve_discount' } } } } } },
        },
        select: { id: true, email: true, displayName: true, type: true, status: true },
        orderBy: { id: 'asc' },
      });
      const contexts = users.map(activeStaff).filter((recipient): recipient is NotificationRecipientContext => Boolean(recipient)).map((recipient) => staffApprovalContext(recipient, quote.quoteRequestId, flags));
      return contexts.length ? { kind: 'RECIPIENTS', contexts } : cancellation('NO_RECIPIENT');
    }
    case 'QUOTE.APPROVAL_RESOLVED': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const approvalId = stringValue(payload, 'approvalId');
      const quoteRequestId = stringValue(payload, 'quoteRequestId');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const status = stringValue(payload, 'status');
      const approval = isUuid(approvalId) ? await prisma.quoteApproval.findUnique({ where: { id: approvalId }, include: { requestedBy: true } }) : null;
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, select: { id: true, quoteRequestId: true, quoteRequest: { select: { folio: true } } } });
      const recipient = activeStaff(approval?.requestedBy);
      if (!approval || !['APPROVED', 'REJECTED'].includes(approval.status) || approval.status !== status || approval.quoteId !== event.aggregateId || approval.quoteVersionId !== quoteVersionId || !quote || quote.quoteRequestId !== quoteRequestId || stringValue(payload, 'folio') !== quote.quoteRequest.folio || !recipient) return cancellation('INVALID_PAYLOAD');
      return { kind: 'RECIPIENTS', contexts: [staffApprovalContext(recipient, quote.quoteRequestId, flags)] };
    }
    case 'QUOTE.ACCEPTED': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const acceptanceId = stringValue(payload, 'acceptanceId');
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, include: { quoteRequest: { include: { currentAssignee: true, client: true, contact: { include: { user: true } } } } } });
      const acceptance = isUuid(acceptanceId) ? await prisma.quoteAcceptance.findUnique({ where: { id: acceptanceId }, select: { quoteId: true, quoteVersionId: true, generatedDocumentId: true, termsVersion: true, quoteVersion: { select: { status: true, totalMinor: true, currencyCode: true } } } }) : null;
      if (!quote || !quoteVersionId || stringValue(payload, 'quoteRequestId') !== quote.quoteRequestId || stringValue(payload, 'folio') !== quote.quoteRequest.folio || !acceptance || acceptance.quoteId !== quote.id || acceptance.quoteVersionId !== quoteVersionId || acceptance.quoteVersion.status !== 'ACEPTADA' || stringValue(payload, 'generatedDocumentId') !== acceptance.generatedDocumentId || stringValue(payload, 'termsVersion') !== acceptance.termsVersion) return cancellation('INVALID_PAYLOAD');
      const total = totalLabel(acceptance.quoteVersion.totalMinor, acceptance.quoteVersion.currencyCode);
      const staffRecipient = activeStaff(quote.quoteRequest.currentAssignee);
      // UX audit fix: aceptar una cotización sólo avisaba a staff -- el propio cliente nunca
      // recibía una confirmación de que su aceptación quedó registrada. Se agrega el mismo
      // destinatario de cliente que ya usa QUOTE.PUBLISHED, sin tocar el aviso a staff existente.
      const customerRecipient = quote.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(quote.quoteRequest.contact) : null;
      const managerNotices = (await managerContexts(prisma, quote.quoteRequestId, 'summary', flags, new Set(staffRecipient?.userId ? [staffRecipient.userId] : []))).map((context) => ({ ...context, totalLabel: total }));
      const contexts: NotificationMappingContext[] = [
        ...(staffRecipient ? [{ recipient: staffRecipient, actionPath: requestWorkspaceNotificationPath(quote.quoteRequestId, 'summary', flags), totalLabel: total }] : []),
        ...managerNotices,
        ...(customerRecipient ? [{ ...customerContext(customerRecipient, quote.quoteRequestId), totalLabel: total }] : []),
      ];
      if (contexts.length === 0) return cancellation('NO_RECIPIENT');
      return { kind: 'RECIPIENTS', contexts };
    }
    case 'PROJECT.CREATED': {
      if (event.aggregateType !== 'PROJECT' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const project = await prisma.project.findUnique({ where: { id: event.aggregateId }, include: { owner: true, quoteRequest: { include: { currentAssignee: true, client: true, contact: { include: { user: true } } } } } });
      if (!project || stringValue(payload, 'projectId') !== project.id || stringValue(payload, 'folio') !== project.folio || stringValue(payload, 'quoteRequestId') !== project.quoteRequestId || (stringValue(payload, 'ownerId') ?? null) !== project.ownerId) return cancellation('INVALID_PAYLOAD');
      const source = stringValue(payload, 'source');
      if (source !== 'staff' && source !== 'customer_acceptance') return cancellation('INVALID_PAYLOAD');
      const contexts: NotificationMappingContext[] = [];
      const customer = project.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(project.quoteRequest.contact) : null;
      if (customer) contexts.push({ ...customerContext(customer, project.quoteRequestId), projectFolio: project.folio, folio: project.quoteRequest.folio, ownerName: activeStaff(project.owner)?.displayName });
      const owner = activeStaff(project.owner);
      const createdById = stringValue(payload, 'createdById');
      const ownerAlreadyNotified = source === 'customer_acceptance' && owner?.userId === project.quoteRequest.currentAssigneeId;
      if (owner && owner.userId !== createdById && !ownerAlreadyNotified) {
        const actor = isUuid(createdById) ? await prisma.user.findUnique({ where: { id: createdById }, select: { id: true, email: true, type: true, status: true, displayName: true } }) : null;
        contexts.push({ recipient: owner, actionPath: staffProjectPath(project.id), projectFolio: project.folio, folio: project.quoteRequest.folio, clientName: project.quoteRequest.client.displayName, senderName: activeStaff(actor)?.displayName ?? 'El equipo OCPOOL' });
      }
      return contexts.length ? { kind: 'RECIPIENTS', contexts } : cancellation('NO_RECIPIENT');
    }
    case 'PROJECT.OWNER_CHANGED': {
      if (event.aggregateType !== 'PROJECT' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const ownerId = stringValue(payload, 'ownerId');
      const assignedById = stringValue(payload, 'assignedById');
      const project = await prisma.project.findUnique({ where: { id: event.aggregateId }, include: { owner: true, quoteRequest: { include: { client: true } } } });
      if (!project || stringValue(payload, 'projectId') !== project.id || !isUuid(ownerId) || project.ownerId !== ownerId) return cancellation('INVALID_PAYLOAD');
      if (assignedById === ownerId) return cancellation('SELF_ACTION');
      const recipient = activeStaff(project.owner);
      if (!recipient) return cancellation('NO_RECIPIENT');
      const actor = isUuid(assignedById) ? await prisma.user.findUnique({ where: { id: assignedById }, select: { id: true, email: true, type: true, status: true, displayName: true } }) : null;
      return { kind: 'RECIPIENTS', contexts: [{ recipient, actionPath: staffProjectPath(project.id), projectFolio: project.folio, folio: project.quoteRequest.folio, clientName: project.quoteRequest.client.displayName, senderName: activeStaff(actor)?.displayName ?? 'El equipo OCPOOL' }] };
    }
    case 'MESSAGE.CREATED': {
      if (event.aggregateType !== 'CONVERSATION' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const messageId = stringValue(payload, 'messageId');
      const conversation = await prisma.conversation.findUnique({ where: { id: event.aggregateId }, include: { quoteRequest: { include: { client: true, contact: { include: { user: true } }, currentAssignee: true } }, messages: { where: isUuid(messageId) ? { id: messageId } : { id: '__invalid__' }, include: { sender: true } } } });
      const message = conversation?.messages[0];
      if (!conversation || !message || stringValue(payload, 'folio') !== conversation.quoteRequest.folio || stringValue(payload, 'quoteRequestId') !== conversation.quoteRequestId || stringValue(payload, 'clientId') !== conversation.clientId) return cancellation('INVALID_PAYLOAD');
      if (message.visibility === 'INTERNAL' || stringValue(payload, 'visibility') === 'INTERNAL') return cancellation('INTERNAL_VISIBILITY');
      if (message.visibility !== 'CUSTOMER' || stringValue(payload, 'visibility') !== 'CUSTOMER') return cancellation('INVALID_PAYLOAD');
      if (message.sender?.type === 'CUSTOMER') {
        const change = parseAnyChangeRequest(message.body);
        const declined = parseDeclineRequest(message.body);
        // La declinación ya tiene su evento comercial y su correo `quote.declined`.
        if (declined) return cancellation('INBOX_DIGEST');
        // Las respuestas normales se atienden desde la bandeja; sólo la petición de cambios conserva correo inmediato.
        if (!change) return cancellation('INBOX_DIGEST');
        const tab = change ? 'quote' : 'conversation';
        const assignee = activeStaff(conversation.quoteRequest.currentAssignee);
        // Sin responsable, la respuesta del cliente llega a Gerencia en vez de perderse (antes: NO_RECIPIENT).
        const contexts = assignee ? [staffContext(assignee, conversation.quoteRequestId, tab, flags)] : await managerContexts(prisma, conversation.quoteRequestId, tab, flags);
        if (contexts.length === 0) return cancellation('NO_RECIPIENT');
        const sender = message.sender.displayName;
        return { kind: 'RECIPIENTS', contexts: contexts.map((context) => ({ ...context, senderName: sender, messagePreview: change ? change.message || message.body : message.body, ...(change ? { versionNumber: change.versionNumber } : {}) })) };
      }
      const recipient = conversation.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(conversation.quoteRequest.contact) : null;
      if (!recipient) return cancellation('NO_RECIPIENT');
      if (recipient.userId) return cancellation('INBOX_DIGEST');
      return { kind: 'RECIPIENTS', contexts: [{ ...customerContext(recipient, conversation.quoteRequestId), senderName: message.sender?.displayName ?? 'Tu equipo OCPOOL', messagePreview: message.body }] };
    }
    case 'FILE.AVAILABLE': {
      if (event.aggregateType !== 'FILE_ATTACHMENT' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const attachment = await prisma.fileAttachment.findUnique({ where: { id: event.aggregateId }, include: { uploadedBy: { select: { type: true } }, quoteRequest: { include: { client: true, contact: { include: { user: true } } } } } });
      if (!attachment || attachment.status !== 'AVAILABLE' || attachment.visibility !== 'CUSTOMER' || stringValue(payload, 'fileId') !== attachment.id || stringValue(payload, 'quoteRequestId') !== attachment.quoteRequestId || stringValue(payload, 'visibility') !== 'CUSTOMER' || stringValue(payload, 'category') !== attachment.category) return cancellation(attachment?.visibility === 'INTERNAL' ? 'INTERNAL_VISIBILITY' : 'INVALID_PAYLOAD');
      // El archivo que el propio cliente subió no le genera correo a él; el equipo lo ve en su bandeja.
      if (attachment.uploadedBy.type === 'CUSTOMER') return cancellation('SELF_ACTION');
      const recipient = attachment.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(attachment.quoteRequest.contact) : null;
      return recipient ? { kind: 'RECIPIENTS', contexts: [{ ...customerContext(recipient, attachment.quoteRequestId), folio: attachment.quoteRequest.folio, fileName: attachment.originalFileName }] } : cancellation('NO_RECIPIENT');
    }
    default:
      return cancellation('UNSUPPORTED_EVENT');
  }
}
