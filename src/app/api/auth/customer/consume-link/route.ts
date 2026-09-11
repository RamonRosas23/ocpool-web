import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { consumeLinkSchema, parseBody, requestContext, requestId } from '@/server/auth/http';
import { createSessionCookie } from '@/server/auth/sessions';
import { consumeCustomerMagicLink } from '@/server/auth/service';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const body = await parseBody(request, consumeLinkSchema);
    const result = await consumeCustomerMagicLink(body.token, requestContext(request));
    if (!result.ok) throw new AppError('UNAUTHORIZED', 'El enlace no es válido o ya expiró.', 401);

    const response = NextResponse.json({ authenticated: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
    response.cookies.set(createSessionCookie(result.rawToken, result.expiresAt));
    return response;
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
