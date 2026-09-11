import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const textExtensions = new Set(['.css', '.json', '.js', '.mjs', '.md', '.tsx', '.ts', '.txt']);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', '.next', 'node_modules', 'tmp'].includes(entry.name)) return [];
    const absolutePath = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

const allFiles = walk(root);
const textFiles = allFiles.filter((file) => textExtensions.has(file.slice(file.lastIndexOf('.')).toLowerCase()));
const contractFile = resolve(root, 'scripts/pool-site-contract.mjs');
const layout = readFileSync(resolve(root, 'src/app/layout.tsx'), 'utf8');
const middleware = readFileSync(resolve(root, 'src/middleware.ts'), 'utf8');
const source = textFiles.filter((file) => file !== contractFile).map((file) => readFileSync(file, 'utf8')).join('\n');
assert.match(layout, /<html\s+lang=\{locale\}\s+suppressHydrationWarning>/, 'Root layout must use the server-selected locale and ignore browser-injected html attributes during hydration');
assert.match(layout, /=== 'es-MX' \? 'es-MX' : 'es'/, 'Root layout must preserve the public Spanish locale fallback');
assert.match(middleware, /x-ocpool-private-locale/u, 'Private route locale marker must be server-owned');
const requiredCopy = [
  'OCPOOL',
  'contacto@ocpool.com.mx',
  '667 453 2567',
  'ocpool.com.mx',
  'Diseñamos y construimos albercas para residencias, hoteles y clubes de playa.',
  'especialidades integradas',
  'La ejecución, en',
  'Una sola coordinación para resolver la',
  'Proyectos residenciales y de',
  'Una solución completa para la',
  'Un proceso que evita',
  'Lo que queda resuelto',
  'La estética y la operación se deciden juntas.',
  'Qué se construye, cómo funcionará y quién coordina cada parte.',
  'Un equipo técnico para proyectos',
  'Cuéntanos qué necesitas',
  'Casas habitación',
  'Clubes de playa y hoteles',
  'Rehabilitación de albercas existentes',
  'Propuesta 01',
  'En desarrollo',
  'Casa Salina Cruz',
  'Boca de Chila',
];
const forbiddenCopy = [
  String.fromCharCode(67, 97, 98, 111, 32, 100, 101, 108, 32, 71, 111, 108, 102, 111),
  String.fromCharCode(67, 97, 98, 111, 45, 100, 101, 108, 45, 71, 111, 108, 102, 111),
  String.fromCharCode(99, 97, 98, 111, 45, 100, 101, 108, 45, 103, 111, 108, 102, 111),
  String.fromCharCode(103, 111, 108, 102, 111, 99, 97, 98, 111, 46, 99, 111, 109),
  String.fromCharCode(99, 97, 98, 111, 100, 101, 108, 103, 111, 108, 102, 111),
  String.fromCharCode(68, 105, 115, 116, 114, 105, 98, 117, 105, 100, 111, 114, 97, 32, 69, 108, 233, 99, 116, 114, 105, 99, 97),
  String.fromCharCode(77, 97, 116, 101, 114, 105, 97, 108, 32, 69, 108, 233, 99, 116, 114, 105, 99, 111),
  String.fromCharCode(83, 117, 98, 101, 115, 116, 97, 99, 105, 111, 110, 101, 115, 32, 69, 108, 233, 99, 116, 114, 105, 99, 97, 115),
  String.fromCharCode(69, 110, 101, 114, 103, 105, 122, 97, 110, 100, 111, 32, 77, 250, 108, 116, 105, 112, 108, 101, 115, 32, 83, 101, 99, 116, 111, 114, 101, 115),
  String.fromCharCode(112, 114, 111, 121, 101, 99, 116, 111, 32, 108, 111, 103, 237, 115, 116, 105, 99, 111),
  String.fromCharCode(78, 111, 32, 109, 111, 115, 116, 114, 97, 109, 111, 115, 32, 117, 110, 32, 99, 97, 116, 225, 108, 111, 103, 111, 32, 100, 101, 32, 97, 99, 97, 98, 97, 100, 111, 115),
  String.fromCharCode(69, 108, 32, 116, 114, 97, 98, 97, 106, 111, 32, 104, 97, 98, 108, 97, 32, 99, 111, 110, 32, 105, 109, 225, 103, 101, 110, 101, 115, 32, 114, 101, 97, 108, 101, 115),
  String.fromCharCode(85, 110, 97, 32, 101, 115, 99, 101, 110, 97, 32, 100, 105, 115, 116, 105, 110, 116, 97, 32, 99, 117, 97, 110, 100, 111, 32, 99, 97, 101, 32, 108, 97, 32, 110, 111, 99, 104, 101),
  String.fromCharCode(67, 111, 110, 111, 99, 101, 114, 32, 101, 108, 32, 115, 105, 103, 117, 105, 101, 110, 116, 101, 32, 112, 97, 115, 111),
  String.fromCharCode(85, 110, 97, 32, 98, 117, 101, 110, 97, 32, 97, 108, 98, 101, 114, 99, 97, 32, 101, 109, 112, 105, 101, 122, 97, 32, 99, 111, 110, 32, 117, 110, 32, 97, 108, 99, 97, 110, 99, 101, 32, 99, 108, 97, 114, 111),
];

for (const copy of requiredCopy) {
  assert.ok(source.includes(copy), `Missing pool copy: ${copy}`);
}

for (const copy of forbiddenCopy) {
  assert.equal(source.includes(copy), false, `Electrical copy remains: ${copy}`);
}

const legacyNamePattern = new RegExp(`${String.fromCharCode(99, 97, 98, 111)}|${String.fromCharCode(103, 111, 108, 102, 111)}`, 'i');
const oldNamedFiles = allFiles.filter((file) => legacyNamePattern.test(file.slice(file.lastIndexOf('\\') + 1)));
assert.deepEqual(oldNamedFiles, [], `Old brand filenames remain: ${oldNamedFiles.join(', ')}`);

for (const asset of [
  'public/brand/ocpool-logo.png',
  'public/brand/ocpool-logo-white.png',
  'public/proyectos/cdp/hero.jpg',
  'public/proyectos/cdp/gallery/final-01.png',
  'public/proyectos/cdp/gallery/obra-01.jpg',
  'public/proyectos/closter/hero.jpg',
  'public/proyectos/asipona/hero.png',
  'public/proyectos/boca-de-chila/hero-v2.jpg',
]) {
  assert.equal(existsSync(resolve(root, asset)), true, `Missing asset: ${asset}`);
}

console.log('Pool website content contract passed.');
