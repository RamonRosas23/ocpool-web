import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { setProjectOwner } from '@/server/modules/projects/service';

const bodySchema = z.object({ ownerId: z.string().uuid().nullable() }).strict();

type RouteContext = { params: Promise<{ projectId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { projectId } = await context.params;
    const body = await parseBody(request, bodySchema);
    await setProjectOwner(actor, projectId, body.ownerId);
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
