import { NextRequest, NextResponse } from 'next/server';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';
import { getStaffQuoteRequest } from '@/server/modules/quote-requests/staff-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: quoteRequestId } = await context.params;
    const result = await getStaffQuoteRequest(actor, quoteRequestId);
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
