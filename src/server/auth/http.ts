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

export function requestId(): string {
  return randomUUID();
}

export function requestContext(request: NextRequest) {
  const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true';
  const forwardedFor = trustProxyHeaders ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  return {
    ipAddress: trustProxyHeaders ? (forwardedFor || request.headers.get('x-real-ip')) : null,
    userAgent: request.headers.get('user-agent'),
  };
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!contentType.toLowerCase().startsWith('application/json') || contentLength > 16_384) {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  }
  if (JSON.stringify(body).length > 16_384) throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  return parsed.data;
}

export function sessionToken(request: NextRequest): string | null {
  return request.cookies.get('ocpool_session')?.value ?? null;
}
