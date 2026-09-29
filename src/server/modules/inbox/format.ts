import { moneyLabel } from '@/lib/money';

const PREVIEW_LIMIT = 160;

/** Vista previa de un mensaje: un renglón, entre comillas tipográficas, sin cortar a media palabra si se puede. */
export function messagePreview(body: string): string {
  const flat = body.replace(/\s+/gu, ' ').trim();
  if (flat.length <= PREVIEW_LIMIT) return `“${flat}”`;
  const cut = flat.slice(0, PREVIEW_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `“${(lastSpace > PREVIEW_LIMIT * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…”`;
}

export function filePreview(fileName: string): string {
  return `Archivo: ${fileName.replace(/\s+/gu, ' ').trim()}`;
}

/** Mismo formato que el portal ("MXN 485,000.00"), para que el aviso y la pantalla digan lo mismo. */
export function totalLabel(totalMinor: bigint, currencyCode: string): string {
  return moneyLabel(totalMinor, currencyCode);
}
