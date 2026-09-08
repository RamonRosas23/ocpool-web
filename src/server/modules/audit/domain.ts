import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_AUDIT_TIMEZONE = 'America/Chihuahua';
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 93;
const DAY_MS = 86_400_000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_DETAIL_LENGTH = 160;

export const AUDIT_DEFAULT_LIMIT = 25;
export const AUDIT_MAX_LIMIT = 50;

export const AUDIT_CATEGORIES = ['commercial', 'communication', 'documents', 'notifications', 'security'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_OUTCOMES = ['SUCCESS', 'DENIED', 'FAILURE'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export type AuditSource = 'operational' | 'security';

type DetailDefinition = {
  key: string;
  label: string;
};

export type AuditActionDefinition = {
  category: Exclude<AuditCategory, 'security'>;
  label: string;
  details: readonly DetailDefinition[];
};

const detail = (key: string, label: string): DetailDefinition => ({ key, label });

export const AUDIT_ACTION_DEFINITIONS: Record<string, AuditActionDefinition> = {
  'catalog.category.created': { category: 'commercial', label: 'Categoría de catálogo creada', details: [detail('code', 'Código'), detail('name', 'Nombre')] },
  'catalog.item.created': { category: 'commercial', label: 'Concepto de catálogo creado', details: [detail('code', 'Código'), detail('name', 'Nombre')] },
  'catalog.item.updated': { category: 'commercial', label: 'Concepto de catálogo actualizado', details: [detail('code', 'Código'), detail('status', 'Estado')] },
  'prices.list.created': { category: 'commercial', label: 'Lista de precios creada', details: [detail('code', 'Código'), detail('currencyCode', 'Moneda')] },
  'prices.item.created': { category: 'commercial', label: 'Precio creado', details: [detail('currencyCode', 'Moneda'), detail('unitPriceMinor', 'Importe mínimo')] },
  'prices.item.updated': { category: 'commercial', label: 'Precio actualizado', details: [detail('currencyCode', 'Moneda'), detail('unitPriceMinor', 'Importe mínimo')] },
  'quote_request.created': { category: 'commercial', label: 'Solicitud creada', details: [detail('folio', 'Folio'), detail('origin', 'Origen')] },
  'quote_request.assigned': { category: 'commercial', label: 'Solicitud asignada', details: [detail('folio', 'Folio')] },
  'quote_request.status_changed': { category: 'commercial', label: 'Estado de solicitud actualizado', details: [detail('folio', 'Folio'), detail('fromStatus', 'Estado anterior'), detail('toStatus', 'Estado nuevo'), detail('source', 'Origen del cambio')] },
  'quote.version.created': { category: 'commercial', label: 'Versión de cotización creada', details: [detail('folio', 'Folio'), detail('versionNumber', 'Versión'), detail('currencyCode', 'Moneda')] },
  'quote.version.updated': { category: 'commercial', label: 'Borrador de cotización actualizado', details: [detail('folio', 'Folio'), detail('versionNumber', 'Versión')] },
  'quote.version.status_changed': { category: 'commercial', label: 'Estado de cotización actualizado', details: [detail('folio', 'Folio'), detail('fromStatus', 'Estado anterior'), detail('toStatus', 'Estado nuevo'), detail('reason', 'Motivo')] },
  'quote.accepted': { category: 'commercial', label: 'Cotización aceptada', details: [detail('folio', 'Folio'), detail('versionNumber', 'Versión'), detail('termsVersion', 'Términos')] },
  'quote.acceptance.created': { category: 'commercial', label: 'Evidencia de aceptación registrada', details: [detail('versionNumber', 'Versión'), detail('termsVersion', 'Términos')] },
  'quote.pdf.download_url_created': { category: 'documents', label: 'Descarga de cotización preparada', details: [detail('versionNumber', 'Versión'), detail('expiresInSeconds', 'Vigencia en segundos')] },
  'quote.pdf.generated': { category: 'documents', label: 'PDF de cotización generado', details: [detail('templateVersion', 'Plantilla'), detail('byteSize', 'Tamaño en bytes')] },
  'quote.pdf.generation_failed': { category: 'documents', label: 'Generación de PDF fallida', details: [detail('failureCode', 'Código de fallo')] },
  'file.reserved': { category: 'documents', label: 'Archivo reservado', details: [detail('folio', 'Folio'), detail('category', 'Categoría'), detail('byteSize', 'Tamaño en bytes')] },
  'file.rejected': { category: 'documents', label: 'Archivo rechazado', details: [detail('folio', 'Folio'), detail('category', 'Categoría'), detail('reason', 'Motivo')] },
  'file.available': { category: 'documents', label: 'Archivo disponible', details: [detail('folio', 'Folio'), detail('category', 'Categoría'), detail('reason', 'Motivo')] },
  'file.deleted': { category: 'documents', label: 'Archivo eliminado', details: [detail('folio', 'Folio'), detail('category', 'Categoría')] },
  'file.reservation_expired': { category: 'documents', label: 'Reserva de archivo expirada', details: [detail('category', 'Categoría')] },
  'file.download_url_created': { category: 'documents', label: 'Descarga de archivo preparada', details: [detail('category', 'Categoría')] },
  'conversation.message_created': { category: 'communication', label: 'Mensaje registrado', details: [detail('folio', 'Folio'), detail('visibility', 'Visibilidad')] },
  'conversation.status_changed': { category: 'communication', label: 'Estado de conversación actualizado', details: [detail('folio', 'Folio'), detail('fromStatus', 'Estado anterior'), detail('toStatus', 'Estado nuevo')] },
  'notification.retry': { category: 'notifications', label: 'Notificación reintentada', details: [detail('previousStatus', 'Estado anterior'), detail('previousErrorCode', 'Código anterior'), detail('templateKey', 'Plantilla'), detail('eventType', 'Evento')] },
};

const AUTH_EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Inicio de sesión exitoso',
  LOGIN_FAILURE: 'Intento de inicio de sesión fallido',
  LOGOUT: 'Cierre de sesión',
  MAGIC_LINK_REQUEST: 'Solicitud de enlace de acceso',
  MAGIC_LINK_CONSUMED: 'Enlace de acceso consumido',
  PASSWORD_RESET_REQUEST: 'Solicitud de recuperación',
  PASSWORD_RESET_CONSUMED: 'Recuperación consumida',
  MFA_ENROLLED: 'MFA inscrito',
  MFA_CHALLENGE: 'Desafío MFA',
  MFA_FAILURE: 'Fallo MFA',
  SESSION_CREATED: 'Sesión creada',
  SESSION_REVOKED: 'Sesión revocada',
};

export type AuditCursor = {
  version: 1;
  source: AuditSource;
  from: string;
  to: string;
  category: AuditCategory | null;
  outcome: AuditOutcome | null;
  limit: number;
  createdAt: string;
  id: string;
};

export type AuditCursorContext = Pick<AuditCursor, 'version' | 'source' | 'from' | 'to' | 'category' | 'outcome' | 'limit'>;

export type AuditQueryInput = {
  from?: string;
  to?: string;
  category?: AuditCategory;
  outcome?: AuditOutcome;
  cursor?: string;
  limit?: number;
};

export type AuditQuery = {
  from: Date;
  to: Date;
  timezone: string;
  category: AuditCategory | null;
  outcome: AuditOutcome | null;
  limit: number;
  cursor: AuditCursor | null;
};

export type AuditDetail = { label: string; value: string };

export type AuditEntry = {
  eventKey: string;
  occurredAt: string;
  category: AuditCategory;
  action: string;
  outcome: AuditOutcome;
  actorLabel: string;
  actorKey: string | null;
  entityLabel: string;
  details: AuditDetail[];
};

export type AuditResponse = {
  items: AuditEntry[];
  nextCursor: string | null;
  meta: {
    from: string;
    to: string;
    timezone: string;
    scope: AuditSource;
    freshness: 'fresh';
  };
};

export type AuditQueryOptions = {
  now?: Date;
  timezone?: string;
  source?: AuditSource;
  cursorSecret?: string;
};

function assertTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new Error('La zona horaria no es válida.');
  }
}

function timeZoneParts(value: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 0,
    day: values.get('day') ?? 0,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
}

function calendarDateFor(value: Date, timezone: string): string {
  const parts = timeZoneParts(value, timezone);
  return [parts.year, parts.month, parts.day].map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0')).join('-');
}

function calendarSerial(value: string): number {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error('La fecha no es válida.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const serial = Date.UTC(year, month - 1, day);
  const check = new Date(serial);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error('La fecha no es válida.');
  return serial;
}

function addCalendarDays(value: string, days: number): string {
  return new Date(calendarSerial(value) + (days * DAY_MS)).toISOString().slice(0, 10);
}

function zonedCalendarDateToUtc(value: string, timezone: string): Date {
  const naiveUtc = calendarSerial(value);
  let candidate = new Date(naiveUtc);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = timeZoneParts(candidate, timezone);
    const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate = new Date(naiveUtc - (wallClockUtc - candidate.getTime()));
  }
  return candidate;
}

function assertCategory(value: unknown): AuditCategory | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !(AUDIT_CATEGORIES as readonly string[]).includes(value)) throw new Error('La categoría no es válida.');
  return value as AuditCategory;
}

function assertOutcome(value: unknown): AuditOutcome | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !(AUDIT_OUTCOMES as readonly string[]).includes(value)) throw new Error('El resultado no es válido.');
  return value as AuditOutcome;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return AUDIT_DEFAULT_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > AUDIT_MAX_LIMIT) throw new Error('El límite no es válido.');
  return value;
}

export function normalizeAuditQuery(input: AuditQueryInput = {}, options: AuditQueryOptions = {}): AuditQuery {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('La fecha de operación no es válida.');
  const timezone = assertTimezone(options.timezone ?? DEFAULT_AUDIT_TIMEZONE);
  const today = calendarDateFor(now, timezone);
  const toCalendarDate = input.to ?? today;
  const fromCalendarDate = input.from ?? addCalendarDays(toCalendarDate, -DEFAULT_RANGE_DAYS);
  const fromSerial = calendarSerial(fromCalendarDate);
  const toSerial = calendarSerial(toCalendarDate);
  const rangeDays = Math.round((toSerial - fromSerial) / DAY_MS);
  if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) throw new Error('El rango de fechas no es válido.');
  if (toCalendarDate > today) throw new Error('El rango de fechas no puede estar en el futuro.');

  const category = assertCategory(input.category);
  const outcome = assertOutcome(input.outcome);
  const limit = normalizeLimit(input.limit);
  const source = options.source ?? 'operational';
  const context: AuditCursorContext = {
    version: 1,
    source,
    from: zonedCalendarDateToUtc(fromCalendarDate, timezone).toISOString(),
    to: zonedCalendarDateToUtc(toCalendarDate, timezone).toISOString(),
    category,
    outcome,
    limit,
  };
  const cursor = input.cursor
    ? decodeAuditCursor(input.cursor, options.cursorSecret ?? '', context)
    : null;
  return {
    from: new Date(context.from),
    to: new Date(context.to),
    timezone,
    category,
    outcome,
    limit,
    cursor,
  };
}

function hmacKey(encodedSecret: string): Buffer {
  const key = Buffer.from(encodedSecret, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedSecret) throw new Error('La clave de cursor no es válida.');
  return key;
}

function canonicalCursorPayload(cursor: AuditCursor): string {
  return JSON.stringify({
    version: cursor.version,
    source: cursor.source,
    from: cursor.from,
    to: cursor.to,
    category: cursor.category,
    outcome: cursor.outcome,
    limit: cursor.limit,
    createdAt: cursor.createdAt,
    id: cursor.id,
  });
}

function assertCursor(cursor: AuditCursor): void {
  if (cursor.version !== 1 || (cursor.source !== 'operational' && cursor.source !== 'security')) throw new Error('El cursor no es válido.');
  if (!cursor.from || !cursor.to || !cursor.createdAt || !UUID_PATTERN.test(cursor.id)) throw new Error('El cursor no es válido.');
  if (!AUDIT_CATEGORIES.includes(cursor.category as AuditCategory) && cursor.category !== null) throw new Error('El cursor no es válido.');
  if (!AUDIT_OUTCOMES.includes(cursor.outcome as AuditOutcome) && cursor.outcome !== null) throw new Error('El cursor no es válido.');
  if (!Number.isInteger(cursor.limit) || cursor.limit < 1 || cursor.limit > AUDIT_MAX_LIMIT) throw new Error('El cursor no es válido.');
  if (Number.isNaN(new Date(cursor.from).getTime()) || Number.isNaN(new Date(cursor.to).getTime()) || Number.isNaN(new Date(cursor.createdAt).getTime())) throw new Error('El cursor no es válido.');
}

export function encodeAuditCursor(cursor: AuditCursor, encodedSecret: string): string {
  assertCursor(cursor);
  const payload = Buffer.from(canonicalCursorPayload(cursor), 'utf8').toString('base64url');
  const signature = createHmac('sha256', hmacKey(encodedSecret)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeAuditCursor(raw: string, encodedSecret: string, expected: AuditCursorContext): AuditCursor {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 2048) throw new Error('El cursor no es válido.');
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || raw.split('.').length !== 2) throw new Error('El cursor no es válido.');
  const expectedSignature = createHmac('sha256', hmacKey(encodedSecret)).update(payload).digest('base64url');
  const actual = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) throw new Error('El cursor no es válido.');
  let cursor: AuditCursor;
  try {
    cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuditCursor;
  } catch {
    throw new Error('El cursor no es válido.');
  }
  assertCursor(cursor);
  if (expected.version !== cursor.version || expected.source !== cursor.source || expected.from !== cursor.from || expected.to !== cursor.to || expected.category !== cursor.category || expected.outcome !== cursor.outcome || expected.limit !== cursor.limit) throw new Error('El cursor no corresponde a los filtros actuales.');
  return cursor;
}

export function classifyAuditAction(action: string): AuditActionDefinition | null {
  return AUDIT_ACTION_DEFINITIONS[action] ?? null;
}

function safeDetailValue(value: unknown): string | null {
  if (typeof value === 'string') {
    if (value.length === 0 || value.length > MAX_DETAIL_LENGTH) return null;
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return String(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return null;
}

export function projectAuditMetadata(action: string, metadata: unknown): AuditDetail[] {
  const definition = classifyAuditAction(action);
  if (!definition || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const record = metadata as Record<string, unknown>;
  return definition.details.flatMap(({ key, label }) => {
    const value = safeDetailValue(record[key]);
    return value === null ? [] : [{ label, value }];
  });
}

export function classifyAuthEvent(eventType: string): { category: 'security'; label: string } | null {
  const label = AUTH_EVENT_LABELS[eventType];
  return label ? { category: 'security', label } : null;
}

export function entityLabelForType(entityType: string | null | undefined): string {
  switch (entityType) {
    case 'quote_request': return 'Solicitud comercial';
    case 'quote': return 'Cotización';
    case 'quote_version': return 'Versión de cotización';
    case 'quote_acceptance': return 'Aceptación';
    case 'conversation':
    case 'conversation_message': return 'Conversación';
    case 'file_attachment': return 'Archivo privado';
    case 'generated_document': return 'Documento comercial';
    case 'catalog_category': return 'Categoría de catálogo';
    case 'catalog_item': return 'Concepto de catálogo';
    case 'price_list':
    case 'price_list_item': return 'Lista de precios';
    case 'notification_delivery': return 'Notificación';
    case 'auth_event': return 'Identidad';
    default: return 'Actividad operativa';
  }
}

export function opaqueAuditKey(kind: 'event' | 'actor', id: string, encodedSecret: string): string {
  if (!id) throw new Error('La clave de auditoría no es válida.');
  return createHmac('sha256', hmacKey(encodedSecret)).update(`${kind}:${id}`).digest('hex').slice(0, 16);
}

export function auditActionLabel(action: string): string {
  return classifyAuditAction(action)?.label ?? 'Actividad operativa';
}

export function authEventActionLabel(eventType: string): string {
  return classifyAuthEvent(eventType)?.label ?? 'Evento de seguridad';
}

export { DEFAULT_AUDIT_TIMEZONE, MAX_RANGE_DAYS };
