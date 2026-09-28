import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

/**
 * Tipografía de la marca (Cormorant Garamond para títulos, Manrope para texto) incrustada en el PDF.
 * Helvetica estándar sólo codifica WinAnsi y rompía el render con un "≥" o un emoji en una
 * descripción; aquí cada texto se filtra contra los glifos que la fuente realmente tiene.
 */
const FONT_DIRECTORY = path.resolve(process.cwd(), 'src/server/modules/quote-documents/assets/fonts');
const FONT_FILES = {
  display: 'CormorantGaramond-SemiBold.ttf',
  regular: 'Manrope-Regular.ttf',
  semibold: 'Manrope-SemiBold.ttf',
  bold: 'Manrope-Bold.ttf',
} as const;

export type QuotePdfFontRole = keyof typeof FONT_FILES;
export type QuotePdfTypeface = Readonly<{ font: PDFFont; clean: (text: string) => string }>;
export type QuotePdfTypefaces = Readonly<Record<QuotePdfFontRole, QuotePdfTypeface>>;

type GlyphCoverage = Readonly<{ hasGlyphForCodePoint: (codePoint: number) => boolean }>;
type LoadedFont = Readonly<{ bytes: Uint8Array; coverage: GlyphCoverage }>;

// Sustitutos tipográficos antes de descartar un carácter que la fuente no tiene.
const FALLBACKS: Readonly<Record<string, string>> = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '×': 'x', '≈': '~', '…': '...', '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '•': '·' };
const ROLES = Object.keys(FONT_FILES) as QuotePdfFontRole[];

let loadedFonts: Promise<Record<QuotePdfFontRole, LoadedFont>> | null = null;

function loadFonts(): Promise<Record<QuotePdfFontRole, LoadedFont>> {
  loadedFonts ??= (async () => {
    const fonts = {} as Record<QuotePdfFontRole, LoadedFont>;
    await Promise.all(ROLES.map(async (role) => {
      const bytes = new Uint8Array(await readFile(path.join(FONT_DIRECTORY, FONT_FILES[role])));
      const coverage: GlyphCoverage = fontkit.create(bytes);
      fonts[role] = { bytes, coverage };
    }));
    return fonts;
  })().catch((error: unknown) => {
    loadedFonts = null;
    throw error;
  });
  return loadedFonts;
}

function supports(coverage: GlyphCoverage, text: string): boolean {
  return [...text].every((char) => coverage.hasGlyphForCodePoint(char.codePointAt(0)!));
}

function cleanForFont(text: string, coverage: GlyphCoverage): string {
  let output = '';
  for (const char of text.normalize('NFC')) {
    if (/\s/u.test(char)) output += ' ';
    else if (coverage.hasGlyphForCodePoint(char.codePointAt(0)!)) output += char;
    else if (FALLBACKS[char] && supports(coverage, FALLBACKS[char]!)) output += FALLBACKS[char];
  }
  return output.replace(/ {2,}/gu, ' ');
}

export async function embedQuotePdfTypefaces(pdf: PDFDocument): Promise<QuotePdfTypefaces> {
  pdf.registerFontkit(fontkit);
  const fonts = await loadFonts();
  const typefaces = {} as Record<QuotePdfFontRole, QuotePdfTypeface>;
  // Secuencial a propósito: el orden de incrustación fija el orden de los objetos (PDF determinista).
  for (const role of ROLES) {
    const { bytes, coverage } = fonts[role];
    const font = await pdf.embedFont(bytes, { subset: true, customName: `OCPOOL-${role}` });
    typefaces[role] = { font, clean: (text) => cleanForFont(text, coverage) };
  }
  return typefaces;
}
