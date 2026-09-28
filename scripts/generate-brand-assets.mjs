// Regenera los logos optimizados del correo y del PDF a partir de los originales de public/brand.
// Uso: node scripts/generate-brand-assets.mjs (necesita `sharp`, que ya instala Next.js).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outputs = [
  // Encabezado marino del correo: logo blanco a 2x de 132 px.
  { source: 'public/brand/ocpool-logo-white.png', target: 'public/brand/email/ocpool-logo-blanco.png', width: 264 },
  // PDF: logo a color, con resolución de sobra para impresión a 96 pt de ancho.
  { source: 'public/brand/ocpool-logo.png', target: 'src/server/modules/quote-documents/assets/ocpool-logo-print.png', width: 640 },
];

for (const output of outputs) {
  const target = path.join(root, output.target);
  await mkdir(path.dirname(target), { recursive: true });
  const info = await sharp(path.join(root, output.source))
    .trim()
    .resize({ width: output.width })
    .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 })
    .toFile(target);
  console.log(`${output.target}: ${info.width}x${info.height}, ${info.size} bytes`);
}
