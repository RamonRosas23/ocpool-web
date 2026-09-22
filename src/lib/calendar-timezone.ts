export const BUSINESS_TIMEZONE = 'America/Chihuahua';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function timeZoneParts(value: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
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

export function calendarSerial(value: string): number {
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

export function addCalendarDays(value: string, days: number): string {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error('La fecha no es válida.');
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

export function zonedCalendarDateToUtc(value: string, timezone: string = BUSINESS_TIMEZONE): Date {
  const naiveUtc = calendarSerial(value);
  let candidate = new Date(naiveUtc);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = timeZoneParts(candidate, timezone);
    const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate = new Date(naiveUtc - (wallClockUtc - candidate.getTime()));
  }
  return candidate;
}

// La medianoche local del día siguiente, menos 1 ms -- el instante UTC correcto para "fin de este
// día calendario" en `timezone`. Tratar el string de fecha como si ya fuera UTC (`${value}T23:59:59.999Z`,
// el patrón que StaffQuotesPanel/StaffCatalogPanel usaban antes de esta corrección) adelanta el
// vencimiento/inicio de vigencia varias horas en America/Chihuahua (UTC-6/-7).
export function zonedCalendarDateEndOfDayToUtc(value: string, timezone: string = BUSINESS_TIMEZONE): Date {
  return new Date(zonedCalendarDateToUtc(addCalendarDays(value, 1), timezone).getTime() - 1);
}
