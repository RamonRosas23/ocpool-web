import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { toErrorResponse } from '@/server/http/errors';
import { getQuoteDocumentStatusForVersion } from '@/server/modules/quote-documents/access-service';

type RouteContext = { params: Promise<{ versionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    return NextResponse.json(await getQuoteDocumentStatusForVersion(actor, versionId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
