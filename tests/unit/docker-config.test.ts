import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local Docker configuration', () => {
  const compose = readFileSync(resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
  const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
  const requireEnv = readFileSync(resolve(process.cwd(), 'scripts/require-env.mjs'), 'utf8');

  it('defines healthy PostgreSQL and Mailpit services', () => {
    expect(compose).toContain('postgres:');
    expect(compose).toContain('mailpit:');
    expect(compose).toContain('pg_isready');
    expect(compose).toContain('55432:5432');
    expect(compose).toContain('11025:1025');
    expect(compose).toContain('18025:8025');
  });

  it('documents the same local PostgreSQL connection string', () => {
    expect(envExample).toContain('DATABASE_URL=postgresql://ocpool:ocpool_dev@localhost:55432/ocpool_dev?schema=public');
  });

  it('loads the local env file before checking required variables', () => {
    expect(requireEnv).toContain("dotenv/config");
  });
});
