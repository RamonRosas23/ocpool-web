import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_STATUSES,
  canGenerateQuotePdf,
  canTransitionGeneratedDocument,
  canAcceptQuoteVersion,
  CURRENT_QUOTE_TERMS_LABEL,
  CURRENT_QUOTE_TERMS_VERSION,
  isCurrentQuoteTermsVersion,
  normalizeAcceptanceName,
  normalizeAcceptanceTermsVersion,
  type GeneratedDocumentStatus,
} from '@/server/modules/quote-documents/domain';

describe('quote documents and acceptance domain', () => {
  it('allows only monotonic generated-document lifecycle transitions', () => {
    expect(DOCUMENT_STATUSES).toEqual(['PENDING', 'READY', 'FAILED', 'DELETED']);
    expect(canTransitionGeneratedDocument('PENDING', 'READY')).toBe(true);
    expect(canTransitionGeneratedDocument('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionGeneratedDocument('READY', 'FAILED')).toBe(false);
    expect(canTransitionGeneratedDocument('READY', 'DELETED')).toBe(true);
    expect(canTransitionGeneratedDocument('FAILED', 'PENDING')).toBe(true);
    expect(canTransitionGeneratedDocument('DELETED', 'READY')).toBe(false);
    expect(canTransitionGeneratedDocument('PENDING' as GeneratedDocumentStatus, 'PENDING')).toBe(false);
  });

  it('renders PDFs during review so publication can verify the document first', () => {
    expect(canGenerateQuotePdf('BORRADOR')).toBe(false);
    expect(canGenerateQuotePdf('EN_REVISION')).toBe(true);
    expect(canGenerateQuotePdf('ENVIADA')).toBe(true);
    expect(canGenerateQuotePdf('ACEPTADA')).toBe(true);
  });

  it('accepts only current, sent and unexpired versions with a ready matching document', () => {
    expect(canAcceptQuoteVersion({ versionStatus: 'ENVIADA', isCurrent: true, isExpired: false, documentStatus: 'READY', documentHashMatches: true })).toBe(true);
    expect(canAcceptQuoteVersion({ versionStatus: 'EN_NEGOCIACION', isCurrent: true, isExpired: false, documentStatus: 'READY', documentHashMatches: true })).toBe(true);
    expect(canAcceptQuoteVersion({ versionStatus: 'ACEPTADA', isCurrent: true, isExpired: false, documentStatus: 'READY', documentHashMatches: true })).toBe(false);
    expect(canAcceptQuoteVersion({ versionStatus: 'ENVIADA', isCurrent: false, isExpired: false, documentStatus: 'READY', documentHashMatches: true })).toBe(false);
    expect(canAcceptQuoteVersion({ versionStatus: 'ENVIADA', isCurrent: true, isExpired: true, documentStatus: 'READY', documentHashMatches: true })).toBe(false);
    expect(canAcceptQuoteVersion({ versionStatus: 'ENVIADA', isCurrent: true, isExpired: false, documentStatus: 'PENDING', documentHashMatches: true })).toBe(false);
    expect(canAcceptQuoteVersion({ versionStatus: 'ENVIADA', isCurrent: true, isExpired: false, documentStatus: 'READY', documentHashMatches: false })).toBe(false);
  });

  it('normalizes a signer name and a bounded terms version', () => {
    expect(normalizeAcceptanceName('  Ana   López  Rivera ')).toBe('Ana López Rivera');
    expect(normalizeAcceptanceTermsVersion('  quote-terms-2026-01 ')).toBe('quote-terms-2026-01');
    expect(() => normalizeAcceptanceName('')).toThrow();
    expect(() => normalizeAcceptanceName('a'.repeat(181))).toThrow();
    expect(() => normalizeAcceptanceTermsVersion('terms with spaces')).toThrow();
    expect(CURRENT_QUOTE_TERMS_VERSION).toBe('quote-terms-2026-01');
    expect(CURRENT_QUOTE_TERMS_LABEL).toBe('Condiciones comerciales de la propuesta · versión 2026-01');
    expect(isCurrentQuoteTermsVersion('quote-terms-2026-01')).toBe(true);
    expect(isCurrentQuoteTermsVersion('quote-terms-2025-12')).toBe(false);
  });
});
