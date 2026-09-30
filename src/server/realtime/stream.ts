import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import type { ByeReason, RealtimeConnection, RealtimeCounts, RealtimeHub, RealtimeServerEvent } from './hub';
import { encodeSseEvent, encodeSseRetry, formatEventCursor, parseEventCursor, SSE_RETRY_MS } from './sse';

/** Si el navegador deja de leer y se acumulan más eventos que esto, se cierra la conexión (spec §4.3, presión). */
const QUEUE_LIMIT = 64;

export type RealtimeStreamOptions = Readonly<{
  hub: Pick<RealtimeHub, 'register'>;
  session: Readonly<{ sessionId: string; actor: Actor }>;
  signal: AbortSignal;
  lastEventId: string | null;
  heartbeatMs: number;
  recheckMs: number;
  counts: () => Promise<RealtimeCounts>;
  /** El actor vigente de la sesión, o null si ya no es válida. Un error se trata como "vuelve a intentar". */
  revalidate: () => Promise<Actor | null>;
  resume: (cursor: Readonly<{ at: Date; id: string }>) => Promise<Readonly<{ items: InboxNotificationDto[]; more: boolean }>>;
  now?: () => Date;
}>;

/**
 * Una conexión SSE (spec §4.3): `retry`, `hello` con los contadores, reanudación con `Last-Event-ID`, `ping` para
 * que el navegador sepa que sigue viva, revalidación periódica de la sesión y limpieza al cerrar. Se registra en el
 * hub antes del `hello` para no perder lo que ocurra mientras tanto.
 */
export function createRealtimeStream(options: RealtimeStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const now = options.now ?? (() => new Date());
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let cleanup: () => void = () => undefined;

  const finish = () => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controllerRef?.close();
    } catch {
      // El navegador ya cerró el flujo.
    }
  };

  const write = (chunk: string) => {
    if (closed || !controllerRef) return;
    if (controllerRef.desiredSize !== null && controllerRef.desiredSize <= 0) {
      finish();
      return;
    }
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      finish();
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const connection: RealtimeConnection = {
        userId: options.session.actor.userId,
        sessionId: options.session.sessionId,
        openedAt: Date.now(),
        actor: options.session.actor,
        send: (event: RealtimeServerEvent) => write(encodeSseEvent(event.event, event.data, event.event === 'notification' ? event.id : undefined)),
        close: (reason: ByeReason) => {
          write(encodeSseEvent('bye', { reason }));
          finish();
        },
      };
      write(encodeSseRetry(SSE_RETRY_MS));
      const unregister = options.hub.register(connection);
      const heartbeat = setInterval(() => write(encodeSseEvent('ping', { at: now().toISOString() })), options.heartbeatMs);
      const recheck = setInterval(() => {
        options.revalidate().then((actor) => {
          if (actor) connection.actor = actor;
          else connection.close('session');
        }, () => undefined);
      }, options.recheckMs);
      const onAbort = () => finish();
      options.signal.addEventListener('abort', onAbort, { once: true });
      cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(recheck);
        unregister();
        options.signal.removeEventListener('abort', onAbort);
      };
      if (options.signal.aborted) {
        finish();
        return;
      }
      let counts: RealtimeCounts;
      try {
        counts = await options.counts();
      } catch {
        // Sin contadores no hay `hello`: se cierra y el navegador reintenta en `retry`.
        finish();
        return;
      }
      write(encodeSseEvent('hello', { ...counts, serverTime: now().toISOString() }));
      const cursor = parseEventCursor(options.lastEventId);
      if (!cursor || closed) return;
      try {
        const page = await options.resume(cursor);
        for (const notification of page.items) {
          connection.send({ event: 'notification', id: formatEventCursor(new Date(notification.updatedAt), notification.id), data: { mode: 'updated', notification, ...counts, requestUnread: null } });
        }
        if (page.more) connection.send({ event: 'resync', data: {} });
      } catch {
        connection.send({ event: 'resync', data: {} });
      }
    },
    cancel() {
      finish();
    },
  }, new CountQueuingStrategy({ highWaterMark: QUEUE_LIMIT }));
}
