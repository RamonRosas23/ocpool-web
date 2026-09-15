import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { QUOTE_REQUEST_BUDGET_RANGES, QUOTE_REQUEST_PROJECT_STAGES, QUOTE_REQUEST_TIMELINES } from '@/server/modules/quote-requests/domain';
import { getStaffQuoteRequest, updateStaffQuoteRequest } from '@/server/modules/quote-requests/staff-service';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  contact: z.object({
    displayName: z.string().trim().min(2).max(180).optional(),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    roleTitle: z.string().trim().max(120).nullable().optional(),
  }).strict().optional(),
  detail: z.object({
    projectType: z.string().trim().min(2).max(120).optional(),
    location: z.string().trim().min(2).max(180).optional(),
    projectStage: z.enum(QUOTE_REQUEST_PROJECT_STAGES).nullable().optional(),
    dimensions: z.string().trim().max(500).nullable().optional(),
    timeline: z.enum(QUOTE_REQUEST_TIMELINES).nullable().optional(),
    budgetRange: z.enum(QUOTE_REQUEST_BUDGET_RANGES).nullable().optional(),
    description: z.string().trim().min(10).max(10_000).optional(),
  }).strict().optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: quoteRequestId } = await context.params;
    const result = await getStaffQuoteRequest(actor, quoteRequestId);
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, updateSchema);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await updateStaffQuoteRequest(actor, quoteRequestId, body), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
