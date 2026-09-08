import { describe, expect, it } from 'vitest';
import {
  QUOTE_REQUEST_STATUSES,
  canStaffTransitionQuoteRequest,
  canTransitionQuoteRequest,
  formatQuoteRequestFolio,
  normalizeQuoteRequestEmail,
  normalizeQuoteRequestText,
} from '@/server/modules/quote-requests/domain';
import { hasPermission, permissionKeysForRoles } from '@/server/auth/permissions';

describe('quote request domain contracts', () => {
  it('defines the approved lifecycle in business order', () => {
    expect(QUOTE_REQUEST_STATUSES).toEqual([
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
    ]);
  });

  it('allows only explicit transitions and keeps terminal states immutable', () => {
    expect(canTransitionQuoteRequest('RECIBIDA', 'EN_REVISION')).toBe(true);
    expect(canTransitionQuoteRequest('RECIBIDA', 'ACEPTADA')).toBe(false);
    expect(canTransitionQuoteRequest('ACEPTADA', 'EN_REVISION')).toBe(false);
    expect(canTransitionQuoteRequest('CONVERTIDA_EN_PROYECTO', 'RECHAZADA')).toBe(false);
  });

  it('keeps quote-dependent transitions closed until the quote module exists', () => {
    expect(canStaffTransitionQuoteRequest('EN_ELABORACION', 'RECHAZADA')).toBe(true);
    expect(canStaffTransitionQuoteRequest('EN_ELABORACION', 'COTIZACION_DISPONIBLE')).toBe(false);
    expect(canStaffTransitionQuoteRequest('COTIZACION_DISPONIBLE', 'EN_NEGOCIACION')).toBe(false);
  });

  it('formats a public folio without exposing the internal identifier', () => {
    expect(formatQuoteRequestFolio(2026, 1)).toBe('OCQ-2026-000001');
    expect(formatQuoteRequestFolio(2026, 42)).toBe('OCQ-2026-000042');
    expect(() => formatQuoteRequestFolio(2026, 0)).toThrow();
    expect(() => formatQuoteRequestFolio(2026, 1_000_000)).toThrow();
  });

  it('normalizes public text and email before persistence', () => {
    expect(normalizeQuoteRequestText('  Casa   Salina\n Cruz  ')).toBe('Casa Salina Cruz');
    expect(normalizeQuoteRequestEmail('  Cliente@Example.COM ')).toBe('cliente@example.com');
    expect(() => normalizeQuoteRequestText('   ')).toThrow();
  });

  it('gives sales request visibility and assignment without granting pricing approval', () => {
    const salesPermissions = permissionKeysForRoles(['sales']);
    expect(hasPermission({ permissionKeys: salesPermissions }, 'requests.read')).toBe(true);
    expect(hasPermission({ permissionKeys: salesPermissions }, 'requests.assign')).toBe(true);
    expect(hasPermission({ permissionKeys: salesPermissions }, 'quotes.approve_discount')).toBe(false);
  });
});
