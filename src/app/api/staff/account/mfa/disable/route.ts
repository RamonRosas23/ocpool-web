import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestContext, requestId } from '@/server/auth/http';
import { requireStaffSession } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { disableAccountMfa } from '@/server/modules/account/service';

const bodySchema = z.object({ currentPassword: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/u) }).strict();

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const { actor } = await requireStaffSession(request);
    const body = await parseBody(request, bodySchema);
    return NextResponse.json(await disableAccountMfa(actor, body, requestContext(request)), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
