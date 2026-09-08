'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

const STATUS_LABELS: Record<string, string> = {
  RECIBIDA: 'Recibida',
  INFORMACION_REQUERIDA: 'Información requerida',
  EN_ELABORACION: 'En elaboración',
  COTIZACION_DISPONIBLE: 'Cotización disponible',
  EN_NEGOCIACION: 'En negociación',
  EN_REVISION: 'En revisión',
  ENVIADA: 'Enviada',
  PENDIENTE_DE_APROBACION: 'Pendiente de aprobación',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
};

type RequestSummary = {
  id: string;
  folio: string;
  origin: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  client: { id: string; displayName: string };
  detail: { projectType: string; location: string; currencyCode: string } | null;
  quote: { id: string; currentVersion: { id: string; versionNumber: number; status: string; currencyCode: string; validUntil: string | null; totalMinor: string; discountTotalMinor: string } | null } | null;
};

type QuoteLine = {
  catalogItemCode: string;
  name: string;
  description: string | null;
  unit: string;
  quantityMilliunits: string;
  currencyCode: string;
  unitPriceMinor: string;
  discountBasisPoints: number;
  discountMinor: string;
  taxableMinor: string;
  taxBasisPoints: number;
  taxMinor: string;
  subtotalMinor: string;
  totalMinor: string;
};

type QuoteVersion = {
  id: string;
  versionNumber: number;
  status: string;
  currencyCode: string;
  validUntil: string | null;
  subtotalMinor: string;
  discountTotalMinor: string;
  taxableTotalMinor: string;
  taxTotalMinor: string;
  totalMinor: string;
  createdAt: string;
  updatedAt: string;
  lines: QuoteLine[];
};

type Workspace = {
  request: {
    id: string;
    folio: string;
    origin: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    client: { id: string; displayName: string };
    contact: { displayName: string; email: string; phone: string | null };
    detail: { projectType: string; location: string; budgetCents: string | null; currencyCode: string; dimensions: string | null; description: string } | null;
  };
  quote: { id: string; currentVersionId: string | null; currentVersion: QuoteVersion | null; versions: QuoteVersion[]; history: Array<{ id: string; fromStatus: string | null; toStatus: string; createdAt: string }> } | null;
};

type ErrorResponse = { error?: { message?: string } };
type ListResponse = { items: RequestSummary[]; page: number; pageSize: number; total: number; totalPages: number };

function statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function moneyLabel(value: string | null, currency = 'MXN'): string {
  if (!value || !/^\d+$/.test(value)) return '—';
  const amount = BigInt(value);
  return `${currency} ${(amount / 100n).toLocaleString('es-MX')}.${(amount % 100n).toString().padStart(2, '0')}`;
}

function quantityLabel(value: string): string {
  if (!/^\d+$/.test(value)) return '—';
  const quantity = BigInt(value);
  const decimals = (quantity % 1000n).toString().padStart(3, '0').replace(/0+$/u, '');
  return decimals ? `${quantity / 1000n}.${decimals}` : (quantity / 1000n).toString();
}

function quoteValidityLabel(value: string | null): { label: string; expired: boolean } {
  if (!value) return { label: 'Vigencia por confirmar', expired: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: 'Vigencia por confirmar', expired: false };
  const label = formatDate(value);
  return date.getTime() < Date.now() ? { label: `Vigencia expirada el ${label}`, expired: true } : { label: `Vigente hasta ${label}`, expired: false };
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible cargar tu información.');
  return data as T;
}

export default function ClientPortalPanel() {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/portal/requests?page=1&pageSize=25', { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<ListResponse>(response);
      setRequests(data.items);
      setTotal(data.total);
      setRestricted(false);
      setSelectedId((current) => current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar tu portal.';
      setRestricted(message.includes('autenticada') || message.includes('permisos'));
      setError(message);
      setRequests([]);
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (requestId: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(`/api/portal/requests/${requestId}`, { credentials: 'include', cache: 'no-store' });
      setWorkspace(await readResponse<Workspace>(response));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el expediente.';
      setError(message);
      setWorkspace(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setWorkspace(null); }, [loadDetail, selectedId]);

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' } }).catch(() => undefined);
    setRestricted(true);
    setWorkspace(null);
    setRequests([]);
  };

  if (restricted) return <main className="client-portal client-portal--restricted"><section className="client-restricted"><span className="client-mark">OC</span><p className="client-eyebrow">Portal privado</p><h1>Acceso privado.</h1><p>Necesitas un enlace de acceso válido para consultar tus expedientes.</p><Link className="client-button client-button--dark" href="/">Volver al sitio</Link></section></main>;

  const validity = workspace?.quote?.currentVersion ? quoteValidityLabel(workspace.quote.currentVersion.validUntil) : null;

  return <main className="client-portal">
    <header className="client-header"><Link className="client-brand" href="/" aria-label="OCPOOL, volver al sitio público"><span>OCPOOL</span><small>Portal de cliente</small></Link><div className="client-header__right"><span className="client-header__state"><i aria-hidden="true" /> Sesión privada</span><button type="button" className="client-header__logout" onClick={() => void logout()}>Cerrar sesión</button></div></header>
    <div className="client-content">
      <section className="client-hero"><div><p className="client-eyebrow">Espacios que toman forma</p><h1>Tu proyecto, en cada etapa.</h1><p className="client-hero__copy">Aquí encontrarás el avance de tus solicitudes y las propuestas que hemos preparado para ti.</p></div><div className="client-hero__note"><span>Expedientes</span><strong>{total.toString().padStart(2, '0')}</strong><small>seguimiento privado</small></div></section>
      {error && <p className="client-alert" role="alert">{error}</p>}
      <section className="client-layout" aria-label="Portal de cliente">
        <aside className="client-request-rail"><div className="client-section-head"><p className="client-eyebrow">Tus proyectos</p><span>{loading ? 'Cargando…' : `${requests.length} expediente${requests.length === 1 ? '' : 's'}`}</span></div><div className="client-request-list" aria-live="polite">{loading && <div className="client-skeleton"><i /><i /><i /></div>}{!loading && requests.length === 0 && <div className="client-empty client-empty--small"><strong>Aún no hay expedientes.</strong><span>Cuando iniciemos una conversación, aparecerá aquí.</span></div>}{!loading && requests.map((item) => <button type="button" className={`client-request-row${selectedId === item.id ? ' is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="client-request-row__mark" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.detail?.projectType ?? 'Proyecto OCPOOL'}</b><small>{item.detail?.location ?? 'Ubicación por confirmar'}</small></span><em>{statusLabel(item.status)}</em></button>)}</div></aside>
        <section className="client-detail">
          {loadingDetail && <div className="client-detail-loading"><i /><i /><i /></div>}
          {!loadingDetail && !workspace && <div className="client-empty"><span className="client-mark">OC</span><h2>Elige un expediente.</h2><p>Selecciona un proyecto para ver su alcance y propuesta.</p></div>}
          {!loadingDetail && workspace && <><div className="client-detail__intro"><div><p className="client-eyebrow">{workspace.request.folio}</p><h2>{workspace.request.detail?.projectType ?? 'Tu proyecto'}</h2><p>{workspace.request.detail?.location ?? 'Ubicación por confirmar'} · Actualizado {formatDate(workspace.request.updatedAt)}</p></div><span className={`client-status client-status--${workspace.request.status.toLowerCase()}`}>{statusLabel(workspace.request.status)}</span></div><div className="client-overview"><div><span>Alcance</span><strong>{workspace.request.detail?.description ?? 'Estamos definiendo el alcance contigo.'}</strong></div><div><span>Contacto</span><strong>{workspace.request.contact.displayName}</strong><small>{workspace.request.contact.email}</small></div></div>{workspace.quote?.currentVersion ? <section className="client-quote"><div className="client-quote__head"><div><p className="client-eyebrow">Propuesta vigente</p><h3>Versión {workspace.quote.currentVersion.versionNumber}</h3></div><div className="client-quote__total"><span>Total</span><strong>{moneyLabel(workspace.quote.currentVersion.totalMinor, workspace.quote.currentVersion.currencyCode)}</strong></div></div><p className={`client-quote__validity${validity?.expired ? ' is-expired' : ''}`}>{validity?.label}</p><div className="client-quote__lines">{workspace.quote.currentVersion.lines.map((line) => <div className="client-quote-line" key={`${line.catalogItemCode}-${line.name}`}><div><strong>{line.name}</strong><small>{line.catalogItemCode} · {quantityLabel(line.quantityMilliunits)} {line.unit}</small></div><span>{moneyLabel(line.totalMinor, line.currencyCode)}</span></div>)}</div><div className="client-quote__summary"><span>Subtotal <b>{moneyLabel(workspace.quote.currentVersion.subtotalMinor, workspace.quote.currentVersion.currencyCode)}</b></span><span>Descuento <b>− {moneyLabel(workspace.quote.currentVersion.discountTotalMinor, workspace.quote.currentVersion.currencyCode)}</b></span><span>Impuestos <b>{moneyLabel(workspace.quote.currentVersion.taxTotalMinor, workspace.quote.currentVersion.currencyCode)}</b></span></div></section> : <section className="client-quote client-quote--empty"><p className="client-eyebrow">Propuesta</p><h3>Estamos preparando los detalles.</h3><p>Cuando exista una propuesta disponible, aparecerá en este expediente.</p></section>}<section className="client-version-history"><div className="client-section-head"><div><p className="client-eyebrow">Trazabilidad</p><h3>Versiones compartidas</h3></div><span>{workspace.quote?.versions.length ?? 0}</span></div>{workspace.quote?.versions.length ? <ol>{workspace.quote.versions.map((version) => <li key={version.id}><span>V{version.versionNumber}</span><div><strong>{statusLabel(version.status)}</strong><small>{moneyLabel(version.totalMinor, version.currencyCode)} · {formatDate(version.createdAt)}</small></div></li>)}</ol> : <p className="client-history-empty">Todavía no hay versiones compartidas.</p>}</section></>}
        </section>
      </section>
    </div>
    <footer className="client-footer"><span>OCPOOL</span><small>Diseño, ingeniería y agua con intención.</small></footer>
  </main>;
}
