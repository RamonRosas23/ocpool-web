import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { createCatalogItem, listCatalogItems } from '@/server/modules/catalog/service';

const querySchema = z.object({ query: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional(), categoryId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(50).optional() }).strict();
const bodySchema = z.object({ code: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(180), description: z.string().trim().max(2000).nullable().optional(), unit: z.string().trim().min(1).max(40), categoryId: z.string().uuid().nullable().optional() }).strict();

function parseQuery(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    return NextResponse.json(await listCatalogItems(actor, parseQuery(request)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    return NextResponse.json(await createCatalogItem(actor, await parseBody(request, bodySchema)), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
