import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { INBOX_FILTERS, listInbox } from '@/server/modules/inbox/service';

const querySchema = z.object({
  filter: z.enum(INBOX_FILTERS).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireSessionActor(request);
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
    return NextResponse.json(await listInbox(actor, parsed.data), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
