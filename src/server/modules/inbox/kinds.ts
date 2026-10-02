import type { InboxCategory } from '@/lib/inbox-categories';

/**
 * Catálogo cerrado de avisos de la bandeja (spec 2026-09-29 §2.2 y §2.3). Cada tipo declara a quién
 * va (equipo o cliente) y los ÚNICOS campos de `data` que puede guardar: nada fuera de esta lista
 * llega a la base, así que un aviso nunca arrastra contenido interno por accidente.
 */
export const INBOX_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'INFO'] as const;
export type InboxPriority = (typeof INBOX_PRIORITIES)[number];
export type InboxAudience = 'STAFF' | 'CUSTOMER';

export type InboxData = Partial<{
  folio: string;
  clientName: string;
  actorName: string;
  projectType: string;
  location: string;
  messages: number;
  files: number;
  preview: string;
  versionNumber: number;
  totalLabel: string;
  reason: string;
  outcome: string;
  approvalType: string;
  approvalStatus: string;
  itemName: string;
  priceListName: string;
  requestIds: string[];
  requestFolios: string[];
  projectFolio: string;
  ownerName: string;
  fromName: string;
  toName: string;
  requestsCount: number;
  projectsCount: number;
  templateLabel: string;
}>;

export type InboxDataKey = keyof InboxData;

type InboxKindDefinition = Readonly<{ audience: InboxAudience; dataKeys: readonly InboxDataKey[] }>;

export const INBOX_KINDS = {
  'request.new_unassigned': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'projectType', 'location'] },
  'customer.activity': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'messages', 'files', 'preview'] },
  'quote.changes_requested': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'versionNumber', 'messages', 'preview'] },
  'quote.accepted': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'versionNumber', 'totalLabel'] },
  'quote.declined': { audience: 'STAFF', dataKeys: ['folio', 'actorName', 'versionNumber', 'reason'] },
  'quote.viewed': { audience: 'STAFF', dataKeys: ['folio', 'actorName', 'versionNumber'] },
  'customer.portal_activated': { audience: 'STAFF', dataKeys: ['folio', 'actorName'] },
  'request.assigned_to_you': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'projectType', 'location'] },
  'request.unassigned_from_you': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'toName'] },
  'approval.requested': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'versionNumber', 'approvalType'] },
  'approval.resolved': { audience: 'STAFF', dataKeys: ['folio', 'actorName', 'versionNumber', 'approvalType', 'approvalStatus', 'reason'] },
  'quote.returned': { audience: 'STAFF', dataKeys: ['folio', 'actorName', 'versionNumber', 'reason', 'outcome'] },
  'price.pending': { audience: 'STAFF', dataKeys: ['itemName', 'priceListName', 'requestIds', 'requestFolios'] },
  'price.assigned': { audience: 'STAFF', dataKeys: ['folio', 'itemName', 'priceListName', 'actorName'] },
  'note.internal': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'messages', 'preview'] },
  'project.assigned': { audience: 'STAFF', dataKeys: ['projectFolio', 'folio', 'clientName', 'actorName'] },
  'project.created': { audience: 'STAFF', dataKeys: ['projectFolio', 'folio', 'clientName', 'actorName', 'ownerName'] },
  'team.work_reassigned': { audience: 'STAFF', dataKeys: ['fromName', 'actorName', 'requestsCount', 'projectsCount'] },
  'email.delivery_failed': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'templateLabel'] },
  'request.closed': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'reason'] },
  'request.reopened': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName'] },
  'team.activity': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType', 'messages', 'files', 'preview'] },
  'request.information_needed': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType', 'preview'] },
  'quote.ready': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType', 'versionNumber', 'totalLabel'] },
  'project.started': { audience: 'CUSTOMER', dataKeys: ['projectFolio', 'folio', 'ownerName'] },
  'request.received': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType'] },
  'reminder.customer_waiting': { audience: 'STAFF', dataKeys: ['folio', 'clientName'] },
  'reminder.customer_waiting_escalated': { audience: 'STAFF', dataKeys: ['folio', 'clientName'] },
  'reminder.unassigned': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'projectType', 'location'] },
  'reminder.approval_pending': { audience: 'STAFF', dataKeys: ['folio', 'versionNumber', 'approvalType'] },
  'reminder.quote_expiring': { audience: 'CUSTOMER', dataKeys: ['folio', 'versionNumber'] },
  'reminder.quote_expired': { audience: 'STAFF', dataKeys: ['folio', 'versionNumber'] },
  'reminder.follow_up': { audience: 'STAFF', dataKeys: ['folio', 'clientName'] },
} as const satisfies Record<string, InboxKindDefinition>;

export type InboxKind = keyof typeof INBOX_KINDS;

/** Filtro "tipo" de la página de notificaciones (spec §5.2). Un tipo nuevo no compila sin su categoría. */
export const INBOX_KIND_CATEGORY: Readonly<Record<InboxKind, InboxCategory>> = {
  'request.new_unassigned': 'requests',
  'customer.activity': 'activity',
  'quote.changes_requested': 'quotes',
  'quote.accepted': 'quotes',
  'quote.declined': 'quotes',
  'quote.viewed': 'activity',
  'customer.portal_activated': 'activity',
  'request.assigned_to_you': 'requests',
  'request.unassigned_from_you': 'requests',
  'approval.requested': 'quotes',
  'approval.resolved': 'quotes',
  'quote.returned': 'quotes',
  'price.pending': 'prices',
  'price.assigned': 'prices',
  'note.internal': 'activity',
  'project.assigned': 'projects',
  'project.created': 'projects',
  'team.work_reassigned': 'requests',
  'email.delivery_failed': 'email',
  'request.closed': 'requests',
  'request.reopened': 'requests',
  'team.activity': 'activity',
  'request.information_needed': 'requests',
  'quote.ready': 'quotes',
  'project.started': 'projects',
  'request.received': 'requests',
  'reminder.customer_waiting': 'requests',
  'reminder.customer_waiting_escalated': 'requests',
  'reminder.unassigned': 'requests',
  'reminder.approval_pending': 'quotes',
  'reminder.quote_expiring': 'quotes',
  'reminder.quote_expired': 'quotes',
  'reminder.follow_up': 'requests',
};

export function inboxKindsInCategory(category: InboxCategory): InboxKind[] {
  return (Object.keys(INBOX_KIND_CATEGORY) as InboxKind[]).filter((kind) => INBOX_KIND_CATEGORY[kind] === category);
}

/** Lo único que un aviso para el cliente puede guardar. La prueba del catálogo lo hace cumplir. */
export const INBOX_CUSTOMER_SAFE_KEYS: readonly InboxDataKey[] = ['folio', 'projectType', 'messages', 'files', 'preview', 'versionNumber', 'totalLabel', 'projectFolio', 'ownerName'];

export function isInboxKind(value: string): value is InboxKind {
  return Object.prototype.hasOwnProperty.call(INBOX_KINDS, value);
}

export function inboxAudience(kind: InboxKind): InboxAudience {
  return INBOX_KINDS[kind].audience;
}

const NUMBER_KEYS: ReadonlySet<InboxDataKey> = new Set(['messages', 'files', 'versionNumber', 'requestsCount', 'projectsCount']);
const LIST_KEYS: ReadonlySet<InboxDataKey> = new Set(['requestIds', 'requestFolios']);
const TEXT_LIMITS: Partial<Record<InboxDataKey, number>> = { reason: 300 };
const DEFAULT_TEXT_LIMIT = 180;
const MAX_LIST_ENTRIES = 50;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function cleanText(value: string, limit: number): string | undefined {
  const flat = value.replace(CONTROL_CHARACTERS, '').replace(/\s+/gu, ' ').trim();
  if (!flat) return undefined;
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

/** Deja sólo los campos permitidos del tipo, con textos acotados y números enteros no negativos. */
export function sanitizeInboxData(kind: InboxKind, data: InboxData): InboxData {
  const result: Record<string, unknown> = {};
  const source = data as Record<string, unknown>;
  for (const key of INBOX_KINDS[kind].dataKeys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (NUMBER_KEYS.has(key)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) result[key] = value;
      continue;
    }
    if (LIST_KEYS.has(key)) {
      if (Array.isArray(value)) result[key] = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length <= 64).slice(0, MAX_LIST_ENTRIES);
      continue;
    }
    if (typeof value === 'string') {
      const text = cleanText(value, TEXT_LIMITS[key] ?? DEFAULT_TEXT_LIMIT);
      if (text) result[key] = text;
    }
  }
  return result as InboxData;
}
