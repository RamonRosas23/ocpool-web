import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { listQuoteWorkspaces } from '@/server/modules/quotes/staff-service';

const querySchema = z.object({ query: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(50).optional() }).strict();

function parseQuery(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    return NextResponse.json(await listQuoteWorkspaces(actor, parseQuery(request)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
