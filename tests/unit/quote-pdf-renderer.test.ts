import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  QUOTE_PDF_TEMPLATE_VERSION,
  formatQuotePdfAmount,
  formatQuotePdfValidUntil,
  groupQuotePdfLines,
  renderQuotePdf,
  type QuotePdfLine,
  type QuotePdfSnapshot,
} from '@/server/modules/quote-documents/pdf-renderer';
import { zonedCalendarDateEndOfDayToUtc } from '@/lib/calendar-timezone';

function line(overrides: Partial<QuotePdfLine> = {}): QuotePdfLine {
  return {
    name: 'Bomba de filtración premium',
    description: 'Equipo de alta eficiencia',
    unit: 'pieza',
    quantityMilliunits: 1_000n,
    unitPriceMinor: 485_000n,
    discountBasisPoints: 0,
    discountMinor: 0n,
    taxableMinor: 485_000n,
    taxMinor: 77_600n,
    totalMinor: 562_600n,
    sectionKey: null,
    ...overrides,
  };
}

const snapshot: QuotePdfSnapshot = {
  folio: 'OCQ-2026-000123',
  versionNumber: 2,
  issuedAt: new Date('2026-09-28T18:00:00.000Z'),
  clientName: 'Constructora del Norte, S.A. de C.V.',
  contactName: 'Ana López',
  advisorName: 'Laura Méndez',
  projectType: 'Alberca residencial',
  location: 'Chihuahua, Chihuahua',
  description: 'Diseño, suministro e instalación integral de sistema de filtración.',
  currencyCode: 'MXN',
  validUntil: new Date('2026-10-15T00:00:00.000Z'),
  taxLabel: 'IVA 16%',
  sections: [],
  lines: [
    line(),
    line({ name: 'Instalación y puesta en marcha', description: 'Incluye pruebas y capacitación', unit: 'servicio', unitPriceMinor: 120_000n, discountBasisPoints: 1_000, discountMinor: 12_000n, taxableMinor: 108_000n, taxMinor: 17_280n, totalMinor: 125_280n }),
  ],
  subtotalMinor: 605_000n,
  discountTotalMinor: 12_000n,
  taxableTotalMinor: 593_000n,
  taxTotalMinor: 94_880n,
  totalMinor: 687_880n,
};

describe('quote PDF renderer', () => {
  it('prints dates in the business timezone, not the UTC calendar day', () => {
    // `validUntil` se guarda como el instante UTC de fin del día local elegido (ver
    // `zonedCalendarDateEndOfDayToUtc`) -- ese instante cae en el día calendario UTC siguiente, así
    // que leerlo con getUTCDate()/getUTCMonth() imprimía la vigencia un día tarde.
    expect(formatQuotePdfValidUntil(zonedCalendarDateEndOfDayToUtc('2026-10-15'))).toBe('15 de octubre de 2026');
    expect(formatQuotePdfValidUntil(zonedCalendarDateEndOfDayToUtc('2026-01-31'))).toBe('31 de enero de 2026');
    expect(formatQuotePdfValidUntil(zonedCalendarDateEndOfDayToUtc('2026-10-05'))).toBe('5 de octubre de 2026');
    expect(formatQuotePdfValidUntil(null)).toBe('Sin fecha de vencimiento');
  });

  it('formats amounts with thousands separators and sign', () => {
    expect(formatQuotePdfAmount(68_788_000n)).toBe('$687,880.00');
    expect(formatQuotePdfAmount(-1_200n)).toBe('−$12.00');
    expect(formatQuotePdfAmount(5n)).toBe('$0.05');
  });

  it('renders a deterministic, paginated PDF from the frozen quote snapshot', async () => {
    const first = await renderQuotePdf(snapshot);
    const second = await renderQuotePdf({ ...snapshot, lines: [...snapshot.lines] });

    expect(first.templateVersion).toBe(QUOTE_PDF_TEMPLATE_VERSION);
    expect(QUOTE_PDF_TEMPLATE_VERSION).toBe('quote-pdf-v3');
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
    expect(first.byteSize).toBe(first.bytes.byteLength);
    expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'));
    expect(first.pageCount).toBeGreaterThanOrEqual(1);

    const document = await PDFDocument.load(first.bytes);
    expect(document.getPageCount()).toBe(first.pageCount);
    expect(document.getTitle()).toBe('Cotización OCPOOL OCQ-2026-000123 v2');
    expect(document.getAuthor()).toBe('OCPOOL');
  }, 15_000);

  it('does not depend on catalog or internal payload fields once the snapshot exists', async () => {
    const rendered = await renderQuotePdf(snapshot);
    const mutatedCatalogContext = await renderQuotePdf({ ...snapshot, lines: snapshot.lines.map((item) => ({ ...item })) });
    expect(rendered.sha256).toBe(mutatedCatalogContext.sha256);
    expect(Buffer.from(rendered.bytes).includes(Buffer.from('secret-internal-note'))).toBe(false);
  });

  it('supports long line descriptions without dropping totals', async () => {
    const rendered = await renderQuotePdf({
      ...snapshot,
      lines: Array.from({ length: 34 }, (_, index) => line({
        name: `Concepto premium ${index + 1}`,
        description: 'Descripción extensa de prueba para verificar saltos de línea y continuidad entre páginas sin romper la tabla comercial.',
        unitPriceMinor: 1_000n,
        taxableMinor: 1_000n,
        taxMinor: 160n,
        totalMinor: 1_160n,
      })),
    });
    expect(rendered.pageCount).toBeGreaterThan(1);
    expect(rendered.bytes.byteLength).toBeGreaterThan(1_000);
  });

  it('paginates the complete scope instead of truncating it', async () => {
    const rendered = await renderQuotePdf({ ...snapshot, scopeText: Array.from({ length: 180 }, (_, index) => `Alcance contractual ${index + 1} SCOPE-END-MARKER`).join(' ') });
    expect(rendered.pageCount).toBeGreaterThan(1);
    const document = await PDFDocument.load(rendered.bytes);
    expect(document.getPageCount()).toBe(rendered.pageCount);
  });

  it('groups lines by section order and leaves loose lines for the end', () => {
    const groups = groupQuotePdfLines(
      [{ key: 'obra', title: 'Obra civil' }, { key: 'vacia', title: 'Sin partidas' }, { key: 'equipo', title: 'Equipamiento' }],
      [line({ name: 'suelta', taxableMinor: 5n }), line({ name: 'bomba', sectionKey: 'equipo', taxableMinor: 7n }), line({ name: 'trazo', sectionKey: 'obra', taxableMinor: 3n }), line({ name: 'huérfana', sectionKey: 'borrada', taxableMinor: 1n })],
    );
    expect(groups.map((group) => group.section?.key ?? null)).toEqual(['obra', 'equipo', null]);
    expect(groups.map((group) => group.lines.map((item) => item.name))).toEqual([['trazo'], ['bomba'], ['suelta', 'huérfana']]);
    expect(groups.map((group) => group.subtotalMinor)).toEqual([3n, 7n, 6n]);
  });

  it('renders sections, commercial texts and the terms annex, and survives characters outside the fonts', async () => {
    const rendered = await renderQuotePdf({
      ...snapshot,
      sections: [{ key: 'obra', title: 'Obra civil', description: 'Trazo, excavación y estructura del vaso.' }, { key: 'equipo', title: 'Equipamiento ≥ premium 🏊' }],
      lines: [line({ sectionKey: 'equipo', name: 'Bomba → 1.5 HP 🏊' }), line({ sectionKey: 'obra', name: 'Excavación', unit: 'metro cúbico', quantityMilliunits: 48_500n })],
      scopeText: 'Construcción del vaso.\n- Obra civil\n- Equipamiento',
      exclusionsText: '- Permisos municipales',
      paymentTermsText: '1. 50 % de anticipo\n2. 50 % contra entrega',
      warrantyText: 'Cinco años en estructura.',
      publicNotesText: 'Tiempo estimado: 8 semanas.',
      terms: { title: 'Condiciones comerciales', versionTag: 'v1', bodyMarkdown: '## 1. Objeto\n\nTexto del objeto.\n\n- Punto uno', privacyMarkdown: '## Aviso de privacidad\n\nTexto.' },
    });
    expect(rendered.pageCount).toBeGreaterThanOrEqual(2);
  }, 15_000);
});
