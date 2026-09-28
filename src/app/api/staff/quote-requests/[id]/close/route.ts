import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { QUOTE_REQUEST_CLOSE_REASONS } from '@/server/modules/quote-requests/domain';
import { closeQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const bodySchema = z.object({
  reason: z.enum(QUOTE_REQUEST_CLOSE_REASONS),
  note: z.string().max(500).optional(),
}).strict();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, bodySchema);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await closeQuoteRequest(actor, quoteRequestId, body), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
