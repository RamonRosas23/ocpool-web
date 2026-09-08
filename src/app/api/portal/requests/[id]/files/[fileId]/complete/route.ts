import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireCustomerActor } from '@/server/auth/customer';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { fileCompleteSchema } from '@/server/modules/private-files/http';
import { completePrivateFile } from '@/server/modules/private-files/service';

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireCustomerActor(request);
    await parseBody(request, fileCompleteSchema);
    const { id: quoteRequestId, fileId } = await context.params;
    return NextResponse.json(await completePrivateFile(actor, quoteRequestId, fileId), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
