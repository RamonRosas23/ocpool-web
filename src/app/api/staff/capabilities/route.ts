import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/server/auth/permissions';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    return NextResponse.json({
      catalogRead: hasPermission(actor, 'catalog.read'),
      catalogManage: hasPermission(actor, 'catalog.manage'),
      pricesRead: hasPermission(actor, 'prices.read'),
      pricesManage: hasPermission(actor, 'prices.manage'),
      quotesRead: hasPermission(actor, 'quotes.read'),
      quotesCreate: hasPermission(actor, 'quotes.create'),
      quotesEditPrices: hasPermission(actor, 'quotes.edit_prices'),
      quotesApplyDiscount: hasPermission(actor, 'quotes.apply_discount'),
      quotesApproveDiscount: hasPermission(actor, 'quotes.approve_discount'),
      quotesSend: hasPermission(actor, 'quotes.send'),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
