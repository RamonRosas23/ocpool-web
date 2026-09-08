import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { QUOTE_REQUEST_STATUSES } from '@/server/modules/quote-requests/domain';
import { transitionQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const statusSchema = z.object({
  toStatus: z.enum(QUOTE_REQUEST_STATUSES),
  reason: z.string().trim().max(500).optional(),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, statusSchema);
    const { id: quoteRequestId } = await context.params;
    const result = await transitionQuoteRequest(actor, quoteRequestId, body);
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
