import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { updateCatalogItem } from '@/server/modules/catalog/service';

const bodySchema = z.object({ code: z.string().trim().min(1).max(64).optional(), name: z.string().trim().min(1).max(180).optional(), description: z.string().trim().max(2000).nullable().optional(), unit: z.string().trim().min(1).max(40).optional(), categoryId: z.string().uuid().nullable().optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict();
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, bodySchema);
    const { id: itemId } = await context.params;
    return NextResponse.json(await updateCatalogItem(actor, itemId, body), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
