import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const root = process.cwd();
const requiredArtifacts = [
  'docs/adr/2026-09-10-commercial-lifecycle-v2.md',
  'docs/adr/2026-09-10-commercial-policy-v1.md',
  'docs/adr/2026-09-10-commercial-g0-baseline.md',
  'docs/adr/2026-09-11-commercial-g0-03-objectives.md',
  'docs/adr/2026-09-10-private-ui-primitives.md',
  'docs/adr/2026-09-10-private-locale.md',
  'docs/ocpool-commercial-v2/g0-03-browser-baseline.md',
  'docs/ocpool-commercial-v2/landing-freeze.md',
  'docs/ocpool-commercial-v2/landing-freeze.json',
  'spikes/private-primitives-react-aria/README.md',
  'spikes/private-primitives-react-aria/check.mjs',
  'spikes/private-primitives-react-aria/ssr-check.mjs',
  'spikes/private-primitives-react-aria/next-route-check.mjs',
  'tests/fixtures/commercial-workflow-v2.ts',
  'tests/fixtures/commercial-baseline-v2.ts',
  'tests/fixtures/commercial-baseline-recorder.ts',
  'tests/unit/commercial-workflow-contract.test.ts',
  'tests/unit/commercial-baseline-contract.test.ts',
  'tests/unit/commercial-v2-flags.test.ts',
  'scripts/commercial-baseline-browser.mjs',
  'scripts/landing-freeze.mjs',
  'scripts/commercial-baseline-http.mjs',
];

const checks = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['lint', 'npm', ['run', 'lint']],
  ['unit', 'npm', ['run', 'test:unit']],
  ['content', 'npm', ['run', 'test:content']],
  ['http-baseline', 'npm', ['run', 'baseline:v2:http']],
];

function runCheck(label, command, args) {
  process.stdout.write(`\n[G0-05] ${label}\n`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return false;
  }
  return result.status === 0;
}

const missing = requiredArtifacts.filter((path) => !existsSync(`${root}/${path}`));
if (missing.length > 0) {
  process.stderr.write(`Faltan artefactos requeridos:\n${missing.map((path) => `- ${path}`).join('\n')}\n`);
  process.exit(1);
}

let technicalPass = true;
for (const [label, command, args] of checks) technicalPass = runCheck(label, command, args) && technicalPass;

if (!technicalPass) {
  process.stderr.write('\nG0-05: FAIL — una verificación técnica falló.\n');
  process.exit(1);
}

process.stdout.write('\nG0-05: BLOCKED — verificaciones técnicas verdes; falta el cierre formal del piloto T1 y siguen pendientes los signoffs externos de fiscal/jurídico.\n');
process.exit(2);
