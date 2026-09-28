import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Enlaces de corta vida para subir y descargar archivos privados A TRAVÉS de la aplicación
 * (`/api/storage/object`). Sustituyen a las URL prefirmadas de S3, que apuntaban al endpoint interno de
 * MinIO (`http://127.0.0.1:19000`): el navegador del cliente no puede llegar ahí, así que descargar,
 * subir y previsualizar fallaban en producción. El enlace sigue siendo una capacidad acotada
 * (operación, objeto, vigencia y tipo o disposición firmados con HMAC), pero vive en el mismo dominio:
 * MinIO permanece privado y no hay contenido mixto ni CORS.
 */
export const STORAGE_OBJECT_ROUTE = '/api/storage/object';

const SIGNATURE_VERSION = 'v1';
const KEY_PATTERN = /^private-files\/[A-Za-z0-9/_.-]{1,400}$/u;
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const MAX_FILE_NAME_LENGTH = 200;

export type StorageDisposition = 'attachment' | 'inline';

export type StorageUrlGrant =
  | Readonly<{ operation: 'download'; key: string; expiresAt: number; disposition: StorageDisposition; fileName: string | null }>
  | Readonly<{ operation: 'upload'; key: string; expiresAt: number; contentType: string }>;

export type StorageUrlVerification =
  | Readonly<{ ok: true; grant: StorageUrlGrant }>
  | Readonly<{ ok: false; reason: 'INVALID' | 'EXPIRED' }>;

const INVALID: StorageUrlVerification = { ok: false, reason: 'INVALID' };

function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function isValidGrant(grant: StorageUrlGrant): boolean {
  if (!isValidKey(grant.key) || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= 0) return false;
  if (grant.operation === 'upload') return CONTENT_TYPE_PATTERN.test(grant.contentType);
  if (grant.disposition !== 'attachment' && grant.disposition !== 'inline') return false;
  return grant.fileName === null || (grant.fileName.length > 0 && grant.fileName.length <= MAX_FILE_NAME_LENGTH && !CONTROL_CHARACTERS.test(grant.fileName));
}

/** Clave propia de estos enlaces, derivada del secreto de almacenamiento (separación de dominios). */
function signature(grant: StorageUrlGrant, secret: string): Buffer {
  const scope = grant.operation === 'download' ? `${grant.disposition}\n${grant.fileName ?? ''}` : grant.contentType;
  const payload = [SIGNATURE_VERSION, grant.operation, grant.key, String(grant.expiresAt), scope].join('\n');
  const key = createHmac('sha256', secret).update(`ocpool:storage-url:${SIGNATURE_VERSION}`).digest();
  return createHmac('sha256', key).update(payload).digest();
}

/** Ruta relativa firmada: funciona igual en ocpool.com.mx y www.ocpool.com.mx, siempre del mismo origen. */
export function signStorageUrl(grant: StorageUrlGrant, secret: string): string {
  if (!isValidGrant(grant)) throw new Error('Invalid storage URL grant.');
  const params = new URLSearchParams({ op: grant.operation, key: grant.key, exp: String(grant.expiresAt) });
  if (grant.operation === 'download') {
    params.set('disposition', grant.disposition);
    if (grant.fileName) params.set('name', grant.fileName);
  } else {
    params.set('type', grant.contentType);
  }
  params.set('sig', signature(grant, secret).toString('base64url'));
  return `${STORAGE_OBJECT_ROUTE}?${params.toString()}`;
}

export function verifyStorageUrl(params: URLSearchParams, secret: string, now: Date): StorageUrlVerification {
  const single = (name: string): string | null => {
    const values = params.getAll(name);
    return values.length === 1 ? values[0]! : null;
  };
  const operation = single('op');
  const key = single('key');
  const expires = single('exp');
  const received = single('sig');
  if (!key || !expires || !received || !/^\d{1,12}$/u.test(expires)) return INVALID;

  let grant: StorageUrlGrant;
  if (operation === 'download') {
    const disposition = single('disposition');
    const names = params.getAll('name');
    if ((disposition !== 'attachment' && disposition !== 'inline') || names.length > 1) return INVALID;
    grant = { operation, key, expiresAt: Number(expires), disposition, fileName: names[0] ?? null };
  } else if (operation === 'upload') {
    const contentType = single('type');
    if (!contentType) return INVALID;
    grant = { operation, key, expiresAt: Number(expires), contentType };
  } else {
    return INVALID;
  }
  if (!isValidGrant(grant)) return INVALID;

  const expected = signature(grant, secret);
  const provided = Buffer.from(received, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return INVALID;
  // La vigencia se revisa después de la firma: un enlace ajeno nunca recibe una respuesta distinta.
  if (grant.expiresAt * 1000 <= now.getTime()) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, grant };
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `attachment; filename="..."; filename*=UTF-8''...`: acentos para navegadores actuales y ASCII de respaldo. */
export function contentDisposition(disposition: StorageDisposition, fileName: string | null): string {
  if (!fileName) return disposition;
  const ascii = fileName.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[^\x20-\x7E]/gu, '_').replace(/["\\]/gu, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
