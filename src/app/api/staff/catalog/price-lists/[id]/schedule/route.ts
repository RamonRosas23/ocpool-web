import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { schedulePrice } from '@/server/modules/catalog/service';

const bodySchema = z.object({
  catalogItemId: z.string().uuid(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  effectiveFrom: z.coerce.date(),
  reason: z.string().trim().max(300).optional(),
}).strict();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, bodySchema);
    const { id: priceListId } = await context.params;
    return NextResponse.json(await schedulePrice(actor, priceListId, body), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
