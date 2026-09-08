import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  QUOTE_PDF_TEMPLATE_VERSION,
  renderQuotePdf,
  type QuotePdfSnapshot,
} from '@/server/modules/quote-documents/pdf-renderer';

const snapshot: QuotePdfSnapshot = {
  folio: 'OCQ-2026-000123',
  versionNumber: 2,
  clientName: 'Constructora del Norte, S.A. de C.V.',
  projectType: 'Alberca residencial',
  location: 'Chihuahua, Chihuahua',
  description: 'Diseño, suministro e instalación integral de sistema de filtración.',
  currencyCode: 'MXN',
  validUntil: new Date('2026-10-15T00:00:00.000Z'),
  lines: [
    { name: 'Bomba de filtración premium', description: 'Equipo de alta eficiencia', unit: 'pieza', quantityMilliunits: 1_000n, unitPriceMinor: 485_000n, discountMinor: 0n, taxMinor: 77_600n, totalMinor: 562_600n },
    { name: 'Instalación y puesta en marcha', description: 'Incluye pruebas y capacitación', unit: 'servicio', quantityMilliunits: 1_000n, unitPriceMinor: 120_000n, discountMinor: 12_000n, taxMinor: 17_280n, totalMinor: 125_280n },
  ],
  subtotalMinor: 605_000n,
  discountTotalMinor: 12_000n,
  taxableTotalMinor: 593_000n,
  taxTotalMinor: 94_880n,
  totalMinor: 687_880n,
};

describe('quote PDF renderer', () => {
  it('renders a deterministic, paginated PDF from the frozen quote snapshot', async () => {
    const first = await renderQuotePdf(snapshot);
    const second = await renderQuotePdf({ ...snapshot, lines: [...snapshot.lines] });

    expect(first.templateVersion).toBe(QUOTE_PDF_TEMPLATE_VERSION);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
    expect(first.byteSize).toBe(first.bytes.byteLength);
    expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'));
    expect(first.pageCount).toBeGreaterThanOrEqual(1);

    const document = await PDFDocument.load(first.bytes);
    expect(document.getPageCount()).toBe(first.pageCount);
    expect(document.getTitle()).toBe('Cotización OCPOOL OCQ-2026-000123 v2');
    expect(document.getAuthor()).toBe('OCPOOL');
  });

  it('does not depend on catalog or internal payload fields once the snapshot exists', async () => {
    const rendered = await renderQuotePdf(snapshot);
    const mutatedCatalogContext = await renderQuotePdf({
      ...snapshot,
      lines: snapshot.lines.map((line) => ({ ...line })),
    });

    expect(rendered.sha256).toBe(mutatedCatalogContext.sha256);
    expect(Buffer.from(rendered.bytes).includes(Buffer.from('secret-internal-note'))).toBe(false);
  });

  it('supports long line descriptions without dropping totals', async () => {
    const rendered = await renderQuotePdf({
      ...snapshot,
      lines: Array.from({ length: 34 }, (_, index) => ({
        name: `Concepto premium ${index + 1}`,
        description: 'Descripción extensa de prueba para verificar saltos de línea y continuidad entre páginas sin romper la tabla comercial.',
        unit: 'pieza',
        quantityMilliunits: 1_000n,
        unitPriceMinor: 1_000n,
        discountMinor: 0n,
        taxMinor: 160n,
        totalMinor: 1_160n,
      })),
    });

    expect(rendered.pageCount).toBeGreaterThan(1);
    expect(rendered.bytes.byteLength).toBeGreaterThan(1_000);
  });
});
