'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { statusToneIcon } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';
import StaffFilesPanel, { type StaffFilesCapabilities } from '@/components/StaffFilesPanel';
import StaffMessagingPanel, { type StaffMessagingCapabilities } from '@/components/StaffMessagingPanel';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffTopNav from '@/components/StaffTopNav';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivatePagination, PrivateSelect } from '@/components/private/ui';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINE_LABELS,
} from '@/server/modules/quote-requests/domain';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/request-workspace-query';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';

const STATUS_LABELS: Record<string, string> = QUOTE_REQUEST_STATUS_LABELS;
const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
const INFORMATION_REQUEST_STATUS = 'INFORMACION_REQUERIDA';

// El servidor deja INFORMACION_REQUERIDA fuera de availableStatusTransitions a propósito:
// esa transición exige un mensaje al cliente y se resuelve con la acción dedicada
// "Solicitar información" (endpoint /request-information), no con el cambio de estado genérico.
// Cuando el servidor la habilita vía availableActions ('request.information'), la agregamos
// como una opción más del mismo selector "Siguiente estado" sin declarar nosotros la lista.
function withInformationRequestOption(availableStatusTransitions: string[], availableActions: string[]): string[] {
  if (!availableActions.includes('request.information') || availableStatusTransitions.includes(INFORMATION_REQUEST_STATUS)) {
    return availableStatusTransitions;
  }
  return [INFORMATION_REQUEST_STATUS, ...availableStatusTransitions];
}

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
  detail: { projectType: string; location: string; projectStage: string | null; dimensions: string | null; timeline: string | null; budgetRange: string | null } | null;
};

type RequestDetail = RequestSummary & {
  availableStatusTransitions: string[];
  availableActions: string[];
  contact: RequestSummary['contact'] & { roleTitle: string | null; status: string; user: { id: string; type: string; status: string } | null };
  detail: {
    id: string;
    projectType: string;
    location: string;
    budgetCents: string | null;
    currencyCode: string;
    dimensions: string | null;
    projectStage: string | null;
    timeline: string | null;
    budgetRange: string | null;
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
type StaffRequestCapabilities = StaffMessagingCapabilities & StaffFilesCapabilities & { identityUsersManage: boolean; requestsAssign: boolean; requestsReadGlobal: boolean };
type ListResponse = { items: RequestSummary[]; page: number; pageSize: number; total: number; totalPages: number };

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function StatusPill({ status }: { status: string }) {
  const ToneIcon = statusToneIcon(status);
  return <span className={`staff-status-pill staff-status-pill--${status.toLowerCase()}`}><ToneIcon size={11} aria-hidden="true" />{statusLabel(status)}</span>;
}

function qualificationLabel(value: string | null | undefined, labels: Record<string, string>): string {
  return value ? labels[value] ?? value : 'No indicado';
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
  const [messagingCapabilities, setMessagingCapabilities] = useState<StaffRequestCapabilities>({
    messagingRead: false,
    messagingSend: false,
    messagingInternalNotesRead: false,
    messagingInternalNotesWrite: false,
    messagingManage: false,
    filesRead: false,
    filesUpload: false,
    filesDownload: false,
    filesDelete: false,
    filesInternalRead: false,
    filesManage: false,
    identityUsersManage: false,
    requestsAssign: false,
    requestsReadGlobal: false,
  });
  const [messagingCapabilitiesLoaded, setMessagingCapabilitiesLoaded] = useState(false);
  const [customerAccessBusy, setCustomerAccessBusy] = useState(false);
  const deepLinkedIdRef = useRef<string | null>(null);

  const loadList = useCallback(async (currentPage: number, currentStatus: string, query: string) => {
    setLoadingList(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' });
      if (currentStatus) params.set('status', currentStatus);
      if (query) params.set('query', query);
      const response = await fetch(`/api/staff/quote-requests?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponse<ListResponse>(response, 'No fue posible cargar el inbox.');
      if (!result.ok) {
        setAccessDenied(result.kind === 'forbidden');
        setError(result.message);
        setItems([]);
        setSelected(null);
        return;
      }
      const data = result.data;
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(data.totalPages, 1));
      setAccessDenied(false);
      setSelectedId((current) => {
        // Un expediente abierto por deep link (ej. desde el dashboard) se conserva la primera vez
        // aunque no esté en la página actual de la lista; loadDetail lo trae por su cuenta.
        if (deepLinkedIdRef.current && current === deepLinkedIdRef.current) { deepLinkedIdRef.current = null; return current; }
        return current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null;
      });
    } catch (caught) {
      setAccessDenied(false);
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el inbox.');
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
      const data = await readApiResponseOrThrow<RequestDetail>(response, 'No fue posible cargar el expediente.');
      setSelected(data);
      setAssignmentId(data.currentAssignee?.id ?? '');
      setNextStatus(withInformationRequestOption(data.availableStatusTransitions, data.availableActions)[0] ?? '');
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
    const requestFromUrl = new URLSearchParams(window.location.search).get('request');
    if (requestFromUrl) { deepLinkedIdRef.current = requestFromUrl; setSelectedId(requestFromUrl); }
  }, []);

  useEffect(() => {
    const loadAssignees = async () => {
      if (!messagingCapabilitiesLoaded || !messagingCapabilities.requestsAssign) {
        setAssignees([]);
        return;
      }
      try {
        const response = await fetch('/api/staff/quote-requests/assignees', { credentials: 'include', cache: 'no-store' });
        const data = await readApiResponseOrThrow<{ items: Assignee[] }>(response, 'No fue posible cargar responsables disponibles.');
        setAssignees(data.items);
      } catch {
        // The inbox remains useful in read-only mode when assignment is not permitted.
      }
    };
    void loadAssignees();
  }, [messagingCapabilitiesLoaded, messagingCapabilities.requestsAssign, messagingCapabilities.requestsReadGlobal]);

  useEffect(() => {
    const loadCapabilities = async () => {
      try {
        const response = await fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store' });
        const data = await readApiResponseOrThrow<StaffRequestCapabilities>(response, 'No fue posible validar los permisos.');
        setMessagingCapabilities(data);
      } catch {
        // The conversation remains inaccessible in the UI if capabilities cannot be resolved.
      } finally {
        setMessagingCapabilitiesLoaded(true);
      }
    };
    void loadCapabilities();
  }, []);

  const nextStatuses = useMemo(() => selected ? withInformationRequestOption(selected.availableStatusTransitions, selected.availableActions) : [], [selected]);

  const refreshCurrent = async () => {
    await loadList(page, statusFilter, appliedSearch);
    if (selectedId) await loadDetail(selectedId);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  };

  const assign = async (targetId = assignmentId) => {
    if (!selected || !targetId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignedToId: targetId, reason: assignmentReason || undefined }),
      });
      await readApiResponseOrThrow(response, 'No fue posible asignar la solicitud.');
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
    const isInformationRequest = nextStatus === INFORMATION_REQUEST_STATUS;
    if (isInformationRequest && !statusReason.trim()) {
      setError('Escribe el mensaje que recibirá el cliente para solicitar información.');
      setNotice(null);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // INFORMACION_REQUERIDA no se resuelve con el cambio de estado genérico: el backend exige
      // enlazar un mensaje al cliente (endpoint dedicado), así que reutilizamos el mismo campo de
      // motivo como el mensaje a enviar y llamamos a la acción "Solicitar información" en su lugar.
      const response = isInformationRequest
        ? await fetch(`/api/staff/quote-requests/${selected.id}/request-information`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: statusReason.trim(), idempotencyKey: getOrCreateIdempotencyKey(null, 'request-information') }),
        })
        : await fetch(`/api/staff/quote-requests/${selected.id}/status`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toStatus: nextStatus, reason: statusReason || undefined }),
        });
      await readApiResponseOrThrow(response, 'No fue posible actualizar el estado.');
      setNotice('Estado actualizado.');
      setStatusReason('');
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el estado.');
    } finally {
      setSaving(false);
    }
  };

  const inviteCustomerAccess = async () => {
    if (!selected || customerAccessBusy) return;
    setCustomerAccessBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/customer-access`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const result = await readApiResponseOrThrow<{ status: 'INVITED' | 'ALREADY_PENDING' | 'ALREADY_ACTIVE' }>(response, 'No fue posible habilitar el portal del cliente.');
      setNotice(result.status === 'INVITED' ? 'Portal habilitado. Se envió un enlace de un solo uso al correo del cliente.' : result.status === 'ALREADY_PENDING' ? 'Ya existe una invitación vigente. El cliente debe revisar su correo.' : 'La cuenta ya estaba activa. Se envió un nuevo enlace de un solo uso al cliente.');
      await loadDetail(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible habilitar el portal del cliente.');
    } finally {
      setCustomerAccessBusy(false);
    }
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Inicia sesión con una cuenta de empleado autorizada para consultar solicitudes.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <header className="staff-header">
        <WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" />
        <StaffTopNav />
        <div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Bandeja de solicitudes</div></div>
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
              <PrivateSelect id="requests-status-filter" label="Estado" value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }} options={STATUS_OPTIONS.map((status) => ({ value: status, label: statusLabel(status) }))} placeholder="Todos los estados" />
              <button className="staff-button staff-button--filter" type="submit">Aplicar filtros</button>
            </form>

            <div className="staff-inbox__head"><span>{loadingList ? 'Actualizando…' : `${items.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
            <div className="staff-request-list" aria-live="polite">
              {loadingList && <div className="staff-list-placeholder"><span /><span /><span /></div>}
              {!loadingList && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>No hay solicitudes aquí.</h2><p>Prueba con otro estado o término de búsqueda.</p></div>}
              {!loadingList && items.map((item) => { const RowStatusIcon = statusToneIcon(item.status); return <button className={`staff-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><span className={`staff-status-dot staff-status-dot--${item.status.toLowerCase()}`} role="img" aria-label={`Estado: ${statusLabel(item.status)}`}><RowStatusIcon size={10} aria-hidden="true" /></span><span className="staff-request-row__main"><strong>{item.folio}</strong><span>{item.client.displayName}</span><small>{item.detail?.projectType ?? 'Sin detalle'} · {item.detail?.location ?? 'Sin ubicación'}</small></span><span className="staff-request-row__date">{formatDateTime(item.createdAt)}</span></button>; })}
            </div>
            <PrivatePagination page={page} totalPages={totalPages} disabled={loadingList} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />
          </aside>

          <section className="staff-detail" aria-label="Detalle de solicitud">
            {loadingDetail && <div className="staff-detail__loading"><span /><span /><span /></div>}
            {!loadingDetail && !selected && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Selecciona un expediente.</h2><p>El detalle y las acciones operativas aparecerán aquí.</p></div>}
            {!loadingDetail && selected && <>
              <div className="staff-detail__header"><div><p className="staff-kicker">{selected.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{selected.folio}</h2><p className="staff-detail__date">Recibida el {formatDateTime(selected.createdAt)}</p>{selected.availableActions.includes('quote.open') && <Link className="staff-button staff-button--dark staff-detail__quote-link" href={`/staff/quotes?request=${selected.id}`}>Abrir constructor</Link>}</div><StatusPill status={selected.status} /></div>
              <div className="staff-detail__grid"><section className="staff-detail__section"><p className="staff-section-label">Contacto</p><h3>{selected.contact.displayName}</h3><a href={`mailto:${selected.contact.email}`}>{selected.contact.email}</a>{selected.contact.phone && <a href={`tel:${selected.contact.phone}`}>{selected.contact.phone}</a>}<div className="staff-contact-access"><span className={`staff-contact-access__status staff-contact-access__status--${selected.contact.user?.status?.toLowerCase() ?? 'none'}`}>{selected.contact.user?.status === 'ACTIVE' ? 'Portal habilitado' : selected.contact.user?.status === 'INVITED' ? 'Invitación pendiente' : 'Portal sin habilitar'}</span>{messagingCapabilities.identityUsersManage && <button className="staff-button staff-button--dark" type="button" disabled={customerAccessBusy} onClick={() => void inviteCustomerAccess()}>{customerAccessBusy ? 'Enviando…' : selected.contact.user?.status === 'ACTIVE' ? 'Enviar nuevo acceso' : selected.contact.user?.status === 'INVITED' ? 'Reenviar acceso' : 'Habilitar portal'}</button>}</div></section><section className="staff-detail__section"><p className="staff-section-label">Proyecto</p><h3>{selected.detail?.projectType ?? 'Sin tipo de proyecto'}</h3><p>{selected.detail?.location ?? 'Sin ubicación'}</p>{selected.detail?.dimensions && <p>{selected.detail.dimensions}</p>}<dl className="staff-qualification"><div><dt>Etapa</dt><dd>{qualificationLabel(selected.detail?.projectStage, QUOTE_REQUEST_PROJECT_STAGE_LABELS)}</dd></div><div><dt>Inicio</dt><dd>{qualificationLabel(selected.detail?.timeline, QUOTE_REQUEST_TIMELINE_LABELS)}</dd></div><div><dt>Presupuesto</dt><dd>{qualificationLabel(selected.detail?.budgetRange, QUOTE_REQUEST_BUDGET_RANGE_LABELS)}</dd></div></dl></section></div>
              <section className="staff-detail__section staff-detail__section--description"><p className="staff-section-label">Alcance compartido</p><p className="staff-description">{selected.detail?.description ?? 'Sin descripción.'}</p></section>
              <div className="staff-actions-grid">{messagingCapabilitiesLoaded && messagingCapabilities.requestsAssign && <section className="staff-action"><p className="staff-section-label">Responsable</p>{messagingCapabilities.requestsReadGlobal ? <><PrivateSelect id="requests-assignment" label="Responsable" hideLabel required value={assignmentId} onValueChange={setAssignmentId} options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))} placeholder="Sin responsable" /><input value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} placeholder="Motivo opcional" maxLength={500} /><button className="staff-button staff-button--dark" type="button" disabled={saving || !assignmentId} onClick={() => void assign()}>Guardar responsable</button></> : selected.currentAssignee ? <p>Esta solicitud está tomada por ti o por el responsable asignado.</p> : <><p>Las solicitudes sin responsable aparecen disponibles para que las tomes.</p><button className="staff-button staff-button--dark" type="button" disabled={saving || !assignees[0]} onClick={() => void assign(assignees[0]?.id)}>Tomar solicitud</button></>}</section>}<section className="staff-action"><p className="staff-section-label">Siguiente estado</p><PrivateSelect id="requests-next-status" label="Siguiente estado" hideLabel required value={nextStatus} onValueChange={setNextStatus} options={nextStatuses.map((status) => ({ value: status, label: statusLabel(status) }))} placeholder={nextStatuses.length ? 'Selecciona un estado' : 'Sin transiciones disponibles'} disabled={nextStatuses.length === 0} />{nextStatus === INFORMATION_REQUEST_STATUS && <p className="staff-action__hint">Este texto lo recibirá el cliente tal cual — no es una nota interna.</p>}<input value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder={nextStatus === INFORMATION_REQUEST_STATUS ? 'Mensaje para el cliente (obligatorio)' : 'Motivo opcional'} maxLength={500} required={nextStatus === INFORMATION_REQUEST_STATUS} /><button className="staff-button staff-button--copper" type="button" disabled={saving || !nextStatus} onClick={() => void transition()}>Actualizar estado</button></section></div>
              {messagingCapabilitiesLoaded && <StaffFilesPanel requestId={selected.id} capabilities={messagingCapabilities} />}
              {messagingCapabilitiesLoaded && <StaffMessagingPanel requestId={selected.id} capabilities={messagingCapabilities} />}
              <section className="staff-history"><div><p className="staff-section-label">Actividad</p><h3>Historial del expediente</h3></div><ol>{selected.statusHistory.map((entry) => <li key={entry.id}><span className="staff-history__line" aria-hidden="true" /><div><strong>{statusLabel(entry.toStatus)}</strong><p>{entry.reason ?? 'Cambio registrado'} · {entry.changedBy?.displayName ?? 'Sistema'}</p><time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time></div></li>)}</ol></section>
            </>}
          </section>
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
