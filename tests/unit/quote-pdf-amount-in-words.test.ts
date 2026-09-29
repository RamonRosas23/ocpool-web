import { describe, expect, it } from 'vitest';
import { amountInWords, integerToSpanishWords } from '@/server/modules/quote-documents/amount-in-words';

describe('importe con letra', () => {
  it.each([
    [0n, 'Cero pesos 00/100 M.N.'],
    [100n, 'Un peso 00/100 M.N.'],
    [2_200n, 'Veintidós pesos 00/100 M.N.'],
    [3_100n, 'Treinta y un pesos 00/100 M.N.'],
    [10_000n, 'Cien pesos 00/100 M.N.'],
    [10_100n, 'Ciento un pesos 00/100 M.N.'],
    [100_000n, 'Mil pesos 00/100 M.N.'],
    [250_270n, 'Dos mil quinientos dos pesos 70/100 M.N.'],
    [2_100_000n, 'Veintiún mil pesos 00/100 M.N.'],
    [10_100_000n, 'Ciento un mil pesos 00/100 M.N.'],
    [68_788_000n, 'Seiscientos ochenta y siete mil ochocientos ochenta pesos 00/100 M.N.'],
    [100_000_000n, 'Un millón de pesos 00/100 M.N.'],
    [123_456_789n, 'Un millón doscientos treinta y cuatro mil quinientos sesenta y siete pesos 89/100 M.N.'],
    [2_100_000_000n, 'Veintiún millones de pesos 00/100 M.N.'],
  ])('%s centavos en MXN', (amount, expected) => {
    expect(amountInWords(amount, 'MXN')).toBe(expected);
  });

  it('writes dollars and skips currencies without a wording', () => {
    expect(amountInWords(120_000n, 'USD')).toBe('Mil doscientos dólares 00/100 USD');
    expect(amountInWords(100n, 'usd')).toBe('Un dólar 00/100 USD');
    expect(amountInWords(100n, 'EUR')).toBeNull();
  });

  it('covers the teens, the twenties and thousands of millions', () => {
    expect(integerToSpanishWords(16n)).toBe('dieciséis');
    expect(integerToSpanishWords(26n)).toBe('veintiséis');
    expect(integerToSpanishWords(1_000_000_000n)).toBe('mil millones');
    expect(integerToSpanishWords(501_000n)).toBe('quinientos un mil');
    expect(() => integerToSpanishWords(-1n)).toThrow(RangeError);
  });
});
