'use client';

import { Inbox, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import { statusToneIcon } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';
import { relativeTimeLabel } from '@/lib/relative-time';
import { usePersistentState } from '@/lib/use-persistent-state';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivatePagination, PrivateSelect } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { errorCategoryLabel, eventLabel, templateLabel } from '@/lib/notification-labels';

const STATUS_OPTIONS = ['', 'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const;
type NotificationStatus = (typeof STATUS_OPTIONS)[number];

type NotificationItem = {
  id: string;
  channel: string;
  status: Exclude<NotificationStatus, ''>;
  templateKey: string;
  templateVersion: string;
  attempts: number;
  availableAt: string;
  processingStartedAt: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  errorCategory: string | null;
  cancelReason: string | null;
  ageSeconds: number;
  retryable: boolean;
  eventType: string;
  aggregateType: string;
};

type Health = {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  cancelled: number;
  oldestPendingAt: string | null;
  oldestProcessingAt: string | null;
  oldestFailedAt: string | null;
};

type ListResponse = {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  health: Health;
};

const STATUS_LABELS: Record<Exclude<NotificationStatus, ''>, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'En proceso',
  SENT: 'Enviado',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado',
};

function statusLabel(status: NotificationStatus): string {
  return status ? STATUS_LABELS[status] : 'Todos los estados';
}

function StatusPill({ status }: { status: Exclude<NotificationStatus, ''> }) {
  const ToneIcon = statusToneIcon(status);
  return <span className={`staff-status-pill staff-status-pill--${status.toLowerCase()}`}><ToneIcon size={11} aria-hidden="true" />{statusLabel(status)}</span>;
}

function errorLabel(value: string | null): string {
  return errorCategoryLabel(value);
}

const CANCEL_REASON_LABELS: Record<string, string> = {
  UNSUPPORTED_EVENT: 'Evento no soportado',
  INVALID_PAYLOAD: 'Datos inválidos',
  INVALID_RECIPIENT: 'Destinatario inválido',
  INVALID_RECIPIENT_SCOPE: 'Destinatario fuera de alcance',
  INTERNAL_VISIBILITY: 'Nota interna, sin envío',
  NO_RECIPIENT: 'Sin destinatario',
  CONTACT_EMAIL_CHANGED: 'Correo de contacto corregido',
};

function cancelReasonLabel(value: string | null): string {
  return value ? (CANCEL_REASON_LABELS[value] ?? value) : 'Sin motivo registrado';
}

// Una entrega CANCELLED nunca llega a intentar el envío, así que `errorCategory` siempre es null
// para ella -- mostrar `errorLabel` ahí daba "Sin error" para las siete causas reales y distintas
// de cancelación (contacto corregido, evento no soportado, destinatario fuera de alcance, etc.),
// ocultando exactamente el motivo que el staff necesita para diagnosticar por qué un cliente no
// recibió un aviso.
function diagnosisLabel(item: NotificationItem): string {
  return item.status === 'CANCELLED' ? cancelReasonLabel(item.cancelReason) : errorLabel(item.errorCategory);
}

type HealthTile = { key: 'pending' | 'processing' | 'failed' | 'sent'; status: Exclude<NotificationStatus, ''>; label: string; oldest: (health: Health) => string | null };

const HEALTH_TILES: readonly HealthTile[] = [
  { key: 'pending', status: 'PENDING', label: 'Pendientes', oldest: (health) => health.oldestPendingAt },
  { key: 'processing', status: 'PROCESSING', label: 'En proceso', oldest: (health) => health.oldestProcessingAt },
  { key: 'failed', status: 'FAILED', label: 'Fallidas', oldest: (health) => health.oldestFailedAt },
  { key: 'sent', status: 'SENT', label: 'Enviadas', oldest: () => null },
];

const EMPTY_COPY: Partial<Record<NotificationStatus, { title: string; body: string }>> = {
  FAILED: { title: 'No hay entregas fallidas.', body: 'Todos los avisos se entregaron o ya se recuperaron.' },
  PENDING: { title: 'La cola está al día.', body: 'No hay avisos esperando envío.' },
  PROCESSING: { title: 'Nada en proceso ahora mismo.', body: 'Los envíos en curso aparecerán aquí mientras se procesan.' },
};

function formatAge(seconds: number): string {
  if (seconds < 60) return 'Hace menos de un minuto';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return `Hace ${Math.floor(hours / 24)} d`;
}

export default function StaffNotificationsPanel() {
  const [statusFilter, setStatusFilter, statusFilterHydrated] = usePersistentState<NotificationStatus>('ocpool.staff.notifications.statusFilter', '');
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState(1);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [, setClockTick] = useState(0);

  // Reloj de 30 s sólo para refrescar las etiquetas relativas ("Actualizado hace 2 min").
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((current) => current + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // La confirmación flota (ver CSS) y se retira sola; los errores se quedan hasta la siguiente acción.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!statusFilterHydrated) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (statusFilter) params.set('status', statusFilter);
        const response = await fetch(`/api/staff/notifications?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const result = await readApiResponse<ListResponse>(response, 'No fue posible actualizar las notificaciones.');
        if (!result.ok) {
          if (result.kind === 'forbidden') setAccessDenied(true);
          throw new Error(result.message);
        }
        setAccessDenied(false);
        setData(result.data);
        setLastLoadedAt(new Date().toISOString());
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'No fue posible actualizar las notificaciones.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [page, reloadToken, statusFilter, statusFilterHydrated]);

  const refresh = () => setReloadToken((current) => current + 1);

  const retry = async (item: NotificationItem) => {
    setRetryingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/notifications/${item.id}/retry`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const retryResult = await readApiResponseOrThrow<{ outcome: 'REQUEUED' | 'ALREADY_PENDING' }>(response, 'No fue posible reintentar la entrega.');
      setNotice(retryResult.outcome === 'REQUEUED' ? 'La entrega fue devuelta a la cola.' : 'La entrega ya estaba pendiente y no se duplicó.');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible reintentar la entrega.');
    } finally {
      setRetryingId(null);
    }
  };

  const applyStatus = (value: NotificationStatus) => { setNotice(null); setPage(1); setStatusFilter(value); };

  // Tras una caída del proveedor suele haber varias fallidas reintentables: se devuelven a la cola
  // de una en una con el mismo endpoint (idempotente: una ya pendiente no se duplica).
  const retryAllVisible = async (targets: NotificationItem[]) => {
    setBulkRetrying(true);
    setError(null);
    setNotice(null);
    let requeued = 0;
    let failures = 0;
    for (const item of targets) {
      try {
        const response = await fetch(`/api/staff/notifications/${item.id}/retry`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
        const result = await readApiResponseOrThrow<{ outcome: 'REQUEUED' | 'ALREADY_PENDING' }>(response, 'No fue posible reintentar la entrega.');
        if (result.outcome === 'REQUEUED') requeued += 1;
      } catch {
        failures += 1;
      }
    }
    const requeuedText = `${requeued} entrega${requeued === 1 ? '' : 's'} devuelta${requeued === 1 ? '' : 's'} a la cola.`;
    if (failures) setError(`${requeuedText} ${failures} ${failures === 1 ? 'no se pudo' : 'no se pudieron'} reintentar; revisa su diagnóstico.`);
    else setNotice(requeuedText);
    setBulkRetrying(false);
    refresh();
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Necesitas una cuenta de empleado con permiso de notificaciones para consultar esta operación.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const health = data?.health;
  const items = data?.items ?? [];
  const retryableItems = items.filter((item) => item.retryable);
  const emptyCopy = EMPTY_COPY[statusFilter] ?? { title: 'No hay entregas en esta vista.', body: 'Cuando existan notificaciones con este estado aparecerán aquí con su diagnóstico operativo.' };

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />

      <div className="staff-content staff-notifications">
        <div className="staff-intro">
          <div><p className="staff-kicker">Entrega transaccional</p><h1>Notificaciones</h1><p className="staff-intro__copy">Diagnóstico seguro de la cola de correo, sin exponer destinatarios ni contenido privado.</p></div>
        </div>

        {notice && <p className="staff-notice" role="status">{notice}</p>}
        {error && <p className="staff-error" role="alert">{error}</p>}

        <section className="staff-notification-health" aria-label="Salud de la cola de notificaciones">
          {HEALTH_TILES.map((tile) => {
            const value = health?.[tile.key] ?? 0;
            const oldest = health ? tile.oldest(health) : null;
            const selected = statusFilter === tile.status;
            // Cada indicador también es el filtro: un clic muestra justo esas entregas (y otro lo quita).
            return <button type="button" className={`staff-notification-health__item staff-notification-health__item--${tile.key}${selected ? ' is-selected' : ''}`} key={tile.key} aria-pressed={selected} onClick={() => applyStatus(selected ? '' : tile.status)}>
              <span>{tile.label}</span><strong>{loading && !data ? '—' : value}</strong>
              <small>{oldest && value > 0 ? `La más antigua: ${relativeTimeLabel(oldest).toLowerCase()}` : selected ? 'Filtro activo · quitar' : 'Ver sólo estas'}</small>
            </button>;
          })}
        </section>

        <section className="staff-notification-workspace" aria-label="Cola de notificaciones">
          <div className="staff-notification-toolbar">
            <PrivateSelect key={statusFilterHydrated ? 'hydrated' : 'pending'} id="notification-status" optionalHint={false} label="Filtrar por estado" value={statusFilter} onValueChange={(value) => applyStatus(value as NotificationStatus)} options={STATUS_OPTIONS.slice(1).map((status) => ({ value: status, label: statusLabel(status) }))} placeholder="Todos los estados" />
            <div className="staff-notification-toolbar__summary"><span>{loading ? 'Actualizando…' : `${data?.total ?? 0} entrega${data?.total === 1 ? '' : 's'}`}</span><small>{lastLoadedAt ? `Actualizado ${relativeTimeLabel(lastLoadedAt).toLowerCase()}` : 'Consultando la cola…'}</small></div>
            <div className="staff-notification-toolbar__actions">
              {retryableItems.length > 1 && <button className="staff-button staff-button--copper" type="button" disabled={bulkRetrying || retryingId !== null} onClick={() => void retryAllVisible(retryableItems)}>{bulkRetrying ? 'Reintentando…' : `Reintentar las ${retryableItems.length} reintentables`}</button>}
              <button className="staff-button staff-button--outline staff-notification-toolbar__refresh" type="button" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />Actualizar</button>
            </div>
          </div>

          <div className="staff-notification-list" aria-live="polite">
            {/* UX audit fix: un reintento individual disparaba setData(null) y esta sección entera
                se reemplazaba por el esqueleto, perdiendo de vista el resto de la cola por una sola
                fila. Ahora sólo el primer cargado (sin datos previos) muestra el esqueleto; un
                refresco de fondo conserva la lista visible mientras "Actualizando…" ya lo indica
                en la barra de herramientas de arriba. */}
            {loading && !data && <div className="staff-notification-loading" role="status"><span /><span /><span /><b>Consultando la cola…</b></div>}
            {!(loading && !data) && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>{emptyCopy.title}</h2><p>{emptyCopy.body}</p>{statusFilter && <button type="button" className="staff-button" onClick={() => applyStatus('')}>Ver todas las entregas</button>}</div>}
            {items.length > 0 && <ul>{items.map((item) => <li className={`staff-notification-row staff-notification-row--${item.status.toLowerCase()}`} key={item.id}>
              <div className="staff-notification-row__identity"><StatusPill status={item.status} /><strong>{templateLabel(item.templateKey)}</strong><small>{eventLabel(item.eventType)} · <code>{item.templateKey}</code></small></div>
              <dl className="staff-notification-row__facts"><div><dt>Intentos</dt><dd>{item.attempts}</dd></div><div><dt>Antigüedad</dt><dd>{formatAge(item.ageSeconds)}</dd></div><div><dt>Actualizada</dt><dd><time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>{relativeTimeLabel(item.updatedAt)}</time></dd></div><div><dt>Diagnóstico</dt><dd>{diagnosisLabel(item)}</dd></div></dl>
              <div className="staff-notification-row__action">{item.retryable ? <button className="staff-button staff-button--copper" type="button" disabled={retryingId === item.id || bulkRetrying} onClick={() => void retry(item)}>{retryingId === item.id ? 'Reintentando…' : 'Reintentar entrega'}</button> : <span>{item.status === 'FAILED' ? 'Requiere corrección técnica' : 'Sin acción manual'}</span>}</div>
            </li>)}</ul>}
          </div>
          {data && data.totalPages > 1 && <PrivatePagination page={data.page} totalPages={data.totalPages} disabled={loading} onPrevious={() => setPage((current) => Math.max(1, current - 1))} onNext={() => setPage((current) => current + 1)} />}
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
