import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { requestContext, requestId } from '@/server/auth/http';
import { requireStaffSession } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { revokeAccountSession } from '@/server/modules/account/service';

type RouteContext = { params: Promise<{ sessionId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Cierra una sesión propia abierta en otro equipo. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const { actor, sessionId: currentSessionId } = await requireStaffSession(request);
    const { sessionId } = await context.params;
    if (!UUID_PATTERN.test(sessionId)) throw new AppError('VALIDATION_ERROR', 'La sesión no es válida.', 400);
    return NextResponse.json(await revokeAccountSession(actor, currentSessionId, sessionId, requestContext(request)), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
