// UX audit fix: formatDate was reimplemented independently in ~15 components, with three real,
// unintentional divergences -- not just duplicated code: (1) most staff panels passed no timeZone
// at all, rendering in whatever timezone the staff member's own browser happens to be set to,
// instead of the business timezone (America/Chihuahua, the same default this app's server-side
// APP_TIMEZONE already uses); (2) the two client-portal panels forced UTC instead, which can show
// a different calendar day than the customer's own local time; (3) a few panels used a visibly
// different text format (Intl's dateStyle/timeStyle shorthand vs. explicit day/month/year parts,
// or `month: 'long'` instead of `'short'`) for no reason tied to their content. Only
// StaffAuditPanel.tsx and StaffDashboardPanel.tsx already had this right, computing the real
// business timezone from the server and passing it in -- both keep doing exactly that by passing
// it as the `timezone` argument here.
const BUSINESS_TIMEZONE = 'America/Chihuahua';

function format(value: string | null | undefined, style: Intl.DateTimeFormatOptions, timezone: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('es-MX', { ...style, timeZone: timezone ?? BUSINESS_TIMEZONE }).format(date);
}

export function formatDate(value: string | null | undefined, timezone?: string, fallback = 'Fecha por confirmar'): string {
  return format(value, { day: '2-digit', month: 'short', year: 'numeric' }, timezone, fallback);
}

export function formatDateTime(value: string | null | undefined, timezone?: string, fallback = 'Fecha por confirmar'): string {
  return format(value, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, timezone, fallback);
}
