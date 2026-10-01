import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomerActor } from '@/server/auth/customer';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { DECLINE_REASON_CODES } from '@/lib/decline-request';
import { declineCustomerQuote } from '@/server/modules/quote-documents/decline-service';

const bodySchema = z.object({
  versionId: z.string().uuid(),
  reason: z.enum(DECLINE_REASON_CODES),
  comment: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireCustomerActor(request);
    const { id: quoteId } = await context.params;
    const body = await parseBody(request, bodySchema);
    const result = await declineCustomerQuote(actor, quoteId, body);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
