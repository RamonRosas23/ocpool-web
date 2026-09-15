import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { idempotencyKeySchema } from '@/server/http/idempotency';
import { MAX_MESSAGE_LENGTH } from '@/server/modules/messaging/domain';
import { QUOTE_REQUEST_INFORMATION_FIELDS } from '@/server/modules/quote-requests/domain';
import { requestInformationQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const requestInformationSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  idempotencyKey: idempotencyKeySchema,
  missingFields: z.array(z.enum(QUOTE_REQUEST_INFORMATION_FIELDS)).max(QUOTE_REQUEST_INFORMATION_FIELDS.length).optional(),
  enablePortalAccess: z.boolean().optional(),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, requestInformationSchema);
    const { id: quoteRequestId } = await context.params;
    const result = await requestInformationQuoteRequest(actor, quoteRequestId, body);
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
