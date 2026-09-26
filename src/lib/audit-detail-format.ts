import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_VERSION_STATUS_LABELS } from '@/lib/labels';
import { formatDate } from '@/lib/format-date';

// El servidor proyecta cada detalle de auditoría como `{ label, value }` con el valor tal cual quedó
// guardado (enums, ISO, importes en unidades mínimas, bytes) -- es la forma estable que ya consumen
// las pruebas de dominio y la API. La lectura humana se resuelve aquí, sólo para la vista: un
// gerente que audita necesita "En revisión → Enviada" y "$150.00", no "EN_REVISION" ni "15000".

type AuditDetail = { label: string; value: string };

const STATUS_LABELS: Record<string, string> = {
  ...QUOTE_VERSION_STATUS_LABELS,
  ...QUOTE_REQUEST_STATUS_LABELS,
  ACTIVE: 'Activo',
  ARCHIVED: 'Archivado',
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  PENDING: 'Pendiente',
  PROCESSING: 'En proceso',
  SENT: 'Enviada',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
  EN_TRANSICION: 'En transición',
  COMPLETADO: 'Completado',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  Origen: { PUBLIC_FORM: 'Formulario público', STAFF_CREATED: 'Creada por staff' },
  Resultado: { INVITED: 'Invitación enviada', ALREADY_PENDING: 'Invitación ya vigente', ALREADY_ACTIVE: 'Acceso reenviado' },
  Visibilidad: { SHARED: 'Compartido con el cliente', INTERNAL: 'Nota interna' },
  Tipo: { DISCOUNT: 'Descuento', PRICE_OVERRIDE: 'Ajuste de precio', SPECIAL_CONCEPT: 'Concepto especial' },
  Categoría: { REFERENCE_IMAGE: 'Referencia', TECHNICAL_DOCUMENT: 'Técnico', CLIENT_DOCUMENT: 'Cliente', INTERNAL_DOCUMENT: 'Interno' },
  'Origen del cambio': { 'quote.version.status_changed': 'Cambio de estado de la cotización', manual: 'Cambio manual' },
};

const RELABEL: Record<string, string> = {
  'Importe mínimo': 'Importe',
  'Tamaño en bytes': 'Tamaño',
  'Vigencia en segundos': 'Vigencia del enlace',
};

function formatMinorUnits(value: string): string | null {
  if (!/^-?\d+$/u.test(value)) return null;
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = new Intl.NumberFormat('es-MX').format(absolute / 100n);
  return `${negative ? '−' : ''}$${whole}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function formatBytes(value: string): string | null {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`;
}

function formatSeconds(value: string): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(minutes / 60)} h`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/u;

export function formatAuditDetail(detail: AuditDetail, timezone?: string): AuditDetail {
  const label = RELABEL[detail.label] ?? detail.label;
  const { value } = detail;
  if (detail.label === 'Importe mínimo') return { label, value: formatMinorUnits(value) ?? value };
  if (detail.label === 'Tamaño en bytes') return { label, value: formatBytes(value) ?? value };
  if (detail.label === 'Vigencia en segundos') return { label, value: formatSeconds(value) ?? value };
  if (/^Estado/u.test(detail.label) && STATUS_LABELS[value]) return { label, value: STATUS_LABELS[value] };
  const mapped = VALUE_LABELS[detail.label]?.[value];
  if (mapped) return { label, value: mapped };
  if (ISO_DATE.test(value)) return { label, value: formatDate(value, timezone, value) };
  return { label, value };
}
