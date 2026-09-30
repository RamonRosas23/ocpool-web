import pg from 'pg';
import { readServerEnv } from '@/server/env';
import { logger } from '@/server/logging/logger';
import { getInboxCounts, getInboxNotificationForActor, getRequestUnreadCount } from '@/server/modules/inbox/service';
import { RealtimeHub } from './hub';
import { RealtimeListener } from './listener';

type RealtimeRuntime = { hub: RealtimeHub; listener: RealtimeListener; ready: Promise<void> | null };

// En `globalThis` para sobrevivir a HMR en desarrollo: una sola conexión LISTEN por proceso (spec §4.2).
const globalForRealtime = globalThis as typeof globalThis & { __ocpoolRealtime?: RealtimeRuntime };

function createRuntime(): RealtimeRuntime {
  const hub = new RealtimeHub({
    loadNotification: (actor, id) => getInboxNotificationForActor(actor, id),
    loadCounts: (actor) => getInboxCounts(actor),
    loadRequestUnread: (actor, quoteRequestId) => getRequestUnreadCount(actor, quoteRequestId),
    maxConnectionsPerUser: () => readServerEnv().REALTIME_MAX_CONNECTIONS_PER_USER,
  });
  const listener = new RealtimeListener({
    createClient: () => new pg.Client({ connectionString: readServerEnv().DATABASE_URL }),
    onSignal: (signal) => {
      // Los logs del canal no llevan identificadores de personas (spec §11).
      hub.dispatch(signal).catch((error: unknown) => logger.error({ signal: signal.t, error: error instanceof Error ? error.message : String(error) }, 'Realtime dispatch failed'));
    },
    onReconnected: () => hub.broadcastResync(),
  });
  return { hub, listener, ready: null };
}

function runtime(): RealtimeRuntime {
  globalForRealtime.__ocpoolRealtime ??= createRuntime();
  return globalForRealtime.__ocpoolRealtime;
}

/** Arranca el LISTEN con la primera conexión SSE y devuelve el hub. */
export async function ensureRealtimeHub(): Promise<RealtimeHub> {
  const state = runtime();
  state.ready ??= state.listener.start();
  await state.ready;
  return state.hub;
}

/** Sólo para pruebas: cierra el LISTEN y olvida el singleton. */
export async function shutdownRealtimeForTests(): Promise<void> {
  const state = globalForRealtime.__ocpoolRealtime;
  if (!state) return;
  delete globalForRealtime.__ocpoolRealtime;
  await state.listener.stop();
}
