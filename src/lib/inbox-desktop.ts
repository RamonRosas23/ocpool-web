import type { InboxNotification } from '@/lib/inbox-client';

export type DesktopPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/** Alertas de escritorio sólo con puntero fino: en teléfonos la API exige un service worker y no aplica. */
export function desktopPermission(): DesktopPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return 'unsupported';
  return window.Notification.permission;
}

/** Se pide en el gesto de la persona (spec §10), nunca por iniciativa propia. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() === 'unsupported') return 'unsupported';
  try {
    return await window.Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}

/** Texto plano (spec §11). El `tag` es el id: un aviso agrupado reemplaza al anterior. */
export function showDesktopNotification(notice: InboxNotification, options: Readonly<{ silent: boolean; onOpen: (path: string) => void }>): void {
  if (desktopPermission() !== 'granted') return;
  try {
    const notification = new window.Notification(notice.title, { body: notice.body ?? undefined, tag: notice.id, silent: options.silent });
    notification.onclick = () => {
      window.focus();
      options.onOpen(notice.actionPath);
      notification.close();
    };
  } catch {
    // Algunos navegadores sólo permiten notificaciones desde un service worker.
  }
}
