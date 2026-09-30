import type { InboxNotification } from '@/lib/inbox-client';

export const FLASH_HIGH_MS = 8_000;
/** Una ráfaga (p. ej. al reanudar tras una desconexión) no acumula tarjetas sin fin. */
export const FLASH_QUEUE_LIMIT = 20;
const FLASH_MAX_DESKTOP = 3;
const FLASH_MAX_MOBILE = 2;

export type FlashItem = Readonly<{
  notification: InboxNotification;
  /** Sube con cada llegada del mismo aviso: la tarjeta vuelve a destellar y su tiempo se reinicia. */
  revision: number;
  /** Milisegundos que le quedan (HIGH); null = fijo hasta cerrarlo (URGENT). */
  remainingMs: number | null;
  paused: boolean;
}>;

export type FlashAction =
  | Readonly<{ type: 'show'; notification: InboxNotification }>
  | Readonly<{ type: 'dismiss'; ids: readonly string[] }>
  | Readonly<{ type: 'pause'; id: string; paused: boolean; remainingMs?: number }>
  | Readonly<{ type: 'clear' }>;

/** Al pasar del tope se van primero los avisos altos más viejos; lo urgente espera a que alguien lo cierre. */
function trimQueue(items: FlashItem[]): FlashItem[] {
  if (items.length <= FLASH_QUEUE_LIMIT) return items;
  const kept = [...items];
  for (let index = kept.length - 1; index >= 0 && kept.length > FLASH_QUEUE_LIMIT; index -= 1) {
    if (kept[index].notification.priority !== 'URGENT') kept.splice(index, 1);
  }
  return kept.slice(0, FLASH_QUEUE_LIMIT);
}

export function flashReducer(state: FlashItem[], action: FlashAction): FlashItem[] {
  switch (action.type) {
    case 'show': {
      const previous = state.find((item) => item.notification.id === action.notification.id);
      const next: FlashItem = { notification: action.notification, revision: (previous?.revision ?? 0) + 1, remainingMs: action.notification.priority === 'URGENT' ? null : FLASH_HIGH_MS, paused: false };
      // Lo más reciente arriba; un aviso agrupado reemplaza su tarjeta, nunca la duplica.
      return trimQueue([next, ...state.filter((item) => item.notification.id !== action.notification.id)]);
    }
    case 'dismiss': {
      if (!state.some((item) => action.ids.includes(item.notification.id))) return state;
      return state.filter((item) => !action.ids.includes(item.notification.id));
    }
    case 'pause':
      return state.map((item) => (item.notification.id === action.id ? { ...item, paused: action.paused, remainingMs: action.remainingMs ?? item.remainingMs } : item));
    case 'clear':
      return state.length === 0 ? state : [];
  }
}

/**
 * Spec §5.3: 3 en escritorio y 2 en móvil; el resto se cuenta como "y N más". Lo urgente va primero: una ráfaga de
 * avisos altos nunca lo esconde.
 */
export function visibleFlashes(state: readonly FlashItem[], mobile: boolean): Readonly<{ shown: FlashItem[]; overflow: number }> {
  const limit = mobile ? FLASH_MAX_MOBILE : FLASH_MAX_DESKTOP;
  const ordered = [...state.filter((item) => item.notification.priority === 'URGENT'), ...state.filter((item) => item.notification.priority !== 'URGENT')];
  return { shown: ordered.slice(0, limit), overflow: Math.max(0, ordered.length - limit) };
}
