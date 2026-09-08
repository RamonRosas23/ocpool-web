import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('production readiness CLI', () => {
  it('emits a safe blocked report in dry-run mode', () => {
    const result = spawnSync(process.execPath, ['scripts/production-readiness.mjs', '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe('BLOCKED');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'EXT_SMTP_PROVIDER', status: 'BLOCKED' }),
      expect.objectContaining({ id: 'EXT_RETENTION_POLICY', status: 'BLOCKED' }),
    ]));

    const output = JSON.stringify(report);
    expect(output).not.toMatch(/DATABASE_URL|postgresql:\/\/|password|token|secret|[A-Z]:\\\\/i);
  });
});
