import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { publishRealtime, type RequestPart, type RequestVisibility } from '@/server/realtime/publish';
import { uuidOf } from './audience';
import type { DomainEventInput } from './rules/types';

type Payload = Readonly<Record<string, unknown>>;
type RequestSignalRule = Readonly<{ parts: readonly RequestPart[]; visibility: RequestVisibility | ((payload: Payload) => RequestVisibility) }>;

export type RequestSignalIntent = Readonly<{ requestId: string; parts: readonly RequestPart[]; visibility: RequestVisibility; previousAssigneeId: string | null }>;

const byVisibilityField = (payload: Payload): RequestVisibility => (payload.visibility === 'INTERNAL' ? 'I' : 'C');
const SENT_VERSION_STATUSES: ReadonlySet<string> = new Set(['ENVIADA', 'EN_NEGOCIACION']);

/**
 * Qué parte del expediente cambia con cada evento y si el cliente puede verla (spec §4.1). `null` = el evento no
 * cambia nada que una pantalla de expediente muestre. Una prueba recorre el código y exige que cada tipo esté aquí.
 */
export const REQUEST_SIGNAL_RULES: Readonly<Record<string, RequestSignalRule | null>> = {
  'REQUEST.RECEIVED': { parts: ['created'], visibility: 'C' },
  'REQUEST.ASSIGNED': { parts: ['assignment'], visibility: 'I' },
  'REQUEST.STATUS_CHANGED': { parts: ['status'], visibility: 'C' },
  'REQUEST.CUSTOMER_RESPONSE': { parts: ['status'], visibility: 'I' },
  'MESSAGE.CREATED': { parts: ['messages'], visibility: byVisibilityField },
  'CONVERSATION.STATUS_CHANGED': { parts: ['messages'], visibility: 'C' },
  'FILE.AVAILABLE': { parts: ['files'], visibility: byVisibilityField },
  'FILE.DELETED': { parts: ['files'], visibility: byVisibilityField },
  'FILE.UPLOAD_RESERVED': null,
  'FILE.RESERVATION_EXPIRED': null,
  'QUOTE.VERSION_CREATED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_UPDATED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_SUBMITTED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_REOPENED': { parts: ['quote', 'approvals'], visibility: 'I' },
  'QUOTE.VERSION_STATUS_CHANGED': { parts: ['quote'], visibility: 'I' },
  // Rechazar una versión que el cliente ya tenía cambia su propuesta; rechazarla en revisión, no.
  'QUOTE.VERSION_REJECTED': { parts: ['quote'], visibility: (payload) => (SENT_VERSION_STATUSES.has(String(payload.fromStatus)) ? 'C' : 'I') },
  'QUOTE.PUBLISHED': { parts: ['quote'], visibility: 'C' },
  'QUOTE.PDF_READY': { parts: ['quote'], visibility: 'I' },
  'QUOTE.APPROVAL_REQUESTED': { parts: ['approvals'], visibility: 'I' },
  'QUOTE.APPROVAL_RESOLVED': { parts: ['approvals', 'quote'], visibility: 'I' },
  'QUOTE.ACCEPTED': { parts: ['quote', 'status'], visibility: 'C' },
  'QUOTE.DECLINED': { parts: ['quote', 'status'], visibility: 'C' },
  'QUOTE.VIEWED': null,
  'CUSTOMER.PORTAL_ACTIVATED': null,
  'PROJECT.CREATED': { parts: ['project'], visibility: 'C' },
  'PROJECT.OWNER_CHANGED': null,
  'TEAM.WORK_REASSIGNED': null,
  'PRICES.PENDING_RESOLVED': null,
  'PRICES.ITEM_CREATED': null,
  'PRICES.ITEM_SCHEDULED': null,
  'PRICES.ITEM_UPDATED': null,
  'PRICES.LIST_CREATED': null,
  'PRICES.LIST_UPDATED': null,
  'CATALOG.CATEGORY_CREATED': null,
  'CATALOG.CATEGORY_UPDATED': null,
  'CATALOG.ITEM_CREATED': null,
  'CATALOG.ITEM_UPDATED': null,
  'CATALOG.SPECIAL_CONCEPT_PROMOTED': null,
  'EMAIL.DELIVERY_FAILED': null,
  'EMAIL.DELIVERY_RECOVERED': null,
  'AUTH.CUSTOMER_MAGIC_LINK': null,
  'AUTH.EMPLOYEE_INVITATION': null,
  'AUTH.EMPLOYEE_PASSWORD_RESET': null,
};

export function requestSignalFor(event: Pick<DomainEventInput, 'eventType' | 'aggregateType' | 'aggregateId' | 'payload'>): RequestSignalIntent | null {
  const rule = REQUEST_SIGNAL_RULES[event.eventType];
  if (!rule) return null;
  const requestId = uuidOf(event.payload.quoteRequestId) ?? (event.aggregateType === 'QUOTE_REQUEST' ? uuidOf(event.aggregateId) : null);
  if (!requestId) return null;
  const visibility = typeof rule.visibility === 'function' ? rule.visibility(event.payload) : rule.visibility;
  return { requestId, parts: rule.parts, visibility, previousAssigneeId: uuidOf(event.payload.previousAssigneeId) };
}

export type RequestChangeInput = Readonly<{
  requestId: string;
  parts: readonly RequestPart[];
  visibility: RequestVisibility;
  actorId?: string | null;
  previousAssigneeId?: string | null;
}>;

/** Publica `r` con el cliente y el responsable vigentes. Dentro de una transacción, sale al confirmar. */
export async function publishRequestChange(client: PrismaClient | Prisma.TransactionClient, input: RequestChangeInput): Promise<void> {
  const request = await client.quoteRequest.findUnique({ where: { id: input.requestId }, select: { clientId: true, currentAssigneeId: true } });
  if (!request) return;
  const previous = input.previousAssigneeId && input.previousAssigneeId !== request.currentAssigneeId ? input.previousAssigneeId : null;
  await publishRealtime(client, {
    t: 'r',
    r: input.requestId,
    c: request.clientId,
    a: request.currentAssigneeId,
    ...(previous ? { pa: previous } : {}),
    ...(input.actorId ? { b: input.actorId } : {}),
    p: input.parts,
    v: input.visibility,
  });
}
