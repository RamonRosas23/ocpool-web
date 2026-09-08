import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomerActor } from '@/server/auth/customer';
import { requestId } from '@/server/auth/http';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { listCustomerQuoteRequests } from '@/server/modules/client-portal/service';

const querySchema = z.object({ query: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(25).optional() }).strict();

function parseQuery(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireCustomerActor(request);
    return NextResponse.json(await listCustomerQuoteRequests(actor, parseQuery(request)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
