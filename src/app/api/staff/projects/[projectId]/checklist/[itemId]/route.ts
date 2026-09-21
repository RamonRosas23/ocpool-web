import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { setProjectChecklistItemCompletion } from '@/server/modules/projects/service';

const bodySchema = z.object({ completed: z.boolean() }).strict();

type RouteContext = { params: Promise<{ projectId: string; itemId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { projectId, itemId } = await context.params;
    const body = await parseBody(request, bodySchema);
    await setProjectChecklistItemCompletion(actor, projectId, itemId, body.completed);
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
