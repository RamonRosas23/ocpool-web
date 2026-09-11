import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { listQuoteApprovals, requestQuoteApproval } from '@/server/modules/quotes/approval-service';

const bodySchema = z.object({
  type: z.enum(['DISCOUNT', 'PRICE_OVERRIDE']),
  policyVersion: z.string().trim().min(2).max(64),
  thresholdBps: z.number().int().min(0).max(10_000).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).strict();

type RouteContext = { params: Promise<{ versionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    return NextResponse.json(await listQuoteApprovals(actor, versionId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const { versionId } = await context.params;
    const result = await requestQuoteApproval(actor, versionId, await parseBody(request, bodySchema));
    return NextResponse.json(result, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
