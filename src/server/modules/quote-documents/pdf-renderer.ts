import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export const QUOTE_PDF_TEMPLATE_VERSION = 'quote-pdf-v2';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 42;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);
const FOOTER_Y = 30;
const BODY_BOTTOM = 82;
const FIXED_METADATA_DATE = new Date('2026-01-01T00:00:00.000Z');
const OFFICIAL_LOGO_PATH = path.resolve(process.cwd(), 'public/brand/ocpool-logo.png');
const TERMS_LINE_HEIGHT = 11;
const TERMS_HEADER_HEIGHT = 24;
const TERMS_LEGAL_NOTE = 'Esta propuesta se emite con base en el alcance y los importes snapshot de la versión indicada.';

const COLORS = {
  ink: rgb(0.10, 0.12, 0.14),
  muted: rgb(0.38, 0.41, 0.43),
  copper: rgb(0.67, 0.36, 0.20),
  copperLight: rgb(0.96, 0.92, 0.88),
  rule: rgb(0.84, 0.84, 0.82),
  surface: rgb(0.975, 0.975, 0.965),
  white: rgb(1, 1, 1),
};

export type QuotePdfLine = Readonly<{
  name: string;
  description?: string | null;
  unit: string;
  quantityMilliunits: bigint;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}>;

export type QuotePdfSnapshot = Readonly<{
  folio: string;
  versionNumber: number;
  clientName: string;
  projectType: string;
  location: string;
  description: string;
  currencyCode: string;
  validUntil: Date | null;
  lines: readonly QuotePdfLine[];
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

function cleanText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function formatMinorAmount(amount: bigint, currencyCode: string): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${currencyCode} $${grouped}.${cents}`;
}

function formatQuantity(quantityMilliunits: bigint): string {
  const negative = quantityMilliunits < 0n;
  const absolute = negative ? -quantityMilliunits : quantityMilliunits;
  const whole = absolute / 1_000n;
  const fraction = (absolute % 1_000n).toString().padStart(3, '0').replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

function formatDate(date: Date | null): string {
  if (!date) return 'Sin fecha de vencimiento';
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${date.getUTCDate().toString().padStart(2, '0')} de ${months[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const text = cleanText(value);
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function drawRightAligned(page: PDFPage, text: string, x: number, width: number, y: number, font: PDFFont, size: number, color = COLORS.ink): void {
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: x + width - textWidth, y, size, font, color });
}

function drawFooter(page: PDFPage, pageNumber: number, folio: string, regular: PDFFont): void {
  page.drawLine({ start: { x: MARGIN_X, y: FOOTER_Y + 16 }, end: { x: PAGE_WIDTH - MARGIN_X, y: FOOTER_Y + 16 }, thickness: 0.5, color: COLORS.rule });
  page.drawText('OCPOOL · Propuesta comercial confidencial', { x: MARGIN_X, y: FOOTER_Y, size: 7.5, font: regular, color: COLORS.muted });
  drawRightAligned(page, `${folio} · Página ${pageNumber}`, MARGIN_X, CONTENT_WIDTH, FOOTER_Y, regular, 7.5, COLORS.muted);
}

function drawFirstPageHeader(page: PDFPage, snapshot: QuotePdfSnapshot, regular: PDFFont, bold: PDFFont, logo: PDFImage): number {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 10, width: PAGE_WIDTH, height: 10, color: COLORS.copper });
  page.drawImage(logo, { x: MARGIN_X, y: PAGE_HEIGHT - 84, width: 72, height: 54 });
  page.drawText('PROPUESTA COMERCIAL', { x: MARGIN_X, y: PAGE_HEIGHT - 96, size: 9, font: bold, color: COLORS.copper });
  drawRightAligned(page, snapshot.folio, MARGIN_X, CONTENT_WIDTH, PAGE_HEIGHT - 56, bold, 12, COLORS.ink);
  drawRightAligned(page, `Versión ${snapshot.versionNumber}`, MARGIN_X, CONTENT_WIDTH, PAGE_HEIGHT - 75, regular, 9, COLORS.muted);
  page.drawLine({ start: { x: MARGIN_X, y: PAGE_HEIGHT - 100 }, end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 100 }, thickness: 1, color: COLORS.rule });

  const panelTop = PAGE_HEIGHT - 125;
  const panelHeight = 86;
  page.drawRectangle({ x: MARGIN_X, y: panelTop - panelHeight, width: CONTENT_WIDTH, height: panelHeight, color: COLORS.surface });
  const leftX = MARGIN_X + 14;
  const rightX = MARGIN_X + 274;
  const labelSize = 7.5;
  const valueSize = 9.5;
  const rows = [
    ['CLIENTE', cleanText(snapshot.clientName), 'PROYECTO', cleanText(snapshot.projectType)],
    ['UBICACIÓN', cleanText(snapshot.location), 'VIGENCIA', formatDate(snapshot.validUntil)],
  ];
  rows.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
    const y = panelTop - 25 - (index * 31);
    page.drawText(leftLabel, { x: leftX, y, size: labelSize, font: bold, color: COLORS.copper });
    page.drawText(leftValue, { x: leftX, y: y - 13, size: valueSize, font: regular, color: COLORS.ink, maxWidth: 235 });
    page.drawText(rightLabel, { x: rightX, y, size: labelSize, font: bold, color: COLORS.copper });
    page.drawText(rightValue, { x: rightX, y: y - 13, size: valueSize, font: regular, color: COLORS.ink, maxWidth: 235 });
  });
  return panelTop - panelHeight - 26;
}

function drawContinuationHeader(page: PDFPage, snapshot: QuotePdfSnapshot, regular: PDFFont, bold: PDFFont, logo: PDFImage): number {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 10, width: PAGE_WIDTH, height: 10, color: COLORS.copper });
  page.drawImage(logo, { x: MARGIN_X, y: PAGE_HEIGHT - 60, width: 48, height: 36 });
  drawRightAligned(page, `${snapshot.folio} · Versión ${snapshot.versionNumber}`, MARGIN_X, CONTENT_WIDTH, PAGE_HEIGHT - 47, regular, 9, COLORS.muted);
  page.drawLine({ start: { x: MARGIN_X, y: PAGE_HEIGHT - 64 }, end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 64 }, thickness: 1, color: COLORS.rule });
  return PAGE_HEIGHT - 88;
}

function drawTableHeader(page: PDFPage, y: number, regular: PDFFont, bold: PDFFont): number {
  const columns = { description: MARGIN_X, quantity: 294, unitPrice: 343, total: 435 };
  page.drawRectangle({ x: MARGIN_X, y: y - 20, width: CONTENT_WIDTH, height: 20, color: COLORS.copperLight });
  page.drawText('CONCEPTO', { x: columns.description + 8, y: y - 13, size: 7.5, font: bold, color: COLORS.copper });
  drawRightAligned(page, 'CANT.', columns.quantity, 40, y - 13, bold, 7.5, COLORS.copper);
  drawRightAligned(page, 'PRECIO UNIT.', columns.unitPrice, 80, y - 13, bold, 7.5, COLORS.copper);
  drawRightAligned(page, 'TOTAL', columns.total, 90, y - 13, bold, 7.5, COLORS.copper);
  return y - 30;
}

function drawLineRow(page: PDFPage, line: QuotePdfLine, rowIndex: number, y: number, currencyCode: string, regular: PDFFont, bold: PDFFont): number {
  const descriptionLines = wrapText(line.description ?? '', regular, 7.5, 225);
  const rowHeight = Math.max(29, 19 + (descriptionLines.length * 10));
  if (rowIndex % 2 === 0) page.drawRectangle({ x: MARGIN_X, y: y - rowHeight + 5, width: CONTENT_WIDTH, height: rowHeight, color: COLORS.surface });
  page.drawText(cleanText(line.name), { x: MARGIN_X + 8, y, size: 8.5, font: bold, color: COLORS.ink, maxWidth: 225 });
  descriptionLines.forEach((text, index) => {
    page.drawText(text, { x: MARGIN_X + 8, y: y - 11 - (index * 10), size: 7.5, font: regular, color: COLORS.muted });
  });
  drawRightAligned(page, formatQuantity(line.quantityMilliunits), 294, 40, y, regular, 8.2);
  drawRightAligned(page, formatMinorAmount(line.unitPriceMinor, currencyCode), 343, 80, y, regular, 7.8);
  drawRightAligned(page, formatMinorAmount(line.totalMinor, currencyCode), 435, 90, y, bold, 7.8);
  return y - rowHeight;
}

function drawTotals(page: PDFPage, snapshot: QuotePdfSnapshot, y: number, regular: PDFFont, bold: PDFFont): number {
  const boxHeight = 116;
  const boxY = y - boxHeight;
  page.drawRectangle({ x: 322, y: boxY, width: PAGE_WIDTH - MARGIN_X - 322, height: boxHeight, color: COLORS.surface });
  page.drawText('RESUMEN', { x: 338, y: y - 19, size: 8, font: bold, color: COLORS.copper });
  const rows = [
    ['Subtotal', formatMinorAmount(snapshot.subtotalMinor, snapshot.currencyCode)],
    ['Descuento', formatMinorAmount(snapshot.discountTotalMinor, snapshot.currencyCode)],
    ['Base gravable', formatMinorAmount(snapshot.taxableTotalMinor, snapshot.currencyCode)],
    ['Impuestos', formatMinorAmount(snapshot.taxTotalMinor, snapshot.currencyCode)],
  ];
  rows.forEach(([label, value], index) => {
    const rowY = y - 37 - (index * 16);
    page.drawText(label, { x: 338, y: rowY, size: 8, font: regular, color: COLORS.muted });
    drawRightAligned(page, value, 338, 198, rowY, regular, 8);
  });
  page.drawLine({ start: { x: 338, y: y - 99 }, end: { x: PAGE_WIDTH - MARGIN_X - 16, y: y - 99 }, thickness: 0.8, color: COLORS.copper });
  page.drawText('TOTAL', { x: 338, y: y - 111, size: 9, font: bold, color: COLORS.ink });
  drawRightAligned(page, formatMinorAmount(snapshot.totalMinor, snapshot.currencyCode), 338, 198, y - 111, bold, 10, COLORS.copper);
  return boxY;
}

function drawTermsChunk(page: PDFPage, lines: readonly string[], offset: number, lineCount: number, y: number, regular: PDFFont, bold: PDFFont): number {
  page.drawText(offset === 0 ? 'ALCANCE Y CONDICIONES' : 'ALCANCE Y CONDICIONES · CONTINUACIÓN', { x: MARGIN_X, y, size: 8, font: bold, color: COLORS.copper });
  lines.slice(offset, offset + lineCount).forEach((text, index) => {
    page.drawText(text, { x: MARGIN_X, y: y - 16 - (index * TERMS_LINE_HEIGHT), size: 8.5, font: regular, color: COLORS.ink });
  });
  const nextY = y - TERMS_HEADER_HEIGHT - (lineCount * TERMS_LINE_HEIGHT);
  if (offset + lineCount >= lines.length) {
    page.drawText(TERMS_LEGAL_NOTE, { x: MARGIN_X, y: nextY, size: 7.5, font: regular, color: COLORS.muted });
    return nextY;
  }
  return nextY;
}

function drawTermsPages(pdf: PDFDocument, snapshot: QuotePdfSnapshot, lines: readonly string[], regular: PDFFont, bold: PDFFont, logo: PDFImage, pageNumber: number): number {
  let offset = 0;
  do {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    const y = drawContinuationHeader(page, snapshot, regular, bold, logo);
    const contentStartY = y - TERMS_HEADER_HEIGHT;
    const maximumWithoutLegal = Math.max(1, Math.floor((contentStartY - BODY_BOTTOM) / TERMS_LINE_HEIGHT));
    const maximumWithLegal = Math.max(0, Math.floor((contentStartY - BODY_BOTTOM - 12) / TERMS_LINE_HEIGHT));
    const remaining = lines.length - offset;
    const lineCount = remaining <= maximumWithLegal ? remaining : Math.min(remaining, maximumWithoutLegal);
    drawTermsChunk(page, lines, offset, lineCount, y, regular, bold);
    drawFooter(page, pageNumber, snapshot.folio, regular);
    offset += lineCount;
  } while (offset < lines.length);
  return pageNumber;
}

export async function renderQuotePdf(snapshot: QuotePdfSnapshot): Promise<RenderedQuotePdf> {
  if (!snapshot.folio || snapshot.versionNumber < 1 || !snapshot.currencyCode || snapshot.lines.length === 0) {
    throw new Error('Invalid quote PDF snapshot.');
  }

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(await readFile(OFFICIAL_LOGO_PATH));
  pdf.setTitle(`Cotización OCPOOL ${cleanText(snapshot.folio)} v${snapshot.versionNumber}`);
  pdf.setAuthor('OCPOOL');
  pdf.setSubject('Propuesta comercial');
  pdf.setCreator('OCPOOL');
  pdf.setProducer('OCPOOL PDF Renderer');
  pdf.setCreationDate(FIXED_METADATA_DATE);
  pdf.setModificationDate(FIXED_METADATA_DATE);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let pageNumber = 1;
  let y = drawFirstPageHeader(page, snapshot, regular, bold, logo);
  y = drawTableHeader(page, y, regular, bold);

  snapshot.lines.forEach((line, index) => {
    const descriptionLines = wrapText(line.description ?? '', regular, 7.5, 225);
    const rowHeight = Math.max(29, 19 + (descriptionLines.length * 10));
    if (y - rowHeight < BODY_BOTTOM) {
      drawFooter(page, pageNumber, snapshot.folio, regular);
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageNumber += 1;
    y = drawContinuationHeader(page, snapshot, regular, bold, logo);
      y = drawTableHeader(page, y, regular, bold);
    }
    y = drawLineRow(page, line, index, y, snapshot.currencyCode, regular, bold);
  });

  if (y - 116 - 18 < BODY_BOTTOM) {
    drawFooter(page, pageNumber, snapshot.folio, regular);
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
      y = drawContinuationHeader(page, snapshot, regular, bold, logo);
  }
  y = drawTotals(page, snapshot, y - 18, regular, bold);
  const termsLines = wrapText(snapshot.description, regular, 8.5, CONTENT_WIDTH);
  const termsY = y - 28;
  const termsFit = termsY - TERMS_HEADER_HEIGHT - (termsLines.length * TERMS_LINE_HEIGHT) >= BODY_BOTTOM;
  if (termsFit) {
    drawTermsChunk(page, termsLines, 0, termsLines.length, termsY, regular, bold);
    drawFooter(page, pageNumber, snapshot.folio, regular);
  } else {
    drawFooter(page, pageNumber, snapshot.folio, regular);
    pageNumber = drawTermsPages(pdf, snapshot, termsLines, regular, bold, logo, pageNumber);
  }

  const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
  return {
    bytes,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: pdf.getPageCount(),
    templateVersion: QUOTE_PDF_TEMPLATE_VERSION,
  };
}
