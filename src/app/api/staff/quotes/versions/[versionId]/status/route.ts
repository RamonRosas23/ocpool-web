import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { publishQuoteVersion, rejectQuoteVersion, returnQuoteToDraft, submitQuoteForReview } from '@/server/modules/quotes/service';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit_for_review') }).strict(),
  z.object({ action: z.literal('return_to_draft'), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('publish') }).strict(),
]);

type RouteContext = { params: Promise<{ versionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    const body = await parseBody(request, bodySchema);
    const result = body.action === 'submit_for_review' ? await submitQuoteForReview(actor, versionId)
      : body.action === 'return_to_draft' ? await returnQuoteToDraft(actor, versionId, { reason: body.reason })
      : body.action === 'reject' ? await rejectQuoteVersion(actor, versionId, { reason: body.reason })
      : await publishQuoteVersion(actor, versionId);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
