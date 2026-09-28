import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { toErrorResponse } from '@/server/http/errors';
import { listWaitingOnCustomerForActor } from '@/server/modules/quote-requests/staff-service';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    return NextResponse.json(await listWaitingOnCustomerForActor(actor), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
