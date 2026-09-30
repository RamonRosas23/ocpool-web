'use client';

import { FormEvent, Fragment, KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { nextRovingTabIndex } from '@/components/private/ui';
import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';
import { getOrCreateMessageIdempotencyKey } from '@/lib/message-idempotency';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { formatDateTime } from '@/lib/format-date';
import { loadThroughLatest } from '@/lib/load-latest-messages';
import { mergeThread, seenAt, type CustomerRead } from '@/lib/live-thread';
import { relativeTimeLabel } from '@/lib/relative-time';

export type StaffMessagingCapabilities = {
  messagingRead: boolean;
  messagingSend: boolean;
  messagingInternalNotesRead: boolean;
  messagingInternalNotesWrite: boolean;
  messagingManage: boolean;
};

type MessageVisibility = 'CUSTOMER' | 'INTERNAL';
type ConversationStatus = 'OPEN' | 'CLOSED';
type ComposerMode = 'CUSTOMER' | 'INTERNAL';

type StaffMessage = {
  id: string;
  conversationId: string;
  visibility: MessageVisibility;
  body: string;
  createdAt: string;
  sender: { id: string; displayName: string; type: 'CUSTOMER' | 'EMPLOYEE' } | null;
};

type StaffConversation = {
  id: string;
  quoteRequestId: string;
  clientId: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

type StaffConversationResponse = {
  conversation: StaffConversation | null;
  items: StaffMessage[];
  nextCursor: string | null;
  latestCursor?: string | null;
  customerRead?: CustomerRead | null;
};

type StaffConversationStatusResponse = {
  conversationId: string;
  quoteRequestId: string;
  status: ConversationStatus;
  closedAt: string | null;
};

type ErrorResponse = { error?: { message?: string; requestId?: string } };

const MAX_MESSAGE_LENGTH = 10_000;

/** El final de la lista está a la vista: lo nuevo se ve sin avisar. */
function listBottomVisible(list: HTMLElement | null): boolean {
  return !list || list.getBoundingClientRect().bottom <= window.innerHeight + 24;
}


async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(getApiErrorMessage(data, 'No fue posible completar la operación.'));
  return data as T;
}

export default function StaffMessagingPanel({ requestId, capabilities, draft: controlledDraft, onDraftChange }: { requestId: string; capabilities: StaffMessagingCapabilities; draft?: string; onDraftChange?: (draft: string) => void }) {
  const headingId = useId();
  const sharedTabId = useId();
  const internalTabId = useId();
  const sharedPanelId = useId();
  const internalPanelId = useId();
  const composerId = useId();
  const [conversation, setConversation] = useState<StaffConversation | null>(null);
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mode, setMode] = useState<ComposerMode>('CUSTOMER');
  const [localDraft, setLocalDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConversationStatus | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState<string | null>(null);
  const [customerRead, setCustomerRead] = useState<CustomerRead | null>(null);
  // Primer mensaje que llegó en vivo (separador "Nuevo") y cuántos quedaron fuera de la vista (píldora).
  const [newFromId, setNewFromId] = useState<string | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const latestCursorRef = useRef<string | null>(null);
  const messagesRef = useRef<StaffMessage[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    setNewFromId(null);
    setUnseenCount(0);
  }, [mode]);

  // UX audit fix: este componente no se remonta al cambiar de solicitud seleccionada
  // (StaffRequestsPanel.tsx renderiza `<StaffMessagingPanel requestId={...} />` sin `key`, misma
  // instancia persiste) -- `sendMessage`/`changeStatus`/`retry`/`loadMore` aplicaban su respuesta
  // sin comprobar que `requestId` siguiera siendo el mismo cuando la petición resolvía. Si el
  // staff enviaba un mensaje para la solicitud A y hacía clic en la solicitud B antes de que la
  // petición resolviera, la respuesta tardía de A podía inyectarse en el hilo de B ya mostrado.
  const requestIdRef = useRef(requestId);
  useEffect(() => { requestIdRef.current = requestId; }, [requestId]);
  const isStale = () => requestIdRef.current !== requestId;

  const canRead = capabilities.messagingRead;
  const canSeeInternal = canRead && capabilities.messagingInternalNotesRead;
  const canCompose = mode === 'CUSTOMER' ? capabilities.messagingSend : capabilities.messagingInternalNotesWrite;
  const draft = controlledDraft ?? localDraft;
  const updateDraft = (value: string) => {
    if (value !== draft) setSendIdempotencyKey(null);
    if (onDraftChange) onDraftChange(value);
    else setLocalDraft(value);
  };

  const loadMessages = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`/api/staff/quote-requests/${requestId}/messages?${params.toString()}`, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    return readJson<StaffConversationResponse>(response);
  }, [requestId]);

  const applyResponse = (data: StaffConversationResponse) => {
    setConversation(data.conversation);
    messagesRef.current = data.items;
    setMessages(data.items);
    setNextCursor(data.nextCursor);
    setCustomerRead(data.customerRead ?? null);
    latestCursorRef.current = data.latestCursor ?? null;
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSendError(null);
    setStatusError(null);
    setConfirmation(null);
    setSendIdempotencyKey(null);
    setConversation(null);
    messagesRef.current = [];
    setMessages([]);
    setNextCursor(null);
    setCustomerRead(null);
    setNewFromId(null);
    setUnseenCount(0);
    latestCursorRef.current = null;
    if (!onDraftChange) setLocalDraft('');
    void loadThroughLatest((cursor) => loadMessages(cursor, controller.signal)).then((data) => {
      if (!controller.signal.aborted) applyResponse(data);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'No fue posible cargar la conversación.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadMessages, onDraftChange]);

  useEffect(() => {
    if (!canSeeInternal && mode === 'INTERNAL') setMode('CUSTOMER');
  }, [canSeeInternal, mode]);

  const retry = () => {
    setLoading(true);
    setError(null);
    void loadThroughLatest((cursor) => loadMessages(cursor)).then((data) => { if (!isStale()) applyResponse(data); }).catch((caught: unknown) => {
      if (!isStale()) setError(caught instanceof Error ? caught.message : 'No fue posible cargar la conversación.');
    }).finally(() => setLoading(false));
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void loadMessages(nextCursor).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      setCustomerRead(data.customerRead ?? null);
      const merged = mergeThread(messagesRef.current, data.items).items;
      messagesRef.current = merged;
      setMessages(merged);
      setNextCursor(data.nextCursor);
      latestCursorRef.current = data.latestCursor ?? latestCursorRef.current;
    }).catch((caught: unknown) => {
      if (!isStale()) setError(caught instanceof Error ? caught.message : 'No fue posible cargar más mensajes.');
    }).finally(() => setLoadingMore(false));
  };

  // En vivo (spec §5.4): pide sólo lo posterior al último mensaje conocido. Lo propio no es "Nuevo".
  const fetchNewer = (markNew: boolean) => {
    const bottomVisible = listBottomVisible(listRef.current);
    void loadThroughLatest((cursor) => loadMessages(cursor ?? latestCursorRef.current ?? undefined)).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      setCustomerRead(data.customerRead ?? null);
      latestCursorRef.current = data.latestCursor ?? latestCursorRef.current;
      const { items, added } = mergeThread(messagesRef.current, data.items);
      if (added.length === 0) return;
      messagesRef.current = items;
      setMessages(items);
      if (!markNew) return;
      const addedIds = new Set(added);
      const visibleAdded = items.filter((message) => addedIds.has(message.id) && message.visibility === mode);
      if (visibleAdded.length === 0) return;
      setNewFromId((current) => current ?? visibleAdded[0].id);
      if (!bottomVisible) setUnseenCount((count) => count + visibleAdded.length);
    }).catch(() => undefined);
  };
  useRealtimeRequest(canRead ? requestId : null, ['messages', 'read'], (change) => fetchNewer(!change.self));

  // La píldora se va sola cuando la persona baja hasta el final.
  useEffect(() => {
    if (unseenCount === 0) return undefined;
    const onScroll = () => { if (listBottomVisible(listRef.current)) setUnseenCount(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [unseenCount]);

  const revealNew = () => {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (newFromId) document.getElementById(`staff-message-${newFromId}`)?.scrollIntoView({ behavior, block: 'center' });
    setUnseenCount(0);
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || !canCompose || sending || conversation?.status === 'CLOSED') return;
    setSending(true);
    setSendError(null);
    const body = draft;
    const endpoint = mode === 'CUSTOMER' ? 'messages' : 'notes';
    const idempotencyKey = getOrCreateMessageIdempotencyKey(sendIdempotencyKey, `staff-${requestId}`);
    setSendIdempotencyKey(idempotencyKey);
    void fetch(`/api/staff/quote-requests/${requestId}/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, idempotencyKey }),
    }).then(readJson<StaffMessage & { conversation: StaffConversation }>).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      const merged = mergeThread(messagesRef.current, [data]).items;
      messagesRef.current = merged;
      setMessages(merged);
      setNewFromId(null);
      updateDraft('');
      setSendIdempotencyKey(null);
      setAnnouncement(mode === 'CUSTOMER' ? 'Mensaje compartido enviado.' : 'Nota interna guardada.');
    }).catch((caught: unknown) => {
      if (!isStale()) setSendError(caught instanceof Error ? caught.message : 'No fue posible enviar el contenido.');
    }).finally(() => setSending(false));
  };

  const changeStatus = () => {
    if (!conversation || !confirmation || !capabilities.messagingManage || changingStatus) return;
    setChangingStatus(true);
    setStatusError(null);
    const targetStatus = confirmation;
    void fetch(`/api/staff/quote-requests/${requestId}/conversation-status`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: targetStatus }),
    }).then(readJson<StaffConversationStatusResponse>).then((data) => {
      if (isStale()) return;
      setConversation((current) => current ? { ...current, status: data.status, closedAt: data.closedAt, updatedAt: new Date().toISOString() } : current);
      setConfirmation(null);
      setAnnouncement(targetStatus === 'CLOSED' ? 'Conversación cerrada.' : 'Conversación abierta.');
    }).catch((caught: unknown) => {
      if (!isStale()) setStatusError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.');
    }).finally(() => setChangingStatus(false));
  };

  const visibleMessages = useMemo(() => messages.filter((message) => message.visibility === mode), [messages, mode]);
  const seenLabelAt = mode === 'CUSTOMER' ? seenAt(visibleMessages, customerRead, (message) => message.sender?.type !== 'CUSTOMER') : null;
  const sharedCount = messages.filter((message) => message.visibility === 'CUSTOMER').length;
  const internalCount = messages.filter((message) => message.visibility === 'INTERNAL').length;
  const closed = conversation?.status === 'CLOSED';
  const modeLabel = mode === 'CUSTOMER' ? 'Mensaje visible para cliente' : 'Nota interna para el equipo';
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabButtons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = tabButtons.indexOf(event.currentTarget);
    const nextIndex = nextRovingTabIndex(event.key, currentIndex, tabButtons.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextMode = nextIndex === 0 ? 'CUSTOMER' : 'INTERNAL';
    setMode(nextMode);
    setSendIdempotencyKey(null);
    setSendError(null);
    tabButtons[nextIndex]?.focus();
  };

  return <section className="staff-messaging" aria-labelledby={headingId}>
    <div className="staff-messaging__head">
      <div>
        <p className="staff-section-label">Cliente y equipo</p>
        <h3 id={headingId}>Correspondencia</h3>
        <p className="staff-messaging__intro">Coordina al equipo y responde al cliente desde este expediente.</p>
      </div>
      <div className="staff-messaging__status-wrap">
        <span className={`staff-messaging__status${closed ? ' is-closed' : ''}`}><i aria-hidden="true" /> {conversation ? closed ? 'Cerrada' : 'Abierta' : 'Sin iniciar'}</span>
        {conversation && capabilities.messagingManage && !confirmation && <button type="button" className="staff-messaging__status-button" onClick={() => setConfirmation(closed ? 'OPEN' : 'CLOSED')}>{closed ? 'Reabrir conversación' : 'Cerrar conversación'}</button>}
      </div>
    </div>

    {confirmation && <div className="staff-messaging__confirm" role="group" aria-label={confirmation === 'CLOSED' ? 'Confirmar cierre de conversación' : 'Confirmar reapertura de conversación'}>
      <span>{confirmation === 'CLOSED' ? 'El cliente ya no podrá enviar mensajes hasta que se reabra.' : 'La conversación volverá a aceptar mensajes.'}</span>
      <div><button type="button" className="staff-button staff-button--dark" onClick={changeStatus} disabled={changingStatus}>{confirmation === 'CLOSED' ? 'Confirmar cierre' : 'Confirmar reapertura'}</button><button type="button" className="staff-messaging__cancel" onClick={() => setConfirmation(null)} disabled={changingStatus}>Cancelar</button></div>
    </div>}

    {statusError && <p className="staff-messaging__error" role="alert">{statusError}</p>}
    {!canRead && <div className="staff-messaging__empty"><strong>Mensajería no disponible.</strong><span>Tu rol no tiene permiso para consultar esta conversación.</span></div>}
    {canRead && loading && <div className="staff-messaging__loading" role="status" aria-label="Cargando conversación"><i /><i /><i /></div>}
    {canRead && !loading && error && <div className="staff-messaging__error" role="alert"><p>{error}</p><button type="button" className="staff-messaging__retry" onClick={retry}>Reintentar</button></div>}
    {canRead && !loading && !error && <>
      <div className="staff-messaging__tabs" role="tablist" aria-label="Visibilidad de la conversación" aria-orientation="horizontal">
        <button id={sharedTabId} type="button" role="tab" tabIndex={mode === 'CUSTOMER' ? 0 : -1} aria-selected={mode === 'CUSTOMER'} aria-controls={mode === 'CUSTOMER' ? sharedPanelId : undefined} className={mode === 'CUSTOMER' ? 'is-active' : ''} onKeyDown={handleTabKeyDown} onClick={() => { setMode('CUSTOMER'); setSendIdempotencyKey(null); setSendError(null); }}>{`Compartidos ${sharedCount}`}</button>
        {canSeeInternal && <button id={internalTabId} type="button" role="tab" tabIndex={mode === 'INTERNAL' ? 0 : -1} aria-selected={mode === 'INTERNAL'} aria-controls={mode === 'INTERNAL' ? internalPanelId : undefined} className={mode === 'INTERNAL' ? 'is-active' : ''} onKeyDown={handleTabKeyDown} onClick={() => { setMode('INTERNAL'); setSendIdempotencyKey(null); setSendError(null); }}>{`Notas internas ${internalCount}`}</button>}
      </div>
      <div id={mode === 'CUSTOMER' ? sharedPanelId : internalPanelId} role="tabpanel" aria-labelledby={mode === 'CUSTOMER' ? sharedTabId : internalTabId} className={`staff-messaging__panel${mode === 'INTERNAL' ? ' is-internal' : ''}`}>
        {visibleMessages.length === 0 && <div className="staff-messaging__empty"><strong>{mode === 'CUSTOMER' ? 'Aún no hay mensajes compartidos.' : 'Aún no hay notas internas.'}</strong><span>{mode === 'CUSTOMER' ? 'Las respuestas de este hilo quedarán visibles para el cliente.' : 'Usa este espacio para coordinar detalles que no deben salir del equipo.'}</span></div>}
        {visibleMessages.length > 0 && <ol ref={listRef} className="staff-messaging__list" aria-live="polite">
          {visibleMessages.map((message) => <Fragment key={message.id}>
            {message.id === newFromId && <li className="thread-divider" aria-hidden="true"><span>Nuevo</span></li>}
            <li id={`staff-message-${message.id}`} className={`staff-message${message.visibility === 'INTERNAL' ? ' staff-message--internal' : ''}`}>
              <div className="staff-message__meta"><strong>{message.sender?.type === 'CUSTOMER' ? 'Cliente' : message.sender?.displayName ?? 'Equipo OCPOOL'}</strong><time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{relativeTimeLabel(message.createdAt)}</time><span>{message.visibility === 'CUSTOMER' ? 'Visible para cliente' : 'Sólo equipo'}</span></div>
              <p>{message.body}</p>
            </li>
          </Fragment>)}
        </ol>}
        {seenLabelAt && <p className="thread-seen" title={formatDateTime(seenLabelAt)}>Visto · {relativeTimeLabel(seenLabelAt)}</p>}
        {unseenCount > 0 && <button type="button" className="thread-new-pill" onClick={revealNew}>{unseenCount === 1 ? '1 mensaje nuevo' : `${unseenCount} mensajes nuevos`} ↓</button>}
        {nextCursor && <button type="button" className="staff-messaging__more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando mensajes…' : 'Cargar mensajes más recientes'}</button>}
        {closed ? <div className="staff-messaging__closed" role="status"><strong>Conversación cerrada.</strong><span>El historial permanece disponible; reabre la conversación para continuar.</span></div> : canCompose ? <form className="staff-messaging__composer" onSubmit={sendMessage}>
          <label htmlFor={composerId}>{modeLabel}</label>
          <textarea id={composerId} value={draft} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => updateDraft(event.target.value)} placeholder={mode === 'CUSTOMER' ? 'Escribe una actualización para el cliente…' : 'Registra una nota que sólo verá el equipo…'} rows={4} disabled={sending} />
          <div className="staff-messaging__composer-bottom"><span>{draft.length.toLocaleString('es-MX')} / {MAX_MESSAGE_LENGTH.toLocaleString('es-MX')} caracteres</span><button type="submit" className={`staff-button ${mode === 'INTERNAL' ? 'staff-button--copper' : 'staff-button--dark'}`} disabled={sending || !draft.trim()} aria-busy={sending}>{sending ? 'Guardando…' : mode === 'INTERNAL' ? 'Guardar nota' : 'Enviar mensaje'}</button></div>
          {sendError && <p className="staff-messaging__error" role="alert">{sendError}</p>}
        </form> : <div className="staff-messaging__locked" role="status"><strong>No tienes permiso para escribir aquí.</strong><span>Tu acceso actual permite consultar esta conversación.</span></div>}
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </>}
  </section>;
}
