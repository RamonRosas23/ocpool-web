'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Compass, Inbox, X } from 'lucide-react';
import { statusToneIcon } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';
import { relativeTimeLabel } from '@/lib/relative-time';
import { getRequestWorkspacePrimaryAction } from '@/lib/request-workspace-primary-action';
import { usePersistentState } from '@/lib/use-persistent-state';
import StaffFilesPanel, { type StaffFilesCapabilities } from '@/components/StaffFilesPanel';
import StaffMessagingPanel, { type StaffMessagingCapabilities } from '@/components/StaffMessagingPanel';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivatePagination, PrivateSelect } from '@/components/private/ui';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINE_LABELS,
  type QuoteRequestStatus,
} from '@/server/modules/quote-requests/domain';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/request-workspace-query';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';

const STATUS_LABELS: Record<string, string> = QUOTE_REQUEST_STATUS_LABELS;
const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
const INFORMATION_REQUEST_STATUS = 'INFORMACION_REQUERIDA';

type InboxView = 'all' | 'mine' | 'unassigned';
const INBOX_VIEWS: ReadonlyArray<{ value: InboxView; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'mine', label: 'Mías' },
  { value: 'unassigned', label: 'Sin asignar' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toLocaleUpperCase('es-MX');
}

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
type StaffRequestCapabilities = StaffMessagingCapabilities & StaffFilesCapabilities & { identityUsersManage: boolean; requestsAssign: boolean; requestsReadGlobal: boolean; requestsStatusUpdate: boolean };
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
  const [statusFilter, setStatusFilter, statusFilterHydrated] = usePersistentState('ocpool.staff.requests.statusFilter', '');
  // El estado se aplicaba de inmediato al elegirlo mientras la búsqueda de texto, en el mismo
  // formulario, esperaba a "Aplicar filtros" -- dos temporizaciones distintas para dos controles
  // del mismo filtro. Se unifican: statusFilterDraft es lo que el select muestra mientras se edita,
  // y sólo se copia al valor aplicado/persistido (statusFilter) cuando se envía el formulario,
  // igual que ya ocurre con la búsqueda. Se siembra ajustando el estado durante el render (no en un
  // efecto aparte): un efecto propio llegaría un render después de que `usePersistentState` ya
  // hidrató, así que el valor todavía transicionaría sobre el `PrivateSelect` ya montado con la key
  // "hydrated" -- exactamente el eco espurio de Radix que ya se corrigió en otro panel esta misma
  // sesión. Ajustar durante el render evita el salto: para cuando la key cambia a "hydrated", el
  // borrador ya tiene el valor final y el select nunca ve la transición.
  const [statusFilterDraft, setStatusFilterDraft] = useState('');
  const statusFilterDraftSeeded = useRef(false);
  if (statusFilterHydrated && !statusFilterDraftSeeded.current) {
    statusFilterDraftSeeded.current = true;
    if (statusFilterDraft !== statusFilter) setStatusFilterDraft(statusFilter);
  }
  const [searchInput, setSearchInput] = useState('');
  const [view, setView, viewHydrated] = usePersistentState<InboxView>('ocpool.staff.requests.view', 'all');
  const statusReasonRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
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
    requestsStatusUpdate: false,
  });
  const [messagingCapabilitiesLoaded, setMessagingCapabilitiesLoaded] = useState(false);
  const [customerAccessBusy, setCustomerAccessBusy] = useState(false);
  const deepLinkedIdRef = useRef<string | null>(null);
  const loadListGenerationRef = useRef(0);
  const loadDetailGenerationRef = useRef(0);

  const loadList = useCallback(async (currentPage: number, currentStatus: string, query: string, currentView: InboxView, keepSelection = false) => {
    // UX audit fix: cambiar de filtro/página rápido (o volver a escribir en el buscador) podía dejar
    // que la respuesta obsoleta de una combinación anterior llegara después que la vigente y
    // sobreescribiera en silencio la lista/paginación/selección con datos que ya no corresponden a
    // los filtros mostrados.
    const generation = (loadListGenerationRef.current += 1);
    setLoadingList(true);
    setError(null);
    try {
      // "Mías" y "Sin asignar" usan el modo de bandeja de trabajo del mismo endpoint (el que ya usa
      // el dashboard para sus colas); "Todas" conserva la consulta original sin cambios.
      const params = currentView === 'all'
        ? new URLSearchParams({ page: String(currentPage), pageSize: '20' })
        : new URLSearchParams({ view: currentView, page: String(currentPage), sort: 'newest' });
      if (currentStatus) params.set(currentView === 'all' ? 'status' : 'stage', currentStatus);
      if (query) params.set('query', query);
      const response = await fetch(`/api/staff/quote-requests?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponse<ListResponse>(response, 'No fue posible cargar el inbox.');
      if (loadListGenerationRef.current !== generation) return;
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
        // Tras una acción sobre el expediente abierto (tomarlo, cambiar su estado) puede salir de la
        // vista actual (p. ej. "Sin asignar"); se conserva para ver el resultado en vez de saltar a otro.
        if (keepSelection && current) return current;
        return current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null;
      });
    } catch (caught) {
      if (loadListGenerationRef.current !== generation) return;
      setAccessDenied(false);
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el inbox.');
      setItems([]);
      setSelected(null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    // UX audit fix: hacer clic rápido entre dos expedientes de la lista podía dejar que la respuesta
    // obsoleta del primero llegara después que la del segundo y sobreescribiera en silencio el panel
    // de detalle (y por tanto el destino real de "Guardar responsable"/"Actualizar estado") con datos
    // de un expediente distinto al resaltado como seleccionado.
    const generation = (loadDetailGenerationRef.current += 1);
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${id}`, { credentials: 'include', cache: 'no-store' });
      const data = await readApiResponseOrThrow<RequestDetail>(response, 'No fue posible cargar el expediente.');
      if (loadDetailGenerationRef.current !== generation) return;
      setSelected(data);
      setAssignmentId(data.currentAssignee?.id ?? '');
      // Sin preselección: antes quedaba elegido el primer estado disponible -- a menudo "Información
      // requerida", que exige un mensaje al cliente -- como si fuera lo recomendado. La recomendación
      // real ahora vive en la tarjeta "Siguiente paso".
      setNextStatus('');
      setStatusReason('');
    } catch (caught) {
      if (loadDetailGenerationRef.current !== generation) return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el expediente.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!statusFilterHydrated || !viewHydrated) return;
    void loadList(page, statusFilter, appliedSearch, view);
  }, [appliedSearch, loadList, page, statusFilter, statusFilterHydrated, view, viewHydrated]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) void loadDetail(selectedId);
    else setSelected(null);
  }, [loadDetail, selectedId]);

  // El expediente abierto vive en la URL (?request=): recargar conserva la selección, el enlace se
  // puede compartir y el buscador global (Ctrl+K) puede abrir otro sin remontar la página.
  const searchParams = useSearchParams();
  const requestParam = searchParams.get('request');
  useEffect(() => {
    if (requestParam && requestParam !== selectedIdRef.current) { deepLinkedIdRef.current = requestParam; setSelectedId(requestParam); }
  }, [requestParam]);

  // ?view=mine|unassigned (p. ej. "Ver las N solicitudes" de las colas del dashboard) abre la bandeja
  // en esa vista; se consume y se quita de la URL para que la vista siga siendo del usuario.
  const viewParam = searchParams.get('view');
  useEffect(() => {
    if (!viewHydrated || !viewParam) return;
    if (INBOX_VIEWS.some((option) => option.value === viewParam) && viewParam !== view) { setPage(1); setView(viewParam as InboxView); }
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }, [setView, view, viewHydrated, viewParam]);

  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('request') === selectedId) return;
    url.searchParams.set('request', selectedId);
    window.history.replaceState(null, '', url);
  }, [selectedId]);

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
      } catch (caught) {
        // Sin esto, un fallo de red aquí dejaba `messagingCapabilities` en su default (todo en
        // falso) sin ninguna señal -- StaffFilesPanel/StaffMessagingPanel entonces mostraban "tu rol
        // no tiene permiso", indistinguible de una restricción real deliberada.
        setError(caught instanceof Error ? caught.message : 'No fue posible validar los permisos.');
      } finally {
        setMessagingCapabilitiesLoaded(true);
      }
    };
    void loadCapabilities();
  }, []);

  const nextStatuses = useMemo(() => selected ? withInformationRequestOption(selected.availableStatusTransitions, selected.availableActions) : [], [selected]);

  const refreshCurrent = async () => {
    await loadList(page, statusFilter, appliedSearch, view, true);
    if (selectedId) await loadDetail(selectedId);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  };

  // Filtros instantáneos: la búsqueda se aplica sola al dejar de escribir y el estado/vista al
  // elegirlos, sin un botón "Aplicar" que olvidar (Enter sigue aplicando la búsqueda al momento).
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === appliedSearch) return;
    const timer = window.setTimeout(() => { setPage(1); setAppliedSearch(trimmed); }, 350);
    return () => window.clearTimeout(timer);
  }, [appliedSearch, searchInput]);

  const applyStatusFilter = (value: string) => {
    setStatusFilterDraft(value);
    if (value === statusFilter) return;
    setPage(1);
    setStatusFilter(value);
  };

  const applyView = (value: InboxView) => {
    if (value === view) return;
    setPage(1);
    setView(value);
  };

  const filtersActive = Boolean(statusFilter || appliedSearch || view !== 'all');
  const resetFilters = () => {
    setSearchInput('');
    setAppliedSearch('');
    setStatusFilterDraft('');
    setStatusFilter('');
    setView('all');
    setPage(1);
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

  const transition = async (targetStatus: string = nextStatus, reasonText: string = statusReason) => {
    if (!selected || !targetStatus) return;
    const isInformationRequest = targetStatus === INFORMATION_REQUEST_STATUS;
    if (isInformationRequest && !reasonText.trim()) {
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
          body: JSON.stringify({ message: reasonText.trim(), idempotencyKey: getOrCreateIdempotencyKey(null, 'request-information') }),
        })
        : await fetch(`/api/staff/quote-requests/${selected.id}/status`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toStatus: targetStatus, reason: reasonText || undefined }),
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

  // Las confirmaciones flotan sobre el detalle (ver CSS) y se retiran solas; los errores se quedan
  // hasta la siguiente acción.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const takeRequest = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/take`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      await readApiResponseOrThrow(response, 'No fue posible tomar la solicitud.');
      setNotice('Ahora eres responsable de este expediente.');
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible tomar la solicitud.');
    } finally {
      setSaving(false);
    }
  };

  // "Siguiente paso": el mismo resolvedor (probado) de la bandeja V2 decide la acción recomendada a
  // partir de lo que el servidor ya permite; aquí sólo se ofrece a un clic y se explica.
  const missingInformation = useMemo(() => selected ? [
    ...(selected.contact.phone ? [] : ['teléfono']),
    ...(selected.detail?.dimensions ? [] : ['medidas']),
    ...(selected.detail?.timeline ? [] : ['fecha de inicio']),
    ...(selected.detail?.budgetRange ? [] : ['presupuesto']),
  ] : [], [selected]);

  const primaryAction = useMemo(() => {
    if (!selected || !messagingCapabilitiesLoaded) return null;
    return getRequestWorkspacePrimaryAction({
      availableActions: selected.availableActions,
      availableStatusTransitions: selected.availableStatusTransitions as QuoteRequestStatus[],
      hasMissingInformation: missingInformation.length > 0,
      capabilities: { requestsAssign: messagingCapabilities.requestsAssign, requestsStatusUpdate: messagingCapabilities.requestsStatusUpdate, messagingSend: messagingCapabilities.messagingSend },
    });
  }, [messagingCapabilities, messagingCapabilitiesLoaded, missingInformation, selected]);

  const activatePrimaryAction = () => {
    if (!primaryAction) return;
    if (primaryAction.kind === 'take') { void takeRequest(); return; }
    if (primaryAction.kind === 'status') { void transition(primaryAction.targetStatus, ''); return; }
    if (primaryAction.kind === 'information') {
      // Solicitar información necesita el mensaje para el cliente: se prepara el formulario de estado
      // y se lleva el foco ahí en vez de enviar algo a ciegas.
      setNextStatus(INFORMATION_REQUEST_STATUS);
      window.requestAnimationFrame(() => {
        statusReasonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        statusReasonRef.current?.focus({ preventScroll: true });
      });
    }
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Inicia sesión con una cuenta de empleado autorizada para consultar solicitudes.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />

      <div className="staff-content">
        <div className="staff-intro">
          <div><p className="staff-kicker">Trabajo comercial</p><h1>Solicitudes</h1><p className="staff-intro__copy">Revisa el alcance, asigna responsables y mueve cada expediente con trazabilidad.</p></div>
          <div className="staff-intro__metric"><strong>{loadingList && items.length === 0 ? '—' : total}</strong><span>{total === 1 ? 'expediente en vista' : 'expedientes en vista'}</span></div>
        </div>

        {notice && <p className="staff-notice" role="status">{notice}</p>}
        {error && <p className="staff-error" role="alert">{error}</p>}

        <section className="staff-workspace" aria-label="Inbox de solicitudes">
          <aside className="staff-inbox">
            <form className="staff-filters" onSubmit={submitSearch} role="search" aria-label="Filtrar solicitudes">
              <div className="staff-views" role="group" aria-label="Vista de la bandeja">{INBOX_VIEWS.map((option) => <button key={option.value} type="button" className={view === option.value ? 'is-selected' : undefined} aria-pressed={view === option.value} onClick={() => applyView(option.value)}>{option.label}</button>)}</div>
              <label><span>Buscar</span><span className="staff-search"><input aria-label="Buscar" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Folio, cliente o correo" maxLength={100} />{searchInput && <button type="button" className="staff-search__clear" aria-label="Limpiar búsqueda" onClick={() => setSearchInput('')}><X size={15} aria-hidden="true" /></button>}</span></label>
              <PrivateSelect key={statusFilterHydrated ? 'hydrated' : 'pending'} id="requests-status-filter" optionalHint={false} label="Estado" value={statusFilterDraft} onValueChange={applyStatusFilter} options={STATUS_OPTIONS.map((status) => ({ value: status, label: statusLabel(status) }))} placeholder="Todos los estados" />
            </form>

            <div className="staff-inbox__head"><span>{loadingList ? 'Actualizando…' : `Mostrando ${items.length} de ${total}`}</span>{filtersActive && <button type="button" className="staff-inbox__reset" onClick={resetFilters}>Limpiar filtros</button>}</div>
            <div className="staff-request-list" aria-live="polite">
              {loadingList && <div className="staff-list-placeholder"><span /><span /><span /></div>}
              {!loadingList && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span>{view === 'mine' && !statusFilter && !appliedSearch
                ? <><h2>Aún no tienes expedientes a tu cargo.</h2><p>Toma uno de la vista «Sin asignar» para empezar a trabajarlo.</p><button type="button" className="staff-button" onClick={() => applyView('unassigned')}>Ver sin asignar</button></>
                : view === 'unassigned' && !statusFilter && !appliedSearch
                  ? <><h2>Todo tiene responsable.</h2><p>No hay expedientes esperando a que alguien los tome.</p></>
                  : <><h2>No hay solicitudes aquí.</h2><p>{filtersActive ? 'Ningún expediente coincide con estos filtros.' : 'Cuando llegue una solicitud nueva aparecerá aquí.'}</p>{filtersActive && <button type="button" className="staff-button" onClick={resetFilters}>Limpiar filtros</button>}</>}</div>}
              {!loadingList && items.map((item) => { const RowStatusIcon = statusToneIcon(item.status); return <button className={`staff-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><span className={`staff-status-dot staff-status-dot--${item.status.toLowerCase()}`} role="img" aria-label={`Estado: ${statusLabel(item.status)}`}><RowStatusIcon size={10} aria-hidden="true" /></span><span className="staff-request-row__main"><strong>{item.folio}</strong><span>{item.client.displayName}</span><small>{item.detail?.projectType ?? 'Sin detalle'} · {item.detail?.location ?? 'Sin ubicación'}</small>{!item.currentAssignee && <em className="staff-request-row__flag">Sin asignar</em>}</span><time className="staff-request-row__date" dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{relativeTimeLabel(item.createdAt)}</time></button>; })}
            </div>
            <PrivatePagination page={page} totalPages={totalPages} disabled={loadingList} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />
          </aside>

          <section className="staff-detail" aria-label="Detalle de solicitud">
            {(loadingDetail || (loadingList && !selected)) && <div className="staff-detail__loading"><span /><span /><span /></div>}
            {!loadingDetail && !loadingList && !selected && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Selecciona un expediente.</h2><p>El detalle y las acciones operativas aparecerán aquí.</p></div>}
            {!loadingDetail && selected && <>
              <div className="staff-detail__header"><div><p className="staff-kicker">{selected.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{selected.folio}</h2><p className="staff-detail__date">Recibida el {formatDateTime(selected.createdAt)}</p>{selected.availableActions.includes('quote.open') && primaryAction?.kind !== 'quote' && <Link className="staff-button staff-detail__quote-link" href={`/staff/quotes?request=${selected.id}`}>Abrir constructor</Link>}</div><StatusPill status={selected.status} /></div>
              {primaryAction && <section className="staff-next-step" aria-labelledby="staff-next-step-title"><span className="staff-next-step__icon" aria-hidden="true"><Compass size={20} /></span><div className="staff-next-step__body"><p className="staff-section-label">Siguiente paso</p><h3 id="staff-next-step-title">{primaryAction.description}</h3>{primaryAction.kind === 'information' && missingInformation.length > 0 && <p className="staff-next-step__missing">Faltan: {missingInformation.join(', ')}.</p>}</div>{primaryAction.kind === 'quote' ? <Link className="staff-button staff-button--dark" href={`/staff/quotes?request=${selected.id}`}>{primaryAction.label}<ArrowRight size={16} aria-hidden="true" /></Link> : <button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={activatePrimaryAction}>{primaryAction.label}<ArrowRight size={16} aria-hidden="true" /></button>}</section>}
              <div className="staff-detail__grid"><section className="staff-detail__section"><p className="staff-section-label">Contacto</p><h3>{selected.contact.displayName}</h3><a href={`mailto:${selected.contact.email}`}>{selected.contact.email}</a>{selected.contact.phone && <a href={`tel:${selected.contact.phone}`}>{selected.contact.phone}</a>}<div className="staff-contact-access"><span className={`staff-contact-access__status staff-contact-access__status--${selected.contact.user?.status?.toLowerCase() ?? 'none'}`}>{selected.contact.user?.status === 'ACTIVE' ? 'Portal habilitado' : selected.contact.user?.status === 'INVITED' ? 'Invitación pendiente' : 'Portal sin habilitar'}</span>{messagingCapabilities.identityUsersManage && <button className="staff-button staff-button--dark" type="button" disabled={customerAccessBusy} onClick={() => void inviteCustomerAccess()}>{customerAccessBusy ? 'Enviando…' : selected.contact.user?.status === 'ACTIVE' ? 'Enviar nuevo acceso' : selected.contact.user?.status === 'INVITED' ? 'Reenviar acceso' : 'Habilitar portal'}</button>}</div></section><section className="staff-detail__section"><p className="staff-section-label">Proyecto</p><h3>{selected.detail?.projectType ?? 'Sin tipo de proyecto'}</h3><p>{selected.detail?.location ?? 'Sin ubicación'}</p>{selected.detail?.dimensions && <p>{selected.detail.dimensions}</p>}<dl className="staff-qualification"><div><dt>Etapa</dt><dd>{qualificationLabel(selected.detail?.projectStage, QUOTE_REQUEST_PROJECT_STAGE_LABELS)}</dd></div><div><dt>Inicio</dt><dd>{qualificationLabel(selected.detail?.timeline, QUOTE_REQUEST_TIMELINE_LABELS)}</dd></div><div><dt>Presupuesto</dt><dd>{qualificationLabel(selected.detail?.budgetRange, QUOTE_REQUEST_BUDGET_RANGE_LABELS)}</dd></div></dl></section></div>
              <section className="staff-detail__section staff-detail__section--description"><p className="staff-section-label">Alcance compartido</p><p className="staff-description">{selected.detail?.description ?? 'Sin descripción.'}</p></section>
              <div className="staff-actions-grid">{messagingCapabilitiesLoaded && messagingCapabilities.requestsAssign && <section className="staff-action"><p className="staff-section-label">Responsable</p>{messagingCapabilities.requestsReadGlobal ? <><PrivateSelect id="requests-assignment" label="Responsable" hideLabel required value={assignmentId} onValueChange={setAssignmentId} options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))} placeholder="Sin responsable" /><input aria-label="Motivo del cambio de responsable (opcional)" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} placeholder="Motivo opcional" maxLength={500} /><button className="staff-button staff-button--dark" type="button" disabled={saving || !assignmentId} onClick={() => void assign()}>Guardar responsable</button></> : selected.currentAssignee ? <p className="staff-action__owner"><span className="staff-action__avatar" aria-hidden="true">{initialsOf(selected.currentAssignee.displayName)}</span><span><strong>{selected.currentAssignee.displayName}{selected.availableActions.includes('request.taken') ? ' (tú)' : ''}</strong><small>Responsable del expediente</small></span></p> : <><p>Nadie ha tomado este expediente todavía.</p>{primaryAction?.kind !== 'take' && <button className="staff-button staff-button--dark" type="button" disabled={saving || !selected.availableActions.includes('request.take')} onClick={() => void takeRequest()}>Tomar solicitud</button>}</>}</section>}<section className="staff-action"><p className="staff-section-label">Siguiente estado</p><PrivateSelect id="requests-next-status" label="Siguiente estado" hideLabel required value={nextStatus} onValueChange={setNextStatus} options={nextStatuses.map((status) => ({ value: status, label: statusLabel(status) }))} placeholder={nextStatuses.length ? 'Selecciona un estado' : 'Sin transiciones disponibles'} disabled={nextStatuses.length === 0} />{nextStatus === INFORMATION_REQUEST_STATUS && <p className="staff-action__hint">Este texto lo recibirá el cliente tal cual — no es una nota interna.</p>}<input ref={statusReasonRef} aria-label={nextStatus === INFORMATION_REQUEST_STATUS ? 'Mensaje para el cliente' : 'Motivo del cambio de estado (opcional)'} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder={nextStatus === INFORMATION_REQUEST_STATUS ? 'Mensaje para el cliente (obligatorio)' : 'Motivo opcional'} maxLength={500} required={nextStatus === INFORMATION_REQUEST_STATUS} /><button className="staff-button staff-button--copper" type="button" disabled={saving || !nextStatus} onClick={() => void transition()}>Actualizar estado</button></section></div>
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
