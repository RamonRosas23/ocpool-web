export function moneyLabel(value: string | bigint | null | undefined, currency = 'MXN'): string {
  const raw = typeof value === 'bigint' ? value.toString() : value;
  if (!raw || !/^\d+$/.test(raw)) return '—';
  const amount = BigInt(raw);
  const whole = amount / 100n;
  const decimals = (amount % 100n).toString().padStart(2, '0');
  return `${currency} ${whole.toLocaleString('es-MX')}.${decimals}`;
}
