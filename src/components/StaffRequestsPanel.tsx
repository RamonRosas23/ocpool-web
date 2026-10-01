'use client';

import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInbox, useInboxActiveContext } from '@/components/inbox/InboxProvider';
import { useCoalesced, useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Archive, ArrowRight, CircleCheck, Compass, Hourglass, Inbox, MessageSquareReply, Plus, X } from 'lucide-react';
import ExpedienteJourney from '@/components/staff/ExpedienteJourney';
import { statusToneIcon } from '@/lib/labels';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { relativeTimeLabel } from '@/lib/relative-time';
import { revealWhenStacked } from '@/lib/reveal-when-stacked';
import { getRequestWorkspacePrimaryAction } from '@/lib/request-workspace-primary-action';
import { usePersistentState } from '@/lib/use-persistent-state';
import { ANY_REQUEST } from '@/lib/realtime-subscriptions';
import StaffFilesPanel, { type StaffFilesCapabilities } from '@/components/StaffFilesPanel';
import StaffMessagingPanel, { type StaffMessagingCapabilities } from '@/components/StaffMessagingPanel';
import StaffRequestEditDialog, { type StaffRequestEditFocus } from '@/components/StaffRequestEditDialog';
import { CloseRequestDialog, FollowUpDialog, type FollowUpKind } from '@/components/StaffRequestLifecycleDialogs';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivatePagination, PrivateSelect } from '@/components/private/ui';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_INFORMATION_FIELDS,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINE_LABELS,
  WAITING_ON_CUSTOMER_DAYS,
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
type InformationField = (typeof QUOTE_REQUEST_INFORMATION_FIELDS)[number];

/** Lo que falta en el expediente, con la etiqueta corta de "Faltan: …" y cómo pedírselo al cliente. */
const INFORMATION_ASKS: ReadonlyArray<{ field: InformationField & StaffRequestEditFocus; label: string; ask: string }> = [
  { field: 'contact.phone', label: 'teléfono', ask: 'Un teléfono de contacto' },
  { field: 'detail.dimensions', label: 'medidas', ask: 'Medidas aproximadas del área disponible (largo y ancho)' },
  { field: 'detail.timeline', label: 'fecha de inicio', ask: 'La fecha aproximada en la que te gustaría iniciar' },
  { field: 'detail.budgetRange', label: 'presupuesto', ask: 'El presupuesto aproximado que tienes contemplado' },
];

/**
 * Borrador del mensaje para "Solicitar información", armado con lo que de verdad falta: antes el
 * campo llegaba vacío (y de una sola línea) aunque la tarjeta "Siguiente paso" ya lo enumeraba.
 */
// Cerrados o ya convertidos: "Sin asignar" en la lista sólo sería ruido (ya no esperan responsable).
const FINISHED_REQUEST_STATUSES: readonly string[] = ['RECHAZADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO'];

// Sin cambios de estado manuales disponibles, se explica cómo avanza el expediente en vez de mostrar un
// selector vacío y deshabilitado ("Sin transiciones disponibles").
function automaticStatusCopy(status: string): string {
  if (status === 'CONVERTIDA_EN_PROYECTO') return 'Venta cerrada: el expediente ya es un proyecto y su seguimiento sigue en Proyectos.';
  if (status === 'RECHAZADA' || status === 'VENCIDA') return 'Expediente cerrado. Si el cliente vuelve, usa «Reabrir expediente».';
  if (status === 'ACEPTADA' || status === 'PENDIENTE_DE_APROBACION') return 'El cliente aceptó: el estado cambia al convertir la venta en proyecto.';
  if (status === 'COTIZACION_DISPONIBLE' || status === 'EN_NEGOCIACION') return 'Avanza con la propuesta: cambia solo cuando el cliente la acepta o pide cambios, o si cierras el expediente.';
  return 'En esta etapa no hay cambios de estado manuales.';
}

/** Días completos desde la última vez que el equipo movió el tema con el cliente. */
function daysSince(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / 86_400_000);
}

function informationRequestDraft(contactName: string, folio: string, asks: readonly string[]): string {
  const greeting = contactName.trim() ? `Hola ${contactName.trim()},` : 'Hola,';
  if (asks.length === 0) return `${greeting} gracias por tu solicitud ${folio}. Para avanzar con tu cotización necesitamos confirmar algunos datos:\n\n• \n\n¿Nos los compartes respondiendo a este mensaje?`;
  return `${greeting} gracias por tu solicitud ${folio}. Para preparar tu cotización nos falta:\n\n${asks.map((ask) => `• ${ask}`).join('\n')}\n\n¿Nos compartes estos datos respondiendo a este mensaje? Si tienes fotos o planos del espacio, también nos ayudan mucho.`;
}

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
  /** Sólo en INFORMACION_REQUERIDA: cuándo se pidieron los datos y si el cliente ya respondió. */
  informationRequest?: { requestedAt: string | null; customerReplied: boolean } | null;
  /** Último mensaje compartido con el cliente y si lo escribió él (null: aún no hay conversación). */
  conversationPulse?: { lastSharedAt: string; lastFromCustomer: boolean } | null;
  /** La venta en una lectura: versión vigente y enviada, aceptación y proyecto. */
  quoteSummary?: {
    quoteId: string;
    current: { versionNumber: number; status: string; validUntil: string | null } | null;
    published: { versionNumber: number; status: string; validUntil: string | null; publishedAt: string | null } | null;
    acceptance: { id: string; acceptedAt: string; signerName: string } | null;
  } | null;
  project?: { id: string; folio: string; status: string } | null;
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
type StaffRequestCapabilities = StaffMessagingCapabilities & StaffFilesCapabilities & { identityUsersManage: boolean; requestsAssign: boolean; requestsReadGlobal: boolean; requestsStatusUpdate: boolean; requestsEdit?: boolean; requestsCreate?: boolean; projectsCreate?: boolean; quotesRead?: boolean };
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
  // Abrir el expediente da por vista su actividad; lo que pide una acción (aprobar, tomar) sigue pendiente.
  const inbox = useInbox();
  const openRequestId = selected?.id ?? null;
  const openUnread = openRequestId ? inbox?.unreadByRequest[openRequestId] ?? 0 : 0;
  const markInboxRead = inbox?.markRead;
  useInboxActiveContext(openRequestId);
  useEffect(() => {
    if (!inbox?.visible || !openRequestId || openUnread === 0 || !markInboxRead) return;
    void markInboxRead({ quoteRequestId: openRequestId, scope: 'activity' });
  }, [inbox?.visible, openRequestId, openUnread, markInboxRead]);
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
  const informationMessageRef = useRef<HTMLTextAreaElement>(null);
  // Último borrador propuesto: si el usuario cambia de estado sin tocarlo, se retira en vez de
  // quedarse como "motivo" de otro cambio.
  const informationDraftRef = useRef('');
  const selectedIdRef = useRef<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  // El salto al detalle (pantallas apiladas) espera a que cargue: con el esqueleto la página aún no
  // es lo bastante alta y el desplazamiento se quedaba corto.
  const revealPendingRef = useRef(false);
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
  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState<StaffRequestEditFocus | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpKind | null>(null);
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
  const selectedDataRef = useRef<RequestDetail | null>(null);
  const loadingDetailRef = useRef(false);
  const pendingLiveDetailRef = useRef<string | null>(null);
  const [listNews, setListNews] = useState(0);
  const requestListRef = useRef<HTMLDivElement>(null);
  useEffect(() => { selectedDataRef.current = selected; }, [selected]);
  useEffect(() => { loadingDetailRef.current = loadingDetail; }, [loadingDetail]);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (liveUpdatedAt === null) return undefined;
    const timer = window.setTimeout(() => setLiveUpdatedAt(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [liveUpdatedAt]);

  const loadList = useCallback(async (currentPage: number, currentStatus: string, query: string, currentView: InboxView, keepSelection = false, options: { silent?: boolean } = {}) => {
    // UX audit fix: cambiar de filtro/página rápido (o volver a escribir en el buscador) podía dejar
    // que la respuesta obsoleta de una combinación anterior llegara después que la vigente y
    // sobreescribiera en silencio la lista/paginación/selección con datos que ya no corresponden a
    // los filtros mostrados.
    const generation = (loadListGenerationRef.current += 1);
    if (!options.silent) {
      setLoadingList(true);
      setError(null);
    }
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
        if (options.silent) return;
        setAccessDenied(result.kind === 'forbidden');
        setError(result.message);
        setItems([]);
        setSelected(null);
        return;
      }
      const data = result.data;
      setListNews(0);
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(data.totalPages, 1));
      setAccessDenied(false);
      // Un expediente abierto por deep link (ej. desde el dashboard) se conserva la primera vez
      // aunque no esté en la página actual de la lista; loadDetail lo trae por su cuenta. La referencia
      // se consume fuera del updater: React puede invocarlo dos veces (StrictMode) y, al vaciarla dentro,
      // la segunda pasada soltaba la selección -- el detalle quedaba pintado pero sin recargarse tras
      // cerrar, reabrir o cualquier acción.
      const deepLinkedId = deepLinkedIdRef.current;
      deepLinkedIdRef.current = null;
      setSelectedId((current) => {
        if (deepLinkedId && current === deepLinkedId) return current;
        // Tras una acción sobre el expediente abierto (tomarlo, cambiar su estado) puede salir de la
        // vista actual (p. ej. "Sin asignar"); se conserva para ver el resultado en vez de saltar a otro.
        if (keepSelection && current) return current;
        return current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null;
      });
    } catch (caught) {
      if (loadListGenerationRef.current !== generation) return;
      if (options.silent) return;
      setAccessDenied(false);
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el inbox.');
      setItems([]);
      setSelected(null);
    } finally {
      if (loadListGenerationRef.current === generation) setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string, options: { silent?: boolean } = {}) => {
    // Una relectura en vivo no compite con una carga normal en curso (ésa ya trae lo último).
    if (options.silent && loadingDetailRef.current) {
      pendingLiveDetailRef.current = id;
      return;
    }
    // UX audit fix: hacer clic rápido entre dos expedientes de la lista podía dejar que la respuesta
    // obsoleta del primero llegara después que la del segundo y sobreescribiera en silencio el panel
    // de detalle (y por tanto el destino real de "Guardar responsable"/"Actualizar estado") con datos
    // de un expediente distinto al resaltado como seleccionado.
    const generation = (loadDetailGenerationRef.current += 1);
    if (!options.silent) {
      loadingDetailRef.current = true;
      setLoadingDetail(true);
      setError(null);
    }
    try {
      const response = await fetch(`/api/staff/quote-requests/${id}`, { credentials: 'include', cache: 'no-store' });
      const data = await readApiResponseOrThrow<RequestDetail>(response, 'No fue posible cargar el expediente.');
      if (loadDetailGenerationRef.current !== generation) return;
      if (options.silent) {
        // Refresca el expediente sin sobrescribir una selección de responsable que el equipo esté preparando.
        const previousAssignee = selectedDataRef.current?.currentAssignee?.id ?? '';
        setSelected(data);
        setAssignmentId((value) => value === previousAssignee ? data.currentAssignee?.id ?? '' : value);
        setLiveUpdatedAt(Date.now());
        return;
      }
      setSelected(data);
      setAssignmentId(data.currentAssignee?.id ?? '');
      // Sin preselección: antes quedaba elegido el primer estado disponible -- a menudo "Información
      // requerida", que exige un mensaje al cliente -- como si fuera lo recomendado. La recomendación
      // real ahora vive en la tarjeta "Siguiente paso".
      setNextStatus('');
      setStatusReason('');
      setEditOpen(false);
      setCloseOpen(false);
      setFollowUp(null);
    } catch (caught) {
      if (loadDetailGenerationRef.current !== generation || options.silent) return;
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el expediente.');
    } finally {
      if (!options.silent && loadDetailGenerationRef.current === generation) {
        loadingDetailRef.current = false;
        setLoadingDetail(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!statusFilterHydrated || !viewHydrated) return;
    void loadList(page, statusFilter, appliedSearch, view);
  }, [appliedSearch, loadList, page, statusFilter, statusFilterHydrated, view, viewHydrated]);

  const onListChange = useCoalesced(() => {
    if (page === 1 && (requestListRef.current?.scrollTop ?? 0) < 8) void loadList(page, statusFilter, appliedSearch, view, true, { silent: true });
    else setListNews((count) => count + 1);
  }, 800);
  useRealtimeRequest(ANY_REQUEST, ['created', 'status', 'assignment'], () => {
    onListChange();
  });

  useEffect(() => {
    if (!selected || loadingDetail || !revealPendingRef.current) return;
    revealPendingRef.current = false;
    revealWhenStacked(detailRef.current, '(max-width: 900px)');
  }, [loadingDetail, selected]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) void loadDetail(selectedId);
    else setSelected(null);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (loadingDetail || !pendingLiveDetailRef.current) return;
    const id = pendingLiveDetailRef.current;
    pendingLiveDetailRef.current = null;
    if (id === selectedIdRef.current) void loadDetail(id, { silent: true });
  }, [loadDetail, loadingDetail]);

  useRealtimeRequest(selected?.id ?? null, ['status', 'assignment', 'quote', 'project'], () => {
    const id = selectedIdRef.current;
    if (id) void loadDetail(id, { silent: true });
  });

  // El expediente abierto vive en la URL (?request=): recargar conserva la selección, el enlace se
  // puede compartir y el buscador global (Ctrl+K) puede abrir otro sin remontar la página.
  const searchParams = useSearchParams();
  const requestParam = searchParams.get('request');
  useEffect(() => {
    if (requestParam && requestParam !== selectedIdRef.current) { deepLinkedIdRef.current = requestParam; setSelectedId(requestParam); }
  }, [requestParam]);

  // ?created=1: se llega aquí justo después de "Nueva solicitud"; se confirma y se retira de la URL.
  const createdParam = searchParams.get('created');
  useEffect(() => {
    if (!createdParam) return;
    setNotice('Solicitud creada. Tómala o asígnala para empezar a trabajarla.');
    const url = new URL(window.location.href);
    url.searchParams.delete('created');
    window.history.replaceState(null, '', url);
  }, [createdParam]);

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

  // ?status=ESTADO (p. ej. una barra del pipeline del dashboard) abre la bandeja completa filtrada por
  // ese estado; igual que ?view=, se consume y se quita de la URL.
  const statusParam = searchParams.get('status');
  useEffect(() => {
    if (!statusFilterHydrated || !viewHydrated || !statusParam) return;
    if (STATUS_OPTIONS.includes(statusParam)) {
      setStatusFilterDraft(statusParam);
      setStatusFilter(statusParam);
      setView('all');
      setPage(1);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('status');
    window.history.replaceState(null, '', url);
  }, [setStatusFilter, setView, statusFilterHydrated, statusParam, viewHydrated]);

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

  // "Cerrar expediente" tiene su propio diálogo con motivo; no se ofrece además como estado suelto.
  const nextStatuses = useMemo(() => selected ? withInformationRequestOption(selected.availableStatusTransitions, selected.availableActions).filter((status) => status !== 'RECHAZADA') : [], [selected]);

  const refreshCurrent = async () => {
    await loadList(page, statusFilter, appliedSearch, view, true);
    if (selectedId) await loadDetail(selectedId);
  };

  const reopenRequest = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/reopen`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      const reopened = await readApiResponseOrThrow<{ toStatus: string }>(response, 'No fue posible reabrir el expediente.');
      setNotice(reopened.toStatus === 'EN_ELABORACION' ? 'Expediente reabierto: sigue en elaboración. Prepara la nueva versión en Cotizaciones.' : 'Expediente reabierto: vuelve a revisión.');
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible reabrir el expediente.');
    } finally {
      setSaving(false);
    }
  };

  // Aceptada sin proyecto (aceptaciones anteriores o si la creación automática falló): un clic crea el
  // proyecto de arranque, con quien lleva el expediente como responsable.
  const convertToProject = async () => {
    const acceptanceId = selected?.quoteSummary?.acceptance?.id;
    if (!acceptanceId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/staff/projects', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteAcceptanceId: acceptanceId }) });
      const created = await readApiResponseOrThrow<{ id: string; folio: string }>(response, 'No fue posible crear el proyecto.');
      setNotice(`Proyecto ${created.folio} creado. El arranque sigue en Proyectos.`);
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible crear el proyecto.');
    } finally {
      setSaving(false);
    }
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
          body: JSON.stringify({ message: reasonText.trim(), idempotencyKey: getOrCreateIdempotencyKey(null, 'request-information'), missingFields: missingAsks.map(({ field }) => field) }),
        })
        : await fetch(`/api/staff/quote-requests/${selected.id}/status`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toStatus: targetStatus, reason: reasonText || undefined }),
        });
      await readApiResponseOrThrow(response, 'No fue posible actualizar el estado.');
      setNotice(isInformationRequest ? 'Mensaje enviado. El expediente queda esperando la respuesta del cliente.' : 'Estado actualizado.');
      setStatusReason('');
      informationDraftRef.current = '';
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el estado.');
    } finally {
      setSaving(false);
    }
  };

  // El cliente respondió a la solicitud de información: se registra la revisión (vuelve a
  // "En revisión") con la acción dedicada, que además confirma en servidor que sí hay respuesta.
  const markInformationReviewed = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${selected.id}/mark-information-reviewed`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      await readApiResponseOrThrow(response, 'No fue posible continuar con la revisión.');
      setNotice('Listo: el expediente vuelve a revisión con la respuesta del cliente.');
      await refreshCurrent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible continuar con la revisión.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (focus: StaffRequestEditFocus | null = null) => {
    setEditFocus(focus);
    setEditOpen(true);
  };

  const scrollToConversation = () => {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    document.querySelector('.staff-messaging')?.scrollIntoView({ behavior, block: 'start' });
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
  const missingAsks = useMemo(() => selected ? INFORMATION_ASKS.filter(({ field }) => {
    if (field === 'contact.phone') return !selected.contact.phone;
    if (field === 'detail.dimensions') return !selected.detail?.dimensions;
    if (field === 'detail.timeline') return !selected.detail?.timeline;
    return !selected.detail?.budgetRange;
  }) : [], [selected]);
  const missingInformation = useMemo(() => missingAsks.map(({ label }) => label), [missingAsks]);

  const draftInformationRequest = () => {
    if (!selected) return '';
    const draft = informationRequestDraft(selected.contact.displayName, selected.folio, missingAsks.map(({ ask }) => ask));
    informationDraftRef.current = draft;
    return draft;
  };

  // Elegir "Información requerida" propone el borrador (si el campo está vacío); salir de ahí sin
  // haberlo editado lo retira.
  const selectNextStatus = (value: string) => {
    setNextStatus(value);
    if (value === INFORMATION_REQUEST_STATUS) {
      if (!statusReason.trim()) setStatusReason(draftInformationRequest());
    } else if (statusReason === informationDraftRef.current) {
      setStatusReason('');
    }
  };

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
      selectNextStatus(INFORMATION_REQUEST_STATUS);
      window.requestAnimationFrame(() => {
        informationMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        informationMessageRef.current?.focus({ preventScroll: true });
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
          <div className="staff-intro__side">
            {messagingCapabilities.requestsCreate && <Link className="staff-button staff-button--dark staff-intro__create" href="/staff/requests/new"><Plus size={16} aria-hidden="true" />Nueva solicitud</Link>}
            <div className="staff-intro__metric"><strong>{loadingList && items.length === 0 ? '—' : total}</strong><span>{total === 1 ? 'expediente en vista' : 'expedientes en vista'}</span></div>
          </div>
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

            <div className="staff-inbox__head"><span>{loadingList ? 'Actualizando…' : `Mostrando ${items.length} de ${total}`}</span>{listNews > 0 && <button type="button" className="staff-inbox__news" onClick={() => { setListNews(0); void loadList(page, statusFilter, appliedSearch, view, true); }}>{listNews === 1 ? 'Hay 1 novedad' : `Hay ${listNews} novedades`} · Actualizar</button>}{filtersActive && <button type="button" className="staff-inbox__reset" onClick={resetFilters}>Limpiar filtros</button>}</div>
            <div ref={requestListRef} className="staff-request-list" aria-live="polite">
              {loadingList && <div className="staff-list-placeholder"><span /><span /><span /></div>}
              {!loadingList && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span>{view === 'mine' && !statusFilter && !appliedSearch
                ? <><h2>Aún no tienes expedientes a tu cargo.</h2><p>Toma uno de la vista «Sin asignar» para empezar a trabajarlo.</p><button type="button" className="staff-button" onClick={() => applyView('unassigned')}>Ver sin asignar</button></>
                : view === 'unassigned' && !statusFilter && !appliedSearch
                  ? <><h2>Todo tiene responsable.</h2><p>No hay expedientes esperando a que alguien los tome.</p></>
                  : <><h2>No hay solicitudes aquí.</h2><p>{filtersActive ? 'Ningún expediente coincide con estos filtros.' : 'Cuando llegue una solicitud nueva aparecerá aquí.'}</p>{filtersActive && <button type="button" className="staff-button" onClick={resetFilters}>Limpiar filtros</button>}</>}</div>}
              {!loadingList && items.map((item) => { const RowStatusIcon = statusToneIcon(item.status); return <button className={`staff-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => { if (item.id === selectedId) { revealWhenStacked(detailRef.current, '(max-width: 900px)'); return; } revealPendingRef.current = true; setSelectedId(item.id); }}><span className={`staff-status-dot staff-status-dot--${item.status.toLowerCase()}`} role="img" aria-label={`Estado: ${statusLabel(item.status)}`}><RowStatusIcon size={10} aria-hidden="true" /></span><span className="staff-request-row__main"><strong>{item.folio}</strong><span>{item.client.displayName}</span><small>{item.detail?.projectType ?? 'Sin detalle'} · {item.detail?.location ?? 'Sin ubicación'}</small>{!item.currentAssignee && view !== 'unassigned' && !FINISHED_REQUEST_STATUSES.includes(item.status) && <em className="staff-request-row__flag">Sin asignar</em>}</span><time className="staff-request-row__date" dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{relativeTimeLabel(item.createdAt)}</time></button>; })}
            </div>
            <PrivatePagination page={page} totalPages={totalPages} disabled={loadingList} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />
          </aside>

          <section className="staff-detail" ref={detailRef} aria-label="Detalle de solicitud">
            {(loadingDetail || (loadingList && !selected)) && <div className="staff-detail__loading"><span /><span /><span /></div>}
            {!loadingDetail && !loadingList && !selected && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Selecciona un expediente.</h2><p>El detalle y las acciones operativas aparecerán aquí.</p></div>}
            {!loadingDetail && selected && <>
              <div className="staff-detail__header"><div><p className="staff-kicker">{selected.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{selected.folio}</h2><p className="staff-detail__date">Recibida el {formatDateTime(selected.createdAt)}</p>{(selected.availableActions.includes('quote.open') && primaryAction?.kind !== 'quote') || messagingCapabilities.requestsEdit || selected.availableActions.includes('request.close') ? <div className="staff-detail__header-actions">{selected.availableActions.includes('quote.open') && primaryAction?.kind !== 'quote' && <Link className="staff-button staff-detail__quote-link" href={`/staff/quotes?request=${selected.id}`}>Abrir constructor</Link>}{messagingCapabilities.requestsEdit && <button className="staff-button staff-button--outline staff-detail__edit" type="button" onClick={() => openEdit()}>Editar datos</button>}{selected.availableActions.includes('request.close') && <button className="staff-button staff-button--quiet-danger" type="button" onClick={() => setCloseOpen(true)}>Cerrar expediente</button>}</div> : null}</div><StatusPill status={selected.status} /></div>
              <ExpedienteJourney here="request" requestId={selected.id} requestStatus={selected.status} quote={selected.quoteSummary?.current ? { versionNumber: selected.quoteSummary.current.versionNumber, status: selected.quoteSummary.current.status, validUntil: selected.quoteSummary.current.validUntil } : null} project={selected.project ?? null} />
              {(() => {
                // Después de enviar la propuesta la solicitud no se queda muda: dice en qué va la venta y
                // lleva a la pestaña donde sigue (Cotizaciones o Proyectos).
                const summary = selected.quoteSummary;
                const published = summary?.published ?? null;
                const quoteHref = `/staff/quotes?request=${selected.id}`;
                let step: { tone: 'action' | 'waiting' | 'done' | 'closed'; label: string; title: string; detail: string; action: ReactNode } | null = null;
                if (selected.status === 'RECHAZADA' || selected.status === 'VENCIDA') {
                  const closing = selected.statusHistory.find((entry) => entry.toStatus === selected.status);
                  step = { tone: 'closed', label: 'Expediente cerrado', title: closing?.reason ? `Cerrado: ${closing.reason.replace(/[.\s]+$/u, '')}.` : 'Este expediente está cerrado.', detail: 'Ya no aparece en las bandejas de trabajo. Si el cliente vuelve, reábrelo y sigue desde revisión.', action: selected.availableActions.includes('request.reopen') ? <button className="staff-button staff-button--outline" type="button" disabled={saving} onClick={() => void reopenRequest()}>Reabrir expediente</button> : null };
                } else if (selected.project) {
                  step = { tone: 'done', label: 'Proyecto en marcha', title: `Proyecto ${selected.project.folio} ${selected.project.status === 'COMPLETADO' ? 'completado' : 'en arranque'}.`, detail: 'El arranque sigue en Proyectos: responsable, checklist y contacto del cliente.', action: <Link className="staff-button staff-button--dark" href={`/staff/projects/${selected.project.id}`}>Abrir proyecto<ArrowRight size={16} aria-hidden="true" /></Link> };
                } else if (selected.status === 'ACEPTADA') {
                  step = { tone: 'action', label: 'Siguiente paso', title: `El cliente aceptó la propuesta${summary?.acceptance ? ` (${summary.acceptance.signerName})` : ''}.`, detail: 'Conviértela en proyecto para arrancar: queda a cargo de quien lleva el expediente y aparece en Proyectos.', action: messagingCapabilities.projectsCreate && summary?.acceptance ? <button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={() => void convertToProject()}>{saving ? 'Creando…' : 'Convertir en proyecto'}<ArrowRight size={16} aria-hidden="true" /></button> : <Link className="staff-button staff-button--outline" href={quoteHref}>Ver cotización</Link> };
                } else if (['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION'].includes(selected.status) && published) {
                  const expired = published.validUntil !== null && new Date(published.validUntil).getTime() < Date.now();
                  // Tras el envío: si el cliente escribió, la pelota es nuestra; si el último en hablar fue el
                  // equipo, se cuenta el silencio desde el envío o el último seguimiento.
                  const pulse = selected.conversationPulse ?? null;
                  const sentAt = published.publishedAt ? new Date(published.publishedAt).getTime() : null;
                  const pulseAt = pulse ? new Date(pulse.lastSharedAt).getTime() : null;
                  const customerWrote = Boolean(pulse?.lastFromCustomer && pulseAt !== null && (sentAt === null || pulseAt > sentAt));
                  const followedUpAt = pulse && !pulse.lastFromCustomer && pulseAt !== null && sentAt !== null && pulseAt > sentAt ? pulse.lastSharedAt : null;
                  const lastTouch = Math.max(sentAt ?? 0, followedUpAt ? new Date(followedUpAt).getTime() : 0);
                  const quietDays = lastTouch ? daysSince(lastTouch) : 0;
                  const followUpButton = messagingCapabilities.messagingSend && <button className="staff-button staff-button--dark" type="button" onClick={() => setFollowUp('proposal')}>Dar seguimiento</button>;
                  const quoteLink = <Link className="staff-button staff-button--outline" href={quoteHref}>Ver cotización</Link>;
                  if (expired) step = { tone: 'action', label: 'Siguiente paso', title: `La propuesta V${published.versionNumber} venció el ${formatDate(published.validUntil)}.`, detail: 'El cliente ya no puede aceptarla. Crea una nueva versión con vigencia actualizada desde el constructor.', action: <Link className="staff-button staff-button--dark" href={quoteHref}>Abrir constructor<ArrowRight size={16} aria-hidden="true" /></Link> };
                  else if (customerWrote && pulse) step = { tone: 'action', label: 'Siguiente paso', title: 'El cliente te escribió sobre la propuesta.', detail: `Su mensaje llegó ${relativeTimeLabel(pulse.lastSharedAt).toLocaleLowerCase('es-MX')}. Respóndele en Correspondencia; si pide ajustes, prepara una nueva versión desde la cotización.`, action: <div className="staff-next-step__actions"><button className="staff-button staff-button--dark" type="button" onClick={scrollToConversation}>Ver conversación</button>{quoteLink}</div> };
                  else if (quietDays >= WAITING_ON_CUSTOMER_DAYS) step = { tone: 'waiting', label: 'Sin respuesta del cliente', title: `Propuesta V${published.versionNumber} sin respuesta desde hace ${quietDays} días.`, detail: `${followedUpAt ? `Tu último seguimiento fue ${relativeTimeLabel(followedUpAt).toLocaleLowerCase('es-MX')}. ` : ''}Escríbele para resolver dudas o confirmar si sigue interesado; si ya no avanzará, cierra el expediente con su motivo.`, action: <div className="staff-next-step__actions">{followUpButton}{quoteLink}</div> };
                  else step = { tone: 'waiting', label: 'En espera del cliente', title: `Propuesta V${published.versionNumber} enviada: esperando su decisión.`, detail: `${published.publishedAt ? `Se envió ${relativeTimeLabel(published.publishedAt).toLocaleLowerCase('es-MX')}. ` : ''}${followedUpAt ? `Le diste seguimiento ${relativeTimeLabel(followedUpAt).toLocaleLowerCase('es-MX')}. ` : ''}El cliente puede aceptarla o pedir cambios desde su portal; te avisaremos por correo.`, action: <div className="staff-next-step__actions">{followUpButton}{quoteLink}</div> };
                }
                if (!step) return null;
                return <section className={`staff-next-step${step.tone === 'waiting' ? ' staff-next-step--waiting' : step.tone === 'done' ? ' staff-next-step--done' : step.tone === 'closed' ? ' staff-next-step--closed' : ''}`} aria-labelledby="staff-next-step-title"><span className="staff-next-step__icon" aria-hidden="true">{step.tone === 'waiting' ? <Hourglass size={20} /> : step.tone === 'done' ? <CircleCheck size={20} /> : step.tone === 'closed' ? <Archive size={20} /> : <Compass size={20} />}</span><div className="staff-next-step__body"><p className="staff-section-label">{step.label}</p><h3 id="staff-next-step-title">{step.title}</h3><p className="staff-next-step__missing">{step.detail}</p></div>{step.action}</section>;
              })() ?? (selected.status === INFORMATION_REQUEST_STATUS ? (() => {
                // En espera de información el siguiente paso real depende de si el cliente ya respondió;
                // el resolvedor genérico sugería "Marcar en revisión" aunque aún no hubiera respuesta.
                const waiting = selected.informationRequest ?? { requestedAt: null, customerReplied: false };
                // Mismo criterio que la cola "Sin respuesta del cliente": días desde la petición o el último seguimiento.
                const requestedAtMs = waiting.requestedAt ? new Date(waiting.requestedAt).getTime() : null;
                const infoPulse = selected.conversationPulse ?? null;
                const infoFollowedUpAt = infoPulse && !infoPulse.lastFromCustomer && requestedAtMs !== null && new Date(infoPulse.lastSharedAt).getTime() > requestedAtMs ? infoPulse.lastSharedAt : null;
                const infoLastTouch = Math.max(requestedAtMs ?? 0, infoFollowedUpAt ? new Date(infoFollowedUpAt).getTime() : 0);
                const infoQuietDays = !waiting.customerReplied && infoLastTouch ? daysSince(infoLastTouch) : 0;
                const infoStale = infoQuietDays >= WAITING_ON_CUSTOMER_DAYS;
                // Si el equipo ya capturó todo lo que faltaba (p. ej. se lo dictaron por teléfono), no
                // tiene sentido seguir "esperando": se ofrece volver a revisión.
                const capturedByTeam = !waiting.customerReplied && missingAsks.length === 0 && selected.availableStatusTransitions.includes('EN_REVISION') && messagingCapabilities.requestsStatusUpdate;
                if (capturedByTeam) return <section className="staff-next-step" aria-labelledby="staff-next-step-title"><span className="staff-next-step__icon" aria-hidden="true"><Compass size={20} /></span><div className="staff-next-step__body"><p className="staff-section-label">Siguiente paso</p><h3 id="staff-next-step-title">Ya tienes los datos que faltaban.</h3><p className="staff-next-step__missing">Continúa con la revisión; el cliente ya no necesita responder.</p></div><button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={() => void transition('EN_REVISION', 'Datos completados por el equipo.')}>Continuar con la revisión<ArrowRight size={16} aria-hidden="true" /></button></section>;
                return <section className={`staff-next-step${waiting.customerReplied ? '' : ' staff-next-step--waiting'}`} aria-labelledby="staff-next-step-title"><span className="staff-next-step__icon" aria-hidden="true">{waiting.customerReplied ? <MessageSquareReply size={20} /> : <Hourglass size={20} />}</span><div className="staff-next-step__body"><p className="staff-section-label">{waiting.customerReplied ? 'Siguiente paso' : infoStale ? 'Sin respuesta del cliente' : 'En espera del cliente'}</p><h3 id="staff-next-step-title">{waiting.customerReplied ? 'El cliente respondió a tu solicitud de información.' : infoStale ? `Sin respuesta desde hace ${infoQuietDays} días.` : 'Esperando la respuesta del cliente.'}</h3><p className="staff-next-step__missing">{waiting.customerReplied ? 'Lee su respuesta en Correspondencia, captura lo que te compartió y continúa con la revisión.' : `Le pediste los datos ${waiting.requestedAt ? relativeTimeLabel(waiting.requestedAt).toLocaleLowerCase('es-MX') : 'hace poco'}.${infoFollowedUpAt ? ` Le diste seguimiento ${relativeTimeLabel(infoFollowedUpAt).toLocaleLowerCase('es-MX')}.` : ''}${infoStale ? ' Dale seguimiento o, si ya no avanzará, cierra el expediente.' : ' Te avisaremos por correo en cuanto responda.'}`}{messagingCapabilities.requestsEdit && <> <button className="staff-next-step__inline" type="button" onClick={() => openEdit(missingAsks[0]?.field ?? null)}>{waiting.customerReplied ? 'Capturar sus datos' : '¿Te respondió por otro medio? Captúralo'}</button></>}</p></div>{waiting.customerReplied && messagingCapabilities.requestsStatusUpdate ? <button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={() => void markInformationReviewed()}>Revisar y continuar<ArrowRight size={16} aria-hidden="true" /></button> : <div className="staff-next-step__actions">{messagingCapabilities.messagingSend && <button className="staff-button staff-button--dark" type="button" onClick={() => setFollowUp('information')}>Dar seguimiento</button>}<button className="staff-button staff-button--outline" type="button" onClick={scrollToConversation}>Ver conversación</button></div>}</section>;
              })() : primaryAction && <section className="staff-next-step" aria-labelledby="staff-next-step-title"><span className="staff-next-step__icon" aria-hidden="true"><Compass size={20} /></span><div className="staff-next-step__body"><p className="staff-section-label">Siguiente paso</p><h3 id="staff-next-step-title">{primaryAction.description}</h3>{primaryAction.kind === 'information' && missingInformation.length > 0 && <p className="staff-next-step__missing">Faltan: {missingInformation.join(', ')}.{messagingCapabilities.requestsEdit && missingAsks[0] && <> <button className="staff-next-step__inline" type="button" onClick={() => openEdit(missingAsks[0].field)}>¿Ya los tienes? Captúralos</button></>}</p>}</div>{primaryAction.kind === 'quote' ? <Link className="staff-button staff-button--dark" href={`/staff/quotes?request=${selected.id}`}>{primaryAction.label}<ArrowRight size={16} aria-hidden="true" /></Link> : <button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={activatePrimaryAction}>{primaryAction.label}<ArrowRight size={16} aria-hidden="true" /></button>}</section>)}
              <div className="staff-detail__grid"><section className="staff-detail__section"><p className="staff-section-label">Contacto</p><h3>{selected.contact.displayName}</h3><a href={`mailto:${selected.contact.email}`}>{selected.contact.email}</a>{selected.contact.phone && <a href={`tel:${selected.contact.phone}`}>{selected.contact.phone}</a>}<div className="staff-contact-access"><span className={`staff-contact-access__status staff-contact-access__status--${selected.contact.user?.status?.toLowerCase() ?? 'none'}`}>{selected.contact.user?.status === 'ACTIVE' ? 'Portal habilitado' : selected.contact.user?.status === 'INVITED' ? 'Invitación pendiente' : 'Portal sin habilitar'}</span>{messagingCapabilities.identityUsersManage && <button className="staff-button staff-button--dark" type="button" disabled={customerAccessBusy} onClick={() => void inviteCustomerAccess()}>{customerAccessBusy ? 'Enviando…' : selected.contact.user?.status === 'ACTIVE' ? 'Enviar nuevo acceso' : selected.contact.user?.status === 'INVITED' ? 'Reenviar acceso' : 'Habilitar portal'}</button>}</div></section><section className="staff-detail__section"><p className="staff-section-label">Proyecto</p><h3>{selected.detail?.projectType ?? 'Sin tipo de proyecto'}</h3><p>{selected.detail?.location ?? 'Sin ubicación'}</p>{selected.detail?.dimensions && <p>{selected.detail.dimensions}</p>}<dl className="staff-qualification"><div><dt>Etapa</dt><dd>{qualificationLabel(selected.detail?.projectStage, QUOTE_REQUEST_PROJECT_STAGE_LABELS)}</dd></div><div><dt>Inicio</dt><dd>{qualificationLabel(selected.detail?.timeline, QUOTE_REQUEST_TIMELINE_LABELS)}</dd></div><div><dt>Presupuesto</dt><dd>{qualificationLabel(selected.detail?.budgetRange, QUOTE_REQUEST_BUDGET_RANGE_LABELS)}</dd></div></dl></section></div>
              <section className="staff-detail__section staff-detail__section--description"><p className="staff-section-label">Alcance compartido</p><p className="staff-description">{selected.detail?.description ?? 'Sin descripción.'}</p></section>
              <div className="staff-actions-grid">{messagingCapabilitiesLoaded && messagingCapabilities.requestsAssign && <section className="staff-action"><p className="staff-section-label">Responsable</p>{messagingCapabilities.requestsReadGlobal ? <><PrivateSelect id="requests-assignment" label="Responsable" hideLabel required value={assignmentId} onValueChange={setAssignmentId} options={assignees.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))} placeholder="Sin responsable" /><input aria-label="Motivo del cambio de responsable (opcional)" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} placeholder="Motivo opcional" maxLength={500} /><button className="staff-button staff-button--dark" type="button" disabled={saving || !assignmentId} onClick={() => void assign()}>Guardar responsable</button></> : selected.currentAssignee ? <p className="staff-action__owner"><span className="staff-action__avatar" aria-hidden="true">{initialsOf(selected.currentAssignee.displayName)}</span><span><strong>{selected.currentAssignee.displayName}{selected.availableActions.includes('request.taken') ? ' (tú)' : ''}</strong><small>Responsable del expediente</small></span></p> : <><p>{primaryAction?.kind === 'take' ? 'Nadie lo ha tomado todavía. Hazte responsable con «Tomar solicitud» en el siguiente paso.' : 'Nadie ha tomado este expediente todavía.'}</p>{primaryAction?.kind !== 'take' && selected.availableActions.includes('request.take') && <button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={() => void takeRequest()}>Tomar solicitud</button>}</>}</section>}{nextStatuses.length === 0 ? <section className="staff-action staff-action--auto"><p className="staff-section-label">Estado del expediente</p><p className="staff-action__auto">{automaticStatusCopy(selected.status)}</p></section> : <section className="staff-action"><p className="staff-section-label">Siguiente estado</p><PrivateSelect id="requests-next-status" label="Siguiente estado" hideLabel required value={nextStatus} onValueChange={selectNextStatus} options={nextStatuses.map((status) => ({ value: status, label: statusLabel(status) }))} placeholder={nextStatuses.length ? 'Selecciona un estado' : 'Sin transiciones disponibles'} disabled={nextStatuses.length === 0} />{nextStatus === INFORMATION_REQUEST_STATUS ? <><p className="staff-action__hint">Este texto lo recibirá el cliente tal cual, por correo y en la conversación del expediente. {missingAsks.length ? 'Te propusimos un borrador con lo que falta; ajústalo antes de enviarlo.' : 'Escribe qué necesitas que te confirme.'}</p><textarea ref={informationMessageRef} className="staff-action__message" aria-label="Mensaje para el cliente" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder="Mensaje para el cliente (obligatorio)" rows={8} maxLength={10000} required /><p className="staff-action__recipient">Para <strong>{selected.contact.displayName}</strong> · {selected.contact.email}</p></> : <input ref={statusReasonRef} aria-label="Motivo del cambio de estado (opcional)" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder="Motivo opcional" maxLength={500} />}<button className="staff-button staff-button--copper" type="button" disabled={saving || !nextStatus || (nextStatus === INFORMATION_REQUEST_STATUS && !statusReason.trim())} onClick={() => void transition()}>{nextStatus === INFORMATION_REQUEST_STATUS ? (saving ? 'Enviando…' : 'Enviar y esperar respuesta') : 'Actualizar estado'}</button></section>}</div>
              {messagingCapabilitiesLoaded && <StaffFilesPanel requestId={selected.id} capabilities={messagingCapabilities} />}
              {messagingCapabilitiesLoaded && <StaffMessagingPanel requestId={selected.id} capabilities={messagingCapabilities} />}
              <CloseRequestDialog open={closeOpen} requestId={selected.id} folio={selected.folio} sentVersionNumber={selected.quoteSummary?.published && ['ENVIADA', 'EN_NEGOCIACION'].includes(selected.quoteSummary.published.status) ? selected.quoteSummary.published.versionNumber : null} onClose={() => setCloseOpen(false)} onClosed={async (message) => { setCloseOpen(false); setError(null); setNotice(message); await refreshCurrent(); }} />
              <FollowUpDialog open={followUp !== null} kind={followUp ?? 'proposal'} requestId={selected.id} folio={selected.folio} contactName={selected.contact.displayName} missing={missingInformation} versionNumber={selected.quoteSummary?.published?.versionNumber ?? null} onClose={() => setFollowUp(null)} onSent={async (message) => { setFollowUp(null); setError(null); setNotice(message); await refreshCurrent(); }} />
              {messagingCapabilities.requestsEdit && <StaffRequestEditDialog open={editOpen} target={{ id: selected.id, folio: selected.folio, status: selected.status, contact: { displayName: selected.contact.displayName, email: selected.contact.email, phone: selected.contact.phone, roleTitle: selected.contact.roleTitle }, detail: selected.detail }} focus={editFocus} onClose={() => setEditOpen(false)} onSaved={async (message) => { setEditOpen(false); setError(null); setNotice(message); await refreshCurrent(); }} />}
              {liveUpdatedAt !== null && <p className="live-updated" role="status">Actualizado hace un momento</p>}
              <section className="staff-history"><div><p className="staff-section-label">Actividad</p><h3>Historial del expediente</h3></div><ol>{selected.statusHistory.map((entry) => <li key={entry.id}><span className="staff-history__line" aria-hidden="true" /><div><strong>{statusLabel(entry.toStatus)}</strong><p>{entry.reason ?? 'Cambio registrado'} · {entry.changedBy?.displayName ?? 'Sistema'}</p><time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time></div></li>)}</ol></section>
            </>}
          </section>
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
