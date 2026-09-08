import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { AppError } from '@/server/http/errors';

export const emailSchema = z.string().trim().email().max(320);
export const passwordSchema = z.string().min(12).max(128).regex(/[A-Za-z]/).regex(/[0-9]/);
export const tokenSchema = z.string().trim().min(40).max(256);

export const employeeLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
}).strict();

export const emailBodySchema = z.object({ email: emailSchema }).strict();
export const consumeLinkSchema = z.object({ token: tokenSchema }).strict();
export const recoveryConsumeSchema = z.object({ token: tokenSchema, newPassword: passwordSchema }).strict();

const MAX_BODY_BYTES = 16_384;

export function requestId(): string {
  return randomUUID();
}

export function requestContext(request: Pick<NextRequest, 'headers'>) {
  const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true';
  const forwardedFor = trustProxyHeaders ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  const candidateIp = forwardedFor || (trustProxyHeaders ? request.headers.get('x-real-ip')?.trim() : undefined);
  return {
    ipAddress: candidateIp && candidateIp.length <= 64 ? candidateIp : null,
    userAgent: request.headers.get('user-agent'),
  };
}

async function readBodyWithinLimit(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel('request body exceeds limit');
        throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  }
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  const rawContentLength = request.headers.get('content-length');
  const contentLength = rawContentLength === null ? null : Number(rawContentLength);
  if (!contentType.toLowerCase().startsWith('application/json') || contentLength !== null && (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES)) {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  }
  const body = await readBodyWithinLimit(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  return parsed.data;
}

export function sessionToken(request: NextRequest): string | null {
  return request.cookies.get('ocpool_session')?.value ?? null;
}
