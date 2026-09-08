import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STATUS_ORDER = { PASS: 0, WARN: 1, BLOCKED: 2 };

/** @typedef {'PASS' | 'WARN' | 'BLOCKED'} ReadinessStatus */
/** @typedef {{ id: string, status: ReadinessStatus, summary: string }} ReadinessCheck */
/** @typedef {{ status: ReadinessStatus, checks: ReadinessCheck[], counts: { PASS: number, WARN: number, BLOCKED: number } }} ReadinessReport */

const EXTERNAL_CHECKS = [
  {
    id: 'EXT_SMTP_PROVIDER',
    status: 'BLOCKED',
    summary: 'Proveedor SMTP productivo, límites y autenticación de dominio pendientes.',
  },
  {
    id: 'EXT_DNS_AUTHENTICATION',
    status: 'BLOCKED',
    summary: 'Dominio, TLS, SPF, DKIM, DMARC, proxy y WAF pendientes de aprobación.',
  },
  {
    id: 'EXT_ANTIVIRUS_PROVIDER',
    status: 'BLOCKED',
    summary: 'Proveedor antivirus, cuarentena y recuperación de objetos pendientes.',
  },
  {
    id: 'EXT_EXTERNAL_BACKUP',
    status: 'BLOCKED',
    summary: 'Backup externo cifrado, restauración periódica, RPO y RTO pendientes.',
  },
  {
    id: 'EXT_RETENTION_POLICY',
    status: 'BLOCKED',
    summary: 'Política aprobada de retención por clase de dato pendiente.',
  },
  {
    id: 'EXT_DEPLOYMENT_TARGET',
    status: 'BLOCKED',
    summary: 'Destino de despliegue, supervisor, observabilidad y rollback pendientes.',
  },
  {
    id: 'EXT_LEGAL_REVIEW',
    status: 'BLOCKED',
    summary: 'Revisión legal de privacidad, aceptación y auditoría pendiente.',
  },
];

const EXPENSIVE_CHECKS = [
  ['TECH_MIGRATIONS', ['exec', '--', 'prisma', 'migrate', 'status'], 'Migraciones Prisma verificadas.'],
  ['TECH_SEED', ['run', 'db:seed'], 'Seed idempotente ejecutado.'],
  ['TECH_INTEGRATION', ['run', 'test:integration'], 'Pruebas de integración serializadas aprobadas.'],
  ['TECH_BUILD', ['run', 'build'], 'Build de producción local aprobado.'],
];

function safeSummary(summary) {
  return String(summary)
    .replace(/(?:postgres(?:ql)?|mysql|redis):\/\/[^\s]+/gi, '[redacted-connection]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[redacted-path]')
    .replace(/(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

/**
 * @param {ReadinessCheck} check
 * @returns {ReadinessCheck}
 */
function normalizeCheck(check) {
  const id = String(check.id).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+$/.test(id)) throw new Error('Invalid readiness check id');
  if (!Object.hasOwn(STATUS_ORDER, check.status)) throw new Error('Invalid readiness check status');
  return { id, status: check.status, summary: safeSummary(check.summary) };
}

/**
 * @param {ReadinessCheck[]} checks
 * @returns {ReadinessCheck[]}
 */
function mergeChecks(checks) {
  const byId = new Map();
  for (const rawCheck of checks) {
    const check = normalizeCheck(rawCheck);
    const current = byId.get(check.id);
    if (!current || STATUS_ORDER[check.status] > STATUS_ORDER[current.status]) byId.set(check.id, check);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Combines technical evidence and external release prerequisites into one safe report.
 * @param {{ technicalChecks?: ReadinessCheck[], externalChecks?: ReadinessCheck[] }} input
 * @returns {ReadinessReport}
 */
export function evaluateProductionReadiness({ technicalChecks = [], externalChecks = [] } = {}) {
  const checks = mergeChecks([...technicalChecks, ...externalChecks]);
  const counts = { PASS: 0, WARN: 0, BLOCKED: 0 };
  for (const check of checks) counts[check.status] += 1;
  const status = counts.BLOCKED > 0 ? 'BLOCKED' : counts.WARN > 0 ? 'WARN' : 'PASS';
  return { status, checks, counts };
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(args, timeout = 600_000) {
  return spawnSync(npmCommand(), args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}

/**
 * @param {string} id
 * @param {string[]} args
 * @param {string} summary
 * @returns {ReadinessCheck}
 */
function runCommandCheck(id, args, summary) {
  const result = runNpm(args);
  if (result.status === 0) return { id, status: 'PASS', summary };
  return { id, status: 'BLOCKED', summary: `${summary} No se obtuvo evidencia aprobada.` };
}

function runRuntimePolicyCheck() {
  const result = runNpm(['run', 'validate:production']);
  try {
    const outputLines = String(result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
    const parsed = JSON.parse(outputLines.at(-1) ?? '');
    if (parsed.status === 'PASS' && result.status === 0) {
      return { id: 'TECH_RUNTIME_POLICY', status: 'PASS', summary: 'Política de runtime productivo aprobada.' };
    }
    return { id: 'TECH_RUNTIME_POLICY', status: 'BLOCKED', summary: 'La política de runtime productivo bloquea la configuración actual.' };
  } catch {
    return { id: 'TECH_RUNTIME_POLICY', status: 'BLOCKED', summary: 'La política de runtime productivo no pudo producir evidencia segura.' };
  }
}

function documentationCheck() {
  const required = [
    'README.md',
    'PROJECT_STATUS.md',
    'docs/runbooks/backup-restore.md',
    'docs/runbooks/production-readiness.md',
  ];
  return required.every((file) => existsSync(path.join(ROOT, file)))
    ? { id: 'TECH_DOCUMENTATION', status: 'PASS', summary: 'README, estado y runbooks requeridos están presentes.' }
    : { id: 'TECH_DOCUMENTATION', status: 'BLOCKED', summary: 'Falta documentación operativa requerida.' };
}

function collectTechnicalChecks({ dryRun, full }) {
  if (dryRun) {
    return [
      { id: 'TECH_RUNTIME_POLICY', status: 'WARN', summary: 'Ejecución omitida en modo dry-run.' },
      { id: 'TECH_DOCUMENTATION', status: 'WARN', summary: 'Ejecución omitida en modo dry-run.' },
    ];
  }

  const checks = [
    runRuntimePolicyCheck(),
    runCommandCheck('TECH_SCHEMA', ['run', 'db:validate'], 'Schema Prisma válido.'),
    runCommandCheck('TECH_TYPECHECK', ['run', 'typecheck'], 'Typecheck aprobado.'),
    runCommandCheck('TECH_UNIT', ['run', 'test:unit'], 'Pruebas unitarias aprobadas.'),
    runCommandCheck('TECH_CONTENT', ['run', 'test:content'], 'Contrato de contenido aprobado.'),
    runCommandCheck('TECH_LINT', ['run', 'lint'], 'Lint aprobado.'),
    runCommandCheck('TECH_AUDIT', ['audit', '--omit=dev', '--audit-level=high'], 'Auditoría de dependencias sin vulnerabilidades altas.'),
    documentationCheck(),
  ];

  for (const [id, args, summary] of EXPENSIVE_CHECKS) {
    checks.push(full
      ? runCommandCheck(id, args, summary)
      : { id, status: 'WARN', summary: 'Ejecución omitida; usar --full para completar este control.' });
  }
  return checks;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const report = evaluateProductionReadiness({
    technicalChecks: collectTechnicalChecks({
      dryRun: args.has('--dry-run') || args.has('--no-commands') || args.has('--quick'),
      full: args.has('--full'),
    }),
    externalChecks: EXTERNAL_CHECKS,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(SCRIPT_PATH)) main();
