import { mkdir, writeFile } from 'node:fs/promises';
import { renderQuotePdf } from '../src/server/modules/quote-documents/pdf-renderer';

const outputDirectory = 'output/pdf';
const outputPath = `${outputDirectory}/quote-pdf-fixture.pdf`;
const lines = Array.from({ length: 18 }, (_, index) => {
  const unitPriceMinor = 10_000n + BigInt(index * 250);
  const discountMinor = index === 3 ? 2_500n : 0n;
  const taxableMinor = unitPriceMinor - discountMinor;
  const taxMinor = (taxableMinor * 16n) / 100n;
  return {
    name: `Concepto premium ${index + 1}`,
    description: 'Suministro, preparación y puesta en marcha conforme al alcance comercial acordado.',
    unit: 'pieza',
    quantityMilliunits: 1_000n,
    unitPriceMinor,
    discountMinor,
    taxMinor,
    totalMinor: taxableMinor + taxMinor,
  };
});
const subtotalMinor = lines.reduce((sum, line) => sum + line.unitPriceMinor, 0n);
const discountTotalMinor = lines.reduce((sum, line) => sum + line.discountMinor, 0n);
const taxableTotalMinor = subtotalMinor - discountTotalMinor;
const taxTotalMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0n);
const totalMinor = taxableTotalMinor + taxTotalMinor;

const rendered = await renderQuotePdf({
  folio: 'OCQ-2026-000123',
  versionNumber: 2,
  clientName: 'Constructora del Norte, S.A. de C.V.',
  projectType: 'Alberca residencial',
  location: 'Chihuahua, Chihuahua',
  description: 'Diseño, suministro e instalación integral de sistema de filtración para proyecto residencial.',
  currencyCode: 'MXN',
  validUntil: new Date('2026-10-15T00:00:00.000Z'),
  lines,
  subtotalMinor,
  discountTotalMinor,
  taxableTotalMinor,
  taxTotalMinor,
  totalMinor,
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, rendered.bytes);
console.log(JSON.stringify({ outputPath, ...rendered, bytes: undefined }, null, 2));
