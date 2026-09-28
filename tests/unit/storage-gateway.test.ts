import { describe, expect, it } from 'vitest';
import type { PrivateStorage } from '@/server/modules/private-files/storage';
import { receiveStorageUpload, serveStorageDownload } from '@/server/modules/private-files/storage-gateway';
import { signStorageUrl } from '@/server/modules/private-files/storage-url';

const secret = 'secreto-de-prueba-para-firmar';
const appUrl = 'https://ocpool.com.mx';
const now = new Date('2026-09-28T20:00:00.000Z');
const expiresAt = Math.floor(now.getTime() / 1000) + 60;

function memoryStorage(initial: Record<string, { body: Uint8Array; contentType: string }> = {}) {
  const objects = new Map(Object.entries(initial));
  const storage: PrivateStorage = {
    async ensureBucket() {},
    async put({ key, body, contentType }) { objects.set(key, { body, contentType }); },
    async createUploadUrl() { throw new Error('not used'); },
    async createDownloadUrl() { throw new Error('not used'); },
    async head(key) {
      const object = objects.get(key);
      return object ? { contentLength: object.body.byteLength, contentType: object.contentType, etag: null } : null;
    },
    async read(key) {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return object.body;
    },
    async delete(key) { objects.delete(key); },
  };
  return { storage, objects };
}

const pdf = new TextEncoder().encode('%PDF-1.7 prueba');
const dependencies = (storage: PrivateStorage) => ({ storage, secret, appUrl, now, maxBytes: 1024 });
const absolute = (path: string) => new URL(path, appUrl).toString();

describe('pasarela de archivos privados', () => {
  it('serves a signed download from the same origin with a filename and without caching', async () => {
    const { storage } = memoryStorage({ 'private-files/generated-documents/a.pdf': { body: pdf, contentType: 'application/pdf' } });
    const url = signStorageUrl({ operation: 'download', key: 'private-files/generated-documents/a.pdf', expiresAt, disposition: 'attachment', fileName: 'Cotización OCQ-2026-000001 v2.pdf' }, secret);
    const response = await serveStorageDownload(new Request(absolute(url)), dependencies(storage));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-length')).toBe(String(pdf.byteLength));
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="Cotizacion OCQ-2026-000001 v2.pdf"');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
  });

  it('lets the site itself frame an inline PDF preview, and nothing else', async () => {
    const { storage } = memoryStorage({ 'private-files/generated-documents/a.pdf': { body: pdf, contentType: 'application/pdf' } });
    const url = signStorageUrl({ operation: 'download', key: 'private-files/generated-documents/a.pdf', expiresAt, disposition: 'inline', fileName: null }, secret);
    const response = await serveStorageDownload(new Request(absolute(url)), dependencies(storage));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
  });

  it('never renders an uploaded non-PDF inline, even with an inline grant', async () => {
    const { storage } = memoryStorage({ 'private-files/x.html': { body: new TextEncoder().encode('<script>alert(1)</script>'), contentType: 'text/html' } });
    const url = signStorageUrl({ operation: 'download', key: 'private-files/x.html', expiresAt, disposition: 'inline', fileName: null }, secret);
    const response = await serveStorageDownload(new Request(absolute(url)), dependencies(storage));
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('answers expired, tampered, upload-only and missing objects without leaking content', async () => {
    const { storage } = memoryStorage();
    const url = signStorageUrl({ operation: 'download', key: 'private-files/a.pdf', expiresAt, disposition: 'attachment', fileName: null }, secret);
    expect((await serveStorageDownload(new Request(absolute(url)), { ...dependencies(storage), now: new Date((expiresAt + 5) * 1000) })).status).toBe(410);
    expect((await serveStorageDownload(new Request(absolute(url.replace('a.pdf', 'b.pdf'))), dependencies(storage))).status).toBe(403);
    expect((await serveStorageDownload(new Request(absolute(url)), dependencies(storage))).status).toBe(404);
    const upload = signStorageUrl({ operation: 'upload', key: 'private-files/a.pdf', expiresAt, contentType: 'application/pdf' }, secret);
    expect((await serveStorageDownload(new Request(absolute(upload)), dependencies(storage))).status).toBe(403);
  });

  it('stores a signed same-origin upload with the reserved content type', async () => {
    const { storage, objects } = memoryStorage();
    const url = signStorageUrl({ operation: 'upload', key: 'private-files/requests/r1/f1', expiresAt, contentType: 'application/pdf' }, secret);
    const response = await receiveStorageUpload(new Request(absolute(url), { method: 'PUT', headers: { origin: appUrl, 'content-type': 'application/pdf' }, body: pdf }), dependencies(storage));
    expect(response.status).toBe(200);
    expect(objects.get('private-files/requests/r1/f1')).toEqual({ body: pdf, contentType: 'application/pdf' });
  });

  it('rejects uploads from another site, with another type, too large or with a download grant', async () => {
    const { storage, objects } = memoryStorage();
    const url = signStorageUrl({ operation: 'upload', key: 'private-files/requests/r1/f1', expiresAt, contentType: 'application/pdf' }, secret);
    const put = (headers: Record<string, string>, body: BodyInit) => receiveStorageUpload(new Request(absolute(url), { method: 'PUT', headers, body }), dependencies(storage));
    expect((await put({ origin: 'https://evil.example', 'content-type': 'application/pdf' }, pdf)).status).toBe(403);
    expect((await put({ origin: appUrl, 'content-type': 'text/html' }, pdf)).status).toBe(415);
    expect((await put({ origin: appUrl, 'content-type': 'application/pdf' }, new Uint8Array(2048))).status).toBe(413);
    const download = signStorageUrl({ operation: 'download', key: 'private-files/requests/r1/f1', expiresAt, disposition: 'attachment', fileName: null }, secret);
    expect((await receiveStorageUpload(new Request(absolute(download), { method: 'PUT', headers: { origin: appUrl, 'content-type': 'application/pdf' }, body: pdf }), dependencies(storage))).status).toBe(403);
    expect(objects.size).toBe(0);
  });

  it('caps a body that arrives without a declared length', async () => {
    const { storage, objects } = memoryStorage();
    const url = signStorageUrl({ operation: 'upload', key: 'private-files/requests/r1/f2', expiresAt, contentType: 'application/pdf' }, secret);
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 4; index += 1) controller.enqueue(new Uint8Array(512));
        controller.close();
      },
    });
    const request = new Request(absolute(url), { method: 'PUT', headers: { origin: appUrl, 'content-type': 'application/pdf' }, body: chunks, duplex: 'half' } as RequestInit);
    expect((await receiveStorageUpload(request, dependencies(storage))).status).toBe(413);
    expect(objects.size).toBe(0);
  });
});
