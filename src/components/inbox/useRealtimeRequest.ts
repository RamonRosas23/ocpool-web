'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RequestPart } from '@/lib/realtime-client';
import type { RequestChange } from '@/lib/realtime-subscriptions';
import { useInbox } from './InboxProvider';

/** Una vista se entera cuando cambia una parte de un expediente (o de cualquiera, con `*`). Sin id, no escucha. */
export function useRealtimeRequest(requestId: string | null | undefined, parts: readonly RequestPart[], onChange: (change: RequestChange) => void): void {
  const subscribe = useInbox()?.subscribeRequest;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const partsKey = parts.join(',');
  useEffect(() => {
    if (!subscribe || !requestId) return undefined;
    return subscribe(requestId, partsKey.split(',') as RequestPart[], (change) => onChangeRef.current(change));
  }, [subscribe, requestId, partsKey]);
}

/** Agrupa ráfagas: `run` corre una vez, `ms` después del último aviso. */
export function useCoalesced(run: () => void, ms: number): () => void {
  const runRef = useRef(run);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      runRef.current();
    }, ms);
  }, [ms]);
}
