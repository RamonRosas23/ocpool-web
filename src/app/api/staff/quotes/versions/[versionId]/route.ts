import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { replaceQuoteDraft, serializeQuoteVersionResult } from '@/server/modules/quotes/service';

const rateSchema = z.union([z.string().regex(/^\d+$/u), z.number().int().min(0).max(10_000)]);
const bodySchema = z.object({
  priceListId: z.string().uuid(),
  lines: z.array(z.object({
    catalogItemId: z.string().uuid(),
    quantity: z.string().regex(/^\d+(?:\.\d{1,3})?$/u),
    unitPriceMinorOverride: z.string().regex(/^\d+$/u).optional(),
    discountBasisPoints: rateSchema.optional(),
    taxBasisPoints: rateSchema.optional(),
  }).strict()).min(1).max(100),
  validUntil: z.coerce.date().nullable().optional(),
}).strict();

type RouteContext = { params: Promise<{ versionId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    const result = await replaceQuoteDraft(actor, versionId, await parseBody(request, bodySchema));
    return NextResponse.json(serializeQuoteVersionResult(result), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
