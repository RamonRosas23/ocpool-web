import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { currentSessionActor, logout } from '@/server/auth/service';
import { clearSessionCookie } from '@/server/auth/sessions';
import { requestContext, requestId, sessionToken } from '@/server/auth/http';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const token = sessionToken(request);
    if (!token) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
    const session = await currentSessionActor(token);
    if (!session) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
    return NextResponse.json({ userId: session.actor.userId, type: session.actor.type, clientId: session.actor.clientId, mfaVerified: session.actor.mfaVerified }, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = toErrorResponse(error, id);
    if (sessionToken(request)) response.cookies.set(clearSessionCookie());
    return response;
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const token = sessionToken(request);
    if (token) await logout(token, requestContext(request));
    const response = NextResponse.json({ loggedOut: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
    response.cookies.set(clearSessionCookie());
    return response;
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
