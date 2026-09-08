import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readServerEnv } from '@/server/env';

export type PrivateStorageHead = Readonly<{
  contentLength: number;
  contentType: string | null;
  etag: string | null;
}>;

export type PrivateStorage = Readonly<{
  ensureBucket: () => Promise<void>;
  put: (input: { key: string; body: Uint8Array; contentType: string }) => Promise<void>;
  createUploadUrl: (input: { key: string; contentType: string; expiresInSeconds: number }) => Promise<string>;
  createDownloadUrl: (input: { key: string; expiresInSeconds: number }) => Promise<string>;
  head: (key: string) => Promise<PrivateStorageHead | null>;
  read: (key: string) => Promise<Uint8Array>;
  delete: (key: string) => Promise<void>;
}>;

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.name === 'NoSuchBucket';
}

function stripEtag(value: string | undefined): string | null {
  return value ? value.replace(/^"|"$/gu, '') : null;
}

export function createS3PrivateStorage(): PrivateStorage {
  const env = readServerEnv();
  const client = new S3Client({
    endpoint: env.STORAGE_S3_ENDPOINT,
    region: env.STORAGE_S3_REGION,
    forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_S3_ACCESS_KEY,
      secretAccessKey: env.STORAGE_S3_SECRET_KEY,
    },
  });

  return {
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: env.STORAGE_S3_BUCKET }));
      } catch (error) {
        if (!isNotFound(error)) throw error;
        try {
          await client.send(new CreateBucketCommand({ Bucket: env.STORAGE_S3_BUCKET }));
        } catch (createError) {
          const name = createError && typeof createError === 'object' && 'name' in createError ? String(createError.name) : '';
          if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw createError;
        }
      }
    },
    async put({ key, body, contentType }) {
      await client.send(new PutObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
    },
    async createUploadUrl({ key, contentType, expiresInSeconds }) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: key, ContentType: contentType }), { expiresIn: expiresInSeconds });
    },
    async createDownloadUrl({ key, expiresInSeconds }) {
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: env.STORAGE_S3_BUCKET,
        Key: key,
        ResponseContentDisposition: 'attachment',
      }), { expiresIn: expiresInSeconds });
    },
    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: key }));
        const contentLength = result.ContentLength;
        if (typeof contentLength !== 'number' || !Number.isSafeInteger(contentLength) || contentLength < 0) throw new Error('Storage object has invalid size.');
        const safeContentLength: number = contentLength;
        return { contentLength: safeContentLength, contentType: result.ContentType ?? null, etag: stripEtag(result.ETag) };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async read(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: key }));
      if (!result.Body || typeof result.Body.transformToByteArray !== 'function') throw new Error('Storage object body is unavailable.');
      return result.Body.transformToByteArray();
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: key }));
    },
  };
}

let localStorage: PrivateStorage | undefined;

export function getPrivateStorage(): PrivateStorage {
  if (!localStorage) localStorage = createS3PrivateStorage();
  return localStorage;
}
