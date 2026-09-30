import { logger } from '@/server/logging/logger';
import { decodeRealtimeSignal, REALTIME_CHANNEL, type RealtimeSignal } from './publish';

export type ListenerNotification = Readonly<{ channel: string; payload?: string }>;

/** Lo que el listener usa de `pg.Client`: una conexión propia, fuera del pool de Prisma. */
export type ListenerClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: 'notification', listener: (message: ListenerNotification) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  removeAllListeners(): unknown;
};

export type RealtimeListenerOptions = Readonly<{
  createClient: () => ListenerClient;
  onSignal: (signal: RealtimeSignal) => void;
  onReconnected: () => void;
}>;

const MAX_BACKOFF_MS = 30_000;

/**
 * Una conexión dedicada con `LISTEN` (spec §4.2). Si se cae o no se puede abrir, reintenta con espera exponencial
 * (1 s, 2 s, 4 s… hasta 30 s) y, al volver, avisa para que los navegadores se resincronicen: pudieron perderse
 * señales. `start()` nunca falla; si la base no responde, sigue intentando en segundo plano.
 */
export class RealtimeListener {
  private client: ListenerClient | null = null;
  private attempts = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lost = new WeakSet<ListenerClient>();

  constructor(private readonly options: RealtimeListenerOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    if (client) await this.discard(client);
  }

  private async connect(): Promise<void> {
    const client = this.options.createClient();
    client.on('notification', (message) => {
      const signal = message.payload ? decodeRealtimeSignal(message.payload) : null;
      if (signal) this.options.onSignal(signal);
    });
    client.on('error', () => this.handleLoss(client));
    client.on('end', () => this.handleLoss(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch {
      this.handleLoss(client);
      return;
    }
    if (this.stopped || this.lost.has(client)) {
      await this.discard(client);
      return;
    }
    this.client = client;
    const recovering = this.attempts > 0;
    this.attempts = 0;
    logger.info({ recovering }, 'Realtime listener connected');
    if (recovering) this.options.onReconnected();
  }

  private handleLoss(client: ListenerClient): void {
    if (this.lost.has(client)) return;
    void this.discard(client);
    if (this.client === client) this.client = null;
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** this.attempts);
    this.attempts += 1;
    logger.warn({ delayMs: delay }, 'Realtime listener lost; reconnecting');
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) void this.connect();
    }, delay);
  }

  private async discard(client: ListenerClient): Promise<void> {
    this.lost.add(client);
    client.removeAllListeners();
    // Un cliente de pg sin escucha de 'error' tumba el proceso si algo falla al cerrarlo.
    client.on('error', () => undefined);
    await client.end().catch(() => undefined);
  }
}
