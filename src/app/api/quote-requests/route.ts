import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { checkAuthRateLimit, checkAuthRateLimitIfKeyAvailable } from '@/server/auth/rate-limit';
import { emailSchema, parseBody, requestContext, requestId } from '@/server/auth/http';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

const publicQuoteRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(180),
  phone: z.string().trim().min(7).max(40),
  email: emailSchema,
  projectType: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(180),
  description: z.string().trim().min(10).max(10_000),
  consent: z.literal(true),
}).strict();

function idempotencyKey(request: NextRequest): string {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value || value.length < 16 || value.length > 200) {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  }
  return value;
}

async function enforceRateLimit(email: string, ipAddress: string | null): Promise<void> {
  const env = readServerEnv();
  const byEmail = await checkAuthRateLimit({
    scope: 'quote-request-email',
    key: email,
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES,
  });
  if (!byEmail.allowed) {
    throw new AppError('RATE_LIMITED', 'Ya recibimos varios intentos. Espera unos minutos antes de enviar otra solicitud.', 429);
  }

  const byIp = await checkAuthRateLimitIfKeyAvailable({
    scope: 'quote-request-ip',
    key: ipAddress,
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES,
  });
  if (!byIp.allowed) {
    throw new AppError('RATE_LIMITED', 'Ya recibimos varios intentos. Espera unos minutos antes de enviar otra solicitud.', 429);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const body = await parseBody(request, publicQuoteRequestSchema);
    const retryKey = idempotencyKey(request);
    const context = requestContext(request);
    await enforceRateLimit(body.email, context.ipAddress);
    const result = await createQuoteRequest({
      idempotencyKey: retryKey,
      origin: 'PUBLIC_FORM',
      contact: {
        displayName: body.displayName,
        email: body.email,
        phone: body.phone,
      },
      detail: {
        projectType: body.projectType,
        location: body.location,
        description: body.description,
        consentAt: new Date(),
      },
    });

    return NextResponse.json({ accepted: true, folio: result.folio }, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
