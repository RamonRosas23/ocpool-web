export const DECLINE_REASON_CODES = ['PRICE', 'SCOPE', 'TIMING', 'CHOSE_OTHER', 'POSTPONED', 'OTHER'] as const;
export type DeclineReasonCode = (typeof DECLINE_REASON_CODES)[number];

export const DECLINE_REASONS: ReadonlyArray<Readonly<{ code: DeclineReasonCode; label: string }>> = [
  { code: 'PRICE', label: 'El precio' },
  { code: 'SCOPE', label: 'Lo que incluye' },
  { code: 'TIMING', label: 'Los tiempos' },
  { code: 'CHOSE_OTHER', label: 'Elegí otra opción' },
  { code: 'POSTPONED', label: 'Lo voy a posponer' },
  { code: 'OTHER', label: 'Otro motivo' },
];

const LABEL_BY_REASON = new Map(DECLINE_REASONS.map(({ code, label }) => [code, label]));
const REASON_BY_LABEL = new Map(DECLINE_REASONS.map(({ code, label }) => [label, code]));

export class DeclineRequestInputError extends Error {
  constructor(readonly code: 'INVALID_REASON' | 'INVALID_VERSION' | 'COMMENT_REQUIRED' | 'COMMENT_TOO_LONG') {
    super(code);
    this.name = 'DeclineRequestInputError';
  }
}

function validReason(reason: string): reason is DeclineReasonCode {
  return LABEL_BY_REASON.has(reason as DeclineReasonCode);
}

export function declineReasonLabel(reason: DeclineReasonCode): string {
  if (!validReason(reason)) throw new DeclineRequestInputError('INVALID_REASON');
  return LABEL_BY_REASON.get(reason)!;
}

export function normalizeDeclineComment(reason: DeclineReasonCode, comment?: string): string | null {
  if (!validReason(reason)) throw new DeclineRequestInputError('INVALID_REASON');
  if (comment !== undefined && typeof comment !== 'string') throw new DeclineRequestInputError('COMMENT_TOO_LONG');
  const normalized = comment?.trim() ?? '';
  if (reason === 'OTHER' && normalized.length === 0) throw new DeclineRequestInputError('COMMENT_REQUIRED');
  if (normalized.length > 1000) throw new DeclineRequestInputError('COMMENT_TOO_LONG');
  return normalized || null;
}

function validVersionNumber(versionNumber: number): boolean {
  return Number.isSafeInteger(versionNumber) && versionNumber > 0;
}

export function declineRequestBody(versionNumber: number, reason: DeclineReasonCode, comment?: string): string {
  if (!validVersionNumber(versionNumber)) throw new DeclineRequestInputError('INVALID_VERSION');
  const label = declineReasonLabel(reason);
  const normalizedComment = normalizeDeclineComment(reason, comment);
  return `Propuesta V${versionNumber} declinada: ${label}.${normalizedComment ? ` ${normalizedComment}` : ''}`;
}

const DECLINE_BODY = /^Propuesta V([1-9]\d*) declinada: (El precio|Lo que incluye|Los tiempos|Elegí otra opción|Lo voy a posponer|Otro motivo)\.(?: ([\s\S]*))?$/u;

export function parseDeclineRequest(body: string): { versionNumber: number; reason: DeclineReasonCode; comment: string | null } | null {
  const match = DECLINE_BODY.exec(body);
  if (!match) return null;
  const versionNumber = Number(match[1]);
  const reason = REASON_BY_LABEL.get(match[2]);
  if (!validVersionNumber(versionNumber) || !reason) return null;
  try {
    return { versionNumber, reason, comment: normalizeDeclineComment(reason, match[3]) };
  } catch {
    return null;
  }
}
