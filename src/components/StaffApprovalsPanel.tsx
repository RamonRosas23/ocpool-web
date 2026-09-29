'use client';

import { ArrowUpRight, Check, ChevronDown, Inbox, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDialog, PrivateLinkButton, PrivatePagination, usePrivateToast } from '@/components/private/ui';
import { formatDateTime } from '@/lib/format-date';
import { moneyLabel } from '@/lib/money';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { relativeTimeLabel } from '@/lib/relative-time';

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

type VersionLine = {
  id: string;
  catalogItemId: string | null;
  catalogItemCode: string | null;
  name: string;
  unit: string;
  specialReason: string | null;
  manualPriceReason?: string | null;
  quantityMilliunits: string;
  unitPriceMinor: string;
  discountBasisPoints: number;
  totalMinor: string;
};

// El listado `versions` del expediente es un resumen sin líneas: los conceptos sólo vienen en las versiones completas
// (la vigente, la de trabajo y la publicada), y la que espera decisión es siempre una de ellas.
type WorkspaceVersionWithLines = { versionNumber: number; lines: VersionLine[] };
type QuoteWorkspaceResponse = { quote: { currentVersion: WorkspaceVersionWithLines | null; workingVersion: WorkspaceVersionWithLines | null; publishedVersion: WorkspaceVersionWithLines | null } | null };

type LinesState = { status: 'loading' } | { status: 'ready'; lines: VersionLine[] } | { status: 'error'; message: string };

const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  DISCOUNT: 'Descuento',
  PRICE_OVERRIDE: 'Ajuste de precio',
  SPECIAL_CONCEPT: 'Concepto especial',
};

const APPROVE_LABELS: Record<ApprovalType, string> = {
  DISCOUNT: 'Aprobar descuento',
  PRICE_OVERRIDE: 'Aprobar ajuste',
  SPECIAL_CONCEPT: 'Aprobar concepto especial',
};

const APPROVED_TOASTS: Record<ApprovalType, string> = {
  DISCOUNT: 'Descuento aprobado',
  PRICE_OVERRIDE: 'Ajuste aprobado',
  SPECIAL_CONCEPT: 'Concepto especial aprobado',
};

// Una solicitud con dos días o más esperando se marca: la cotización está detenida mientras tanto.
const AGING_MS = 2 * 86_400_000;

function discountRateLabel(subtotalMinor: string, discountMinor: string): string | null {
  if (!/^\d+$/.test(subtotalMinor) || !/^\d+$/.test(discountMinor)) return null;
  const subtotal = BigInt(subtotalMinor);
  const discount = BigInt(discountMinor);
  if (subtotal <= 0n || discount <= 0n) return null;
  const bps = (discount * 10_000n) / subtotal;
  return `${(Number(bps) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`;
}

function quantityLabel(milliunits: string): string {
  if (!/^\d+$/.test(milliunits)) return '—';
  return (Number(milliunits) / 1000).toLocaleString('es-MX', { maximumFractionDigits: 3 });
}

function lineNeedsAttention(type: ApprovalType, line: VersionLine): boolean {
  // Un precio fuera de lista siempre merece ojo de quien aprueba, sea cual sea el tipo de aprobación.
  if (line.manualPriceReason) return true;
  if (type === 'SPECIAL_CONCEPT') return line.catalogItemId === null;
  return line.discountBasisPoints > 0;
}

export default function StaffApprovalsPanel() {
  const { showToast } = usePrivateToast();
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [linesByApproval, setLinesByApproval] = useState<Record<string, LinesState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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
  }, [page, reloadKey]);

  // El detalle de conceptos se pide sólo al abrirlo, con el mismo endpoint que usa el constructor.
  const loadLines = useCallback(async (item: ApprovalItem) => {
    setLinesByApproval((current) => ({ ...current, [item.id]: { status: 'loading' } }));
    try {
      const response = await fetch(`/api/staff/quotes/${item.requestId}`, { credentials: 'include', cache: 'no-store' });
      const workspace = await readApiResponseOrThrow<QuoteWorkspaceResponse>(response, 'No fue posible cargar los conceptos de la versión.');
      const fullVersions = [workspace.quote?.currentVersion, workspace.quote?.workingVersion, workspace.quote?.publishedVersion].filter((candidate): candidate is WorkspaceVersionWithLines => Boolean(candidate));
      const version = fullVersions.find((candidate) => candidate.versionNumber === item.versionNumber);
      if (!version) throw new Error('Esta versión ya no está vigente aquí. Ábrela en el constructor para ver sus conceptos.');
      setLinesByApproval((current) => ({ ...current, [item.id]: { status: 'ready', lines: version.lines } }));
    } catch (caught) {
      setLinesByApproval((current) => ({ ...current, [item.id]: { status: 'error', message: caught instanceof Error ? caught.message : 'No fue posible cargar los conceptos de la versión.' } }));
    }
  }, []);

  const toggleLines = (item: ApprovalItem) => {
    const next = !expanded[item.id];
    setExpanded((current) => ({ ...current, [item.id]: next }));
    if (next && linesByApproval[item.id]?.status !== 'ready' && linesByApproval[item.id]?.status !== 'loading') void loadLines(item);
  };

  const decide = async (item: ApprovalItem, decision: 'APPROVED' | 'REJECTED', reason?: string) => {
    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/approvals/${item.id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(decision === 'REJECTED' ? { reason } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible resolver la aprobación.');
      showToast(decision === 'APPROVED'
        ? `${APPROVED_TOASTS[item.type]} en ${item.folio}. Ventas ya puede enviar la cotización.`
        : `Rechazo registrado en ${item.folio}. Ventas verá tu motivo en el constructor.`);
      setRejecting(null);
      setRejectReason('');
      // La fila resuelta sale de la cola al momento; si la página queda vacía se recarga (o se
      // retrocede una) para que la siguiente decisión esté siempre a la vista.
      const remaining = (data?.items ?? []).filter((candidate) => candidate.id !== item.id);
      if (remaining.length === 0) {
        if (page > 1) setPage((current) => current - 1);
        else setReloadKey((current) => current + 1);
      }
      setData((current) => current ? { ...current, items: current.items.filter((candidate) => candidate.id !== item.id), total: Math.max(0, current.total - 1) } : current);
    } catch (caught) {
      setError(caught instanceof Error ? `${item.folio}: ${caught.message}` : 'No fue posible resolver la aprobación.');
    } finally {
      setBusyId(null);
    }
  };

  if (accessDenied) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/staff" variant="quiet">Volver al dashboard</PrivateLinkButton></div>}>Necesitas un perfil con permiso de aprobar descuentos para consultar esta cola.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const items = data?.items ?? [];
  const now = Date.now();

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />

      <div className="staff-content staff-notifications">
        <div className="staff-intro">
          <div><p className="staff-kicker">Esperan tu decisión</p><h1>Aprobaciones</h1><p className="staff-intro__copy">Descuentos y conceptos especiales que esperan tu autorización. Revisa los conceptos y decide aquí mismo, o abre la cotización completa en el constructor.</p></div>
          <div className="staff-intro__metric"><strong>{loading && !data ? '—' : data?.total ?? 0}</strong><span>{data?.total === 1 ? 'pendiente' : 'pendientes'}</span></div>
        </div>

        {error && <p className="staff-error" role="alert">{error}</p>}

        <section className="staff-notification-workspace" aria-label="Aprobaciones pendientes">
          <div className="staff-notification-toolbar">
            <div className="staff-notification-toolbar__summary"><span>{loading ? 'Actualizando…' : `${data?.total ?? 0} pendiente${data?.total === 1 ? '' : 's'} de decisión`}</span><small>Las más antiguas primero: cada una detiene una cotización.</small></div>
          </div>

          <div className="staff-notification-list" aria-live="polite">
            {loading && !data && <div className="staff-notification-loading" role="status"><span /><span /><span /><b>Consultando la cola…</b></div>}
            {!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>Todo resuelto.</h2><p>No hay aprobaciones esperando tu decisión. Cuando ventas solicite una, aparecerá aquí.</p></div>}
            {items.length > 0 && <ul className="approval-list">{items.map((item) => {
              const rate = discountRateLabel(item.subtotalMinor, item.discountTotalMinor);
              const aging = now - new Date(item.requestedAt).getTime() >= AGING_MS;
              const lines = linesByApproval[item.id];
              const isOpen = Boolean(expanded[item.id]);
              const busy = busyId === item.id;
              const linesId = `approval-lines-${item.id}`;
              return <li className={`approval-card${aging ? ' approval-card--aging' : ''}`} key={item.id}>
                <div className="approval-card__head">
                  <div className="approval-card__identity">
                    <span className={`approval-card__type approval-card__type--${item.type.toLowerCase()}`}>{APPROVAL_TYPE_LABELS[item.type]}</span>
                    <Link href={`/staff/quotes?request=${item.requestId}`}><strong>{item.folio}</strong></Link>
                    <small>{item.clientDisplayName}{item.projectType ? ` · ${item.projectType}` : ''}</small>
                  </div>
                  <time className="approval-card__age" dateTime={item.requestedAt} title={formatDateTime(item.requestedAt)}>{aging ? 'Esperando · ' : ''}{relativeTimeLabel(item.requestedAt)}</time>
                </div>
                <dl className="approval-card__facts">
                  <div><dt>Versión</dt><dd>V{item.versionNumber}</dd></div>
                  <div><dt>Total</dt><dd>{moneyLabel(item.totalMinor, item.currencyCode)}</dd></div>
                  {rate && <div><dt>Descuento</dt><dd>{rate} · {moneyLabel(item.discountTotalMinor, item.currencyCode)}</dd></div>}
                  <div><dt>Solicitada por</dt><dd>{item.requestedByDisplayName}</dd></div>
                </dl>
                {item.reason && <p className="approval-card__reason"><span>Motivo de ventas</span>{item.reason}</p>}
                <button type="button" className="approval-card__toggle" aria-expanded={isOpen} aria-controls={linesId} onClick={() => toggleLines(item)}>{isOpen ? 'Ocultar conceptos' : 'Ver conceptos de la versión'}<ChevronDown size={15} aria-hidden="true" /></button>
                {isOpen && <div className="approval-lines" id={linesId}>
                  {(!lines || lines.status === 'loading') && <p className="approval-lines__state" role="status">Cargando conceptos…</p>}
                  {lines?.status === 'error' && <p className="approval-lines__state approval-lines__state--error" role="alert">{lines.message} <button type="button" className="quotes-retry-link" onClick={() => void loadLines(item)}>Reintentar</button></p>}
                  {lines?.status === 'ready' && lines.lines.length === 0 && <p className="approval-lines__state">La versión no tiene conceptos.</p>}
                  {lines?.status === 'ready' && lines.lines.length > 0 && <ul>{lines.lines.map((line) => <li key={line.id} className={lineNeedsAttention(item.type, line) ? 'is-flagged' : undefined}>
                    <span className="approval-lines__name"><strong>{line.name}</strong><small>{line.catalogItemId === null ? <><b>Especial</b>{line.specialReason ? ` · ${line.specialReason}` : ''}</> : <>{line.catalogItemCode}{line.manualPriceReason && <> · <b>Precio manual</b> · {line.manualPriceReason}</>}</>}</small></span>
                    <span className="approval-lines__qty">{quantityLabel(line.quantityMilliunits)} {line.unit} × {moneyLabel(line.unitPriceMinor, item.currencyCode)}</span>
                    <span className="approval-lines__discount">{line.discountBasisPoints > 0 ? `−${(line.discountBasisPoints / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%` : ''}</span>
                    <strong className="approval-lines__total">{moneyLabel(line.totalMinor, item.currencyCode)}</strong>
                  </li>)}</ul>}
                </div>}
                <div className="approval-card__actions">
                  <button className="staff-button staff-button--copper" type="button" disabled={busy} onClick={() => void decide(item, 'APPROVED')}><Check size={16} aria-hidden="true" />{busy ? 'Guardando…' : APPROVE_LABELS[item.type]}</button>
                  <button className="staff-button staff-button--outline" type="button" disabled={busy} onClick={() => { setRejectReason(''); setRejecting(item); }}>Rechazar…</button>
                  <Link className="approval-card__open" href={`/staff/quotes?request=${item.requestId}`}>Abrir en el constructor<ArrowUpRight size={14} aria-hidden="true" /></Link>
                </div>
              </li>;
            })}</ul>}
          </div>
          {data && data.totalPages > 1 && <PrivatePagination page={data.page} totalPages={data.totalPages} disabled={loading} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />}
        </section>
      </div>

      {rejecting && <PrivateDialog open onClose={() => { if (busyId !== rejecting.id) setRejecting(null); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="approval-reject-title" describedBy="approval-reject-description">
        <div className="quotes-preflight-dialog__head"><h3 id="approval-reject-title">Rechazar {rejecting.type === 'DISCOUNT' ? 'el descuento' : rejecting.type === 'SPECIAL_CONCEPT' ? 'el concepto especial' : 'el ajuste'} de {rejecting.folio}</h3><button className="staff-dialog-close" type="button" onClick={() => setRejecting(null)} disabled={busyId === rejecting.id} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
        <p id="approval-reject-description" className="quotes-preflight-dialog__copy">Ventas verá este motivo en el constructor y la versión no podrá enviarse con estas condiciones. Queda en el historial de la cotización.</p>
        <label className="quotes-preflight-field"><span>Motivo (obligatorio)</span><textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} rows={3} required placeholder="Por ejemplo: el descuento supera lo autorizado para este cliente." /></label>
        <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setRejecting(null)} disabled={busyId === rejecting.id}>Cancelar</button><button className="staff-button staff-button--danger" type="button" disabled={busyId === rejecting.id || !rejectReason.trim()} onClick={() => void decide(rejecting, 'REJECTED', rejectReason.trim())}>{busyId === rejecting.id ? 'Guardando…' : 'Confirmar rechazo'}</button></div>
      </PrivateDialog>}
    </PrivateSurfaceRoot>
  );
}
