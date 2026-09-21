import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { convertQuoteAcceptanceToProject } from '@/server/modules/projects/service';

const bodySchema = z.object({
  quoteAcceptanceId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  checklistLabels: z.array(z.string().trim().min(1).max(240)).max(30).optional(),
}).strict();

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
