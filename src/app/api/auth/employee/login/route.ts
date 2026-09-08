import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { createSessionCookie } from '@/server/auth/sessions';
import { loginEmployee } from '@/server/auth/service';
import { employeeLoginSchema, parseBody, requestContext, requestId } from '@/server/auth/http';
import { readServerEnv } from '@/server/env';

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const body = await parseBody(request, employeeLoginSchema);
    const result = await loginEmployee({ ...body, context: requestContext(request) });
    if (!result.ok) throw new AppError('UNAUTHORIZED', 'Correo o contraseña inválidos.', 401);

    const response = NextResponse.json({ authenticated: true }, { status: 200 });
    response.cookies.set(createSessionCookie(result.rawToken, result.expiresAt));
    return response;
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
