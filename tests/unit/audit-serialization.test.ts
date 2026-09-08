import { describe, expect, it } from 'vitest';
import { projectAuditMetadata } from '@/server/modules/audit/domain';

describe('audit serialization safety', () => {
  it('does not expose known sensitive metadata in projected details', () => {
    const result = projectAuditMetadata('file.rejected', {
      folio: 'OC-0002',
      category: 'IDENTIFICACION',
      reason: 'signature_mismatch',
      byteSize: 1234,
      email: 'client@example.test',
      phone: '+52 800 000 0000',
      ipAddress: '192.0.2.10',
      userAgent: 'secret-browser',
      identifierHash: 'b'.repeat(64),
      sha256: 'c'.repeat(64),
      ciphertext: 'v1.secret.secret.secret',
      tokenId: 'token-secret',
      idempotencyKeyHash: 'd'.repeat(64),
    });
    const json = JSON.stringify(result);

    expect(json).toContain('OC-0002');
    expect(json).toContain('IDENTIFICACION');
    expect(json).not.toMatch(/@example|800 000|192\.0\.2|secret-browser|identifierHash|sha256|ciphertext|token-secret|idempotency|[a-f0-9]{64}/iu);
  });

  it('never returns raw metadata values when the value has an unsupported type', () => {
    const result = projectAuditMetadata('quote_request.created', {
      folio: 'OC-0003',
      origin: { nested: 'private' },
      email: 'private@example.test',
      unknown: ['private'],
    });

    expect(result).toEqual([{ label: 'Folio', value: 'OC-0003' }]);
  });
});
