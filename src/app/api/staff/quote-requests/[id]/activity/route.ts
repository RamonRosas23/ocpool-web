import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { listStaffQuoteRequestActivity } from '@/server/modules/quote-requests/staff-service';

type RouteContext = { params: Promise<{ id: string }> };

const activityQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const parsed = activityQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros de actividad no son válidos.', 400);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await listStaffQuoteRequestActivity(actor, quoteRequestId, parsed.data), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
