import { describe, expect, it } from 'vitest';
import { DECLINE_REASON_CODES, DECLINE_REASONS, declineReasonLabel, declineRequestBody, normalizeDeclineComment, parseDeclineRequest, type DeclineReasonCode } from '@/lib/decline-request';

describe('customer quote decline messages', () => {
  it('keeps the approved reasons and Spanish labels in their fixed order', () => {
    expect(DECLINE_REASON_CODES).toEqual(['PRICE', 'SCOPE', 'TIMING', 'CHOSE_OTHER', 'POSTPONED', 'OTHER']);
    expect(DECLINE_REASONS).toEqual([
      { code: 'PRICE', label: 'El precio' },
      { code: 'SCOPE', label: 'Lo que incluye' },
      { code: 'TIMING', label: 'Los tiempos' },
      { code: 'CHOSE_OTHER', label: 'Elegí otra opción' },
      { code: 'POSTPONED', label: 'Lo voy a posponer' },
      { code: 'OTHER', label: 'Otro motivo' },
    ]);
    for (const { code, label } of DECLINE_REASONS) expect(declineReasonLabel(code)).toBe(label);
  });

  it('trims comments, permits an omitted optional comment, and requires one for OTHER', () => {
    expect(normalizeDeclineComment('PRICE', '  Se sale del presupuesto  ')).toBe('Se sale del presupuesto');
    expect(normalizeDeclineComment('SCOPE')).toBeNull();
    expect(normalizeDeclineComment('OTHER', '  Otro proveedor ofrece instalación  ')).toBe('Otro proveedor ofrece instalación');
    expect(() => normalizeDeclineComment('OTHER', '   ')).toThrow();
  });

  it('limits the normalized comment to 1000 characters', () => {
    expect(normalizeDeclineComment('PRICE', ` ${'x'.repeat(1000)} `)).toHaveLength(1000);
    expect(() => normalizeDeclineComment('PRICE', 'x'.repeat(1001))).toThrow();
  });

  it('builds and parses only the fixed per-version decline prefix', () => {
    expect(declineRequestBody(2, 'PRICE')).toBe('Propuesta V2 declinada: El precio.');
    expect(declineRequestBody(2, 'OTHER', '  Cambió el presupuesto  ')).toBe('Propuesta V2 declinada: Otro motivo. Cambió el presupuesto');
    expect(parseDeclineRequest('Propuesta V2 declinada: El precio.')).toEqual({ versionNumber: 2, reason: 'PRICE', comment: null });
    expect(parseDeclineRequest('Propuesta V2 declinada: Otro motivo. Cambió el presupuesto')).toEqual({ versionNumber: 2, reason: 'OTHER', comment: 'Cambió el presupuesto' });
    expect(parseDeclineRequest(declineRequestBody(2, 'OTHER', 'Presupuesto\najustado'))).toEqual({ versionNumber: 2, reason: 'OTHER', comment: 'Presupuesto\najustado' });
    expect(parseDeclineRequest('El cliente pregunta por el envío')).toBeNull();
  });

  it('rejects unknown reasons, invalid versions, missing OTHER comments, and overlong comments', () => {
    expect(() => declineReasonLabel('UNKNOWN' as DeclineReasonCode)).toThrow();
    expect(() => declineRequestBody(0, 'PRICE')).toThrow();
    expect(() => declineRequestBody(1.5, 'PRICE')).toThrow();
    expect(() => declineRequestBody(1, 'OTHER')).toThrow();
    expect(parseDeclineRequest('Propuesta V1 declinada: Motivo desconocido.')).toBeNull();
    expect(parseDeclineRequest('Propuesta V0 declinada: El precio.')).toBeNull();
    expect(parseDeclineRequest('Propuesta V1 declinada: Otro motivo.')).toBeNull();
    expect(parseDeclineRequest(`Propuesta V1 declinada: El precio. ${'x'.repeat(1001)}`)).toBeNull();
  });
});
