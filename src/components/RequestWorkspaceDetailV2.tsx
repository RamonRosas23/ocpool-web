'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nextRovingTabIndex, PrivateBlockingState, PrivateEmptyState, PrivateSkeleton, PrivateSurfaceRoot } from '@/components/private/ui';
import RequestWorkspaceActionsV2 from '@/components/RequestWorkspaceActionsV2';
import type { RequestWorkspaceActionsHandle } from '@/components/RequestWorkspaceActionsV2';
import RequestWorkspaceEditV2 from '@/components/RequestWorkspaceEditV2';
import RequestWorkspaceHeaderV2, { type RequestWorkspaceHeaderAction } from '@/components/RequestWorkspaceHeaderV2';
import type { StaffFilesCapabilities } from '@/components/StaffFilesPanel';
import type { StaffMessagingCapabilities } from '@/components/StaffMessagingPanel';
import { formatDateTime } from '@/lib/format-date';
import { normalizeRequestWorkspaceQuery, QUOTE_REQUEST_STATUS_LABELS, REQUEST_WORKSPACE_TABS, serializeRequestWorkspaceQuery } from '@/lib/request-workspace-query';
import type { RequestWorkspaceTab } from '@/lib/request-workspace-query';
import { readApiResponse, readApiResponseOrThrow, type ApiResponseErrorKind } from '@/lib/api-response-error';
import { getRequestWorkspacePrimaryAction, requestWorkspaceStatusActionLabel } from '@/lib/request-workspace-primary-action';
import type { QuoteRequestStatus } from '@/server/modules/quote-requests/domain';

const StaffMessagingPanel = dynamic(() => import('@/components/StaffMessagingPanel'), { ssr: false });
const StaffFilesPanel = dynamic(() => import('@/components/StaffFilesPanel'), { ssr: false });

const TAB_LABELS: Record<RequestWorkspaceTab, string> = {
  summary: 'Resumen', quote: 'Cotización', conversation: 'Conversación', files: 'Archivos', activity: 'Actividad',
};

type RequestHistoryEntry = {
  id: string;
  fromStatus: QuoteRequestStatus | null;
  toStatus: QuoteRequestStatus;
  reason: string | null;
  createdAt: string;
  changedBy: { id: string; displayName: string } | null;
};

type RequestAssignment = {
  id: string;
  reason: string | null;
  assignedAt: string;
  unassignedAt: string | null;
  assignedTo: { id: string; displayName: string; email: string } | null;
  assignedBy: { id: string; displayName: string } | null;
};

type RequestActivityResponse = {
  items: Array<{
    kind: 'status' | 'assignment';
    id: string;
    date: string;
    statusHistory?: RequestHistoryEntry;
    assignment?: RequestAssignment;
  }>;
  nextCursor: string | null;
};

type RequestDetail = {
  id: string;
  folio: string;
  origin: string;
  status: QuoteRequestStatus;
  createdAt: string;
  updatedAt: string;
  client: { displayName: string; status: string };
  contact: { displayName: string; email: string; phone: string | null; roleTitle: string | null; user: { status: string } | null };
  currentAssignee: { id: string; displayName: string; email: string } | null;
  detail: { projectType: string; location: string; dimensions: string | null; projectStage: string | null; timeline: string | null; budgetRange: string | null; description: string } | null;
  assignments: RequestAssignment[];
  statusHistory: RequestHistoryEntry[];
  activityNextCursor: string | null;
  availableStatusTransitions: QuoteRequestStatus[];
  availableActions: string[];
};

type WorkspaceCapabilities = StaffMessagingCapabilities & StaffFilesCapabilities & {
  quotesRead: boolean;
  requestsEdit: boolean;
  requestsAssign: boolean;
  requestsReassign: boolean;
  requestsStatusUpdate: boolean;
  identityUsersManage: boolean;
};

type QuoteVersionSummary = {
  id: string;
  versionNumber: number;
  status: string;
  currencyCode: string;
  totalMinor: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

type QuoteWorkspace = {
  quote: {
    id: string;
    currentVersionId: string | null;
    currentVersion: QuoteVersionSummary | null;
    versions: QuoteVersionSummary[];
  } | null;
};

// UX audit fix: Intl.NumberFormat's `style: 'currency'` renders only the bare symbol ("$1,650.00"),
// with nothing distinguishing MXN from USD -- a real ambiguity for a Mexican business, not just a
// cosmetic difference from the other five moneyLabel()-style helpers across the app, which all
// prefix the currency code explicitly. Matches that same "{code} {amount}" convention here.
function formatCurrencyMinor(value: string, currencyCode: string): string {
  if (!/^\d+$/u.test(value)) return `${currencyCode} ${value}`;
  const amount = BigInt(value);
  const whole = amount / 100n;
  const decimals = (amount % 100n).toString().padStart(2, '0');
  return `${currencyCode} ${whole.toLocaleString('es-MX')}.${decimals}`;
}

function statusLabel(value: QuoteRequestStatus | null): string {
  return value ? QUOTE_REQUEST_STATUS_LABELS[value] : 'Inicio';
}

function quoteStatusLabel(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

function tabHref(requestId: string, tab: RequestWorkspaceTab, query: ReturnType<typeof normalizeRequestWorkspaceQuery>): string {
  const params = serializeRequestWorkspaceQuery({ ...query, tab }).toString();
  return `/staff/requests/${encodeURIComponent(requestId)}${params ? `?${params}` : ''}`;
}

function handleTabKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
  const tabLinks = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? []);
  const currentIndex = tabLinks.indexOf(event.currentTarget);
  const nextIndex = nextRovingTabIndex(event.key, currentIndex, tabLinks.length);
  if (nextIndex === null) return;
  event.preventDefault();
  tabLinks[nextIndex]?.focus();
}

function SummaryTab({ detail }: { detail: RequestDetail }) {
  return <>
    <section className="request-workspace-v2__detail-grid" aria-label="Resumen del expediente">
      <article><p className="private-kicker">Cliente y contacto</p><h2>{detail.contact.displayName}</h2><a href={`mailto:${detail.contact.email}`}>{detail.contact.email}</a>{detail.contact.phone && <a href={`tel:${detail.contact.phone}`}>{detail.contact.phone}</a>}<p className="request-workspace-v2__muted">{detail.currentAssignee ? `Responsable: ${detail.currentAssignee.displayName}` : 'Sin responsable asignado'}</p></article>
      <article><p className="private-kicker">Proyecto</p><h2>{detail.detail?.projectType ?? 'Sin tipo de proyecto'}</h2><p>{detail.detail?.location ?? 'Sin ubicación'}</p>{detail.detail?.dimensions && <p>{detail.detail.dimensions}</p>}<p className="request-workspace-v2__muted">Etapa: {detail.detail?.projectStage ?? 'Por definir'}</p></article>
    </section>
    <section className="request-workspace-v2__description"><p className="private-kicker">Alcance compartido</p><h2>Descripción del proyecto</h2><p>{detail.detail?.description ?? 'Sin descripción.'}</p></section>
  </>;
}

function activityEntry(item: { kind: 'status' | 'assignment'; id: string; date: string; statusHistory?: RequestHistoryEntry; assignment?: RequestAssignment }) {
  if (item.kind === 'status' && item.statusHistory) {
    const entry = item.statusHistory;
    return { id: `status-${entry.id}`, date: entry.createdAt, label: 'Cambio de estado', title: `${statusLabel(entry.fromStatus)} → ${statusLabel(entry.toStatus)}`, detail: entry.reason ?? `Actualizado por ${entry.changedBy?.displayName ?? 'el equipo'}.` };
  }
  if (item.kind === 'assignment' && item.assignment) {
    const entry = item.assignment;
    return { id: `assignment-${entry.id}`, date: entry.assignedAt, label: 'Responsable', title: entry.assignedTo ? `Asignada a ${entry.assignedTo.displayName}` : 'Solicitud sin responsable', detail: entry.reason ?? `Gestionado por ${entry.assignedBy?.displayName ?? 'el equipo'}.` };
  }
  return null;
}

function ActivityTab({ detail }: { detail: RequestDetail }) {
  const [olderItems, setOlderItems] = useState<RequestActivityResponse['items']>([]);
  const [nextCursor, setNextCursor] = useState(detail.activityNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  useEffect(() => {
    setOlderItems([]);
    setNextCursor(detail.activityNextCursor);
    setLoadMoreError(null);
  }, [detail.activityNextCursor, detail.id]);

  const entries = useMemo(() => [
    ...detail.statusHistory.map((entry) => activityEntry({ kind: 'status', id: entry.id, date: entry.createdAt, statusHistory: entry })),
    ...detail.assignments.map((entry) => activityEntry({ kind: 'assignment', id: entry.id, date: entry.assignedAt, assignment: entry })),
    ...olderItems.map(activityEntry),
  ].filter((entry): entry is NonNullable<ReturnType<typeof activityEntry>> => Boolean(entry)).sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()), [detail.assignments, detail.statusHistory, olderItems]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    void fetch(`/api/staff/quote-requests/${encodeURIComponent(detail.id)}/activity?cursor=${encodeURIComponent(nextCursor)}&limit=30`, { credentials: 'include', cache: 'no-store' })
      .then((response) => readApiResponseOrThrow<RequestActivityResponse>(response, 'No fue posible cargar la actividad anterior.'))
      .then((data) => {
        setOlderItems((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...data.items.filter((item) => !known.has(item.id))];
        });
        setNextCursor(data.nextCursor);
      })
      .catch((caught: unknown) => setLoadMoreError(caught instanceof Error ? caught.message : 'No fue posible cargar la actividad anterior.'))
      .finally(() => setLoadingMore(false));
  };

  return <section className="request-workspace-v2__activity" aria-labelledby="request-workspace-v2-activity-title">
    <div className="request-workspace-v2__section-heading"><div><p className="private-kicker">Trazabilidad</p><h2 id="request-workspace-v2-activity-title">Actividad del expediente</h2></div><p className="request-workspace-v2__muted">Actualizado el {formatDateTime(detail.updatedAt)}</p></div>
    {entries.length === 0 ? <PrivateEmptyState title="Aún no hay actividad registrada.">Los cambios del expediente aparecerán aquí.</PrivateEmptyState> : <ol className="request-workspace-v2__timeline">{entries.map((entry) => <li key={entry.id}><time dateTime={entry.date}>{formatDateTime(entry.date)}</time><div><p className="private-kicker">{entry.label}</p><h3>{entry.title}</h3><p>{entry.detail}</p></div></li>)}</ol>}
    {loadMoreError && <p className="private-status private-status--error" role="alert">{loadMoreError}</p>}
    {nextCursor && <button type="button" className="request-workspace-v2__activity-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Cargando actividad…' : 'Ver actividad anterior'}</button>}
  </section>;
}

function QuoteTab({ requestId, detail }: { requestId: string; detail: RequestDetail }) {
  const [workspace, setWorkspace] = useState<QuoteWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/staff/quotes/${encodeURIComponent(requestId)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponseOrThrow<QuoteWorkspace>(response, 'No fue posible cargar la cotización.'))
      .then(setWorkspace)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'No fue posible cargar la cotización.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestId, retryToken]);

  if (loading) return <PrivateSkeleton label="Cargando cotización" />;
  if (error) return <PrivateBlockingState title="No fue posible cargar la cotización." onRetry={() => setRetryToken((current) => current + 1)}>{error}</PrivateBlockingState>;
  const quote = workspace?.quote;
  if (!quote || !quote.currentVersion) return <PrivateEmptyState title="Todavía no hay una cotización asociada.">Cuando el expediente avance a elaboración, sus versiones aparecerán aquí.</PrivateEmptyState>;

  const version = quote.currentVersion;
  return <section className="request-workspace-v2__quote" aria-labelledby="request-workspace-v2-quote-title">
    <div className="request-workspace-v2__section-heading"><div><p className="private-kicker">Control comercial</p><h2 id="request-workspace-v2-quote-title">Cotización vigente</h2></div><span className="request-workspace-v2__detail-status">Versión {version.versionNumber}</span></div>
    <div className="request-workspace-v2__quote-summary"><div><span>Total</span><strong>{formatCurrencyMinor(version.totalMinor, version.currencyCode)}</strong></div><div><span>Estado</span><strong>{quoteStatusLabel(version.status)}</strong></div><div><span>Vigencia</span><strong>{version.validUntil ? formatDateTime(version.validUntil) : 'Sin fecha de vencimiento'}</strong></div></div>
    <div className="request-workspace-v2__quote-history"><p className="private-kicker">Versiones</p><ul>{quote.versions.map((candidate) => <li key={candidate.id}><span>Versión {candidate.versionNumber}</span><span>{quoteStatusLabel(candidate.status)}</span><span>{formatDateTime(candidate.updatedAt)}</span></li>)}</ul></div>
    {detail.availableActions.includes('quote.open') && <Link className="private-button private-button--primary" href={`/staff/quotes?request=${encodeURIComponent(requestId)}`}>Abrir constructor</Link>}
  </section>;
}

export default function RequestWorkspaceDetailV2({ requestId }: { requestId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useMemo(() => normalizeRequestWorkspaceQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const createdNotice = searchParams.get('created') === '1';
  const activeTabLabel = TAB_LABELS[query.tab];
  const backParams = serializeRequestWorkspaceQuery({ ...query, tab: 'summary' }).toString();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ kind: ApiResponseErrorKind; message: string } | null>(null);
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesRetryToken, setCapabilitiesRetryToken] = useState(0);
  const [conversationDraft, setConversationDraft] = useState('');
  const actionsRef = useRef<RequestWorkspaceActionsHandle>(null);
  const documentTitle = `${activeTabLabel} · ${detail?.folio ?? 'Expediente'} | OCPOOL Operaciones`;

  const loadDetail = useCallback(async (signal?: AbortSignal, showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quote-requests/${encodeURIComponent(requestId)}`, { credentials: 'include', cache: 'no-store', signal });
      const result = await readApiResponse<RequestDetail>(response, 'No fue posible cargar el expediente.');
      if (result.ok) {
        setDetail(result.data);
      } else {
        setDetail(null);
        setError({ kind: result.kind, message: result.message });
      }
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError({ kind: 'transient', message: caught instanceof Error ? caught.message : 'No fue posible cargar el expediente.' });
    } finally {
      if (showLoading && !signal?.aborted) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(controller.signal);
    return () => controller.abort();
  }, [loadDetail]);

  useEffect(() => {
    setConversationDraft('');
  }, [requestId]);

  useEffect(() => {
    const controller = new AbortController();
    setCapabilitiesError(null);
    fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponseOrThrow<WorkspaceCapabilities>(response, 'No fue posible validar los permisos del expediente.'))
      .then(setCapabilities)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setCapabilitiesError(caught instanceof Error ? caught.message : 'No fue posible validar los permisos del expediente.');
      });
    return () => controller.abort();
  }, [capabilitiesRetryToken]);

  const refreshDetail = useCallback(async () => {
    await loadDetail(undefined, false);
  }, [loadDetail]);

  const openQuote = useCallback(() => {
    router.push(tabHref(requestId, 'quote', query));
  }, [query, requestId, router]);

  const suggestedMissingFields = useMemo(() => detail ? [
    ...(detail.contact.phone ? [] : ['contact.phone']),
    ...(!detail.detail?.dimensions ? ['detail.dimensions'] : []),
    ...(!detail.detail?.timeline ? ['detail.timeline'] : []),
    ...(!detail.detail?.budgetRange ? ['detail.budgetRange'] : []),
  ] : [], [detail]);

  const primaryAction = useMemo(() => {
    if (!detail || !capabilities) return null;
    return getRequestWorkspacePrimaryAction({
      availableActions: detail.availableActions,
      availableStatusTransitions: detail.availableStatusTransitions,
      hasMissingInformation: suggestedMissingFields.length > 0,
      capabilities,
    });
  }, [capabilities, detail, suggestedMissingFields]);

  const activateAction = useCallback((action: Parameters<RequestWorkspaceActionsHandle['activate']>[0]) => {
    actionsRef.current?.activate(action);
  }, []);

  const secondaryActions = useMemo<RequestWorkspaceHeaderAction[]>(() => {
    if (!detail || !capabilities) return [];
    const actions: RequestWorkspaceHeaderAction[] = [];
    const addOperationalAction = (action: RequestWorkspaceHeaderAction) => {
      if (action.key !== primaryAction?.key) actions.push(action);
    };

    if (capabilities.requestsAssign && detail.availableActions.includes('request.take')) {
      addOperationalAction({ key: 'request.take', label: 'Tomar solicitud', description: 'Hazte responsable del expediente.', onActivate: () => activateAction({ key: 'request.take', kind: 'take', label: 'Tomar solicitud', description: 'Hazte responsable del expediente para comenzar la revisión.' }) });
    }
    if (capabilities.requestsStatusUpdate && capabilities.messagingSend && detail.availableActions.includes('request.information')) {
      addOperationalAction({ key: 'request.information', label: 'Solicitar información', description: 'Pide al cliente los datos que faltan.', onActivate: () => activateAction({ key: 'request.information', kind: 'information', label: 'Solicitar información', description: 'Pide al cliente los datos que faltan para avanzar.' }) });
    }
    detail.availableStatusTransitions.forEach((targetStatus) => {
      addOperationalAction({ key: `request.status:${targetStatus}`, label: requestWorkspaceStatusActionLabel(targetStatus), description: `Avanza el expediente a ${QUOTE_REQUEST_STATUS_LABELS[targetStatus].toLowerCase()}.`, onActivate: () => activateAction({ key: `request.status:${targetStatus}`, kind: 'status', targetStatus, label: requestWorkspaceStatusActionLabel(targetStatus), description: `Avanza el expediente a ${QUOTE_REQUEST_STATUS_LABELS[targetStatus].toLowerCase()}.` }) });
    });
    if (capabilities.requestsReassign && detail.availableActions.includes('request.reassign')) {
      actions.push({ key: 'request.reassign', label: 'Reasignar solicitud', description: 'Cambia el responsable dejando un motivo.', onActivate: () => activateAction({ key: 'request.reassign', kind: 'reassign', label: 'Reasignar solicitud', description: 'Cambia el responsable dejando un motivo.' }) });
    }
    if (detail.availableActions.includes('quote.open')) {
      actions.push({ key: 'quote.open', label: 'Abrir constructor', description: 'Continúa la propuesta comercial.', href: `/staff/quotes?request=${encodeURIComponent(requestId)}` });
    }
    if (capabilities.requestsEdit) {
      actions.push({ key: 'request.edit', label: 'Editar expediente', description: 'Corrige datos con trazabilidad.', href: '#request-workspace-v2-edit' });
    }
    return actions.filter((action) => action.key !== primaryAction?.key);
  }, [activateAction, capabilities, detail, primaryAction?.key, requestId]);

  const headerDetail = detail ? {
    folio: detail.folio,
    origin: detail.origin,
    status: detail.status,
    statusLabel: QUOTE_REQUEST_STATUS_LABELS[detail.status],
    createdAtLabel: formatDateTime(detail.createdAt),
    clientName: detail.client.displayName,
    projectType: detail.detail?.projectType ?? 'Por definir',
    projectStage: detail.detail?.projectStage ?? 'Por definir',
    assigneeName: detail.currentAssignee?.displayName ?? 'Sin responsable',
    expectedActor: primaryAction?.kind === 'information' ? 'Cliente' : primaryAction ? 'Equipo comercial' : 'Sin acción pendiente',
    attention: detail.status === 'INFORMACION_REQUERIDA' ? 'Respuesta del cliente' : suggestedMissingFields.length > 0 ? `${suggestedMissingFields.length} datos por confirmar` : 'Sin bloqueo identificado',
  } : null;

  const renderTab = () => {
    if (!detail) return null;
    if (query.tab === 'summary') return <SummaryTab detail={detail} />;
    if (query.tab === 'activity') return <ActivityTab detail={detail} />;
    if (capabilitiesError) return null;
    if (!capabilities) return <PrivateSkeleton label="Validando permisos del expediente" />;
    if (query.tab === 'conversation') return <StaffMessagingPanel requestId={detail.id} capabilities={capabilities} draft={conversationDraft} onDraftChange={setConversationDraft} />;
    if (query.tab === 'files') return <StaffFilesPanel requestId={detail.id} capabilities={capabilities} />;
    return <QuoteTab requestId={detail.id} detail={detail} />;
  };

  return (
    <>
      <title>{documentTitle}</title>
      <PrivateSurfaceRoot className="request-workspace-v2 request-workspace-v2--detail">
        <div className="request-workspace-v2__content">
        {loading && <PrivateSkeleton label="Cargando expediente" />}
        {error?.kind === 'forbidden' && <PrivateBlockingState title="Acceso restringido.">{error.message}</PrivateBlockingState>}
        {error?.kind === 'not_found' && <PrivateEmptyState title="Expediente no encontrado.">Verifica el enlace o vuelve a la cola de solicitudes.</PrivateEmptyState>}
        {error?.kind === 'transient' && <PrivateBlockingState title="No fue posible abrir el expediente." onRetry={() => void loadDetail()}>{error.message}</PrivateBlockingState>}
        {!loading && !error && detail && <>
          {headerDetail && <RequestWorkspaceHeaderV2 backHref={`/staff/requests${backParams ? `?${backParams}` : ''}`} primaryAction={primaryAction} primaryHref={primaryAction?.kind === 'quote' ? `/staff/quotes?request=${encodeURIComponent(requestId)}` : undefined} onPrimaryAction={activateAction} secondaryActions={secondaryActions} detail={headerDetail} />}
          {createdNotice && <p className="private-status private-status--success" role="status">Solicitud creada correctamente.</p>}
          <nav className="request-workspace-v2__tabs" role="tablist" aria-label="Secciones del expediente">
            {REQUEST_WORKSPACE_TABS.map((tab) => <Link key={tab} role="tab" tabIndex={query.tab === tab ? 0 : -1} aria-selected={query.tab === tab} aria-controls="request-workspace-v2-tabpanel" className={query.tab === tab ? 'is-active' : ''} href={tabHref(requestId, tab, query)} onKeyDown={handleTabKeyDown}>{TAB_LABELS[tab]}</Link>)}
          </nav>
          {capabilitiesError && <PrivateBlockingState title="No fue posible validar las acciones." onRetry={() => setCapabilitiesRetryToken((current) => current + 1)}>{capabilitiesError}</PrivateBlockingState>}
          {capabilities && <RequestWorkspaceEditV2 data={{ id: detail.id, updatedAt: detail.updatedAt, status: detail.status, contact: detail.contact, detail: detail.detail }} canEdit={capabilities.requestsEdit} onUpdated={refreshDetail} />}
          {capabilities && <RequestWorkspaceActionsV2 ref={actionsRef} requestId={detail.id} status={detail.status} contact={detail.contact} suggestedMissingFields={suggestedMissingFields} currentAssignee={detail.currentAssignee} availableActions={detail.availableActions} availableStatusTransitions={detail.availableStatusTransitions} capabilities={{ requestsAssign: capabilities.requestsAssign, requestsReassign: capabilities.requestsReassign, requestsStatusUpdate: capabilities.requestsStatusUpdate, messagingSend: capabilities.messagingSend, identityUsersManage: capabilities.identityUsersManage }} onUpdated={refreshDetail} onQuoteReady={openQuote} primaryActionKey={primaryAction?.key} compact={query.tab !== 'summary'} />}
          <section id="request-workspace-v2-tabpanel" role="tabpanel" aria-label={TAB_LABELS[query.tab]} className="request-workspace-v2__tabpanel">
            {renderTab()}
          </section>
        </>}
        </div>
      </PrivateSurfaceRoot>
    </>
  );
}
