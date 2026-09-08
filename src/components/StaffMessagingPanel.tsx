'use client';

import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react';

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
};

type StaffConversationStatusResponse = {
  conversationId: string;
  quoteRequestId: string;
  status: ConversationStatus;
  closedAt: string | null;
};

type ErrorResponse = { error?: { message?: string } };

const MAX_MESSAGE_LENGTH = 10_000;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha por confirmar';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible completar la operación.');
  return data as T;
}

function mergeMessages(current: StaffMessage[], incoming: StaffMessage[]): StaffMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((left, right) => {
    const dateDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return dateDiff || left.id.localeCompare(right.id);
  });
}

export default function StaffMessagingPanel({ requestId, capabilities }: { requestId: string; capabilities: StaffMessagingCapabilities }) {
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
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConversationStatus | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const canRead = capabilities.messagingRead;
  const canSeeInternal = canRead && capabilities.messagingInternalNotesRead;
  const canCompose = mode === 'CUSTOMER' ? capabilities.messagingSend : capabilities.messagingInternalNotesWrite;

  const loadMessages = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: '30' });
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
    setMessages(data.items);
    setNextCursor(data.nextCursor);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSendError(null);
    setStatusError(null);
    setConfirmation(null);
    setConversation(null);
    setMessages([]);
    setNextCursor(null);
    setDraft('');
    void loadMessages(undefined, controller.signal).then((data) => {
      if (!controller.signal.aborted) applyResponse(data);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'No fue posible cargar la conversación.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadMessages]);

  useEffect(() => {
    if (!canSeeInternal && mode === 'INTERNAL') setMode('CUSTOMER');
  }, [canSeeInternal, mode]);

  const retry = () => {
    setLoading(true);
    setError(null);
    void loadMessages().then(applyResponse).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la conversación.');
    }).finally(() => setLoading(false));
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void loadMessages(nextCursor).then((data) => {
      setConversation(data.conversation);
      setMessages((current) => mergeMessages(current, data.items));
      setNextCursor(data.nextCursor);
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar más mensajes.');
    }).finally(() => setLoadingMore(false));
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || !canCompose || sending || conversation?.status === 'CLOSED') return;
    setSending(true);
    setSendError(null);
    const body = draft;
    const endpoint = mode === 'CUSTOMER' ? 'messages' : 'notes';
    const idempotencyKey = `staff-${requestId}-${globalThis.crypto.randomUUID()}`;
    void fetch(`/api/staff/quote-requests/${requestId}/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, idempotencyKey }),
    }).then(readJson<StaffMessage & { conversation: StaffConversation }>).then((data) => {
      setConversation(data.conversation);
      setMessages((current) => mergeMessages(current, [data]));
      setDraft('');
      setAnnouncement(mode === 'CUSTOMER' ? 'Mensaje compartido enviado.' : 'Nota interna guardada.');
    }).catch((caught: unknown) => {
      setSendError(caught instanceof Error ? caught.message : 'No fue posible enviar el contenido.');
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
      setConversation((current) => current ? { ...current, status: data.status, closedAt: data.closedAt, updatedAt: new Date().toISOString() } : current);
      setConfirmation(null);
      setAnnouncement(targetStatus === 'CLOSED' ? 'Conversación cerrada.' : 'Conversación abierta.');
    }).catch((caught: unknown) => {
      setStatusError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.');
    }).finally(() => setChangingStatus(false));
  };

  const visibleMessages = useMemo(() => messages.filter((message) => message.visibility === mode), [messages, mode]);
  const sharedCount = messages.filter((message) => message.visibility === 'CUSTOMER').length;
  const internalCount = messages.filter((message) => message.visibility === 'INTERNAL').length;
  const closed = conversation?.status === 'CLOSED';
  const modeLabel = mode === 'CUSTOMER' ? 'Mensaje visible para cliente' : 'Nota interna para el equipo';

  return <section className="staff-messaging" aria-labelledby={headingId}>
    <div className="staff-messaging__head">
      <div>
        <p className="staff-section-label">Correspondencia</p>
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
      <div className="staff-messaging__tabs" role="tablist" aria-label="Visibilidad de la conversación">
        <button id={sharedTabId} type="button" role="tab" aria-selected={mode === 'CUSTOMER'} aria-controls={sharedPanelId} className={mode === 'CUSTOMER' ? 'is-active' : ''} onClick={() => { setMode('CUSTOMER'); setSendError(null); }}>{`Compartidos ${sharedCount}`}</button>
        {canSeeInternal && <button id={internalTabId} type="button" role="tab" aria-selected={mode === 'INTERNAL'} aria-controls={internalPanelId} className={mode === 'INTERNAL' ? 'is-active' : ''} onClick={() => { setMode('INTERNAL'); setSendError(null); }}>{`Notas internas ${internalCount}`}</button>}
      </div>
      <div id={mode === 'CUSTOMER' ? sharedPanelId : internalPanelId} role="tabpanel" aria-labelledby={mode === 'CUSTOMER' ? sharedTabId : internalTabId} className={`staff-messaging__panel${mode === 'INTERNAL' ? ' is-internal' : ''}`}>
        {nextCursor && <button type="button" className="staff-messaging__more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando mensajes…' : 'Ver mensajes anteriores'}</button>}
        {visibleMessages.length === 0 && <div className="staff-messaging__empty"><strong>{mode === 'CUSTOMER' ? 'Aún no hay mensajes compartidos.' : 'Aún no hay notas internas.'}</strong><span>{mode === 'CUSTOMER' ? 'Las respuestas de este hilo quedarán visibles para el cliente.' : 'Usa este espacio para coordinar detalles que no deben salir del equipo.'}</span></div>}
        {visibleMessages.length > 0 && <ol className="staff-messaging__list" aria-live="polite">
          {visibleMessages.map((message) => <li className={`staff-message${message.visibility === 'INTERNAL' ? ' staff-message--internal' : ''}`} key={message.id}>
            <div className="staff-message__meta"><strong>{message.sender?.type === 'CUSTOMER' ? 'Cliente' : message.sender?.displayName ?? 'Equipo OCPOOL'}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time><span>{message.visibility === 'CUSTOMER' ? 'Visible para cliente' : 'Sólo equipo'}</span></div>
            <p>{message.body}</p>
          </li>)}
        </ol>}
        {closed ? <div className="staff-messaging__closed" role="status"><strong>Conversación cerrada.</strong><span>El historial permanece disponible; reabre la conversación para continuar.</span></div> : canCompose ? <form className="staff-messaging__composer" onSubmit={sendMessage}>
          <label htmlFor={composerId}>{modeLabel}</label>
          <textarea id={composerId} value={draft} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => setDraft(event.target.value)} placeholder={mode === 'CUSTOMER' ? 'Escribe una actualización para el cliente…' : 'Registra una nota que sólo verá el equipo…'} rows={4} disabled={sending} />
          <div className="staff-messaging__composer-bottom"><span>{draft.length.toLocaleString('es-MX')} / {MAX_MESSAGE_LENGTH.toLocaleString('es-MX')} caracteres</span><button type="submit" className={`staff-button ${mode === 'INTERNAL' ? 'staff-button--copper' : 'staff-button--dark'}`} disabled={sending || !draft.trim()} aria-busy={sending}>{sending ? 'Guardando…' : mode === 'INTERNAL' ? 'Guardar nota' : 'Enviar mensaje'}</button></div>
          {sendError && <p className="staff-messaging__error" role="alert">{sendError}</p>}
        </form> : <div className="staff-messaging__locked" role="status"><strong>No tienes permiso para escribir aquí.</strong><span>Tu acceso actual permite consultar esta conversación.</span></div>}
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </>}
  </section>;
}
