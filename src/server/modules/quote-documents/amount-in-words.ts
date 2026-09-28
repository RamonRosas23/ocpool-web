/**
 * Importe con letra, como se acostumbra en los documentos comerciales en México: "Dos mil quinientos
 * dos pesos 70/100 M.N.". Sólo para las monedas con que OCPOOL cotiza (MXN y USD); para otras devuelve
 * null y el PDF omite la línea.
 */
const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const TEENS = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const TWENTIES = ['veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

const CURRENCIES: Readonly<Record<string, Readonly<{ singular: string; plural: string; suffix: string }>>> = {
  MXN: { singular: 'peso', plural: 'pesos', suffix: 'M.N.' },
  USD: { singular: 'dólar', plural: 'dólares', suffix: 'USD' },
};

/** 1–999 en palabras, con "uno" completo (la apócope depende de lo que sigue). */
function hundredsToWords(value: number): string {
  if (value === 100) return 'cien';
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]!);
  if (rest >= 30) {
    const units = rest % 10;
    parts.push(units === 0 ? TENS[Math.floor(rest / 10)]! : `${TENS[Math.floor(rest / 10)]} y ${UNITS[units]}`);
  } else if (rest >= 20) {
    parts.push(TWENTIES[rest - 20]!);
  } else if (rest >= 10) {
    parts.push(TEENS[rest - 10]!);
  } else if (rest > 0) {
    parts.push(UNITS[rest]!);
  }
  return parts.join(' ');
}

/** "uno" → "un" y "veintiuno" → "veintiún" delante de un sustantivo masculino (mil, millones, pesos). */
function apocopate(words: string): string {
  if (words.endsWith('veintiuno')) return `${words.slice(0, -'veintiuno'.length)}veintiún`;
  if (words === 'uno' || words.endsWith(' uno')) return `${words.slice(0, -'uno'.length)}un`;
  return words;
}

/** 1–999 999 en palabras. */
function belowMillionToWords(value: number): string {
  const thousands = Math.floor(value / 1_000);
  const rest = value % 1_000;
  const parts: string[] = [];
  if (thousands === 1) parts.push('mil');
  else if (thousands > 1) parts.push(`${apocopate(hundredsToWords(thousands))} mil`);
  if (rest > 0) parts.push(hundredsToWords(rest));
  return parts.join(' ');
}

/** Entero de 0 a 999 999 999 999 en palabras ("uno" sin apocopar al final). */
export function integerToSpanishWords(value: bigint): string {
  if (value < 0n || value > 999_999_999_999n) throw new RangeError('Importe fuera de rango para escribirlo con letra.');
  if (value === 0n) return 'cero';
  const millions = Number(value / 1_000_000n);
  const rest = Number(value % 1_000_000n);
  const parts: string[] = [];
  if (millions === 1) parts.push('un millón');
  else if (millions > 1) parts.push(`${apocopate(belowMillionToWords(millions))} millones`);
  if (rest > 0) parts.push(belowMillionToWords(rest));
  return parts.join(' ');
}

export function amountInWords(amountMinor: bigint, currencyCode: string): string | null {
  const currency = CURRENCIES[currencyCode.toUpperCase()];
  if (!currency) return null;
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const whole = absolute / 100n;
  if (whole > 999_999_999_999n) return null;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  const noun = whole === 1n ? currency.singular : currency.plural;
  // "un millón de pesos", pero "un millón doscientos mil pesos".
  const joiner = whole >= 1_000_000n && whole % 1_000_000n === 0n ? ' de ' : ' ';
  const sentence = `${negative ? 'menos ' : ''}${apocopate(integerToSpanishWords(whole))}${joiner}${noun} ${cents}/100 ${currency.suffix}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
