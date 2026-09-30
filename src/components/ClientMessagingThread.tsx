'use client';

import { FormEvent, Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';
import { getOrCreateMessageIdempotencyKey } from '@/lib/message-idempotency';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { formatDateTime } from '@/lib/format-date';
import { loadThroughLatest } from '@/lib/load-latest-messages';
import { mergeThread } from '@/lib/live-thread';
import { relativeTimeLabel } from '@/lib/relative-time';

type PortalMessage = {
  id: string;
  conversationId: string;
  visibility: 'CUSTOMER';
  body: string;
  createdAt: string;
  sender: { displayName: string; type: 'CUSTOMER' | 'EMPLOYEE' } | null;
};

type PortalConversation = {
  id: string;
  quoteRequestId: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

type PortalConversationResponse = {
  conversation: PortalConversation | null;
  items: PortalMessage[];
  nextCursor: string | null;
  latestCursor?: string | null;
};

type PortalErrorResponse = { error?: { message?: string; requestId?: string } };

const MAX_MESSAGE_LENGTH = 10_000;

/** El final de la lista está a la vista: lo nuevo se ve sin avisar. */
function listBottomVisible(list: HTMLElement | null): boolean {
  return !list || list.getBoundingClientRect().bottom <= window.innerHeight + 24;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & PortalErrorResponse;
  if (!response.ok) throw new Error(getApiErrorMessage(data, 'No fue posible cargar la conversación.'));
  return data as T;
}

function authorLabel(message: PortalMessage): string {
  return message.sender?.type === 'EMPLOYEE' ? 'Equipo OCPOOL' : 'Tú';
}

export default function ClientMessagingThread({ requestId }: { requestId: string }) {
  const headingId = useId();
  const composerId = useId();
  const [conversation, setConversation] = useState<PortalConversation | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState<string | null>(null);
  const [newFromId, setNewFromId] = useState<string | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const latestCursorRef = useRef<string | null>(null);
  const messagesRef = useRef<PortalMessage[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // UX audit fix: `retry`/`loadMore` no tenían ninguna guarda contra respuesta obsoleta, a diferencia
  // del efecto de montaje (que sí usa `AbortController`) -- como este componente no se vuelve a montar
  // al cambiar de folio (el padre lo mantiene con `key={messagingRefreshKey}`, no `key={requestId}`),
  // pedir "Ver más mensajes" o "Reintentar" para la solicitud A y cambiar a la solicitud B antes de
  // que la petición resolviera podía mezclar los mensajes de A dentro de la conversación mostrada de
  // B. Mismo patrón ya usado en `StaffMessagingPanel.tsx`.
  const requestIdRef = useRef(requestId);
  useEffect(() => { requestIdRef.current = requestId; }, [requestId]);
  const isStale = () => requestIdRef.current !== requestId;

  const loadMessages = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=100` : '?limit=100';
    const response = await fetch(`/api/portal/requests/${requestId}/messages${query}`, { credentials: 'include', cache: 'no-store', signal });
    return readJson<PortalConversationResponse>(response);
  }, [requestId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSendError(null);
    setConversation(null);
    messagesRef.current = [];
    setMessages([]);
    setNextCursor(null);
    setNewFromId(null);
    setUnseenCount(0);
    latestCursorRef.current = null;
    setSendIdempotencyKey(null);
    void loadThroughLatest((cursor) => loadMessages(cursor, controller.signal)).then((data) => {
      if (controller.signal.aborted) return;
      setConversation(data.conversation);
      messagesRef.current = data.items;
      setMessages(data.items);
      setNextCursor(data.nextCursor);
      latestCursorRef.current = data.latestCursor ?? null;
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la conversación.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadMessages]);

  const retry = () => {
    setLoading(true);
    setError(null);
    void loadThroughLatest((cursor) => loadMessages(cursor)).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      messagesRef.current = data.items;
      setMessages(data.items);
      setNextCursor(data.nextCursor);
      latestCursorRef.current = data.latestCursor ?? null;
    }).catch((caught: unknown) => {
      if (!isStale()) setError(caught instanceof Error ? caught.message : 'No fue posible cargar la conversación.');
    }).finally(() => setLoading(false));
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void loadMessages(nextCursor).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      const merged = mergeThread(messagesRef.current, data.items).items;
      messagesRef.current = merged;
      setMessages(merged);
      setNextCursor(data.nextCursor);
      latestCursorRef.current = data.latestCursor ?? latestCursorRef.current;
    }).catch((caught: unknown) => {
      if (!isStale()) setError(caught instanceof Error ? caught.message : 'No fue posible cargar más mensajes.');
    }).finally(() => setLoadingMore(false));
  };

  const fetchNewer = (markNew: boolean) => {
    const bottomVisible = listBottomVisible(listRef.current);
    void loadThroughLatest((cursor) => loadMessages(cursor ?? latestCursorRef.current ?? undefined)).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      latestCursorRef.current = data.latestCursor ?? latestCursorRef.current;
      const { items, added } = mergeThread(messagesRef.current, data.items);
      if (added.length === 0) return;
      messagesRef.current = items;
      setMessages(items);
      if (!markNew) return;
      setNewFromId((current) => current ?? added[0]);
      if (!bottomVisible) setUnseenCount((count) => count + added.length);
    }).catch(() => undefined);
  };
  useRealtimeRequest(requestId, ['messages', 'read'], (change) => fetchNewer(!change.self));

  useEffect(() => {
    if (unseenCount === 0) return undefined;
    const onScroll = () => { if (listBottomVisible(listRef.current)) setUnseenCount(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [unseenCount]);

  const revealNew = () => {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (newFromId) document.getElementById(`client-message-${newFromId}`)?.scrollIntoView({ behavior, block: 'center' });
    setUnseenCount(0);
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || sending || conversation?.status === 'CLOSED') return;
    setSending(true);
    setSendError(null);
    const body = draft;
    const idempotencyKey = getOrCreateMessageIdempotencyKey(sendIdempotencyKey, `portal-${requestId}`);
    setSendIdempotencyKey(idempotencyKey);
    void fetch(`/api/portal/requests/${requestId}/messages`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, idempotencyKey }),
    }).then(readJson<PortalMessage & { conversation: PortalConversation }>).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      const merged = mergeThread(messagesRef.current, [data]).items;
      messagesRef.current = merged;
      setMessages(merged);
      setNewFromId(null);
      setDraft('');
      setSendIdempotencyKey(null);
      setAnnouncement('Mensaje enviado.');
    }).catch((caught: unknown) => {
      if (!isStale()) setSendError(caught instanceof Error ? caught.message : 'No fue posible enviar el mensaje.');
    }).finally(() => setSending(false));
  };

  return <section className="client-messaging" aria-labelledby={headingId}>
    <div className="client-messaging__head">
      <div>
        <p className="client-eyebrow">Correspondencia</p>
        <h3 id={headingId}>Conversación del expediente</h3>
        <p className="client-messaging__intro">Aquí resolvemos contigo las dudas y próximos pasos de tu proyecto.</p>
      </div>
      <span className={`client-messaging__state${conversation?.status === 'CLOSED' ? ' is-closed' : ''}`}>
        <i aria-hidden="true" /> {loading ? 'Preparando' : conversation?.status === 'CLOSED' ? 'Cerrada' : 'Abierta'}
      </span>
    </div>

    {loading && <div className="client-messaging__loading" role="status" aria-label="Cargando conversación"><i /><i /><i /></div>}
    {!loading && error && <div className="client-messaging__error" role="alert"><p>{error}</p><button type="button" className="client-messaging__retry" onClick={retry}>Reintentar</button></div>}
    {!loading && !error && <>
      {messages.length === 0 && <div className="client-messaging__empty"><strong>Aún no hay mensajes.</strong><span>Escribe una actualización o una duda y el equipo la verá en este expediente.</span></div>}
      {messages.length > 0 && <ol ref={listRef} className="client-messaging__list" aria-live="polite">
        {messages.map((message) => <Fragment key={message.id}>
          {message.id === newFromId && <li className="thread-divider" aria-hidden="true"><span>Nuevo</span></li>}
          <li id={`client-message-${message.id}`} className={`client-message client-message--${message.sender?.type === 'EMPLOYEE' ? 'team' : 'client'}`}>
            <div className="client-message__meta"><strong>{authorLabel(message)}</strong><time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{relativeTimeLabel(message.createdAt)}</time></div>
            <p>{message.body}</p>
          </li>
        </Fragment>)}
      </ol>}
      {unseenCount > 0 && <button type="button" className="thread-new-pill" onClick={revealNew}>{unseenCount === 1 ? '1 mensaje nuevo' : `${unseenCount} mensajes nuevos`} ↓</button>}
      {nextCursor && <button type="button" className="client-messaging__more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando mensajes…' : 'Cargar mensajes más recientes'}</button>}
      {conversation?.status === 'CLOSED' ? <div className="client-messaging__closed" role="status"><strong>Esta conversación está cerrada.</strong><span>El expediente conserva su historial como referencia. Si necesitas continuar, ponte en contacto con OCPOOL.</span></div> : <form className="client-messaging__composer" onSubmit={sendMessage}>
        <label htmlFor={composerId}>Escribe una actualización</label>
        <textarea id={composerId} value={draft} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => { setDraft(event.target.value); setSendIdempotencyKey(null); }} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Comparte una duda, ajuste o próximo paso…" rows={4} disabled={sending} aria-describedby={`${composerId}-hint`} />
        <div className="client-messaging__composer-bottom"><span id={`${composerId}-hint`}>{draft.length.toLocaleString('es-MX')} / {MAX_MESSAGE_LENGTH.toLocaleString('es-MX')} caracteres · Ctrl + Enter para enviar</span><button type="submit" className="client-messaging__send" disabled={sending || !draft.trim()} aria-busy={sending}>{sending ? 'Enviando…' : 'Enviar mensaje'}</button></div>
        {sendError && <p className="client-messaging__send-error" role="alert">{sendError}</p>}
      </form>}
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </>}
  </section>;
}
