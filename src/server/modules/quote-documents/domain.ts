export const DOCUMENT_TYPES = ['QUOTE_PDF'] as const;
export type GeneratedDocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'READY', 'FAILED', 'DELETED'] as const;
export type GeneratedDocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * The terms identifier is deliberately owned by the server. The browser may
 * display and submit this value, but it can never select an arbitrary set of
 * terms for an acceptance record.
 */
export const CURRENT_QUOTE_TERMS_VERSION = 'quote-terms-2026-01' as const;
export const CURRENT_QUOTE_TERMS_LABEL = 'Condiciones comerciales de la propuesta · versión 2026-01' as const;

export function getCurrentQuoteTermsVersion(): typeof CURRENT_QUOTE_TERMS_VERSION {
  return CURRENT_QUOTE_TERMS_VERSION;
}

export function getCurrentQuoteTermsLabel(): typeof CURRENT_QUOTE_TERMS_LABEL {
  return CURRENT_QUOTE_TERMS_LABEL;
}

const DOCUMENT_TRANSITIONS: Record<GeneratedDocumentStatus, readonly GeneratedDocumentStatus[]> = {
  PENDING: ['READY', 'FAILED'],
  READY: ['DELETED'],
  FAILED: ['PENDING', 'DELETED'],
  DELETED: [],
};

const PDF_SOURCE_STATUSES = new Set(['EN_REVISION', 'ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA']);

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

export function isCurrentQuoteTermsVersion(value: string): boolean {
  return value === CURRENT_QUOTE_TERMS_VERSION;
}

export type GeneratedDocumentInvariantInput = Readonly<{
  status: string;
  contentType: string;
  byteSize: bigint | null;
  sha256: string | null;
  readyAt: Date | null;
  deletedAt: Date | null;
  storageObject: Readonly<{
    contentType: string;
    byteSize: bigint;
    sha256: string | null;
    scanStatus: string;
    deletedAt: Date | null;
  }> | null;
}>;

export function isGeneratedQuotePdfReady(document: GeneratedDocumentInvariantInput | null | undefined): boolean {
  return Boolean(
    document
      && document.status === 'READY'
      && document.contentType === 'application/pdf'
      && document.byteSize
      && document.byteSize > 0n
      && document.sha256
      && document.readyAt
      && !document.deletedAt
      && document.storageObject
      && document.storageObject.contentType === 'application/pdf'
      && document.storageObject.byteSize === document.byteSize
      && document.storageObject.sha256 === document.sha256
      && document.storageObject.scanStatus === 'PASSED'
      && !document.storageObject.deletedAt,
  );
}

/**
 * Presentation-level document state for a workspace projection. A READY document that fails the
 * integrity checks in isGeneratedQuotePdfReady degrades to FAILED rather than a silent "ready".
 */
export function deriveGeneratedDocumentState(document: GeneratedDocumentInvariantInput | null | undefined): 'NOT_CREATED' | 'PENDING' | 'READY' | 'FAILED' {
  if (!document || document.deletedAt) return 'NOT_CREATED';
  if (document.status === 'READY') return isGeneratedQuotePdfReady(document) ? 'READY' : 'FAILED';
  if (document.status === 'PENDING') return 'PENDING';
  return 'FAILED';
}
