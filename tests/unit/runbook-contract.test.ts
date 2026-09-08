import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('continuity runbook contract', () => {
  it('defines one launch checklist that separates local evidence from external blockers', () => {
    const checklist = read('docs/runbooks/launch-readiness-checklist.md');
    expect(checklist).toContain('Evidencia local');
    expect(checklist).toContain('Bloqueos externos');
    expect(checklist).toContain('No publicar');
    expect(checklist).toContain('PASS');
    expect(checklist).toContain('WARN');
    expect(checklist).toContain('BLOCKED');
    expect(checklist).toContain('RPO');
    expect(checklist).toContain('RTO');
    expect(checklist).toMatch(/SMTP/i);
    expect(checklist).toMatch(/antivirus/i);
    expect(checklist).toMatch(/retenci[oó]n/i);
    expect(checklist).toMatch(/rollback/i);
    expect(checklist).toMatch(/responsable/i);
    expect(checklist).toMatch(/no autoriza.*publicar|no publicar.*PASS/i);
  });

  it('defines a local backup command with explicit output and checksum', () => {
    const scriptPath = 'scripts/db-backup.ps1';
    expect(existsSync(scriptPath)).toBe(true);
    const script = read(scriptPath);
    expect(script).toContain('pg_dump');
    expect(script).toContain('OutputPath');
    expect(script).toContain('Get-FileHash');
    expect(script).not.toMatch(/DATABASE_URL\s*=\s*[^\s}]+/i);
  });

  it('requires an explicit disposable target before restore', () => {
    const scriptPath = 'scripts/db-restore-verify.ps1';
    expect(existsSync(scriptPath)).toBe(true);
    const script = read(scriptPath);
    expect(script).toContain('ConfirmLocalDisposable');
    expect(script).toContain('ocpool_restore_verify');
    expect(script).toContain('Get-FileHash');
    expect(script).toContain('ON_ERROR_STOP');
  });

  it('documents pass, blocked and warning states without inventing retention periods', () => {
    const runbook = read('docs/runbooks/production-readiness.md');
    expect(runbook).toContain('PASS');
    expect(runbook).toContain('BLOCKED');
    expect(runbook).toContain('WARN');
    expect(runbook).toMatch(/retenci[oó]n/i);
    expect(runbook).toMatch(/plazos legales inventados/i);
  });

  it('documents safe restore boundaries and private object continuity', () => {
    const runbook = read('docs/runbooks/backup-restore.md');
    expect(runbook).toMatch(/destino.*desechable/i);
    expect(runbook).toMatch(/no.*producci[oó]n/i);
    expect(runbook).toMatch(/checksum|hash/i);
    expect(runbook).toMatch(/restaur/i);
    expect(runbook).toMatch(/MinIO\/S3/i);
    expect(runbook).toContain('DROP DATABASE IF EXISTS ocpool_restore_verify');
  });

  it('documents the audit read boundary without inventing destructive operations', () => {
    const runbook = read('docs/runbooks/audit-observability.md');
    expect(runbook).toContain('audit.read');
    expect(runbook).toContain('audit.security.read');
    expect(runbook).toContain('[from,to)');
    expect(runbook).toMatch(/93 d[ií]as/i);
    expect(runbook).toMatch(/no-store/i);
    expect(runbook).toMatch(/no muestra.*UUID|UUIDs.*correo/i);
    expect(runbook).toMatch(/no hay exportaci[oó]n, purga/i);
    expect(runbook).not.toMatch(/DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE/i);
  });

  it('documents browser auth routes without fixed credentials or open redirects', () => {
    const runbook = read('docs/runbooks/auth-surfaces.md');
    expect(runbook).toContain('/login');
    expect(runbook).toContain('/login/recovery');
    expect(runbook).toContain('/portal/access');
    expect(runbook).toContain('/auth/customer/consume-link');
    expect(runbook).toContain('/auth/recovery');
    expect(runbook).toMatch(/no existen credenciales fijas/i);
    expect(runbook).toMatch(/no se acepta `returnTo`/i);
    expect(runbook).toMatch(/history\.replaceState/);
    expect(runbook).not.toMatch(/AuthSurface(Employee|Admin)123|password\s*[:=]\s*['\"]/i);
  });
});
