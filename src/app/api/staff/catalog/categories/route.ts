import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { createCatalogCategory, listCatalogCategories } from '@/server/modules/catalog/service';

const querySchema = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict();
const bodySchema = z.object({ code: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(180), description: z.string().trim().max(500).nullable().optional(), sortOrder: z.number().int().min(0).max(100000).optional() }).strict();

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
    return NextResponse.json(await listCatalogCategories(actor, parsed.data.status), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    return NextResponse.json(await createCatalogCategory(actor, await parseBody(request, bodySchema)), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
