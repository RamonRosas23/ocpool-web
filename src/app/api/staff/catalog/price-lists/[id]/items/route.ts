import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { getPriceList, upsertPriceListItem } from '@/server/modules/catalog/service';

const bodySchema = z.object({ catalogItemId: z.string().uuid(), unitPriceMinor: z.string().regex(/^\d+$/), validFrom: z.coerce.date(), validUntil: z.coerce.date().nullable().optional() }).strict();
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: priceListId } = await context.params;
    return NextResponse.json(await getPriceList(actor, priceListId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, bodySchema);
    const { id: priceListId } = await context.params;
    return NextResponse.json(await upsertPriceListItem(actor, priceListId, body), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
