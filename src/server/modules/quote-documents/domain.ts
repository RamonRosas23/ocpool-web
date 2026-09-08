export const DOCUMENT_TYPES = ['QUOTE_PDF'] as const;
export type GeneratedDocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'READY', 'FAILED', 'DELETED'] as const;
export type GeneratedDocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const DOCUMENT_TRANSITIONS: Record<GeneratedDocumentStatus, readonly GeneratedDocumentStatus[]> = {
  PENDING: ['READY', 'FAILED'],
  READY: ['DELETED'],
  FAILED: ['PENDING', 'DELETED'],
  DELETED: [],
};

const PDF_SOURCE_STATUSES = new Set(['ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA']);

export function canTransitionGeneratedDocument(from: GeneratedDocumentStatus, to: GeneratedDocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canGenerateQuotePdf(versionStatus: string): boolean {
  return PDF_SOURCE_STATUSES.has(versionStatus);
}

export type QuoteAcceptanceEligibility = Readonly<{
  versionStatus: string;
  isCurrent: boolean;
  isExpired: boolean;
  documentStatus: GeneratedDocumentStatus;
  documentHashMatches: boolean;
}>;

export function canAcceptQuoteVersion(input: QuoteAcceptanceEligibility): boolean {
  return (input.versionStatus === 'ENVIADA' || input.versionStatus === 'EN_NEGOCIACION')
    && input.isCurrent
    && !input.isExpired
    && input.documentStatus === 'READY'
    && input.documentHashMatches;
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/gu;
const TERMS_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;

export function normalizeAcceptanceName(value: string): string {
  if (typeof value !== 'string') throw new Error('Invalid acceptance name.');
  const normalized = value.normalize('NFC').replace(CONTROL_CHARACTERS, '').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > 180) throw new Error('Invalid acceptance name.');
  return normalized;
}

export function normalizeAcceptanceTermsVersion(value: string): string {
  if (typeof value !== 'string') throw new Error('Invalid terms version.');
  const normalized = value.trim();
  if (!TERMS_VERSION_PATTERN.test(normalized)) throw new Error('Invalid terms version.');
  return normalized;
}
