import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { toErrorResponse } from '@/server/http/errors';
import { getInboxSummary } from '@/server/modules/inbox/service';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireSessionActor(request);
    return NextResponse.json(await getInboxSummary(actor), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
