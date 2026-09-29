import { readApiResponseOrThrow } from '@/lib/api-response-error';

/** El precio vale desde un minuto atrás (sin salirse de la lista): así el reloj del navegador no lo deja «en el futuro» frente al servidor. */
export const PRICE_START_GRACE_MS = 60_000;

export type AssignableList = { id: string; validFrom: string; validUntil: string | null };

/**
 * Asigna el precio vigente de un concepto en una lista (requiere `prices.manage`). Lo usan el constructor de
 * cotizaciones («guardar también en la lista») y «Precios por asignar»: una sola regla de vigencia y un solo
 * contrato con `POST /api/staff/catalog/price-lists/{id}/items`. Lanza con el mensaje del servidor si falla.
 */
export async function assignListPrice(list: AssignableList, catalogItemId: string, unitPriceMinor: string, now: number = Date.now()): Promise<void> {
  const listStart = Date.parse(list.validFrom);
  const validFrom = new Date(Math.max(Number.isNaN(listStart) ? 0 : listStart, now - PRICE_START_GRACE_MS)).toISOString();
  const response = await fetch(`/api/staff/catalog/price-lists/${list.id}/items`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ catalogItemId, unitPriceMinor, validFrom, validUntil: list.validUntil }),
  });
  await readApiResponseOrThrow(response, 'No fue posible guardar el precio en la lista.');
}
