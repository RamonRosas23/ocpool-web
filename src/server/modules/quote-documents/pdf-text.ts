import { setCharacterSpacing, type PDFPage, type RGB } from 'pdf-lib';
import type { QuotePdfTypeface } from '@/server/modules/quote-documents/pdf-fonts';

/** Estilo de texto: `tracking` es el espaciado entre letras en puntos (etiquetas en versalitas). */
export type TextStyle = Readonly<{ face: QuotePdfTypeface; size: number; color: RGB; tracking?: number }>;

export function textWidth(text: string, style: TextStyle): number {
  const clean = style.face.clean(text);
  const tracking = style.tracking ?? 0;
  return style.face.font.widthOfTextAtSize(clean, style.size) + (Math.max(0, [...clean].length - 1) * tracking);
}

export function drawText(page: PDFPage, text: string, x: number, y: number, style: TextStyle): void {
  const clean = style.face.clean(text).trim();
  if (!clean) return;
  const tracking = style.tracking ?? 0;
  if (tracking) page.pushOperators(setCharacterSpacing(tracking));
  page.drawText(clean, { x, y, size: style.size, font: style.face.font, color: style.color });
  if (tracking) page.pushOperators(setCharacterSpacing(0));
}

export function drawTextRight(page: PDFPage, text: string, rightX: number, y: number, style: TextStyle): void {
  drawText(page, text, rightX - textWidth(text.trim(), style), y, style);
}

/** Corta por palabras al ancho dado; una palabra más ancha que la columna (URL, código) se corta por letras. */
export function wrapText(text: string, style: TextStyle, maxWidth: number): string[] {
  const clean = style.face.clean(text).trim();
  if (!clean) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of clean.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, style) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (textWidth(word, style) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = '';
    for (const char of word) {
      if (chunk && textWidth(chunk + char, style) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines;
}
