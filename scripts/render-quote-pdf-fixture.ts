import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderQuotePdf, type QuotePdfLine, type QuotePdfSection } from '../src/server/modules/quote-documents/pdf-renderer';

// Muestra realista del PDF de cotización: output/pdf/quote-pdf-fixture.pdf.
const outputDirectory = 'output/pdf';
const outputPath = `${outputDirectory}/quote-pdf-fixture.pdf`;
const terms = await readFile('docs/legal/terminos-y-privacidad-comercial.md', 'utf8');
const privacyStart = terms.indexOf('## Aviso de privacidad simplificado');

const sections: QuotePdfSection[] = [
  { key: 'obra', title: 'Obra civil', description: 'Trazo, excavación y estructura del vaso de concreto armado.' },
  { key: 'equipo', title: 'Equipamiento y filtración', description: 'Equipos instalados, probados y con arranque supervisado.' },
  { key: 'acabados', title: 'Acabados' },
];

type Seed = readonly [name: string, description: string | null, unit: string, quantityMilliunits: bigint, unitPriceMinor: bigint, discountBasisPoints: number, sectionKey: string | null];
const seeds: Seed[] = [
  ['Excavación y trazo', 'Excavación a máquina, afine manual y retiro de material según planos del proyecto.', 'm³', 48_500n, 38_000n, 0, 'obra'],
  ['Cimentación y armado de acero', 'Plantilla de concreto, armado con varilla corrugada de 3/8" y cimbra perimetral.', 'm²', 36_000n, 115_000n, 0, 'obra'],
  ['Muros y losa de concreto armado', "Concreto f'c = 250 kg/cm² impermeable, vibrado y curado.", 'm³', 14_000n, 385_000n, 0, 'obra'],
  ['Bomba de filtración de velocidad variable 1.5 HP', null, 'pieza', 1_000n, 1_890_000n, 1_000, 'equipo'],
  ['Filtro de arena de 24"', 'Incluye carga de arena sílica y válvula selectora de 6 posiciones.', 'pieza', 1_000n, 1_240_000n, 0, 'equipo'],
  ['Iluminación LED RGB subacuática', 'Luminarias de 35 W con control remoto y transformador de seguridad.', 'pieza', 4_000n, 425_000n, 0, 'equipo'],
  ['Sistema de cloración salina', null, 'pieza', 1_000n, 2_150_000n, 0, 'equipo'],
  ['Recubrimiento de mosaico veneciano', 'Mosaico de vidrio 2 × 2 cm en tonos arena, con adhesivo y boquilla epóxica.', 'm²', 64_000n, 89_000n, 0, 'acabados'],
  ['Coronamiento de cantera', null, 'ml', 34_000n, 105_000n, 0, 'acabados'],
  ['Supervisión técnica de obra', 'Visitas semanales del residente de obra y bitácora fotográfica.', 'servicio', 1_000n, 1_500_000n, 0, null],
];

const lines: QuotePdfLine[] = seeds.map(([name, description, unit, quantityMilliunits, unitPriceMinor, discountBasisPoints, sectionKey]) => {
  const gross = (quantityMilliunits * unitPriceMinor) / 1_000n;
  const discountMinor = (gross * BigInt(discountBasisPoints)) / 10_000n;
  const taxableMinor = gross - discountMinor;
  const taxMinor = (taxableMinor * 16n) / 100n;
  return { name, description, unit, quantityMilliunits, unitPriceMinor, discountBasisPoints, discountMinor, taxableMinor, taxMinor, totalMinor: taxableMinor + taxMinor, sectionKey };
});

const subtotalMinor = lines.reduce((sum, line) => sum + ((line.quantityMilliunits * line.unitPriceMinor) / 1_000n), 0n);
const discountTotalMinor = lines.reduce((sum, line) => sum + line.discountMinor, 0n);
const taxableTotalMinor = lines.reduce((sum, line) => sum + line.taxableMinor, 0n);
const taxTotalMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0n);

const rendered = await renderQuotePdf({
  folio: 'OCQ-2026-001156',
  versionNumber: 2,
  issuedAt: new Date('2026-09-28T18:00:00.000Z'),
  clientName: 'Residencial Las Palmas, S.A. de C.V.',
  contactName: 'Ana López',
  advisorName: 'Laura Méndez',
  projectType: 'Alberca residencial',
  location: 'Culiacán, Sinaloa',
  description: 'Alberca para residencia familiar.',
  currencyCode: 'MXN',
  validUntil: new Date('2026-10-16T05:59:59.999Z'),
  taxLabel: 'IVA 16%',
  sections,
  lines,
  scopeText: 'Diseño ejecutivo, construcción y equipamiento de una alberca residencial de 8.00 × 4.00 m con profundidad variable de 1.20 a 1.80 m.\n- Trazo, excavación y obra civil completa del vaso.\n- Suministro e instalación del sistema de filtración, iluminación y cloración salina.\n- Acabados de mosaico veneciano y coronamiento de cantera.\n- Pruebas hidráulicas, arranque y capacitación de uso.',
  exclusionsText: '- Permisos y licencias municipales.\n- Acometida eléctrica hasta el cuarto de máquinas.\n- Obras exteriores fuera del perímetro de la alberca.',
  paymentTermsText: '1. 50 % de anticipo a la aceptación.\n2. 30 % al concluir la obra civil.\n3. 20 % contra entrega y arranque del sistema.',
  warrantyText: 'Garantía de 5 años en estructura e impermeabilidad y de 1 año en equipos, conforme a las condiciones del fabricante.',
  publicNotesText: 'Tiempo estimado de ejecución: 8 a 10 semanas a partir del anticipo. Los precios incluyen materiales, mano de obra y fletes dentro de la zona metropolitana.',
  terms: {
    title: 'Condiciones comerciales y aviso de privacidad OCPOOL',
    versionTag: 'v1',
    bodyMarkdown: terms.slice(terms.indexOf('## 1. Objeto'), privacyStart).trim(),
    privacyMarkdown: terms.slice(privacyStart).trim(),
  },
  subtotalMinor,
  discountTotalMinor,
  taxableTotalMinor,
  taxTotalMinor,
  totalMinor: taxableTotalMinor + taxTotalMinor,
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, rendered.bytes);
console.log(JSON.stringify({ outputPath, ...rendered, bytes: undefined }, null, 2));
