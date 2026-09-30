/** Encabezados del canal (spec §4.3). `no-transform` evita que la compresión de `next start` retenga eventos. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

export const SSE_RETRY_MS = 5_000;

const EVENT_NAME = /^[a-z]+$/u;
const CURSOR_PATTERN = /^(\d{1,15})-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export function encodeSseEvent(event: string, data: unknown, id?: string): string {
  if (!EVENT_NAME.test(event)) throw new Error('Invalid SSE event name.');
  if (id !== undefined && /[\r\n]/u.test(id)) throw new Error('Invalid SSE event id.');
  // JSON.stringify escapa los saltos de línea: el dato siempre cabe en una sola línea `data:`.
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function encodeSseRetry(milliseconds: number): string {
  return `retry: ${Math.max(0, Math.trunc(milliseconds))}\n\n`;
}

/** Cursor de reanudación (`id:` y `Last-Event-ID`): milisegundos de `updatedAt` y el id del aviso. */
export function formatEventCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.getTime()}-${id}`;
}

export function parseEventCursor(value: string | null | undefined): Readonly<{ at: Date; id: string }> | null {
  const match = CURSOR_PATTERN.exec(value?.trim() ?? '');
  if (!match) return null;
  const at = new Date(Number(match[1]));
  return Number.isNaN(at.getTime()) ? null : { at, id: match[2].toLowerCase() };
}
