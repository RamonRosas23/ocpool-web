import type { PrismaClient } from '@/generated/prisma/client';
import type { NotificationCancellationReason } from '@/server/modules/notifications/dispatcher';
import type { NotificationEventInput, NotificationMappingContext, NotificationRecipientContext } from '@/server/modules/notifications/templates';

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

function customerContext(recipient: NotificationRecipientContext, actionPath = '/portal'): NotificationMappingContext {
  return recipient.userId
    ? { recipient, actionPath }
    : { recipient, actionPath: '/portal/access', actionLabel: 'Solicitar acceso' };
}

function staffContext(recipient: NotificationRecipientContext): NotificationMappingContext {
  return { recipient, actionPath: '/staff/requests' };
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
    : user?.type === 'EMPLOYEE' && user.status === 'ACTIVE'
      ? { userId: user.id, email: user.email, displayName: user.displayName, audience: 'STAFF' as const }
      : null;
  if (!recipient) return cancellation('NO_RECIPIENT');
  return { kind: 'RECIPIENTS', contexts: [{ recipient }] };
}

export async function resolveNotificationEvent(prisma: DbClient, event: NotificationEventInput): Promise<NotificationEventResolution> {
  const payload = recordValue(event.payload);
  if (!payload) return cancellation('INVALID_PAYLOAD');

  if (event.eventType === 'AUTH.CUSTOMER_MAGIC_LINK' || event.eventType === 'AUTH.EMPLOYEE_PASSWORD_RESET') return resolveAuthRecipient(prisma, event);

  switch (event.eventType) {
    case 'REQUEST.RECEIVED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const request = await prisma.quoteRequest.findUnique({ where: { id: event.aggregateId }, include: { client: true, contact: { include: { user: true } } } });
      if (!request || stringValue(payload, 'quoteRequestId') !== request.id || stringValue(payload, 'folio') !== request.folio) return cancellation('INVALID_PAYLOAD');
      const recipient = request?.client.status === 'ACTIVE' ? contactRecipient(request.contact) : null;
      return recipient ? { kind: 'RECIPIENTS', contexts: [customerContext(recipient)] } : cancellation('NO_RECIPIENT');
    }
    case 'REQUEST.ASSIGNED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const assignedToId = stringValue(payload, 'assignedToId');
      const request = await prisma.quoteRequest.findUnique({ where: { id: event.aggregateId }, include: { currentAssignee: true } });
      if (!request || stringValue(payload, 'quoteRequestId') !== request.id || stringValue(payload, 'folio') !== request.folio || !isUuid(assignedToId) || request.currentAssigneeId !== assignedToId) return cancellation('INVALID_PAYLOAD');
      const recipient = activeStaff(request.currentAssignee);
      return recipient ? { kind: 'RECIPIENTS', contexts: [staffContext(recipient)] } : cancellation('NO_RECIPIENT');
    }
    case 'QUOTE.VERSION_STATUS_CHANGED': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const quoteRequestId = stringValue(payload, 'quoteRequestId');
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, include: { quoteRequest: { include: { client: true, contact: { include: { user: true } } } } } });
      const quoteVersion = quote && quoteVersionId ? await prisma.quoteVersion.findFirst({ where: { id: quoteVersionId, quoteId: quote.id }, select: { id: true } }) : null;
      const recipient = quote?.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(quote.quoteRequest.contact) : null;
      if (!quote || !quoteVersionId || !quoteRequestId || stringValue(payload, 'folio') !== quote.quoteRequest.folio || quote.quoteRequestId !== quoteRequestId || !quoteVersion) return cancellation('INVALID_PAYLOAD');
      return recipient ? { kind: 'RECIPIENTS', contexts: [customerContext(recipient)] } : cancellation('NO_RECIPIENT');
    }
    case 'QUOTE.ACCEPTED': {
      if (event.aggregateType !== 'QUOTE' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const quoteVersionId = stringValue(payload, 'quoteVersionId');
      const acceptanceId = stringValue(payload, 'acceptanceId');
      const quote = await prisma.quote.findUnique({ where: { id: event.aggregateId }, include: { currentVersion: true, quoteRequest: { include: { currentAssignee: true } } } });
      const acceptance = isUuid(acceptanceId) ? await prisma.quoteAcceptance.findUnique({ where: { id: acceptanceId }, select: { quoteId: true, quoteVersionId: true, generatedDocumentId: true, termsVersion: true } }) : null;
      if (!quote || !quoteVersionId || stringValue(payload, 'quoteRequestId') !== quote.quoteRequestId || stringValue(payload, 'folio') !== quote.quoteRequest.folio || quote.currentVersionId !== quoteVersionId || quote.currentVersion?.status !== 'ACEPTADA' || !acceptance || acceptance.quoteId !== quote.id || acceptance.quoteVersionId !== quoteVersionId || stringValue(payload, 'generatedDocumentId') !== acceptance.generatedDocumentId || stringValue(payload, 'termsVersion') !== acceptance.termsVersion) return cancellation('INVALID_PAYLOAD');
      const recipient = activeStaff(quote.quoteRequest.currentAssignee);
      if (!recipient) return cancellation('NO_RECIPIENT');
      return { kind: 'RECIPIENTS', contexts: [
        { recipient, actionPath: '/staff/requests', totalLabel: totalLabel(quote.currentVersion.totalMinor, quote.currentVersion.currencyCode) },
      ] };
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
        const recipient = activeStaff(conversation.quoteRequest.currentAssignee);
        return recipient ? { kind: 'RECIPIENTS', contexts: [{ ...staffContext({ ...recipient }), senderName: message.sender.displayName, messagePreview: message.body }] } : cancellation('NO_RECIPIENT');
      }
      const recipient = conversation.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(conversation.quoteRequest.contact) : null;
      return recipient ? { kind: 'RECIPIENTS', contexts: [{ ...customerContext(recipient), senderName: message.sender?.displayName ?? 'Tu equipo OCPOOL', messagePreview: message.body }] } : cancellation('NO_RECIPIENT');
    }
    case 'FILE.AVAILABLE': {
      if (event.aggregateType !== 'FILE_ATTACHMENT' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const attachment = await prisma.fileAttachment.findUnique({ where: { id: event.aggregateId }, include: { quoteRequest: { include: { client: true, contact: { include: { user: true } } } } } });
      if (!attachment || attachment.status !== 'AVAILABLE' || attachment.visibility !== 'CUSTOMER' || stringValue(payload, 'fileId') !== attachment.id || stringValue(payload, 'quoteRequestId') !== attachment.quoteRequestId || stringValue(payload, 'visibility') !== 'CUSTOMER' || stringValue(payload, 'category') !== attachment.category) return cancellation(attachment?.visibility === 'INTERNAL' ? 'INTERNAL_VISIBILITY' : 'INVALID_PAYLOAD');
      const recipient = attachment.quoteRequest.client.status === 'ACTIVE' ? contactRecipient(attachment.quoteRequest.contact) : null;
      return recipient ? { kind: 'RECIPIENTS', contexts: [{ ...customerContext(recipient, '/portal'), folio: attachment.quoteRequest.folio, fileName: attachment.originalFileName }] } : cancellation('NO_RECIPIENT');
    }
    default:
      return cancellation('UNSUPPORTED_EVENT');
  }
}
