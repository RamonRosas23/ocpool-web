import { describe, expect, it } from 'vitest';
import { hasPermission, permissionKeysForRoles } from '@/server/auth/permissions';
import {
  ALLOWED_FILE_TYPES,
  FILE_CATEGORIES,
  FILE_MAX_BYTES,
  FILE_STATUSES,
  FILE_VISIBILITIES,
  assertUploadMetadata,
  buildStorageKey,
  canTransitionFileStatus,
  isFileDeliverable,
  normalizeOriginalFileName,
} from '@/server/modules/private-files/domain';

describe('private file domain contract', () => {
  it('defines explicit categories, visibilities and delivery states', () => {
    expect(FILE_CATEGORIES).toEqual([
      'REFERENCE_IMAGE',
      'TECHNICAL_DOCUMENT',
      'CLIENT_DOCUMENT',
      'INTERNAL_DOCUMENT',
    ]);
    expect(FILE_VISIBILITIES).toEqual(['CUSTOMER', 'INTERNAL']);
    expect(FILE_STATUSES).toEqual(['PENDING_SCAN', 'AVAILABLE', 'REJECTED', 'DELETED']);
    expect(isFileDeliverable('AVAILABLE')).toBe(true);
    expect(isFileDeliverable('PENDING_SCAN')).toBe(false);
    expect(isFileDeliverable('REJECTED')).toBe(false);
    expect(isFileDeliverable('DELETED')).toBe(false);
  });

  it('normalizes display names without allowing paths or control characters', () => {
    expect(normalizeOriginalFileName('  ..\\planos\u0000-final.pdf  ')).toBe('planos-final.pdf');
    expect(() => normalizeOriginalFileName('   ')).toThrow();
    expect(() => normalizeOriginalFileName('x'.repeat(181) + '.pdf')).toThrow();
  });

  it('requires allowed real metadata and rejects oversized or mismatched uploads', () => {
    expect(ALLOWED_FILE_TYPES).toEqual([
      { extension: 'pdf', contentType: 'application/pdf' },
      { extension: 'jpg', contentType: 'image/jpeg' },
      { extension: 'jpeg', contentType: 'image/jpeg' },
      { extension: 'png', contentType: 'image/png' },
      { extension: 'webp', contentType: 'image/webp' },
    ]);
    expect(assertUploadMetadata({
      originalFileName: 'planos.pdf',
      contentType: 'application/pdf',
      byteSize: 1024,
      category: 'TECHNICAL_DOCUMENT',
      visibility: 'CUSTOMER',
    })).toEqual({
      originalFileName: 'planos.pdf',
      contentType: 'application/pdf',
      byteSize: 1024,
      category: 'TECHNICAL_DOCUMENT',
      visibility: 'CUSTOMER',
    });
    expect(() => assertUploadMetadata({
      originalFileName: 'planos.pdf',
      contentType: 'image/png',
      byteSize: 1024,
      category: 'TECHNICAL_DOCUMENT',
      visibility: 'CUSTOMER',
    })).toThrow();
    expect(() => assertUploadMetadata({
      originalFileName: 'planos.pdf',
      contentType: 'application/pdf',
      byteSize: FILE_MAX_BYTES + 1,
      category: 'TECHNICAL_DOCUMENT',
      visibility: 'CUSTOMER',
    })).toThrow();
    expect(() => assertUploadMetadata({
      originalFileName: 'script.svg',
      contentType: 'image/svg+xml',
      byteSize: 1024,
      category: 'REFERENCE_IMAGE',
      visibility: 'CUSTOMER',
    })).toThrow();
  });

  it('keeps internal documents explicit and storage keys opaque', () => {
    expect(() => assertUploadMetadata({
      originalFileName: 'interno.pdf',
      contentType: 'application/pdf',
      byteSize: 1024,
      category: 'INTERNAL_DOCUMENT',
      visibility: 'CUSTOMER',
    })).toThrow();
    expect(buildStorageKey('2be3e6af-0f23-4c28-9df5-7f2e9e7a2b50')).toBe('private-files/2be3e6af-0f23-4c28-9df5-7f2e9e7a2b50');
    expect(buildStorageKey('2be3e6af-0f23-4c28-9df5-7f2e9e7a2b50')).not.toContain('..');
  });

  it('allows only safe lifecycle transitions', () => {
    expect(canTransitionFileStatus('PENDING_SCAN', 'AVAILABLE')).toBe(true);
    expect(canTransitionFileStatus('PENDING_SCAN', 'REJECTED')).toBe(true);
    expect(canTransitionFileStatus('AVAILABLE', 'DELETED')).toBe(true);
    expect(canTransitionFileStatus('REJECTED', 'AVAILABLE')).toBe(false);
    expect(canTransitionFileStatus('DELETED', 'AVAILABLE')).toBe(false);
  });

  it('assigns least privilege for customer and staff roles', () => {
    const customer = permissionKeysForRoles(['customer']);
    const sales = permissionKeysForRoles(['sales']);
    const manager = permissionKeysForRoles(['manager']);

    expect(hasPermission({ permissionKeys: customer }, 'files.read')).toBe(true);
    expect(hasPermission({ permissionKeys: customer }, 'files.upload')).toBe(true);
    expect(hasPermission({ permissionKeys: customer }, 'files.internal.read')).toBe(false);
    expect(hasPermission({ permissionKeys: sales }, 'files.internal.read')).toBe(true);
    expect(hasPermission({ permissionKeys: sales }, 'files.manage')).toBe(false);
    expect(hasPermission({ permissionKeys: manager }, 'files.manage')).toBe(true);
  });
});
