import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { searchQuoteCatalogItems } from '@/server/modules/catalog/service';

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  query: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

function parseQuery(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros de búsqueda no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: priceListId } = await context.params;
    return NextResponse.json(await searchQuoteCatalogItems(actor, priceListId, parseQuery(request)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
