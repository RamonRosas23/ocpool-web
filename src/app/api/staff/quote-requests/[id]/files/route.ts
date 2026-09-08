import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { fileListQuerySchema, fileReserveSchema } from '@/server/modules/private-files/http';
import { listPrivateFiles, reservePrivateFile } from '@/server/modules/private-files/service';

type RouteContext = { params: Promise<{ id: string }> };

function parseQuery(request: NextRequest) {
  const parsed = fileListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
  return parsed.data;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json({ items: await listPrivateFiles(actor, quoteRequestId, parseQuery(request)) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireStaffActor(request);
    const body = await parseBody(request, fileReserveSchema);
    const { id: quoteRequestId } = await context.params;
    return NextResponse.json(await reservePrivateFile(actor, { ...body, quoteRequestId }), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
