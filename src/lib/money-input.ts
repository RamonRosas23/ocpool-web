/**
 * Converts a minor-unit money string (e.g. "12580000") into a decimal input value with thousands
 * separators (e.g. "125,800.00") -- easier to read while editing; `parseMoneyInput` accepts the commas.
 */
export function moneyInputLabel(value: string): string {
  if (!/^\d+$/u.test(value)) return '';
  const amount = BigInt(value);
  return `${(amount / 100n).toLocaleString('en-US')}.${(amount % 100n).toString().padStart(2, '0')}`;
}

/** Parses a decimal money input (e.g. "1,250.5") into a minor-unit string (e.g. "125050"), or null if invalid. */
export function parseMoneyInput(value: string): string | null {
  const normalized = value.trim().replace(/,/gu, '');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (!match) return null;
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')).toString();
}
