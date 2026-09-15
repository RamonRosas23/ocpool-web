/** Converts a minor-unit money string (e.g. "125000") into a decimal input value (e.g. "1250.00"). */
export function moneyInputLabel(value: string): string {
  if (!/^\d+$/u.test(value)) return '';
  const amount = BigInt(value);
  return `${(amount / 100n).toString()}.${(amount % 100n).toString().padStart(2, '0')}`;
}

/** Parses a decimal money input (e.g. "1,250.5") into a minor-unit string (e.g. "125050"), or null if invalid. */
export function parseMoneyInput(value: string): string | null {
  const normalized = value.trim().replace(/,/gu, '');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (!match) return null;
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')).toString();
}
