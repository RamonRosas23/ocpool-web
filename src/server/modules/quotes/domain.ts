export const MAX_MONEY_MINOR_UNITS = 9_999_999_999_999_999n;
export const MAX_QUANTITY_MILLIUNITS = 1_000_000_000_000n;
export const QUANTITY_SCALE = 1_000n;
export const BASIS_POINTS_SCALE = 10_000n;

export type CurrencyCode = string & { readonly __currencyCode: unique symbol };

export type Money = Readonly<{
  amountMinor: bigint;
  currency: CurrencyCode;
}>;

export type Quantity = Readonly<{
  milliunits: bigint;
}>;

export type BasisPoints = number & { readonly __basisPoints: unique symbol };

export const QUOTE_VERSION_STATUSES = [
  'BORRADOR',
  'EN_REVISION',
  'ENVIADA',
  'EN_NEGOCIACION',
  'ACEPTADA',
  'RECHAZADA',
  'VENCIDA',
] as const;

export type QuoteVersionStatus = (typeof QUOTE_VERSION_STATUSES)[number];

const QUOTE_VERSION_TRANSITIONS: Record<QuoteVersionStatus, readonly QuoteVersionStatus[]> = {
  BORRADOR: ['EN_REVISION', 'RECHAZADA'],
  EN_REVISION: ['BORRADOR', 'ENVIADA', 'RECHAZADA'],
  ENVIADA: ['EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'],
  EN_NEGOCIACION: ['ACEPTADA', 'RECHAZADA', 'VENCIDA'],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
};

export function normalizeCurrencyCode(value: string): CurrencyCode {
  if (typeof value !== 'string') throw new Error('Invalid currency code.');
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new Error('Invalid currency code.');
  return normalized as CurrencyCode;
}

export function parseMinorUnits(value: string | bigint): bigint {
  if (typeof value === 'bigint') return validateMinorUnits(value);
  if (typeof value !== 'string') throw new Error('Money must use integer minor units.');
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) throw new Error('Money must use integer minor units.');
  return validateMinorUnits(BigInt(normalized));
}

function validateMinorUnits(value: bigint): bigint {
  if (value < 0n || value > MAX_MONEY_MINOR_UNITS) throw new Error('Money amount is outside the supported range.');
  return value;
}

export function createMoney(amountMinor: string | bigint, currency: string): Money {
  return Object.freeze({ amountMinor: parseMinorUnits(amountMinor), currency: normalizeCurrencyCode(currency) });
}

export function addMoney(first: Money, ...others: readonly Money[]): Money {
  let amountMinor = assertMoney(first).amountMinor;
  const currency = first.currency;

  for (const money of others) {
    const candidate = assertSameCurrency(currency, money);
    amountMinor = validateMinorUnits(amountMinor + candidate.amountMinor);
  }

  return Object.freeze({ amountMinor, currency });
}

export function subtractMoney(minuend: Money, subtrahend: Money): Money {
  const first = assertMoney(minuend);
  const second = assertSameCurrency(first.currency, subtrahend);
  if (second.amountMinor > first.amountMinor) throw new Error('Money subtraction cannot produce a negative amount.');
  return Object.freeze({ amountMinor: first.amountMinor - second.amountMinor, currency: first.currency });
}

export function parseQuantity(value: string): Quantity {
  if (typeof value !== 'string') throw new Error('Quantity must be a decimal string.');
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,3}))?$/u.exec(normalized);
  if (!match) throw new Error('Quantity must have at most three decimal places.');

  const integerPart = BigInt(match[1]);
  const fractionalPart = BigInt((match[2] ?? '').padEnd(3, '0') || '0');
  const milliunits = integerPart * QUANTITY_SCALE + fractionalPart;
  if (milliunits < 1n || milliunits > MAX_QUANTITY_MILLIUNITS) throw new Error('Quantity is outside the supported range.');

  return Object.freeze({ milliunits });
}

export function quantityFromMilliunits(value: bigint): Quantity {
  if (value < 1n || value > MAX_QUANTITY_MILLIUNITS) throw new Error('Quantity is outside the supported range.');
  return Object.freeze({ milliunits: value });
}

export function normalizeBasisPoints(value: string | number | bigint): BasisPoints {
  let normalized: bigint;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Rate must be an integer number of basis points.');
    normalized = BigInt(value);
  } else if (typeof value === 'bigint') {
    normalized = value;
  } else {
    if (typeof value !== 'string') throw new Error('Rate must be an integer number of basis points.');
    if (!/^\d+$/u.test(value.trim())) throw new Error('Rate must be an integer number of basis points.');
    normalized = BigInt(value.trim());
  }

  if (normalized < 0n || normalized > BASIS_POINTS_SCALE) throw new Error('Rate must be between 0 and 10000 basis points.');
  return Number(normalized) as BasisPoints;
}

export type LinePricingInput = Readonly<{
  quantity: Quantity;
  unitPrice: Money;
  discountBasisPoints?: string | number | bigint;
  taxBasisPoints?: string | number | bigint;
}>;

export type LineTotals = Readonly<{
  subtotal: Money;
  discount: Money;
  taxable: Money;
  tax: Money;
  total: Money;
}>;

export function calculateLineTotals(input: LinePricingInput): LineTotals {
  const unitPrice = assertMoney(input.unitPrice);
  const quantity = assertQuantity(input.quantity);
  const discountBasisPoints = normalizeBasisPoints(input.discountBasisPoints ?? 0);
  const taxBasisPoints = normalizeBasisPoints(input.taxBasisPoints ?? 0);
  const subtotal = multiplyMoneyByQuantity(unitPrice, quantity);
  const discount = percentageOf(subtotal, discountBasisPoints);
  const taxable = subtractMoney(subtotal, discount);
  const tax = percentageOf(taxable, taxBasisPoints);
  const total = addMoney(taxable, tax);

  return Object.freeze({ subtotal, discount, taxable, tax, total });
}

function multiplyMoneyByQuantity(money: Money, quantity: Quantity): Money {
  const normalizedMoney = assertMoney(money);
  const normalizedQuantity = assertQuantity(quantity);
  const amountMinor = roundHalfUp(normalizedMoney.amountMinor * normalizedQuantity.milliunits, QUANTITY_SCALE);
  return Object.freeze({ amountMinor: validateMinorUnits(amountMinor), currency: normalizedMoney.currency });
}

function percentageOf(money: Money, basisPoints: BasisPoints): Money {
  const normalizedMoney = assertMoney(money);
  const amountMinor = roundHalfUp(normalizedMoney.amountMinor * BigInt(basisPoints), BASIS_POINTS_SCALE);
  return Object.freeze({ amountMinor: validateMinorUnits(amountMinor), currency: normalizedMoney.currency });
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function assertMoney(money: Money): Money {
  if (!money || typeof money.amountMinor !== 'bigint' || typeof money.currency !== 'string') throw new Error('Invalid money value.');
  validateMinorUnits(money.amountMinor);
  if (normalizeCurrencyCode(money.currency) !== money.currency) throw new Error('Currency code must be normalized.');
  return money;
}

function assertSameCurrency(currency: CurrencyCode, money: Money): Money {
  const candidate = assertMoney(money);
  if (candidate.currency !== currency) throw new Error('Money values must use the same currency.');
  return candidate;
}

function assertQuantity(quantity: Quantity): Quantity {
  if (!quantity || typeof quantity.milliunits !== 'bigint') throw new Error('Invalid quantity value.');
  if (quantity.milliunits < 1n || quantity.milliunits > MAX_QUANTITY_MILLIUNITS) throw new Error('Quantity is outside the supported range.');
  return quantity;
}

export type QuoteLineSnapshotInput = Readonly<{
  catalogItemId: string;
  catalogItemCode: string;
  name: string;
  description?: string | null;
  unit: string;
  quantity: Quantity;
  unitPrice: Money;
  discountBasisPoints?: string | number | bigint;
  taxBasisPoints?: string | number | bigint;
}>;

export type QuoteLineSnapshot = Readonly<{
  catalogItemId: string;
  catalogItemCode: string;
  name: string;
  description: string | null;
  unit: string;
  quantity: Quantity;
  unitPrice: Money;
  discountBasisPoints: BasisPoints;
  taxBasisPoints: BasisPoints;
  subtotal: Money;
  discount: Money;
  taxable: Money;
  tax: Money;
  total: Money;
}>;

export type QuoteVersionSnapshot = Readonly<{
  schemaVersion: 1;
  currency: CurrencyCode;
  lines: readonly QuoteLineSnapshot[];
  subtotal: Money;
  discountTotal: Money;
  taxableTotal: Money;
  taxTotal: Money;
  total: Money;
}>;

export function buildQuoteVersionSnapshot(lines: readonly QuoteLineSnapshotInput[]): QuoteVersionSnapshot {
  if (lines.length === 0) throw new Error('A quote version requires at least one line.');

  const snapshots = lines.map((line) => {
    const catalogItemId = normalizeRequiredText(line.catalogItemId, 100, 'catalog item id');
    const catalogItemCode = normalizeCatalogCode(line.catalogItemCode);
    const name = normalizeRequiredText(line.name, 180, 'catalog item name');
    const description = line.description == null ? null : normalizeOptionalText(line.description, 2_000);
    const unit = normalizeRequiredText(line.unit, 40, 'catalog item unit');
    const unitPrice = assertMoney(line.unitPrice);
    const discountBasisPoints = normalizeBasisPoints(line.discountBasisPoints ?? 0);
    const taxBasisPoints = normalizeBasisPoints(line.taxBasisPoints ?? 0);
    const totals = calculateLineTotals({ quantity: line.quantity, unitPrice, discountBasisPoints, taxBasisPoints });

    return Object.freeze({
      catalogItemId,
      catalogItemCode,
      name,
      description,
      unit,
      quantity: assertQuantity(line.quantity),
      unitPrice,
      discountBasisPoints,
      taxBasisPoints,
      ...totals,
    });
  });

  const currency = snapshots[0].unitPrice.currency;
  for (const line of snapshots) {
    if (line.unitPrice.currency !== currency) throw new Error('All quote lines must use the same currency.');
  }

  const subtotal = sumMoney(snapshots.map((line) => line.subtotal));
  const discountTotal = sumMoney(snapshots.map((line) => line.discount));
  const taxableTotal = sumMoney(snapshots.map((line) => line.taxable));
  const taxTotal = sumMoney(snapshots.map((line) => line.tax));
  const total = sumMoney(snapshots.map((line) => line.total));

  return Object.freeze({
    schemaVersion: 1,
    currency,
    lines: Object.freeze(snapshots),
    subtotal,
    discountTotal,
    taxableTotal,
    taxTotal,
    total,
  });
}

function sumMoney(values: readonly Money[]): Money {
  const [first, ...rest] = values;
  if (!first) throw new Error('Cannot sum an empty set of money values.');
  return addMoney(first, ...rest);
}

function normalizeCatalogCode(value: string): string {
  const normalized = normalizeRequiredText(value, 64, 'catalog item code').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/u.test(normalized)) throw new Error('Invalid catalog item code.');
  return normalized;
}

function normalizeRequiredText(value: string, maxLength: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`);
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function normalizeOptionalText(value: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error('Invalid optional text.');
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length > maxLength) throw new Error('Invalid optional text.');
  return normalized;
}

export type QuoteVersionTransitionContext = Readonly<{
  acceptanceEvidence?: boolean;
}>;

export function canTransitionQuoteVersion(
  from: QuoteVersionStatus,
  to: QuoteVersionStatus,
  context: QuoteVersionTransitionContext = {},
): boolean {
  if (!QUOTE_VERSION_TRANSITIONS[from]?.includes(to)) return false;
  if (to === 'ACEPTADA' && context.acceptanceEvidence !== true) return false;
  return true;
}

export function isQuoteVersionImmutable(status: QuoteVersionStatus): boolean {
  return status !== 'BORRADOR';
}

export function canEditQuoteVersion(status: QuoteVersionStatus): boolean {
  return status === 'BORRADOR';
}
