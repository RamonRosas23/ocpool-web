'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { fetchInboxSummary, InboxRequestError, postInboxRead, titleWithBadge, type InboxNotification, type InboxSummary, type MarkReadInput } from '@/lib/inbox-client';
import { desktopPermission, requestDesktopPermission, showDesktopNotification, type DesktopPermission } from '@/lib/inbox-desktop';
import { flashReducer, type FlashItem } from '@/lib/inbox-flash';
import { defaultPreferences, readPreferences, writePreference, type InboxPreferences } from '@/lib/inbox-preferences';
import { createChime, type Chime } from '@/lib/inbox-sound';
import { signOutAnnounced } from '@/lib/session-exit';
import { applyNotificationEvent, shouldFlash, type RealtimeEvent, type RequestPart } from '@/lib/realtime-client';
import { createRequestSubscriptions, type RequestChange } from '@/lib/realtime-subscriptions';
import { useInboxRealtime, type RealtimeOrigin } from './useInboxRealtime';

export type InboxSurface = 'staff' | 'portal';

export type InboxContextValue = {
  surface: InboxSurface;
  /** `false` sin sesión (401/403): la campana no se muestra. */
  available: boolean;
  loaded: boolean;
  /** La pestaña está a la vista; se usa para no marcar conversaciones como leídas en segundo plano. */
  visible: boolean;
  unread: number;
  actionRequired: number;
  latest: InboxNotification[];
  unreadByRequest: Record<string, number>;
  refresh: () => Promise<void>;
  markRead: (input: MarkReadInput) => Promise<void>;
  /** En vivo por el canal SSE; si no, consulta de respaldo cada 30 s. */
  live: boolean;
  flashes: FlashItem[];
  dismissFlash: (id: string) => void;
  pauseFlash: (id: string, paused: boolean, remainingMs?: number) => void;
  /** Sube cada vez que algo pide abrir el panel (el "y N más" del flash). */
  panelRequest: number;
  requestPanel: () => void;
  /** Suscribe una vista a los cambios de un expediente (o de cualquiera, con '*'); devuelve cómo dejar de escuchar. */
  subscribeRequest: (requestId: string, parts: readonly RequestPart[], callback: (change: RequestChange) => void) => () => void;
  setActiveRequest: (quoteRequestId: string | null) => void;
  preferences: InboxPreferences;
  setSound: (on: boolean) => void;
  desktop: DesktopPermission;
  setDesktop: (on: boolean) => Promise<void>;
};

const InboxContext = createContext<InboxContextValue | null>(null);
// Respaldo cuando no hay canal en vivo: al navegar, al volver a la pestaña y cada 30 s.
const POLL_INTERVAL_MS = 30_000;
// Tras una lectura en otra pestaña o dispositivo llega sólo el contador; la lista se pone al día poco después.
const LIST_REFRESH_DELAY_MS = 600;
const PREFERENCE_KEY_PREFIX = 'ocpool.inbox.';
const EMPTY: InboxSummary = { unread: 0, actionRequired: 0, latest: [], unreadByRequest: {} };

function applyReadLocally(summary: InboxSummary, input: MarkReadInput, now: string): InboxSummary {
  const read = !('ids' in input) || input.read !== false;
  const matches = (item: InboxNotification) => {
    if ('ids' in input) return input.ids.includes(item.id);
    if ('all' in input) return true;
    return item.quoteRequestId === input.quoteRequestId && (input.scope === 'all' || !item.actionRequired);
  };
  const latest = summary.latest.map((item) => (matches(item) ? { ...item, readAt: read ? item.readAt ?? now : null } : item));
  const unreadByRequest = { ...summary.unreadByRequest };
  if ('all' in input) for (const key of Object.keys(unreadByRequest)) delete unreadByRequest[key];
  if ('quoteRequestId' in input && input.scope === 'all') delete unreadByRequest[input.quoteRequestId];
  return { ...summary, latest, unreadByRequest };
}

export function InboxProvider({ surface, children }: { surface: InboxSurface; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [summary, setSummary] = useState<InboxSummary>(EMPTY);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [live, setLive] = useState(false);
  const [flashes, dispatchFlash] = useReducer(flashReducer, []);
  const [panelRequest, setPanelRequest] = useState(0);
  // Sólo el panel abierto y los flashes los muestran, y nada de eso se pinta en el servidor.
  const [preferences, setPreferences] = useState<InboxPreferences>(() => (typeof window === 'undefined' ? defaultPreferences(surface) : readPreferences(surface)));
  const [desktop, setDesktopState] = useState<DesktopPermission>(() => desktopPermission());
  const inFlight = useRef<AbortController | null>(null);
  // Cada escritura (marcar leído) y cada evento en vivo cambian la generación: un resumen pedido antes llega con
  // datos viejos y no debe pisar lo que ya se sabe.
  const writeGeneration = useRef(0);
  const latestWrite = useRef(0);
  const preferencesRef = useRef(preferences);
  const chime = useRef<Chime | null>(null);
  const listRefreshTimer = useRef<number | null>(null);
  const [subscriptions] = useState(createRequestSubscriptions);
  const connectedOnce = useRef(false);
  const activeRequest = useRef<string | null>(null);
  const lastReturn = useRef(0);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    const syncVisibility = () => setVisible(document.visibilityState === 'visible');
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const generation = writeGeneration.current;
    try {
      const next = await fetchInboxSummary(controller.signal);
      if (controller.signal.aborted || generation !== writeGeneration.current) return;
      setSummary(next);
      setAvailable(true);
      setLoaded(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof InboxRequestError && (error.status === 401 || error.status === 403)) {
        setAvailable(false);
        setSummary(EMPTY);
      }
      // Cualquier otro error: se conserva lo último que se vio y la siguiente consulta lo reintenta.
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  const scheduleListRefresh = useCallback(() => {
    if (listRefreshTimer.current !== null) window.clearTimeout(listRefreshTimer.current);
    listRefreshTimer.current = window.setTimeout(() => {
      listRefreshTimer.current = null;
      void refresh();
    }, LIST_REFRESH_DELAY_MS);
  }, [refresh]);

  // En la página de acceso del portal todavía no hay sesión: no se pregunta por avisos (sería un 401 en cada visita).
  const signedOutPage = surface === 'portal' && (pathname === '/portal/access' || pathname.startsWith('/portal/access/'));

  useEffect(() => {
    if (signedOutPage) {
      inFlight.current?.abort();
      setAvailable(false);
      return;
    }
    void refresh();
  }, [refresh, pathname, signedOutPage]);

  useEffect(() => {
    if (!available || live) return undefined;
    const refreshCounts = () => { if (document.visibilityState === 'visible') void refresh(); };
    // Sin canal, las vistas abiertas se ponen al día al volver a la pestaña (spec §4.4); `focus` y
    // `visibilitychange` llegan juntos, así que se cuenta una sola vuelta.
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn.current < 1_000) return;
      lastReturn.current = Date.now();
      void refresh();
      subscriptions.refreshAll();
    };
    const timer = window.setInterval(refreshCounts, POLL_INTERVAL_MS);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [available, live, refresh, subscriptions]);

  useEffect(() => () => {
    inFlight.current?.abort();
    if (listRefreshTimer.current !== null) window.clearTimeout(listRefreshTimer.current);
  }, []);

  // El navegador sólo deja sonar audio después de un gesto: el primero lo habilita.
  useEffect(() => {
    const player = createChime();
    chime.current = player;
    const unlock = () => player.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Lo que se cambia en otra pestaña (sonido, escritorio) rige aquí también.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(PREFERENCE_KEY_PREFIX)) return;
      setPreferences(readPreferences(surface));
      setDesktopState(desktopPermission());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [surface]);

  const unread = available ? summary.unread : 0;

  // Next reescribe <title> en cada navegación: se vuelve a poner el "(N)" cada vez que cambia.
  useEffect(() => {
    const apply = () => {
      const next = titleWithBadge(document.title, unread);
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = titleWithBadge(document.title, 0);
    };
  }, [unread]);

  /** Un evento en vivo es más nuevo que cualquier resumen en camino: ése se descarta y se pide otro. */
  const applyLive = useCallback((update: (current: InboxSummary) => InboxSummary) => {
    const fetching = inFlight.current !== null;
    writeGeneration.current += 1;
    setSummary(update);
    if (fetching) scheduleListRefresh();
  }, [scheduleListRefresh]);

  const handleRealtime = useCallback((event: RealtimeEvent, origin: RealtimeOrigin) => {
    switch (event.type) {
      case 'hello':
        // Al reconectar pudieron perderse cambios: se relee la bandeja y, si no es la primera vez, cada vista abierta.
        void refresh();
        if (connectedOnce.current) subscriptions.refreshAll();
        connectedOnce.current = true;
        return;
      case 'resync':
        void refresh();
        subscriptions.refreshAll();
        return;
      case 'request':
        subscriptions.dispatch(event.requestId, event.parts, event.self);
        return;
      case 'counts':
        applyLive((current) => ({ ...current, unread: event.unread, actionRequired: event.actionRequired }));
        scheduleListRefresh();
        return;
      case 'bye':
        // La sesión se cerró (salida, contraseña nueva, suspensión): las pestañas vuelven a la pantalla de acceso,
        // salvo la que cerró su propia sesión, que ya muestra su salida.
        if (event.reason === 'session' && !signOutAnnounced()) window.location.assign(surface === 'staff' ? '/login' : '/portal/access');
        return;
      case 'notification': {
        applyLive((current) => applyNotificationEvent(current, event));
        const notice = event.notification;
        // "Tomada por Ana", "Ya no aplica"…: el flash de algo ya atendido desaparece.
        if (event.mode === 'resolved' || notice.resolvedAt || notice.readAt) dispatchFlash({ type: 'dismiss', ids: [notice.id] });
        if (!shouldFlash(event, activeRequest.current, document.visibilityState === 'visible')) return;
        if (document.visibilityState === 'visible') {
          dispatchFlash({ type: 'show', notification: notice });
          if (preferencesRef.current.sound) chime.current?.play(notice.priority === 'URGENT' ? 'URGENT' : 'HIGH');
          return;
        }
        // Nadie mira esta pestaña: la líder avisa por escritorio si ninguna otra está a la vista.
        if (!origin.leader || !preferencesRef.current.desktop) return;
        void origin.someoneLooking().then((someoneLooking) => {
          if (!someoneLooking) showDesktopNotification(notice, { silent: !preferencesRef.current.sound, onOpen: (path) => router.push(path) });
        });
        return;
      }
    }
  }, [applyLive, refresh, router, scheduleListRefresh, subscriptions, surface]);

  useInboxRealtime(available && loaded, { onEvent: handleRealtime, onLive: setLive });

  const markRead = useCallback(async (input: MarkReadInput) => {
    writeGeneration.current += 1;
    latestWrite.current += 1;
    const write = latestWrite.current;
    setSummary((current) => applyReadLocally(current, input, new Date().toISOString()));
    // Leer a propósito (un aviso o todos) quita su flash; abrir un expediente no.
    if ('ids' in input && input.read !== false) dispatchFlash({ type: 'dismiss', ids: input.ids });
    if ('all' in input) dispatchFlash({ type: 'clear' });
    try {
      const counts = await postInboxRead(input);
      writeGeneration.current += 1;
      // Con dos escrituras seguidas, sólo cuentan los contadores de la última.
      if (write === latestWrite.current) setSummary((current) => ({ ...current, unread: counts.unread, actionRequired: counts.actionRequired }));
    } catch {
      writeGeneration.current += 1;
      void refresh();
    }
  }, [refresh]);

  const dismissFlash = useCallback((id: string) => dispatchFlash({ type: 'dismiss', ids: [id] }), []);
  const pauseFlash = useCallback((id: string, paused: boolean, remainingMs?: number) => dispatchFlash({ type: 'pause', id, paused, remainingMs }), []);
  const requestPanel = useCallback(() => setPanelRequest((current) => current + 1), []);
  const setActiveRequest = useCallback((quoteRequestId: string | null) => {
    activeRequest.current = quoteRequestId;
  }, []);

  const setSound = useCallback((on: boolean) => {
    writePreference(surface, 'sound', on);
    setPreferences((current) => ({ ...current, sound: on }));
    // El clic que lo enciende también habilita el audio.
    if (on) chime.current?.unlock();
  }, [surface]);

  const setDesktop = useCallback(async (on: boolean) => {
    if (on && desktopPermission() !== 'granted') {
      const permission = await requestDesktopPermission();
      setDesktopState(permission);
      if (permission !== 'granted') return;
    }
    writePreference(surface, 'desktop', on);
    setPreferences((current) => ({ ...current, desktop: on }));
    setDesktopState(desktopPermission());
  }, [surface]);

  const value = useMemo<InboxContextValue>(() => ({
    surface,
    available,
    loaded,
    visible,
    unread,
    actionRequired: available ? summary.actionRequired : 0,
    latest: summary.latest,
    unreadByRequest: summary.unreadByRequest,
    refresh,
    markRead,
    live,
    flashes,
    dismissFlash,
    pauseFlash,
    panelRequest,
    requestPanel,
    subscribeRequest: subscriptions.subscribe,
    setActiveRequest,
    preferences,
    setSound,
    desktop,
    setDesktop,
  }), [surface, available, loaded, visible, unread, summary, refresh, markRead, live, flashes, dismissFlash, pauseFlash, panelRequest, requestPanel, subscriptions, setActiveRequest, preferences, setSound, desktop, setDesktop]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue | null {
  return useContext(InboxContext);
}

/** Una vista con un expediente abierto lo registra: su actividad no destella, porque ya se ve en pantalla (spec §5.3). */
export function useInboxActiveContext(quoteRequestId: string | null): void {
  const inbox = useInbox();
  const setActiveRequest = inbox?.setActiveRequest;
  useEffect(() => {
    if (!setActiveRequest) return undefined;
    setActiveRequest(inbox?.visible ? quoteRequestId : null);
    return () => setActiveRequest(null);
  }, [inbox?.visible, setActiveRequest, quoteRequestId]);
}
