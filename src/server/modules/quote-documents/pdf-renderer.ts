import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import { brandContact, brandIdentity, brandWebsiteLabel } from '@/lib/brand';
import { BUSINESS_TIMEZONE, timeZoneParts } from '@/lib/calendar-timezone';
import { amountInWords } from '@/server/modules/quote-documents/amount-in-words';
import { embedQuotePdfTypefaces, type QuotePdfTypefaces } from '@/server/modules/quote-documents/pdf-fonts';
import { drawText, drawTextRight, textWidth, wrapText, type TextStyle } from '@/server/modules/quote-documents/pdf-text';
import { PAGE, PDF_COLORS } from '@/server/modules/quote-documents/pdf-theme';
import { parseRichText, type RichTextBlock } from '@/server/modules/quote-documents/rich-text';

export const QUOTE_PDF_TEMPLATE_VERSION = 'quote-pdf-v3';

const FIXED_METADATA_DATE = new Date('2026-01-01T00:00:00.000Z');
const LOGO_PATH = path.resolve(process.cwd(), 'src/server/modules/quote-documents/assets/ocpool-logo-print.png');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const RIGHT_EDGE = PAGE.marginX + PAGE.contentWidth;
const MAX_NOTE_LINES = 40;

export type QuotePdfLine = Readonly<{
  name: string;
  description?: string | null;
  unit: string;
  quantityMilliunits: bigint;
  unitPriceMinor: bigint;
  /** Descuento de la partida en puntos base (1 000 = 10 %). */
  discountBasisPoints: number;
  discountMinor: bigint;
  /** Importe antes de impuestos: cantidad × precio − descuento. */
  taxableMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  /** Sección a la que pertenece la partida; null si va suelta. */
  sectionKey: string | null;
}>;

export type QuotePdfSection = Readonly<{ key: string; title: string; description?: string | null }>;

export type QuotePdfTerms = Readonly<{ title: string; versionTag: string; bodyMarkdown: string; privacyMarkdown: string }>;

export type QuotePdfSnapshot = Readonly<{
  folio: string;
  versionNumber: number;
  /** Momento de la generación: la fecha de emisión que se imprime. */
  issuedAt: Date;
  clientName: string;
  contactName?: string | null;
  advisorName?: string | null;
  projectType: string;
  location: string;
  /** Descripción de la solicitud; sólo se imprime como alcance si la versión no trae uno propio. */
  description: string;
  currencyCode: string;
  validUntil: Date | null;
  taxLabel?: string | null;
  sections: readonly QuotePdfSection[];
  lines: readonly QuotePdfLine[];
  scopeText?: string | null;
  exclusionsText?: string | null;
  paymentTermsText?: string | null;
  warrantyText?: string | null;
  publicNotesText?: string | null;
  terms?: QuotePdfTerms | null;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxableTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
}>;

export type RenderedQuotePdf = Readonly<{
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  pageCount: number;
  templateVersion: string;
}>;

export type QuotePdfLineGroup = Readonly<{ section: QuotePdfSection | null; lines: readonly QuotePdfLine[]; subtotalMinor: bigint }>;

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function groupThousands(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/**
 * "$687,880.00": todos los importes están en la misma moneda, que el documento indica aparte. Los
 * negativos (descuentos) llevan el signo menos tipográfico, no un guion.
 */
export function formatQuotePdfAmount(amount: bigint): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? '−' : ''}$${groupThousands(absolute / 100n)}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function formatQuantity(quantityMilliunits: bigint): string {
  const negative = quantityMilliunits < 0n;
  const absolute = negative ? -quantityMilliunits : quantityMilliunits;
  const fraction = (absolute % 1_000n).toString().padStart(3, '0').replace(/0+$/u, '');
  return `${negative ? '-' : ''}${groupThousands(absolute / 1_000n)}${fraction ? `.${fraction}` : ''}`;
}

function formatDiscount(line: QuotePdfLine): string {
  if (line.discountBasisPoints > 0) {
    const percent = line.discountBasisPoints / 100;
    return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2).replace(/0$/u, '')}%`;
  }
  return line.discountMinor > 0n ? formatQuotePdfAmount(-line.discountMinor) : '—';
}

/** Fecha en la zona horaria del negocio: "28 de septiembre de 2026". */
export function formatQuotePdfDate(date: Date): string {
  const parts = timeZoneParts(date, BUSINESS_TIMEZONE);
  return `${parts.day} de ${MONTHS[parts.month - 1]} de ${parts.year}`;
}

// `validUntil` se guarda como el instante UTC de las 23:59:59.999 en America/Chihuahua del día
// elegido (ver `zonedCalendarDateEndOfDayToUtc`) -- por estar Chihuahua detrás de UTC, ese instante
// siempre cae en el día calendario UTC SIGUIENTE, así que leer `getUTCDate()`/`getUTCMonth()`
// directamente imprimía la "VIGENCIA" de la propuesta un día después del que el equipo configuró.
export function formatQuotePdfValidUntil(date: Date | null): string {
  return date ? formatQuotePdfDate(date) : 'Sin fecha de vencimiento';
}

function currencyDescription(code: string): string {
  if (code === 'MXN') return 'pesos mexicanos (MXN)';
  if (code === 'USD') return 'dólares estadounidenses (USD)';
  return code;
}

/** Partidas agrupadas en el orden de sus secciones; las sueltas (o de una sección desconocida) al final. */
export function groupQuotePdfLines(sections: readonly QuotePdfSection[], lines: readonly QuotePdfLine[]): QuotePdfLineGroup[] {
  const sum = (items: readonly QuotePdfLine[]) => items.reduce((total, item) => total + item.taxableMinor, 0n);
  const known = new Set(sections.map((section) => section.key));
  const groups: QuotePdfLineGroup[] = [];
  for (const section of sections) {
    const sectionLines = lines.filter((item) => item.sectionKey === section.key);
    if (sectionLines.length > 0) groups.push({ section, lines: sectionLines, subtotalMinor: sum(sectionLines) });
  }
  const loose = lines.filter((item) => item.sectionKey === null || !known.has(item.sectionKey));
  if (loose.length > 0) groups.push({ section: null, lines: loose, subtotalMinor: sum(loose) });
  return groups;
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(faces: QuotePdfTypefaces) {
  const style = (face: keyof QuotePdfTypefaces, size: number, color: TextStyle['color'], tracking = 0): TextStyle => ({ face: faces[face], size, color, tracking });
  return {
    eyebrow: style('bold', 7, PDF_COLORS.bronzeText, 1.3),
    folio: style('display', 25, PDF_COLORS.navy),
    meta: style('regular', 8.4, PDF_COLORS.muted),
    partyName: style('display', 15.5, PDF_COLORS.navy),
    partyLine: style('regular', 8.6, PDF_COLORS.ink),
    heading: style('display', 16, PDF_COLORS.navy),
    tableHead: style('bold', 6.6, PDF_COLORS.white, 0.9),
    sectionTitle: style('display', 12, PDF_COLORS.navy),
    sectionNote: style('regular', 7.4, PDF_COLORS.muted),
    sectionAmount: style('semibold', 8, PDF_COLORS.navy),
    index: style('regular', 7.4, PDF_COLORS.muted),
    lineName: style('semibold', 8.4, PDF_COLORS.ink),
    lineNote: style('regular', 7.3, PDF_COLORS.muted),
    cell: style('regular', 8, PDF_COLORS.ink),
    cellMuted: style('regular', 7.2, PDF_COLORS.muted),
    cellStrong: style('semibold', 8, PDF_COLORS.ink),
    totalsLabel: style('regular', 8.6, PDF_COLORS.muted),
    totalsValue: style('regular', 8.6, PDF_COLORS.ink),
    totalLabel: style('bold', 7.2, PDF_COLORS.white, 1.3),
    totalValue: style('display', 18, PDF_COLORS.white),
    words: style('regular', 8.4, PDF_COLORS.ink),
    body: style('regular', 8.8, PDF_COLORS.ink),
    bodyHeading: style('bold', 8.8, PDF_COLORS.navy),
    annex: style('regular', 7.8, PDF_COLORS.ink),
    annexHeading: style('bold', 8, PDF_COLORS.navy),
    footer: style('regular', 7, PDF_COLORS.muted),
  };
}

/** Páginas, posición vertical y saltos: cada salto automático redibuja lo que deba repetirse. */
class QuoteDocument {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  onBreak: (() => void) | null = null;

  constructor(readonly pdf: PDFDocument, readonly snapshot: QuotePdfSnapshot, readonly styles: Styles, readonly logo: PDFImage) {}

  addPage(): void {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: PAGE.height - 8, width: PAGE.width, height: 8, color: PDF_COLORS.navy });
    this.y = this.pages.length === 1 ? drawCoverHeader(this) : drawRunningHeader(this);
  }

  /** Garantiza `height` puntos libres; si no caben, abre otra página. Devuelve true si saltó. */
  ensure(height: number): boolean {
    if (this.y - height >= PAGE.bodyBottom) return false;
    this.addPage();
    this.onBreak?.();
    return true;
  }
}

function drawRule(page: PDFPage, y: number): void {
  page.drawLine({ start: { x: PAGE.marginX, y }, end: { x: RIGHT_EDGE, y }, thickness: 0.6, color: PDF_COLORS.line });
  page.drawLine({ start: { x: PAGE.marginX, y }, end: { x: PAGE.marginX + 56, y }, thickness: 1.4, color: PDF_COLORS.bronze });
}

function drawParty(doc: QuoteDocument, label: string, name: string, lines: readonly string[], x: number, top: number, width: number): number {
  const { page, styles } = doc;
  drawText(page, label, x, top, styles.eyebrow);
  let y = top - 21;
  for (const nameLine of wrapText(name, styles.partyName, width).slice(0, 2)) {
    drawText(page, nameLine, x, y, styles.partyName);
    y -= 17;
  }
  y -= 1;
  for (const entry of lines) {
    for (const wrapped of wrapText(entry, styles.partyLine, width).slice(0, 2)) {
      drawText(page, wrapped, x, y, styles.partyLine);
      y -= 12.5;
    }
  }
  return y;
}

function drawCoverHeader(doc: QuoteDocument): number {
  const { page, snapshot, styles, logo } = doc;
  const top = PAGE.height - 8;
  const logoWidth = 96;
  const logoHeight = logoWidth * (logo.height / logo.width);
  const logoBottom = top - 30 - logoHeight;
  page.drawImage(logo, { x: PAGE.marginX, y: logoBottom, width: logoWidth, height: logoHeight });
  drawTextRight(page, 'COTIZACIÓN', RIGHT_EDGE, top - 44, styles.eyebrow);
  drawTextRight(page, cleanText(snapshot.folio), RIGHT_EDGE, top - 72, styles.folio);
  const meta = [
    `Versión ${snapshot.versionNumber} · Emitida el ${formatQuotePdfDate(snapshot.issuedAt)}`,
    snapshot.validUntil ? `Vigente hasta el ${formatQuotePdfDate(snapshot.validUntil)}` : 'Sin fecha de vencimiento',
  ];
  meta.forEach((entry, index) => drawTextRight(page, entry, RIGHT_EDGE, top - 92 - (index * 13), styles.meta));
  const ruleY = Math.min(logoBottom, top - 105) - 20;
  drawRule(page, ruleY);

  const gap = 32;
  const width = (PAGE.contentWidth - gap) / 2;
  const partiesTop = ruleY - 28;
  const client = [
    snapshot.contactName ? `Atención: ${cleanText(snapshot.contactName)}` : '',
    cleanText(snapshot.projectType),
    cleanText(snapshot.location),
  ].filter(Boolean);
  const issuer = [
    snapshot.advisorName ? `Asesor: ${cleanText(snapshot.advisorName)}` : '',
    brandContact.email,
    `${brandContact.phone} · ${brandWebsiteLabel}`,
  ].filter(Boolean);
  const leftBottom = drawParty(doc, 'PREPARADA PARA', cleanText(snapshot.clientName), client, PAGE.marginX, partiesTop, width);
  const rightBottom = drawParty(doc, 'EMITIDA POR', brandIdentity.name, issuer, PAGE.marginX + width + gap, partiesTop, width);
  return Math.min(leftBottom, rightBottom) - 18;
}

function drawRunningHeader(doc: QuoteDocument): number {
  const { page, snapshot, styles, logo } = doc;
  const top = PAGE.height - 8;
  const logoWidth = 48;
  const logoHeight = logoWidth * (logo.height / logo.width);
  const logoBottom = top - 20 - logoHeight;
  page.drawImage(logo, { x: PAGE.marginX, y: logoBottom, width: logoWidth, height: logoHeight });
  drawTextRight(page, 'COTIZACIÓN', RIGHT_EDGE, top - 30, styles.eyebrow);
  drawTextRight(page, `${cleanText(snapshot.folio)} · Versión ${snapshot.versionNumber}`, RIGHT_EDGE, top - 45, styles.meta);
  const ruleY = logoBottom - 14;
  drawRule(page, ruleY);
  return ruleY - 24;
}

/** Título de apartado con filete bronce; reserva espacio para `keepWith` puntos del contenido. */
function drawHeading(doc: QuoteDocument, title: string, keepWith = 30): void {
  doc.ensure(40 + keepWith);
  const baseline = doc.y - 16;
  drawText(doc.page, title, PAGE.marginX, baseline, doc.styles.heading);
  doc.page.drawLine({ start: { x: PAGE.marginX, y: baseline - 9 }, end: { x: PAGE.marginX + 28, y: baseline - 9 }, thickness: 1.1, color: PDF_COLORS.bronze });
  doc.y = baseline - 24;
}

type Columns = Readonly<{ index: number; concept: number; conceptWidth: number; quantityRight: number; priceRight: number; discountRight: number | null; amountRight: number }>;

function tableColumns(showDiscount: boolean): Columns {
  const amountRight = RIGHT_EDGE - 10;
  const discountRight = showDiscount ? amountRight - 82 : null;
  const priceRight = (discountRight ?? amountRight) - (showDiscount ? 48 : 82);
  const quantityRight = priceRight - 80;
  const concept = PAGE.marginX + 28;
  return { index: PAGE.marginX + 10, concept, conceptWidth: quantityRight - 66 - concept, quantityRight, priceRight, discountRight, amountRight };
}

function drawTableHeader(doc: QuoteDocument, columns: Columns): void {
  const { page, styles } = doc;
  const height = 22;
  page.drawRectangle({ x: PAGE.marginX, y: doc.y - height, width: PAGE.contentWidth, height, color: PDF_COLORS.navy });
  const baseline = doc.y - 14;
  drawText(page, '#', columns.index, baseline, styles.tableHead);
  drawText(page, 'CONCEPTO', columns.concept, baseline, styles.tableHead);
  drawTextRight(page, 'CANTIDAD', columns.quantityRight, baseline, styles.tableHead);
  drawTextRight(page, 'P. UNITARIO', columns.priceRight, baseline, styles.tableHead);
  if (columns.discountRight !== null) drawTextRight(page, 'DESC.', columns.discountRight, baseline, styles.tableHead);
  drawTextRight(page, 'IMPORTE', columns.amountRight, baseline, styles.tableHead);
  doc.y -= height;
}

function sectionRowLayout(doc: QuoteDocument, columns: Columns, group: QuotePdfLineGroup, continued: boolean) {
  const titleWidth = columns.amountRight - 96 - columns.concept;
  const title = `${group.section ? cleanText(group.section.title) : 'Otros conceptos'}${continued ? ' (continuación)' : ''}`;
  const titleLines = wrapText(title, doc.styles.sectionTitle, titleWidth).slice(0, 2);
  const notes = !continued && group.section?.description ? wrapText(group.section.description, doc.styles.sectionNote, titleWidth).slice(0, 6) : [];
  const height = 17 + ((titleLines.length - 1) * 14) + (notes.length ? 4 + (notes.length * 9.6) : 0) + 9;
  return { titleLines, notes, height };
}

function drawSectionRow(doc: QuoteDocument, columns: Columns, group: QuotePdfLineGroup, continued: boolean): void {
  const { page, styles } = doc;
  const layout = sectionRowLayout(doc, columns, group, continued);
  page.drawRectangle({ x: PAGE.marginX, y: doc.y - layout.height, width: PAGE.contentWidth, height: layout.height, color: PDF_COLORS.paper });
  const baseline = doc.y - 17;
  layout.titleLines.forEach((entry, index) => drawText(page, entry, columns.concept, baseline - (index * 14), styles.sectionTitle));
  if (!continued) drawTextRight(page, formatQuotePdfAmount(group.subtotalMinor), columns.amountRight, baseline, styles.sectionAmount);
  const notesTop = baseline - ((layout.titleLines.length - 1) * 14) - 13;
  layout.notes.forEach((entry, index) => drawText(page, entry, columns.concept, notesTop - (index * 9.6), styles.sectionNote));
  doc.y -= layout.height;
  page.drawLine({ start: { x: PAGE.marginX, y: doc.y }, end: { x: RIGHT_EDGE, y: doc.y }, thickness: 0.5, color: PDF_COLORS.line });
}

type LineLayout = Readonly<{ nameLines: string[]; noteLines: string[]; quantity: string; unit: string | null; height: number }>;

function lineRowLayout(doc: QuoteDocument, columns: Columns, line: QuotePdfLine): LineLayout {
  const { styles } = doc;
  const nameLines = wrapText(line.name, styles.lineName, columns.conceptWidth);
  const allNotes = wrapText(line.description ?? '', styles.lineNote, columns.conceptWidth);
  const noteLines = allNotes.length > MAX_NOTE_LINES ? [...allNotes.slice(0, MAX_NOTE_LINES - 1), `${allNotes[MAX_NOTE_LINES - 1]}…`] : allNotes;
  const quantity = formatQuantity(line.quantityMilliunits);
  const unit = cleanText(line.unit);
  const inline = unit ? `${quantity} ${unit}` : quantity;
  const fitsInline = textWidth(inline, styles.cell) <= 64;
  const contentHeight = (Math.max(1, nameLines.length) * 10.6) + (noteLines.length ? 2 + (noteLines.length * 9.3) : 0);
  return { nameLines, noteLines, quantity: fitsInline ? inline : quantity, unit: fitsInline ? null : unit, height: Math.max(fitsInline ? 30 : 34, 17 + contentHeight) };
}

function drawLineRow(doc: QuoteDocument, columns: Columns, line: QuotePdfLine, index: number, layout: LineLayout): void {
  const { page, styles } = doc;
  const baseline = doc.y - 16;
  drawText(page, String(index), columns.index, baseline, styles.index);
  layout.nameLines.forEach((entry, lineIndex) => drawText(page, entry, columns.concept, baseline - (lineIndex * 10.6), styles.lineName));
  const notesTop = baseline - (layout.nameLines.length * 10.6) - 1.5;
  layout.noteLines.forEach((entry, lineIndex) => drawText(page, entry, columns.concept, notesTop - (lineIndex * 9.3), styles.lineNote));
  drawTextRight(page, layout.quantity, columns.quantityRight, baseline, styles.cell);
  if (layout.unit) drawTextRight(page, layout.unit, columns.quantityRight, baseline - 10, styles.cellMuted);
  drawTextRight(page, formatQuotePdfAmount(line.unitPriceMinor), columns.priceRight, baseline, styles.cell);
  if (columns.discountRight !== null) drawTextRight(page, formatDiscount(line), columns.discountRight, baseline, styles.cell);
  drawTextRight(page, formatQuotePdfAmount(line.taxableMinor), columns.amountRight, baseline, styles.cellStrong);
  doc.y -= layout.height;
  page.drawLine({ start: { x: PAGE.marginX, y: doc.y }, end: { x: RIGHT_EDGE, y: doc.y }, thickness: 0.5, color: PDF_COLORS.line });
}

function drawLineTable(doc: QuoteDocument): void {
  const { snapshot } = doc;
  const showDiscount = snapshot.lines.some((item) => item.discountBasisPoints > 0 || item.discountMinor > 0n);
  const columns = tableColumns(showDiscount);
  const groups = groupQuotePdfLines(snapshot.sections, snapshot.lines);
  const showSections = groups.some((group) => group.section !== null);
  let currentGroup: QuotePdfLineGroup | null = null;
  // El título de una sección nunca queda solo al pie de página: baja junto con su primera partida.
  const groupOpeningHeight = (group: QuotePdfLineGroup) => (showSections ? sectionRowLayout(doc, columns, group, false).height : 0)
    + (group.lines[0] ? lineRowLayout(doc, columns, group.lines[0]).height : 0);

  doc.onBreak = null;
  drawHeading(doc, 'Propuesta económica', 22 + (groups[0] ? groupOpeningHeight(groups[0]) : 0));
  drawTableHeader(doc, columns);
  doc.onBreak = () => {
    drawTableHeader(doc, columns);
    if (showSections && currentGroup) drawSectionRow(doc, columns, currentGroup, true);
  };
  let index = 0;
  for (const group of groups) {
    // Una sección que empieza en página nueva no debe repetirse como "continuación".
    currentGroup = null;
    if (showSections) {
      doc.ensure(groupOpeningHeight(group));
      drawSectionRow(doc, columns, group, false);
    }
    currentGroup = group;
    for (const line of group.lines) {
      index += 1;
      const layout = lineRowLayout(doc, columns, line);
      doc.ensure(layout.height);
      drawLineRow(doc, columns, line, index, layout);
    }
  }
  doc.onBreak = null;
}

function drawTotals(doc: QuoteDocument): void {
  const { snapshot, styles } = doc;
  const rows: Array<readonly [string, string]> = [['Subtotal', formatQuotePdfAmount(snapshot.subtotalMinor)]];
  if (snapshot.discountTotalMinor > 0n) {
    rows.push(['Descuento', formatQuotePdfAmount(-snapshot.discountTotalMinor)]);
    rows.push(['Subtotal neto', formatQuotePdfAmount(snapshot.taxableTotalMinor)]);
  }
  rows.push([cleanText(snapshot.taxLabel) || 'Impuestos', formatQuotePdfAmount(snapshot.taxTotalMinor)]);

  const rowHeight = 16;
  const totalHeight = 38;
  const blockWidth = 228;
  const blockX = RIGHT_EDGE - blockWidth;
  const leftWidth = blockX - PAGE.marginX - 28;
  const words = amountInWords(snapshot.totalMinor, snapshot.currencyCode);
  const wordsLines = words ? wrapText(words, styles.words, leftWidth) : [];
  const validity = snapshot.validUntil ? ` Propuesta vigente hasta el ${formatQuotePdfDate(snapshot.validUntil)}.` : '';
  const noteLines = wrapText(`Importes en ${currencyDescription(snapshot.currencyCode)}.${validity}`, styles.meta, leftWidth);
  const leftHeight = (wordsLines.length ? 17 + (wordsLines.length * 12) + 8 : 0) + (noteLines.length * 11.5);
  const rightHeight = (rows.length * rowHeight) + 10 + totalHeight;
  doc.ensure(Math.max(leftHeight, rightHeight) + 22);
  const top = doc.y - 20;

  let y = top;
  for (const [label, value] of rows) {
    drawText(doc.page, label, blockX + 14, y - 11, styles.totalsLabel);
    drawTextRight(doc.page, value, RIGHT_EDGE - 14, y - 11, styles.totalsValue);
    y -= rowHeight;
  }
  y -= 10;
  doc.page.drawRectangle({ x: blockX, y: y - totalHeight, width: blockWidth, height: totalHeight, color: PDF_COLORS.navy });
  drawText(doc.page, 'TOTAL', blockX + 14, y - 23, styles.totalLabel);
  drawTextRight(doc.page, `${formatQuotePdfAmount(snapshot.totalMinor)} ${snapshot.currencyCode}`, RIGHT_EDGE - 14, y - 25.5, styles.totalValue);
  const rightBottom = y - totalHeight;

  let leftY = top - 11;
  if (wordsLines.length) {
    drawText(doc.page, 'IMPORTE CON LETRA', PAGE.marginX, leftY, styles.eyebrow);
    leftY -= 17;
    for (const entry of wordsLines) {
      drawText(doc.page, entry, PAGE.marginX, leftY, styles.words);
      leftY -= 12;
    }
    leftY -= 8;
  }
  for (const entry of noteLines) {
    drawText(doc.page, entry, PAGE.marginX, leftY, styles.meta);
    leftY -= 11.5;
  }
  doc.y = Math.min(rightBottom, leftY) - 18;
}

function drawRichBlocks(doc: QuoteDocument, blocks: readonly RichTextBlock[], body: TextStyle, heading: TextStyle, leading: number): void {
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const lines = wrapText(block.text, heading, PAGE.contentWidth);
      doc.ensure(8 + (lines.length * (leading + 1)) + (leading * 2));
      doc.y -= 8;
      for (const entry of lines) {
        drawText(doc.page, entry, PAGE.marginX, doc.y - heading.size, heading);
        doc.y -= leading + 1;
      }
      doc.y -= 2;
      continue;
    }
    const marker = block.kind === 'bullet' ? block.marker : null;
    const indent = marker ? Math.max(12, textWidth(marker, body) + 6) : 0;
    const lines = wrapText(block.text, body, PAGE.contentWidth - indent);
    lines.forEach((entry, lineIndex) => {
      doc.ensure(leading + 2);
      const baseline = doc.y - body.size;
      if (marker && lineIndex === 0) drawText(doc.page, marker, PAGE.marginX + (marker === '•' ? 2 : 0), baseline, marker === '•' ? { ...body, color: PDF_COLORS.bronze } : body);
      drawText(doc.page, entry, PAGE.marginX + indent, baseline, body);
      doc.y -= leading;
    });
    doc.y -= marker ? 2.5 : 6;
  }
}

/** Alto que ocuparán los bloques, con las mismas reglas de corte y espaciado que `drawRichBlocks`. */
function measureRichBlocks(blocks: readonly RichTextBlock[], body: TextStyle, heading: TextStyle, leading: number): number {
  let height = 0;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      height += 8 + (wrapText(block.text, heading, PAGE.contentWidth).length * (leading + 1)) + 2;
      continue;
    }
    const indent = block.kind === 'bullet' ? Math.max(12, textWidth(block.marker, body) + 6) : 0;
    height += (wrapText(block.text, body, PAGE.contentWidth - indent).length * leading) + (block.kind === 'bullet' ? 2.5 : 6);
  }
  return height;
}

// Un apartado corto (hasta ~16 renglones) pasa completo a la página siguiente en vez de partirse.
const KEEP_TOGETHER_MAX_HEIGHT = 220;
const BODY_LEADING = 13.2;

function drawTextSection(doc: QuoteDocument, title: string, source: string | null | undefined): void {
  const blocks = parseRichText(source);
  if (blocks.length === 0) return;
  const { body, bodyHeading } = doc.styles;
  const contentHeight = measureRichBlocks(blocks, body, bodyHeading, BODY_LEADING);
  doc.onBreak = null;
  if (contentHeight <= KEEP_TOGETHER_MAX_HEIGHT) doc.ensure(40 + contentHeight);
  drawHeading(doc, title, Math.min(contentHeight, 3 * BODY_LEADING));
  doc.onBreak = () => drawHeading(doc, `${title} (continuación)`, 0);
  drawRichBlocks(doc, blocks, body, bodyHeading, BODY_LEADING);
  doc.onBreak = null;
  doc.y -= 10;
}

const COMMERCIAL_SECTIONS: ReadonlyArray<readonly [string, (snapshot: QuotePdfSnapshot) => string | null | undefined]> = [
  ['Alcance', (snapshot) => (snapshot.scopeText?.trim() ? snapshot.scopeText : snapshot.description)],
  ['Exclusiones', (snapshot) => snapshot.exclusionsText],
  ['Condiciones de pago', (snapshot) => snapshot.paymentTermsText],
  ['Garantías', (snapshot) => snapshot.warrantyText],
  ['Notas', (snapshot) => snapshot.publicNotesText],
];

const ACCEPTANCE_TEXT = `Puedes aceptar esta propuesta o solicitarnos cambios desde tu portal de cliente en ${brandWebsiteLabel}/portal. La aceptación queda registrada con la versión, los importes y las condiciones de este documento.`;

function drawTermsAnnex(doc: QuoteDocument): void {
  const terms = doc.snapshot.terms;
  if (!terms) return;
  const blocks = [...parseRichText(terms.bodyMarkdown), ...parseRichText(terms.privacyMarkdown)];
  if (blocks.length === 0) return;
  doc.onBreak = null;
  doc.addPage();
  drawHeading(doc, 'Condiciones comerciales');
  drawText(doc.page, `${cleanText(terms.title)} · Versión ${cleanText(terms.versionTag)}`, PAGE.marginX, doc.y - 4, doc.styles.meta);
  doc.y -= 18;
  doc.onBreak = () => drawHeading(doc, 'Condiciones comerciales (continuación)', 0);
  drawRichBlocks(doc, blocks, doc.styles.annex, doc.styles.annexHeading, 11.2);
  doc.onBreak = null;
}

function drawFooters(doc: QuoteDocument): void {
  const { styles, snapshot } = doc;
  const total = doc.pages.length;
  doc.pages.forEach((page, index) => {
    page.drawLine({ start: { x: PAGE.marginX, y: PAGE.footerBaseline + 14 }, end: { x: RIGHT_EDGE, y: PAGE.footerBaseline + 14 }, thickness: 0.5, color: PDF_COLORS.line });
    drawText(page, `${brandIdentity.name} · ${brandIdentity.tagline}`, PAGE.marginX, PAGE.footerBaseline, styles.footer);
    drawTextRight(page, `${cleanText(snapshot.folio)} · v${snapshot.versionNumber} · Página ${index + 1} de ${total}`, RIGHT_EDGE, PAGE.footerBaseline, styles.footer);
  });
}

let logoBytes: Promise<Uint8Array> | null = null;

function readLogo(): Promise<Uint8Array> {
  logoBytes ??= readFile(LOGO_PATH).then((buffer) => new Uint8Array(buffer)).catch((error: unknown) => {
    logoBytes = null;
    throw error;
  });
  return logoBytes;
}

export async function renderQuotePdf(snapshot: QuotePdfSnapshot): Promise<RenderedQuotePdf> {
  if (!snapshot.folio || snapshot.versionNumber < 1 || !snapshot.currencyCode || snapshot.lines.length === 0) {
    throw new Error('Invalid quote PDF snapshot.');
  }

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const typefaces = await embedQuotePdfTypefaces(pdf);
  const logo = await pdf.embedPng(await readLogo());
  pdf.setTitle(`Cotización OCPOOL ${cleanText(snapshot.folio)} v${snapshot.versionNumber}`);
  pdf.setAuthor('OCPOOL');
  pdf.setSubject('Propuesta comercial');
  pdf.setCreator('OCPOOL');
  pdf.setProducer('OCPOOL PDF Renderer');
  pdf.setLanguage('es-MX');
  pdf.setCreationDate(FIXED_METADATA_DATE);
  pdf.setModificationDate(FIXED_METADATA_DATE);

  const doc = new QuoteDocument(pdf, snapshot, createStyles(typefaces), logo);
  doc.addPage();
  drawLineTable(doc);
  drawTotals(doc);
  for (const [title, pick] of COMMERCIAL_SECTIONS) drawTextSection(doc, title, pick(snapshot));
  drawTextSection(doc, 'Aceptación', ACCEPTANCE_TEXT);
  drawTermsAnnex(doc);
  drawFooters(doc);

  const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
  return {
    bytes,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: pdf.getPageCount(),
    templateVersion: QUOTE_PDF_TEMPLATE_VERSION,
  };
}
