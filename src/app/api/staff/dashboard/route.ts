import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { getStaffDashboard } from '@/server/modules/analytics/service';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const querySchema = z.object({
  from: z.string().regex(DATE_ONLY_PATTERN).optional(),
  to: z.string().regex(DATE_ONLY_PATTERN).optional(),
}).strict();

function parseQuery(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const result = await getStaffDashboard(actor, parseQuery(request));
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
