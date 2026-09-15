export const QUOTE_REQUEST_STATUSES = [
  'RECIBIDA',
  'EN_REVISION',
  'INFORMACION_REQUERIDA',
  'EN_ELABORACION',
  'COTIZACION_DISPONIBLE',
  'EN_NEGOCIACION',
  'PENDIENTE_DE_APROBACION',
  'ACEPTADA',
  'RECHAZADA',
  'VENCIDA',
  'CONVERTIDA_EN_PROYECTO',
] as const;

export const QUOTE_REQUEST_PROJECT_STAGES = [
  'IDEA',
  'SITE_READY',
  'UNDER_CONSTRUCTION',
  'REMODEL',
  'EQUIPMENT_ONLY',
  'UNSURE',
] as const;

export const QUOTE_REQUEST_TIMELINES = [
  'ASAP',
  'ONE_TO_THREE_MONTHS',
  'THREE_TO_SIX_MONTHS',
  'SIX_PLUS_MONTHS',
  'UNSURE',
] as const;

export const QUOTE_REQUEST_BUDGET_RANGES = [
  'UNDER_250K',
  'FROM_250K_TO_500K',
  'FROM_500K_TO_1M',
  'OVER_1M',
  'UNSURE',
] as const;

export const QUOTE_REQUEST_INFORMATION_FIELDS = [
  'contact.email',
  'contact.phone',
  'detail.projectType',
  'detail.location',
  'detail.dimensions',
  'detail.projectStage',
  'detail.timeline',
  'detail.budgetRange',
  'detail.description',
] as const;

export const QUOTE_REQUEST_PROJECT_STAGE_LABELS: Record<(typeof QUOTE_REQUEST_PROJECT_STAGES)[number], string> = {
  IDEA: 'Idea o planeación',
  SITE_READY: 'Terreno listo',
  UNDER_CONSTRUCTION: 'En construcción',
  REMODEL: 'Remodelación',
  EQUIPMENT_ONLY: 'Sólo equipamiento',
  UNSURE: 'Por definir',
};

export const QUOTE_REQUEST_TIMELINE_LABELS: Record<(typeof QUOTE_REQUEST_TIMELINES)[number], string> = {
  ASAP: 'Lo antes posible',
  ONE_TO_THREE_MONTHS: 'En 1 a 3 meses',
  THREE_TO_SIX_MONTHS: 'En 3 a 6 meses',
  SIX_PLUS_MONTHS: 'Después de 6 meses',
  UNSURE: 'Por definir',
};

export const QUOTE_REQUEST_BUDGET_RANGE_LABELS: Record<(typeof QUOTE_REQUEST_BUDGET_RANGES)[number], string> = {
  UNDER_250K: 'Hasta $250,000 MXN',
  FROM_250K_TO_500K: '$250,000 a $500,000 MXN',
  FROM_500K_TO_1M: '$500,000 a $1,000,000 MXN',
  OVER_1M: 'Más de $1,000,000 MXN',
  UNSURE: 'Por definir',
};

export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<QuoteRequestStatus, readonly QuoteRequestStatus[]> = {
  RECIBIDA: ['EN_REVISION'],
  EN_REVISION: ['INFORMACION_REQUERIDA', 'EN_ELABORACION', 'RECHAZADA'],
  INFORMACION_REQUERIDA: ['EN_REVISION', 'EN_ELABORACION', 'RECHAZADA'],
  EN_ELABORACION: ['INFORMACION_REQUERIDA', 'COTIZACION_DISPONIBLE', 'RECHAZADA'],
  COTIZACION_DISPONIBLE: ['EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'RECHAZADA', 'VENCIDA'],
  EN_NEGOCIACION: ['EN_ELABORACION', 'PENDIENTE_DE_APROBACION', 'RECHAZADA', 'VENCIDA'],
  PENDIENTE_DE_APROBACION: ['ACEPTADA', 'RECHAZADA'],
  ACEPTADA: ['CONVERTIDA_EN_PROYECTO'],
  RECHAZADA: [],
  VENCIDA: [],
  CONVERTIDA_EN_PROYECTO: [],
};

const STAFF_OPERATIONAL_TRANSITIONS: Record<QuoteRequestStatus, readonly QuoteRequestStatus[]> = {
  RECIBIDA: ['EN_REVISION'],
  EN_REVISION: ['INFORMACION_REQUERIDA', 'EN_ELABORACION', 'RECHAZADA'],
  INFORMACION_REQUERIDA: ['EN_REVISION', 'EN_ELABORACION', 'RECHAZADA'],
  EN_ELABORACION: ['INFORMACION_REQUERIDA', 'RECHAZADA'],
  COTIZACION_DISPONIBLE: [],
  EN_NEGOCIACION: [],
  PENDIENTE_DE_APROBACION: [],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
  CONVERTIDA_EN_PROYECTO: [],
};

export function canTransitionQuoteRequest(from: QuoteRequestStatus, to: QuoteRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canStaffTransitionQuoteRequest(from: QuoteRequestStatus, to: QuoteRequestStatus): boolean {
  return STAFF_OPERATIONAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function formatQuoteRequestFolio(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('Invalid quote request folio year.');
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) throw new Error('Invalid quote request folio sequence.');
  return `OCQ-${year}-${sequence.toString().padStart(6, '0')}`;
}

export function normalizeQuoteRequestText(value: string, maxLength = 500): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > maxLength) throw new Error('Invalid quote request text.');
  return normalized;
}

export function normalizeQuoteRequestEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Invalid quote request email.');
  return normalized;
}
