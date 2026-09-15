import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { requireStaffActor } from '@/server/auth/staff';
import { parseBody, requestId } from '@/server/auth/http';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { QUOTE_REQUEST_BUDGET_RANGES, QUOTE_REQUEST_PROJECT_STAGES, QUOTE_REQUEST_STATUSES, QUOTE_REQUEST_TIMELINES } from '@/server/modules/quote-requests/domain';
import { createStaffQuoteRequest, listStaffQuoteRequests } from '@/server/modules/quote-requests/staff-service';
import {
  normalizeRequestWorkspaceQuery,
  requestWorkspaceQueryToListFilters,
} from '@/lib/request-workspace-query';

const querySchema = z.object({
  status: z.enum(QUOTE_REQUEST_STATUSES).optional(),
  assignedToId: z.string().uuid().optional(),
  query: z.string().trim().max(100).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

const staffCreateSchema = z.object({
  displayName: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(40).nullable().optional(),
  roleTitle: z.string().trim().max(120).nullable().optional(),
  projectType: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(180),
  projectStage: z.enum(QUOTE_REQUEST_PROJECT_STAGES).nullable().optional(),
  dimensions: z.string().trim().min(2).max(500).nullable().optional(),
  timeline: z.enum(QUOTE_REQUEST_TIMELINES).nullable().optional(),
  budgetRange: z.enum(QUOTE_REQUEST_BUDGET_RANGES).nullable().optional(),
  description: z.string().trim().min(10).max(10_000),
  contactMatchId: z.string().uuid().nullable().optional(),
  confirmNewContact: z.boolean().optional().default(false),
  consent: z.literal(true),
}).strict();

function idempotencyKey(request: NextRequest): string {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value || value.length < 16 || value.length > 200) throw new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400);
  return value;
}

function parseQuery(request: NextRequest, actorUserId: string) {
  const hasWorkspaceState = ['view', 'stage', 'assignee', 'age', 'sort', 'tab'].some((key) => request.nextUrl.searchParams.has(key));
  if (hasWorkspaceState) {
    return requestWorkspaceQueryToListFilters(normalizeRequestWorkspaceQuery(request.nextUrl.searchParams), actorUserId, new Date());
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const result = await listStaffQuoteRequests(actor, parseQuery(request, actor.userId));
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, staffCreateSchema);
    const result = await createStaffQuoteRequest(actor, {
      idempotencyKey: idempotencyKey(request),
      contact: { displayName: body.displayName, email: body.email, phone: body.phone, roleTitle: body.roleTitle },
      detail: { projectType: body.projectType, location: body.location, projectStage: body.projectStage, dimensions: body.dimensions, timeline: body.timeline, budgetRange: body.budgetRange, description: body.description },
      contactMatchId: body.contactMatchId,
      confirmNewContact: body.confirmNewContact,
    });
    return NextResponse.json({ accepted: true, ...result }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
