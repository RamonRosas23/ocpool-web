import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { createQuoteVersion, serializeQuoteVersionResult } from '@/server/modules/quotes/service';
import { getQuoteWorkspace } from '@/server/modules/quotes/staff-service';

const rateSchema = z.union([z.string().regex(/^\d+$/u), z.number().int().min(0).max(10_000)]);
const catalogLineSchema = z.object({
  catalogItemId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(?:\.\d{1,3})?$/u),
  unitPriceMinorOverride: z.string().regex(/^\d+$/u).optional(),
  discountBasisPoints: rateSchema.optional(),
  taxBasisPoints: rateSchema.optional(),
}).strict();
const specialLineSchema = z.object({
  special: z.literal(true),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  unit: z.string().trim().min(1).max(40),
  quantity: z.string().regex(/^\d+(?:\.\d{1,3})?$/u),
  unitPriceMinor: z.string().regex(/^\d+$/u),
  reason: z.string().trim().min(1).max(300),
  discountBasisPoints: rateSchema.optional(),
  taxBasisPoints: rateSchema.optional(),
}).strict();
const lineSchema = z.union([catalogLineSchema, specialLineSchema]);
const bodySchema = z.object({
  priceListId: z.string().uuid(),
  lines: z.array(lineSchema).min(1).max(100),
  validUntil: z.coerce.date().nullable().optional(),
  expectedCurrentVersionNumber: z.number().int().min(1).nullable().optional(),
  taxProfileId: z.string().uuid().optional(),
}).strict();

type RouteContext = { params: Promise<{ quoteRequestId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { quoteRequestId } = await context.params;
    return NextResponse.json(await getQuoteWorkspace(actor, quoteRequestId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { quoteRequestId } = await context.params;
    const result = await createQuoteVersion(actor, { ...(await parseBody(request, bodySchema)), quoteRequestId });
    return NextResponse.json(serializeQuoteVersionResult(result), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
