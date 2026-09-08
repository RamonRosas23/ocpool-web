import { NextRequest, NextResponse } from 'next/server';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';
import { getPrivateFileDownload } from '@/server/modules/private-files/service';

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: quoteRequestId, fileId } = await context.params;
    return NextResponse.json(await getPrivateFileDownload(actor, quoteRequestId, fileId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
