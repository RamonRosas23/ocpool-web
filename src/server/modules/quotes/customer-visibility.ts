/**
 * Legacy quote-version visibility contract for customer-facing surfaces.
 *
 * Working states are intentionally excluded until the V2 published pointer is
 * available. Keep this list shared by portal projections, PDF access and
 * acceptance so one surface cannot expose a different version than another.
 */

export const CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES = ['ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'] as const;

export function isCustomerVisibleQuoteVersionStatus(status: string): boolean {
  return CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES.includes(status as (typeof CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES)[number]);
}

