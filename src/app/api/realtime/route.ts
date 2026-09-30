import { NextRequest, NextResponse } from 'next/server';
import { requestId, sessionToken } from '@/server/auth/http';
import { getSessionContext } from '@/server/auth/sessions';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { getInboxCounts, listInboxUpdatedSince, requireInboxAccess } from '@/server/modules/inbox/service';
import { ensureRealtimeHub } from '@/server/realtime/runtime';
import { SSE_HEADERS } from '@/server/realtime/sse';
import { createRealtimeStream } from '@/server/realtime/stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Canal en vivo de la persona autenticada (spec §4.3): avisos, contadores y cierre de sesión al momento. */
export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const env = readServerEnv();
    // Interruptor sin despliegue (spec §12): todos quedan en consulta cada 30 s.
    if (!env.REALTIME_ENABLED) return NextResponse.json({ mode: 'polling' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    const token = sessionToken(request);
    const session = token ? await getSessionContext(token) : null;
    if (!token || !session) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
    requireInboxAccess(session.actor);
    const hub = await ensureRealtimeHub();
    const stream = createRealtimeStream({
      hub,
      session,
      signal: request.signal,
      lastEventId: request.headers.get('last-event-id'),
      heartbeatMs: env.REALTIME_HEARTBEAT_SECONDS * 1000,
      recheckMs: env.REALTIME_SESSION_RECHECK_SECONDS * 1000,
      counts: () => getInboxCounts(session.actor),
      revalidate: async () => (await getSessionContext(token))?.actor ?? null,
      resume: (cursor) => listInboxUpdatedSince(session.actor, cursor),
    });
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
