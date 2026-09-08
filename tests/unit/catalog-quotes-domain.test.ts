import { describe, expect, it } from 'vitest';
import {
  MAX_MONEY_MINOR_UNITS,
  QUOTE_VERSION_STATUSES,
  addMoney,
  buildQuoteVersionSnapshot,
  calculateLineTotals,
  canTransitionQuoteVersion,
  createMoney,
  isQuoteVersionImmutable,
  normalizeBasisPoints,
  normalizeCurrencyCode,
  parseMinorUnits,
  parseQuantity,
  subtractMoney,
} from '@/server/modules/quotes/domain';
import { hasPermission, permissionKeysForRoles } from '@/server/auth/permissions';

describe('catalog and quote domain contracts', () => {
  it('accepts only explicit currency and integer minor-unit amounts', () => {
    expect(normalizeCurrencyCode(' mxn ')).toBe('MXN');
    expect(parseMinorUnits('10050')).toBe(10050n);
    expect(createMoney('10050', 'MXN')).toEqual({ amountMinor: 10050n, currency: 'MXN' });
    expect(() => normalizeCurrencyCode('MX')).toThrow();
    expect(() => parseMinorUnits('10.50')).toThrow();
    expect(() => createMoney(10.5 as never, 'MXN')).toThrow();
  });

  it('rejects negative and overflowing money while preserving currency invariants', () => {
    expect(() => createMoney('-1', 'MXN')).toThrow();
    expect(() => createMoney((MAX_MONEY_MINOR_UNITS + 1n).toString(), 'MXN')).toThrow();
    expect(() => addMoney(createMoney(MAX_MONEY_MINOR_UNITS, 'MXN'), createMoney('1', 'MXN'))).toThrow();
    expect(addMoney(createMoney('100', 'MXN'), createMoney('50', 'MXN'))).toEqual({ amountMinor: 150n, currency: 'MXN' });
    expect(subtractMoney(createMoney('100', 'MXN'), createMoney('40', 'MXN'))).toEqual({ amountMinor: 60n, currency: 'MXN' });
    expect(() => addMoney(createMoney('100', 'MXN'), createMoney('1', 'USD'))).toThrow();
    expect(() => subtractMoney(createMoney('40', 'MXN'), createMoney('100', 'MXN'))).toThrow();
  });

  it('uses fixed-point quantities and half-up rounding for line calculations', () => {
    const line = calculateLineTotals({
      quantity: parseQuantity('1.500'),
      unitPrice: createMoney('1000', 'MXN'),
      discountBasisPoints: 1000,
      taxBasisPoints: 1600,
    });

    expect(line).toMatchObject({
      subtotal: { amountMinor: 1500n, currency: 'MXN' },
      discount: { amountMinor: 150n, currency: 'MXN' },
      taxable: { amountMinor: 1350n, currency: 'MXN' },
      tax: { amountMinor: 216n, currency: 'MXN' },
      total: { amountMinor: 1566n, currency: 'MXN' },
    });
    expect(() => parseQuantity('0')).toThrow();
    expect(() => parseQuantity('-1')).toThrow();
    expect(() => parseQuantity('1.0001')).toThrow();
    expect(normalizeBasisPoints('1600')).toBe(1600);
    expect(() => normalizeBasisPoints(10001)).toThrow();

    const roundedHalfUp = calculateLineTotals({
      quantity: parseQuantity('1'),
      unitPrice: createMoney('1', 'MXN'),
      discountBasisPoints: 5000,
    });
    expect(roundedHalfUp.discount.amountMinor).toBe(1n);
    expect(calculateLineTotals({ quantity: parseQuantity('1'), unitPrice: createMoney('0', 'MXN') }).total.amountMinor).toBe(0n);
  });

  it('creates an immutable version snapshot from catalog values and calculated totals', () => {
    const snapshot = buildQuoteVersionSnapshot([
      {
        catalogItemId: 'item-1',
        catalogItemCode: 'BOMBA-01',
        name: 'Bomba de filtrado',
        description: 'Descripción original',
        unit: 'pieza',
        quantity: parseQuantity('2'),
        unitPrice: createMoney('125000', 'MXN'),
        discountBasisPoints: 0,
        taxBasisPoints: 1600,
      },
    ]);

    expect(snapshot.currency).toBe('MXN');
    expect(snapshot.total.amountMinor).toBe(290000n);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.lines)).toBe(true);
    expect(Object.isFrozen(snapshot.lines[0])).toBe(true);
    expect(() => buildQuoteVersionSnapshot([])).toThrow();
    expect(() => buildQuoteVersionSnapshot([
      {
        catalogItemId: 'item-2',
        catalogItemCode: 'USD-01',
        name: 'Concepto incompatible',
        unit: 'pieza',
        quantity: parseQuantity('1'),
        unitPrice: createMoney('100', 'USD'),
      },
      {
        catalogItemId: 'item-3',
        catalogItemCode: 'MXN-01',
        name: 'Concepto incompatible',
        unit: 'pieza',
        quantity: parseQuantity('1'),
        unitPrice: createMoney('100', 'MXN'),
      },
    ])).toThrow();
  });

  it('keeps acceptance unavailable until explicit acceptance evidence exists', () => {
    expect(QUOTE_VERSION_STATUSES).toEqual([
      'BORRADOR',
      'EN_REVISION',
      'ENVIADA',
      'EN_NEGOCIACION',
      'ACEPTADA',
      'RECHAZADA',
      'VENCIDA',
    ]);
    expect(canTransitionQuoteVersion('BORRADOR', 'EN_REVISION')).toBe(true);
    expect(canTransitionQuoteVersion('ENVIADA', 'ACEPTADA')).toBe(false);
    expect(canTransitionQuoteVersion('ENVIADA', 'ACEPTADA', { acceptanceEvidence: true })).toBe(true);
    expect(canTransitionQuoteVersion('ACEPTADA', 'EN_REVISION')).toBe(false);
    expect(isQuoteVersionImmutable('BORRADOR')).toBe(false);
    expect(isQuoteVersionImmutable('ENVIADA')).toBe(true);
  });

  it('separates catalog and price administration from quote editing permissions', () => {
    const sales = permissionKeysForRoles(['sales']);
    const manager = permissionKeysForRoles(['manager']);
    expect(hasPermission({ permissionKeys: sales }, 'catalog.read')).toBe(true);
    expect(hasPermission({ permissionKeys: sales }, 'prices.read')).toBe(true);
    expect(hasPermission({ permissionKeys: sales }, 'catalog.manage')).toBe(false);
    expect(hasPermission({ permissionKeys: sales }, 'prices.manage')).toBe(false);
    expect(hasPermission({ permissionKeys: manager }, 'catalog.manage')).toBe(true);
    expect(hasPermission({ permissionKeys: manager }, 'prices.manage')).toBe(true);
  });
});
