import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { QUOTE_REQUEST_STATUSES } from '@/server/modules/quote-requests/domain';
import { listStaffQuoteRequests } from '@/server/modules/quote-requests/staff-service';

const querySchema = z.object({
  status: z.enum(QUOTE_REQUEST_STATUSES).optional(),
  assignedToId: z.string().uuid().optional(),
  query: z.string().trim().max(100).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
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
    const result = await listStaffQuoteRequests(actor, parseQuery(request));
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
