import { addCalendarDays, utcToZonedCalendarDate } from '@/lib/calendar-timezone';

/** Plazo propuesto cuando no se puede deducir el de la versión anterior. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Vigencia (AAAA-MM-DD, zona del negocio) con la que el constructor abre una versión. Conserva la de la
 * versión mientras siga vigente; si ya pasó -- el caso "La propuesta venció" o un borrador que se quedó
 * esperando --, propone el mismo plazo que tenía contado desde hoy (30 días si no se puede deducir):
 * el servidor rechaza vigencias pasadas y "Crear nueva versión" fallaba con la fecha vieja.
 */
export function builderValidUntil(version: { validUntil: string | null; createdAt: string } | null | undefined, now: Date = new Date()): string {
  if (!version?.validUntil) return '';
  const until = new Date(version.validUntil);
  if (until.getTime() > now.getTime()) return utcToZonedCalendarDate(until);
  const windowDays = Math.round((until.getTime() - new Date(version.createdAt).getTime()) / DAY_MS);
  const days = windowDays >= 7 && windowDays <= 120 ? windowDays : DEFAULT_QUOTE_VALIDITY_DAYS;
  return addCalendarDays(utcToZonedCalendarDate(now), days);
}
