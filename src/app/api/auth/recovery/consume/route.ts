import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, recoveryConsumeSchema, requestContext, requestId } from '@/server/auth/http';
import { consumePasswordRecovery } from '@/server/auth/service';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const body = await parseBody(request, recoveryConsumeSchema);
    const consumed = await consumePasswordRecovery({ rawToken: body.token, newPassword: body.newPassword, context: requestContext(request) });
    if (!consumed) throw new AppError('UNAUTHORIZED', 'El enlace no es válido o ya expiró.', 401);
    return NextResponse.json({ passwordReset: true }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
