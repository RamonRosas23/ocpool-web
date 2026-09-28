import { assertSameOrigin } from '@/server/auth/csrf';
import { readServerEnv } from '@/server/env';
import { logger } from '@/server/logging/logger';
import { getPrivateStorage, type PrivateStorage } from '@/server/modules/private-files/storage';
import { contentDisposition, verifyStorageUrl, type StorageUrlGrant } from '@/server/modules/private-files/storage-url';

/**
 * Pasarela entre el navegador y el almacenamiento privado: sirve las descargas y recibe las subidas
 * de los enlaces firmados por `signStorageUrl`, siempre desde el dominio de la aplicación. Cada
 * respuesta es privada (sin caché) y nada subido por un usuario se muestra en línea: sólo el PDF que
 * genera OCPOOL puede previsualizarse, y sólo dentro del propio sitio.
 */
export type StorageGatewayDependencies = Readonly<{
  storage?: PrivateStorage;
  secret?: string;
  appUrl?: string;
  maxBytes?: number;
  now?: Date;
}>;

const PRIVATE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'private, no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const INLINE_CONTENT_TYPES = new Set(['application/pdf']);

function failure(status: number, message: string): Response {
  return new Response(message, { status, headers: { ...PRIVATE_HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

function verify(request: Request, dependencies: StorageGatewayDependencies): StorageUrlGrant | Response {
  const env = readServerEnv();
  const verification = verifyStorageUrl(new URL(request.url).searchParams, dependencies.secret ?? env.STORAGE_S3_SECRET_KEY, dependencies.now ?? new Date());
  if (verification.ok) return verification.grant;
  return verification.reason === 'EXPIRED'
    ? failure(410, 'El enlace venció. Vuelve a abrir el archivo desde OCPOOL.')
    : failure(403, 'El enlace no es válido.');
}

function mediaType(value: string | null): string {
  return (value ?? '').split(';')[0]!.trim().toLowerCase();
}

/** Lee el cuerpo sin pasar de `maxBytes` aunque llegue sin Content-Length; null si lo excede. */
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function serveStorageDownload(request: Request, dependencies: StorageGatewayDependencies = {}): Promise<Response> {
  const grant = verify(request, dependencies);
  if (grant instanceof Response) return grant;
  if (grant.operation !== 'download') return failure(403, 'El enlace no es válido.');

  const storage = dependencies.storage ?? getPrivateStorage();
  let head: Awaited<ReturnType<PrivateStorage['head']>>;
  let body: Uint8Array;
  try {
    head = await storage.head(grant.key);
    if (!head) return failure(404, 'El archivo ya no está disponible.');
    body = await storage.read(grant.key);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Private storage download failed');
    return failure(502, 'No fue posible obtener el archivo. Inténtalo de nuevo.');
  }

  const contentType = head.contentType ?? 'application/octet-stream';
  const inline = grant.disposition === 'inline' && INLINE_CONTENT_TYPES.has(mediaType(contentType));
  const framing: Record<string, string> = inline
    // La vista previa del PDF vive en un iframe del propio sitio.
    ? { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "frame-ancestors 'self'" }
    : { 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox" };
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      ...framing,
      'content-type': contentType,
      'content-length': String(body.byteLength),
      'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', grant.fileName),
    },
  });
}

export async function receiveStorageUpload(request: Request, dependencies: StorageGatewayDependencies = {}): Promise<Response> {
  const env = readServerEnv();
  try {
    assertSameOrigin(request, dependencies.appUrl ?? env.APP_URL);
  } catch {
    return failure(403, 'Solicitud no permitida.');
  }
  const grant = verify(request, dependencies);
  if (grant instanceof Response) return grant;
  if (grant.operation !== 'upload') return failure(403, 'El enlace no es válido.');
  if (mediaType(request.headers.get('content-type')) !== grant.contentType.toLowerCase()) {
    return failure(415, 'El tipo del archivo no coincide con la carga preparada.');
  }

  const maxBytes = dependencies.maxBytes ?? env.STORAGE_MAX_FILE_BYTES;
  const declaredLength = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return failure(413, 'El archivo excede el tamaño permitido.');
  const body = await readBodyWithLimit(request, maxBytes);
  if (!body) return failure(413, 'El archivo excede el tamaño permitido.');

  try {
    await (dependencies.storage ?? getPrivateStorage()).put({ key: grant.key, body, contentType: grant.contentType });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Private storage upload failed');
    return failure(502, 'No fue posible guardar el archivo. Inténtalo de nuevo.');
  }
  return new Response(null, { status: 200, headers: PRIVATE_HEADERS });
}
