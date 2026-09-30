'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { InboxNotification } from '@/lib/inbox-client';
import { FLASH_HIGH_MS, visibleFlashes, type FlashItem } from '@/lib/inbox-flash';
import { inboxKindVisual } from './inbox-visuals';
import { useInbox } from './InboxProvider';
import { useInboxActions } from './useInboxActions';

const MOBILE_QUERY = '(max-width: 768px)';

function subscribeToViewport(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

type CardProps = Readonly<{
  item: FlashItem;
  onDismiss: (id: string) => void;
  onPause: (id: string, paused: boolean, remainingMs?: number) => void;
  onOpen: (notice: InboxNotification) => void;
  actions: ReactNode;
}>;

function FlashCard({ item, onDismiss, onPause, onOpen, actions }: CardProps) {
  const notice = item.notification;
  const visual = inboxKindVisual(notice.kind);
  const Icon = visual.icon;
  const urgent = notice.priority === 'URGENT';
  const startedAt = useRef(0);

  // HIGH se va sola a los 8 s, salvo con el puntero encima o el foco dentro (spec §5.3). URGENT se queda.
  useEffect(() => {
    if (item.remainingMs === null || item.paused) return undefined;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(notice.id), item.remainingMs);
    return () => window.clearTimeout(timer);
  }, [item.remainingMs, item.paused, notice.id, onDismiss]);

  const pause = (paused: boolean) => {
    if (item.remainingMs === null || item.paused === paused) return;
    onPause(notice.id, paused, paused ? Math.max(0, item.remainingMs - (Date.now() - startedAt.current)) : item.remainingMs);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pause(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss(notice.id);
  };

  return (
    <div className={`inbox-flash${urgent ? ' is-urgent' : ''}`} role={urgent ? 'alert' : 'status'} onMouseEnter={() => pause(true)} onMouseLeave={() => pause(false)} onFocus={() => pause(true)} onBlur={onBlur} onKeyDown={onKeyDown}>
      <span className={`inbox-item__icon inbox-item__icon--${visual.tone}`} aria-hidden="true"><Icon size={16} /></span>
      <div className="inbox-flash__main">
        <Link className="inbox-flash__link" href={notice.actionPath} onClick={() => onOpen(notice)}>
          <strong>{notice.title}</strong>
          {notice.body && <span>{notice.body}</span>}
        </Link>
        {actions && <div className="inbox-flash__actions">{actions}</div>}
      </div>
      <button type="button" className="inbox-flash__close" aria-label={`Cerrar aviso: ${notice.title}`} onClick={() => onDismiss(notice.id)}><X size={15} aria-hidden="true" /></button>
      {!urgent && <span className="inbox-flash__progress" style={{ animationDuration: `${FLASH_HIGH_MS}ms`, animationPlayState: item.paused ? 'paused' : 'running' }} aria-hidden="true" />}
    </div>
  );
}

/** Avisos al momento (spec §5.3), arriba a la derecha. Los toasts siguen confirmando acciones, abajo. */
export default function FlashAlertStack() {
  const inbox = useInbox();
  const mobile = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
  const markRead = inbox?.markRead;
  const dismiss = inbox?.dismissFlash;
  const openItem = (notice: InboxNotification) => {
    if (!notice.readAt) void markRead?.({ ids: [notice.id] });
    dismiss?.(notice.id);
  };
  const actionsFor = useInboxActions({ onOpen: openItem });
  if (!inbox?.available) return null;
  const { shown, overflow } = visibleFlashes(inbox.flashes, mobile);
  return (
    <section className="inbox-flashes" aria-label="Avisos al momento" aria-live="polite" aria-relevant="additions">
      {shown.map((item) => <FlashCard key={`${item.notification.id}:${item.revision}`} item={item} onDismiss={inbox.dismissFlash} onPause={inbox.pauseFlash} onOpen={openItem} actions={inbox.surface === 'staff' ? actionsFor(item.notification) : null} />)}
      {overflow > 0 && <button type="button" className="inbox-flashes__more" onClick={inbox.requestPanel}>y {overflow} más</button>}
    </section>
  );
}
