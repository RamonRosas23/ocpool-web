'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivatePagination } from '@/components/private/ui';
import { readApiResponse } from '@/lib/api-response-error';

type ApprovalType = 'DISCOUNT' | 'PRICE_OVERRIDE' | 'SPECIAL_CONCEPT';

type ApprovalItem = {
  id: string;
  type: ApprovalType;
  requestedAt: string;
  reason: string | null;
  policyVersion: string;
  requestedByDisplayName: string;
  requestId: string;
  folio: string;
  clientDisplayName: string;
  projectType: string | null;
  versionNumber: number;
  subtotalMinor: string;
  discountTotalMinor: string;
  totalMinor: string;
  currencyCode: string;
};

type ListResponse = { items: ApprovalItem[]; page: number; pageSize: number; total: number; totalPages: number };

const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  DISCOUNT: 'Descuento',
  PRICE_OVERRIDE: 'Ajuste de precio',
  SPECIAL_CONCEPT: 'Concepto especial',
};

function moneyLabel(minor: string, currency: string): string {
  if (!/^\d+$/.test(minor)) return '—';
  const amount = BigInt(minor);
  return `${currency} ${(amount / 100n).toLocaleString('es-MX')}.${(amount % 100n).toString().padStart(2, '0')}`;
}

function discountRateLabel(subtotalMinor: string, discountMinor: string): string | null {
  if (!/^\d+$/.test(subtotalMinor) || !/^\d+$/.test(discountMinor)) return null;
  const subtotal = BigInt(subtotalMinor);
  const discount = BigInt(discountMinor);
  if (subtotal <= 0n || discount <= 0n) return null;
  const bps = (discount * 10_000n) / subtotal;
  return `${(Number(bps) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ageLabel(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'Solicitada hoy';
  if (days === 1) return 'Hace 1 día';
  return `Hace ${days} días`;
}

export default function StaffApprovalsPanel() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/staff/quotes/approvals?page=${page}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const result = await readApiResponse<ListResponse>(response, 'No fue posible cargar las aprobaciones pendientes.');
        if (!result.ok) {
          if (result.kind === 'forbidden') setAccessDenied(true);
          throw new Error(result.message);
        }
        setAccessDenied(false);
        setData(result.data);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'No fue posible cargar las aprobaciones pendientes.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [page]);

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/staff" variant="quiet">Volver al dashboard</PrivateLinkButton></div>}>Necesitas un perfil con permiso de aprobar descuentos para consultar esta cola.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const items = data?.items ?? [];

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <header className="staff-header">
        <WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" />
        <div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Cola de aprobaciones</div></div>
      </header>

      <div className="staff-content staff-notifications">
        <div className="staff-intro">
          <div><p className="staff-kicker">Esperan tu decisión</p><h1>Aprobaciones</h1><p className="staff-intro__copy">Cada fila abre el expediente exacto donde ya puedes aprobar o rechazar; ésta es sólo la vista completa de lo que la tarjeta del dashboard recorta a cinco.</p></div>
        </div>

        {error && <p className="staff-error" role="alert">{error}</p>}

        <section className="staff-notification-workspace" aria-label="Aprobaciones pendientes">
          <div className="staff-notification-toolbar">
            <div className="staff-notification-toolbar__summary"><span>{loading ? 'Actualizando…' : `${data?.total ?? 0} pendientes`}</span><small>Ordenadas por antigüedad de solicitud.</small></div>
          </div>

          <div className="staff-notification-list" aria-live="polite">
            {loading && !data && <div className="staff-notification-loading" role="status"><span /><span /><span /><b>Consultando la cola…</b></div>}
            {!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>No hay aprobaciones pendientes.</h2><p>Cuando exista una solicitud que puedas resolver aparecerá aquí.</p></div>}
            {items.length > 0 && <ul>{items.map((item) => {
              const rate = discountRateLabel(item.subtotalMinor, item.discountTotalMinor);
              return <li className="staff-notification-row" key={item.id}>
                <div className="staff-notification-row__identity">
                  <Link href={`/staff/quotes?request=${item.requestId}`}><strong>{item.folio}</strong></Link>
                  <small>{item.clientDisplayName}{item.projectType ? ` · ${item.projectType}` : ''}</small>
                </div>
                <dl className="staff-notification-row__facts">
                  <div><dt>Tipo</dt><dd>{APPROVAL_TYPE_LABELS[item.type]}</dd></div>
                  <div><dt>Versión</dt><dd>V{item.versionNumber} · {moneyLabel(item.totalMinor, item.currencyCode)}</dd></div>
                  {rate && <div><dt>Descuento</dt><dd>{rate} · {moneyLabel(item.discountTotalMinor, item.currencyCode)}</dd></div>}
                  <div><dt>Solicitada por</dt><dd>{item.requestedByDisplayName}</dd></div>
                  <div><dt>Antigüedad</dt><dd><time dateTime={item.requestedAt}>{ageLabel(item.requestedAt)}</time></dd></div>
                  <div><dt>Fecha</dt><dd>{formatDate(item.requestedAt)}</dd></div>
                </dl>
                {item.reason && <p className="staff-notification-row__reason">{item.reason}</p>}
                <div className="staff-notification-row__action"><Link className="staff-button staff-button--copper" href={`/staff/quotes?request=${item.requestId}`}>Abrir expediente</Link></div>
              </li>;
            })}</ul>}
          </div>
          {data && data.totalPages > 1 && <PrivatePagination page={data.page} totalPages={data.totalPages} disabled={loading} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />}
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
