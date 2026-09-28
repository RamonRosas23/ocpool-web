import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { requestContext, requestId } from '@/server/auth/http';
import { requireStaffSession } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { revokeOtherAccountSessions } from '@/server/modules/account/service';

/** Cierra todas las sesiones propias excepto la actual. */
export async function DELETE(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const { actor, sessionId } = await requireStaffSession(request);
    return NextResponse.json(await revokeOtherAccountSessions(actor, sessionId, requestContext(request)), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
