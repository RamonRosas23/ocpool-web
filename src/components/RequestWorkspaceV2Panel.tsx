'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import {
  PrivateBlockingState,
  PrivateButton,
  PrivateEmptyState,
  PrivateSelect,
  PrivateSkeleton,
  PrivateSurfaceRoot,
  PrivateTextField,
} from '@/components/private/ui';
import { QUOTE_REQUEST_STATUSES, type QuoteRequestStatus } from '@/server/modules/quote-requests/domain';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import {
  normalizeRequestWorkspaceQuery,
  QUOTE_REQUEST_STATUS_LABELS,
  REQUEST_WORKSPACE_AGES,
  REQUEST_WORKSPACE_SORTS,
  REQUEST_WORKSPACE_VIEWS,
  serializeRequestWorkspaceQuery,
  type RequestWorkspaceAge,
  type RequestWorkspaceQuery,
  type RequestWorkspaceSort,
  type RequestWorkspaceView,
} from '@/lib/request-workspace-query';
import { requestWorkspaceScrollStorageKey } from '@/lib/request-workspace-scroll';

const VIEW_LABELS: Record<RequestWorkspaceView, string> = {
  all: 'Todas las solicitudes',
  mine: 'Mis solicitudes',
  unassigned: 'Sin responsable',
};

const AGE_LABELS: Record<RequestWorkspaceAge, string> = {
  all: 'Cualquier antigüedad',
  '0-1': '0 a 1 día',
  '2-3': '2 a 3 días',
  '4-7': '4 a 7 días',
  '8-14': '8 a 14 días',
  '15-30': '15 a 30 días',
  '31+': 'Más de 30 días',
};

const SORT_LABELS: Record<RequestWorkspaceSort, string> = {
  newest: 'Más recientes',
  oldest: 'Más antiguas',
  updated: 'Actualizadas recientemente',
  stale: 'Sin actualización',
};

type RequestSummary = {
  id: string;
  folio: string;
  origin: string;
  status: QuoteRequestStatus;
  createdAt: string;
  updatedAt: string;
  client: { id: string; displayName: string; status: string };
  detail: { projectType: string; location: string; projectStage: string | null; dimensions: string | null; timeline: string | null; budgetRange: string | null } | null;
  currentAssignee: { id: string; displayName: string; email: string } | null;
};

type ListResponse = { items: RequestSummary[]; page: number; pageSize: number; total: number; totalPages: number };
type AssigneeResponse = { items: Array<{ id: string; displayName: string; email: string }> };
type WorkspaceCapabilitiesResponse = { requestsCreate: boolean; requestsAssign: boolean; requestsReadGlobal: boolean };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function queryHref(query: RequestWorkspaceQuery): string {
  const params = serializeRequestWorkspaceQuery(query).toString();
  return params ? `?${params}` : '';
}

export default function RequestWorkspaceV2Panel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => normalizeRequestWorkspaceQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const serializedQuery = useMemo(() => serializeRequestWorkspaceQuery(query).toString(), [query]);
  const scrollStorageKey = useMemo(() => requestWorkspaceScrollStorageKey(serializedQuery), [serializedQuery]);
  const [searchInput, setSearchInput] = useState(query.query);
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [assignees, setAssignees] = useState<AssigneeResponse['items']>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [canReadGlobal, setCanReadGlobal] = useState(false);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  useEffect(() => setSearchInput(query.query), [query.query]);

  useEffect(() => {
    if (!canAssign || !canReadGlobal) {
      setAssignees([]);
      return;
    }
    const controller = new AbortController();
    fetch('/api/staff/quote-requests/assignees', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponseOrThrow<AssigneeResponse>(response, 'No fue posible cargar responsables disponibles.'))
      .then((data) => setAssignees(data.items))
      .catch(() => { if (!controller.signal.aborted) setAssignees([]); });
    return () => controller.abort();
  }, [canAssign, canReadGlobal]);

  useEffect(() => {
    const saveScrollPosition = () => {
      try {
        window.sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
      } catch {
        // Session storage can be unavailable in privacy-restricted browsers.
      }
    };
    const restoreScrollPosition = () => {
      try {
        const savedPosition = Number(window.sessionStorage.getItem(scrollStorageKey));
        if (Number.isFinite(savedPosition) && savedPosition > 0) window.scrollTo(0, savedPosition);
      } catch {
        // Session storage can be unavailable in privacy-restricted browsers.
      }
    };

    window.addEventListener('scroll', saveScrollPosition, { passive: true });
    if (!loading) {
      const frame = window.requestAnimationFrame(restoreScrollPosition);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener('scroll', saveScrollPosition);
      };
    }
    return () => window.removeEventListener('scroll', saveScrollPosition);
  }, [loading, scrollStorageKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponseOrThrow<WorkspaceCapabilitiesResponse>(response, 'No fue posible validar los permisos disponibles.'))
      .then((data) => {
        setCanCreate(data.requestsCreate);
        setCanAssign(data.requestsAssign);
        setCanReadGlobal(data.requestsReadGlobal);
        setCapabilitiesLoaded(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCanCreate(false);
        setCanAssign(false);
        setCanReadGlobal(false);
        setCapabilitiesLoaded(true);
      });
    return () => controller.abort();
  }, []);

  const updateQuery = useCallback((changes: Partial<RequestWorkspaceQuery>) => {
    const nextQuery = { ...query, ...changes };
    router.replace(`${pathname}${queryHref(nextQuery)}`, { scroll: false });
  }, [pathname, query, router]);

  useEffect(() => {
    if (!capabilitiesLoaded || canReadGlobal || query.view !== 'all') return;
    updateQuery({ view: 'mine', assigneeId: null, page: 1 });
  }, [canReadGlobal, capabilitiesLoaded, query.view, updateQuery]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    const requestUrl = serializedQuery ? `/api/staff/quote-requests?${serializedQuery}` : '/api/staff/quote-requests';
    fetch(requestUrl, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponse<ListResponse>(response, 'No fue posible cargar las solicitudes.'))
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setItems(result.data.items);
          setTotal(result.data.total);
          setTotalPages(Math.max(result.data.totalPages, 1));
          return;
        }
        setAccessDenied(result.kind === 'forbidden');
        setError(result.message);
        setItems([]);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'No fue posible cargar las solicitudes.');
        setItems([]);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retryToken, serializedQuery]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateQuery({ query: searchInput.trim(), page: 1 });
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="request-workspace-v2 request-workspace-v2--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido.">Inicia sesión con una cuenta de empleado autorizada para consultar solicitudes.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const viewOptions = (canReadGlobal ? REQUEST_WORKSPACE_VIEWS : REQUEST_WORKSPACE_VIEWS.filter((value) => value !== 'all')).map((value) => ({ value, label: VIEW_LABELS[value] }));
  const defaultView = canReadGlobal ? 'all' : 'mine';
  const hasFilters = Boolean(query.query || query.stage || query.view !== defaultView || query.age !== 'all' || query.sort !== 'newest' || query.assigneeId);

  return (
    <PrivateSurfaceRoot className="request-workspace-v2">
      <div className="request-workspace-v2__content">
        <header className="request-workspace-v2__header">
          <div><p className="private-kicker">Centro de trabajo</p><h1>Solicitudes</h1><p>Prioriza la admisión comercial con filtros que permanecen en la URL y un expediente que puedes retomar sin perder contexto.</p></div>
          {canCreate && <Link className="private-button private-button--primary" href="/staff/requests/new">Nueva solicitud</Link>}
          <div className="request-workspace-v2__metric"><strong>{total}</strong><span>{hasFilters ? 'resultados filtrados' : 'expedientes en vista'}</span></div>
        </header>
        <form className="request-workspace-v2__filters" onSubmit={submitSearch}>
          <PrivateTextField id="request-workspace-search" label="Buscar" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Folio, cliente o correo" maxLength={100} />
          <PrivateSelect id="request-workspace-view" label="Vista" value={capabilitiesLoaded && !canReadGlobal && query.view === 'all' ? 'mine' : query.view} options={viewOptions} onValueChange={(value) => { const nextView = normalizeRequestWorkspaceQuery({ view: value }).view; updateQuery({ view: nextView, assigneeId: nextView === 'all' ? query.assigneeId : null, page: 1 }); }} />
          <PrivateSelect id="request-workspace-stage" label="Etapa" value={query.stage ?? ''} options={QUOTE_REQUEST_STATUSES.map((value) => ({ value, label: QUOTE_REQUEST_STATUS_LABELS[value] }))} onValueChange={(value) => updateQuery({ stage: normalizeRequestWorkspaceQuery({ stage: value }).stage, page: 1 })} placeholder="Todas las etapas" />
          <PrivateSelect id="request-workspace-age" label="Antigüedad" value={query.age} options={REQUEST_WORKSPACE_AGES.map((value) => ({ value, label: AGE_LABELS[value] }))} onValueChange={(value) => updateQuery({ age: normalizeRequestWorkspaceQuery({ age: value }).age, page: 1 })} />
          <PrivateSelect id="request-workspace-sort" label="Orden" value={query.sort} options={REQUEST_WORKSPACE_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }))} onValueChange={(value) => updateQuery({ sort: normalizeRequestWorkspaceQuery({ sort: value }).sort, page: 1 })} />
          {canReadGlobal && assignees.length > 0 && <PrivateSelect id="request-workspace-assignee" label="Responsable" value={query.assigneeId ?? ''} options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))} onValueChange={(value) => updateQuery({ assigneeId: normalizeRequestWorkspaceQuery({ assignee: value }).assigneeId, view: 'all', page: 1 })} placeholder="Cualquier responsable" disabled={query.view !== 'all'} />}
          <PrivateButton type="submit" variant="primary">Aplicar búsqueda</PrivateButton>
          {hasFilters && <PrivateButton type="button" variant="quiet" onClick={() => { setSearchInput(''); updateQuery({ view: defaultView, query: '', stage: null, assigneeId: null, age: 'all', sort: 'newest', page: 1 }); }}>Limpiar</PrivateButton>}
        </form>
        {error && <PrivateBlockingState title="No fue posible cargar las solicitudes." onRetry={() => setRetryToken((current) => current + 1)}>{error}</PrivateBlockingState>}
        <section className="request-workspace-v2__results" aria-label="Cola de solicitudes">
          <div className="request-workspace-v2__results-head"><div><p className="private-kicker">Admisión</p><h2>{loading ? 'Actualizando resultados' : `${items.length} solicitudes`}</h2></div><span>Página {query.page} de {totalPages}</span></div>
          {loading && <PrivateSkeleton label="Cargando solicitudes" />}
          {!loading && !error && items.length === 0 && <PrivateEmptyState title={hasFilters ? 'No hay coincidencias.' : 'Aún no hay solicitudes.'}>{hasFilters ? 'Prueba con otro término o ajusta los filtros de la cola.' : 'Las nuevas solicitudes aparecerán aquí cuando sean recibidas.'}</PrivateEmptyState>}
          {!loading && items.length > 0 && <ul className="request-workspace-v2__list">{items.map((item) => <li key={item.id}><Link className="request-workspace-v2__row" href={`/staff/requests/${encodeURIComponent(item.id)}${queryHref({ ...query, tab: 'summary' })}`}><span className={`request-workspace-v2__status request-workspace-v2__status--${item.status.toLowerCase()}`} aria-hidden="true" /><span className="request-workspace-v2__row-main"><strong>{item.folio}</strong><span>{item.client.displayName}</span><small>{item.detail?.projectType ?? 'Sin tipo de proyecto'} · {item.detail?.location ?? 'Sin ubicación'}</small></span><span className="request-workspace-v2__row-meta"><strong>{item.currentAssignee?.displayName ?? 'Sin responsable'}</strong><small>{QUOTE_REQUEST_STATUS_LABELS[item.status]}</small><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></span><span className="request-workspace-v2__row-action" aria-hidden="true">Abrir →</span></Link></li>)}</ul>}
          {!loading && <nav className="request-workspace-v2__pagination" aria-label="Paginación de solicitudes"><button type="button" disabled={query.page <= 1} onClick={() => updateQuery({ page: query.page - 1 })}>Anterior</button><span aria-live="polite">{query.page} / {totalPages}</span><button type="button" disabled={query.page >= totalPages} onClick={() => updateQuery({ page: query.page + 1 })}>Siguiente</button></nav>}
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
