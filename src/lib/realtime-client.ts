import type { InboxNotification, InboxSummary } from '@/lib/inbox-client';

export type RealtimeNotificationEvent = Readonly<{
  type: 'notification';
  mode: 'created' | 'updated' | 'resolved';
  notification: InboxNotification;
  unread: number;
  actionRequired: number;
  /** Sin leer del expediente del aviso; null si no tiene expediente o no se sabe. */
  requestUnread: number | null;
}>;

export type RealtimeEvent =
  | Readonly<{ type: 'hello'; unread: number; actionRequired: number }>
  | RealtimeNotificationEvent
  | Readonly<{ type: 'counts'; unread: number; actionRequired: number }>
  | Readonly<{ type: 'resync' }>
  | Readonly<{ type: 'bye'; reason: string }>;

export type RealtimeMode = 'connecting' | 'live' | 'polling' | 'closed';

/** La misma lista que `REQUEST_PARTS` del servidor (una prueba lo comprueba). */
export const REQUEST_PARTS = ['created', 'messages', 'files', 'status', 'assignment', 'quote', 'approvals', 'read', 'project'] as const;
export type RequestPart = (typeof REQUEST_PARTS)[number];

export const REALTIME_URL = '/api/realtime';
export const REALTIME_EVENT_TYPES = ['hello', 'notification', 'counts', 'resync', 'bye', 'ping'] as const;
export const LATEST_LIMIT = 20;
export const REALTIME_MAX_ERRORS = 3;
export const REALTIME_SILENCE_MS = 60_000;
export const REALTIME_RETRY_MS = 5 * 60_000;

const PRIORITIES: ReadonlySet<string> = new Set(['URGENT', 'HIGH', 'NORMAL', 'INFO']);
const MODES: ReadonlySet<string> = new Set(['created', 'updated', 'resolved']);
const ACTIVITY_KINDS: ReadonlySet<string> = new Set(['customer.activity', 'team.activity']);
const EVENT_SOURCE_CLOSED = 2;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isNotification(value: unknown): value is InboxNotification {
  const item = asRecord(value);
  return Boolean(item
    && typeof item.id === 'string'
    && typeof item.kind === 'string'
    && typeof item.title === 'string'
    // Sólo rutas internas: el aviso se abre con el router de la aplicación.
    && typeof item.actionPath === 'string' && item.actionPath.startsWith('/') && !item.actionPath.startsWith('//')
    && typeof item.priority === 'string' && PRIORITIES.has(item.priority)
    && typeof item.lastActivityAt === 'string');
}

/** Un evento SSE ya validado; lo desconocido o mal formado se descarta (el `ping` sólo mantiene viva la conexión). */
export function parseRealtimeEvent(type: string, raw: string): RealtimeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = asRecord(parsed);
  if (!data) return null;
  const unread = asCount(data.unread);
  const actionRequired = asCount(data.actionRequired);
  switch (type) {
    case 'hello':
    case 'counts':
      return unread !== null && actionRequired !== null ? { type, unread, actionRequired } : null;
    case 'notification':
      if (unread === null || actionRequired === null || !isNotification(data.notification) || typeof data.mode !== 'string' || !MODES.has(data.mode)) return null;
      return { type: 'notification', mode: data.mode as RealtimeNotificationEvent['mode'], notification: data.notification, unread, actionRequired, requestUnread: asCount(data.requestUnread) };
    case 'resync':
      return { type: 'resync' };
    case 'bye':
      return { type: 'bye', reason: typeof data.reason === 'string' ? data.reason : 'closed' };
    default:
      return null;
  }
}

function byActivityDesc(a: InboxNotification, b: InboxNotification): number {
  return b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id);
}

/** Un aviso nuevo, agrupado o resuelto entra al resumen sin duplicarse, con los contadores del servidor. */
export function applyNotificationEvent(summary: InboxSummary, event: RealtimeNotificationEvent): InboxSummary {
  const latest = [event.notification, ...summary.latest.filter((item) => item.id !== event.notification.id)].sort(byActivityDesc).slice(0, LATEST_LIMIT);
  const unreadByRequest = { ...summary.unreadByRequest };
  const requestId = event.notification.quoteRequestId;
  if (requestId && event.requestUnread !== null) {
    if (event.requestUnread > 0) unreadByRequest[requestId] = event.requestUnread;
    else delete unreadByRequest[requestId];
  }
  return { unread: event.unread, actionRequired: event.actionRequired, latest, unreadByRequest };
}

/** Spec §5.3: sólo URGENT y HIGH destellan; la actividad del expediente que ya está abierto no, salvo lo urgente. */
export function shouldFlash(event: RealtimeNotificationEvent, activeRequestId: string | null): boolean {
  const notice = event.notification;
  if (event.mode === 'resolved' || notice.readAt || notice.resolvedAt) return false;
  if (notice.priority !== 'URGENT' && notice.priority !== 'HIGH') return false;
  if (notice.priority === 'HIGH' && notice.quoteRequestId !== null && notice.quoteRequestId === activeRequestId && ACTIVITY_KINDS.has(notice.kind)) return false;
  return true;
}

export type LockManagerLike = Readonly<{
  request(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
  query?(): Promise<{ held?: ReadonlyArray<{ name?: string }> }>;
}>;

const LEADER_LOCK = 'ocpool-realtime';
const VISIBLE_LOCK_PREFIX = 'ocpool-visible:';

/**
 * Una conexión por navegador (spec §4.4): la pestaña que obtiene el candado abre la conexión y lo suelta al
 * cerrarse o al llamar a la función que devuelve; entonces otra pestaña lo toma.
 */
export function electLeader(locks: LockManagerLike, lead: () => () => void): () => void {
  const abort = new AbortController();
  let release: (() => void) | null = null;
  let stopLeading: (() => void) | null = null;
  locks.request(LEADER_LOCK, { mode: 'exclusive', signal: abort.signal }, () => {
    // El candado pudo concederse justo cuando la pestaña se iba: se suelta sin liderar.
    if (abort.signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      stopLeading = lead();
      release = resolve;
    });
  }).catch(() => undefined);
  return () => {
    abort.abort();
    stopLeading?.();
    stopLeading = null;
    release?.();
    release = null;
  };
}

/** Mientras la pestaña está a la vista sostiene un candado propio: así la líder sabe si alguien está mirando. */
export function holdVisibleLock(locks: LockManagerLike, tabId: string): () => void {
  const abort = new AbortController();
  let release: (() => void) | null = null;
  locks.request(`${VISIBLE_LOCK_PREFIX}${tabId}`, { mode: 'exclusive', signal: abort.signal }, () => {
    if (abort.signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => { release = resolve; });
  }).catch(() => undefined);
  return () => {
    abort.abort();
    release?.();
    release = null;
  };
}

export async function anyTabVisible(locks: LockManagerLike, selfVisible: boolean): Promise<boolean> {
  if (selfVisible) return true;
  if (!locks.query) return false;
  try {
    const state = await locks.query();
    return (state.held ?? []).some((lock) => lock.name?.startsWith(VISIBLE_LOCK_PREFIX) ?? false);
  } catch {
    return false;
  }
}

export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};

export type RealtimeTimers = Readonly<{ set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void }>;

const browserTimers: RealtimeTimers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/**
 * Conexión en vivo con respaldo (spec §4.4): tres errores seguidos, 60 s sin ningún evento (ni `ping`) o un rechazo
 * del servidor (503 con el interruptor apagado, 401) pasan a consulta cada 30 s, y cada 5 min se reintenta.
 * `bye` cierra sin reintentar.
 */
export class RealtimeController {
  private source: EventSourceLike | null = null;
  private errors = 0;
  private mode: RealtimeMode = 'closed';
  private silence: unknown = null;
  private retry: unknown = null;
  private stopped = true;

  constructor(private readonly options: Readonly<{
    url?: string;
    open: (url: string) => EventSourceLike;
    onEvent: (event: RealtimeEvent) => void;
    onMode: (mode: RealtimeMode) => void;
    timers?: RealtimeTimers;
  }>) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.setMode('closed');
  }

  private get timers(): RealtimeTimers {
    return this.options.timers ?? browserTimers;
  }

  private connect(): void {
    this.teardown();
    this.errors = 0;
    this.setMode('connecting');
    const source = this.options.open(this.options.url ?? REALTIME_URL);
    this.source = source;
    source.onopen = () => {
      if (this.source === source) this.errors = 0;
    };
    source.onerror = () => {
      if (this.source !== source) return;
      this.errors += 1;
      if (source.readyState === EVENT_SOURCE_CLOSED || this.errors >= REALTIME_MAX_ERRORS) this.fallBack();
    };
    for (const type of REALTIME_EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        if (this.source === source) this.receive(type, message.data);
      });
    }
    this.watchSilence();
  }

  private receive(type: string, raw: string): void {
    const event = parseRealtimeEvent(type, raw);
    if (event?.type === 'bye') {
      this.stopped = true;
      this.teardown();
      this.setMode('closed');
      this.options.onEvent(event);
      return;
    }
    this.errors = 0;
    this.watchSilence();
    if (this.mode !== 'live') this.setMode('live');
    if (event) this.options.onEvent(event);
  }

  private watchSilence(): void {
    if (this.silence !== null) this.timers.clear(this.silence);
    this.silence = this.timers.set(() => {
      this.silence = null;
      this.fallBack();
    }, REALTIME_SILENCE_MS);
  }

  private fallBack(): void {
    if (this.stopped) return;
    this.teardown();
    this.setMode('polling');
    this.retry = this.timers.set(() => {
      this.retry = null;
      if (!this.stopped) this.connect();
    }, REALTIME_RETRY_MS);
  }

  private teardown(): void {
    this.source?.close();
    this.source = null;
    if (this.silence !== null) {
      this.timers.clear(this.silence);
      this.silence = null;
    }
    if (this.retry !== null) {
      this.timers.clear(this.retry);
      this.retry = null;
    }
  }

  private setMode(mode: RealtimeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.options.onMode(mode);
  }
}
