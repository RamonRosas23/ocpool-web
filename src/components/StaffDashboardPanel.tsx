'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDatePicker, PrivateLinkButton } from '@/components/private/ui';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/request-workspace-query';
import { readApiResponse } from '@/lib/api-response-error';

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

function ageLabel(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'Actualizada hoy';
  if (days === 1) return 'Hace 1 día';
  return `Hace ${days} días`;
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

function formatMinor(minor: string, currencyCode: string): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = new Intl.NumberFormat('es-MX').format(absolute / 100n);
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${currencyCode} ${whole}.${fraction}`;
}

function BarList({ items, label, empty }: { items: Array<{ label: string; count: number }>; label: string; empty: string }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  if (items.length === 0) return <div className="analytics-empty"><strong>{empty}</strong><p>Cuando existan movimientos dentro del periodo aparecerán aquí.</p></div>;
  return <ul className="analytics-bars" aria-label={label}>{items.map((item) => <li key={item.label}><div className="analytics-bars__meta"><span>{item.label}</span><strong>{formatInteger(item.count)}</strong></div><div className="analytics-bars__track" aria-hidden="true"><span style={{ width: `${Math.max((item.count / max) * 100, item.count ? 4 : 0)}%` }} /></div></li>)}</ul>;
}

function MetricLine({ label, metric }: { label: string; metric: MetricSummary }) {
  return <li className={metric.suppressed ? 'is-suppressed' : undefined}><span>{label}</span><strong>{metric.suppressed ? 'Muestra protegida' : `P50 ${formatDuration(metric.p50Seconds)}`}</strong><small>{metric.suppressed ? 'Se requieren al menos 5 observaciones.' : `P90 ${formatDuration(metric.p90Seconds)} · n=${formatInteger(metric.sampleSize)}`}</small></li>;
}

export default function StaffDashboardPanel() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [query, setQuery] = useState<DashboardQuery>({});
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const rangeInitialized = useRef(false);
  const rangeEdited = useRef(false);
  const [mineQueue, setMineQueue] = useState<QueueResponse | null>(null);
  const [unassignedQueue, setUnassignedQueue] = useState<QueueResponse | null>(null);
  const [queuesLoading, setQueuesLoading] = useState(true);

  // W1-02 (primer corte): "qué atender ahora" reutiliza el mismo endpoint y scope de R1 (mine/sin
  // asignar) — sin score opaco, cada fila es un expediente real con enlace directo al expediente exacto.
  useEffect(() => {
    const controller = new AbortController();
    const loadQueues = async () => {
      setQueuesLoading(true);
      try {
        // El scope "workspace" (view=mine/unassigned) fija su propio pageSize=20 en el servidor;
        // se toman sólo los primeros 5 para esta lectura compacta y `total` informa el resto.
        const [mineResponse, unassignedResponse] = await Promise.all([
          fetch('/api/staff/quote-requests?view=mine&sort=stale', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch('/api/staff/quote-requests?view=unassigned&sort=stale', { credentials: 'include', cache: 'no-store', signal: controller.signal }),
        ]);
        const [mineResult, unassignedResult] = await Promise.all([
          readApiResponse<QueueResponse>(mineResponse, 'No fue posible cargar tu trabajo.'),
          readApiResponse<QueueResponse>(unassignedResponse, 'No fue posible cargar las solicitudes sin asignar.'),
        ]);
        if (mineResult.ok) setMineQueue(mineResult.data);
        if (unassignedResult.ok) setUnassignedQueue(unassignedResult.data);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
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
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadToken]);

  const applyPreset = (days: number) => {
    if (!draftTo) return;
    const end = new Date(`${draftTo}T00:00:00.000Z`);
    const start = new Date(end.getTime() - days * 86_400_000);
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
  const pipeline = dashboard?.requests.byStatus.map((item) => ({ label: labelForStatus(item.status), count: item.count })) ?? [];
  const origins = dashboard?.requests.byOrigin.map((item) => ({ label: labelForOrigin(item.origin), count: item.count })) ?? [];
  const aging = dashboard?.requests.aging.map((item) => ({ label: `${item.bucket} días`, count: item.count })) ?? [];
  const notificationStatus = dashboard?.notifications.byStatus.filter((item) => item.count > 0).map((item) => ({ label: NOTIFICATION_LABELS[item.status] ?? item.status, count: item.count })) ?? [];
  const alerts = dashboard ? [
    ...(dashboard.requests.unassigned > 0 ? [{ label: `${formatInteger(dashboard.requests.unassigned)} solicitud${dashboard.requests.unassigned === 1 ? '' : 'es'} sin asignar`, detail: 'Requieren responsable para avanzar.', href: '/staff/requests' }] : []),
    ...(dashboard.notifications.failedInPeriod > 0 ? [{ label: `${formatInteger(dashboard.notifications.failedInPeriod)} entrega${dashboard.notifications.failedInPeriod === 1 ? '' : 's'} fallida${dashboard.notifications.failedInPeriod === 1 ? '' : 's'}`, detail: 'Revisa la operación de correo del periodo.', href: '/staff/notifications' }] : []),
  ] : [];

  return <PrivateSurfaceRoot className="staff-shell analytics-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><nav className="analytics-nav" aria-label="Navegación de operaciones"><Link href="/staff" aria-current="page">Dashboard</Link><Link href="/staff/requests">Solicitudes</Link><Link href="/staff/quotes">Cotizaciones</Link><Link href="/staff/catalog">Catálogo</Link><Link href="/staff/notifications">Notificaciones</Link><Link href="/staff/audit">Auditoría</Link></nav><div className="staff-header__tools"><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Lectura operativa</div></div></header>
    <div className="staff-content analytics-content" aria-busy={loading}>
      <section className="analytics-hero" aria-labelledby="analytics-title"><div><p className="staff-kicker">Centro de operación</p><h1 id="analytics-title">Pulso <em>comercial</em></h1><p className="staff-intro__copy">Una lectura compacta de la operación para decidir qué merece atención ahora.</p></div><div className="analytics-period"><p className="staff-section-label">Periodo de lectura</p><strong>{displayRange}</strong><span>Zona de negocio: {dashboard?.meta.timezone ?? '—'}</span><span>Actualizado {dashboard ? formatDate(dashboard.meta.generatedAt, dashboard.meta.timezone, true) : '—'}</span></div></section>

      <section className="analytics-controls" aria-label="Controles del periodo"><div className="analytics-presets"><span>Vista rápida</span><button className={selectedPreset === '7' ? 'is-selected' : ''} type="button" onClick={() => applyPreset(7)} disabled={!draftTo}>7 días</button><button className={selectedPreset === '30' ? 'is-selected' : ''} type="button" onClick={() => applyPreset(30)} disabled={!draftTo}>30 días</button><button className={selectedPreset === '90' ? 'is-selected' : ''} type="button" onClick={() => applyPreset(90)} disabled={!draftTo}>90 días</button></div><div className="analytics-date-form"><PrivateDatePicker id="dashboard-from" label="Desde" required value={draftFrom} onValueChange={(value) => { rangeEdited.current = true; setDraftFrom(value); }} /><PrivateDatePicker id="dashboard-to" label="Hasta" required value={draftTo} onValueChange={(value) => { rangeEdited.current = true; setDraftTo(value); }} /><button className="staff-button staff-button--dark" type="button" onClick={applyCustomRange} disabled={!draftFrom || !draftTo || loading}>Aplicar periodo</button></div></section>

      {error && <p className="staff-error" role="alert">{error}</p>}

      <section className="staff-workqueue" aria-label="Qué atender ahora">
        <div className="staff-workqueue__grid">
          <article className="staff-workqueue__card" aria-labelledby="workqueue-mine-title">
            <div className="staff-workqueue__head"><p className="staff-section-label">Asignado a ti</p><h2 id="workqueue-mine-title">Mi trabajo</h2></div>
            {queuesLoading && !mineQueue && <div className="staff-workqueue__loading" role="status"><span /><span /><span /></div>}
            {mineQueue && mineQueue.items.length === 0 && <p className="staff-workqueue__empty">No tienes solicitudes activas asignadas.</p>}
            {mineQueue && mineQueue.items.length > 0 && <ul className="staff-workqueue__list">{mineQueue.items.slice(0, 5).map((item) => <li key={item.id}><Link href={`/staff/requests?request=${item.id}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.client.displayName}</span><span className="staff-workqueue__stage">{labelForStatus(item.status)}</span><span className="staff-workqueue__age">{ageLabel(item.updatedAt)}</span></Link></li>)}</ul>}
            {mineQueue && mineQueue.total > 5 && <Link className="staff-workqueue__more" href="/staff/requests">Ver las {formatInteger(mineQueue.total)} solicitudes →</Link>}
          </article>
          <article className="staff-workqueue__card" aria-labelledby="workqueue-unassigned-title">
            <div className="staff-workqueue__head"><p className="staff-section-label">Nadie las tiene todavía</p><h2 id="workqueue-unassigned-title">Sin asignar</h2></div>
            {queuesLoading && !unassignedQueue && <div className="staff-workqueue__loading" role="status"><span /><span /><span /></div>}
            {unassignedQueue && unassignedQueue.items.length === 0 && <p className="staff-workqueue__empty">No hay solicitudes sin asignar.</p>}
            {unassignedQueue && unassignedQueue.items.length > 0 && <ul className="staff-workqueue__list">{unassignedQueue.items.slice(0, 5).map((item) => <li key={item.id}><Link href={`/staff/requests?request=${item.id}`}><span className="staff-workqueue__folio">{item.folio}</span><span className="staff-workqueue__client">{item.client.displayName}</span><span className="staff-workqueue__stage">{labelForStatus(item.status)}</span><span className="staff-workqueue__age">{ageLabel(item.updatedAt)}</span></Link></li>)}</ul>}
            {unassignedQueue && unassignedQueue.total > 5 && <Link className="staff-workqueue__more" href="/staff/requests">Ver las {formatInteger(unassignedQueue.total)} solicitudes →</Link>}
          </article>
        </div>
      </section>

      {loading && !dashboard && <div className="analytics-loading" role="status" aria-live="polite"><span /><span /><span /><strong>Preparando lectura operativa…</strong></div>}
      {dashboard && <>
        <section className="analytics-kpis" aria-label="Indicadores principales"><article><span>Solicitudes recibidas</span><strong>{formatInteger(dashboard.requests.received)}</strong><small>Entradas del periodo</small></article><article><span>Cotizaciones enviadas</span><strong>{formatInteger(dashboard.quotes.sent)}</strong><small>{formatInteger(dashboard.quotes.accepted)} aceptadas</small></article><article><span>Tasa de aceptación</span><strong>{formatRate(dashboard.quotes.acceptanceRateBps)}</strong><small>Sobre cotizaciones enviadas</small></article><article className={dashboard.requests.unassigned ? 'has-alert' : undefined}><span>Sin asignar</span><strong>{formatInteger(dashboard.requests.unassigned)}</strong><small>{dashboard.requests.unassigned ? 'Atención requerida' : 'Sin pendientes'}</small></article></section>

        <section className="analytics-section-grid analytics-section-grid--first"><article className="analytics-panel analytics-panel--alert" aria-labelledby="analytics-alerts-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Atención inmediata</p><h2 id="analytics-alerts-title">Señales de operación</h2></div><span className="analytics-panel__index">01</span></div>{alerts.length === 0 ? <div className="analytics-clear"><span aria-hidden="true">✓</span><div><strong>Sin alertas críticas</strong><p>La operación no reporta bloqueos en este periodo.</p></div></div> : <ul className="analytics-alert-list">{alerts.map((alert) => <li key={alert.label}><span className="analytics-alert-list__dot" aria-hidden="true" /><div><strong>{alert.label}</strong><p>{alert.detail}</p></div><Link href={alert.href}>Revisar</Link></li>)}</ul>}</article><article className="analytics-panel" aria-labelledby="analytics-pipeline-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Flujo de entrada</p><h2 id="analytics-pipeline-title">Pipeline de solicitudes</h2></div><span className="analytics-panel__index">02</span></div><BarList items={pipeline} label="Solicitudes por estado" empty="No hay solicitudes en este periodo." /></article></section>

        <section className="analytics-section-grid"><article className="analytics-panel" aria-labelledby="analytics-aging-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Tiempo abierto</p><h2 id="analytics-aging-title">Antigüedad</h2></div><span className="analytics-panel__index">03</span></div><BarList items={aging} label="Solicitudes por antigüedad" empty="Sin antigüedad que mostrar." /></article><article className="analytics-panel" aria-labelledby="analytics-timing-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Ritmo de respuesta</p><h2 id="analytics-timing-title">Tiempos protegidos</h2></div><span className="analytics-panel__index">04</span></div><ul className="analytics-metrics"><MetricLine label="Asignación" metric={dashboard.timing.assignment} /><MetricLine label="Envío de cotización" metric={dashboard.timing.quoteSent} /><MetricLine label="Aceptación" metric={dashboard.timing.acceptance} /></ul></article></section>

        <section className="analytics-section-grid analytics-section-grid--lower"><article className="analytics-panel" aria-labelledby="analytics-origin-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Procedencia</p><h2 id="analytics-origin-title">Origen de solicitudes</h2></div><span className="analytics-panel__index">05</span></div><BarList items={origins} label="Solicitudes por origen" empty="Sin origen que mostrar." /><div className="analytics-submetric"><span>Cotizaciones aceptadas</span><strong>{dashboard.quotes.acceptedTotals.length ? dashboard.quotes.acceptedTotals.map((item) => `${formatMinor(item.totalMinor, item.currencyCode)} · ${item.count}`).join(' / ') : 'Sin importes en el periodo'}</strong></div></article><article className="analytics-panel" aria-labelledby="analytics-notifications-title"><div className="analytics-panel__heading"><div><p className="staff-section-label">Entrega transaccional</p><h2 id="analytics-notifications-title">Salud de notificaciones</h2></div><Link className="analytics-panel__link" href="/staff/notifications">Abrir operación</Link></div><BarList items={notificationStatus} label="Entregas por estado" empty="No hay entregas registradas." /><p className="analytics-panel__note">Pendiente más antigua: {formatDate(dashboard.notifications.oldestPendingAt, dashboard.meta.timezone, true)} · Fallidas en periodo: {formatInteger(dashboard.notifications.failedInPeriod)}</p></article></section>

        <section className="analytics-workload" aria-labelledby="analytics-workload-title"><div className="analytics-workload__heading"><div><p className="staff-section-label">Distribución de trabajo</p><h2 id="analytics-workload-title">Carga por responsable</h2><p>La identidad visible se limita al personal operativo. Las muestras pequeñas permanecen protegidas.</p></div><span className="analytics-workload__scope">{dashboard.meta.scope === 'global' ? 'Vista global' : 'Tu alcance'}</span></div>{dashboard.workload.length === 0 ? <div className="analytics-empty"><strong>Sin carga abierta visible.</strong><p>Las solicitudes y cotizaciones activas aparecerán cuando exista actividad asignada.</p></div> : <div className="analytics-workload-table" role="table" aria-label="Carga por responsable"><div className="analytics-workload-table__row analytics-workload-table__row--head" role="row"><span role="columnheader">Responsable</span><span role="columnheader">Solicitudes activas</span><span role="columnheader">Borradores</span><span role="columnheader">Más antigua</span></div>{dashboard.workload.map((row) => <div className="analytics-workload-table__row" role="row" key={row.actorKey}><strong role="rowheader">{row.displayName}</strong>{row.suppressed ? <><span className="is-suppressed" role="cell">Muestra protegida</span><span className="is-suppressed" role="cell">Muestra protegida</span><span className="is-suppressed" role="cell">Muestra protegida</span></> : <><span role="cell">{formatInteger(row.activeRequests)}</span><span role="cell">{formatInteger(row.draftQuotes)}</span><span role="cell">{formatDate(row.oldestOpenAt, dashboard.meta.timezone)}</span></>}</div>)}</div>}</section>
      </>}
    </div>
  </PrivateSurfaceRoot>;
}
