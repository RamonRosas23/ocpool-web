import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestContext, requestId } from '@/server/auth/http';
import { requireStaffActor } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { TEAM_ROLES } from '@/server/modules/team/domain';
import { inviteTeamMember, listTeamMembers } from '@/server/modules/team/service';

const inviteSchema = z.object({
  displayName: z.string().max(180),
  email: z.string().max(320),
  role: z.enum(TEAM_ROLES),
}).strict();

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    const params = request.nextUrl.searchParams;
    const result = await listTeamMembers(actor, { view: params.get('view') ?? undefined, query: params.get('query')?.slice(0, 120) ?? undefined });
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
    const body = await parseBody(request, inviteSchema);
    return NextResponse.json(await inviteTeamMember(actor, body, requestContext(request)), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
