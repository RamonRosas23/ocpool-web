import { rgb, type RGB } from 'pdf-lib';
import { brandColors } from '@/lib/brand';

function fromHex(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
}

/** Paleta de la marca en colores de pdf-lib. */
export const PDF_COLORS = {
  navy: fromHex(brandColors.navy),
  ink: fromHex(brandColors.ink),
  muted: fromHex(brandColors.muted),
  paper: fromHex(brandColors.paper),
  line: fromHex(brandColors.line),
  bronze: fromHex(brandColors.bronze),
  bronzeText: fromHex(brandColors.bronzeText),
  white: fromHex(brandColors.white),
} as const;

/** A4 en puntos: márgenes laterales de 48 pt y una franja inferior reservada al pie. */
export const PAGE = {
  width: 595.28,
  height: 841.89,
  marginX: 48,
  contentWidth: 595.28 - 96,
  bodyBottom: 72,
  footerBaseline: 32,
} as const;
