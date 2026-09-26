'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ChevronRight, HardHat, X } from 'lucide-react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivatePagination } from '@/components/private/ui';
import { readApiResponse } from '@/lib/api-response-error';
import { formatDateTime } from '@/lib/format-date';
import { moneyLabel } from '@/lib/money';
import { relativeTimeLabel } from '@/lib/relative-time';
import { usePersistentState } from '@/lib/use-persistent-state';

type ProjectStatus = 'EN_TRANSICION' | 'COMPLETADO';
type ProjectsView = ProjectStatus | 'ALL';

type ProjectListItem = {
  id: string;
  folio: string;
  status: ProjectStatus;
  createdAt: string;
  completedAt: string | null;
  owner: { id: string; displayName: string } | null;
  client: { displayName: string };
  quoteRequest: { id: string; folio: string; projectType: string | null; location: string | null };
  acceptedTotal: { totalMinor: string; currencyCode: string };
  checklist: { total: number; completed: number };
};

type ListResponse = { items: ProjectListItem[]; page: number; pageSize: number; total: number; totalPages: number };

const VIEWS: ReadonlyArray<{ value: ProjectsView; label: string }> = [
  { value: 'EN_TRANSICION', label: 'En transición' },
  { value: 'COMPLETADO', label: 'Completados' },
  { value: 'ALL', label: 'Todos' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toLocaleUpperCase('es-MX');
}

export default function StaffProjectsPanel() {
  const [view, setView, viewHydrated] = usePersistentState<ProjectsView>('ocpool.staff.projects.view', 'EN_TRANSICION');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    if (!viewHydrated) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (view !== 'ALL') params.set('status', view);
        if (appliedSearch) params.set('query', appliedSearch);
        const response = await fetch(`/api/staff/projects?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const result = await readApiResponse<ListResponse>(response, 'No fue posible cargar los proyectos.');
        if (!result.ok) {
          if (result.kind === 'forbidden') setAccessDenied(true);
          throw new Error(result.message);
        }
        setAccessDenied(false);
        setData(result.data);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'No fue posible cargar los proyectos.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [appliedSearch, page, reloadKey, view, viewHydrated]);

  // Búsqueda instantánea al dejar de escribir; Enter la aplica al momento.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === appliedSearch) return;
    const timer = window.setTimeout(() => { setPage(1); setAppliedSearch(trimmed); }, 350);
    return () => window.clearTimeout(timer);
  }, [appliedSearch, searchInput]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setAppliedSearch(searchInput.trim()); };
  const applyView = (value: ProjectsView) => { if (value === view) return; setPage(1); setView(value); };
  const filtered = Boolean(appliedSearch) || view !== 'ALL';
  const resetFilters = () => { setSearchInput(''); setAppliedSearch(''); setPage(1); setView('ALL'); };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/staff" variant="quiet">Volver al dashboard</PrivateLinkButton></div>}>Necesitas un perfil autorizado para consultar proyectos.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const items = data?.items ?? [];

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />

      <div className="staff-content">
        <div className="staff-intro">
          <div><p className="staff-kicker">Después de la venta</p><h1>Proyectos</h1><p className="staff-intro__copy">Propuestas aceptadas en transición a obra: quién coordina el arranque, qué falta del checklist y cuánto se aceptó.</p></div>
          <div className="staff-intro__metric"><strong>{loading && !data ? '—' : data?.total ?? 0}</strong><span>{data?.total === 1 ? 'proyecto en vista' : 'proyectos en vista'}</span></div>
        </div>

        {error && <p className="staff-error" role="alert">{error} <button type="button" className="quotes-retry-link" onClick={() => setReloadKey((current) => current + 1)}>Reintentar</button></p>}

        <section className="projects-board" aria-label="Proyectos">
          <form className="projects-board__toolbar" onSubmit={submitSearch} role="search" aria-label="Filtrar proyectos">
            <div className="staff-views projects-board__views" role="group" aria-label="Estado del handoff">{VIEWS.map((option) => <button key={option.value} type="button" className={view === option.value ? 'is-selected' : undefined} aria-pressed={view === option.value} onClick={() => applyView(option.value)}>{option.label}</button>)}</div>
            <label className="projects-board__search"><span className="sr-only">Buscar proyecto</span><span className="staff-search"><input aria-label="Buscar proyecto" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Folio del proyecto, del expediente o cliente" maxLength={100} />{searchInput && <button type="button" className="staff-search__clear" aria-label="Limpiar búsqueda" onClick={() => setSearchInput('')}><X size={15} aria-hidden="true" /></button>}</span></label>
          </form>

          <div className="projects-board__list" aria-live="polite">
            {loading && !data && <div className="staff-list-placeholder"><span /><span /><span /></div>}
            {!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><HardHat size={20} /></span>
              {appliedSearch || view === 'COMPLETADO'
                ? <><h2>Ningún proyecto coincide.</h2><p>Prueba con otro folio o cliente, o revisa todos los estados.</p><button type="button" className="staff-button" onClick={resetFilters}>Ver todos los proyectos</button></>
                : view === 'EN_TRANSICION'
                  ? <><h2>No hay proyectos en transición.</h2><p>Cuando un cliente acepte una propuesta y se convierta en proyecto desde su documento comercial, aparecerá aquí.</p>{filtered && <button type="button" className="staff-button" onClick={resetFilters}>Ver todos los proyectos</button>}</>
                  : <><h2>Aún no hay proyectos.</h2><p>Se crean desde el documento comercial de una cotización aceptada.</p></>}
            </div>}
            {items.length > 0 && <ul className="projects-list">{items.map((item) => {
              const progress = item.checklist.total ? Math.round((item.checklist.completed / item.checklist.total) * 100) : 0;
              return <li key={item.id}>
                <Link className="project-row" href={`/staff/projects/${item.id}`}>
                  <span className="project-row__identity">
                    <span className="project-row__folio">{item.folio}<span className={`project-row__status project-row__status--${item.status === 'COMPLETADO' ? 'done' : 'active'}`}>{item.status === 'COMPLETADO' ? 'Completado' : 'En transición'}</span></span>
                    <strong>{item.client.displayName}</strong>
                    <small>{[item.quoteRequest.projectType, item.quoteRequest.location].filter(Boolean).join(' · ') || 'Proyecto'} · Expediente {item.quoteRequest.folio}</small>
                  </span>
                  <span className="project-row__owner">
                    {item.owner
                      ? <><span className="project-row__avatar" aria-hidden="true">{initialsOf(item.owner.displayName)}</span><span><small>Responsable</small><b>{item.owner.displayName}</b></span></>
                      : <em className="project-row__unassigned">Sin responsable</em>}
                  </span>
                  <span className="project-row__progress">
                    <small>{item.checklist.total ? `${item.checklist.completed} de ${item.checklist.total} tareas` : 'Sin checklist'}</small>
                    <span className="project-row__bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
                  </span>
                  <span className="project-row__total"><small>Aceptado</small><b>{moneyLabel(item.acceptedTotal.totalMinor, item.acceptedTotal.currencyCode)}</b></span>
                  <time className="project-row__date" dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{relativeTimeLabel(item.createdAt)}</time>
                  <ChevronRight className="project-row__go" size={18} aria-hidden="true" />
                </Link>
              </li>;
            })}</ul>}
          </div>
          {data && data.totalPages > 1 && <PrivatePagination page={data.page} totalPages={data.totalPages} disabled={loading} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />}
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
