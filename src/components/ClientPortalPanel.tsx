'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import ClientFilesPanel from '@/components/ClientFilesPanel';
import ClientMessagingThread from '@/components/ClientMessagingThread';
import ClientQuoteActions from '@/components/ClientQuoteActions';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { formatDate } from '@/lib/format-date';
import { portalNextStep, portalStages, portalStatusLabel, type PortalNextStep, type PortalStageState } from '@/lib/portal-stage';
import { moneyLabel } from '@/lib/money';
import { QUOTE_VERSION_STATUS_LABELS, statusToneIcon } from '@/lib/labels';


const STAGE_STATE_LABELS: Record<PortalStageState, string> = {
  done: ' (completada)',
  current: ' (etapa actual)',
  closed: ' (cerrada)',
  upcoming: ' (pendiente)',
};

const NEXT_STEP_EYEBROW: Record<PortalNextStep['owner'], string> = {
  customer: 'Tu siguiente paso',
  team: 'Lo que sigue',
  done: 'Todo en orden',
};

const SECTION_SELECTORS = {
  quote: '.client-quote',
  files: '.client-files',
  conversation: '.client-messaging',
  history: '.client-version-history',
} as const;

type PortalSection = keyof typeof SECTION_SELECTORS;

const SECTION_LINKS: ReadonlyArray<{ key: PortalSection; label: string }> = [
  { key: 'quote', label: 'Propuesta' },
  { key: 'files', label: 'Archivos' },
  { key: 'conversation', label: 'Conversación' },
  { key: 'history', label: 'Historial' },
];

// Lleva al cliente directo a una sección del expediente (la propuesta, la conversación, etc.) y la
// resalta; en la conversación, el foco va al campo para escribir.
function goToPortalTarget(target: PortalSection) {
  const section = document.querySelector<HTMLElement>(SECTION_SELECTORS[target]);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const focusTarget = target === 'conversation' ? section.querySelector<HTMLElement>('textarea:not(:disabled)') ?? section : section;
  if (focusTarget === section && !section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1');
  focusTarget.focus({ preventScroll: true });
  section.classList.remove('is-spotlit');
  void section.offsetWidth;
  section.classList.add('is-spotlit');
  window.setTimeout(() => section.classList.remove('is-spotlit'), 1600);
}

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
  catalogItemCode: string | null;
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
  termsVersion: string;
  termsLabel: string;
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
  pdfReady: boolean;
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
  quote: { id: string; currentVersionId: string | null; currentVersion: QuoteVersion | null; changesRequestedAt?: string | null; versions: QuoteVersion[]; history: Array<{ id: string; fromStatus: string | null; toStatus: string; createdAt: string }> } | null;
};

type ErrorResponse = { error?: { message?: string } };
type ListResponse = { items: RequestSummary[]; page: number; pageSize: number; total: number; totalPages: number };

function statusLabel(status: string): string { return portalStatusLabel(status); }
function versionStatusLabel(status: string): string { return (QUOTE_VERSION_STATUS_LABELS as Record<string, string>)[status] ?? statusLabel(status); }

function ClientStatusPill({ status }: { status: string }) {
  const ToneIcon = statusToneIcon(status);
  return <span className={`client-status client-status--${status.toLowerCase()}`}><ToneIcon size={11} aria-hidden="true" />{statusLabel(status)}</span>;
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
  const [messagingRefreshKey, setMessagingRefreshKey] = useState(0);
  const [loggedOut, setLoggedOut] = useState(false);

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

  const loadDetailGenerationRef = useRef(0);
  const loadDetail = useCallback(async (requestId: string, options: { silent?: boolean } = {}) => {
    // UX audit fix: sin esta guarda, hacer clic rápido entre dos solicitudes propias del cliente
    // podía dejar que la respuesta obsoleta de la primera llegara después que la de la segunda y
    // sobreescribiera en silencio el expediente mostrado (totales/estado/líneas de la cotización)
    // con datos de una solicitud distinta a la que aparece resaltada como seleccionada.
    const generation = (loadDetailGenerationRef.current += 1);
    // "silent": refresca el expediente abierto sin esqueleto (p. ej. tras pedir cambios, con el
    // diálogo de confirmación aún en pantalla); si falla, se conserva lo que ya se veía.
    if (!options.silent) setLoadingDetail(true);
    if (!options.silent) setError(null);
    try {
      const response = await fetch(`/api/portal/requests/${requestId}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<Workspace>(response);
      if (loadDetailGenerationRef.current !== generation) return;
      setWorkspace(data);
      // La tarjeta del riel refleja el mismo estado que el detalle (p. ej. "Aceptada" justo después
      // de aceptar, en vez de seguir diciendo "Cotización disponible").
      setRequests((current) => current.map((item) => item.id === data.request.id ? { ...item, status: data.request.status, updatedAt: data.request.updatedAt } : item));
    } catch (caught) {
      if (loadDetailGenerationRef.current !== generation || options.silent) return;
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el expediente.';
      setError(message);
      setWorkspace(null);
    } finally {
      if (!options.silent) setLoadingDetail(false);
    }
  }, []);

  const [requestFromUrl, setRequestFromUrl] = useState<string | null>(null);

  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setWorkspace(null); }, [loadDetail, selectedId]);
  useEffect(() => {
    const requestId = new URLSearchParams(window.location.search).get('request');
    if (requestId) { setSelectedId(requestId); setRequestFromUrl(requestId); }
  }, []);

  // El expediente abierto vive en la URL: recargar o guardar el enlace regresa al mismo proyecto.
  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('request') === selectedId) return;
    url.searchParams.set('request', selectedId);
    window.history.replaceState(null, '', url);
  }, [selectedId]);

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' } }).catch(() => undefined);
    setLoggedOut(true);
    setRestricted(true);
    setWorkspace(null);
    setRequests([]);
  };

  if (restricted) return <PrivateSurfaceRoot className="client-portal client-portal--restricted"><section className="client-restricted"><WorkspaceLogo tone="light" className="client-restricted__logo" /><p className="client-eyebrow">Portal privado</p><h1>Acceso privado.</h1>{loggedOut ? <p role="status">Cerraste tu sesión. Para volver, solicita un nuevo enlace de acceso con tu correo.</p> : <p>Necesitas un enlace de acceso válido para consultar tus expedientes.</p>}<div className="client-restricted__actions"><Link className="client-button client-button--dark" href={requestFromUrl ? `/portal/access?request=${encodeURIComponent(requestFromUrl)}` : '/portal/access'}>Solicitar acceso</Link><Link className="client-restricted__link" href="/">Volver al sitio</Link></div></section></PrivateSurfaceRoot>;

  const validity = workspace?.quote?.currentVersion ? quoteValidityLabel(workspace.quote.currentVersion.validUntil) : null;
  const currentQuote = workspace?.quote?.currentVersion ?? null;
  const stages = workspace ? portalStages(workspace.request.status) : [];
  const nextStep = workspace ? portalNextStep({
    status: workspace.request.status,
    hasQuote: Boolean(currentQuote),
    quoteExpired: Boolean(validity?.expired),
    quoteAccepted: currentQuote?.status === 'ACEPTADA',
    quoteActionable: Boolean(currentQuote && currentQuote.pdfReady && ['ENVIADA', 'EN_NEGOCIACION'].includes(currentQuote.status) && !validity?.expired && ['COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION'].includes(workspace.request.status)),
    changesRequested: Boolean(workspace.quote?.changesRequestedAt),
  }) : null;
  const nextStepTarget = nextStep?.target ?? null;

  return <PrivateSurfaceRoot className="client-portal">
    <header className="client-header"><WorkspaceBrand className="client-brand" subtitle="Portal de cliente" /><div className="client-header__right"><Link className="client-header__home" href="/">Volver al sitio</Link><span className="client-header__state"><i aria-hidden="true" /> Sesión privada</span><button type="button" className="client-header__logout" onClick={() => void logout()}>Cerrar sesión</button></div></header>
    <div className="client-content">
      <section className="client-hero"><div><p className="client-eyebrow">Espacios que toman forma</p><h1>Tu proyecto, <em>en cada etapa.</em></h1><p className="client-hero__copy">Aquí encontrarás el avance de tus solicitudes y las propuestas que hemos preparado para ti.</p></div><div className="client-hero__note"><span>Expedientes</span><strong>{total.toString().padStart(2, '0')}</strong><small>seguimiento privado</small></div></section>
      {error && <p className="client-alert" role="alert">{error}</p>}
      <section className="client-layout" aria-label="Portal de cliente">
        <aside className="client-request-rail"><div className="client-section-head"><p className="client-eyebrow">Tus proyectos</p><span>{loading ? 'Cargando…' : `${requests.length} expediente${requests.length === 1 ? '' : 's'}`}</span></div><div className="client-request-list" aria-live="polite">{loading && <div className="client-skeleton"><i /><i /><i /></div>}{!loading && requests.length === 0 && (error ? <div className="client-empty client-empty--small"><strong>No pudimos cargar tus expedientes.</strong><span>Suele ser momentáneo. Intenta de nuevo en unos segundos.</span><button type="button" className="client-quote-action client-empty__retry" onClick={() => void loadRequests()}>Reintentar</button></div> : <div className="client-empty client-empty--small"><strong>Aún no hay expedientes.</strong><span>Cuando iniciemos una conversación, aparecerá aquí.</span></div>)}{!loading && requests.map((item) => <button type="button" className={`client-request-row${selectedId === item.id ? ' is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="client-request-row__mark" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.detail?.projectType ?? 'Proyecto OCPOOL'}</b><small>{item.detail?.location ?? 'Ubicación por confirmar'}</small></span><em>{statusLabel(item.status)}</em></button>)}</div></aside>
        <section className="client-detail">
          {(loadingDetail || (loading && !workspace)) && <div className="client-detail-loading"><i /><i /><i /></div>}
          {!loadingDetail && !loading && !workspace && <div className="client-empty"><WorkspaceLogo className="client-empty__logo" /><h2>Elige un expediente.</h2><p>Selecciona un proyecto para ver su alcance y propuesta.</p></div>}
          {!loadingDetail && workspace && <><div className="client-detail__intro"><div><p className="client-eyebrow">{workspace.request.folio}</p><h2>{workspace.request.detail?.projectType ?? 'Tu proyecto'}</h2><p>{workspace.request.detail?.location ?? 'Ubicación por confirmar'} · Actualizado {formatDate(workspace.request.updatedAt)}</p></div><ClientStatusPill status={workspace.request.status} /></div><section className="client-progress" aria-label="Avance de tu proyecto"><ol className="client-progress__steps">{stages.map((stage, index) => <li key={stage.key} className={`client-progress__step is-${stage.state}`} aria-current={stage.state === 'current' ? 'step' : undefined}><span className="client-progress__marker" aria-hidden="true">{stage.state === 'done' ? <Check size={12} strokeWidth={2.8} /> : stage.state === 'closed' ? <X size={12} strokeWidth={2.8} /> : index + 1}</span><span className="client-progress__label">{stage.label}<span className="sr-only">{STAGE_STATE_LABELS[stage.state]}</span></span></li>)}</ol>{nextStep && <div className={`client-next client-next--${nextStep.owner}`}><div className="client-next__body"><p className="client-eyebrow">{NEXT_STEP_EYEBROW[nextStep.owner]}</p><h3>{nextStep.title}</h3><p>{nextStep.detail}</p></div>{nextStepTarget && nextStep.cta && <button type="button" className="client-quote-action client-quote-action--primary client-next__cta" onClick={() => goToPortalTarget(nextStepTarget)}>{nextStep.cta}<ArrowRight size={15} aria-hidden="true" /></button>}</div>}</section><nav className="client-sections" aria-label="Secciones del expediente">{SECTION_LINKS.map((link) => <button key={link.key} type="button" onClick={() => goToPortalTarget(link.key)}>{link.label}</button>)}</nav><div className="client-overview"><div><span>Alcance</span><strong>{workspace.request.detail?.description ?? 'Estamos definiendo el alcance contigo.'}</strong></div><div><span>Contacto</span><strong>{workspace.request.contact.displayName}</strong><small>{workspace.request.contact.email}</small></div></div>{workspace.quote?.currentVersion ? <section className="client-quote"><div className="client-quote__head"><div><p className="client-eyebrow">{workspace.quote.currentVersion.status === 'ACEPTADA' ? 'Propuesta aceptada' : workspace.quote.currentVersion.status === 'RECHAZADA' || workspace.request.status === 'RECHAZADA' ? 'Propuesta no vigente' : validity?.expired || workspace.request.status === 'VENCIDA' ? 'Propuesta vencida' : 'Propuesta vigente'}</p><h3>Versión {workspace.quote.currentVersion.versionNumber}</h3></div><div className="client-quote__total"><span>Total</span><strong>{moneyLabel(workspace.quote.currentVersion.totalMinor, workspace.quote.currentVersion.currencyCode)}</strong></div></div><p className={`client-quote__validity${validity?.expired ? ' is-expired' : ''}`}>{validity?.label}</p><ClientQuoteActions quoteId={workspace.quote.id} requestId={workspace.request.id} version={workspace.quote.currentVersion} requestStatus={workspace.request.status} validity={validity ?? { label: 'Vigencia por confirmar', expired: false }} contactDisplayName={workspace.request.contact.displayName} onAccepted={() => void loadDetail(workspace.request.id)} onChangeRequested={() => { setMessagingRefreshKey((current) => current + 1); void loadDetail(workspace.request.id, { silent: true }); }} /><div className="client-quote__lines">{workspace.quote.currentVersion.lines.map((line, index) => <div className="client-quote-line" key={`${line.catalogItemCode ?? 'special'}-${line.name}-${index}`}><div><strong>{line.name}</strong><small>{line.catalogItemCode ?? 'Concepto especial'} · {quantityLabel(line.quantityMilliunits)} {line.unit}</small></div><span>{moneyLabel(line.totalMinor, line.currencyCode)}</span></div>)}</div><div className="client-quote__summary"><span>Subtotal <b>{moneyLabel(workspace.quote.currentVersion.subtotalMinor, workspace.quote.currentVersion.currencyCode)}</b></span>{/^0+$/u.test(workspace.quote.currentVersion.discountTotalMinor) ? null : <span>Descuento <b>− {moneyLabel(workspace.quote.currentVersion.discountTotalMinor, workspace.quote.currentVersion.currencyCode)}</b></span>}<span>Impuestos <b>{moneyLabel(workspace.quote.currentVersion.taxTotalMinor, workspace.quote.currentVersion.currencyCode)}</b></span></div></section> : <section className="client-quote client-quote--empty"><p className="client-eyebrow">Propuesta</p><h3>Estamos preparando los detalles.</h3><p>Cuando exista una propuesta disponible, aparecerá en este expediente.</p></section>}<ClientFilesPanel requestId={workspace.request.id} /><ClientMessagingThread key={messagingRefreshKey} requestId={workspace.request.id} /><section className="client-version-history"><div className="client-section-head"><div><p className="client-eyebrow">Trazabilidad</p><h3>Versiones compartidas</h3></div><span>{workspace.quote?.versions.length ?? 0}</span></div>{workspace.quote?.versions.length ? <ol>{workspace.quote.versions.map((version) => <li key={version.id}><span>V{version.versionNumber}</span><div><strong>{versionStatusLabel(version.status)}</strong><small>{moneyLabel(version.totalMinor, version.currencyCode)} · {formatDate(version.createdAt)}</small></div></li>)}</ol> : <p className="client-history-empty">Todavía no hay versiones compartidas.</p>}</section></>}
        </section>
      </section>
    </div>
    <footer className="client-footer"><WorkspaceLogo className="client-footer__logo" /><small>Diseño, ingeniería y agua con intención.</small></footer>
  </PrivateSurfaceRoot>;
}
