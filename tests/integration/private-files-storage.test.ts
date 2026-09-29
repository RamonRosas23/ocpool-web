import { describe, expect, it } from 'vitest';
import { GET as storageObjectGet, PUT as storageObjectPut } from '@/app/api/storage/object/route';
import { readServerEnv } from '@/server/env';
import { getPrivateStorage } from '@/server/modules/private-files/storage';

describe('private S3-compatible storage', () => {
  it('keeps the bucket private and moves bytes only through short-lived links of the app itself', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const origin = new URL(readServerEnv().APP_URL).origin;
    const storage = getPrivateStorage();
    const key = `private-files/${crypto.randomUUID()}`;
    const body = new TextEncoder().encode('%PDF-');
    await storage.ensureBucket();
    try {
      // El navegador nunca recibe el endpoint interno de MinIO, sólo rutas del propio sitio.
      const uploadUrl = await storage.createUploadUrl({ key, contentType: 'application/pdf', expiresInSeconds: 60 });
      expect(uploadUrl.startsWith('/api/storage/object?')).toBe(true);
      const upload = await storageObjectPut(new Request(new URL(uploadUrl, origin), { method: 'PUT', headers: { origin, 'content-type': 'application/pdf' }, body }));
      expect(upload.status).toBe(200);
      await expect(storage.head(key)).resolves.toMatchObject({ contentLength: body.byteLength, contentType: 'application/pdf' });
      await expect(storage.read(key)).resolves.toEqual(body);

      const download = await storageObjectGet(new Request(new URL(await storage.createDownloadUrl({ key, expiresInSeconds: 60, fileName: 'plano.pdf' }), origin)));
      expect(download.status).toBe(200);
      expect(download.headers.get('content-disposition')).toBe(`attachment; filename="plano.pdf"; filename*=UTF-8''plano.pdf`);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(body);
      // La vista previa del PDF generado se sirve `inline` para que el navegador la muestre.
      const inline = await storageObjectGet(new Request(new URL(await storage.createDownloadUrl({ key, expiresInSeconds: 60, disposition: 'inline' }), origin)));
      expect(inline.status).toBe(200);
      expect(inline.headers.get('content-disposition')).toBe('inline');
    } finally {
      await storage.delete(key);
      await expect(storage.head(key)).resolves.toBeNull();
    }
  }, 30_000);
});
