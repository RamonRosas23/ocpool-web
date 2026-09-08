import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomerActor } from '@/server/auth/customer';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestContext, requestId } from '@/server/auth/http';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { acceptCustomerQuote } from '@/server/modules/quote-documents/acceptance-service';

const bodySchema = z.object({
  signerName: z.string().trim().min(1).max(180),
  termsVersion: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/iu),
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
    const contextData = requestContext(request);
    const result = await acceptCustomerQuote(actor, quoteId, { ...body, ...contextData });
    return NextResponse.json({
      id: result.id,
      quoteId: result.quoteId,
      quoteVersionId: result.quoteVersionId,
      versionNumber: result.versionNumber,
      status: result.status,
      signerName: result.signerName,
      termsVersion: result.termsVersion,
      acceptedAt: result.acceptedAt,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
