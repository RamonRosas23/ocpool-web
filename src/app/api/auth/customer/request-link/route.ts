import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { customerMagicLinkRequestSchema, parseBody, requestContext, requestId } from '@/server/auth/http';
import { requestCustomerMagicLink } from '@/server/auth/service';
import { toErrorResponse } from '@/server/http/errors';
import { readServerEnv } from '@/server/env';

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const body = await parseBody(request, customerMagicLinkRequestSchema);
    await requestCustomerMagicLink({ ...body, context: requestContext(request) });
    return NextResponse.json({ accepted: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
