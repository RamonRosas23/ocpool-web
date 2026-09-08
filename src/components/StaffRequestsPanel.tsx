'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

const STATUS_LABELS: Record<string, string> = {
  RECIBIDA: 'Recibida',
  EN_REVISION: 'En revisión',
  INFORMACION_REQUERIDA: 'Información requerida',
  EN_ELABORACION: 'En elaboración',
  COTIZACION_DISPONIBLE: 'Cotización disponible',
  EN_NEGOCIACION: 'En negociación',
  PENDIENTE_DE_APROBACION: 'Pendiente de aprobación',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
  CONVERTIDA_EN_PROYECTO: 'Convertida en proyecto',
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
const NEXT_STATUS_OPTIONS: Record<string, string[]> = {
  RECIBIDA: ['EN_REVISION'],
  EN_REVISION: ['INFORMACION_REQUERIDA', 'EN_ELABORACION', 'RECHAZADA'],
  INFORMACION_REQUERIDA: ['EN_REVISION', 'EN_ELABORACION', 'RECHAZADA'],
  EN_ELABORACION: ['INFORMACION_REQUERIDA', 'RECHAZADA'],
  COTIZACION_DISPONIBLE: ['EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'RECHAZADA', 'VENCIDA'],
  EN_NEGOCIACION: ['EN_ELABORACION', 'PENDIENTE_DE_APROBACION', 'RECHAZADA', 'VENCIDA'],
  PENDIENTE_DE_APROBACION: ['ACEPTADA', 'RECHAZADA'],
  ACEPTADA: ['CONVERTIDA_EN_PROYECTO'],
  RECHAZADA: [],
  VENCIDA: [],
  CONVERTIDA_EN_PROYECTO: [],
};

type RequestSummary = {
  id: string;
  folio: string;
  origin: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  client: { id: string; displayName: string; status: string };
  contact: { id: string; displayName: string; email: string; phone: string | null };
  currentAssignee: { id: string; displayName: string; email: string } | null;
  detail: { projectType: string; location: string } | null;
};

type RequestDetail = RequestSummary & {
  contact: RequestSummary['contact'] & { roleTitle: string | null; status: string };
  detail: {
    id: string;
    projectType: string;
    location: string;
    budgetCents: string | null;
    currencyCode: string;
    dimensions: string | null;
    description: string;
    consentAt: string;
  } | null;
  assignments: Array<{
    id: string;
    reason: string | null;
    assignedAt: string;
    unassignedAt: string | null;
    assignedTo: { id: string; displayName: string; email: string };
    assignedBy: { id: string; displayName: string };
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
    changedBy: { id: string; displayName: string } | null;
  }>;
};

type Assignee = { id: string; displayName: string; email: string };
type ListResponse = { items: RequestSummary[]; page: number; pageSize: number; total: number; totalPages: number };
type ErrorResponse = { error?: { message?: string } };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? 'No fue posible completar la operación.');
  }
  return data as T;
}

export default function StaffRequestsPanel() {
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const loadList = useCallback(async (currentPage: number, currentStatus: string, query: string) => {
    setLoadingList(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' });
      if (currentStatus) params.set('status', currentStatus);
      if (query) params.set('query', query);
      const response = await fetch(`/api/staff/quote-requests?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<ListResponse>(response);
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(data.totalPages, 1));
      setAccessDenied(false);
      setSelectedId((current) => current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el inbox.';
      setAccessDenied(message.includes('autenticada') || message.includes('permisos'));
      setError(message);
      setItems([]);
      setSelected(null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${id}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<RequestDetail>(response);
      setSelected(data);
      setAssignmentId(data.currentAssignee?.id ?? '');
      setNextStatus(NEXT_STATUS_OPTIONS[data.status]?.[0] ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el expediente.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadList(page, statusFilter, appliedSearch);
  }, [appliedSearch, loadList, page, statusFilter]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setSelected(null);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const loadAssignees = async () => {
      try {
        const response = await fetch('/api/staff/quote-requests/assignees', { credentials: 'include', cache: 'no-store' });
        const data = await readResponse<{ items: Assignee[] }>(response);
        setAssignees(data.items);
      } catch {
        // The inbox remains useful in read-only mode when assignment is not permitted.
      }
    };
    void loadAssignees();
  }, []);

  const nextStatuses = useMemo(() => selected ? NEXT_STATUS_OPTIONS[selected.status] ?? [] : [], [selected]);

  const refreshCurrent = async () => {
    await loadList(page, statusFilter, appliedSearch);
    if (selectedId) await loadDetail(selectedId);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  };

  const assign = async () => {
    if (!selected || !assignmentId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignedToId: assignmentId, reason: assignmentReason || undefined }),
      });
      await readResponse(response);
      setNotice('Responsable actualizado.');
      setAssignmentReason('');
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible asignar la solicitud.');
    } finally {
      setSaving(false);
    }
  };

  const transition = async () => {
    if (!selected || !nextStatus) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toStatus: nextStatus, reason: statusReason || undefined }),
      });
      await readResponse(response);
      setNotice('Estado actualizado.');
      setStatusReason('');
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el estado.');
    } finally {
      setSaving(false);
    }
  };

  if (accessDenied) {
    return <main className="staff-shell staff-shell--restricted"><section className="staff-empty"><span className="staff-empty__mark">OC</span><p className="staff-kicker">Área interna</p><h1>Acceso restringido.</h1><p>Inicia sesión con una cuenta de empleado autorizada para consultar solicitudes.</p><Link className="staff-button staff-button--dark" href="/">Volver al sitio</Link></section></main>;
  }

  return (
    <main className="staff-shell">
      <header className="staff-header">
        <Link className="staff-brand" href="/" aria-label="OCPOOL, volver al sitio público"><span>OCPOOL</span><small>Operaciones comerciales</small></Link>
        <div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Bandeja de solicitudes</div>
      </header>

      <div className="staff-content">
        <div className="staff-intro">
          <div><p className="staff-kicker">Trabajo comercial</p><h1>Solicitudes</h1><p className="staff-intro__copy">Revisa el alcance, asigna responsables y mueve cada expediente con trazabilidad.</p></div>
          <div className="staff-intro__metric"><strong>{total}</strong><span>expedientes en vista</span></div>
        </div>

        {notice && <p className="staff-notice" role="status">{notice}</p>}
        {error && <p className="staff-error" role="alert">{error}</p>}

        <section className="staff-workspace" aria-label="Inbox de solicitudes">
          <aside className="staff-inbox">
            <form className="staff-filters" onSubmit={submitSearch}>
              <label><span>Buscar</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Folio, cliente o correo" maxLength={100} /></label>
              <label><span>Estado</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="">Todos los estados</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
              <button className="staff-button staff-button--filter" type="submit">Aplicar filtros</button>
            </form>

            <div className="staff-inbox__head"><span>{loadingList ? 'Actualizando…' : `${items.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
            <div className="staff-request-list" aria-live="polite">
              {loadingList && <div className="staff-list-placeholder"><span /><span /><span /></div>}
              {!loadingList && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark">—</span><h2>No hay solicitudes aquí.</h2><p>Prueba con otro estado o término de búsqueda.</p></div>}
              {!loadingList && items.map((item) => <button className={`staff-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><span className={`staff-status-dot staff-status-dot--${item.status.toLowerCase()}`} aria-hidden="true" /><span className="staff-request-row__main"><strong>{item.folio}</strong><span>{item.client.displayName}</span><small>{item.detail?.projectType ?? 'Sin detalle'} · {item.detail?.location ?? 'Sin ubicación'}</small></span><span className="staff-request-row__date">{formatDate(item.createdAt)}</span></button>)}
            </div>
            <div className="staff-pagination"><button type="button" className="staff-pagination__button" disabled={page <= 1 || loadingList} onClick={() => setPage((current) => current - 1)}>Anterior</button><button type="button" className="staff-pagination__button" disabled={page >= totalPages || loadingList} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div>
          </aside>

          <section className="staff-detail" aria-label="Detalle de solicitud">
            {loadingDetail && <div className="staff-detail__loading"><span /><span /><span /></div>}
            {!loadingDetail && !selected && <div className="staff-empty staff-empty--detail"><span className="staff-empty__mark">OC</span><h2>Selecciona un expediente.</h2><p>El detalle y las acciones operativas aparecerán aquí.</p></div>}
            {!loadingDetail && selected && <>
              <div className="staff-detail__header"><div><p className="staff-kicker">{selected.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{selected.folio}</h2><p className="staff-detail__date">Recibida el {formatDate(selected.createdAt)}</p>{['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'].includes(selected.status) && <Link className="staff-button staff-button--dark staff-detail__quote-link" href={`/staff/quotes?request=${selected.id}`}>Abrir constructor</Link>}</div><span className={`staff-status-pill staff-status-pill--${selected.status.toLowerCase()}`}>{statusLabel(selected.status)}</span></div>
              <div className="staff-detail__grid"><section className="staff-detail__section"><p className="staff-section-label">Contacto</p><h3>{selected.contact.displayName}</h3><a href={`mailto:${selected.contact.email}`}>{selected.contact.email}</a>{selected.contact.phone && <a href={`tel:${selected.contact.phone}`}>{selected.contact.phone}</a>}</section><section className="staff-detail__section"><p className="staff-section-label">Proyecto</p><h3>{selected.detail?.projectType ?? 'Sin tipo de proyecto'}</h3><p>{selected.detail?.location ?? 'Sin ubicación'}</p>{selected.detail?.dimensions && <p>{selected.detail.dimensions}</p>}</section></div>
              <section className="staff-detail__section staff-detail__section--description"><p className="staff-section-label">Alcance compartido</p><p className="staff-description">{selected.detail?.description ?? 'Sin descripción.'}</p></section>
              <div className="staff-actions-grid"><section className="staff-action"><p className="staff-section-label">Responsable</p><select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}><option value="">Sin responsable</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.displayName}</option>)}</select><input value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} placeholder="Motivo opcional" maxLength={500} /><button className="staff-button staff-button--dark" type="button" disabled={saving || !assignmentId} onClick={() => void assign()}>Guardar responsable</button></section><section className="staff-action"><p className="staff-section-label">Siguiente estado</p><select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} disabled={nextStatuses.length === 0}><option value="">{nextStatuses.length ? 'Selecciona un estado' : 'Sin transiciones disponibles'}</option>{nextStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select><input value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder="Motivo opcional" maxLength={500} /><button className="staff-button staff-button--copper" type="button" disabled={saving || !nextStatus} onClick={() => void transition()}>Actualizar estado</button></section></div>
              <section className="staff-history"><div><p className="staff-section-label">Actividad</p><h3>Historial del expediente</h3></div><ol>{selected.statusHistory.map((entry) => <li key={entry.id}><span className="staff-history__line" aria-hidden="true" /><div><strong>{statusLabel(entry.toStatus)}</strong><p>{entry.reason ?? 'Cambio registrado'} · {entry.changedBy?.displayName ?? 'Sistema'}</p><time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time></div></li>)}</ol></section>
            </>}
          </section>
        </section>
      </div>
    </main>
  );
}
