import { NextRequest, NextResponse } from 'next/server';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';
import { findStaffQuoteRequestMatches } from '@/server/modules/quote-requests/staff-service';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    return NextResponse.json({ items: await findStaffQuoteRequestMatches(actor, { email: request.nextUrl.searchParams.get('email') ?? '', phone: request.nextUrl.searchParams.get('phone') }, {}) }, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
