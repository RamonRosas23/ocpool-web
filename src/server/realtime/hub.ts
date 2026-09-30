import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import type { RealtimeSignal } from './publish';
import { formatEventCursor } from './sse';

export type ByeReason = 'session' | 'replaced';
export type RealtimeCounts = Readonly<{ unread: number; actionRequired: number }>;
export type RealtimeNotificationPayload = Readonly<{
  mode: 'created' | 'updated' | 'resolved';
  notification: InboxNotificationDto;
  unread: number;
  actionRequired: number;
  /** Sin leer del expediente del aviso, para "N nuevas" y la lectura al abrir (null si no tiene expediente). */
  requestUnread: number | null;
}>;

export type RealtimeServerEvent =
  | Readonly<{ event: 'notification'; id: string; data: RealtimeNotificationPayload }>
  | Readonly<{ event: 'counts'; data: RealtimeCounts }>
  | Readonly<{ event: 'resync'; data: Readonly<Record<string, never>> }>;

export type RealtimeConnection = {
  readonly userId: string;
  readonly sessionId: string;
  readonly openedAt: number;
  /** Se refresca al revalidar la sesión: un cambio de rol cambia el alcance. */
  actor: Actor;
  send(event: RealtimeServerEvent): void;
  close(reason: ByeReason): void;
};

export type RealtimeHubDependencies = Readonly<{
  loadNotification: (actor: Actor, id: string) => Promise<InboxNotificationDto | null>;
  loadCounts: (actor: Actor) => Promise<RealtimeCounts>;
  loadRequestUnread: (actor: Actor, quoteRequestId: string) => Promise<number>;
  maxConnectionsPerUser: () => number;
}>;

/**
 * Registro de conexiones por persona y reparto de señales (spec §4.2). No guarda contenido: relee cada aviso
 * una vez por persona. Las señales de una misma persona se atienden en orden (un contador viejo nunca pisa a uno
 * nuevo); cerrar sesiones no espera a nadie.
 */
export class RealtimeHub {
  private readonly byUser = new Map<string, Set<RealtimeConnection>>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly deps: RealtimeHubDependencies) {}

  get size(): number {
    let total = 0;
    for (const connections of this.byUser.values()) total += connections.size;
    return total;
  }

  register(connection: RealtimeConnection): () => void {
    const connections = this.byUser.get(connection.userId) ?? new Set<RealtimeConnection>();
    connections.add(connection);
    this.byUser.set(connection.userId, connections);
    const limit = this.deps.maxConnectionsPerUser();
    while (connections.size > limit) {
      const oldest = [...connections].reduce((current, candidate) => (candidate.openedAt < current.openedAt ? candidate : current));
      this.unregister(oldest);
      oldest.close('replaced');
    }
    return () => this.unregister(connection);
  }

  async dispatch(signal: RealtimeSignal): Promise<void> {
    if (signal.t === 'r') return;
    if (!this.byUser.has(signal.u)) return;
    if (signal.t === 's') {
      this.closeSessions(signal);
      return;
    }
    const previous = this.queues.get(signal.u) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.deliver(signal));
    this.queues.set(signal.u, current);
    try {
      await current;
    } finally {
      if (this.queues.get(signal.u) === current) this.queues.delete(signal.u);
    }
  }

  /** Tras reconectar el LISTEN pudieron perderse señales: cada navegador relee contadores y vistas. */
  broadcastResync(): void {
    for (const connections of this.byUser.values()) for (const connection of connections) connection.send({ event: 'resync', data: {} });
  }

  private closeSessions(signal: Extract<RealtimeSignal, { t: 's' }>): void {
    for (const connection of [...(this.byUser.get(signal.u) ?? [])]) {
      const closes = signal.sid ? connection.sessionId === signal.sid : connection.sessionId !== signal.keep;
      if (!closes) continue;
      this.unregister(connection);
      connection.close('session');
    }
  }

  private async deliver(signal: Extract<RealtimeSignal, { t: 'n' | 'u' }>): Promise<void> {
    const targets = [...(this.byUser.get(signal.u) ?? [])];
    if (targets.length === 0) return;
    // Todas las conexiones de la misma persona comparten alcance: se consulta una sola vez.
    const actor = targets[0].actor;
    if (signal.t === 'u') {
      const counts = await this.deps.loadCounts(actor);
      for (const connection of targets) connection.send({ event: 'counts', data: counts });
      return;
    }
    const notification = await this.deps.loadNotification(actor, signal.id);
    if (!notification) return;
    const [counts, requestUnread] = await Promise.all([
      this.deps.loadCounts(actor),
      notification.quoteRequestId ? this.deps.loadRequestUnread(actor, notification.quoteRequestId) : Promise.resolve(null),
    ]);
    const event: RealtimeServerEvent = {
      event: 'notification',
      id: formatEventCursor(new Date(notification.updatedAt), notification.id),
      data: { mode: signal.m, notification, ...counts, requestUnread },
    };
    // Una conexión que se cerró mientras tanto ignora el envío.
    for (const connection of targets) connection.send(event);
  }

  private unregister(connection: RealtimeConnection): void {
    const connections = this.byUser.get(connection.userId);
    if (!connections) return;
    connections.delete(connection);
    if (connections.size === 0) this.byUser.delete(connection.userId);
  }
}
