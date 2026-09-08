import { describe, expect, it } from 'vitest';
import { scanPrivateFile } from '@/server/modules/private-files/scanner';

const metadata = (overrides: Partial<Parameters<typeof scanPrivateFile>[0]> = {}) => ({
  originalFileName: 'planos.pdf',
  contentType: 'application/pdf',
  byteSize: 5,
  category: 'TECHNICAL_DOCUMENT' as const,
  visibility: 'CUSTOMER' as const,
  ...overrides,
});

describe('private file scanner', () => {
  it('passes a declared PDF only when the magic header and size match', () => {
    const result = scanPrivateFile(metadata(), new TextEncoder().encode('%PDF-'));
    expect(result.status).toBe('PASSED');
    expect(result.scannerName).toBe('basic-signature-v1');
    expect(result.sha256).toHaveLength(64);
    expect(result.reason).toBeNull();
  });

  it('rejects a disguised file and a mismatched byte size', () => {
    expect(scanPrivateFile(metadata(), new TextEncoder().encode('<svg>')).reason).toBe('MAGIC_MISMATCH');
    expect(scanPrivateFile(metadata({ byteSize: 4 }), new TextEncoder().encode('%PDF-')).reason).toBe('SIZE_MISMATCH');
  });

  it('recognizes supported image signatures', () => {
    expect(scanPrivateFile(metadata({ originalFileName: 'image.png', contentType: 'image/png', byteSize: 8 }), Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])).status).toBe('PASSED');
    expect(scanPrivateFile(metadata({ originalFileName: 'image.webp', contentType: 'image/webp', byteSize: 12 }), Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])).status).toBe('PASSED');
  });
});
