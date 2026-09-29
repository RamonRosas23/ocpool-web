/**
 * Precios de una lista que valen hoy. La API de la lista devuelve TODAS las filas de cada concepto
 * (también las vencidas y las programadas a futuro), pero el servidor cotiza siempre con la fila
 * vigente: ni la vista previa ni «Verificar precios vigentes» deben tomar otra.
 */
export type PriceListRow = {
  catalogItemId: string;
  validFrom: string;
  validUntil: string | null;
  catalogItem: { status: string };
};

export function currentPriceRows<T extends PriceListRow>(rows: readonly T[], now: number = Date.now()): Map<string, T> {
  const current = new Map<string, T>();
  for (const row of rows) {
    if (row.catalogItem.status !== 'ACTIVE') continue;
    const validFrom = Date.parse(row.validFrom);
    if (Number.isNaN(validFrom) || validFrom > now) continue;
    if (row.validUntil !== null && !(Date.parse(row.validUntil) > now)) continue;
    // Las vigencias de un mismo concepto no se cruzan; si algún dato antiguo lo hiciera, gana la más reciente.
    const existing = current.get(row.catalogItemId);
    if (!existing || Date.parse(existing.validFrom) < validFrom) current.set(row.catalogItemId, row);
  }
  return current;
}
