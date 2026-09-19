'use client';

import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Inbox, X } from 'lucide-react';
import StaffQuoteDocumentPanel from '@/components/StaffQuoteDocumentPanel';
import CatalogItemSearchCombobox, { type CatalogSearchResultItem } from '@/components/CatalogItemSearchCombobox';
import { moneyInputLabel, parseMoneyInput } from '@/lib/money-input';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDatePicker, PrivateDialog, PrivateLinkButton, PrivateMoneyField, PrivatePagination, PrivateSelect, usePrivateToast } from '@/components/private/ui';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINE_LABELS,
} from '@/server/modules/quote-requests/domain';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_VERSION_STATUS_LABELS, statusToneIcon } from '@/lib/labels';

type AutosaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'offline';

const AUTOSAVE_DEBOUNCE_MS = 800;

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
  catalogItemId: string | null;
  catalogItemCode: string | null;
  name: string;
  description: string | null;
  unit: string;
  specialReason: string | null;
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

type DocumentStatus = 'MISSING' | 'PENDING' | 'READY' | 'FAILED' | 'DELETED';

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
  special: boolean;
  catalogItemId: string | null;
  catalogItemName: string;
  catalogItemCode: string;
  description: string;
  reason: string;
  unit: string;
  quantity: string;
  unitPriceMinorOverride: string;
  unitPriceInput: string;
  snapshotUnitPriceMinor: string | null;
  unitPriceDirty: boolean;
  discountBasisPoints: string;
  taxBasisPoints: string;
};

function statusLabel(status: string): string {
  return (QUOTE_VERSION_STATUS_LABELS as Record<string, string>)[status]
    ?? (QUOTE_REQUEST_STATUS_LABELS as Record<string, string>)[status]
    ?? status;
}

function StatusPill({ status }: { status: string }) {
  const ToneIcon = statusToneIcon(status);
  return <span className={`staff-status-pill staff-status-pill--${status.toLowerCase()}`}><ToneIcon size={11} aria-hidden="true" />{statusLabel(status)}</span>;
}

const AUTOSAVE_STATE_LABELS: Record<AutosaveState, string> = {
  dirty: 'Sin guardar',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'Error al guardar',
  conflict: 'Conflicto de versión',
  offline: 'Sin conexión',
};

function AutosaveIndicator({ state }: { state: AutosaveState }) {
  return <span className={`quotes-autosave quotes-autosave--${state}`} role="status" aria-live="polite">{AUTOSAVE_STATE_LABELS[state]}</span>;
}

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

function draftSnapshotKey(priceListId: string, validUntilValue: string, lines: DraftLine[]): string {
  return JSON.stringify({ priceListId, validUntilValue, lines: lines.map((line) => ({ special: line.special, catalogItemId: line.catalogItemId, catalogItemName: line.catalogItemName, unit: line.unit, description: line.description, reason: line.reason, quantity: line.quantity, unitPriceInput: line.unitPriceInput, unitPriceDirty: line.unitPriceDirty, discountBasisPoints: line.discountBasisPoints, taxBasisPoints: line.taxBasisPoints })) });
}

function calculatePreview(line: DraftLine, priceMinor: string | undefined) {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = line.special
    ? parseMoneyInput(line.unitPriceInput)
    : line.unitPriceDirty
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

export default function StaffQuotesPanel() {
  const router = useRouter();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [requests, setRequests] = useState<QuoteListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListDetail, setPriceListDetail] = useState<PriceListDetail | null>(null);
  const [selectedPriceListId, setSelectedPriceListId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [showSpecialForm, setShowSpecialForm] = useState(false);
  const [specialForm, setSpecialForm] = useState({ name: '', unit: '', description: '', amountInput: '', reason: '' });
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
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('saved');
  const [autosaveMessage, setAutosaveMessage] = useState<string | null>(null);
  const [repriceDialogOpen, setRepriceDialogOpen] = useState(false);
  const [publishPreflight, setPublishPreflight] = useState<{ documentStatus: DocumentStatus; loading: boolean } | null>(null);
  const savedSnapshotRef = useRef('');
  const expectedUpdatedAtRef = useRef<string | null>(null);
  const lastAttemptSnapshotRef = useRef('');
  const errorRetryCountRef = useRef(0);
  const selectedPriceListIdRef = useRef('');
  useEffect(() => { selectedPriceListIdRef.current = selectedPriceListId; }, [selectedPriceListId]);
  const validUntilRef = useRef('');
  useEffect(() => { validUntilRef.current = validUntil; }, [validUntil]);
  const draftLinesRef = useRef<DraftLine[]>([]);
  useEffect(() => { draftLinesRef.current = draftLines; }, [draftLines]);
  const { showToast } = usePrivateToast();

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
      const capabilitiesResult = await readApiResponse<Capabilities>(capabilitiesResponse, 'No fue posible cargar el constructor.');
      if (!capabilitiesResult.ok) {
        setRestricted(capabilitiesResult.kind === 'forbidden');
        setError(capabilitiesResult.message);
        setRequests([]);
        return;
      }
      if (!capabilitiesResult.data.quotesRead) {
        setRestricted(true);
        setError('No tienes permisos para consultar el constructor de cotizaciones.');
        setRequests([]);
        return;
      }
      const currentCapabilities = capabilitiesResult.data;
      const [requestData, listData] = await Promise.all([
        readApiResponseOrThrow<{ items: QuoteListItem[]; page: number; total: number; totalPages: number }>(requestsResponse, 'No fue posible cargar el constructor.'),
        readApiResponseOrThrow<PriceList[]>(listsResponse, 'No fue posible cargar el constructor.'),
      ]);
      setCapabilities(currentCapabilities);
      setRequests(requestData.items);
      setTotal(requestData.total);
      setTotalPages(Math.max(1, requestData.totalPages));
      setPriceLists(listData);
      setRestricted(false);
      setSelectedId((current) => current && requestData.items.some((item) => item.id === current) ? current : requestData.items[0]?.id ?? null);
    } catch (caught) {
      setRestricted(false);
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el constructor.');
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
      const data = await readApiResponseOrThrow<Workspace>(response, 'No fue posible cargar el expediente de cotización.');
      setWorkspace(data);
      const currentVersion = data.quote?.currentVersion;
      const preferredList = data.priceLists.find((list) => list.currencyCode === (currentVersion?.currencyCode ?? data.request.detail?.currencyCode)) ?? data.priceLists[0];
      const freshPriceListId = data.priceLists.some((list) => list.id === selectedPriceListIdRef.current) ? selectedPriceListIdRef.current : preferredList?.id ?? '';
      const freshValidUntil = currentVersion?.validUntil ? currentVersion.validUntil.slice(0, 10) : '';
      const freshDraftLines: DraftLine[] = (currentVersion?.lines ?? []).map((line) => ({
        id: line.id,
        special: line.catalogItemId === null,
        catalogItemId: line.catalogItemId,
        catalogItemName: line.name,
        catalogItemCode: line.catalogItemCode ?? '',
        description: line.description ?? '',
        reason: line.specialReason ?? '',
        unit: line.unit,
        quantity: quantityLabel(line.quantityMilliunits),
        unitPriceMinorOverride: line.unitPriceMinor,
        unitPriceInput: moneyInputLabel(line.unitPriceMinor),
        snapshotUnitPriceMinor: line.unitPriceMinor,
        unitPriceDirty: false,
        discountBasisPoints: String(line.discountBasisPoints),
        taxBasisPoints: String(line.taxBasisPoints),
      }));
      setSelectedPriceListId(freshPriceListId);
      setValidUntil(freshValidUntil);
      setDraftLines(freshDraftLines);
      expectedUpdatedAtRef.current = currentVersion?.updatedAt ?? null;
      savedSnapshotRef.current = draftSnapshotKey(freshPriceListId, freshValidUntil, freshDraftLines);
      setAutosaveState('saved');
      setAutosaveMessage(null);
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
    void fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { credentials: 'include', cache: 'no-store' }).then((response) => readApiResponseOrThrow<PriceListDetail>(response, 'No fue posible cargar los precios.')).then((data) => { if (!cancelled) setPriceListDetail(data); }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'No fue posible cargar los precios.'); });
    return () => { cancelled = true; };
  }, [selectedPriceListId]);

  useEffect(() => {
    const goOffline = () => setAutosaveState((current) => (current === 'saving' || current === 'dirty' || current === 'error') ? 'offline' : current);
    const goOnline = () => setAutosaveState((current) => current === 'offline' ? 'dirty' : current);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
  }, []);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const shouldBlock = ['dirty', 'saving', 'error', 'offline'].includes(autosaveState);
    if (shouldBlock) window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [autosaveState]);

  const pricesByItem = useMemo(() => new Map((priceListDetail?.items ?? []).map((item) => [item.catalogItemId, item])), [priceListDetail]);
  const preview = useMemo(() => draftLines.reduce((summary, line) => {
    const result = calculatePreview(line, line.catalogItemId ? pricesByItem.get(line.catalogItemId)?.unitPriceMinor : undefined);
    if (!result) return { ...summary, valid: false };
    return { valid: summary.valid, subtotal: summary.subtotal + result.subtotal, discount: summary.discount + result.discount, taxable: summary.taxable + result.taxable, tax: summary.tax + result.tax, total: summary.total + result.total };
  }, { valid: true, subtotal: 0n, discount: 0n, taxable: 0n, tax: 0n, total: 0n }), [draftLines, pricesByItem]);

  const currentVersion = workspace?.quote?.currentVersion ?? null;
  const hasDiscount = currentVersion ? BigInt(currentVersion.discountTotalMinor) > 0n : false;
  const activeDiscountApproval = currentVersion?.approvals.find((approval) => approval.type === 'DISCOUNT' && ['REQUESTED', 'APPROVED'].includes(approval.status)) ?? null;
  const discountApproval = currentVersion?.approvals.find((approval) => approval.type === 'DISCOUNT') ?? null;
  const hasApprovedDiscount = activeDiscountApproval?.status === 'APPROVED';
  const hasSpecialLines = currentVersion ? currentVersion.lines.some((line) => line.catalogItemId === null) : false;
  const activeSpecialApproval = currentVersion?.approvals.find((approval) => approval.type === 'SPECIAL_CONCEPT' && ['REQUESTED', 'APPROVED'].includes(approval.status)) ?? null;
  const specialApproval = currentVersion?.approvals.find((approval) => approval.type === 'SPECIAL_CONCEPT') ?? null;
  const hasApprovedSpecial = activeSpecialApproval?.status === 'APPROVED';
  const canPublish = Boolean(capabilities?.quotesSend && capabilities.quotesPdfGenerate);
  const canEdit = Boolean(capabilities?.quotesCreate && workspace && (!currentVersion || currentVersion.status === 'BORRADOR')) && autosaveState !== 'conflict';
  const canStartVersion = Boolean(capabilities?.quotesCreate && workspace && currentVersion && ['ENVIADA', 'EN_NEGOCIACION'].includes(currentVersion.status));
  const selectedCurrency = priceListDetail?.currencyCode ?? workspace?.request.detail?.currencyCode ?? 'MXN';

  // Q1-04: repreciar es una comprobación explícita bajo demanda, no un aviso ambiental — el precio
  // vigente sólo se conoce con certeza si se consulta al servidor en el momento, ya que
  // `priceListDetail` (cargado una sola vez por `selectedPriceListId`) no se refresca solo si el
  // catálogo cambia mientras el borrador sigue abierto.
  const [checkingReprice, setCheckingReprice] = useState(false);
  const [repriceAfterTotal, setRepriceAfterTotal] = useState<{ valid: boolean; total: bigint } | null>(null);
  const [repriceCandidates, setRepriceCandidates] = useState<Array<{ id: string; name: string; oldPriceMinor: string; newPriceMinor: string }>>([]);

  const checkReprice = async () => {
    if (!selectedPriceListId || checkingReprice) return;
    setCheckingReprice(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { credentials: 'include', cache: 'no-store' });
      const fresh = await readApiResponseOrThrow<PriceListDetail>(response, 'No fue posible consultar los precios vigentes.');
      setPriceListDetail(fresh);
      const freshPricesByItem = new Map(fresh.items.map((item) => [item.catalogItemId, item]));
      const candidates = draftLines.flatMap((line) => {
        if (line.special || line.unitPriceDirty || line.snapshotUnitPriceMinor === null || !line.catalogItemId) return [];
        const livePriceMinor = freshPricesByItem.get(line.catalogItemId)?.unitPriceMinor;
        if (!livePriceMinor || livePriceMinor === line.snapshotUnitPriceMinor) return [];
        return [{ id: line.id, name: line.catalogItemName, oldPriceMinor: line.snapshotUnitPriceMinor, newPriceMinor: livePriceMinor }];
      });
      if (candidates.length === 0) { showToast('Los precios de esta propuesta ya están actualizados.'); return; }
      const newPriceById = new Map(candidates.map((candidate) => [candidate.id, candidate.newPriceMinor]));
      const after = draftLines.reduce((summary, line) => {
        const price = line.catalogItemId ? freshPricesByItem.get(line.catalogItemId)?.unitPriceMinor : undefined;
        const previewLine = newPriceById.has(line.id) ? { ...line, snapshotUnitPriceMinor: newPriceById.get(line.id)! } : line;
        const result = calculatePreview(previewLine, price);
        if (!result) return { ...summary, valid: false };
        return { valid: summary.valid, total: summary.total + result.total };
      }, { valid: true, total: 0n });
      setRepriceCandidates(candidates);
      setRepriceAfterTotal(after);
      setRepriceDialogOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible consultar los precios vigentes.');
    } finally {
      setCheckingReprice(false);
    }
  };

  const confirmReprice = () => {
    const newPriceById = new Map(repriceCandidates.map((candidate) => [candidate.id, candidate.newPriceMinor]));
    setDraftLines((lines) => lines.map((line) => {
      const newPriceMinor = newPriceById.get(line.id);
      if (newPriceMinor === undefined) return line;
      return { ...line, snapshotUnitPriceMinor: null, unitPriceMinorOverride: '', unitPriceInput: moneyInputLabel(newPriceMinor), unitPriceDirty: false };
    }));
    setRepriceDialogOpen(false);
    showToast(`Se repreció ${repriceCandidates.length} concepto${repriceCandidates.length === 1 ? '' : 's'} a la lista de precios vigente.`);
  };

  const refresh = async () => {
    if (selectedId) await loadWorkspace(selectedId);
    await loadBase(page, appliedSearch);
  };

  // Refresco ligero tras un autosave exitoso: trae approvals/historial/updatedAt frescos sin tocar
  // draftLines/selectedPriceListId/validUntil, que pueden ya haber avanzado más allá de lo recién persistido.
  const syncQuoteVersionMetadata = async (requestId: string): Promise<QuoteVersion | null> => {
    try {
      const response = await fetch(`/api/staff/quotes/${requestId}`, { credentials: 'include', cache: 'no-store' });
      const data = await readApiResponseOrThrow<Workspace>(response, 'No fue posible actualizar el expediente.');
      setWorkspace(data);
      expectedUpdatedAtRef.current = data.quote?.currentVersion?.updatedAt ?? null;
      return data.quote?.currentVersion ?? null;
    } catch {
      // el próximo ciclo de autosave o refresco manual reintentará; no interrumpir el guardado ya exitoso.
      return null;
    }
  };

  const createVersionFromSent = async () => {
    if (!workspace || !selectedPriceListId || draftLines.length === 0 || !capabilities?.quotesCreate || !currentVersion) return;
    setSaving(true); setError(null);
    try {
      const payload = {
        priceListId: selectedPriceListId,
        lines: buildLinesPayload(draftLines),
        ...(validUntil ? { validUntil: new Date(`${validUntil}T23:59:59.999Z`).toISOString() } : {}),
        expectedCurrentVersionNumber: currentVersion.versionNumber,
      };
      const response = await fetch(`/api/staff/quotes/${workspace.request.id}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      await readApiResponseOrThrow(response, 'No fue posible crear la nueva versión.');
      showToast('Nueva versión creada como borrador.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear la nueva versión.'); }
    finally { setSaving(false); }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); };

  const addLineFromSearch = (item: CatalogSearchResultItem) => {
    if (draftLines.some((line) => line.catalogItemId === item.id)) return;
    setDraftLines((lines) => [...lines, {
      id: `${item.id}-${Date.now()}`,
      special: false,
      catalogItemId: item.id,
      catalogItemName: item.name,
      catalogItemCode: item.code,
      description: '',
      reason: '',
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

  const addSpecialLine = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!specialForm.name.trim() || !specialForm.unit.trim() || !specialForm.reason.trim()) return;
    setDraftLines((lines) => [...lines, {
      id: `special-${Date.now()}`,
      special: true,
      catalogItemId: null,
      catalogItemName: specialForm.name.trim(),
      catalogItemCode: '',
      description: specialForm.description.trim(),
      reason: specialForm.reason.trim(),
      unit: specialForm.unit.trim(),
      quantity: '1',
      unitPriceMinorOverride: '',
      unitPriceInput: specialForm.amountInput,
      snapshotUnitPriceMinor: null,
      unitPriceDirty: true,
      discountBasisPoints: '0',
      taxBasisPoints: '0',
    }]);
    setSpecialForm({ name: '', unit: '', description: '', amountInput: '', reason: '' });
    setShowSpecialForm(false);
  };

  const updateLine = (id: string, field: keyof Omit<DraftLine, 'id' | 'catalogItemId' | 'special'>, value: string) => setDraftLines((lines) => lines.map((line) => line.id === id ? { ...line, [field]: value } : line));

  const buildLinesPayload = (lines: DraftLine[]) => lines.map((line) => {
    if (line.special) {
      return {
        special: true as const,
        name: line.catalogItemName,
        description: line.description.trim() || undefined,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceMinor: parseMoneyInput(line.unitPriceInput) ?? '0',
        reason: line.reason,
        discountBasisPoints: Number(line.discountBasisPoints || '0'),
        taxBasisPoints: Number(line.taxBasisPoints || '0'),
      };
    }
    const unitPriceMinorOverride = line.unitPriceDirty
      ? parseMoneyInput(line.unitPriceInput)
      : line.snapshotUnitPriceMinor ?? line.unitPriceMinorOverride.trim();
    return {
      catalogItemId: line.catalogItemId!,
      quantity: line.quantity,
      ...(unitPriceMinorOverride ? { unitPriceMinorOverride } : {}),
      discountBasisPoints: Number(line.discountBasisPoints || '0'),
      taxBasisPoints: Number(line.taxBasisPoints || '0'),
    };
  });

  // Q1-05: autosave del borrador en edición (creación inicial vía POST o edición de un BORRADOR vía PATCH).
  // La creación de una versión nueva a partir de una ya ENVIADA/EN_NEGOCIACION (canStartVersion) permanece
  // como acción manual explícita en `createVersionFromSent`, sin autosave: es una bifurcación deliberada, no una edición en curso.
  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (!workspace || !selectedPriceListId || draftLines.length === 0 || !preview.valid || !capabilities?.quotesCreate) return true;
    if (!currentVersion || currentVersion.status === 'BORRADOR') {
      const snapshotToPersist = draftSnapshotKey(selectedPriceListId, validUntil, draftLines);
      if (snapshotToPersist === savedSnapshotRef.current) return true;
      if (snapshotToPersist !== lastAttemptSnapshotRef.current) errorRetryCountRef.current = 0;
      lastAttemptSnapshotRef.current = snapshotToPersist;
      setAutosaveState('saving');
      setAutosaveMessage(null);
      try {
        const isDraftUpdate = currentVersion?.status === 'BORRADOR';
        const payload = {
          priceListId: selectedPriceListId,
          lines: buildLinesPayload(draftLines),
          ...(validUntil ? { validUntil: new Date(`${validUntil}T23:59:59.999Z`).toISOString() } : {}),
          ...(isDraftUpdate && expectedUpdatedAtRef.current ? { expectedUpdatedAt: expectedUpdatedAtRef.current } : {}),
        };
        const response = await fetch(isDraftUpdate ? `/api/staff/quotes/versions/${currentVersion!.id}` : `/api/staff/quotes/${workspace.request.id}`, { method: isDraftUpdate ? 'PATCH' : 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.status === 409) {
          const body = await response.json().catch(() => ({}));
          setAutosaveMessage(getApiErrorMessage(body, 'La versión cambió desde la última lectura. Recarga el borrador antes de guardar.'));
          setAutosaveState('conflict');
          return false;
        }
        const result = await readApiResponse(response, 'No fue posible guardar la cotización.');
        if (!result.ok) { errorRetryCountRef.current += 1; setAutosaveMessage(result.message); setAutosaveState('error'); return false; }
        errorRetryCountRef.current = 0;
        savedSnapshotRef.current = snapshotToPersist;
        const [freshVersion] = await Promise.all([syncQuoteVersionMetadata(workspace.request.id), loadBase(page, appliedSearch)]);
        // Re-congela el precio snapshot (fidelidad S0-02) sólo si nada cambió localmente durante el round-trip;
        // si el usuario ya siguió editando, dejamos sus ediciones intactas — el próximo ciclo las persistirá.
        if (freshVersion && draftSnapshotKey(selectedPriceListIdRef.current, validUntilRef.current, draftLinesRef.current) === snapshotToPersist) {
          const persistedByItem = new Map(freshVersion.lines.filter((line) => line.catalogItemId !== null).map((line) => [line.catalogItemId as string, line]));
          setDraftLines((lines) => lines.map((line) => {
            if (line.special || !line.catalogItemId) return line;
            const persisted = persistedByItem.get(line.catalogItemId);
            if (!persisted) return line;
            return {
              ...line,
              id: persisted.id,
              catalogItemCode: persisted.catalogItemCode ?? line.catalogItemCode,
              snapshotUnitPriceMinor: persisted.unitPriceMinor,
              unitPriceInput: moneyInputLabel(persisted.unitPriceMinor),
              unitPriceMinorOverride: persisted.unitPriceMinor,
              unitPriceDirty: false,
            };
          }));
        }
        setAutosaveState('saved');
        return true;
      } catch (caught) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) { setAutosaveState('offline'); return false; }
        errorRetryCountRef.current += 1;
        setAutosaveMessage(caught instanceof Error ? caught.message : 'No fue posible guardar la cotización.');
        setAutosaveState('error');
        return false;
      }
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, selectedPriceListId, draftLines, validUntil, preview.valid, capabilities, currentVersion, page, appliedSearch]);

  const reloadDiscardingLocalEdits = async () => { if (selectedId) await loadWorkspace(selectedId); };

  const overwriteWithLocalEdits = async () => {
    if (!workspace) return;
    setAutosaveState('saving');
    try {
      const response = await fetch(`/api/staff/quotes/${workspace.request.id}`, { credentials: 'include', cache: 'no-store' });
      const fresh = await readApiResponseOrThrow<Workspace>(response, 'No fue posible releer la versión.');
      expectedUpdatedAtRef.current = fresh.quote?.currentVersion?.updatedAt ?? null;
      await persistDraft();
    } catch (caught) {
      setAutosaveMessage(caught instanceof Error ? caught.message : 'No fue posible releer la versión.');
      setAutosaveState('error');
    }
  };

  useEffect(() => {
    if (!canEdit || !workspace || !selectedPriceListId || draftLines.length === 0) return;
    if (autosaveState === 'saving' || autosaveState === 'offline') return;
    const liveSnapshot = draftSnapshotKey(selectedPriceListId, validUntil, draftLines);
    if (liveSnapshot === savedSnapshotRef.current) { if (autosaveState !== 'saved') setAutosaveState('saved'); return; }
    if (autosaveState === 'error' && liveSnapshot === lastAttemptSnapshotRef.current && errorRetryCountRef.current >= 3) return;
    setAutosaveState((current) => current === 'saved' || current === 'error' ? 'dirty' : current);
    const timer = setTimeout(() => { void persistDraft(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [canEdit, workspace, selectedPriceListId, validUntil, draftLines, autosaveState, persistDraft]);

  const retryDraftSaveNow = () => { errorRetryCountRef.current = 0; void persistDraft(); };

  const transition = async (toStatus: string) => {
    if (!currentVersion) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: toStatus === 'ENVIADA' ? 'publish' : 'submit_for_review' }) });
      await readApiResponseOrThrow(response, 'No fue posible cambiar el estado.');
      showToast(`Cotización movida a ${statusLabel(toStatus).toLowerCase()}.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.'); }
    finally { setSaving(false); }
  };

  // P1-04 (parte 1, visual): antes de publicar, un humano ve destinatario/total/documento reales
  // y confirma explícitamente — nunca un solo clic sin resumen. El digest/expiración de preflight y
  // el comando idempotente de D1/P1-05 completos quedan para cuando el modelo objetivo exista.
  const openPublishPreflight = async () => {
    if (!currentVersion) return;
    setPublishPreflight({ documentStatus: 'MISSING', loading: true });
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/document`, { credentials: 'include', cache: 'no-store' });
      const data = await readApiResponseOrThrow<{ document: { status: DocumentStatus } }>(response, 'No fue posible consultar el documento.');
      setPublishPreflight({ documentStatus: data.document.status, loading: false });
    } catch {
      setPublishPreflight({ documentStatus: 'MISSING', loading: false });
    }
  };

  const confirmPublish = async () => {
    setPublishPreflight(null);
    await transition('ENVIADA');
  };

  const requestDiscountApproval = async () => {
    if (!currentVersion || !hasDiscount || currentVersion.status !== 'EN_REVISION') return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/approvals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: Math.max(...currentVersion.lines.map((line) => line.discountBasisPoints), 0) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible solicitar la aprobación.');
      showToast('Aprobación solicitada. Una persona autorizada debe resolverla antes de enviar la cotización.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible solicitar la aprobación.'); }
    finally { setSaving(false); }
  };

  const decideDiscountApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/approvals/${approvalId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(decision === 'REJECTED' ? { reason: 'No se autoriza el descuento en esta versión.' } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible resolver la aprobación.');
      showToast(decision === 'APPROVED' ? 'Descuento aprobado. Ya puedes enviar la cotización.' : 'Aprobación rechazada; revisa la propuesta antes de continuar.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible resolver la aprobación.'); }
    finally { setSaving(false); }
  };

  const requestSpecialApproval = async () => {
    if (!currentVersion || !hasSpecialLines || currentVersion.status !== 'EN_REVISION') return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/approvals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'SPECIAL_CONCEPT', policyVersion: 'special-concept-v1' }),
      });
      await readApiResponseOrThrow(response, 'No fue posible solicitar la aprobación.');
      showToast('Aprobación solicitada. Una persona autorizada debe resolverla antes de enviar la cotización.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible solicitar la aprobación.'); }
    finally { setSaving(false); }
  };

  const decideSpecialApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/approvals/${approvalId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(decision === 'REJECTED' ? { reason: 'No se autorizan los conceptos especiales de esta versión.' } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible resolver la aprobación.');
      showToast(decision === 'APPROVED' ? 'Concepto especial aprobado. Ya puedes enviar la cotización.' : 'Aprobación rechazada; revisa la propuesta antes de continuar.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible resolver la aprobación.'); }
    finally { setSaving(false); }
  };

  // Nunca perder trabajo silenciosamente: si hay cambios sin persistir, se intenta guardar antes de cambiar de expediente.
  const selectRequest = async (id: string) => {
    if (id === selectedId) return;
    if (autosaveState === 'conflict') return;
    if (canEdit && ['dirty', 'error', 'offline'].includes(autosaveState)) {
      const persisted = await persistDraft();
      if (!persisted) return;
    }
    setSelectedId(id);
  };

  const navigateToDashboard = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (autosaveState === 'conflict') { event.preventDefault(); return; }
    if (canEdit && ['dirty', 'error', 'offline'].includes(autosaveState)) {
      event.preventDefault();
      const persisted = await persistDraft();
      if (persisted) router.push('/staff');
    }
  };

  if (restricted) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/staff/requests" variant="quiet">Volver a solicitudes</PrivateLinkButton></div>}>Inicia sesión con una cuenta de empleado con permiso comercial para usar el constructor.</PrivateBlockingState></PrivateSurfaceRoot>;

  return <PrivateSurfaceRoot className="staff-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><div className="staff-header__tools"><Link className="staff-header__home" href="/staff" onClick={(event) => void navigateToDashboard(event)}>Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Constructor de cotizaciones</div></div></header>
    <div className="staff-content">
      <div className="staff-intro"><div><p className="staff-kicker">Trabajo comercial</p><h1>Cotizaciones</h1><p className="staff-intro__copy">Convierte el alcance de cada expediente en una propuesta trazable, precisa y lista para revisión.</p></div><div className="staff-intro__metric"><strong>{total}</strong><span>expedientes listos</span></div></div>
      {error && <p className="staff-error" role="alert">{error}</p>}
      <section className="quotes-workspace" aria-label="Constructor de cotizaciones">
        <aside className="quotes-rail">
          <form className="staff-filters" onSubmit={submitSearch}><label><span>Buscar expediente</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Folio o cliente" maxLength={100} /></label><button className="staff-button staff-button--filter" type="submit">Aplicar búsqueda</button></form>
          <div className="staff-inbox__head"><span>{loading ? 'Actualizando…' : `${requests.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
          <div className="quotes-request-list" aria-live="polite">
            {loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}
            {!loading && requests.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span><h2>Sin expedientes listos.</h2><p>Las solicitudes en elaboración o negociación aparecerán aquí.</p></div>}
            {!loading && requests.map((item) => <button className={`quotes-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => void selectRequest(item.id)}><span className="quotes-request-row__signal" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.client.displayName}</b><small>{item.detail?.projectType ?? 'Sin tipo'} · {item.detail?.location ?? 'Sin ubicación'}</small></span><em>{item.quote?.currentVersion ? `V${item.quote.currentVersion.versionNumber}` : 'Nuevo'}</em></button>)}
          </div>
          <PrivatePagination page={page} totalPages={totalPages} disabled={loading} onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)} />
        </aside>
        <section className="quotes-main">
          {loadingWorkspace && <div className="staff-detail__loading"><span /><span /><span /></div>}
          {!loadingWorkspace && !workspace && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Selecciona un expediente.</h2><p>El alcance y las líneas de cotización aparecerán aquí.</p></div>}
          {!loadingWorkspace && workspace && <>
            <div className="quotes-main__top"><div><p className="staff-kicker">{workspace.request.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{workspace.request.folio}</h2><p className="staff-detail__date">{workspace.request.client.displayName} · Actualizado {formatDate(workspace.request.updatedAt)}</p></div><StatusPill status={workspace.request.status} /></div>
            <div className="quotes-brief"><div><p className="staff-section-label">Alcance</p><strong>{workspace.request.detail?.projectType ?? 'Sin tipo de proyecto'}</strong><span>{workspace.request.detail?.location ?? 'Sin ubicación'}{workspace.request.detail?.dimensions ? ` · ${workspace.request.detail.dimensions}` : ''}</span></div><div><p className="staff-section-label">Calificación</p><strong>{qualificationLabel(workspace.request.detail?.projectStage, QUOTE_REQUEST_PROJECT_STAGE_LABELS)}</strong><span>{qualificationLabel(workspace.request.detail?.timeline, QUOTE_REQUEST_TIMELINE_LABELS)} · {qualificationLabel(workspace.request.detail?.budgetRange, QUOTE_REQUEST_BUDGET_RANGE_LABELS)}</span></div><div><p className="staff-section-label">Contacto</p><strong>{workspace.request.contact.displayName}</strong><span>{workspace.request.contact.email}</span></div><div><p className="staff-section-label">Moneda</p><strong>{selectedCurrency}</strong><span>{workspace.request.detail?.budgetCents ? `Presupuesto ${moneyLabel(workspace.request.detail.budgetCents, workspace.request.detail.currencyCode)}` : 'Sin presupuesto declarado'}</span></div></div>
            <section className="quotes-builder"><div className="quotes-builder__head"><div><p className="staff-section-label">Composición</p><h3>{currentVersion ? `Versión ${currentVersion.versionNumber} · ${statusLabel(currentVersion.status)}` : 'Primera versión'}</h3>{canEdit && draftLines.length > 0 ? <AutosaveIndicator state={autosaveState} /> : null}</div><PrivateSelect id="quotes-price-list" className="quotes-list-select" label="Lista de precios" value={selectedPriceListId} onValueChange={setSelectedPriceListId} options={priceLists.map((list) => ({ value: list.id, label: `${list.name} · ${list.currencyCode}` }))} placeholder="Selecciona una lista" disabled={(!canEdit && !canStartVersion) || autosaveState === 'conflict'} />{canEdit && draftLines.some((line) => !line.special) && <button className="staff-button staff-button--outline quotes-reprice-trigger" type="button" disabled={checkingReprice} onClick={() => void checkReprice()}>{checkingReprice ? 'Comprobando…' : 'Verificar precios vigentes'}</button>}</div>
              {autosaveState === 'conflict' && <div className="quotes-conflict" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{autosaveMessage ?? 'La versión cambió desde la última lectura.'}</p><div className="quotes-conflict__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => void reloadDiscardingLocalEdits()}>Recargar con los cambios del servidor</button><button className="staff-button staff-button--danger" type="button" onClick={() => void overwriteWithLocalEdits()}>Mantener mis cambios y sobrescribir</button></div></div>}
              {autosaveState === 'error' && autosaveMessage && <p className="staff-error" role="alert">{autosaveMessage} <button className="quotes-retry-link" type="button" onClick={retryDraftSaveNow}>Reintentar</button></p>}
              <PrivateDialog open={repriceDialogOpen} onClose={() => setRepriceDialogOpen(false)} className="quotes-reprice-dialog" overlayClassName="quotes-reprice-overlay" labelledBy="quotes-reprice-title" describedBy="quotes-reprice-description">
                <div className="quotes-reprice-dialog__head"><h3 id="quotes-reprice-title">Repreciar con la lista vigente</h3><button className="quotes-reprice-dialog__close" type="button" onClick={() => setRepriceDialogOpen(false)} aria-label="Cerrar repreciado"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-reprice-description" className="quotes-reprice-dialog__copy">Estos conceptos conservan el precio con el que se guardaron. Repreciar los actualiza al precio vigente de <strong>{priceListDetail?.name ?? 'la lista seleccionada'}</strong>; el resto de la propuesta no cambia.</p>
                <ul className="quotes-reprice-lines">{repriceCandidates.map((candidate) => <li key={candidate.id}><span>{candidate.name}</span><span className="quotes-reprice-lines__before">{moneyLabel(candidate.oldPriceMinor, selectedCurrency)}</span><span aria-hidden="true">→</span><span className="quotes-reprice-lines__after">{moneyLabel(candidate.newPriceMinor, selectedCurrency)}</span></li>)}</ul>
                <div className="quotes-reprice-dialog__total"><span>Total de propuesta</span><span className="quotes-reprice-lines__before">{moneyLabel(preview.total, selectedCurrency)}</span><span aria-hidden="true">→</span><span className="quotes-reprice-lines__after">{repriceAfterTotal?.valid ? moneyLabel(repriceAfterTotal.total, selectedCurrency) : 'Revisa las líneas'}</span></div>
                <div className="quotes-reprice-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setRepriceDialogOpen(false)}>Cancelar</button><button className="staff-button staff-button--copper" type="button" onClick={confirmReprice}>Confirmar repreciado</button></div>
              </PrivateDialog>
              {currentVersion && <PrivateDialog open={publishPreflight !== null} onClose={() => setPublishPreflight(null)} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="quotes-preflight-title" describedBy="quotes-preflight-description">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-preflight-title">Confirmar envío al cliente</h3><button className="quotes-reprice-dialog__close" type="button" onClick={() => setPublishPreflight(null)} aria-label="Cerrar confirmación"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-preflight-description" className="quotes-preflight-dialog__copy">Esta versión quedará publicada y {workspace?.request.contact.displayName} recibirá un aviso para revisarla. Verifica que todo sea correcto antes de continuar.</p>
                <dl className="quotes-preflight-dialog__facts">
                  <div><dt>Destinatario</dt><dd>{workspace?.request.contact.displayName}<small>{workspace?.request.contact.email}</small></dd></div>
                  <div><dt>Versión</dt><dd>V{currentVersion.versionNumber}</dd></div>
                  <div><dt>Total</dt><dd>{moneyLabel(currentVersion.totalMinor, currentVersion.currencyCode)}</dd></div>
                  <div><dt>Vigencia</dt><dd>{currentVersion.validUntil ? formatDate(currentVersion.validUntil) : 'Sin fecha límite definida'}</dd></div>
                  <div><dt>Documento</dt><dd>{publishPreflight?.loading ? 'Consultando…' : publishPreflight?.documentStatus === 'READY' ? 'Listo, ya generado' : 'Se generará y verificará al confirmar'}</dd></div>
                </dl>
                <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setPublishPreflight(null)}>Cancelar</button><button className="staff-button staff-button--copper" type="button" disabled={saving || publishPreflight?.loading} onClick={() => void confirmPublish()}>{saving ? 'Enviando…' : 'Confirmar y enviar'}</button></div>
              </PrivateDialog>}
              <div className="quotes-lines-head"><span>Concepto</span><span>Cantidad</span><span>Precio</span><span>Descuento</span><span>Impuesto</span><span>Total</span><span className="sr-only">Acción</span></div>
              <div className="quotes-lines">
                {draftLines.map((line) => { const price = line.catalogItemId ? pricesByItem.get(line.catalogItemId)?.unitPriceMinor : undefined; const linePreview = calculatePreview(line, price); const displayedPrice = line.unitPriceDirty ? line.unitPriceInput : line.snapshotUnitPriceMinor ? moneyInputLabel(line.snapshotUnitPriceMinor) : price ? moneyInputLabel(price) : ''; return <div className={`quotes-line${line.special ? ' quotes-line--special' : ''}`} key={line.id}><div className="quotes-line__item">{line.special ? <div className="quotes-line__special"><input aria-label="Nombre del concepto especial" value={line.catalogItemName} onChange={(event) => updateLine(line.id, 'catalogItemName', event.target.value)} disabled={!canEdit} placeholder="Nombre" maxLength={180} /><input aria-label="Unidad del concepto especial" value={line.unit} onChange={(event) => updateLine(line.id, 'unit', event.target.value)} disabled={!canEdit} placeholder="Unidad" maxLength={40} /><small><strong>Especial</strong>{line.reason ? ` · ${line.reason}` : ''}</small></div> : <><strong>{line.catalogItemName}</strong><small>{line.catalogItemCode} · {line.unit}</small></>}</div><label><span className="quotes-mobile-label">Cantidad</span><input aria-label={`Cantidad de ${line.catalogItemName}`} value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', event.target.value)} disabled={!canEdit} inputMode="decimal" /></label><label><span className="quotes-mobile-label">Precio</span><input aria-label={`Precio de ${line.catalogItemName}`} value={displayedPrice} onChange={(event) => setDraftLines((lines) => lines.map((candidate) => candidate.id === line.id ? { ...candidate, unitPriceInput: event.target.value, unitPriceMinorOverride: parseMoneyInput(event.target.value) ?? '', unitPriceDirty: true } : candidate))} disabled={!canEdit || !capabilities?.quotesEditPrices} placeholder={price ? moneyInputLabel(price) : 'Sin precio'} inputMode="decimal" /></label><label><span className="quotes-mobile-label">Desc. %</span><input aria-label={`Descuento de ${line.catalogItemName}`} value={line.discountBasisPoints === '0' ? '' : (Number(line.discountBasisPoints) / 100).toString()} onChange={(event) => updateLine(line.id, 'discountBasisPoints', event.target.value === '' ? '0' : String(Math.round(Number(event.target.value) * 100)))} disabled={!canEdit || !capabilities?.quotesApplyDiscount} inputMode="decimal" placeholder="0" /></label><label><span className="quotes-mobile-label">IVA pb</span><input aria-label={`Impuesto de ${line.catalogItemName}`} value={line.taxBasisPoints === '0' ? '' : (Number(line.taxBasisPoints) / 100).toString()} onChange={(event) => updateLine(line.id, 'taxBasisPoints', event.target.value === '' ? '0' : String(Math.round(Number(event.target.value) * 100)))} disabled={!canEdit} inputMode="decimal" placeholder="0" /></label><strong className="quotes-line__total">{linePreview ? moneyLabel(linePreview.total, selectedCurrency) : '—'}</strong><button className="quotes-line__remove" type="button" aria-label={`Quitar ${line.catalogItemName}`} onClick={() => setDraftLines((lines) => lines.filter((candidate) => candidate.id !== line.id))} disabled={!canEdit}><X size={16} aria-hidden="true" /></button></div>; })}
                {draftLines.length === 0 && <div className="quotes-lines__empty"><strong>Aún no hay conceptos.</strong><span>Agrega los servicios que componen esta propuesta.</span></div>}
              </div>
              {(canEdit || canStartVersion) && <div className="quotes-add-line"><CatalogItemSearchCombobox priceListId={selectedPriceListId} currencyCode={selectedCurrency} excludeIds={draftLines.map((line) => line.catalogItemId).filter((id): id is string => id !== null)} disabled={!selectedPriceListId} onSelect={addLineFromSearch} /><button className="staff-button staff-button--outline" type="button" onClick={() => setShowSpecialForm((current) => !current)}>{showSpecialForm ? 'Cerrar' : 'Agregar concepto especial'}</button></div>}
              {(canEdit || canStartVersion) && showSpecialForm && <form className="catalog-form" onSubmit={addSpecialLine}><label><span>Nombre</span><input required value={specialForm.name} onChange={(event) => setSpecialForm({ ...specialForm, name: event.target.value })} placeholder="Concepto fuera de catálogo" maxLength={180} /></label><label><span>Unidad</span><input required value={specialForm.unit} onChange={(event) => setSpecialForm({ ...specialForm, unit: event.target.value })} placeholder="pieza" maxLength={40} /></label><PrivateMoneyField id="quotes-special-amount" label="Importe del concepto especial" value={specialForm.amountInput} onValueChange={(value) => setSpecialForm({ ...specialForm, amountInput: value })} placeholder="1,250.00" /><label><span>Motivo</span><input required value={specialForm.reason} onChange={(event) => setSpecialForm({ ...specialForm, reason: event.target.value })} placeholder="Por qué no está en catálogo" maxLength={300} /></label><label><span>Descripción</span><textarea rows={2} value={specialForm.description} onChange={(event) => setSpecialForm({ ...specialForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit">Agregar a la propuesta</button></form>}
              <div className="quotes-summary"><div><span>Subtotal</span><strong>{moneyLabel(preview.subtotal, selectedCurrency)}</strong></div><div><span>Descuentos</span><strong>− {moneyLabel(preview.discount, selectedCurrency)}</strong></div><div><span>Impuestos</span><strong>{moneyLabel(preview.tax, selectedCurrency)}</strong></div><div className="quotes-summary__total"><span>Total de propuesta</span><strong>{preview.valid ? moneyLabel(preview.total, selectedCurrency) : 'Revisa las líneas'}</strong></div></div>
              <div className="quotes-actions"><PrivateDatePicker id="quotes-valid-until" label="Vigencia hasta" value={validUntil} onValueChange={setValidUntil} disabled={!canEdit && !canStartVersion} />{canEdit ? <button className="staff-button staff-button--dark" type="button" disabled={autosaveState === 'saving' || autosaveState === 'saved' || !preview.valid || draftLines.length === 0 || !selectedPriceListId} onClick={() => void persistDraft()}>{autosaveState === 'saving' ? 'Guardando…' : 'Guardar ahora'}</button> : null}{canStartVersion ? <button className="staff-button staff-button--dark" type="button" disabled={saving || !preview.valid || draftLines.length === 0 || !selectedPriceListId} onClick={() => void createVersionFromSent()}>{saving ? 'Creando…' : 'Crear nueva versión'}</button> : null}{currentVersion?.status === 'BORRADOR' && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || autosaveState === 'saving' || autosaveState === 'dirty' || autosaveState === 'conflict' || draftLines.length === 0} onClick={() => void transition('EN_REVISION')}>Pasar a revisión</button> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount && !hasApprovedDiscount && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || Boolean(activeDiscountApproval)} onClick={() => void requestDiscountApproval()}>{activeDiscountApproval?.status === 'REQUESTED' ? 'Aprobación solicitada' : 'Solicitar aprobación'}</button> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount && activeDiscountApproval?.status === 'REQUESTED' && capabilities?.quotesApproveDiscount ? <><button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void decideDiscountApproval(activeDiscountApproval.id, 'APPROVED')}>Aprobar descuento</button><button className="staff-button staff-button--danger" type="button" disabled={saving} onClick={() => void decideDiscountApproval(activeDiscountApproval.id, 'REJECTED')}>Rechazar</button></> : null}{currentVersion?.status === 'EN_REVISION' && hasSpecialLines && !hasApprovedSpecial && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || Boolean(activeSpecialApproval)} onClick={() => void requestSpecialApproval()}>{activeSpecialApproval?.status === 'REQUESTED' ? 'Aprobación solicitada' : 'Solicitar aprobación de concepto especial'}</button> : null}{currentVersion?.status === 'EN_REVISION' && hasSpecialLines && activeSpecialApproval?.status === 'REQUESTED' && capabilities?.quotesApproveDiscount ? <><button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void decideSpecialApproval(activeSpecialApproval.id, 'APPROVED')}>Aprobar concepto especial</button><button className="staff-button staff-button--danger" type="button" disabled={saving} onClick={() => void decideSpecialApproval(activeSpecialApproval.id, 'REJECTED')}>Rechazar</button></> : null}{currentVersion?.status === 'EN_REVISION' && canPublish && (!hasDiscount || hasApprovedDiscount) && (!hasSpecialLines || hasApprovedSpecial) ? <button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void openPublishPreflight()}>Enviar cotización</button> : null}{currentVersion?.status === 'EN_REVISION' && capabilities?.quotesSend && !capabilities.quotesPdfGenerate ? <p className="quotes-action-note">Tu perfil puede enviar, pero necesita permiso para preparar el PDF comercial.</p> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount ? <p className="quotes-action-note">{discountApproval ? `${approvalStatusLabel(discountApproval.status)}. ` : ''}{hasApprovedDiscount ? 'La versión tiene una aprobación vigente.' : 'Esta versión no puede enviarse hasta contar con una aprobación vigente.'}</p> : null}{currentVersion?.status === 'EN_REVISION' && hasSpecialLines ? <p className="quotes-action-note">{specialApproval ? `${approvalStatusLabel(specialApproval.status)}. ` : ''}{hasApprovedSpecial ? 'Los conceptos especiales tienen una aprobación vigente.' : 'Esta versión tiene conceptos especiales y no puede enviarse hasta contar con una aprobación vigente.'}</p> : null}</div>
              {hasDiscount && currentVersion?.approvals.length ? <div className="quotes-approval-summary" aria-label="Historial de aprobación de descuento"><strong>Control de descuento</strong>{currentVersion.approvals.filter((approval) => approval.type === 'DISCOUNT').slice(0, 3).map((approval) => <span key={approval.id}>{approvalStatusLabel(approval.status)} · {formatDate(approval.requestedAt)}</span>)}</div> : null}
              {hasSpecialLines && currentVersion?.approvals.length ? <div className="quotes-approval-summary" aria-label="Historial de aprobación de conceptos especiales"><strong>Control de concepto especial</strong>{currentVersion.approvals.filter((approval) => approval.type === 'SPECIAL_CONCEPT').slice(0, 3).map((approval) => <span key={approval.id}>{approvalStatusLabel(approval.status)} · {formatDate(approval.requestedAt)}</span>)}</div> : null}
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
