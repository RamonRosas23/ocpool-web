import { describe, expect, it } from 'vitest';
import { moneyInputLabel, parseMoneyInput } from '@/lib/money-input';

describe('money input helpers', () => {
  it('formats minor units with thousands separators for editing', () => {
    expect(moneyInputLabel('12580000')).toBe('125,800.00');
    expect(moneyInputLabel('15000')).toBe('150.00');
    expect(moneyInputLabel('5')).toBe('0.05');
    expect(moneyInputLabel('123456789012')).toBe('1,234,567,890.12');
    expect(moneyInputLabel('abc')).toBe('');
  });

  it('round-trips every label it produces', () => {
    for (const minor of ['0', '5', '15000', '12580000', '123456789012']) {
      expect(parseMoneyInput(moneyInputLabel(minor))).toBe(minor);
    }
  });

  it('parses user input with or without separators and rejects invalid amounts', () => {
    expect(parseMoneyInput('1,250.5')).toBe('125050');
    expect(parseMoneyInput('1250')).toBe('125000');
    expect(parseMoneyInput('12.345')).toBeNull();
    expect(parseMoneyInput('-5')).toBeNull();
  });
});
