import { describe, expect, it } from 'vitest';
import { getPrivateStorage } from '@/server/modules/private-files/storage';

describe('private S3-compatible storage', () => {
  it('keeps the bucket private while supporting ephemeral upload/download URLs', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const storage = getPrivateStorage();
    const key = `private-files/${crypto.randomUUID()}`;
    const body = new TextEncoder().encode('%PDF-');
    await storage.ensureBucket();
    try {
      const uploadUrl = await storage.createUploadUrl({ key, contentType: 'application/pdf', expiresInSeconds: 60 });
      const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body });
      expect(upload.ok).toBe(true);
      await expect(storage.head(key)).resolves.toMatchObject({ contentLength: body.byteLength, contentType: 'application/pdf' });
      await expect(storage.read(key)).resolves.toEqual(body);
      const downloadUrl = await storage.createDownloadUrl({ key, expiresInSeconds: 60 });
      const download = await fetch(downloadUrl);
      expect(download.status).toBe(200);
      expect(await download.arrayBuffer()).toEqual(body.buffer);
    } finally {
      await storage.delete(key);
      await expect(storage.head(key)).resolves.toBeNull();
    }
  }, 30_000);
});
