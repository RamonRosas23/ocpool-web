import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerActor } from '@/server/auth/customer';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';
import { getQuotePdfDownloadForQuote } from '@/server/modules/quote-documents/access-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireCustomerActor(request);
    const { id: quoteId } = await context.params;
    const versionId = request.nextUrl.searchParams.get('versionId') ?? undefined;
    // `?disposition=inline` para verlo dentro del portal; cualquier otro valor descarga.
    const disposition = request.nextUrl.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    return NextResponse.json(await getQuotePdfDownloadForQuote(actor, quoteId, versionId, { disposition }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
