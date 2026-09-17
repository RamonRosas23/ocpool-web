import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { clonePublishedVersion, serializeQuoteVersionResult } from '@/server/modules/quotes/service';

const bodySchema = z.object({ priceListId: z.string().uuid() }).strict();
type RouteContext = { params: Promise<{ quoteRequestId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { quoteRequestId } = await context.params;
    const result = await clonePublishedVersion(actor, quoteRequestId, await parseBody(request, bodySchema));
    return NextResponse.json(serializeQuoteVersionResult(result), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
