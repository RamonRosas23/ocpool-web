const DEFAULT_DASHBOARD_TIMEZONE = 'America/Chihuahua';
const MAX_RANGE_DAYS = 93;
const DEFAULT_RANGE_DAYS = 30;
const DAY_SECONDS = 86_400;
const MIN_SAMPLE_SIZE = 5;

export type DashboardScope = 'self' | 'global';

export type DashboardQueryInput = {
  from?: string;
  to?: string;
  now?: Date;
  timezone?: string;
};

export type DashboardQuery = {
  from: Date;
  to: Date;
  timezone: string;
  scope: DashboardScope;
};

export type MetricSummary = {
  sampleSize: number | null;
  p50Seconds: number | null;
  p90Seconds: number | null;
  suppressed: boolean;
};

export type WorkloadRow = {
  actorKey: string;
  displayName: string;
  activeRequests: number | null;
  draftQuotes: number | null;
  oldestOpenAt: string | null;
  suppressed: boolean;
};

export type DashboardResponse = {
  meta: {
    from: string;
    to: string;
    timezone: string;
    generatedAt: string;
    freshness: 'fresh' | 'stale';
    scope: DashboardScope;
  };
  requests: {
    received: number;
    unassigned: number;
    byStatus: Array<{ status: string; count: number }>;
    byOrigin: Array<{ origin: string; count: number }>;
    aging: Array<{ bucket: string; count: number }>;
  };
  quotes: {
    sent: number;
    accepted: number;
    acceptanceRateBps: number | null;
    acceptedTotals: Array<{ currencyCode: string; totalMinor: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  timing: {
    assignment: MetricSummary;
    quoteSent: MetricSummary;
    acceptance: MetricSummary;
  };
  workload: WorkloadRow[];
  notifications: {
    byStatus: Array<{ status: string; count: number }>;
    oldestPendingAt: string | null;
    failedInPeriod: number;
  };
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function assertTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('La zona horaria no es válida.');
  }
  return timezone;
}

function timeZoneParts(value: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 0,
    day: values.get('day') ?? 0,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
}

function calendarDateFor(value: Date, timezone: string): string {
  const parts = timeZoneParts(value, timezone);
  return [parts.year, parts.month, parts.day].map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0')).join('-');
}

function addCalendarDays(value: string, days: number): string {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error('La fecha no es válida.');
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

function calendarSerial(value: string): number {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error('La fecha no es válida.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const serial = Date.UTC(year, month - 1, day);
  const check = new Date(serial);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error('La fecha no es válida.');
  return serial;
}

function zonedCalendarDateToUtc(value: string, timezone: string): Date {
  const naiveUtc = calendarSerial(value);
  let candidate = new Date(naiveUtc);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = timeZoneParts(candidate, timezone);
    const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate = new Date(naiveUtc - (wallClockUtc - candidate.getTime()));
  }
  return candidate;
}

export function normalizeDashboardQuery(input: DashboardQueryInput = {}): DashboardQuery {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('La fecha de operación no es válida.');
  const timezone = assertTimezone(input.timezone ?? DEFAULT_DASHBOARD_TIMEZONE);
  const today = calendarDateFor(now, timezone);
  const toCalendarDate = input.to ?? today;
  const fromCalendarDate = input.from ?? addCalendarDays(toCalendarDate, -DEFAULT_RANGE_DAYS);
  const fromSerial = calendarSerial(fromCalendarDate);
  const toSerial = calendarSerial(toCalendarDate);
  const rangeDays = Math.round((toSerial - fromSerial) / (DAY_SECONDS * 1000));
  if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) throw new Error('El rango de fechas no es válido.');
  if (toCalendarDate > today) throw new Error('El rango de fechas no puede estar en el futuro.');
  return {
    from: zonedCalendarDateToUtc(fromCalendarDate, timezone),
    to: zonedCalendarDateToUtc(toCalendarDate, timezone),
    timezone,
    scope: 'global',
  };
}

export function calculateAcceptanceRateBps(sent: number, accepted: number): number | null {
  if (!Number.isInteger(sent) || !Number.isInteger(accepted) || sent < 0 || accepted < 0) throw new Error('Los conteos no son válidos.');
  if (sent === 0) return null;
  return Math.min(10_000, Math.max(0, Math.round((accepted / sent) * 10_000)));
}

export function calculatePercentileSeconds(values: readonly number[], percentile: 0.5 | 0.9): number | null {
  const normalized = values.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (normalized.length < MIN_SAMPLE_SIZE) return null;
  const index = Math.min(normalized.length - 1, Math.ceil(normalized.length * percentile) - 1);
  return Math.round(normalized[index]);
}

export function agingBucketForSeconds(seconds: number): '0–1' | '2–3' | '4–7' | '8–14' | '15–30' | '31+' {
  const days = Math.max(0, Math.floor(seconds / DAY_SECONDS));
  if (days <= 1) return '0–1';
  if (days <= 3) return '2–3';
  if (days <= 7) return '4–7';
  if (days <= 14) return '8–14';
  if (days <= 30) return '15–30';
  return '31+';
}

export { DEFAULT_DASHBOARD_TIMEZONE, MAX_RANGE_DAYS, MIN_SAMPLE_SIZE };
