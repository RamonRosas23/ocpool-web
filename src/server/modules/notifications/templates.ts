import { z } from 'zod';
import { declineReasonLabel } from '@/lib/decline-request';
import { normalizeNotificationEmail } from '@/server/modules/notifications/domain';
import { brandContact, brandIdentity, brandWebsiteLabel } from '@/lib/brand';
import { details, html, paragraph, quote, renderEmailLayout, strong, type EmailAudience, type EmailBlock, type EmailDetail } from '@/server/modules/notifications/email-layout';

export const NOTIFICATION_TEMPLATE_VERSIONS = ['v1'] as const;
export type NotificationTemplateVersion = (typeof NOTIFICATION_TEMPLATE_VERSIONS)[number];

export const NOTIFICATION_TEMPLATE_KEYS = [
  'auth.customer.magic_link',
  'auth.employee.password_reset',
  'auth.employee.invitation',
  'request.received',
  'request.assigned',
  'quote.version_sent',
  'quote.approval_requested',
  'quote.approval_resolved',
  'quote.accepted',
  'quote.acceptance_confirmed',
  'message.created',
  'file.available',
  'request.new_for_team',
  'quote.changes_requested',
  'quote.declined',
  'request.information_needed',
  'project.started',
  'project.assigned',
  'quote.expiring',
] as const;
export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

export const SUPPORTED_NOTIFICATION_EVENT_TYPES = [
  'AUTH.CUSTOMER_MAGIC_LINK',
  'AUTH.EMPLOYEE_PASSWORD_RESET',
  'AUTH.EMPLOYEE_INVITATION',
  'REQUEST.RECEIVED',
  'REQUEST.ASSIGNED',
  'REQUEST.STATUS_CHANGED',
  'QUOTE.VERSION_STATUS_CHANGED',
  'QUOTE.PUBLISHED',
  'QUOTE.DECLINED',
  'QUOTE.EXPIRING',
  'QUOTE.APPROVAL_REQUESTED',
  'QUOTE.APPROVAL_RESOLVED',
  'QUOTE.ACCEPTED',
  'PROJECT.CREATED',
  'PROJECT.OWNER_CHANGED',
  'MESSAGE.CREATED',
  'FILE.AVAILABLE',
] as const;
export type SupportedNotificationEventType = (typeof SUPPORTED_NOTIFICATION_EVENT_TYPES)[number];

type NotificationAudience = 'CUSTOMER' | 'STAFF';

export type NotificationRecipientContext = {
  userId?: string | null;
  email: string;
  displayName: string;
  audience: NotificationAudience;
};

export type NotificationEventInput = {
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: unknown;
};

export type NotificationMappingContext = {
  recipient: NotificationRecipientContext;
  actionPath?: string;
  actionLabel?: string;
  folio?: string;
  expiresMinutes?: number;
  totalLabel?: string;
  senderName?: string;
  messagePreview?: string;
  fileName?: string;
  versionNumber?: number;
  projectFolio?: string;
  projectType?: string;
  ownerName?: string;
  clientName?: string;
  expiresInHours?: number;
};

export type NotificationIntent = {
  kind: 'INTENT';
  templateKey: NotificationTemplateKey;
  templateVersion: NotificationTemplateVersion;
  recipient: {
    userId: string | null;
    email: string;
    displayName: string;
    audience: NotificationAudience;
  };
  safePayload: Record<string, string | number>;
  transient?: {
    tokenId: string;
    tokenCiphertext: string;
    tokenType: 'MAGIC_LINK' | 'PASSWORD_RESET';
  };
};

export type NotificationMappingResult = NotificationIntent | {
  kind: 'UNSUPPORTED_EVENT';
  eventType: string;
} | {
  kind: 'REJECTED';
  reason: 'INVALID_PAYLOAD' | 'INVALID_RECIPIENT' | 'INVALID_RECIPIENT_SCOPE' | 'INTERNAL_VISIBILITY';
};

const uuid = z.string().uuid();
const folio = z.string().regex(/^OCQ-[0-9]{4}-[0-9]{6}$/u);
const authCustomerPayload = z.object({ tokenId: uuid, tokenCiphertext: z.string().min(1).max(600), tokenType: z.literal('MAGIC_LINK') }).passthrough();
const authEmployeePayload = z.object({ tokenId: uuid, tokenCiphertext: z.string().min(1).max(600), tokenType: z.literal('PASSWORD_RESET'), expiresInMinutes: z.number().int().positive().max(10_080).optional() }).passthrough();
const authEmployeeInvitationPayload = authEmployeePayload.extend({ invitedByName: z.string().min(1).max(180).optional(), roleLabel: z.string().min(1).max(60).optional() });
const requestReceivedPayload = z.object({ quoteRequestId: uuid, folio, origin: z.enum(['PUBLIC_FORM', 'STAFF_CREATED']) }).passthrough();
const requestAssignedPayload = z.object({ quoteRequestId: uuid, folio, assignedToId: uuid }).passthrough();
const requestInformationPayload = z.object({ quoteRequestId: uuid, folio, fromStatus: z.string().min(1).max(40), toStatus: z.literal('INFORMACION_REQUERIDA'), source: z.literal('request_information'), messageId: uuid.optional() }).passthrough();
const quoteStatusPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, fromStatus: z.string().min(1).max(40), toStatus: z.literal('ENVIADA') }).passthrough();
const quotePublishedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio }).passthrough();
const quoteDeclinedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, versionNumber: z.number().int().positive(), reason: z.enum(['PRICE', 'SCOPE', 'TIMING', 'CHOSE_OTHER', 'POSTPONED', 'OTHER']) }).passthrough();
const quoteExpiringPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, versionNumber: z.number().int().positive(), expiresInHours: z.union([z.literal(24), z.literal(72)]) }).passthrough();
const projectCreatedPayload = z.object({ projectId: uuid, folio: z.string().min(1).max(24), quoteRequestId: uuid, source: z.enum(['staff', 'customer_acceptance']), ownerId: uuid.nullable(), createdById: uuid.optional() }).passthrough();
const projectOwnerChangedPayload = z.object({ projectId: uuid, ownerId: uuid, assignedById: uuid.optional() }).passthrough();
// UX audit fix: `PRICE_OVERRIDE` es el único tipo de `QUOTE_APPROVAL_TYPES` (approval-service.ts)
// todavía bloqueado como "no habilitado" -- `SPECIAL_CONCEPT` sí es un flujo real y activo
// (`requestSpecialApproval`/`decideSpecialApproval` en StaffQuotesPanel.tsx), pero faltaba aquí, así
// que su evento de notificación se rechazaba por payload inválido y quedaba cancelado en silencio
// -- ni el correo se enviaba, ni aparecía en la cola de fallos del tablero (que sólo lista `FAILED`,
// nunca `CANCELLED`), así que nadie se enteraba de que faltaba avisar una aprobación pendiente.
const quoteApprovalRequestedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, versionNumber: z.number().int().positive(), approvalId: uuid, type: z.enum(['DISCOUNT', 'PRICE_OVERRIDE', 'SPECIAL_CONCEPT']) }).passthrough();
const quoteApprovalResolvedPayload = quoteApprovalRequestedPayload.extend({ status: z.enum(['APPROVED', 'REJECTED']) });
const quoteAcceptedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, versionNumber: z.number().int().positive(), acceptanceId: uuid, generatedDocumentId: uuid, termsVersion: z.string().min(1).max(64) }).passthrough();
const messagePayload = z.object({ conversationId: uuid, quoteRequestId: uuid, clientId: uuid, messageId: uuid, visibility: z.enum(['CUSTOMER', 'INTERNAL']), folio }).passthrough();
const filePayload = z.object({ fileId: uuid, quoteRequestId: uuid, visibility: z.enum(['CUSTOMER', 'INTERNAL']), category: z.string().min(1).max(64) }).passthrough();
const INVALID_TEXT_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const EVENT_AGGREGATE_TYPES: Record<string, string> = {
  'AUTH.CUSTOMER_MAGIC_LINK': 'USER',
  'AUTH.EMPLOYEE_PASSWORD_RESET': 'USER',
  'AUTH.EMPLOYEE_INVITATION': 'USER',
  'REQUEST.RECEIVED': 'QUOTE_REQUEST',
  'REQUEST.ASSIGNED': 'QUOTE_REQUEST',
  'REQUEST.STATUS_CHANGED': 'QUOTE_REQUEST',
  'QUOTE.VERSION_STATUS_CHANGED': 'QUOTE',
  'QUOTE.PUBLISHED': 'QUOTE',
  'QUOTE.DECLINED': 'QUOTE_REQUEST',
  'QUOTE.EXPIRING': 'QUOTE',
  'QUOTE.APPROVAL_REQUESTED': 'QUOTE',
  'QUOTE.APPROVAL_RESOLVED': 'QUOTE',
  'QUOTE.ACCEPTED': 'QUOTE',
  'PROJECT.CREATED': 'PROJECT',
  'PROJECT.OWNER_CHANGED': 'PROJECT',
  'MESSAGE.CREATED': 'CONVERSATION',
  'FILE.AVAILABLE': 'FILE_ATTACHMENT',
};

function boundedText(value: string, maximum: number, field: string): string {
  const normalized = value.normalize('NFC').trim();
  if (!normalized || INVALID_TEXT_CONTROLS.test(normalized)) throw new Error(`Invalid notification ${field}.`);
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function recipientFor(context: NotificationMappingContext): NotificationIntent['recipient'] {
  return {
    userId: context.recipient.userId ?? null,
    email: normalizeNotificationEmail(context.recipient.email),
    displayName: boundedText(context.recipient.displayName, 180, 'recipient name'),
    audience: context.recipient.audience,
  };
}

function rejectScope(context: NotificationMappingContext, audience: NotificationAudience): NotificationMappingResult | null {
  return context.recipient.audience === audience ? null : { kind: 'REJECTED', reason: 'INVALID_RECIPIENT_SCOPE' };
}

function makeIntent(context: NotificationMappingContext, templateKey: NotificationTemplateKey, safePayload: Record<string, string | number>, transient?: NotificationIntent['transient']): NotificationIntent {
  const recipient = recipientFor(context);
  const actionPath = context.actionPath ?? (recipient.audience === 'CUSTOMER' && !recipient.userId ? '/portal/access' : undefined);
  if (actionPath && (!actionPath.startsWith('/') || CONTROL_CHARACTERS.test(actionPath) || /%0[dDaA]/u.test(actionPath))) throw new Error('Invalid notification action path.');
  const actionLabel = context.actionLabel ?? (recipient.audience === 'CUSTOMER' && !recipient.userId ? 'Solicitar acceso' : undefined);
  return {
    kind: 'INTENT',
    templateKey,
    templateVersion: 'v1',
    recipient,
    safePayload: {
      ...safePayload,
      ...(actionPath ? { actionPath } : {}),
      ...(actionLabel ? { actionLabel } : {}),
      ...(typeof safePayload.recipientName === 'string' ? { recipientName: recipient.displayName } : {}),
    },
    ...(transient ? { transient } : {}),
  };
}

export function mapNotificationEvent(event: NotificationEventInput, context: NotificationMappingContext): NotificationMappingResult {
  try {
    const expectedAggregateType = EVENT_AGGREGATE_TYPES[event.eventType];
    if (expectedAggregateType && event.aggregateType !== expectedAggregateType) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
    switch (event.eventType) {
      case 'AUTH.CUSTOMER_MAGIC_LINK': {
        const parsed = authCustomerPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'auth.customer.magic_link', {
          recipientName: context.recipient.displayName,
          expiresMinutes: context.expiresMinutes ?? 15,
        }, parsed.data);
      }
      case 'AUTH.EMPLOYEE_PASSWORD_RESET': {
        const parsed = authEmployeePayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'auth.employee.password_reset', {
          recipientName: context.recipient.displayName,
          expiresMinutes: context.expiresMinutes ?? parsed.data.expiresInMinutes ?? 15,
        }, parsed.data);
      }
      case 'AUTH.EMPLOYEE_INVITATION': {
        const parsed = authEmployeeInvitationPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'auth.employee.invitation', {
          recipientName: context.recipient.displayName,
          expiresMinutes: parsed.data.expiresInMinutes ?? 72 * 60,
          ...(parsed.data.invitedByName ? { senderName: boundedText(parsed.data.invitedByName, 180, 'inviter name') } : {}),
          ...(parsed.data.roleLabel ? { roleLabel: boundedText(parsed.data.roleLabel, 60, 'role label') } : {}),
        }, parsed.data);
      }
      case 'REQUEST.RECEIVED': {
        const parsed = requestReceivedPayload.safeParse(event.payload);
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        // Gerencia recibe la solicitud nueva del sitio; el cliente, su acuse.
        if (context.recipient.audience === 'STAFF') {
          return makeIntent(context, 'request.new_for_team', { recipientName: context.recipient.displayName, folio: parsed.data.folio, senderName: boundedText(context.senderName ?? 'Un cliente', 180, 'client name'), preview: boundedText(context.messagePreview ?? 'Proyecto por definir', 300, 'project summary') });
        }
        const scope = rejectScope(context, 'CUSTOMER');
        if (scope) return scope;
        return makeIntent(context, 'request.received', { recipientName: context.recipient.displayName, folio: parsed.data.folio });
      }
      case 'REQUEST.ASSIGNED': {
        const parsed = requestAssignedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'request.assigned', { recipientName: context.recipient.displayName, folio: parsed.data.folio });
      }
      case 'REQUEST.STATUS_CHANGED': {
        const parsed = requestInformationPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'request.information_needed', {
          recipientName: context.recipient.displayName,
          folio: parsed.data.folio,
          ...(context.projectType ? { projectType: boundedText(context.projectType, 120, 'project type') } : {}),
          ...(context.messagePreview ? { preview: boundedText(context.messagePreview, 500, 'message preview') } : {}),
        });
      }
      case 'QUOTE.DECLINED': {
        const parsed = quoteDeclinedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'quote.declined', {
          recipientName: context.recipient.displayName,
          folio: parsed.data.folio,
          versionNumber: parsed.data.versionNumber,
          reason: declineReasonLabel(parsed.data.reason),
          ...(context.senderName ? { senderName: boundedText(context.senderName, 180, 'client name') } : {}),
          ...(context.messagePreview ? { preview: boundedText(context.messagePreview, 500, 'message preview') } : {}),
        });
      }
      case 'QUOTE.VERSION_STATUS_CHANGED': {
        const parsed = quoteStatusPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'quote.version_sent', { recipientName: context.recipient.displayName, folio: parsed.data.folio });
      }
      case 'QUOTE.PUBLISHED': {
        const parsed = quotePublishedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'quote.version_sent', { recipientName: context.recipient.displayName, folio: parsed.data.folio });
      }
      case 'QUOTE.APPROVAL_REQUESTED': {
        const parsed = quoteApprovalRequestedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'quote.approval_requested', { recipientName: context.recipient.displayName, folio: parsed.data.folio, versionNumber: parsed.data.versionNumber, approvalType: parsed.data.type });
      }
      case 'QUOTE.APPROVAL_RESOLVED': {
        const parsed = quoteApprovalResolvedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'quote.approval_resolved', { recipientName: context.recipient.displayName, folio: parsed.data.folio, versionNumber: parsed.data.versionNumber, approvalType: parsed.data.type, approvalStatus: parsed.data.status });
      }
      case 'QUOTE.ACCEPTED': {
        const parsed = quoteAcceptedPayload.safeParse(event.payload);
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        const safePayload = { recipientName: context.recipient.displayName, folio: parsed.data.folio, versionNumber: parsed.data.versionNumber, totalLabel: boundedText(context.totalLabel ?? 'Consulta el portal para ver el total', 120, 'total') };
        // UX audit fix: este evento ahora también llega a un destinatario CUSTOMER (la
        // confirmación de aceptación que antes no existía) -- cada audiencia usa su propia
        // plantilla en vez de reutilizar el texto interno pensado para staff.
        if (context.recipient.audience === 'CUSTOMER') return makeIntent(context, 'quote.acceptance_confirmed', safePayload);
        const scope = rejectScope(context, 'STAFF');
        if (scope) return scope;
        return makeIntent(context, 'quote.accepted', safePayload);
      }
      case 'PROJECT.CREATED': {
        const parsed = projectCreatedPayload.safeParse(event.payload);
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (context.recipient.audience === 'CUSTOMER') {
          return makeIntent(context, 'project.started', {
            recipientName: context.recipient.displayName,
            folio: boundedText(context.folio ?? 'Tu expediente', 40, 'folio'),
            projectFolio: boundedText(context.projectFolio ?? parsed.data.folio, 24, 'project folio'),
            ...(context.ownerName ? { ownerName: boundedText(context.ownerName, 180, 'owner name') } : {}),
          });
        }
        return makeIntent(context, 'project.assigned', {
          recipientName: context.recipient.displayName,
          folio: boundedText(context.folio ?? 'Tu expediente', 40, 'folio'),
          projectFolio: boundedText(context.projectFolio ?? parsed.data.folio, 24, 'project folio'),
          clientName: boundedText(context.clientName ?? 'El cliente', 180, 'client name'),
          senderName: boundedText(context.senderName ?? 'El equipo OCPOOL', 180, 'staff name'),
        });
      }
      case 'PROJECT.OWNER_CHANGED': {
        const parsed = projectOwnerChangedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'STAFF');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'project.assigned', {
          recipientName: context.recipient.displayName,
          folio: boundedText(context.folio ?? 'Tu expediente', 40, 'folio'),
          projectFolio: boundedText(context.projectFolio ?? 'Proyecto', 24, 'project folio'),
          clientName: boundedText(context.clientName ?? 'El cliente', 180, 'client name'),
          senderName: boundedText(context.senderName ?? 'El equipo OCPOOL', 180, 'staff name'),
        });
      }
      case 'QUOTE.EXPIRING': {
        const parsed = quoteExpiringPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (scope) return scope;
        return makeIntent(context, 'quote.expiring', {
          recipientName: context.recipient.displayName,
          folio: parsed.data.folio,
          versionNumber: parsed.data.versionNumber,
          expiresInHours: parsed.data.expiresInHours,
        });
      }
      case 'MESSAGE.CREATED': {
        const parsed = messagePayload.safeParse(event.payload);
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (parsed.data.visibility === 'INTERNAL') return { kind: 'REJECTED', reason: 'INTERNAL_VISIBILITY' };
        if (context.recipient.audience === 'STAFF' && context.versionNumber) {
          return makeIntent(context, 'quote.changes_requested', { recipientName: context.recipient.displayName, folio: parsed.data.folio, versionNumber: context.versionNumber, senderName: boundedText(context.senderName ?? 'El cliente', 180, 'sender name'), preview: boundedText(context.messagePreview ?? 'Revisa la conversación del expediente.', 500, 'message preview') });
        }
        return makeIntent(context, 'message.created', { recipientName: context.recipient.displayName, folio: parsed.data.folio, senderName: boundedText(context.senderName ?? 'Tu equipo OCPOOL', 180, 'sender name'), preview: boundedText(context.messagePreview ?? 'Tienes un nuevo mensaje en tu expediente.', 500, 'message preview') });
      }
      case 'FILE.AVAILABLE': {
        const parsed = filePayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (parsed.data.visibility === 'INTERNAL') return { kind: 'REJECTED', reason: 'INTERNAL_VISIBILITY' };
        if (scope) return scope;
        return makeIntent(context, 'file.available', { recipientName: context.recipient.displayName, folio: boundedText(context.folio ?? 'Tu expediente', 40, 'folio'), fileName: boundedText(context.fileName ?? 'Un archivo nuevo', 255, 'file name') });
      }
      default:
        return { kind: 'UNSUPPORTED_EVENT', eventType: event.eventType };
    }
  } catch {
    return { kind: 'REJECTED', reason: 'INVALID_RECIPIENT' };
  }
}

export type NotificationTemplateData = {
  appUrl: string;
  recipientName: string;
  actionUrl: string;
  actionLabel?: string;
  expiresMinutes?: number;
  folio?: string;
  versionNumber?: number;
  approvalType?: string;
  approvalStatus?: string;
  totalLabel?: string;
  senderName?: string;
  preview?: string;
  fileName?: string;
  /** Rol con el que se invita a alguien al equipo (Ventas, Gerencia). */
  roleLabel?: string;
  projectFolio?: string;
  projectType?: string;
  ownerName?: string;
  clientName?: string;
  reason?: string;
  expiresInHours?: number;
};

export type RenderNotificationTemplateInput = {
  templateKey: NotificationTemplateKey;
  templateVersion: NotificationTemplateVersion;
  data: NotificationTemplateData;
};

export type RenderedNotificationTemplate = {
  subject: string;
  text: string;
  html: string;
};

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const ALLOWED_PATHS = ['/portal', '/staff', '/auth/customer/consume-link', '/auth/recovery'];

function safeHeader(value: string): string {
  if (CONTROL_CHARACTERS.test(value) || value.length > 240) throw new Error('Unsafe email header value.');
  return value;
}

function allowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.some((allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`));
}

export function buildNotificationUrl(appUrl: string, path: string): string {
  if (CONTROL_CHARACTERS.test(path) || /%0[dDaA]/u.test(path) || !path.startsWith('/')) throw new Error('Unsafe notification URL.');
  const origin = new URL(appUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.hash) throw new Error('Invalid notification application origin.');
  const target = new URL(path, origin);
  if (target.origin !== origin.origin || target.username || target.password || target.hash || !allowedPath(target.pathname)) throw new Error('Notification URL is outside the application allowlist.');
  return target.toString();
}

function validateActionUrl(appUrl: string, actionUrl: string): string {
  const target = new URL(actionUrl);
  const path = `${target.pathname}${target.search}`;
  const normalized = buildNotificationUrl(appUrl, path);
  if (normalized !== target.toString()) throw new Error('Notification action URL is not canonical.');
  return normalized;
}

/** "15 minutos", "72 horas": la invitación dura días y leerla en minutos confundía. */
function expiresLabel(minutes: number): string {
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} horas`;
  return `${minutes} minutos`;
}

const APPROVAL_TYPE_LABELS: Readonly<Record<string, string>> = { DISCOUNT: 'descuento', SPECIAL_CONCEPT: 'concepto especial' };

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Vista previa de bandeja: un renglón, sin cortar a media palabra si se puede evitar. */
function previewLine(value: string, maximum = 140): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  if (flat.length <= maximum) return flat;
  const cut = flat.slice(0, maximum - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maximum * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Pie del texto plano: el mismo contacto que el HTML, para quien lee el correo sin formato. */
function textFooter(audience: EmailAudience): string {
  return audience === 'staff'
    ? '\n\n—\nAviso automático del espacio interno de OCPOOL.'
    : `\n\n—\n${brandIdentity.name} · ${brandIdentity.tagline}\n${brandContact.email} · ${brandContact.phone} · ${brandWebsiteLabel}`;
}

type EmailContent = Readonly<{
  audience: EmailAudience;
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  blocks: readonly EmailBlock[];
  actionLabel: string;
  text: string;
  securityNote?: string;
}>;

export function renderNotificationTemplate(input: RenderNotificationTemplateInput): RenderedNotificationTemplate {
  if (input.templateVersion !== 'v1') throw new Error('Unsupported notification template version.');
  const data = input.data;
  const actionUrl = validateActionUrl(data.appUrl, data.actionUrl);
  const folio = data.folio ? safeHeader(data.folio) : '';
  const projectFolio = data.projectFolio ? safeHeader(data.projectFolio) : '';
  const version = data.versionNumber ? ` versión ${data.versionNumber}` : '';
  const approvalType = APPROVAL_TYPE_LABELS[data.approvalType ?? ''] ?? 'ajuste de precio';
  const preview = data.preview ?? '';
  const portalAccessPending = new URL(actionUrl).pathname === '/portal/access';
  // Un mismo evento (p. ej. un mensaje) puede ir al cliente o al equipo; el destino lo distingue.
  const staffAudience = new URL(actionUrl).pathname.startsWith('/staff');
  const folioRows: EmailDetail[] = folio ? [{ label: 'Folio', value: folio }] : [];
  const versionRows: EmailDetail[] = data.versionNumber ? [{ label: 'Versión', value: String(data.versionNumber) }] : [];
  const totalRows: EmailDetail[] = data.totalLabel ? [{ label: 'Total', value: data.totalLabel, emphasis: /\d/u.test(data.totalLabel) }] : [];

  const compose = (content: EmailContent): RenderedNotificationTemplate => ({
    subject: content.subject,
    text: `${content.text}${textFooter(content.audience)}`,
    html: renderEmailLayout({
      audience: content.audience,
      appUrl: data.appUrl,
      preheader: previewLine(content.preheader),
      eyebrow: content.eyebrow,
      title: content.title,
      greeting: `Hola ${data.recipientName},`,
      blocks: content.blocks,
      action: { label: content.actionLabel, url: actionUrl },
      ...(content.securityNote ? { securityNote: content.securityNote } : {}),
    }),
  });

  switch (input.templateKey) {
    case 'auth.customer.magic_link': {
      const expires = data.expiresMinutes ?? 15;
      return compose({
        audience: 'customer',
        subject: 'Tu acceso seguro a OCPOOL',
        preheader: `Tu enlace personal para entrar al portal. Vence en ${expires} minutos.`,
        eyebrow: 'Acceso seguro',
        title: 'Accede a tu portal',
        blocks: [paragraph(`Usa este enlace para entrar de forma segura a tu portal. Expira en ${expires} minutos y sólo puede utilizarse una vez.`)],
        actionLabel: 'Entrar al portal',
        securityNote: 'Por tu seguridad, no reenvíes este correo: el enlace da acceso a tu expediente.',
        text: `Hola ${data.recipientName},\n\nAccede a tu portal de OCPOOL: ${actionUrl}\n\nEl enlace expira en ${expires} minutos y sólo puede utilizarse una vez.`,
      });
    }
    case 'auth.employee.password_reset': {
      const expires = expiresLabel(data.expiresMinutes ?? 15);
      // Neutral: la recuperación la puede pedir la propia persona o gerencia desde Equipo.
      return compose({
        audience: 'staff',
        subject: 'Restablece tu acceso interno a OCPOOL',
        preheader: `Enlace para restablecer tu contraseña. Vence en ${expires}.`,
        eyebrow: 'Acceso interno',
        title: 'Restablece tu contraseña',
        blocks: [paragraph(`Recibimos una solicitud para restablecer tu acceso interno. El enlace expira en ${expires} y sólo puede utilizarse una vez. Si no la esperabas, ignora este correo: tu contraseña actual sigue igual.`)],
        actionLabel: 'Restablecer acceso',
        securityNote: 'Por tu seguridad, no reenvíes este correo: el enlace da acceso a tu cuenta interna.',
        text: `Hola ${data.recipientName},\n\nRecibimos una solicitud para restablecer tu acceso interno a OCPOOL: ${actionUrl}\n\nEl enlace expira en ${expires} y sólo puede utilizarse una vez. Si no la esperabas, ignora este correo.`,
      });
    }
    case 'auth.employee.invitation': {
      const expires = expiresLabel(data.expiresMinutes ?? 72 * 60);
      const inviter = data.senderName ?? 'El equipo de OCPOOL';
      const role = data.roleLabel ? html` como ${strong(data.roleLabel)}` : html``;
      return compose({
        audience: 'staff',
        subject: 'Te damos la bienvenida al equipo de OCPOOL',
        preheader: `${inviter} te invitó al espacio interno de OCPOOL.`,
        eyebrow: 'Invitación al equipo',
        title: 'Crea tu contraseña',
        blocks: [paragraph(html`${inviter} te invitó al espacio interno de OCPOOL${role}. Crea tu contraseña para entrar; el enlace expira en ${expires} y sólo puede utilizarse una vez.`)],
        actionLabel: 'Crear contraseña',
        securityNote: 'Por tu seguridad, no reenvíes este correo: el enlace es personal.',
        text: `Hola ${data.recipientName},\n\n${inviter} te invitó al espacio interno de OCPOOL${data.roleLabel ? ` como ${data.roleLabel}` : ''}. Crea tu contraseña para entrar: ${actionUrl}\n\nEl enlace expira en ${expires} y sólo puede utilizarse una vez.`,
      });
    }
    case 'request.received': {
      const received = paragraph(html`Tu solicitud ${folio} fue recibida y ya forma parte de tu expediente.`);
      const status = details([...folioRows, { label: 'Estado', value: 'Recibida' }]);
      return compose({
        audience: 'customer',
        subject: safeHeader(`Recibimos tu solicitud ${folio}`),
        preheader: `Tu solicitud ${folio} ya forma parte de tu expediente.`,
        eyebrow: 'Solicitud de cotización',
        title: 'Solicitud recibida',
        blocks: portalAccessPending
          ? [received, status, paragraph('Para consultar avances en línea, solicita acceso al portal. Nuestro equipo habilitará tu cuenta y después recibirás un enlace seguro de un solo uso en este correo.')]
          : [received, status, paragraph('Consulta los avances directamente en tu portal.')],
        actionLabel: data.actionLabel ?? 'Ver expediente',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\nRecibimos tu solicitud ${folio}.\n\nPara consultar avances en línea, solicita acceso al portal: ${actionUrl}\n\nNuestro equipo habilitará tu cuenta y después recibirás un enlace seguro de un solo uso en este correo.`
          : `Hola ${data.recipientName},\n\nRecibimos tu solicitud ${folio}. Consulta el avance en tu portal: ${actionUrl}`,
      });
    }
    case 'request.assigned':
      return compose({
        audience: 'staff',
        subject: safeHeader(`Te asignaron la solicitud ${folio}`),
        preheader: `La solicitud ${folio} ahora está a tu cargo.`,
        eyebrow: 'Asignación',
        title: 'Nueva solicitud a tu cargo',
        blocks: [paragraph(html`La solicitud ${folio} ahora está a tu cargo. Revisa el alcance y define el siguiente paso con el cliente.`), details(folioRows)],
        actionLabel: 'Abrir expediente',
        text: `Hola ${data.recipientName},\n\nLa solicitud ${folio} ahora está a tu cargo. Abre el expediente: ${actionUrl}`,
      });
    case 'request.information_needed': {
      const project = data.projectType ? ` sobre ${data.projectType}` : '';
      const previewBlock = data.preview ? [quote(data.preview)] : [];
      return compose({
        audience: 'customer',
        subject: safeHeader(`Necesitamos información para tu solicitud ${folio}`),
        preheader: `Comparte la información pendiente${project} para continuar con ${folio}.`,
        eyebrow: 'Siguiente paso',
        title: 'Necesitamos información',
        blocks: [paragraph(html`Para continuar con tu solicitud ${folio}${project}, necesitamos la información indicada por nuestro equipo.`), details(folioRows), ...previewBlock],
        actionLabel: 'Responder solicitud',
        text: `Hola ${data.recipientName},\n\nPara continuar con tu solicitud ${folio}${project}, comparte la información solicitada.${data.preview ? `\n\n${data.preview}` : ''}\n\nResponder en tu portal: ${actionUrl}`,
      });
    }
    case 'quote.version_sent':
      return compose({
        audience: 'customer',
        subject: safeHeader(`Tu cotización ${folio} está disponible`),
        preheader: `La cotización ${folio} está lista para tu revisión.`,
        eyebrow: 'Cotización',
        title: 'Cotización disponible',
        blocks: portalAccessPending
          ? [paragraph(html`La cotización ${folio} ya está disponible para tu expediente.`), details(folioRows), paragraph('Solicita acceso al portal para consultarla. Nuestro equipo habilitará tu cuenta y recibirás un enlace seguro de un solo uso en este correo.')]
          : [paragraph(html`Ya puedes revisar la cotización ${folio} en tu portal: el detalle, los importes y el PDF.`), details(folioRows), paragraph('Desde ahí mismo puedes aceptarla o pedirnos cambios.')],
        actionLabel: data.actionLabel ?? 'Revisar cotización',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\nLa cotización ${folio} ya está disponible para tu expediente. Solicita acceso al portal: ${actionUrl}\n\nNuestro equipo habilitará tu cuenta y recibirás un enlace seguro de un solo uso en este correo.`
          : `Hola ${data.recipientName},\n\nTu cotización ${folio} está disponible en el portal: ${actionUrl}\n\nDesde ahí puedes revisar el PDF, aceptarla o pedirnos cambios.`,
      });
    case 'quote.approval_requested':
      return compose({
        audience: 'staff',
        subject: safeHeader(`Aprobación de ${approvalType} pendiente: ${folio}`),
        preheader: `La cotización ${folio}${version} requiere tu aprobación.`,
        eyebrow: 'Aprobación',
        title: 'Aprobación requerida',
        blocks: [
          paragraph(data.versionNumber
            ? html`La versión ${data.versionNumber} de la cotización ${folio} requiere tu aprobación de ${approvalType} para continuar.`
            : html`La cotización ${folio} requiere tu aprobación de ${approvalType} para continuar.`),
          details([...folioRows, ...versionRows, { label: 'Tipo', value: capitalize(approvalType) }]),
        ],
        actionLabel: data.actionLabel ?? 'Revisar aprobación',
        text: `La cotización ${folio}${version} requiere aprobación de ${approvalType}. Revisa el expediente: ${actionUrl}`,
      });
    case 'quote.approval_resolved': {
      const approved = data.approvalStatus === 'APPROVED';
      const outcome = approved ? 'autorizada' : 'rechazada';
      return compose({
        audience: 'staff',
        subject: safeHeader(`${approved ? 'Aprobación autorizada' : 'Aprobación rechazada'} ${folio}`),
        preheader: `La aprobación de ${approvalType} para ${folio} fue ${outcome}.`,
        eyebrow: 'Aprobación',
        title: approved ? 'Aprobación autorizada' : 'Aprobación rechazada',
        blocks: [
          paragraph(html`La aprobación de ${approvalType} para la cotización ${folio}${version} fue ${strong(outcome)}.`),
          details([...folioRows, ...versionRows, { label: 'Tipo', value: capitalize(approvalType) }, { label: 'Resultado', value: capitalize(outcome) }]),
        ],
        actionLabel: data.actionLabel ?? 'Abrir expediente',
        text: `La aprobación de ${approvalType} para ${folio}${version} fue ${outcome}. Revisa el expediente: ${actionUrl}`,
      });
    }
    case 'quote.accepted':
      return compose({
        audience: 'staff',
        subject: safeHeader(`Cotización ${folio} aceptada`),
        preheader: `El cliente aceptó la cotización ${folio}.`,
        eyebrow: 'Expediente',
        title: 'Cotización aceptada',
        blocks: [
          paragraph(html`El cliente aceptó la cotización ${folio}${version}.`),
          details([...folioRows, ...versionRows, ...totalRows.map((row) => ({ ...row, label: 'Total aceptado' }))]),
          paragraph('Siguiente paso: el arranque. El proyecto se crea automáticamente con la aceptación; ábrelo desde el expediente para confirmar responsable y tareas.'),
        ],
        actionLabel: 'Abrir expediente',
        text: `Hola ${data.recipientName},\n\nEl cliente aceptó la cotización ${folio}${version}.${data.totalLabel ? ` Total aceptado: ${data.totalLabel}.` : ''}\n\nSiguiente paso: el arranque (el proyecto se crea automáticamente). Abre el expediente: ${actionUrl}`,
      });
    case 'quote.acceptance_confirmed':
      // UX audit fix: confirma la aceptación al cliente y explica qué sigue -- ninguna acción
      // pendiente de su parte, el equipo se pondrá en contacto para coordinar el arranque.
      return compose({
        audience: 'customer',
        subject: safeHeader(`Confirmamos la aceptación de tu cotización ${folio}`),
        preheader: `Registramos tu aceptación de la cotización ${folio}.`,
        eyebrow: 'Cotización aceptada',
        title: 'Aceptación confirmada',
        blocks: [
          paragraph(html`Confirmamos que tu aceptación de la cotización ${folio}${version} quedó registrada correctamente.`),
          details([...folioRows, ...versionRows, ...totalRows]),
          paragraph('No necesitas hacer nada más por ahora. Nuestro equipo revisará los detalles y te contactará en tu expediente para coordinar los siguientes pasos.'),
        ],
        actionLabel: data.actionLabel ?? 'Ver mi expediente',
        text: `Hola ${data.recipientName},\n\nConfirmamos que tu aceptación de la cotización ${folio}${version} quedó registrada correctamente.${data.totalLabel ? ` Total: ${data.totalLabel}.` : ''}\n\nNo necesitas hacer nada más por ahora. Nuestro equipo te contactará en tu expediente para coordinar los siguientes pasos.\n\nConsulta tu expediente: ${actionUrl}`,
      });
    case 'message.created': {
      if (staffAudience) {
        // Respuesta del cliente al responsable: antes recibía el texto pensado para el cliente
        // ("dejó un mensaje en tu expediente").
        // El nombre va al encabezado Subject: sin caracteres de control y acotado (safeHeader rechaza > 240).
        const senderForHeader = (data.senderName ?? 'El cliente').replace(/[\u0000-\u001F\u007F]+/gu, ' ').trim() || 'El cliente';
        return compose({
          audience: 'staff',
          subject: safeHeader(`${senderForHeader} respondió en ${folio}`.slice(0, 240)),
          preheader: `${senderForHeader}: ${preview}`,
          eyebrow: 'Mensaje del cliente',
          title: 'El cliente respondió',
          blocks: [paragraph(html`${data.senderName ?? 'El cliente'} respondió en el expediente ${folio}:`), quote(preview)],
          actionLabel: data.actionLabel ?? 'Responder',
          text: `Hola ${data.recipientName},\n\n${data.senderName ?? 'El cliente'} respondió en ${folio}:\n\n${preview}\n\nResponder: ${actionUrl}`,
        });
      }
      const sender = data.senderName ?? 'Tu equipo OCPOOL';
      const intro = paragraph(html`${sender} dejó un mensaje en tu expediente ${folio}:`);
      return compose({
        audience: 'customer',
        subject: safeHeader(`Nuevo mensaje sobre tu expediente ${folio}`),
        preheader: `${sender}: ${preview}`,
        eyebrow: 'Mensaje',
        title: 'Nuevo mensaje',
        blocks: portalAccessPending
          ? [intro, quote(preview), paragraph('Si eres cliente nuevo, primero habilitaremos tu cuenta. Después podrás continuar la conversación en el portal.')]
          : [intro, quote(preview)],
        actionLabel: data.actionLabel ?? 'Leer mensaje',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\n${sender} dejó un mensaje sobre ${folio}:\n\n${preview}\n\nSi eres cliente nuevo, primero habilitaremos tu cuenta. Solicita acceso al portal: ${actionUrl}`
          : `Hola ${data.recipientName},\n\n${sender} dejó un mensaje sobre ${folio}:\n\n${preview}\n\nAbrir mensaje: ${actionUrl}`,
      });
    }
    case 'request.new_for_team': {
      const client = data.senderName ?? 'Un cliente';
      const project = data.preview ?? 'Proyecto por definir';
      return compose({
        audience: 'staff',
        subject: safeHeader(`Nueva solicitud ${folio}`),
        preheader: `${client}: ${project}. Todavía no tiene responsable.`,
        eyebrow: 'Solicitud nueva',
        title: 'Llegó una solicitud nueva',
        blocks: [
          paragraph(html`${client} envió la solicitud ${folio} desde el sitio. Todavía no tiene responsable.`),
          details([...folioRows, { label: 'Cliente', value: client }, { label: 'Proyecto', value: project }]),
        ],
        actionLabel: 'Abrir solicitud',
        text: `Hola ${data.recipientName},\n\n${client} envió la solicitud ${folio} desde el sitio: ${project}. Todavía no tiene responsable.\n\nAbrir solicitud: ${actionUrl}`,
      });
    }
    case 'quote.changes_requested': {
      const sender = data.senderName ?? 'El cliente';
      const senderForHeader = sender.replace(/[\u0000-\u001F\u007F]+/gu, ' ').trim() || 'El cliente';
      return compose({
        audience: 'staff',
        subject: safeHeader(`${senderForHeader} pidió cambios en ${folio}`.slice(0, 240)),
        preheader: `${senderForHeader}: ${preview}`,
        eyebrow: 'Cambios pedidos',
        title: data.versionNumber ? `Cambios a la propuesta V${data.versionNumber}` : 'Cambios a la propuesta',
        blocks: [paragraph(html`${sender} pidió cambios a la propuesta${version} del expediente ${folio}:`), quote(preview)],
        actionLabel: data.actionLabel ?? 'Revisar propuesta',
        text: `Hola ${data.recipientName},\n\n${sender} pidió cambios a la propuesta${version} de ${folio}:\n\n${preview}\n\nRevisar: ${actionUrl}`,
      });
    }
    case 'quote.declined': {
      const client = data.senderName ?? 'El cliente';
      const reason = data.reason ?? 'Motivo no especificado';
      const previewBlock = data.preview ? [quote(data.preview)] : [];
      return compose({
        audience: 'staff',
        subject: safeHeader(`${client} declinó la propuesta ${folio}${version}`.slice(0, 240)),
        preheader: `${folio}${version}: ${reason}.`,
        eyebrow: 'Propuesta declinada',
        title: 'El cliente declinó la propuesta',
        blocks: [paragraph(html`${client} declinó la propuesta${version} del expediente ${folio}. Motivo: ${strong(reason)}.`), details([...folioRows, ...versionRows, { label: 'Motivo', value: reason }]), ...previewBlock],
        actionLabel: 'Revisar propuesta',
        text: `Hola ${data.recipientName},\n\n${client} declinó la propuesta${version} de ${folio}. Motivo: ${reason}.${data.preview ? `\n\n${data.preview}` : ''}\n\nRevisar expediente: ${actionUrl}`,
      });
    }
    case 'project.started': {
      const owner = data.ownerName ? ` La persona responsable será ${data.ownerName}.` : '';
      return compose({
        audience: 'customer',
        subject: safeHeader(`Tu proyecto ${projectFolio} comenzó`),
        preheader: `El proyecto de tu expediente ${folio} ya está en marcha.`,
        eyebrow: 'Proyecto iniciado',
        title: 'Tu proyecto comenzó',
        blocks: [paragraph(html`Tu proyecto ${strong(projectFolio)} del expediente ${folio} ya está en marcha.${owner}`), details([...folioRows, { label: 'Proyecto', value: projectFolio }])],
        actionLabel: 'Ver mi expediente',
        text: `Hola ${data.recipientName},\n\nTu proyecto ${projectFolio} del expediente ${folio} ya está en marcha.${owner}\n\nVer expediente: ${actionUrl}`,
      });
    }
    case 'project.assigned': {
      const client = data.clientName ?? 'el cliente';
      const assignedBy = data.senderName ?? 'El equipo OCPOOL';
      return compose({
        audience: 'staff',
        subject: safeHeader(`Te asignaron el proyecto ${projectFolio}`),
        preheader: `${projectFolio} de ${client} ahora está a tu cargo.`,
        eyebrow: 'Asignación de proyecto',
        title: 'Nuevo proyecto a tu cargo',
        blocks: [paragraph(html`${assignedBy} te asignó el proyecto ${strong(projectFolio)} de ${client}.`), details([...folioRows, { label: 'Proyecto', value: projectFolio }, { label: 'Cliente', value: client }])],
        actionLabel: 'Abrir proyecto',
        text: `Hola ${data.recipientName},\n\n${assignedBy} te asignó el proyecto ${projectFolio} de ${client}.${folio ? ` Expediente: ${folio}.` : ''}\n\nAbrir proyecto: ${actionUrl}`,
      });
    }
    case 'quote.expiring': {
      if (data.expiresInHours !== 24 && data.expiresInHours !== 72) throw new Error('Invalid quote expiration window.');
      const expires = `${data.expiresInHours} horas`;
      return compose({
        audience: 'customer',
        subject: safeHeader(`Tu cotización ${folio} vence pronto`),
        preheader: `La vigencia de tu propuesta termina en ${expires}.`,
        eyebrow: 'Cotización',
        title: 'Tu cotización está por vencer',
        blocks: [paragraph(html`La cotización ${folio}${version} mantiene su vigencia por ${strong(expires)}. Si quieres continuar, revísala desde tu expediente.`), details([...folioRows, ...versionRows])],
        actionLabel: 'Revisar cotización',
        text: `Hola ${data.recipientName},\n\nLa cotización ${folio}${version} mantiene su vigencia por ${expires}. Revísala aquí: ${actionUrl}`,
      });
    }
    case 'file.available': {
      const fileName = data.fileName ?? 'Un archivo nuevo';
      const available = paragraph(html`El archivo ${strong(fileName)} ya está disponible en tu expediente ${folio}.`);
      return compose({
        audience: 'customer',
        subject: safeHeader(`Archivo disponible en ${folio}`),
        preheader: `Hay un archivo nuevo en tu expediente ${folio}.`,
        eyebrow: 'Archivo',
        title: 'Archivo disponible',
        blocks: portalAccessPending
          ? [available, paragraph('Si eres cliente nuevo, primero habilitaremos tu cuenta. Después podrás consultar el archivo en el portal.')]
          : [available],
        actionLabel: data.actionLabel ?? 'Ver archivo',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\nEl archivo ${fileName} ya está disponible en ${folio}.\n\nSi eres cliente nuevo, primero habilitaremos tu cuenta. Solicita acceso al portal: ${actionUrl}`
          : `Hola ${data.recipientName},\n\nEl archivo ${fileName} ya está disponible en ${folio}.\n\nVer archivo: ${actionUrl}`,
      });
    }
  }
}
