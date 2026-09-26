import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { convertQuoteAcceptanceToProject, listProjects } from '@/server/modules/projects/service';
import { PROJECT_HANDOFF_STATUSES } from '@/server/modules/projects/domain';

const bodySchema = z.object({
  quoteAcceptanceId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  checklistLabels: z.array(z.string().trim().min(1).max(240)).max(30).optional(),
}).strict();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(PROJECT_HANDOFF_STATUSES).optional(),
  query: z.string().trim().max(100).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
    return NextResponse.json(await listProjects(actor, parsed.data), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, bodySchema);
    const project = await convertQuoteAcceptanceToProject(actor, body.quoteAcceptanceId, { ownerId: body.ownerId, checklistLabels: body.checklistLabels });
    return NextResponse.json(project, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
