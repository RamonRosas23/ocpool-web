'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SelectField from '@/components/SelectField';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton } from '@/components/private/ui';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';

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

const ERROR_LABELS: Record<string, string> = {
  TEMPORARY_PROVIDER: 'Proveedor temporal',
  RATE_LIMIT: 'Límite del proveedor',
  INVALID_RECIPIENT: 'Destinatario inválido',
  TEMPLATE_ERROR: 'Plantilla inválida',
  CONFIGURATION: 'Configuración',
  OTHER: 'Error controlado',
};

function statusLabel(status: NotificationStatus): string {
  return status ? STATUS_LABELS[status] : 'Todos los estados';
}

function errorLabel(value: string | null): string {
  return value ? (ERROR_LABELS[value] ?? 'Error controlado') : 'Sin error';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatAge(seconds: number): string {
  if (seconds < 60) return 'Hace menos de un minuto';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return `Hace ${Math.floor(hours / 24)} d`;
}

export default function StaffNotificationsPanel() {
  const [statusFilter, setStatusFilter] = useState<NotificationStatus>('');
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
        const response = await fetch(`/api/staff/notifications${query}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const result = await readApiResponse<ListResponse>(response, 'No fue posible actualizar las notificaciones.');
        if (!result.ok) {
          if (result.kind === 'forbidden') setAccessDenied(true);
          throw new Error(result.message);
        }
        setAccessDenied(false);
        setData(result.data);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'No fue posible actualizar las notificaciones.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reloadToken, statusFilter]);

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
      setData(null);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible reintentar la entrega.');
    } finally {
      setRetryingId(null);
    }
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell"><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>Necesitas una cuenta de empleado con permiso de notificaciones para consultar esta operación.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const health = data?.health;
  const items = data?.items ?? [];

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <header className="staff-header">
        <WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" />
        <div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Operación de notificaciones</div></div>
      </header>

      <div className="staff-content staff-notifications">
        <div className="staff-intro">
          <div><p className="staff-kicker">Entrega transaccional</p><h1>Notificaciones</h1><p className="staff-intro__copy">Diagnóstico seguro de la cola de correo, sin exponer destinatarios ni contenido privado.</p></div>
          <Link className="staff-button staff-button--dark" href="/staff/requests">Volver a solicitudes</Link>
        </div>

        {notice && <p className="staff-notice" role="status">{notice}</p>}
        {error && <p className="staff-error" role="alert">{error}</p>}

        <section className="staff-notification-health" aria-label="Salud de la cola de notificaciones">
          {([
            ['pending', 'Pendientes', health?.pending ?? 0],
            ['processing', 'En proceso', health?.processing ?? 0],
            ['failed', 'Fallidas', health?.failed ?? 0],
            ['sent', 'Enviadas', health?.sent ?? 0],
          ] as const).map(([key, label, value]) => <div className={`staff-notification-health__item staff-notification-health__item--${key}`} key={key}><span>{label}</span><strong>{loading && !data ? '—' : value}</strong></div>)}
        </section>

        <section className="staff-notification-workspace" aria-label="Cola de notificaciones">
          <div className="staff-notification-toolbar">
            <label htmlFor="notification-status"><span>Filtrar por estado</span><SelectField id="notification-status" ariaLabel="Filtrar por estado" value={statusFilter} onValueChange={(value) => { setNotice(null); setStatusFilter(value as NotificationStatus); }} options={STATUS_OPTIONS.slice(1).map((status) => ({ value: status, label: statusLabel(status) }))} placeholder="Todos los estados" /></label>
            <div className="staff-notification-toolbar__summary"><span>{loading ? 'Actualizando…' : `${data?.total ?? 0} entregas`}</span><small>La vista se actualiza al cambiar el filtro.</small></div>
          </div>

          <div className="staff-notification-list" aria-live="polite">
            {loading && <div className="staff-notification-loading" role="status"><span /><span /><span /><b>Consultando la cola…</b></div>}
            {!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark">—</span><h2>No hay entregas en esta vista.</h2><p>Cuando existan notificaciones con este estado aparecerán aquí con su diagnóstico operativo.</p></div>}
            {!loading && items.length > 0 && <ul>{items.map((item) => <li className={`staff-notification-row staff-notification-row--${item.status.toLowerCase()}`} key={item.id}>
              <div className="staff-notification-row__identity"><span className={`staff-status-pill staff-status-pill--${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span><strong>{item.templateKey}</strong><small>{item.eventType} · {item.aggregateType}</small></div>
              <dl className="staff-notification-row__facts"><div><dt>Intentos</dt><dd>{item.attempts}</dd></div><div><dt>Antigüedad</dt><dd>{formatAge(item.ageSeconds)}</dd></div><div><dt>Actualizada</dt><dd><time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time></dd></div><div><dt>Diagnóstico</dt><dd>{errorLabel(item.errorCategory)}</dd></div></dl>
              <div className="staff-notification-row__action">{item.retryable ? <button className="staff-button staff-button--copper" type="button" disabled={retryingId === item.id} onClick={() => void retry(item)}>{retryingId === item.id ? 'Reintentando…' : 'Reintentar entrega'}</button> : <span>{item.status === 'FAILED' ? 'Requiere corrección técnica' : 'Sin acción manual'}</span>}</div>
            </li>)}</ul>}
          </div>
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
