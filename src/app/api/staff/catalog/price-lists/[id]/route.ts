import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { toErrorResponse } from '@/server/http/errors';
import { getPriceList } from '@/server/modules/catalog/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: priceListId } = await context.params;
    return NextResponse.json(await getPriceList(actor, priceListId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
