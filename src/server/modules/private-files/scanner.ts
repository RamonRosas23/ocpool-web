import { createHash } from 'node:crypto';
import { assertUploadMetadata, type UploadMetadata } from '@/server/modules/private-files/domain';

export type PrivateFileScanResult = Readonly<{
  status: 'PASSED' | 'REJECTED';
  scannerName: 'basic-signature-v1';
  reason: string | null;
  sha256: string;
  byteSize: number;
}>;

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function matchesContentType(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'application/pdf') return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2D]);
  if (contentType === 'image/jpeg') return startsWithBytes(bytes, [0xFF, 0xD8, 0xFF]);
  if (contentType === 'image/png') return startsWithBytes(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (contentType === 'image/webp') return startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
  return false;
}

export function scanPrivateFile(metadata: UploadMetadata, bytes: Uint8Array): PrivateFileScanResult {
  const normalized = assertUploadMetadata(metadata);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== normalized.byteSize) {
    return { status: 'REJECTED', scannerName: 'basic-signature-v1', reason: 'SIZE_MISMATCH', sha256, byteSize: bytes.byteLength };
  }
  if (!matchesContentType(bytes, normalized.contentType)) {
    return { status: 'REJECTED', scannerName: 'basic-signature-v1', reason: 'MAGIC_MISMATCH', sha256, byteSize: bytes.byteLength };
  }
  return { status: 'PASSED', scannerName: 'basic-signature-v1', reason: null, sha256, byteSize: bytes.byteLength };
}
