'use client';

import { useEffect, useRef } from 'react';
import { anyTabVisible, electLeader, holdVisibleLock, RealtimeController, type LockManagerLike, type RealtimeEvent } from '@/lib/realtime-client';

const CHANNEL = 'ocpool-realtime';
const LIVE_BEAT_MS = 20_000;
const LIVE_STALE_MS = 45_000;

type RelayMessage = Readonly<{ kind: 'event'; event: RealtimeEvent }> | Readonly<{ kind: 'live'; live: boolean }>;

export type RealtimeOrigin = Readonly<{
  /** La pestaña que tiene la conexión (la única que muestra alertas de escritorio). */
  leader: boolean;
  /** Si alguna pestaña de este navegador está a la vista. */
  someoneLooking: () => Promise<boolean>;
}>;

export type RealtimeHandlers = Readonly<{
  onEvent: (event: RealtimeEvent, origin: RealtimeOrigin) => void;
  onLive: (live: boolean) => void;
}>;

function browserLocks(): LockManagerLike | undefined {
  return (navigator as Navigator & { locks?: LockManagerLike }).locks;
}

/**
 * Una conexión por navegador (spec §4.4): la pestaña que obtiene el candado la abre y reparte cada evento por
 * BroadcastChannel; las demás sólo escuchan. Sin noticias de una líder en vivo durante 45 s, cada pestaña vuelve a
 * la consulta de respaldo. Sin Web Locks, BroadcastChannel o EventSource no se abre ninguna conexión: con HTTP/1.1
 * una por pestaña agotaría las ~6 conexiones que el navegador permite por sitio.
 */
export function useInboxRealtime(enabled: boolean, handlers: RealtimeHandlers): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const locks = typeof navigator === 'undefined' ? undefined : browserLocks();
    if (!enabled || !locks || typeof BroadcastChannel === 'undefined' || typeof EventSource === 'undefined') return undefined;
    const channel = new BroadcastChannel(CHANNEL);
    const tabId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const someoneLooking = () => anyTabVisible(locks, document.visibilityState === 'visible');
    let leading = false;
    let followerLive = false;
    let lastBeat = 0;

    const setFollowerLive = (live: boolean) => {
      if (followerLive === live) return;
      followerLive = live;
      handlersRef.current.onLive(live);
    };
    const onMessage = (message: MessageEvent<RelayMessage>) => {
      if (leading || !message.data) return;
      if (message.data.kind === 'live') {
        lastBeat = message.data.live ? Date.now() : 0;
        setFollowerLive(message.data.live);
        return;
      }
      lastBeat = Date.now();
      setFollowerLive(true);
      handlersRef.current.onEvent(message.data.event, { leader: false, someoneLooking });
    };
    channel.addEventListener('message', onMessage);
    const staleCheck = window.setInterval(() => {
      if (!leading && followerLive && Date.now() - lastBeat > LIVE_STALE_MS) setFollowerLive(false);
    }, 5_000);

    let releaseVisible: (() => void) | null = null;
    const syncVisible = () => {
      if (document.visibilityState === 'visible') releaseVisible ??= holdVisibleLock(locks, tabId);
      else {
        releaseVisible?.();
        releaseVisible = null;
      }
    };
    syncVisible();
    document.addEventListener('visibilitychange', syncVisible);

    const stopElection = electLeader(locks, () => {
      leading = true;
      followerLive = false;
      let live = false;
      const controller = new RealtimeController({
        open: (url) => new EventSource(url),
        onEvent: (event) => {
          handlersRef.current.onEvent(event, { leader: true, someoneLooking });
          channel.postMessage({ kind: 'event', event } satisfies RelayMessage);
        },
        onMode: (mode) => {
          live = mode === 'live';
          handlersRef.current.onLive(live);
          channel.postMessage({ kind: 'live', live } satisfies RelayMessage);
        },
      });
      controller.start();
      const beat = window.setInterval(() => channel.postMessage({ kind: 'live', live } satisfies RelayMessage), LIVE_BEAT_MS);
      return () => {
        window.clearInterval(beat);
        controller.stop();
        leading = false;
        channel.postMessage({ kind: 'live', live: false } satisfies RelayMessage);
      };
    });

    return () => {
      stopElection();
      window.clearInterval(staleCheck);
      document.removeEventListener('visibilitychange', syncVisible);
      releaseVisible?.();
      channel.removeEventListener('message', onMessage);
      channel.close();
      handlersRef.current.onLive(false);
    };
  }, [enabled]);
}
