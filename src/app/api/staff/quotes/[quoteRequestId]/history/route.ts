import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { listQuoteVersionHistory } from '@/server/modules/quotes/staff-service';

type RouteContext = { params: Promise<{ quoteRequestId: string }> };

const historyQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const parsed = historyQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros de historial no son válidos.', 400);
    const { quoteRequestId } = await context.params;
    return NextResponse.json(await listQuoteVersionHistory(actor, quoteRequestId, parsed.data), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
