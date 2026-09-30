import type { RequestPart } from '@/lib/realtime-client';

export const ANY_REQUEST = '*';

export type RequestChange = Readonly<{
  /** null en una relectura general: reconexión del canal o volver a la pestaña sin canal. */
  requestId: string | null;
  parts: readonly RequestPart[];
  /** El cambio lo hizo esta misma persona (desde esta u otra pestaña): su vista ya lo refleja. */
  self: boolean;
  reason: 'signal' | 'resync';
}>;

export type RequestSubscriptions = Readonly<{
  subscribe: (requestId: string, parts: readonly RequestPart[], callback: (change: RequestChange) => void) => () => void;
  dispatch: (requestId: string, parts: readonly RequestPart[], self: boolean) => void;
  refreshAll: () => void;
}>;

/** Qué vistas escuchan qué expediente (o cualquiera, con `*`) y qué partes. */
export function createRequestSubscriptions(): RequestSubscriptions {
  const subscribers = new Set<Readonly<{ requestId: string; parts: ReadonlySet<RequestPart>; callback: (change: RequestChange) => void }>>();
  return {
    subscribe(requestId, parts, callback) {
      const entry = { requestId, parts: new Set(parts), callback };
      subscribers.add(entry);
      return () => { subscribers.delete(entry); };
    },
    dispatch(requestId, parts, self) {
      for (const entry of [...subscribers]) {
        if (entry.requestId !== ANY_REQUEST && entry.requestId !== requestId) continue;
        const matched = parts.filter((part) => entry.parts.has(part));
        if (matched.length > 0) entry.callback({ requestId, parts: matched, self, reason: 'signal' });
      }
    },
    refreshAll() {
      for (const entry of [...subscribers]) entry.callback({ requestId: null, parts: [...entry.parts], self: false, reason: 'resync' });
    },
  };
}
