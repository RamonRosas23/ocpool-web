import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { requestId } from '@/server/auth/http';
import { requireCustomerActor } from '@/server/auth/customer';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { deletePrivateFile } from '@/server/modules/private-files/service';

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireCustomerActor(request);
    const { id: quoteRequestId, fileId } = await context.params;
    return NextResponse.json(await deletePrivateFile(actor, quoteRequestId, fileId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
