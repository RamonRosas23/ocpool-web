import { AlertTriangle, CheckCircle2, Circle, Clock, MinusCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { QuoteRequestStatus } from '@/server/modules/quote-requests/domain';
import type { QuoteVersionStatus } from '@/server/modules/quotes/domain';

export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  RECIBIDA: 'Recibida',
  EN_REVISION: 'En revisión',
  INFORMACION_REQUERIDA: 'Información requerida',
  EN_ELABORACION: 'En elaboración',
  COTIZACION_DISPONIBLE: 'Cotización disponible',
  EN_NEGOCIACION: 'En negociación',
  PENDIENTE_DE_APROBACION: 'Pendiente de aprobación',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
  CONVERTIDA_EN_PROYECTO: 'Convertida en proyecto',
};

export const QUOTE_VERSION_STATUS_LABELS: Record<QuoteVersionStatus, string> = {
  BORRADOR: 'Borrador',
  EN_REVISION: 'En revisión',
  ENVIADA: 'Enviada',
  EN_NEGOCIACION: 'En negociación',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
};

export function fileStatusLabel(file: { status: string; downloadAvailable: boolean }): string {
  if (file.status === 'AVAILABLE' && file.downloadAvailable) return 'Disponible';
  if (file.status === 'PENDING_SCAN') return 'En validación';
  // REJECTED (failed the content scan, never became available) and DELETED (was available, then
  // removed) both used to collapse into the same generic "No disponible" -- indistinguishable to
  // whoever is looking at the file, even though they mean very different things: one might need a
  // different file re-uploaded, the other is an expected, intentional removal.
  if (file.status === 'REJECTED') return 'Rechazado';
  if (file.status === 'DELETED') return 'Eliminado';
  return 'No disponible';
}

export function fileStatusIcon(file: { status: string; downloadAvailable: boolean }): LucideIcon {
  if (file.status === 'AVAILABLE' && file.downloadAvailable) return CheckCircle2;
  if (file.status === 'PENDING_SCAN') return Clock;
  return XCircle;
}

export function fileCategoryLabel(category: string): string {
  return { REFERENCE_IMAGE: 'Referencia', TECHNICAL_DOCUMENT: 'Técnico', CLIENT_DOCUMENT: 'Cliente', INTERNAL_DOCUMENT: 'Interno' }[category] ?? 'Documento';
}

const DANGER_STATUS_KEYS = new Set(['rechazada', 'vencida', 'failed']);
const WARNING_STATUS_KEYS = new Set(['recibida', 'pending', 'pending_scan']);
const SUCCESS_STATUS_KEYS = new Set(['aceptada', 'sent', 'convertida_en_proyecto']);
const MUTED_STATUS_KEYS = new Set(['cancelled']);

const TONE_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle2, muted: MinusCircle, accent: Circle } as const satisfies Record<string, LucideIcon>;

/** Maps the lowercased status/notification-status key already used for the `--{key}` CSS modifier (e.g. `staff-status-pill--rechazada`) to the same tone the CSS already assigns it. */
export function statusToneIcon(statusKey: string): LucideIcon {
  const key = statusKey.toLowerCase();
  if (DANGER_STATUS_KEYS.has(key)) return TONE_ICONS.danger;
  if (WARNING_STATUS_KEYS.has(key)) return TONE_ICONS.warning;
  if (SUCCESS_STATUS_KEYS.has(key)) return TONE_ICONS.success;
  if (MUTED_STATUS_KEYS.has(key)) return TONE_ICONS.muted;
  return TONE_ICONS.accent;
}
