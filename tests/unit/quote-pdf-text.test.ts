import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedQuotePdfTypefaces } from '@/server/modules/quote-documents/pdf-fonts';
import { drawText, textWidth, wrapText } from '@/server/modules/quote-documents/pdf-text';
import { PDF_COLORS } from '@/server/modules/quote-documents/pdf-theme';

describe('PDF text primitives', () => {
  it('keeps what the brand fonts can draw and drops what they cannot', async () => {
    const pdf = await PDFDocument.create();
    const faces = await embedQuotePdfTypefaces(pdf);
    // Manrope y Cormorant cubren acentos, ñ y símbolos técnicos; emoji e ideogramas no existen en ellas.
    expect(faces.regular.clean('Profundidad ≥ 1.20 m → 🏊 listo')).toBe('Profundidad ≥ 1.20 m → listo');
    expect(faces.display.clean('Plano 漢 final')).toBe('Plano final');
    expect(faces.regular.clean('Año, niño, acción: 100 % · m²')).toBe('Año, niño, acción: 100 % · m²');
  });

  it('wraps by width, splits words wider than the column and accounts for tracking', async () => {
    const pdf = await PDFDocument.create();
    const faces = await embedQuotePdfTypefaces(pdf);
    const style = { face: faces.regular, size: 10, color: PDF_COLORS.ink };
    const lines = wrapText('Suministro e instalación de equipo de filtración de alta eficiencia', style, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, style)).toBeLessThanOrEqual(120);
    expect(wrapText('https://ocpool.com.mx/portal/requests/000000000000000000000000', style, 60).length).toBeGreaterThan(1);
    expect(textWidth('ABC', { ...style, tracking: 2 })).toBeCloseTo(textWidth('ABC', style) + 4, 5);
    const page = pdf.addPage();
    expect(() => drawText(page, 'Texto con emoji 🏊', 10, 10, { ...style, tracking: 1 })).not.toThrow();
  });
});
