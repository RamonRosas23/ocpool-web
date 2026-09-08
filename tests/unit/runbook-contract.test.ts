import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('continuity runbook contract', () => {
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
});
