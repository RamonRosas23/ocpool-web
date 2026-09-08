import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { transitionQuoteVersion } from '@/server/modules/quotes/service';
import { QUOTE_VERSION_STATUSES } from '@/server/modules/quotes/domain';

const bodySchema = z.object({ toStatus: z.enum(QUOTE_VERSION_STATUSES) }).strict();
type RouteContext = { params: Promise<{ versionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    const body = await parseBody(request, bodySchema);
    return NextResponse.json(await transitionQuoteVersion(actor, versionId, body.toStatus), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
