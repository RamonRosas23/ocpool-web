'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDatePicker, PrivateLinkButton } from '@/components/private/ui';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import { relativeTimeLabel } from '@/lib/relative-time';
import { useHydrated } from '@/lib/use-hydrated';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/request-workspace-query';
import { readApiResponse } from '@/lib/api-response-error';
import { errorCategoryLabel, eventLabel, templateLabel } from '@/lib/notification-labels';
import { usePersistentState } from '@/lib/use-persistent-state';

type MetricSummary = {
  sampleSize: number | null;
  p50Seconds: number | null;
  p90Seconds: number | null;
  suppressed: boolean;
};

type DashboardResponse = {
  meta: { from: string; to: string; timezone: string; generatedAt: string; freshness: 'fresh' | 'stale'; scope: 'self' | 'global' };
  requests: {
    received: number;
    unassigned: number;
    byStatus: Array<{ status: string; count: number }>;
    byOrigin: Array<{ origin: string; count: number }>;
    aging: Array<{ bucket: string; count: number }>;
  };
  quotes: {
    sent: number;
    accepted: number;
    acceptanceRateBps: number | null;
    acceptedTotals: Array<{ currencyCode: string; totalMinor: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  timing: { assignment: MetricSummary; quoteSent: MetricSummary; acceptance: MetricSummary };
  workload: Array<{ actorKey: string; displayName: string; activeRequests: number | null; draftQuotes: number | null; oldestOpenAt: string | null; suppressed: boolean }>;
  notifications: { byStatus: Array<{ status: string; count: number }>; oldestPendingAt: string | null; failedInPeriod: number };
};

type DashboardQuery = { from?: string; to?: string };

type QueueItem = {
  id: string;
  folio: string;
  status: string;
  updatedAt: string;
  client: { displayName: string };
  detail: { projectType: string } | null;
};

type QueueResponse = { items: QueueItem[]; total: number };

type PendingApproval = {
  id: string;
  type: 'DISCOUNT' | 'PRICE_OVERRIDE' | 'SPECIAL_CONCEPT';
  requestedAt: string;
  requestId: string;
  folio: string;
  clientDisplayName: string;
  versionNumber: number;
  totalMinor: string;
  currencyCode: string;
};

type CustomerReplied = {
  id: string;
  folio: string;
  status: string;
  client: { displayName: string };
  lastCustomerMessageAt: string;
};

type ReadyToPublish = {
  versionId: string;
  requestId: string;
  folio: string;
  clientDisplayName: string;
  versionNumber: number;
  totalMinor: string;
  currencyCode: string;
  updatedAt: string;
};

type ProjectQueueItem = {
  id: string;
  folio: string;
  owner: { displayName: string } | null;
  client: { displayName: string };
  checklist: { total: number; completed: number };
  createdAt: string;
};

type FailedNotification = {
  id: string;
  eventType: string;
  templateKey: string;
  errorCategory: string | null;
  updatedAt: string;
  subject: { requestId: string | null; folio: string | null; clientDisplayName: string } | null;
};

const APPROVAL_TYPE_LABELS: Record<PendingApproval['type'], string> = {
  DISCOUNT: 'Descuento',
  PRICE_OVERRIDE: 'Ajuste de precio',
  SPECIAL_CONCEPT: 'Concepto especial',
};

function ageLabel(value: string): string {
  return relativeTimeLabel(value);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${new Intl.NumberFormat('es-MX').format(count)} ${count === 1 ? singular : pluralForm}`;
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function approvalMoneyLabel(value: string, currency: string): string {
  if (!/^\d+$/.test(value)) return '—';
  const amount = BigInt(value);
  return `${currency} ${(amount / 100n).toLocaleString('es-MX')}.${(amount % 100n).toString().padStart(2, '0')}`;
}

const STATUS_LABELS: Record<string, string> = QUOTE_REQUEST_STATUS_LABELS;

const ORIGIN_LABELS: Record<string, string> = { PUBLIC_FORM: 'Formulario público', STAFF_CREATED: 'Creada por staff' };
const NOTIFICATION_LABELS: Record<string, string> = { PENDING: 'Pendientes', PROCESSING: 'En proceso', SENT: 'Enviadas', FAILED: 'Fallidas', CANCELLED: 'Canceladas' };

function labelForStatus(value: string): string { return STATUS_LABELS[value] ?? value.replaceAll('_', ' '); }
function labelForOrigin(value: string): string { return ORIGIN_LABELS[value] ?? value.replaceAll('_', ' '); }

function dateParts(value: string, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function dateInputValue(value: string, timezone: string): string {
  const parts = dateParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDate(value: string | null, timezone: string, withTime = false): string {
  if (!value) return 'Sin registro';
  return new Intl.DateTimeFormat('es-MX', withTime ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone } : { day: '2-digit', month: 'short', year: 'numeric', timeZone: timezone }).format(new Date(value));
}

function formatInteger(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('es-MX').format(value); }

function formatRate(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(value / 100)}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(minutes / 60)} h`;
}

/**
 * Importe corto para el KPI "Vendido" ("$1.2 M", "$845 mil"), calculado con BigInt -- nunca se
 * convierte el importe a `number`. El importe exacto acompaña siempre al corto (texto y `title`).
 */
function compactMinor(minor: string): string {
  const major = BigInt(minor) / 100n;
  if (major >= 1_000_000n) {
    const tenths = major / 100_000n;
    return `$${new Intl.NumberFormat('es-MX').format(tenths / 10n)}${tenths % 10n ? `.${tenths % 10n}` : ''} M`;
  }
  if (major >= 10_000n) return `$${new Intl.NumberFormat('es-MX').format(major / 1_000n)} mil`;
  return `$${new Intl.NumberFormat('es-MX').format(major)}`;
}

function formatMinor(minor: string, currencyCode: string): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = new Intl.NumberFormat('es-MX').format(absolute / 100n);
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${currencyCode} ${whole}.${fraction}`;
}

function QueueCount({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className={`staff-workqueue__count${value > 0 ? ' is-hot' : ''}`}>{formatInteger(value)}<span className="sr-only"> en esta cola</span></span>;
}

function BarList({ items, label, empty }: { items: Array<{ label: string; count: number; href?: string }>; label: string; empty: string }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  if (items.length === 0) return <div className="analytics-empty"><strong>{empty}</strong><p>Cuando existan movimientos dentro del periodo aparecerán aquí.</p></div>;
  return <ul className="analytics-bars" aria-label={label}>{items.map((item) => {
    const content = <><div className="analytics-bars__meta"><span>{item.label}</span><strong>{formatInteger(item.count)}</strong></div><div className="analytics-bars__track" aria-hidden="true"><span style={{ width: `${Math.max((item.count / max) * 100, item.count ? 4 : 0)}%` }} /></div></>;
    // Una barra con destino abre la bandeja ya filtrada por ese estado: el pipeline deja de ser sólo
    // lectura y se vuelve el atajo a ese grupo de expedientes.
    return <li key={item.label}>{item.href ? <Link className="analytics-bars__link" href={item.href} title={`Ver ${item.label.toLowerCase()} en la bandeja`}>{content}</Link> : content}</li>;
  })}</ul>;
}

function MetricLine({ label, metric }: { label: string; metric: MetricSummary }) {
  return <li className={metric.suppressed ? 'is-suppressed' : undefined}><span>{label}</span><strong>{metric.suppressed ? 'Muestra protegida' : `P50 ${formatDuration(metric.p50Seconds)}`}</strong><small>{metric.suppressed ? 'Se requieren al menos 5 observaciones.' : `P90 ${formatDuration(metric.p90Seconds)} · n=${formatInteger(metric.sampleSize)}`}</small></li>;
}

export default function StaffDashboardPanel() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [query, setQuery, queryHydrated] = usePersistentState<DashboardQuery>('ocpool.staff.dashboard.query', {});
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [selectedPreset, setSelectedPreset] = usePersistentState('ocpool.staff.dashboard.selectedPreset', '30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const rangeInitialized = useRef(false);
  const rangeEdited = useRef(false);
  const [mineQueue, setMineQueue] = useState<QueueResponse | null>(null);
  const [unassignedQueue, setUnassignedQueue] = useState<QueueResponse | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[] | null>(null);
  const [customerReplied, setCustomerReplied] = useState<CustomerReplied[] | null>(null);
  const [readyToPublish, setReadyToPublish] = useState<ReadyToPublish[] | null>(null);
  const [failedNotifications, setFailedNotifications] = useState<{ items: FailedNotification[]; total: number } | null>(null);
  const [queuesLoading, setQueuesLoading] = useState(true);
  const [queuesError, setQueuesError] = useState<string | null>(null);
  const session = useStaffSession();
  const hydrated = useHydrated();
  const canReadProjects = session?.capabilities.projectsRead === true;
  const [projectsQueue, setProjectsQueue] = useState<{ items: ProjectQueueItem[]; total: number } | null>(null);

  // Proyectos en arranque: sólo para perfiles con lectura de proyectos (así nunca se dispara una
  // petición que el servidor rechazaría). Un fallo aquí no tumba el resto del tablero.
  useEffect(() => {
    if (!canReadProjects) return;
    const controller = new AbortController();
    void fetch('/api/staff/projects?status=EN_TRANSICION&pageSize=5', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => readApiResponse<{ items: ProjectQueueItem[]; total: number }>(response, 'No fue posible cargar los proyectos en arranque.'))
      .then((result) => { if (result.ok) setProjectsQueue({ items: result.data.items, total: result.data.total }); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [canReadProjects]);

  // W1-02 (primer corte): "qué atender ahora" reutiliza el mismo endpoint y scope de R1 (mine/sin
  // asignar) — sin score opaco, cada fila es un expediente real con enlace directo al expediente exacto.
  useEffect(() => {
    const controller = new AbortController();
    const loadQueues = async () => {
      setQueuesLoading(true);
      setQueuesError(null);
      try {
        // El scope "workspace" (view=mine/unassigned) fija su propio pageSize=20 en el servidor;
        // se toman sólo los primeros 5 para esta lectura compacta y `total` informa el resto.
        const [mineResponse, unassignedResponse, approvalsResponse, customerRepliedResponse, readyToPublishResponse, failedNotificationsResponse] = await Promise.all([
          fetch('/api/staff/quote-requests?view=mine&sort=stale&activeOnly=1', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch('/api/staff/quote-requests?view=unassigned&sort=stale&activeOnly=1', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch('/api/staff/quotes/approvals/pending', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch('/api/staff/quote-requests/customer-replied', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch('/api/staff/quotes/ready-to-publish', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch('/api/staff/notifications?status=FAILED&pageSize=5', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
        ]);
        const [mineResult, unassignedResult, approvalsResult, customerRepliedResult, readyToPublishResult, failedNotificationsResult] = await Promise.all([
          readApiResponse<QueueResponse>(mineResponse, 'No fue posible cargar tu trabajo.'),
          readApiResponse<QueueResponse>(unassignedResponse, 'No fue posible cargar las solicitudes sin asignar.'),
          readApiResponse<{ items: PendingApproval[] }>(approvalsResponse, 'No fue posible cargar las aprobaciones pendientes.'),
          readApiResponse<{ items: CustomerReplied[] }>(customerRepliedResponse, 'No fue posible cargar las respuestas de cliente.'),
          readApiResponse<{ items: ReadyToPublish[] }>(readyToPublishResponse, 'No fue posible cargar las cotizaciones listas para publicar.'),
          readApiResponse<{ items: FailedNotification[]; total: number }>(failedNotificationsResponse, 'No fue posible cargar los avisos fallidos.'),
        ]);
        if (mineResult.ok) setMineQueue(mineResult.data);
        if (unassignedResult.ok) setUnassignedQueue(unassignedResult.data);
        // Un actor sin permiso de aprobar (ej. ventas) recibe [] del servidor, no un 403 — esta
        // cola simplemente no le aplica, así que la tarjeta no se renderiza para ese rol.
        if (approvalsResult.ok) setPendingApprovals(approvalsResult.data.items);
        // W1-01: "cliente respondió" -- razón determinista (última respuesta del cliente más
        // reciente que la propia lectura del actor), nunca un score opaco.
        if (customerRepliedResult.ok) setCustomerReplied(customerRepliedResult.data.items);
        // W1-03: "listas para publicar" -- ya sin bloqueo de aprobación pendiente (esa es la cola de
        // arriba); lo único que falta es el clic real de enviar.
        if (readyToPublishResult.ok) setReadyToPublish(readyToPublishResult.data.items);
        // W1-03: "fallos de aviso" reutiliza por completo el endpoint ya construido para
        // /staff/notifications -- ningún servicio ni consulta nuevos, sólo esta lectura compacta.
        if (failedNotificationsResult.ok) setFailedNotifications({ items: failedNotificationsResult.data.items, total: failedNotificationsResult.data.total });
        // Antes, un resultado no-`ok` de cualquiera de las seis peticiones simplemente se ignoraba
        // (`if (result.ok) setX(...)`) -- esa cola se quedaba en `null` para siempre, indistinguible
        // de "sin nada pendiente" en tarjetas que sólo se renderizan cuando hay elementos. Un fallo
        // real (no un 403 esperado, ya cubierto por el comentario de aprobaciones arriba) parecía
        // entonces una bandeja al día en vez de un dato que no cargó.
        const failedResults = [mineResult, unassignedResult, approvalsResult, customerRepliedResult, readyToPublishResult, failedNotificationsResult].filter((result) => !result.ok);
        if (failedResults.length > 0) setQueuesError(failedResults[0].message);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setQueuesError(caught instanceof Error ? caught.message : 'No fue posible actualizar qué atender ahora.');
      } finally {
        if (!controller.signal.aborted) setQueuesLoading(false);
      }
    };
    void loadQueues();
    return () => controller.abort();
  }, []);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.from && query.to) { params.set('from', query.from); params.set('to', query.to); }
      const response = await fetch(`/api/staff/dashboard${params.size ? `?${params.toString()}` : ''}`, { credentials: 'include', cache: 'no-store', signal });
      const result = await readApiResponse<DashboardResponse>(response, 'No fue posible actualizar el dashboard.');
      if (!result.ok) {
        if (result.kind === 'forbidden') setAccessDenied(true);
        throw new Error(result.message);
      }
      const next = result.data;
      setData(next);
      setAccessDenied(false);
      if (!rangeInitialized.current && !rangeEdited.current) {
        setDraftFrom(dateInputValue(next.meta.from, next.meta.timezone));
        setDraftTo(dateInputValue(next.meta.to, next.meta.timezone));
        rangeInitialized.current = true;
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el dashboard.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!queryHydrated) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadToken, queryHydrated]);

  const applyPreset = (days: number) => {
    if (!draftTo) return;
    // "7 días" son 7 días calendario contando el de "Hasta" (el periodo es inclusivo en ambos extremos).
    const end = new Date(`${draftTo}T00:00:00.000Z`);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    const nextFrom = start.toISOString().slice(0, 10);
    setSelectedPreset(String(days));
    setDraftFrom(nextFrom);
    setQuery({ from: nextFrom, to: draftTo });
  };

  const applyCustomRange = () => {
    setSelectedPreset('');
    setQuery({ from: draftFrom, to: draftTo });
  };

  const displayRange = useMemo(() => data ? `${formatDate(data.meta.from, data.meta.timezone)} — ${formatDate(data.meta.to, data.meta.timezone)}` : 'Preparando periodo', [data]);

  if (accessDenied) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Necesitas una cuenta de empleado autorizada para consultar las métricas operativas.</PrivateBlockingState></PrivateSurfaceRoot>;

  if (error && !data) return <PrivateSurfaceRoot className="staff-shell"><PrivateBlockingState title="No fue posible cargarlo." onRetry={() => { setError(null); setReloadToken((current) => current + 1); }}>{error}</PrivateBlockingState></PrivateSurfaceRoot>;

  const dashboard = data;
  const pipeline = dashboard?.requests.byStatus.map((item) => ({ label: labelForStatus(item.status), count: item.count, href: `/staff/requests?status=${encodeURIComponent(item.status)}` })) ?? [];

  // Resumen personal: responde "¿qué tengo hoy?" antes de leer cualquier gráfica. Se arma sólo con
  // colas ya cargadas y sólo tras hidratar (la hora local no debe entrar al HTML del servidor).
  const summaryParts = [
    ...(mineQueue && mineQueue.total > 0 ? [`tienes ${plural(mineQueue.total, 'expediente a tu cargo', 'expedientes a tu cargo')}`] : []),
    ...(customerReplied && customerReplied.length > 0 ? [`${plural(customerReplied.length, 'cliente espera', 'clientes esperan')} tu respuesta`] : []),
    ...(pendingApprovals && pendingApprovals.length > 0 ? [`${plural(pendingApprovals.length, 'aprobación espera', 'aprobaciones esperan')} tu decisión`] : []),
    ...(readyToPublish && readyToPublish.length > 0 ? [`${plural(readyToPublish.length, 'cotización está lista', 'cotizaciones están listas')} para enviar`] : []),
    ...(unassignedQueue && unassignedQueue.total > 0 ? [`${plural(unassignedQueue.total, 'solicitud sigue', 'solicitudes siguen')} sin responsable`] : []),
  ];
  const summarySentence = summaryParts.length === 0 ? 'Todo al día: no hay pendientes en tus colas.' : `${summaryParts.slice(0, -1).join(', ')}${summaryParts.length > 1 ? ' y ' : ''}${summaryParts[summaryParts.length - 1]}.`;
  const firstName = session?.user.displayName.trim().split(/\s+/u)[0] ?? '';
  // El importe aceptado es lo que más le importa a ventas; sin mezclar monedas: la de más
  // aceptaciones va al frente y las demás se suman como texto exacto.
  const soldByCount = [...(dashboard?.quotes.acceptedTotals ?? [])].sort((left, right) => right.count - left.count);
  const soldPrimary = soldByCount[0] ?? null;
  const soldOthers = soldByCount.slice(1);
  const origins = dashboard?.requests.byOrigin.map((item) => ({ label: labelForOrigin(item.origin), count: item.count })) ?? [];
  const aging = dashboard?.requests.aging.map((item) => ({ label: `${item.bucket} días`, count: item.count })) ?? [];
  const notificationStatus = dashboard?.notifications.byStatus.filter((item) => item.count > 0).map((item) => ({ label: NOTIFICATION_LABELS[item.status] ?? item.status, count: item.count })) ?? [];
  const alerts = dashboard ? [
    ...(dashboard.requests.unassigned > 0 ? [{ label: `${formatInteger(dashboard.requests.unassigned)} solicitud${dashboard.requests.unassigned === 1 ? '' : 'es'} sin asignar`, detail: 'Requieren responsable para avanzar.', href: '/staff/requests?view=unassigned' }] : []),
    ...(dashboard.notifications.failedInPeriod > 0 ? [{ label: `${formatInteger(dashboard.notifications.failedInPeriod)} entrega${dashboard.notifications.failedInPeriod === 1 ? '' : 's'} fallida${dashboard.notifications.failedInPeriod === 1 ? '' : 's'}`, detail: 'Revisa la operación de correo del periodo.', href: '/staff/notifications?status=FAILED' }] : []),
  ] : [];

  return <PrivateSurfaceRoot className="staff-shell analytics-shell">
    <StaffHeader />
    <div className="staff-content analytics-content" aria-busy={loading}>
      <section className="analytics-hero" aria-labelledby="analytics-title"><div><p className="staff-kicker">Centro de operación</p><h1 id="analytics-title">Pulso <em>comercial</em></h1>{hydrated && !queuesLoading ? <p className="analytics-greeting"><strong>{greetingFor(new Date())}{firstName ? `, ${firstName}` : ''}.</strong> {summarySentence.charAt(0).toUpperCase() + summarySentence.slice(1)}</p> : <p className="staff-intro__copy">Una lectura compacta de la operación para decidir qué merece atención ahora.</p>}</div><div className="analytics-period"><p className="staff-section-label">Periodo de lectura</p><strong>{displayRange}</strong><span>Zona de negocio: {dashboard?.meta.timezone ?? '—'}</span><span>Actualizado {dashboard ? formatDate(dashboard.meta.generatedAt, dashboard.meta.timezone, true) : '—'}</span></div></section>

      <section className="analytics-controls" aria-label="Controles del periodo"><div className="analytics-presets"><span id="analytics-presets-label">Vista rápida</span><div className="analytics-presets__track" role="group" aria-labelledby="analytics-presets-label">{(['7', '30', '90'] as const).map((days) => <button key={days} className={selectedPreset === days ? 'is-selected' : ''} type="button" aria-pressed={selectedPreset === days} onClick={() => applyPreset(Number(days))} disabled={!draftTo}>{days} días</button>)}</div></div><div className="analytics-date-form"><PrivateDatePicker id="dashboard-from" label="Desde" required value={draftFrom} onValueChange={(value) => { rangeEdited.current = true; setDraftFrom(value); }} /><PrivateDatePicker id="dashboard-to" label="Hasta" required value={draftTo} onValueChange={(value) => { rangeEdited.current = true; setDraftTo(value); }} /><button className="staff-button staff-button--dark" type="button" onClick={applyCustomRange} disabled={!draftFrom || !draftTo || loading}>Aplicar periodo</button></div></section>

      {error && <p className="staff-error" role="alert">{error}</p>}

      {dashboard && <section className="analytics-kpis" aria-label="Indicadores principales"><article><span>Solicitudes recibidas</span><strong>{formatInteger(dashboard.requests.received)}</strong><small>Entradas del periodo</small></article><article><span>Cotizaciones enviadas</span><strong>{formatInteger(dashboard.quotes.sent)}</strong><small>{formatInteger(dashboard.quotes.accepted)} aceptadas</small></article><article><span>Tasa de aceptación</span><strong>{formatRate(dashboard.quotes.acceptanceRateBps)}</strong><small>{dashboard.quotes.acceptanceRateBps === null ? 'Aparece al enviar cotizaciones' : 'Sobre cotizaciones enviadas'}</small></article><article className="analytics-kpis__sold"><span>{dashboard.meta.scope === 'global' ? 'Vendido' : 'Vendiste'}</span>{soldPrimary ? <strong title={formatMinor(soldPrimary.totalMinor, soldPrimary.currencyCode)}>{compactMinor(soldPrimary.totalMinor)}<abbr title={soldPrimary.currencyCode === 'MXN' ? 'Pesos mexicanos' : soldPrimary.currencyCode}>{soldPrimary.currencyCode}</abbr></strong> : <strong>$0</strong>}<small>{soldPrimary ? `${plural(soldPrimary.count, 'aceptada', 'aceptadas')} · ${formatMinor(soldPrimary.totalMinor, soldPrimary.currencyCode)}${soldOthers.length ? ` + ${soldOthers.map((item) => formatMinor(item.totalMinor, item.currencyCode)).join(' + ')}` : ''}` : 'Sin cotizaciones aceptadas en el periodo'}</small></article></section>}

      <section className="staff-workqueue" aria-label="Qué atender ahora">
        <div className="staff-workqueue__title"><h2>Qué atender ahora</h2><span>Expedientes reales, ordenados por lo que más tiempo lleva esperando.</span></div>
        {queuesError && <p className="staff-error" role="alert">{queuesError}</p>}
        <div className="staff-workqueue__grid">
          <article className="staff-workqueue__card" aria-labelledby="workqueue-mine-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Asignado a ti</p><h3 id="workqueue-mine-title">Mi trabajo</h3></div><QueueCount value={mineQueue ? mineQueue.total : null} /></div>
            {queuesLoading && !mineQueue && <div className="staff-workqueue__loading" role="status"><span /><span /><span /></div>}
            {mineQueue && mineQueue.items.length === 0 && <p className="staff-workqueue__empty">No tienes solicitudes activas asignadas.</p>}
            {mineQueue && mineQueue.items.length > 0 && <ul className="staff-workqueue__list">{mineQueue.items.slice(0, 5).map((item) => <li key={item.id}><Link href={`/staff/requests?request=${item.id}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.client.displayName}</span><span className="staff-workqueue__stage">{labelForStatus(item.status)}</span><span className="staff-workqueue__age">{ageLabel(item.updatedAt)}</span></Link></li>)}</ul>}
            {mineQueue && mineQueue.total > 0 && <Link className="staff-workqueue__more" href="/staff/requests?view=mine">{mineQueue.total > 5 ? `Ver las ${formatInteger(mineQueue.total)} solicitudes →` : 'Abrir en Solicitudes →'}</Link>}
          </article>
          <article className="staff-workqueue__card" aria-labelledby="workqueue-unassigned-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Nadie las tiene todavía</p><h3 id="workqueue-unassigned-title">Sin asignar</h3></div><QueueCount value={unassignedQueue ? unassignedQueue.total : null} /></div>
            {queuesLoading && !unassignedQueue && <div className="staff-workqueue__loading" role="status"><span /><span /><span /></div>}
            {unassignedQueue && unassignedQueue.items.length === 0 && <p className="staff-workqueue__empty">No hay solicitudes sin asignar.</p>}
            {unassignedQueue && unassignedQueue.items.length > 0 && <ul className="staff-workqueue__list">{unassignedQueue.items.slice(0, 5).map((item) => <li key={item.id}><Link href={`/staff/requests?request=${item.id}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.client.displayName}</span><span className="staff-workqueue__stage">{labelForStatus(item.status)}</span><span className="staff-workqueue__age">{ageLabel(item.updatedAt)}</span></Link></li>)}</ul>}
            {unassignedQueue && unassignedQueue.total > 0 && <Link className="staff-workqueue__more" href="/staff/requests?view=unassigned">{unassignedQueue.total > 5 ? `Ver las ${formatInteger(unassignedQueue.total)} solicitudes →` : 'Asignar en Solicitudes →'}</Link>}
          </article>
          {customerReplied && customerReplied.length > 0 && <article className="staff-workqueue__card" aria-labelledby="workqueue-customer-replied-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Esperando tu respuesta</p><h3 id="workqueue-customer-replied-title">Cliente respondió</h3></div><QueueCount value={customerReplied ? customerReplied.length : null} /></div>
            <ul className="staff-workqueue__list">{customerReplied.slice(0, 5).map((item) => <li key={item.id}><Link href={`/staff/requests?request=${item.id}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.client.displayName}</span><span className="staff-workqueue__stage">{labelForStatus(item.status)}</span><span className="staff-workqueue__age">{ageLabel(item.lastCustomerMessageAt)}</span></Link></li>)}</ul>
            {customerReplied.length > 5 && <span className="staff-workqueue__more">Y {formatInteger(customerReplied.length - 5)} más esperando respuesta</span>}
          </article>}
          {pendingApprovals && pendingApprovals.length > 0 && <article className="staff-workqueue__card" aria-labelledby="workqueue-approvals-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Esperan tu decisión</p><h3 id="workqueue-approvals-title">Aprobaciones</h3></div><QueueCount value={pendingApprovals ? pendingApprovals.length : null} /></div>
            <ul className="staff-workqueue__list">{pendingApprovals.slice(0, 5).map((approval) => <li key={approval.id}><Link href={`/staff/quotes?request=${approval.requestId}`}><span className="staff-workqueue__folio">{approval.folio}</span><span className="staff-workqueue__client">{approval.clientDisplayName}</span><span className="staff-workqueue__stage">{APPROVAL_TYPE_LABELS[approval.type]} · {approvalMoneyLabel(approval.totalMinor, approval.currencyCode)}</span><span className="staff-workqueue__age">{ageLabel(approval.requestedAt)}</span></Link></li>)}</ul>
            <Link className="staff-workqueue__more" href="/staff/approvals">{pendingApprovals.length > 5 ? `Decidir las ${formatInteger(pendingApprovals.length)} en la cola →` : 'Decidir en la cola →'}</Link>
          </article>}
          {readyToPublish && readyToPublish.length > 0 && <article className="staff-workqueue__card" aria-labelledby="workqueue-ready-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Sólo falta el envío</p><h3 id="workqueue-ready-title">Listas para publicar</h3></div><QueueCount value={readyToPublish ? readyToPublish.length : null} /></div>
            <ul className="staff-workqueue__list">{readyToPublish.slice(0, 5).map((item) => <li key={item.versionId}><Link href={`/staff/quotes?request=${item.requestId}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.clientDisplayName}</span><span className="staff-workqueue__stage">V{item.versionNumber} · {approvalMoneyLabel(item.totalMinor, item.currencyCode)}</span><span className="staff-workqueue__age">{ageLabel(item.updatedAt)}</span></Link></li>)}</ul>
            {readyToPublish.length > 5 && <span className="staff-workqueue__more">Y {formatInteger(readyToPublish.length - 5)} más listas para publicar</span>}
          </article>}
          {projectsQueue && projectsQueue.total > 0 && <article className="staff-workqueue__card" aria-labelledby="workqueue-projects-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Después de la venta</p><h3 id="workqueue-projects-title">Proyectos en arranque</h3></div><QueueCount value={projectsQueue.total} /></div>
            <ul className="staff-workqueue__list">{projectsQueue.items.map((item) => <li key={item.id}><Link href={`/staff/projects/${item.id}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.client.displayName}</span><span className="staff-workqueue__stage">{item.owner ? item.owner.displayName : 'Sin responsable'} · {item.checklist.total ? `${item.checklist.completed}/${item.checklist.total} tareas` : 'Sin checklist'}</span><span className="staff-workqueue__age">{ageLabel(item.createdAt)}</span></Link></li>)}</ul>
            <Link className="staff-workqueue__more" href="/staff/projects">{projectsQueue.total > projectsQueue.items.length ? `Ver los ${formatInteger(projectsQueue.total)} proyectos →` : 'Ver proyectos →'}</Link>
          </article>}
          {failedNotifications && failedNotifications.items.length > 0 && <article className="staff-workqueue__card" aria-labelledby="workqueue-notification-failures-title">
            <div className="staff-workqueue__head"><div><p className="staff-section-label">Un cliente no recibió aviso</p><h3 id="workqueue-notification-failures-title">Fallos de aviso</h3></div><QueueCount value={failedNotifications ? failedNotifications.total : null} /></div>
            {/* Con expediente, la fila lleva a él (ahí están el contacto y la conversación para avisar al
                cliente); sin expediente, a la operación de notificaciones. */}
            <ul className="staff-workqueue__list">{failedNotifications.items.map((item) => <li key={item.id}><Link href={item.subject?.requestId ? `/staff/requests?request=${item.subject.requestId}` : '/staff/notifications?status=FAILED'}><span className="staff-workqueue__folio">{item.subject?.folio ?? eventLabel(item.eventType)}</span><span className="staff-workqueue__client">{item.subject?.clientDisplayName ?? templateLabel(item.templateKey)}</span><span className="staff-workqueue__stage">{item.subject ? `${templateLabel(item.templateKey)} · ` : ''}{item.errorCategory ? errorCategoryLabel(item.errorCategory) : 'Error de entrega'}</span><span className="staff-workqueue__age">{ageLabel(item.updatedAt)}</span></Link></li>)}</ul>
            <Link className="staff-workqueue__more" href="/staff/notifications?status=FAILED">{failedNotifications.total > failedNotifications.items.length ? `Ver los ${formatInteger(failedNotifications.total)} fallos →` : 'Revisar en Notificaciones →'}</Link>
          </article>}
        </div>
      </section>

      {loading && !dashboard && <div className="analytics-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Preparando lectura operativa…</strong></div>}
      {dashboard && <>
        <div className="analytics-section-title"><h2>Lectura del periodo</h2><span>{displayRange}</span></div>


        <section className="analytics-section-grid analytics-section-grid--first"><article className="analytics-panel analytics-panel--alert" aria-labelledby="analytics-alerts-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Atención inmediata</p><h3 id="analytics-alerts-title">Señales de operación</h3></div><span className="analytics-panel__index">01</span></div>{alerts.length === 0 ? <div className="analytics-clear"><span aria-hidden="true">✓</span><div><strong>Sin alertas nuevas en este periodo</strong><p>No hubo solicitudes recién sin asignar ni entregas fallidas nuevas. Esto no cuenta lo ya pendiente — revisa &quot;Mi trabajo&quot; y &quot;Sin asignar&quot; abajo.</p></div></div> : <ul className="analytics-alert-list">{alerts.map((alert) => <li key={alert.label}><span className="analytics-alert-list__dot" aria-hidden="true" /><div><strong>{alert.label}</strong><p>{alert.detail}</p></div><Link href={alert.href}>Revisar</Link></li>)}</ul>}</article><article className="analytics-panel" aria-labelledby="analytics-pipeline-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Flujo de entrada</p><h3 id="analytics-pipeline-title">Pipeline de solicitudes</h3></div><span className="analytics-panel__index">02</span></div><BarList items={pipeline} label="Solicitudes por estado" empty="No hay solicitudes en este periodo." /></article></section>

        <section className="analytics-section-grid"><article className="analytics-panel" aria-labelledby="analytics-aging-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Tiempo abierto</p><h3 id="analytics-aging-title">Antigüedad</h3></div><span className="analytics-panel__index">03</span></div><BarList items={aging} label="Solicitudes por antigüedad" empty="Sin antigüedad que mostrar." /></article><article className="analytics-panel" aria-labelledby="analytics-timing-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Ritmo de respuesta</p><h3 id="analytics-timing-title">Tiempos protegidos</h3></div><span className="analytics-panel__index">04</span></div><ul className="analytics-metrics"><MetricLine label="Asignación" metric={dashboard.timing.assignment} /><MetricLine label="Envío de cotización" metric={dashboard.timing.quoteSent} /><MetricLine label="Aceptación" metric={dashboard.timing.acceptance} /></ul></article></section>

        <section className="analytics-section-grid analytics-section-grid--lower"><article className="analytics-panel" aria-labelledby="analytics-origin-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Procedencia</p><h3 id="analytics-origin-title">Origen de solicitudes</h3></div><span className="analytics-panel__index">05</span></div><BarList items={origins} label="Solicitudes por origen" empty="Sin origen que mostrar." /></article><article className="analytics-panel" aria-labelledby="analytics-notifications-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Entrega transaccional</p><h3 id="analytics-notifications-title">Salud de notificaciones</h3></div><Link className="analytics-panel__link" href="/staff/notifications">Abrir operación</Link></div><BarList items={notificationStatus} label="Entregas por estado" empty="No hay entregas registradas." /><p className="analytics-panel__note">Pendiente más antigua: {formatDate(dashboard.notifications.oldestPendingAt, dashboard.meta.timezone, true)} · Fallidas en periodo: {formatInteger(dashboard.notifications.failedInPeriod)}</p></article></section>

        {/* En el alcance propio la tabla sólo tenía una fila (la propia) y con "Muestra protegida" en
            todas sus celdas; "Mi trabajo" ya responde eso. Es una lectura para gerencia. */}
        {dashboard.meta.scope === 'global' && <section className="analytics-workload" aria-labelledby="analytics-workload-title"><div className="analytics-workload__heading"><div><p className="staff-section-label">Distribución de trabajo</p><h3 id="analytics-workload-title">Carga por responsable</h3><p>La identidad visible se limita al personal operativo. Las muestras pequeñas permanecen protegidas.</p></div><span className="analytics-workload__scope">{dashboard.meta.scope === 'global' ? 'Vista global' : 'Tu alcance'}</span></div>{dashboard.workload.length === 0 ? <div className="analytics-empty"><strong>Sin carga abierta visible.</strong><p>Las solicitudes y cotizaciones activas aparecerán cuando exista actividad asignada.</p></div> : <div className="analytics-workload-table" role="table" aria-label="Carga por responsable"><div className="analytics-workload-table__row analytics-workload-table__row--head" role="row"><span role="columnheader">Responsable</span><span role="columnheader">Solicitudes activas</span><span role="columnheader">Borradores</span><span role="columnheader">Más antigua</span></div>{dashboard.workload.map((row) => <div className="analytics-workload-table__row" role="row" key={row.actorKey}><strong role="rowheader">{row.displayName}</strong>{row.suppressed ? <><span className="is-suppressed" role="cell">Muestra protegida</span><span className="is-suppressed" role="cell">Muestra protegida</span><span className="is-suppressed" role="cell">Muestra protegida</span></> : <><span role="cell">{formatInteger(row.activeRequests)}</span><span role="cell">{formatInteger(row.draftQuotes)}</span><span role="cell">{formatDate(row.oldestOpenAt, dashboard.meta.timezone)}</span></>}</div>)}</div>}</section>}
      </>}
    </div>
  </PrivateSurfaceRoot>;
}
