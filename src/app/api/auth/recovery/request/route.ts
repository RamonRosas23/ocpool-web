import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { emailBodySchema, parseBody, requestContext, requestId } from '@/server/auth/http';
import { requestPasswordRecovery } from '@/server/auth/service';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const body = await parseBody(request, emailBodySchema);
    await requestPasswordRecovery({ ...body, context: requestContext(request) });
    return NextResponse.json({ accepted: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
