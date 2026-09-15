'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import StaffQuoteDocumentPanel from '@/components/StaffQuoteDocumentPanel';
import CatalogItemSearchCombobox, { type CatalogSearchResultItem } from '@/components/CatalogItemSearchCombobox';
import DateField from '@/components/DateField';
import SelectField from '@/components/SelectField';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINE_LABELS,
} from '@/server/modules/quote-requests/domain';

const STATUS_LABELS: Record<string, string> = {
  EN_ELABORACION: 'En elaboración',
  COTIZACION_DISPONIBLE: 'Cotización disponible',
  EN_NEGOCIACION: 'En negociación',
  BORRADOR: 'Borrador',
  EN_REVISION: 'En revisión',
  ENVIADA: 'Enviada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
};

type Capabilities = {
  quotesRead: boolean;
  quotesCreate: boolean;
  quotesEditPrices: boolean;
  quotesApplyDiscount: boolean;
  quotesApproveDiscount: boolean;
  quotesSend: boolean;
  quotesPdfRead: boolean;
  quotesPdfGenerate: boolean;
};

type QuoteListItem = {
  id: string;
  folio: string;
  status: string;
  updatedAt: string;
  client: { id: string; displayName: string };
  detail: { projectType: string; location: string; currencyCode: string; projectStage: string | null; dimensions: string | null; timeline: string | null; budgetRange: string | null } | null;
  quote: { id: string; currentVersion: { id: string; versionNumber: number; status: string; currencyCode: string; totalMinor: string; discountTotalMinor: string; validUntil: string | null } | null } | null;
};

type QuoteLine = {
  id: string;
  catalogItemId: string;
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

type QuoteApproval = {
  id: string;
  type: string;
  status: string;
  policyVersion: string;
  thresholdBps: number | null;
  reason: string | null;
  requestedById: string;
  decidedById: string | null;
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
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
  createdBy: { id: string; displayName: string };
  lines: QuoteLine[];
  approvals: QuoteApproval[];
};

type Workspace = {
  request: {
    id: string;
    folio: string;
    origin: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    client: { id: string; displayName: string; status: string };
    contact: { id: string; displayName: string; email: string; phone: string | null; roleTitle: string | null; status: string };
    detail: { id: string; projectType: string; location: string; budgetCents: string | null; currencyCode: string; dimensions: string | null; projectStage: string | null; timeline: string | null; budgetRange: string | null; description: string; consentAt: string } | null;
  };
  quote: { id: string; currentVersionId: string | null; currentVersion: QuoteVersion | null; versions: QuoteVersion[]; history: Array<{ id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; changedBy: { id: string; displayName: string } | null }> } | null;
  priceLists: Array<{ id: string; code: string; name: string; currencyCode: string }>;
};

type PriceList = { id: string; code: string; name: string; currencyCode: string; status: string };
type PriceListDetail = PriceList & { items: Array<{ id: string; catalogItemId: string; unitPriceMinor: string; validFrom: string; validUntil: string | null; catalogItem: { code: string; name: string; unit: string; status: string } }> };
type DraftLine = {
  id: string;
  catalogItemId: string;
  catalogItemName: string;
  catalogItemCode: string;
  unit: string;
  quantity: string;
  unitPriceMinorOverride: string;
  unitPriceInput: string;
  snapshotUnitPriceMinor: string | null;
  unitPriceDirty: boolean;
  discountBasisPoints: string;
  taxBasisPoints: string;
};
type ErrorResponse = { error?: { message?: string } };

function statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }

function approvalStatusLabel(status: string): string {
  return ({ REQUESTED: 'Pendiente de aprobación', APPROVED: 'Aprobada', REJECTED: 'Rechazada', SUPERSEDED: 'Reemplazada', CANCELLED: 'Cancelada' } as Record<string, string>)[status] ?? status;
}

function qualificationLabel(value: string | null | undefined, labels: Record<string, string>): string {
  return value ? labels[value] ?? value : 'No indicado';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function moneyLabel(value: string | bigint, currency = 'MXN'): string {
  const raw = typeof value === 'bigint' ? value.toString() : value;
  if (!/^\d+$/u.test(raw)) return '—';
  const amount = BigInt(raw);
  const whole = amount / 100n;
  const decimals = (amount % 100n).toString().padStart(2, '0');
  return `${currency} ${whole.toLocaleString('es-MX')}.${decimals}`;
}

function moneyInputLabel(value: string): string {
  if (!/^\d+$/u.test(value)) return '';
  const amount = BigInt(value);
  return `${(amount / 100n).toString()}.${(amount % 100n).toString().padStart(2, '0')}`;
}

function parseMoneyInput(value: string): string | null {
  const normalized = value.trim().replace(/,/gu, '');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (!match) return null;
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')).toString();
}

function quantityLabel(milliunits: string): string {
  if (!/^\d+$/u.test(milliunits)) return '—';
  const value = BigInt(milliunits);
  const whole = value / 1000n;
  const decimals = (value % 1000n).toString().padStart(3, '0').replace(/0+$/u, '');
  return decimals ? `${whole.toString()}.${decimals}` : whole.toString();
}

function parseQuantity(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/u.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0') || '0');
}

function parseBps(value: string): bigint | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const basisPoints = BigInt(value.trim());
  return basisPoints <= 10000n ? basisPoints : null;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint { return numerator / denominator + ((numerator % denominator) * 2n >= denominator ? 1n : 0n); }

function calculatePreview(line: DraftLine, priceMinor: string | undefined) {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = line.unitPriceDirty
    ? parseMoneyInput(line.unitPriceInput)
    : line.snapshotUnitPriceMinor ?? (line.unitPriceMinorOverride.trim() || priceMinor);
  const discount = parseBps(line.discountBasisPoints);
  const tax = parseBps(line.taxBasisPoints);
  if (!quantity || !unitPrice || !/^\d+$/.test(unitPrice) || discount === null || tax === null) return null;
  const subtotal = roundHalfUp(BigInt(unitPrice) * quantity, 1000n);
  const discountMinor = roundHalfUp(subtotal * discount, 10000n);
  const taxable = subtotal - discountMinor;
  const taxMinor = roundHalfUp(taxable * tax, 10000n);
  return { subtotal, discount: discountMinor, taxable, tax: taxMinor, total: taxable + taxMinor, unitPrice };
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible completar la operación.');
  return data as T;
}

export default function StaffQuotesPanel() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [requests, setRequests] = useState<QuoteListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListDetail, setPriceListDetail] = useState<PriceListDetail | null>(null);
  const [selectedPriceListId, setSelectedPriceListId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [validUntil, setValidUntil] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBase = useCallback(async (currentPage: number, query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' });
      if (query) params.set('query', query);
      const [capabilitiesResponse, requestsResponse, listsResponse] = await Promise.all([
        fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/staff/quotes?${params.toString()}`, { credentials: 'include', cache: 'no-store' }),
        fetch('/api/staff/catalog/price-lists?status=ACTIVE', { credentials: 'include', cache: 'no-store' }),
      ]);
      const currentCapabilities = await readResponse<Capabilities>(capabilitiesResponse);
      if (!currentCapabilities.quotesRead) throw new Error('No tienes permisos para consultar el constructor de cotizaciones.');
      const [requestData, listData] = await Promise.all([
        readResponse<{ items: QuoteListItem[]; page: number; total: number; totalPages: number }>(requestsResponse),
        readResponse<PriceList[]>(listsResponse),
      ]);
      setCapabilities(currentCapabilities);
      setRequests(requestData.items);
      setTotal(requestData.total);
      setTotalPages(Math.max(1, requestData.totalPages));
      setPriceLists(listData);
      setRestricted(false);
      setSelectedId((current) => current && requestData.items.some((item) => item.id === current) ? current : requestData.items[0]?.id ?? null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el constructor.';
      setRestricted(message.includes('autenticada') || message.includes('permisos'));
      setError(message);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (requestId: string) => {
    setLoadingWorkspace(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/${requestId}`, { credentials: 'include', cache: 'no-store' });
      const data = await readResponse<Workspace>(response);
      setWorkspace(data);
      const currentVersion = data.quote?.currentVersion;
      const preferredList = data.priceLists.find((list) => list.currencyCode === (currentVersion?.currencyCode ?? data.request.detail?.currencyCode)) ?? data.priceLists[0];
      setSelectedPriceListId((current) => current && data.priceLists.some((list) => list.id === current) ? current : preferredList?.id ?? '');
      setValidUntil(currentVersion?.validUntil ? currentVersion.validUntil.slice(0, 10) : '');
      setDraftLines((currentVersion?.lines ?? []).map((line) => ({
        id: line.id,
        catalogItemId: line.catalogItemId,
        catalogItemName: line.name,
        catalogItemCode: line.catalogItemCode,
        unit: line.unit,
        quantity: quantityLabel(line.quantityMilliunits),
        unitPriceMinorOverride: line.unitPriceMinor,
        unitPriceInput: moneyInputLabel(line.unitPriceMinor),
        snapshotUnitPriceMinor: line.unitPriceMinor,
        unitPriceDirty: false,
        discountBasisPoints: String(line.discountBasisPoints),
        taxBasisPoints: String(line.taxBasisPoints),
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el expediente de cotización.');
      setWorkspace(null);
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => { void loadBase(page, appliedSearch); }, [appliedSearch, loadBase, page]);
  useEffect(() => { if (selectedId) void loadWorkspace(selectedId); else setWorkspace(null); }, [loadWorkspace, selectedId]);
  useEffect(() => {
    const requestFromUrl = new URLSearchParams(window.location.search).get('request');
    if (requestFromUrl) setSelectedId(requestFromUrl);
  }, []);

  useEffect(() => {
    if (!selectedPriceListId) { setPriceListDetail(null); return; }
    let cancelled = false;
    void fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { credentials: 'include', cache: 'no-store' }).then((response) => readResponse<PriceListDetail>(response)).then((data) => { if (!cancelled) setPriceListDetail(data); }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'No fue posible cargar los precios.'); });
    return () => { cancelled = true; };
  }, [selectedPriceListId]);

  const pricesByItem = useMemo(() => new Map((priceListDetail?.items ?? []).map((item) => [item.catalogItemId, item])), [priceListDetail]);
  const preview = useMemo(() => draftLines.reduce((summary, line) => {
    const result = calculatePreview(line, pricesByItem.get(line.catalogItemId)?.unitPriceMinor);
    if (!result) return { ...summary, valid: false };
    return { valid: summary.valid, subtotal: summary.subtotal + result.subtotal, discount: summary.discount + result.discount, taxable: summary.taxable + result.taxable, tax: summary.tax + result.tax, total: summary.total + result.total };
  }, { valid: true, subtotal: 0n, discount: 0n, taxable: 0n, tax: 0n, total: 0n }), [draftLines, pricesByItem]);

  const currentVersion = workspace?.quote?.currentVersion ?? null;
  const hasDiscount = currentVersion ? BigInt(currentVersion.discountTotalMinor) > 0n : false;
  const activeDiscountApproval = currentVersion?.approvals.find((approval) => approval.type === 'DISCOUNT' && ['REQUESTED', 'APPROVED'].includes(approval.status)) ?? null;
  const discountApproval = currentVersion?.approvals.find((approval) => approval.type === 'DISCOUNT') ?? null;
  const hasApprovedDiscount = activeDiscountApproval?.status === 'APPROVED';
  const canPublish = Boolean(capabilities?.quotesSend && capabilities.quotesPdfGenerate);
  const canEdit = Boolean(capabilities?.quotesCreate && workspace && (!currentVersion || currentVersion.status === 'BORRADOR'));
  const canStartVersion = Boolean(capabilities?.quotesCreate && workspace && currentVersion && ['ENVIADA', 'EN_NEGOCIACION'].includes(currentVersion.status));
  const selectedCurrency = priceListDetail?.currencyCode ?? workspace?.request.detail?.currencyCode ?? 'MXN';

  const refresh = async () => {
    if (selectedId) await loadWorkspace(selectedId);
    await loadBase(page, appliedSearch);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); };

  const addLineFromSearch = (item: CatalogSearchResultItem) => {
    if (draftLines.some((line) => line.catalogItemId === item.id)) return;
    setDraftLines((lines) => [...lines, {
      id: `${item.id}-${Date.now()}`,
      catalogItemId: item.id,
      catalogItemName: item.name,
      catalogItemCode: item.code,
      unit: item.unit,
      quantity: '1',
      unitPriceMinorOverride: '',
      unitPriceInput: '',
      snapshotUnitPriceMinor: null,
      unitPriceDirty: false,
      discountBasisPoints: '0',
      taxBasisPoints: '0',
    }]);
  };

  const updateLine = (id: string, field: keyof Omit<DraftLine, 'id' | 'catalogItemId'>, value: string) => setDraftLines((lines) => lines.map((line) => line.id === id ? { ...line, [field]: value } : line));

  const saveDraft = async () => {
    if (!workspace || !selectedPriceListId || draftLines.length === 0 || !capabilities?.quotesCreate) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const payload = {
        priceListId: selectedPriceListId,
        lines: draftLines.map((line) => {
          const unitPriceMinorOverride = line.unitPriceDirty
            ? parseMoneyInput(line.unitPriceInput)
            : line.snapshotUnitPriceMinor ?? line.unitPriceMinorOverride.trim();
          return {
            catalogItemId: line.catalogItemId,
            quantity: line.quantity,
            ...(unitPriceMinorOverride ? { unitPriceMinorOverride } : {}),
            discountBasisPoints: Number(line.discountBasisPoints || '0'),
            taxBasisPoints: Number(line.taxBasisPoints || '0'),
          };
        }),
        ...(validUntil ? { validUntil: new Date(`${validUntil}T23:59:59.999Z`).toISOString() } : {}),
        ...(!currentVersion || currentVersion.status === 'BORRADOR' ? {} : { expectedCurrentVersionNumber: currentVersion.versionNumber }),
      };
      const isDraftUpdate = currentVersion?.status === 'BORRADOR';
      const response = await fetch(isDraftUpdate ? `/api/staff/quotes/versions/${currentVersion.id}` : `/api/staff/quotes/${workspace.request.id}`, { method: isDraftUpdate ? 'PATCH' : 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      await readResponse(response);
      setNotice(isDraftUpdate ? 'Borrador actualizado.' : 'Nueva versión creada como borrador.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible guardar la cotización.'); }
    finally { setSaving(false); }
  };

  const transition = async (toStatus: string) => {
    if (!currentVersion) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toStatus }) });
      await readResponse(response);
      setNotice(`Cotización movida a ${statusLabel(toStatus).toLowerCase()}.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.'); }
    finally { setSaving(false); }
  };

  const requestDiscountApproval = async () => {
    if (!currentVersion || !hasDiscount || currentVersion.status !== 'EN_REVISION') return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/approvals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: Math.max(...currentVersion.lines.map((line) => line.discountBasisPoints), 0) }),
      });
      await readResponse(response);
      setNotice('Aprobación solicitada. Una persona autorizada debe resolverla antes de enviar la cotización.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible solicitar la aprobación.'); }
    finally { setSaving(false); }
  };

  const decideDiscountApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/staff/quotes/approvals/${approvalId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(decision === 'REJECTED' ? { reason: 'No se autoriza el descuento en esta versión.' } : {}) }),
      });
      await readResponse(response);
      setNotice(decision === 'APPROVED' ? 'Descuento aprobado. Ya puedes enviar la cotización.' : 'Aprobación rechazada; revisa la propuesta antes de continuar.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible resolver la aprobación.'); }
    finally { setSaving(false); }
  };

  if (restricted) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><section className="staff-empty"><WorkspaceLogo className="staff-empty__logo" /><p className="staff-kicker">Área interna</p><h1>Acceso restringido.</h1><p>Inicia sesión con una cuenta de empleado con permiso comercial para usar el constructor.</p><div className="staff-empty__actions"><Link className="staff-button staff-button--dark" href="/login">Iniciar sesión</Link><Link className="staff-empty__link" href="/staff/requests">Volver a solicitudes</Link></div></section></PrivateSurfaceRoot>;

  return <PrivateSurfaceRoot className="staff-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Constructor de cotizaciones</div></div></header>
    <div className="staff-content">
      <div className="staff-intro"><div><p className="staff-kicker">Trabajo comercial</p><h1>Cotizaciones</h1><p className="staff-intro__copy">Convierte el alcance de cada expediente en una propuesta trazable, precisa y lista para revisión.</p></div><div className="staff-intro__metric"><strong>{total}</strong><span>expedientes listos</span></div></div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      <section className="quotes-workspace" aria-label="Constructor de cotizaciones">
        <aside className="quotes-rail">
          <form className="staff-filters" onSubmit={submitSearch}><label><span>Buscar expediente</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Folio o cliente" maxLength={100} /></label><button className="staff-button staff-button--filter" type="submit">Aplicar búsqueda</button></form>
          <div className="staff-inbox__head"><span>{loading ? 'Actualizando…' : `${requests.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
          <div className="quotes-request-list" aria-live="polite">
            {loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}
            {!loading && requests.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark">—</span><h2>Sin expedientes listos.</h2><p>Las solicitudes en elaboración o negociación aparecerán aquí.</p></div>}
            {!loading && requests.map((item) => <button className={`quotes-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><span className="quotes-request-row__signal" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.client.displayName}</b><small>{item.detail?.projectType ?? 'Sin tipo'} · {item.detail?.location ?? 'Sin ubicación'}</small></span><em>{item.quote?.currentVersion ? `V${item.quote.currentVersion.versionNumber}` : 'Nuevo'}</em></button>)}
          </div>
          <div className="staff-pagination"><button type="button" className="staff-pagination__button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</button><button type="button" className="staff-pagination__button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div>
        </aside>
        <section className="quotes-main">
          {loadingWorkspace && <div className="staff-detail__loading"><span /><span /><span /></div>}
          {!loadingWorkspace && !workspace && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Selecciona un expediente.</h2><p>El alcance y las líneas de cotización aparecerán aquí.</p></div>}
          {!loadingWorkspace && workspace && <>
            <div className="quotes-main__top"><div><p className="staff-kicker">{workspace.request.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{workspace.request.folio}</h2><p className="staff-detail__date">{workspace.request.client.displayName} · Actualizado {formatDate(workspace.request.updatedAt)}</p></div><span className={`staff-status-pill staff-status-pill--${workspace.request.status.toLowerCase()}`}>{statusLabel(workspace.request.status)}</span></div>
            <div className="quotes-brief"><div><p className="staff-section-label">Alcance</p><strong>{workspace.request.detail?.projectType ?? 'Sin tipo de proyecto'}</strong><span>{workspace.request.detail?.location ?? 'Sin ubicación'}{workspace.request.detail?.dimensions ? ` · ${workspace.request.detail.dimensions}` : ''}</span></div><div><p className="staff-section-label">Calificación</p><strong>{qualificationLabel(workspace.request.detail?.projectStage, QUOTE_REQUEST_PROJECT_STAGE_LABELS)}</strong><span>{qualificationLabel(workspace.request.detail?.timeline, QUOTE_REQUEST_TIMELINE_LABELS)} · {qualificationLabel(workspace.request.detail?.budgetRange, QUOTE_REQUEST_BUDGET_RANGE_LABELS)}</span></div><div><p className="staff-section-label">Contacto</p><strong>{workspace.request.contact.displayName}</strong><span>{workspace.request.contact.email}</span></div><div><p className="staff-section-label">Moneda</p><strong>{selectedCurrency}</strong><span>{workspace.request.detail?.budgetCents ? `Presupuesto ${moneyLabel(workspace.request.detail.budgetCents, workspace.request.detail.currencyCode)}` : 'Sin presupuesto declarado'}</span></div></div>
            <section className="quotes-builder"><div className="quotes-builder__head"><div><p className="staff-section-label">Composición</p><h3>{currentVersion ? `Versión ${currentVersion.versionNumber} · ${statusLabel(currentVersion.status)}` : 'Primera versión'}</h3></div><label className="quotes-list-select"><span>Lista de precios</span><SelectField ariaLabel="Lista de precios" value={selectedPriceListId} onValueChange={setSelectedPriceListId} options={priceLists.map((list) => ({ value: list.id, label: `${list.name} · ${list.currencyCode}` }))} placeholder="Selecciona una lista" disabled={!canEdit && !canStartVersion} /></label></div>
              <div className="quotes-lines-head"><span>Concepto</span><span>Cantidad</span><span>Precio</span><span>Descuento</span><span>Impuesto</span><span>Total</span><span className="sr-only">Acción</span></div>
              <div className="quotes-lines">
                {draftLines.map((line) => { const price = pricesByItem.get(line.catalogItemId)?.unitPriceMinor; const linePreview = calculatePreview(line, price); const displayedPrice = line.unitPriceDirty ? line.unitPriceInput : line.snapshotUnitPriceMinor ? moneyInputLabel(line.snapshotUnitPriceMinor) : price ? moneyInputLabel(price) : ''; return <div className="quotes-line" key={line.id}><div className="quotes-line__item"><strong>{line.catalogItemName}</strong><small>{line.catalogItemCode} · {line.unit}</small></div><label><span className="quotes-mobile-label">Cantidad</span><input aria-label={`Cantidad de ${line.catalogItemName}`} value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', event.target.value)} disabled={!canEdit} inputMode="decimal" /></label><label><span className="quotes-mobile-label">Precio</span><input aria-label={`Precio de ${line.catalogItemName}`} value={displayedPrice} onChange={(event) => setDraftLines((lines) => lines.map((candidate) => candidate.id === line.id ? { ...candidate, unitPriceInput: event.target.value, unitPriceMinorOverride: parseMoneyInput(event.target.value) ?? '', unitPriceDirty: true } : candidate))} disabled={!canEdit || !capabilities?.quotesEditPrices} placeholder={price ? moneyInputLabel(price) : 'Sin precio'} inputMode="decimal" /></label><label><span className="quotes-mobile-label">Desc. %</span><input aria-label={`Descuento de ${line.catalogItemName}`} value={line.discountBasisPoints === '0' ? '' : (Number(line.discountBasisPoints) / 100).toString()} onChange={(event) => updateLine(line.id, 'discountBasisPoints', event.target.value === '' ? '0' : String(Math.round(Number(event.target.value) * 100)))} disabled={!canEdit || !capabilities?.quotesApplyDiscount} inputMode="decimal" placeholder="0" /></label><label><span className="quotes-mobile-label">IVA pb</span><input aria-label={`Impuesto de ${line.catalogItemName}`} value={line.taxBasisPoints === '0' ? '' : (Number(line.taxBasisPoints) / 100).toString()} onChange={(event) => updateLine(line.id, 'taxBasisPoints', event.target.value === '' ? '0' : String(Math.round(Number(event.target.value) * 100)))} disabled={!canEdit} inputMode="decimal" placeholder="0" /></label><strong className="quotes-line__total">{linePreview ? moneyLabel(linePreview.total, selectedCurrency) : '—'}</strong><button className="quotes-line__remove" type="button" aria-label={`Quitar ${line.catalogItemName}`} onClick={() => setDraftLines((lines) => lines.filter((candidate) => candidate.id !== line.id))} disabled={!canEdit}>×</button></div>; })}
                {draftLines.length === 0 && <div className="quotes-lines__empty"><strong>Aún no hay conceptos.</strong><span>Agrega los servicios que componen esta propuesta.</span></div>}
              </div>
              {(canEdit || canStartVersion) && <div className="quotes-add-line"><CatalogItemSearchCombobox priceListId={selectedPriceListId} currencyCode={selectedCurrency} excludeIds={draftLines.map((line) => line.catalogItemId)} disabled={!selectedPriceListId} onSelect={addLineFromSearch} /></div>}
              <div className="quotes-summary"><div><span>Subtotal</span><strong>{moneyLabel(preview.subtotal, selectedCurrency)}</strong></div><div><span>Descuentos</span><strong>− {moneyLabel(preview.discount, selectedCurrency)}</strong></div><div><span>Impuestos</span><strong>{moneyLabel(preview.tax, selectedCurrency)}</strong></div><div className="quotes-summary__total"><span>Total de propuesta</span><strong>{preview.valid ? moneyLabel(preview.total, selectedCurrency) : 'Revisa las líneas'}</strong></div></div>
              <div className="quotes-actions"><label><span>Vigencia hasta</span><DateField ariaLabel="Vigencia hasta" value={validUntil} onValueChange={setValidUntil} disabled={!canEdit && !canStartVersion} /></label>{canEdit || canStartVersion ? <button className="staff-button staff-button--dark" type="button" disabled={saving || !preview.valid || draftLines.length === 0 || !selectedPriceListId} onClick={() => void saveDraft()}>{saving ? 'Guardando…' : currentVersion?.status === 'BORRADOR' ? 'Guardar borrador' : currentVersion ? 'Crear nueva versión' : 'Crear borrador'}</button> : null}{currentVersion?.status === 'BORRADOR' && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || draftLines.length === 0} onClick={() => void transition('EN_REVISION')}>Pasar a revisión</button> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount && !hasApprovedDiscount && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || Boolean(activeDiscountApproval)} onClick={() => void requestDiscountApproval()}>{activeDiscountApproval?.status === 'REQUESTED' ? 'Aprobación solicitada' : 'Solicitar aprobación'}</button> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount && activeDiscountApproval?.status === 'REQUESTED' && capabilities?.quotesApproveDiscount ? <><button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void decideDiscountApproval(activeDiscountApproval.id, 'APPROVED')}>Aprobar descuento</button><button className="staff-button staff-button--danger" type="button" disabled={saving} onClick={() => void decideDiscountApproval(activeDiscountApproval.id, 'REJECTED')}>Rechazar</button></> : null}{currentVersion?.status === 'EN_REVISION' && canPublish && (!hasDiscount || hasApprovedDiscount) ? <button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void transition('ENVIADA')}>Enviar cotización</button> : null}{currentVersion?.status === 'EN_REVISION' && capabilities?.quotesSend && !capabilities.quotesPdfGenerate ? <p className="quotes-action-note">Tu perfil puede enviar, pero necesita permiso para preparar el PDF comercial.</p> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount ? <p className="quotes-action-note">{discountApproval ? `${approvalStatusLabel(discountApproval.status)}. ` : ''}{hasApprovedDiscount ? 'La versión tiene una aprobación vigente.' : 'Esta versión no puede enviarse hasta contar con una aprobación vigente.'}</p> : null}</div>
              {hasDiscount && currentVersion?.approvals.length ? <div className="quotes-approval-summary" aria-label="Historial de aprobación"><strong>Control de descuento</strong>{currentVersion.approvals.filter((approval) => approval.type === 'DISCOUNT').slice(0, 3).map((approval) => <span key={approval.id}>{approvalStatusLabel(approval.status)} · {formatDate(approval.requestedAt)}</span>)}</div> : null}
            </section>
            {currentVersion && <StaffQuoteDocumentPanel versionId={currentVersion.id} versionNumber={currentVersion.versionNumber} canRead={Boolean(capabilities?.quotesPdfRead)} canGenerate={Boolean(capabilities?.quotesPdfGenerate)} />}
            {workspace.request.detail?.description && <section className="quotes-scope"><p className="staff-section-label">Alcance compartido</p><p>{workspace.request.detail.description}</p></section>}
            <section className="quotes-history"><div><p className="staff-section-label">Trazabilidad</p><h3>Historial de versiones</h3></div><ol>{workspace.quote?.versions.map((version) => <li key={version.id}><span className="quotes-history__mark">V{version.versionNumber}</span><div><strong>{statusLabel(version.status)}</strong><span>{moneyLabel(version.totalMinor, version.currencyCode)} · {version.createdBy.displayName}</span><time dateTime={version.createdAt}>{formatDate(version.createdAt)}</time></div></li>) ?? <li className="quotes-history__empty">Todavía no hay versiones guardadas.</li>}</ol></section>
          </>}
        </section>
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
