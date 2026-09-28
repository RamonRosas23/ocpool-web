import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { toErrorResponse } from '@/server/http/errors';
import { listDeletedPrivateFiles } from '@/server/modules/private-files/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await listDeletedPrivateFiles(actor, quoteRequestId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
