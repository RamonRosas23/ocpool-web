import { describe, expect, it } from 'vitest';
import { contentDisposition, signStorageUrl, STORAGE_OBJECT_ROUTE, verifyStorageUrl } from '@/server/modules/private-files/storage-url';

const secret = 'secreto-de-prueba-para-firmar';
const now = new Date('2026-09-28T20:00:00.000Z');
const inAMinute = Math.floor(now.getTime() / 1000) + 60;

function paramsOf(url: string): URLSearchParams {
  return new URL(url, 'https://ocpool.com.mx').searchParams;
}

describe('enlaces de almacenamiento servidos por la aplicación', () => {
  it('signs same-origin download and upload links that verify back to the same grant', () => {
    const download = signStorageUrl({ operation: 'download', key: 'private-files/generated-documents/abc.pdf', expiresAt: inAMinute, disposition: 'inline', fileName: 'Cotización OCQ-2026-000001 v2.pdf' }, secret);
    expect(download.startsWith(`${STORAGE_OBJECT_ROUTE}?`)).toBe(true);
    expect(verifyStorageUrl(paramsOf(download), secret, now)).toEqual({
      ok: true,
      grant: { operation: 'download', key: 'private-files/generated-documents/abc.pdf', expiresAt: inAMinute, disposition: 'inline', fileName: 'Cotización OCQ-2026-000001 v2.pdf' },
    });

    const upload = signStorageUrl({ operation: 'upload', key: 'private-files/requests/r1/f1', expiresAt: inAMinute, contentType: 'application/pdf' }, secret);
    expect(verifyStorageUrl(paramsOf(upload), secret, now)).toEqual({
      ok: true,
      grant: { operation: 'upload', key: 'private-files/requests/r1/f1', expiresAt: inAMinute, contentType: 'application/pdf' },
    });
  });

  it('rejects any tampered parameter, a foreign secret and duplicated parameters', () => {
    const url = signStorageUrl({ operation: 'download', key: 'private-files/a.pdf', expiresAt: inAMinute, disposition: 'attachment', fileName: 'a.pdf' }, secret);
    const tamper = (name: string, value: string) => {
      const params = paramsOf(url);
      params.set(name, value);
      return verifyStorageUrl(params, secret, now);
    };
    expect(tamper('key', 'private-files/b.pdf')).toEqual({ ok: false, reason: 'INVALID' });
    expect(tamper('exp', String(inAMinute + 3600))).toEqual({ ok: false, reason: 'INVALID' });
    expect(tamper('disposition', 'inline')).toEqual({ ok: false, reason: 'INVALID' });
    expect(tamper('name', 'otro.pdf')).toEqual({ ok: false, reason: 'INVALID' });
    expect(tamper('op', 'upload')).toEqual({ ok: false, reason: 'INVALID' });
    expect(tamper('sig', 'AAAA')).toEqual({ ok: false, reason: 'INVALID' });
    expect(verifyStorageUrl(paramsOf(url), 'otro-secreto-distinto', now)).toEqual({ ok: false, reason: 'INVALID' });

    const duplicated = paramsOf(url);
    duplicated.append('key', 'private-files/a.pdf');
    expect(verifyStorageUrl(duplicated, secret, now)).toEqual({ ok: false, reason: 'INVALID' });

    const upload = signStorageUrl({ operation: 'upload', key: 'private-files/x', expiresAt: inAMinute, contentType: 'image/png' }, secret);
    const retyped = paramsOf(upload);
    retyped.set('type', 'text/html');
    expect(verifyStorageUrl(retyped, secret, now)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('reports expired links separately from invalid ones', () => {
    const url = signStorageUrl({ operation: 'download', key: 'private-files/a.pdf', expiresAt: inAMinute, disposition: 'attachment', fileName: null }, secret);
    expect(verifyStorageUrl(paramsOf(url), secret, new Date((inAMinute + 1) * 1000))).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('only signs keys inside the private prefix and well-formed content types', () => {
    expect(() => signStorageUrl({ operation: 'download', key: 'otra-cosa/a.pdf', expiresAt: inAMinute, disposition: 'attachment', fileName: null }, secret)).toThrow();
    expect(() => signStorageUrl({ operation: 'download', key: 'private-files/../secreto', expiresAt: inAMinute, disposition: 'attachment', fileName: null }, secret)).toThrow();
    expect(() => signStorageUrl({ operation: 'upload', key: 'private-files/a', expiresAt: inAMinute, contentType: 'no es un tipo' }, secret)).toThrow();
    expect(() => signStorageUrl({ operation: 'download', key: 'private-files/a', expiresAt: inAMinute, disposition: 'attachment', fileName: 'mal\nnombre.pdf' }, secret)).toThrow();
  });

  it('builds a Content-Disposition that keeps accents and stays safe for old clients', () => {
    expect(contentDisposition('attachment', null)).toBe('attachment');
    expect(contentDisposition('inline', 'Cotización OCQ-2026-000001 v2.pdf')).toBe(`inline; filename="Cotizacion OCQ-2026-000001 v2.pdf"; filename*=UTF-8''Cotizaci%C3%B3n%20OCQ-2026-000001%20v2.pdf`);
    expect(contentDisposition('attachment', 'plano "final" (v3).pdf')).toBe(`attachment; filename="plano _final_ (v3).pdf"; filename*=UTF-8''plano%20%22final%22%20%28v3%29.pdf`);
  });
});
