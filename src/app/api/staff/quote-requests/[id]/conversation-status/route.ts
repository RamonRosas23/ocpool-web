import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { conversationStatusSchema } from '@/server/modules/messaging/http';
import { closeConversation, reopenConversation } from '@/server/modules/messaging/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, conversationStatusSchema);
    const { id: quoteRequestId } = await context.params;
    const result = body.status === 'CLOSED'
      ? await closeConversation(actor, quoteRequestId)
      : await reopenConversation(actor, quoteRequestId);
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
