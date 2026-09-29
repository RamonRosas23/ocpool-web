import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { markInboxRead } from '@/server/modules/inbox/service';

const bodySchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).max(100), read: z.boolean().optional() }).strict(),
  z.object({ all: z.literal(true) }).strict(),
  z.object({ quoteRequestId: z.string().uuid(), scope: z.enum(['activity', 'all']) }).strict(),
]);

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireSessionActor(request);
    const body = await parseBody(request, bodySchema);
    return NextResponse.json(await markInboxRead(actor, body), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
