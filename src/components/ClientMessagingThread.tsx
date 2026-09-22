'use client';

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { getOrCreateMessageIdempotencyKey } from '@/lib/message-idempotency';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { formatDateTime } from '@/lib/format-date';

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
};

type PortalErrorResponse = { error?: { message?: string; requestId?: string } };

const MAX_MESSAGE_LENGTH = 10_000;

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
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=30` : '?limit=30';
    const response = await fetch(`/api/portal/requests/${requestId}/messages${query}`, { credentials: 'include', cache: 'no-store', signal });
    return readJson<PortalConversationResponse>(response);
  }, [requestId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSendError(null);
    setConversation(null);
    setMessages([]);
    setNextCursor(null);
    setSendIdempotencyKey(null);
    void loadMessages(undefined, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setConversation(data.conversation);
      setMessages(data.items);
      setNextCursor(data.nextCursor);
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
    void loadMessages().then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      setMessages(data.items);
      setNextCursor(data.nextCursor);
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
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...current, ...data.items.filter((message) => !known.has(message.id))];
      });
      setNextCursor(data.nextCursor);
    }).catch((caught: unknown) => {
      if (!isStale()) setError(caught instanceof Error ? caught.message : 'No fue posible cargar más mensajes.');
    }).finally(() => setLoadingMore(false));
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
      setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data]);
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
      {nextCursor && <button type="button" className="client-messaging__more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando mensajes…' : 'Ver más mensajes'}</button>}
      {messages.length === 0 && <div className="client-messaging__empty"><strong>Aún no hay mensajes.</strong><span>Escribe una actualización o una duda y el equipo la verá en este expediente.</span></div>}
      {messages.length > 0 && <ol className="client-messaging__list" aria-live="polite">
        {messages.map((message) => <li className={`client-message client-message--${message.sender?.type === 'EMPLOYEE' ? 'team' : 'client'}`} key={message.id}>
          <div className="client-message__meta"><strong>{authorLabel(message)}</strong><time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time></div>
          <p>{message.body}</p>
        </li>)}
      </ol>}
      {conversation?.status === 'CLOSED' ? <div className="client-messaging__closed" role="status"><strong>Esta conversación está cerrada.</strong><span>El expediente conserva su historial como referencia. Si necesitas continuar, ponte en contacto con OCPOOL.</span></div> : <form className="client-messaging__composer" onSubmit={sendMessage}>
        <label htmlFor={composerId}>Escribe una actualización</label>
        <textarea id={composerId} value={draft} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => { setDraft(event.target.value); setSendIdempotencyKey(null); }} placeholder="Comparte una duda, ajuste o próximo paso…" rows={4} disabled={sending} />
        <div className="client-messaging__composer-bottom"><span>{draft.length.toLocaleString('es-MX')} / {MAX_MESSAGE_LENGTH.toLocaleString('es-MX')} caracteres</span><button type="submit" className="client-messaging__send" disabled={sending || !draft.trim()} aria-busy={sending}>{sending ? 'Enviando…' : 'Enviar mensaje'}</button></div>
        {sendError && <p className="client-messaging__send-error" role="alert">{sendError}</p>}
      </form>}
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </>}
  </section>;
}
