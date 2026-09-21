import { z } from 'zod';
import { normalizeNotificationEmail } from '@/server/modules/notifications/domain';

export const NOTIFICATION_TEMPLATE_VERSIONS = ['v1'] as const;
export type NotificationTemplateVersion = (typeof NOTIFICATION_TEMPLATE_VERSIONS)[number];

export const NOTIFICATION_TEMPLATE_KEYS = [
  'auth.customer.magic_link',
  'auth.employee.password_reset',
  'request.received',
  'request.assigned',
  'quote.version_sent',
  'quote.approval_requested',
  'quote.approval_resolved',
  'quote.accepted',
  'quote.acceptance_confirmed',
  'message.created',
  'file.available',
] as const;
export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

export const SUPPORTED_NOTIFICATION_EVENT_TYPES = [
  'AUTH.CUSTOMER_MAGIC_LINK',
  'AUTH.EMPLOYEE_PASSWORD_RESET',
  'REQUEST.RECEIVED',
  'REQUEST.ASSIGNED',
  'QUOTE.VERSION_STATUS_CHANGED',
  'QUOTE.PUBLISHED',
  'QUOTE.APPROVAL_REQUESTED',
  'QUOTE.APPROVAL_RESOLVED',
  'QUOTE.ACCEPTED',
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
const authEmployeePayload = z.object({ tokenId: uuid, tokenCiphertext: z.string().min(1).max(600), tokenType: z.literal('PASSWORD_RESET') }).passthrough();
const requestReceivedPayload = z.object({ quoteRequestId: uuid, folio, origin: z.enum(['PUBLIC_FORM', 'STAFF_CREATED']) }).passthrough();
const requestAssignedPayload = z.object({ quoteRequestId: uuid, folio, assignedToId: uuid }).passthrough();
const quoteStatusPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, fromStatus: z.string().min(1).max(40), toStatus: z.literal('ENVIADA') }).passthrough();
const quotePublishedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio }).passthrough();
const quoteApprovalRequestedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, versionNumber: z.number().int().positive(), approvalId: uuid, type: z.enum(['DISCOUNT', 'PRICE_OVERRIDE']) }).passthrough();
const quoteApprovalResolvedPayload = quoteApprovalRequestedPayload.extend({ status: z.enum(['APPROVED', 'REJECTED']) });
const quoteAcceptedPayload = z.object({ quoteId: uuid, quoteVersionId: uuid, quoteRequestId: uuid, folio, versionNumber: z.number().int().positive(), acceptanceId: uuid, generatedDocumentId: uuid, termsVersion: z.string().min(1).max(64) }).passthrough();
const messagePayload = z.object({ conversationId: uuid, quoteRequestId: uuid, clientId: uuid, messageId: uuid, visibility: z.enum(['CUSTOMER', 'INTERNAL']), folio }).passthrough();
const filePayload = z.object({ fileId: uuid, quoteRequestId: uuid, visibility: z.enum(['CUSTOMER', 'INTERNAL']), category: z.string().min(1).max(64) }).passthrough();
const INVALID_TEXT_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const EVENT_AGGREGATE_TYPES: Record<string, string> = {
  'AUTH.CUSTOMER_MAGIC_LINK': 'USER',
  'AUTH.EMPLOYEE_PASSWORD_RESET': 'USER',
  'REQUEST.RECEIVED': 'QUOTE_REQUEST',
  'REQUEST.ASSIGNED': 'QUOTE_REQUEST',
  'QUOTE.VERSION_STATUS_CHANGED': 'QUOTE',
  'QUOTE.PUBLISHED': 'QUOTE',
  'QUOTE.APPROVAL_REQUESTED': 'QUOTE',
  'QUOTE.APPROVAL_RESOLVED': 'QUOTE',
  'QUOTE.ACCEPTED': 'QUOTE',
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
          expiresMinutes: context.expiresMinutes ?? 15,
        }, parsed.data);
      }
      case 'REQUEST.RECEIVED': {
        const parsed = requestReceivedPayload.safeParse(event.payload);
        const scope = rejectScope(context, 'CUSTOMER');
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
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
      case 'MESSAGE.CREATED': {
        const parsed = messagePayload.safeParse(event.payload);
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        if (parsed.data.visibility === 'INTERNAL') return { kind: 'REJECTED', reason: 'INTERNAL_VISIBILITY' };
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

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

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

function layout(title: string, body: string, actionLabel: string, actionUrl: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f0ea;color:#252321;font-family:Arial,sans-serif"><main style="max-width:620px;margin:32px auto;padding:32px;background:#fffdf9;border:1px solid #ded5ca"><p style="letter-spacing:.12em;text-transform:uppercase;color:#8b5e3c;font-size:12px">OCPOOL</p><h1 style="font-size:26px;font-weight:500">${escapeHtml(title)}</h1>${body}<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#252321;color:#fffdf9;text-decoration:none">${escapeHtml(actionLabel)}</a></p><p style="font-size:12px;color:#6f6963">Este correo es informativo. El portal de OCPOOL es la fuente de verdad de tu expediente.</p></main></body></html>`;
}

export function renderNotificationTemplate(input: RenderNotificationTemplateInput): RenderedNotificationTemplate {
  if (input.templateVersion !== 'v1') throw new Error('Unsupported notification template version.');
  const data = input.data;
  const recipientName = escapeHtml(data.recipientName);
  const actionUrl = validateActionUrl(data.appUrl, data.actionUrl);
  const folio = data.folio ? safeHeader(data.folio) : '';
  const version = data.versionNumber ? ` versión ${data.versionNumber}` : '';
  const approvalType = data.approvalType === 'DISCOUNT' ? 'descuento' : 'ajuste de precio';
  const total = data.totalLabel ? escapeHtml(data.totalLabel) : '';
  const sender = escapeHtml(data.senderName ?? 'Tu equipo OCPOOL');
  const preview = data.preview ?? '';
  const portalAccessPending = new URL(actionUrl).pathname === '/portal/access';

  switch (input.templateKey) {
    case 'auth.customer.magic_link': {
      const expires = data.expiresMinutes ?? 15;
      const subject = 'Tu acceso seguro a OCPOOL';
      const title = 'Accede a tu portal';
      const body = `<p>Hola ${recipientName},</p><p>Usa este enlace para entrar de forma segura a tu portal. Expira en ${expires} minutos y sólo puede utilizarse una vez.</p>`;
      return { subject, text: `Hola ${data.recipientName},\n\nAccede a tu portal de OCPOOL: ${actionUrl}\n\nEl enlace expira en ${expires} minutos y sólo puede utilizarse una vez.`, html: layout(title, body, 'Entrar al portal', actionUrl) };
    }
    case 'auth.employee.password_reset': {
      const expires = data.expiresMinutes ?? 15;
      const subject = 'Restablece tu acceso interno a OCPOOL';
      const title = 'Restablece tu contraseña';
      const body = `<p>Hola ${recipientName},</p><p>Solicitaste restablecer tu acceso interno. El enlace expira en ${expires} minutos y sólo puede utilizarse una vez.</p>`;
      return { subject, text: `Hola ${data.recipientName},\n\nRestablece tu contraseña: ${actionUrl}\n\nEl enlace expira en ${expires} minutos y sólo puede utilizarse una vez.`, html: layout(title, body, 'Restablecer acceso', actionUrl) };
    }
    case 'request.received': {
      const subject = safeHeader(`Recibimos tu solicitud ${folio}`);
      const body = portalAccessPending
        ? `<p>Hola ${recipientName},</p><p>Tu solicitud ${escapeHtml(folio)} fue recibida y ya forma parte de tu expediente.</p><p>Para consultar avances en línea, solicita acceso al portal. Nuestro equipo habilitará tu cuenta y después recibirás un enlace seguro de un solo uso en este correo.</p>`
        : `<p>Hola ${recipientName},</p><p>Tu solicitud ${escapeHtml(folio)} fue recibida y ya forma parte de tu expediente.</p><p>Consulta los avances directamente en tu portal.</p>`;
      const text = portalAccessPending
        ? `Hola ${data.recipientName},\n\nRecibimos tu solicitud ${folio}.\n\nPara consultar avances en línea, solicita acceso al portal: ${actionUrl}\n\nNuestro equipo habilitará tu cuenta y después recibirás un enlace seguro de un solo uso en este correo.`
        : `Hola ${data.recipientName},\n\nRecibimos tu solicitud ${folio}. Consulta el avance en tu portal: ${actionUrl}`;
      return { subject, text, html: layout('Solicitud recibida', body, data.actionLabel ?? 'Ver expediente', actionUrl) };
    }
    case 'request.assigned': {
      const subject = safeHeader(`Solicitud asignada ${folio}`);
      const body = `<p>Hola ${recipientName},</p><p>La solicitud ${escapeHtml(folio)} requiere tu atención dentro del espacio interno.</p>`;
      return { subject, text: `Solicitud ${folio} asignada. Revisa el expediente en el espacio interno.`, html: layout('Nueva solicitud asignada', body, 'Abrir expediente', actionUrl) };
    }
    case 'quote.version_sent': {
      const subject = safeHeader(`Tu cotización está disponible ${folio}`);
      const body = portalAccessPending
        ? `<p>Hola ${recipientName},</p><p>La cotización ${escapeHtml(folio)} ya está disponible para tu expediente.</p><p>Solicita acceso al portal para consultarla. Nuestro equipo habilitará tu cuenta y recibirás un enlace seguro de un solo uso en este correo.</p>`
        : `<p>Hola ${recipientName},</p><p>Ya puedes revisar la cotización ${escapeHtml(folio)} en tu portal. La versión y sus importes corresponden al snapshot enviado.</p>`;
      const text = portalAccessPending
        ? `Hola ${data.recipientName},\n\nLa cotización ${folio} ya está disponible para tu expediente. Solicita acceso al portal: ${actionUrl}\n\nNuestro equipo habilitará tu cuenta y recibirás un enlace seguro de un solo uso en este correo.`
        : `Hola ${data.recipientName},\n\nTu cotización ${folio} está disponible en el portal: ${actionUrl}`;
      return { subject, text, html: layout('Cotización disponible', body, data.actionLabel ?? 'Revisar cotización', actionUrl) };
    }
    case 'quote.approval_requested': {
      const subject = safeHeader(`Aprobación comercial requerida ${folio}`);
      const body = `<p>Hola ${recipientName},</p><p>La versión${version} de la cotización ${escapeHtml(folio)} requiere tu aprobación para continuar.</p><p>Tipo: <strong>${escapeHtml(approvalType)}</strong></p>`;
      return { subject, text: `La cotización ${folio}${version} requiere aprobación de ${approvalType}. Revisa el expediente: ${actionUrl}`, html: layout('Aprobación requerida', body, data.actionLabel ?? 'Revisar aprobación', actionUrl) };
    }
    case 'quote.approval_resolved': {
      const approved = data.approvalStatus === 'APPROVED';
      const subject = safeHeader(`${approved ? 'Aprobación autorizada' : 'Aprobación rechazada'} ${folio}`);
      const body = `<p>Hola ${recipientName},</p><p>La aprobación de ${escapeHtml(approvalType)} para la cotización ${escapeHtml(folio)}${version} fue <strong>${approved ? 'autorizada' : 'rechazada'}</strong>.</p>`;
      return { subject, text: `La aprobación de ${approvalType} para ${folio}${version} fue ${approved ? 'autorizada' : 'rechazada'}. Revisa el expediente: ${actionUrl}`, html: layout(approved ? 'Aprobación autorizada' : 'Aprobación rechazada', body, data.actionLabel ?? 'Abrir expediente', actionUrl) };
    }
    case 'quote.accepted': {
      const subject = safeHeader(`Cotización aceptada ${folio}`);
      const body = `<p>Hola ${recipientName},</p><p>La cotización ${escapeHtml(folio)}${version} fue aceptada por el cliente.</p>${total ? `<p>Total snapshot: <strong>${total}</strong></p>` : ''}`;
      return { subject, text: `Cotización ${folio}${version} aceptada. ${data.totalLabel ?? ''}`.trim(), html: layout('Cotización aceptada', body, 'Abrir espacio interno', actionUrl) };
    }
    case 'quote.acceptance_confirmed': {
      // UX audit fix: confirma la aceptación al cliente y explica qué sigue -- ninguna acción
      // pendiente de su parte, el equipo se pondrá en contacto para coordinar el arranque.
      const subject = safeHeader(`Confirmamos la aceptación de tu cotización ${folio}`);
      const body = `<p>Hola ${recipientName},</p><p>Confirmamos que tu aceptación de la cotización ${escapeHtml(folio)}${version} quedó registrada correctamente.</p>${total ? `<p>Total: <strong>${total}</strong></p>` : ''}<p>No necesitas hacer nada más por ahora. Nuestro equipo revisará los detalles y te contactará en tu expediente para coordinar los siguientes pasos.</p>`;
      const text = `Hola ${data.recipientName},\n\nConfirmamos que tu aceptación de la cotización ${folio}${version} quedó registrada correctamente. ${data.totalLabel ?? ''}\n\nNo necesitas hacer nada más por ahora. Nuestro equipo te contactará en tu expediente para coordinar los siguientes pasos.\n\nConsulta tu expediente: ${actionUrl}`.trim();
      return { subject, text, html: layout('Aceptación confirmada', body, data.actionLabel ?? 'Ver mi expediente', actionUrl) };
    }
    case 'message.created': {
      const subject = safeHeader(`Nuevo mensaje sobre tu expediente ${folio}`);
      const body = portalAccessPending
        ? `<p>Hola ${recipientName},</p><p>${sender} dejó un mensaje en tu expediente ${escapeHtml(folio)}:</p><blockquote style="margin:16px 0;padding:12px;border-left:3px solid #8b5e3c">${escapeHtml(preview)}</blockquote><p>Si eres cliente nuevo, primero habilitaremos tu cuenta. Después podrás continuar la conversación en el portal.</p>`
        : `<p>Hola ${recipientName},</p><p>${sender} dejó un mensaje en tu expediente ${escapeHtml(folio)}:</p><blockquote style="margin:16px 0;padding:12px;border-left:3px solid #8b5e3c">${escapeHtml(preview)}</blockquote>`;
      const text = portalAccessPending
        ? `Hola ${data.recipientName},\n\n${data.senderName ?? 'Tu equipo OCPOOL'} dejó un mensaje sobre ${folio}:\n\n${preview}\n\nSi eres cliente nuevo, primero habilitaremos tu cuenta. Solicita acceso al portal: ${actionUrl}`
        : `Hola ${data.recipientName},\n\n${data.senderName ?? 'Tu equipo OCPOOL'} dejó un mensaje sobre ${folio}:\n\n${preview}\n\nAbrir mensaje: ${actionUrl}`;
      return { subject, text, html: layout('Nuevo mensaje', body, data.actionLabel ?? 'Leer mensaje', actionUrl) };
    }
    case 'file.available': {
      const fileName = escapeHtml(data.fileName ?? 'Un archivo nuevo');
      const subject = safeHeader(`Archivo disponible en ${folio}`);
      const body = portalAccessPending
        ? `<p>Hola ${recipientName},</p><p>El archivo <strong>${fileName}</strong> ya está disponible en tu expediente ${escapeHtml(folio)}.</p><p>Si eres cliente nuevo, primero habilitaremos tu cuenta. Después podrás consultar el archivo en el portal.</p>`
        : `<p>Hola ${recipientName},</p><p>El archivo <strong>${fileName}</strong> ya está disponible en tu expediente ${escapeHtml(folio)}.</p>`;
      const text = portalAccessPending
        ? `Hola ${data.recipientName},\n\nEl archivo ${data.fileName ?? 'Un archivo nuevo'} ya está disponible en ${folio}.\n\nSi eres cliente nuevo, primero habilitaremos tu cuenta. Solicita acceso al portal: ${actionUrl}`
        : `Hola ${data.recipientName},\n\nEl archivo ${data.fileName ?? 'Un archivo nuevo'} ya está disponible en ${folio}.\n\nVer archivo: ${actionUrl}`;
      return { subject, text, html: layout('Archivo disponible', body, data.actionLabel ?? 'Ver archivo', actionUrl) };
    }
  }
}
