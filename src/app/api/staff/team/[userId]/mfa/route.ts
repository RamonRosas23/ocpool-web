import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { requestContext, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { resetTeamMemberMfa } from '@/server/modules/team/service';

type RouteContext = { params: Promise<{ userId: string }> };

/** Quita la verificación en dos pasos de la persona (perdió su teléfono). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { userId } = await context.params;
    return NextResponse.json(await resetTeamMemberMfa(actor, userId, requestContext(request)), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
