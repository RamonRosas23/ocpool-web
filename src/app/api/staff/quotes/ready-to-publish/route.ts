import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { toErrorResponse } from '@/server/http/errors';
import { listReadyToPublishForActor } from '@/server/modules/quotes/service';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const items = await listReadyToPublishForActor(actor);
    return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
