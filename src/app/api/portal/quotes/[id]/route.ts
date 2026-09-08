import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerActor } from '@/server/auth/customer';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';
import { getCustomerQuote } from '@/server/modules/client-portal/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireCustomerActor(request);
    const { id: quoteId } = await context.params;
    return NextResponse.json(await getCustomerQuote(actor, quoteId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
