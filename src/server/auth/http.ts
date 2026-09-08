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
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ipAddress: forwardedFor || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  };
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  return parsed.data;
}

export function sessionToken(request: NextRequest): string | null {
  return request.cookies.get('ocpool_session')?.value ?? null;
}
