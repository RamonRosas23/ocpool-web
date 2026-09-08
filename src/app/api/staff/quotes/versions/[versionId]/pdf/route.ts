import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { getQuotePdfDownloadForVersion } from '@/server/modules/quote-documents/access-service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';

const emptyBodySchema = z.object({}).strict();
type RouteContext = { params: Promise<{ versionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    return NextResponse.json(await getQuotePdfDownloadForVersion(actor, versionId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    await parseBody(request, emptyBodySchema);
    const result = await generateQuotePdf(actor, versionId);
    return NextResponse.json({
      id: result.id,
      quoteId: result.quoteId,
      quoteVersionId: result.quoteVersionId,
      status: result.status,
      templateVersion: result.templateVersion,
      contentType: result.contentType,
      byteSize: result.byteSize,
      readyAt: result.readyAt,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
