import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve('src/server');
// Los únicos lugares donde se escribe el outbox a mano: autenticación (tokens cifrados), catálogo y
// conceptos especiales (sin avisos por persona), el PDF listo, la programación interna del digest y
// el propio emisor único de eventos de dominio.
const ALLOWED = new Set([
  'auth/service.ts',
  'modules/catalog/service.ts',
  'modules/special-concepts/service.ts',
  'modules/quote-documents/service.ts',
  'modules/inbox/record.ts',
  'modules/inbox/domain-events.ts',
].map((file) => path.join(ROOT, file)));

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('domain event emission contract', () => {
  it('routes every operational outbox event through recordDomainEvent', () => {
    const offenders = walk(ROOT)
      .filter((file) => file.endsWith('.ts') && !ALLOWED.has(file))
      .filter((file) => /outboxEvent\.create(Many)?\(/u.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).replaceAll('\\', '/'));
    expect(offenders).toEqual([]);
  });
});
