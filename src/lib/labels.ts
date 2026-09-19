import { CheckCircle2, Clock, XCircle, type LucideIcon } from 'lucide-react';
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
