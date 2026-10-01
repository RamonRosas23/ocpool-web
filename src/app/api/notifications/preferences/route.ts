import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { requireInboxAccess } from '@/server/modules/inbox/service';
import { readInboxPreferences, updateInboxPreferences } from '@/server/modules/inbox/preferences';

const patchSchema = z.object({
  sound: z.boolean().optional(),
  desktop: z.boolean().optional(),
  activityEmail: z.enum(['DIGEST', 'OFF']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Indica al menos una preferencia.');

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireSessionActor(request);
    requireInboxAccess(actor);
    return NextResponse.json(await readInboxPreferences(actor), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function PATCH(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireSessionActor(request);
    requireInboxAccess(actor);
    const body = await parseBody(request, patchSchema);
    return NextResponse.json(await updateInboxPreferences(actor, body), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return toErrorResponse(new AppError('VALIDATION_ERROR', 'Las preferencias no son válidas.', 400), id);
    return toErrorResponse(error, id);
  }
}
