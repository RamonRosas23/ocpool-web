'use client';

import { CheckCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import NotificationItem from '@/components/inbox/NotificationItem';
import { useInbox } from '@/components/inbox/InboxProvider';
import { useInboxActions } from '@/components/inbox/useInboxActions';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateButton, PrivateLinkButton, PrivateSelect } from '@/components/private/ui';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import StaffHeader from '@/components/StaffHeader';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import { INBOX_CATEGORIES, INBOX_CATEGORY_LABELS, isInboxCategory, type InboxCategory } from '@/lib/inbox-categories';
import { fetchInboxPage, groupInboxByDay, InboxRequestError, isUnread, type InboxFilter, type InboxNotification } from '@/lib/inbox-client';

const FILTERS: ReadonlyArray<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Sin leer' },
  { key: 'action', label: 'Requieren acción' },
];
const CATEGORY_OPTIONS = INBOX_CATEGORIES.map((category) => ({ value: category, label: INBOX_CATEGORY_LABELS[category] }));
const SEARCH_DELAY_MS = 300;

type Query = Readonly<{ filter: InboxFilter; category: InboxCategory | ''; q: string }>;

export default function StaffInboxPanel() {
  const inbox = useInbox();
  const session = useStaffSession();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [category, setCategory] = useState<InboxCategory | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Buscar mientras se escribe, sin una consulta por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (query: Query, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchInboxPage(query.filter, null, signal, { category: query.category, q: query.q });
      if (signal?.aborted) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setRestricted(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (caught instanceof InboxRequestError && (caught.status === 401 || caught.status === 403)) setRestricted(true);
      // Sólo el mensaje del servidor es para personas; un error técnico del navegador no.
      setError(caught instanceof InboxRequestError ? caught.message : 'No fue posible consultar tus avisos.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load({ filter, category, q: search }, controller.signal);
    return () => controller.abort();
  }, [filter, category, search, reloadToken, load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchInboxPage(filter, nextCursor, undefined, { category, q: search });
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof InboxRequestError ? caught.message : 'No fue posible cargar más avisos.');
    } finally {
      setLoadingMore(false);
    }
  };

  const setReadLocally = (ids: readonly string[] | 'all', read: boolean) => {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => (ids === 'all' || ids.includes(item.id) ? { ...item, readAt: read ? item.readAt ?? now : null } : item)));
  };

  const markAll = async () => {
    setReadLocally('all', true);
    await inbox?.markRead({ all: true });
  };

  const openItem = (item: InboxNotification) => {
    if (item.readAt) return;
    setReadLocally([item.id], true);
    void inbox?.markRead({ ids: [item.id] });
  };

  const toggleRead = (item: InboxNotification) => {
    const read = !item.readAt;
    setReadLocally([item.id], read);
    void inbox?.markRead({ ids: [item.id], read });
  };

  const actionsFor = useInboxActions({ onOpen: openItem, onChanged: () => setReloadToken((token) => token + 1) });

  if (restricted) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton></div>}>Inicia sesión con tu cuenta del equipo para ver tus avisos.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const groups = groupInboxByDay(items);
  const narrowed = Boolean(category || search);
  const emptyTitle = narrowed ? 'Ningún aviso coincide.' : filter === 'action' ? 'Nada pendiente de tu parte.' : 'Todo al día.';
  const emptyCopy = narrowed ? 'Prueba con otro folio, otro nombre u otro tipo.' : 'Te avisaremos aquí cuando pase algo en tus expedientes.';

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />
      <div className="staff-content notices-page">
        <div className="staff-intro">
          <div><p className="staff-kicker">Tu actividad</p><h1>Notificaciones</h1><p className="staff-intro__copy">Lo que pasa en tus expedientes, en cuanto pasa.</p></div>
          {session?.capabilities.notificationsManage && <PrivateLinkButton href="/staff/notifications/deliveries" variant="quiet">Entregas de correo</PrivateLinkButton>}
        </div>
        <div className="notices-page__toolbar">
          <div className="inbox-filters" role="group" aria-label="Filtrar notificaciones">
            {FILTERS.map((option) => (
              <button key={option.key} type="button" className="inbox-filter" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>
                {option.label}{option.key === 'action' && inbox && inbox.actionRequired > 0 ? ` · ${inbox.actionRequired}` : ''}
              </button>
            ))}
          </div>
          {inbox && inbox.unread > 0 && <PrivateButton type="button" variant="quiet" onClick={() => void markAll()}><CheckCheck size={15} aria-hidden="true" /> Marcar todo como leído</PrivateButton>}
        </div>
        <div className="notices-page__filters" role="search" aria-label="Buscar en notificaciones">
          <label><span>Buscar</span><span className="staff-search"><input aria-label="Buscar" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Folio, cliente o texto del aviso" maxLength={60} />{searchInput && <button type="button" className="staff-search__clear" aria-label="Limpiar búsqueda" onClick={() => setSearchInput('')}><X size={15} aria-hidden="true" /></button>}</span></label>
          <PrivateSelect id="notices-category" optionalHint={false} label="Tipo" value={category} onValueChange={(value) => setCategory(isInboxCategory(value) ? value : '')} options={CATEGORY_OPTIONS} placeholder="Todos los tipos" />
        </div>
        {error && <p className="staff-error" role="alert">{error}</p>}
        <section className="notices-page__list" aria-live="polite" aria-busy={loading}>
          {loading && items.length === 0 && <p className="inbox-empty">Consultando…</p>}
          {!loading && items.length === 0 && <div className="inbox-empty"><strong>{emptyTitle}</strong><span>{emptyCopy}</span></div>}
          {groups.map((group) => (
            <section key={group.key} className="inbox-group" aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map((item) => (
                  <NotificationItem
                    key={item.id}
                    item={item}
                    onOpen={openItem}
                    actions={<>{actionsFor(item)}<button type="button" className="inbox-action inbox-action--quiet" aria-label={`${isUnread(item) ? 'Marcar como leída' : 'Marcar como no leída'}: ${item.title}`} onClick={() => toggleRead(item)}>{isUnread(item) ? 'Marcar como leída' : 'Marcar como no leída'}</button></>}
                  />
                ))}
              </ul>
            </section>
          ))}
          {nextCursor && <div className="notices-page__more"><PrivateButton type="button" variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>Ver más</PrivateButton></div>}
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
