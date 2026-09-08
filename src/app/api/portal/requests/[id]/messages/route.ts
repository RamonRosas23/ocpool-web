import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireCustomerActor } from '@/server/auth/customer';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { listConversationMessages, sendCustomerMessage } from '@/server/modules/messaging/service';
import { messageBodySchema, messageQuerySchema } from '@/server/modules/messaging/http';

type RouteContext = { params: Promise<{ id: string }> };

function parseQuery(request: NextRequest) {
  const parsed = messageQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireCustomerActor(request);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await listConversationMessages(actor, quoteRequestId, parseQuery(request)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireCustomerActor(request);
    const body = await parseBody(request, messageBodySchema);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await sendCustomerMessage(actor, quoteRequestId, body), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
