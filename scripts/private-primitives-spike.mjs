import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();

const packageCandidates = [
  { id: 'radix-select', name: '@radix-ui/react-select', role: 'select' },
  { id: 'day-picker', name: 'react-day-picker', role: 'date-picker' },
  { id: 'react-aria-components', name: 'react-aria-components', role: 'candidate-family' },
  { id: 'lucide-react', name: 'lucide-react', role: 'icons-candidate' },
];

const sourceCandidates = [
  { id: 'select-field', file: 'src/components/SelectField.tsx', pattern: /ui-select__/gu },
  { id: 'date-field', file: 'src/components/DateField.tsx', pattern: /ui-date-field/gu },
  { id: 'acceptance-dialog', file: 'src/components/ClientQuoteActions.tsx', pattern: /client-accept-/gu },
  { id: 'staff-tabs', file: 'src/components/StaffFilesPanel.tsx', pattern: /role="tab(list)?"/gu },
  { id: 'staff-messaging-tabs', file: 'src/components/StaffMessagingPanel.tsx', pattern: /role="tab(list)?"/gu },
  { id: 'private-css', file: 'src/app/globals.css', pattern: /(?:\.ui-|\.client-accept-|\.staff-)/gu },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolvePackageEntry(packageDir, entry) {
  if (!entry || typeof entry !== 'string') return null;
  const clean = entry.startsWith('./') ? entry.slice(2) : entry;
  const candidate = path.join(packageDir, clean);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  for (const extension of ['', '.js', '.mjs', '.cjs']) {
    const withExtension = `${candidate}${extension}`;
    if (fs.existsSync(withExtension) && fs.statSync(withExtension).isFile()) return withExtension;
  }
  return null;
}

function packageMeasurement(candidate) {
  const packageJsonPath = path.join(root, 'node_modules', candidate.name, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { id: candidate.id, role: candidate.role, name: candidate.name, status: 'not-installed' };
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJson = readJson(packageJsonPath);
  const entryPaths = [
    resolvePackageEntry(packageDir, packageJson.module),
    resolvePackageEntry(packageDir, packageJson.main),
  ].filter(Boolean);
  const uniqueEntries = [...new Set(entryPaths)];
  const buffers = uniqueEntries.map((file) => fs.readFileSync(file));
  const bytes = buffers.reduce((total, buffer) => total + buffer.length, 0);

  return {
    id: candidate.id,
    role: candidate.role,
    name: candidate.name,
    status: 'installed',
    version: packageJson.version,
    entrypoints: uniqueEntries.map((file) => path.relative(root, file)),
    entrypointBytes: bytes,
    entrypointGzipBytes: zlib.gzipSync(Buffer.concat(buffers), { level: 9 }).length,
  };
}

function sourceMeasurement(candidate) {
  const file = path.join(root, candidate.file);
  const content = fs.readFileSync(file, 'utf8');
  return {
    id: candidate.id,
    file: candidate.file,
    bytes: Buffer.byteLength(content),
    lines: content.split(/\r?\n/u).length,
    relevantMatches: [...content.matchAll(candidate.pattern)].length,
  };
}

const output = {
  schemaVersion: 1,
  scope: 'private-surfaces-only',
  landingTouched: false,
  packageCandidates: packageCandidates.map(packageMeasurement),
  sourceBaseline: sourceCandidates.map(sourceMeasurement),
  interpretation: {
    currentFamily: 'Radix Select + react-day-picker + local dialog/tabs patterns',
    optionalFamilies: 'react-aria-components and lucide-react are evaluated only in the isolated prototype; neither is adopted by this spike',
    nextEvidence: [
      'future regression of the approved private-route lang/es-MX decision',
      'future bundle/CSS comparison if a new primitive family is proposed',
    ],
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
