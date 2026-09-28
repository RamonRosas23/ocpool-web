import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestContext, requestId } from '@/server/auth/http';
import { requireStaffSession } from '@/server/auth/staff';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { confirmAccountMfaEnrollment, startAccountMfaEnrollment } from '@/server/modules/account/service';

const confirmSchema = z.object({ enrollmentToken: z.string().min(20).max(2048), code: z.string().regex(/^\d{6}$/u) }).strict();
const startSchema = z.object({}).strict();

/** Paso 1: clave nueva (QR) y comprobante sellado. `?step=start` evita confundirlo con la confirmación. */
export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const { actor, sessionId } = await requireStaffSession(request);
    if (request.nextUrl.searchParams.get('step') === 'start') {
      await parseBody(request, startSchema);
      return NextResponse.json(await startAccountMfaEnrollment(actor), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    const body = await parseBody(request, confirmSchema);
    return NextResponse.json(await confirmAccountMfaEnrollment(actor, sessionId, body, requestContext(request)), { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
