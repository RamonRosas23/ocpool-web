'use client';

import { Bell, CheckCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { badgeCount, filterInbox, groupInboxByDay, type InboxFilter, type InboxNotification } from '@/lib/inbox-client';
import { useInbox } from './InboxProvider';
import NotificationItem from './NotificationItem';
import { useInboxActions } from './useInboxActions';

const STAFF_FILTERS: ReadonlyArray<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Sin leer' },
  { key: 'action', label: 'Requieren acción' },
];

export default function NotificationBell({ className }: Readonly<{ className?: string }>) {
  const inbox = useInbox();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>('all');
  // En teléfono el panel es una hoja fija justo debajo de la campana (el encabezado del portal ocupa dos renglones).
  const [panelTop, setPanelTop] = useState(72);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const refresh = inbox?.refresh;
  const markRead = inbox?.markRead;

  const openItem = (item: InboxNotification) => {
    if (!item.readAt) void markRead?.({ ids: [item.id] });
    setOpen(false);
  };
  const actionsFor = useInboxActions({ onOpen: openItem });

  useEffect(() => {
    if (!open) return undefined;
    void refresh?.();
    window.requestAnimationFrame(() => panelRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, refresh]);

  if (!inbox || !inbox.available) return null;
  const staff = inbox.surface === 'staff';
  const label = staff ? 'Notificaciones' : 'Novedades';
  const groups = groupInboxByDay(filterInbox(inbox.latest, staff ? filter : 'all'));

  const toggle = () => {
    if (!open) setPanelTop(Math.round((triggerRef.current?.getBoundingClientRect().bottom ?? 64) + 8));
    setOpen(!open);
  };

  return (
    <div className={['inbox-bell', staff ? 'inbox-bell--staff' : 'inbox-bell--portal', className].filter(Boolean).join(' ')} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="inbox-bell__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={inbox.unread > 0 ? `${label}, ${inbox.unread} sin leer` : label}
        onClick={toggle}
      >
        <Bell size={18} aria-hidden="true" />
        {!staff && <span className="inbox-bell__label">{label}</span>}
        {inbox.unread > 0 && <span className="inbox-bell__badge" aria-hidden="true">{badgeCount(inbox.unread)}</span>}
      </button>
      {open && (
        <div id={panelId} ref={panelRef} className="inbox-panel" role="dialog" aria-label={label} tabIndex={-1} style={{ '--inbox-panel-top': `${panelTop}px` } as CSSProperties}>
          <div className="inbox-panel__head">
            <strong>{label}</strong>
            <div className="inbox-panel__head-actions">
              {inbox.unread > 0 && <button type="button" className="inbox-panel__text-button" onClick={() => void inbox.markRead({ all: true })}><CheckCheck size={15} aria-hidden="true" />Marcar todo como leído</button>}
              <button type="button" className="inbox-panel__close" aria-label={`Cerrar ${label.toLowerCase()}`} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={16} aria-hidden="true" /></button>
            </div>
          </div>
          {staff && (
            <div className="inbox-filters" role="group" aria-label="Filtrar notificaciones">
              {STAFF_FILTERS.map((option) => (
                <button key={option.key} type="button" className="inbox-filter" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>
                  {option.label}{option.key === 'action' && inbox.actionRequired > 0 ? ` · ${inbox.actionRequired}` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="inbox-panel__body">
            {!inbox.loaded && <p className="inbox-empty">Consultando…</p>}
            {inbox.loaded && groups.length === 0 && (
              <div className="inbox-empty">
                <strong>{filter === 'action' ? 'Nada pendiente de tu parte.' : 'Todo al día.'}</strong>
                <span>{staff ? 'Te avisaremos aquí cuando pase algo en tus expedientes.' : 'Aquí verás las novedades de tus proyectos.'}</span>
              </div>
            )}
            {groups.map((group) => (
              <section key={group.key} className="inbox-group" aria-label={group.label}>
                <h3>{group.label}</h3>
                <ul>{group.items.map((item) => <NotificationItem key={item.id} item={item} onOpen={openItem} actions={staff ? actionsFor(item) : null} />)}</ul>
              </section>
            ))}
          </div>
          {staff && <div className="inbox-panel__foot"><Link href="/staff/notifications" onClick={() => setOpen(false)}>Ver todas</Link></div>}
        </div>
      )}
    </div>
  );
}
