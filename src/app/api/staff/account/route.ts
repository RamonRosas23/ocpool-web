import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffSession } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { getAccountOverview, updateAccountProfile } from '@/server/modules/account/service';

const profileSchema = z.object({ displayName: z.string().max(180) }).strict();

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const { actor, sessionId } = await requireStaffSession(request);
    return NextResponse.json(await getAccountOverview(actor, sessionId), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function PATCH(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const { actor } = await requireStaffSession(request);
    const body = await parseBody(request, profileSchema);
    return NextResponse.json(await updateAccountProfile(actor, body), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
