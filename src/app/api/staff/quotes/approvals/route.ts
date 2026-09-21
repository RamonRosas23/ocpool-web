import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { listPendingQuoteApprovalsPageForActor } from '@/server/modules/quotes/approval-service';

const querySchema = z.object({
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
    const result = await listPendingQuoteApprovalsPageForActor(actor, parseQuery(request));
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
