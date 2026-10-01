'use client';

import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronUp, CircleCheck, Compass, Hourglass, Inbox, X } from 'lucide-react';
import StaffQuoteDocumentPanel from '@/components/StaffQuoteDocumentPanel';
import ExpedienteJourney from '@/components/staff/ExpedienteJourney';
import CatalogItemSearchCombobox, { type CatalogSearchResultItem } from '@/components/CatalogItemSearchCombobox';
import QuotePricingDialog, { type PricingSubmission } from '@/components/QuotePricingDialog';
import { currentPriceRows } from '@/lib/price-list-current';
import { assignListPrice } from '@/lib/price-list-assign';
import { moneyInputLabel, parseMoneyInput } from '@/lib/money-input';
import { zonedCalendarDateEndOfDayToUtc } from '@/lib/calendar-timezone';
import { builderValidUntil } from '@/lib/quote-validity';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffHeader from '@/components/StaffHeader';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateDatePicker, PrivateDialog, PrivateLinkButton, PrivateMoneyField, PrivatePagination, PrivateSelect, usePrivateToast } from '@/components/private/ui';
import {
  QUOTE_REQUEST_BUDGET_RANGE_LABELS,
  QUOTE_REQUEST_PROJECT_STAGE_LABELS,
  QUOTE_REQUEST_TIMELINE_LABELS,
} from '@/server/modules/quote-requests/domain';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { formatDateTime } from '@/lib/format-date';
import { revealWhenStacked } from '@/lib/reveal-when-stacked';
import { quoteNextStep, quoteStageSteps, type QuoteNextStepTarget, type QuoteStageStepState } from '@/lib/quote-stage';
import { moneyLabel } from '@/lib/money';
import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_VERSION_STATUS_LABELS, statusToneIcon } from '@/lib/labels';
import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';

type AutosaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'offline';

const AUTOSAVE_DEBOUNCE_MS = 800;

type Capabilities = {
  quotesRead: boolean;
  quotesCreate: boolean;
  quotesEditPrices: boolean;
  pricesManage: boolean;
  quotesApplyDiscount: boolean;
  quotesApproveDiscount: boolean;
  quotesSend: boolean;
  quotesPdfRead: boolean;
  quotesPdfGenerate: boolean;
  projectsRead: boolean;
  projectsCreate: boolean;
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
  sectionId: string | null;
  catalogItemId: string | null;
  catalogItemCode: string | null;
  name: string;
  description: string | null;
  unit: string;
  specialReason: string | null;
  manualPriceReason: string | null;
  pricePending?: boolean;
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
  taxProfileId: string | null;
  sourcePriceListId?: string | null;
  requiresDiscountApproval: boolean;
  scopeText: string | null;
  exclusionsText: string | null;
  paymentTermsText: string | null;
  warrantyText: string | null;
  publicNotesText: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; displayName: string };
  sections: Array<{ id: string; position: number; title: string; description: string | null }>;
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
  quote: { id: string; currentVersionId: string | null; currentVersion: QuoteVersion | null; publishedVersion?: QuoteVersion | null; versions: QuoteVersion[]; history: Array<{ id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; changedBy: { id: string; displayName: string } | null }> } | null;
  priceLists: Array<{ id: string; code: string; name: string; currencyCode: string }>;
  taxProfiles: Array<{ id: string; code: string; name: string; ratePercentBasisPoints: number }>;
  /** Petición de cambios del cliente sobre la versión publicada (portal → "Solicitar cambios"). */
  changeRequest?: { at: string; message: string } | null;
  declineRequest?: { at: string; reason: string; message: string; versionNumber: number } | null;
  /** Después de la aceptación: el proyecto de arranque y la aceptación (para convertirla a mano). */
  project?: { id: string; folio: string; status: string } | null;
  acceptance?: { id: string; acceptedAt: string } | null;
};

type PriceList = { id: string; code: string; name: string; currencyCode: string; status: string };
type PriceListDetail = PriceList & { validFrom: string; validUntil: string | null; items: Array<{ id: string; catalogItemId: string; unitPriceMinor: string; validFrom: string; validUntil: string | null; catalogItem: { code: string; name: string; unit: string; status: string } }> };
type DraftSection = { id: string; title: string; description: string };

type DraftLine = {
  id: string;
  special: boolean;
  sectionId: string | null;
  catalogItemId: string | null;
  catalogItemName: string;
  catalogItemCode: string;
  description: string;
  reason: string;
  /// Motivo del precio manual: concepto de catálogo cotizado fuera de la lista (sólo en esta cotización).
  manualReason: string;
  /// Concepto agregado "por cotizar": sin precio, no suma al total y frena el paso a revisión.
  pricePending: boolean;
  unit: string;
  quantity: string;
  unitPriceMinorOverride: string;
  unitPriceInput: string;
  snapshotUnitPriceMinor: string | null;
  unitPriceDirty: boolean;
  discountBasisPoints: string;
  taxBasisPoints: string;
};

type PricingTargetItem = { id: string; code: string; name: string; unit: string };
type PricingMode = { kind: 'manual'; minor: string; reason: string } | { kind: 'list' } | { kind: 'pending' };

/// Una línea que ya no es manual ni está por cotizar: su precio sale de la lista de precios.
const listPricedFields = { pricePending: false, manualReason: '', unitPriceMinorOverride: '', unitPriceInput: '', snapshotUnitPriceMinor: null, unitPriceDirty: false } as const;

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

type ContentFields = { scopeText: string; exclusionsText: string; paymentTermsText: string; warrantyText: string; publicNotesText: string };

function draftSnapshotKey(priceListId: string, validUntilValue: string, lines: DraftLine[], content: ContentFields, sections: DraftSection[]): string {
  return JSON.stringify({
    priceListId,
    validUntilValue,
    content,
    sections: sections.map((section) => ({ title: section.title, description: section.description })),
    lines: lines.map((line) => ({ special: line.special, sectionId: line.sectionId, catalogItemId: line.catalogItemId, catalogItemName: line.catalogItemName, unit: line.unit, description: line.description, reason: line.reason, manualReason: line.manualReason, pricePending: line.pricePending, quantity: line.quantity, unitPriceInput: line.unitPriceInput, unitPriceDirty: line.unitPriceDirty, discountBasisPoints: line.discountBasisPoints, taxBasisPoints: line.taxBasisPoints })),
  });
}

function editorSnapshotKey(priceListId: string, taxProfileId: string, validUntilValue: string, lines: DraftLine[], content: ContentFields, sections: DraftSection[]): string {
  return JSON.stringify({ draft: draftSnapshotKey(priceListId, validUntilValue, lines, content, sections), taxProfileId });
}

function calculatePreview(line: DraftLine, priceMinor: string | undefined) {
  const quantity = parseQuantity(line.quantity);
  // "Por cotizar": todavía sin precio, no suma al total (el servidor lo guarda en cero).
  if (line.pricePending) return quantity ? { subtotal: 0n, discount: 0n, taxable: 0n, tax: 0n, total: 0n, unitPrice: '0' } : null;
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

const NEXT_STEP_CTA: Record<QuoteNextStepTarget, string> = {
  'price-list': 'Elegir lista',
  lines: 'Agregar conceptos',
  actions: 'Ir a las acciones',
  document: 'Ir al documento',
  request: 'Ir al expediente',
};

const STAGE_STATE_LABELS: Record<QuoteStageStepState, string> = {
  done: ' (completada)',
  current: ' (etapa actual)',
  closed: ' (cerrada)',
  upcoming: ' (pendiente)',
};

export default function StaffQuotesPanel() {
  const router = useRouter();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [requests, setRequests] = useState<QuoteListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListDetail, setPriceListDetail] = useState<PriceListDetail | null>(null);
  const [selectedPriceListId, setSelectedPriceListId] = useState('');
  const [selectedTaxProfileId, setSelectedTaxProfileId] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  // Q1-03: secciones con nombre propio para agrupar líneas -- opcional, una línea sin
  // sección sigue siendo válida (no se fuerza a nadie a organizar una propuesta simple).
  const [draftSections, setDraftSections] = useState<DraftSection[]>([]);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [sectionForm, setSectionForm] = useState({ title: '', description: '' });
  // Q1-07: sólo tiene efecto visual en tablet/móvil (CSS ignora el atributo en escritorio,
  // donde el resumen es siempre visible y sticky) -- por eso arranca en `false` sin importar
  // el ancho real de viewport, sin necesitar detectar breakpoints en JS ni arriesgar un
  // desajuste de hidratación entre servidor y cliente.
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  // Q1-03/D1-02: contenido comercial estructurado (alcance/exclusiones/pago/garantías/notas),
  // publicado tal cual al cliente/PDF una vez enviada la versión.
  const [contentFields, setContentFields] = useState({ scopeText: '', exclusionsText: '', paymentTermsText: '', warrantyText: '', publicNotesText: '' });
  const [showSpecialForm, setShowSpecialForm] = useState(false);
  const [specialForm, setSpecialForm] = useState({ name: '', unit: '', description: '', amountInput: '', reason: '' });
  // Concepto sin precio en la lista elegido en el buscador (o una línea "por cotizar" que ya está en la
  // propuesta): se le define precio aquí mismo -- sólo para esta cotización, también en la lista o se deja
  // por cotizar. `lineId` distingue "agregar una línea nueva" de "aplicar el precio a una existente".
  // Se identifica por el concepto (no por el id de la fila: el servidor los regenera en cada guardado y un
  // autoguardado puede terminar mientras el diálogo sigue abierto).
  const [pricingTarget, setPricingTarget] = useState<{ item: PricingTargetItem; existing: boolean } | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  // "En curso" (por cotizar, enviadas, en negociación) o "Cerradas" (aceptadas, en proyecto, cerradas):
  // lo vendido ya no desaparece de esta pestaña.
  const [listScope, setListScope] = useState<'open' | 'closed'>('open');
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
  const [remoteChange, setRemoteChange] = useState(false);
  const remoteInteractionRef = useRef(true);
  const [repriceDialogOpen, setRepriceDialogOpen] = useState(false);
  const [publishPreflight, setPublishPreflight] = useState<{ documentStatus: DocumentStatus; contentDigest: string | null; loading: boolean } | null>(null);
  const deepLinkedIdRef = useRef<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const revealPendingRef = useRef(false);
  const loadBaseGenerationRef = useRef(0);
  const loadWorkspaceGenerationRef = useRef(0);
  const persistDraftGenerationRef = useRef(0);
  const savedSnapshotRef = useRef('');
  const savedEditorSnapshotRef = useRef('');
  const expectedUpdatedAtRef = useRef<string | null>(null);
  const lastAttemptSnapshotRef = useRef('');
  const errorRetryCountRef = useRef(0);
  const selectedPriceListIdRef = useRef('');
  useEffect(() => { selectedPriceListIdRef.current = selectedPriceListId; }, [selectedPriceListId]);
  const selectedTaxProfileIdRef = useRef('');
  useEffect(() => { selectedTaxProfileIdRef.current = selectedTaxProfileId; }, [selectedTaxProfileId]);
  const validUntilRef = useRef('');
  useEffect(() => { validUntilRef.current = validUntil; }, [validUntil]);
  const contentFieldsRef = useRef(contentFields);
  useEffect(() => { contentFieldsRef.current = contentFields; }, [contentFields]);
  const draftLinesRef = useRef<DraftLine[]>([]);
  useEffect(() => { draftLinesRef.current = draftLines; }, [draftLines]);
  const draftSectionsRef = useRef<DraftSection[]>([]);
  useEffect(() => { draftSectionsRef.current = draftSections; }, [draftSections]);
  const editorSnapshot = () => editorSnapshotKey(selectedPriceListIdRef.current, selectedTaxProfileIdRef.current, validUntilRef.current, draftLinesRef.current, contentFieldsRef.current, draftSectionsRef.current);
  const { showToast } = usePrivateToast();

  const loadBase = useCallback(async (currentPage: number, query: string) => {
    // UX audit fix: mismo patrón que `loadWorkspace` -- paginar o volver a buscar rápido podía dejar
    // que la respuesta obsoleta de una combinación anterior de página/búsqueda sobreescribiera en
    // silencio la lista/paginación/selección con datos que ya no corresponden a lo mostrado.
    const generation = (loadBaseGenerationRef.current += 1);
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' });
      if (query) params.set('query', query);
      if (listScope === 'closed') params.set('scope', 'closed');
      const [capabilitiesResponse, requestsResponse, listsResponse] = await Promise.all([
        fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/staff/quotes?${params.toString()}`, { credentials: 'include', cache: 'no-store' }),
        fetch('/api/staff/catalog/price-lists?status=ACTIVE', { credentials: 'include', cache: 'no-store' }),
      ]);
      const capabilitiesResult = await readApiResponse<Capabilities>(capabilitiesResponse, 'No fue posible cargar el constructor.');
      if (loadBaseGenerationRef.current !== generation) return;
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
      if (loadBaseGenerationRef.current !== generation) return;
      setCapabilities(currentCapabilities);
      setRequests(requestData.items);
      setTotal(requestData.total);
      setTotalPages(Math.max(1, requestData.totalPages));
      setPriceLists(listData);
      setRestricted(false);
      // Un expediente abierto por deep link (ej. desde notificaciones o la cola de aprobaciones)
      // se conserva la primera vez aunque no esté en esta página/lista -- por ejemplo, uno ya
      // aceptado sale de las 3 categorías "en construcción" de esta lista, pero loadWorkspace lo
      // trae por su cuenta igual. Mismo patrón que StaffRequestsPanel.tsx (W1-02); la referencia se
      // consume fuera del updater, que debe ser puro (React puede invocarlo dos veces).
      const deepLinkedId = deepLinkedIdRef.current;
      deepLinkedIdRef.current = null;
      setSelectedId((current) => {
        if (deepLinkedId && current === deepLinkedId) return current;
        // El expediente abierto se conserva aunque la búsqueda o la página ya no lo incluyan: buscar
        // en el riel es para encontrar el siguiente, no debe cerrar (ni arriesgar) el borrador en curso.
        return current ?? requestData.items[0]?.id ?? null;
      });
    } catch (caught) {
      if (loadBaseGenerationRef.current !== generation) return;
      setRestricted(false);
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el constructor.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [listScope]);

  const loadWorkspace = useCallback(async (requestId: string, options: { silent?: boolean } = {}) => {
    // UX audit fix: sin esta guarda, cambiar rápido de una cotización a otra podía dejar que la
    // respuesta obsoleta de la primera llegara después que la de la segunda y sobreescribiera en
    // silencio todo el borrador en edición (líneas, lista de precios, vigencia) con datos de la
    // solicitud equivocada, mientras la UI seguía mostrando la segunda como seleccionada.
    if (options.silent && remoteInteractionRef.current) {
      setRemoteChange(true);
      return;
    }
    const generation = (loadWorkspaceGenerationRef.current += 1);
    const snapshotAtStart = options.silent ? editorSnapshot() : null;
    if (!options.silent) {
      setLoadingWorkspace(true);
      setError(null);
    }
    try {
      const response = await fetch(`/api/staff/quotes/${requestId}`, { credentials: 'include', cache: 'no-store' });
      const data = await readApiResponseOrThrow<Workspace>(response, 'No fue posible cargar el expediente de cotización.');
      if (loadWorkspaceGenerationRef.current !== generation) return;
      if (options.silent && (remoteInteractionRef.current || snapshotAtStart !== editorSnapshot())) {
        setRemoteChange(true);
        return;
      }
      setWorkspace(data);
      const currentVersion = data.quote?.currentVersion;
      const preferredList = data.priceLists.find((list) => list.currencyCode === (currentVersion?.currencyCode ?? data.request.detail?.currencyCode)) ?? data.priceLists[0];
      // La lista con la que se armó esta versión manda (así se conserva al reabrir); si no la trae (versiones
      // anteriores) o ya no aplica, se conserva la elegida y, en último caso, la primera de la misma moneda.
      const versionListId = currentVersion?.sourcePriceListId ?? null;
      const freshPriceListId = versionListId && data.priceLists.some((list) => list.id === versionListId)
        ? versionListId
        : data.priceLists.some((list) => list.id === selectedPriceListIdRef.current) ? selectedPriceListIdRef.current : preferredList?.id ?? '';
      const preferredTaxProfile = data.taxProfiles.find((profile) => profile.code === 'IVA_GENERAL') ?? data.taxProfiles[0];
      const freshTaxProfileId = currentVersion?.taxProfileId ?? (data.taxProfiles.some((profile) => profile.id === selectedTaxProfileIdRef.current) ? selectedTaxProfileIdRef.current : preferredTaxProfile?.id ?? '');
      const freshValidUntil = builderValidUntil(currentVersion);
      const freshDraftSections: DraftSection[] = (currentVersion?.sections ?? []).map((section) => ({ id: section.id, title: section.title, description: section.description ?? '' }));
      const freshDraftLines: DraftLine[] = (currentVersion?.lines ?? []).map((line) => ({
        id: line.id,
        special: line.catalogItemId === null,
        sectionId: line.sectionId,
        catalogItemId: line.catalogItemId,
        catalogItemName: line.name,
        catalogItemCode: line.catalogItemCode ?? '',
        description: line.description ?? '',
        reason: line.specialReason ?? '',
        manualReason: line.manualPriceReason ?? '',
        pricePending: Boolean(line.pricePending),
        unit: line.unit,
        quantity: quantityLabel(line.quantityMilliunits),
        unitPriceMinorOverride: line.unitPriceMinor,
        unitPriceInput: moneyInputLabel(line.unitPriceMinor),
        snapshotUnitPriceMinor: line.unitPriceMinor,
        unitPriceDirty: false,
        discountBasisPoints: String(line.discountBasisPoints),
        taxBasisPoints: String(line.taxBasisPoints),
      }));
      const freshContentFields: ContentFields = {
        scopeText: currentVersion?.scopeText ?? '',
        exclusionsText: currentVersion?.exclusionsText ?? '',
        paymentTermsText: currentVersion?.paymentTermsText ?? '',
        warrantyText: currentVersion?.warrantyText ?? '',
        publicNotesText: currentVersion?.publicNotesText ?? '',
      };
      setSelectedPriceListId(freshPriceListId);
      setSelectedTaxProfileId(freshTaxProfileId);
      setValidUntil(freshValidUntil);
      setContentFields(freshContentFields);
      setDraftLines(freshDraftLines);
      setDraftSections(freshDraftSections);
      expectedUpdatedAtRef.current = currentVersion?.updatedAt ?? null;
      const freshEditorSnapshot = editorSnapshotKey(freshPriceListId, freshTaxProfileId, freshValidUntil, freshDraftLines, freshContentFields, freshDraftSections);
      savedSnapshotRef.current = freshEditorSnapshot;
      savedEditorSnapshotRef.current = freshEditorSnapshot;
      setAutosaveState('saved');
      setAutosaveMessage(null);
      setRemoteChange(false);
    } catch (caught) {
      if (loadWorkspaceGenerationRef.current !== generation) return;
      if (options.silent) {
        setRemoteChange(true);
        return;
      }
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el expediente de cotización.');
      setWorkspace(null);
    } finally {
      if (loadWorkspaceGenerationRef.current === generation) setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => { void loadBase(page, appliedSearch); }, [appliedSearch, loadBase, page]);
  // Salto al constructor en pantallas apiladas, una vez cargado (ver StaffRequestsPanel).
  useEffect(() => {
    if (!workspace || loadingWorkspace || !revealPendingRef.current) return;
    revealPendingRef.current = false;
    revealWhenStacked(mainRef.current, '(max-width: 1100px)');
  }, [loadingWorkspace, workspace]);
  useEffect(() => {
    setRemoteChange(false);
    if (selectedId) void loadWorkspace(selectedId);
    else setWorkspace(null);
  }, [loadWorkspace, selectedId]);
  useEffect(() => {
    const requestFromUrl = new URLSearchParams(window.location.search).get('request');
    if (requestFromUrl) { deepLinkedIdRef.current = requestFromUrl; setSelectedId(requestFromUrl); }
  }, []);

  // El expediente abierto vive en la URL: recargar o compartir el enlace regresa al mismo constructor.
  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('request') === selectedId) return;
    url.searchParams.set('request', selectedId);
    window.history.replaceState(null, '', url);
  }, [selectedId]);

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

  // Sólo los precios vigentes hoy (la lista guarda también los vencidos y los programados): el servidor
  // resuelve el precio de cada concepto con esa misma regla.
  const pricesByItem = useMemo(() => currentPriceRows(priceListDetail?.items ?? []), [priceListDetail]);
  // El detalle de la lista se pide al elegirla: mientras llega el de la nueva, el que hay todavía es el de la anterior.
  const listDetailReady = Boolean(priceListDetail && priceListDetail.id === selectedPriceListId);
  const preview = useMemo(() => draftLines.reduce((summary, line) => {
    const result = calculatePreview(line, line.catalogItemId ? pricesByItem.get(line.catalogItemId)?.unitPriceMinor : undefined);
    if (!result) return { ...summary, valid: false };
    return { valid: summary.valid, subtotal: summary.subtotal + result.subtotal, discount: summary.discount + result.discount, taxable: summary.taxable + result.taxable, tax: summary.tax + result.tax, total: summary.total + result.total };
  }, { valid: true, subtotal: 0n, discount: 0n, taxable: 0n, tax: 0n, total: 0n }), [draftLines, pricesByItem]);

  const currentVersion = workspace?.quote?.currentVersion ?? null;
  const hasDiscount = currentVersion ? BigInt(currentVersion.discountTotalMinor) > 0n : false;
  // A1-01/BIZ-06/BIZ-07: un descuento hasta el umbral de la policy (10% por defecto) no exige
  // aprobación gerencial; server-owned, nunca recalculado en cliente (S0-03).
  const requiresDiscountApproval = currentVersion?.requiresDiscountApproval ?? false;
  const activeDiscountApproval = currentVersion?.approvals.find((approval) => approval.type === 'DISCOUNT' && ['REQUESTED', 'APPROVED'].includes(approval.status)) ?? null;
  const discountApproval = currentVersion?.approvals.find((approval) => approval.type === 'DISCOUNT') ?? null;
  const hasApprovedDiscount = activeDiscountApproval?.status === 'APPROVED';
  const hasSpecialLines = currentVersion ? currentVersion.lines.some((line) => line.catalogItemId === null) : false;
  const activeSpecialApproval = currentVersion?.approvals.find((approval) => approval.type === 'SPECIAL_CONCEPT' && ['REQUESTED', 'APPROVED'].includes(approval.status)) ?? null;
  const specialApproval = currentVersion?.approvals.find((approval) => approval.type === 'SPECIAL_CONCEPT') ?? null;
  const hasApprovedSpecial = activeSpecialApproval?.status === 'APPROVED';
  const canPublish = Boolean(capabilities?.quotesSend && capabilities.quotesPdfGenerate);
  const canEdit = Boolean(capabilities?.quotesCreate && workspace && (!currentVersion || currentVersion.status === 'BORRADOR')) && autosaveState !== 'conflict';
  // RECHAZADA se incluye aquí a propósito: `createQuoteVersion` (el endpoint que dispara "Crear
  // nueva versión") ya acepta una versión rechazada como base -- su única restricción real es que
  // no haya ya un borrador o una versión en revisión pendiente -- así que sin RECHAZADA aquí, una
  // vez rechazada una versión el expediente quedaba sin ninguna forma de retomarla.
  // Sólo donde el servidor acepta versiones nuevas (expediente en elaboración o con propuesta enviada):
  // un expediente cerrado o de vuelta en revisión ya no ofrece un botón que terminaría en error.
  const canStartVersion = Boolean(capabilities?.quotesCreate && workspace && currentVersion && ['ENVIADA', 'EN_NEGOCIACION', 'RECHAZADA'].includes(currentVersion.status) && ['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'].includes(workspace.request.status));
  // UX audit fix: el preflight de envío nunca revisaba si alcance/condiciones de pago/garantías
  // (contenido real de la propuesta) estaban vacíos -- sólo el documento y los datos del
  // destinatario. Ninguno de estos campos es obligatorio a nivel de dato (una propuesta legítima
  // podría no necesitar garantías, por ejemplo), así que esto es un aviso, no un bloqueo.
  const emptyContentSections = [
    !contentFields.scopeText.trim() && 'alcance',
    !contentFields.paymentTermsText.trim() && 'condiciones de pago',
    !contentFields.warrantyText.trim() && 'garantías',
  ].filter((label): label is string => Boolean(label));
  const contentFilledCount = Object.values(contentFields).filter((value) => value.trim().length > 0).length;
  const manualPriceCount = draftLines.filter((line) => line.manualReason).length;
  const pendingPriceCount = draftLines.filter((line) => line.pricePending).length;

  // Un concepto "por cotizar" se resuelve solo en cuanto la lista de la propuesta ya tiene su precio
  // (alguien con permiso lo asignó en el Catálogo): pasa a ser una línea normal con el precio de lista,
  // sin pedirle nada a quien cotiza. El servidor hace lo mismo al guardar.
  useEffect(() => {
    if (!canEdit || !priceListDetail || priceListDetail.id !== selectedPriceListId) return;
    const resolvable = draftLines.filter((line) => line.pricePending && line.catalogItemId && pricesByItem.has(line.catalogItemId));
    if (resolvable.length === 0) return;
    const resolvableIds = new Set(resolvable.map((line) => line.id));
    setDraftLines((lines) => lines.map((line) => resolvableIds.has(line.id) ? { ...line, ...listPricedFields } : line));
    showToast(resolvable.length === 1
      ? `«${resolvable[0].catalogItemName}» ya tiene precio en la lista y se aplicó.`
      : `${resolvable.length} conceptos por cotizar ya tienen precio en la lista y se aplicaron.`);
  }, [canEdit, draftLines, pricesByItem, priceListDetail, selectedPriceListId, showToast]);
  const selectedCurrency = priceListDetail?.currencyCode ?? workspace?.request.detail?.currencyCode ?? 'MXN';
  const selectedTaxProfile = workspace?.taxProfiles.find((profile) => profile.id === selectedTaxProfileId) ?? null;

  // Guía de etapa: traduce versión + aprobaciones + permisos (ya calculados arriba) a "dónde va" y
  // "qué sigue", para no tener que deducirlo de qué botones aparecen en la barra de acciones.
  const stageInput = {
    versionStatus: currentVersion?.status ?? null,
    lineCount: draftLines.length,
    priceListSelected: Boolean(selectedPriceListId),
    approvalNeeded: requiresDiscountApproval || hasSpecialLines,
    approvalGranted: (!requiresDiscountApproval || hasApprovedDiscount) && (!hasSpecialLines || hasApprovedSpecial),
    approvalRequested: (!requiresDiscountApproval || hasApprovedDiscount || activeDiscountApproval?.status === 'REQUESTED') && (!hasSpecialLines || hasApprovedSpecial || activeSpecialApproval?.status === 'REQUESTED'),
    canApprove: Boolean(capabilities?.quotesApproveDiscount),
    canSend: canPublish,
    canEdit: Boolean(capabilities?.quotesCreate),
    projectCreated: Boolean(workspace?.project) || workspace?.request.status === 'CONVERTIDA_EN_PROYECTO',
    changesRequested: workspace?.changeRequest && currentVersion && ['ENVIADA', 'EN_NEGOCIACION'].includes(currentVersion.status) ? workspace.changeRequest.message : null,
    publishedExpired: Boolean(currentVersion && ['ENVIADA', 'EN_NEGOCIACION'].includes(currentVersion.status) && currentVersion.validUntil && new Date(currentVersion.validUntil).getTime() < Date.now()),
    requestStatus: workspace?.request.status ?? null,
    pendingPriceCount,
    // La última decisión fue un rechazo y aún no se vuelve a pedir: su motivo es la guía de ventas.
    approvalRejectedReason: (() => {
      const rejected = [discountApproval, specialApproval].find((approval) => approval?.status === 'REJECTED' && ((approval.type === 'DISCOUNT' && requiresDiscountApproval && !activeDiscountApproval) || (approval.type === 'SPECIAL_CONCEPT' && hasSpecialLines && !activeSpecialApproval)));
      return rejected ? rejected.reason ?? '' : null;
    })(),
  };
  const stageSteps = quoteStageSteps(stageInput);
  const nextStep = quoteNextStep(stageInput);
  const nextStepTarget = nextStep.target;

  const goToNextStep = (target: QuoteNextStepTarget) => {
    if (target === 'request') return;
    const element = target === 'price-list' ? document.getElementById('quotes-price-list')
      : target === 'lines' ? (document.querySelector<HTMLElement>('.quotes-line__pending-badge, .quotes-line__pending') ?? document.querySelector<HTMLElement>('.quotes-catalog-search__input'))
        : target === 'actions' ? document.getElementById('quotes-actions')
          : document.querySelector<HTMLElement>('.quote-document-panel');
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.focus({ preventScroll: true });
    if (target === 'actions' || target === 'document') {
      element.classList.remove('is-spotlit');
      void element.offsetWidth;
      element.classList.add('is-spotlit');
      window.setTimeout(() => element.classList.remove('is-spotlit'), 1600);
    }
  };

  // UX audit fix: cambiar "Lista de precios" deliberadamente NO repriecia en silencio las líneas ya
  // agregadas (Q1-05 protege justo contra eso), pero hasta ahora ese silencio no daba ninguna señal
  // -- el selector parecía no hacer nada. Un aviso puntual cierra esa brecha sin tocar la protección;
  // "Verificar precios vigentes" (Q1-04) sigue siendo el único camino explícito para repreciar.
  const handlePriceListChange = (nextId: string) => {
    const switchedList = Boolean(selectedPriceListId) && nextId !== selectedPriceListId;
    setSelectedPriceListId(nextId);
    if (switchedList && draftLines.some((line) => !line.special)) {
      showToast('Los conceptos ya agregados conservan su precio actual. Usa "Verificar precios vigentes" para actualizarlos a la lista nueva.');
    }
  };

  // K1-04: un solo perfil fiscal aplica a toda la versión (una obra tiene una sola zona de IVA),
  // así que un cambio de selección se propaga de inmediato a todas las líneas editables en vez de
  // pedir motivo/confirmación como el repreciado de catálogo (que sí es una decisión de precio).
  useEffect(() => {
    if ((!canEdit && !canStartVersion) || !selectedTaxProfile) return;
    const rate = String(selectedTaxProfile.ratePercentBasisPoints);
    setDraftLines((lines) => lines.some((line) => line.taxBasisPoints !== rate) ? lines.map((line) => ({ ...line, taxBasisPoints: rate })) : lines);
  }, [canEdit, canStartVersion, selectedTaxProfile]);

  // Q1-04: repreciar es una comprobación explícita bajo demanda, no un aviso ambiental — el precio
  // vigente sólo se conoce con certeza si se consulta al servidor en el momento, ya que
  // `priceListDetail` (cargado una sola vez por `selectedPriceListId`) no se refresca solo si el
  // catálogo cambia mientras el borrador sigue abierto.
  const [checkingReprice, setCheckingReprice] = useState(false);
  const [repriceAfterTotal, setRepriceAfterTotal] = useState<{ valid: boolean; total: bigint } | null>(null);
  const [repriceCandidates, setRepriceCandidates] = useState<Array<{ id: string; catalogItemId: string; name: string; oldPriceMinor: string; newPriceMinor: string }>>([]);

  const checkReprice = async () => {
    if (!selectedPriceListId || checkingReprice) return;
    setCheckingReprice(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { credentials: 'include', cache: 'no-store' });
      const fresh = await readApiResponseOrThrow<PriceListDetail>(response, 'No fue posible consultar los precios vigentes.');
      setPriceListDetail(fresh);
      const freshPricesByItem = currentPriceRows(fresh.items);
      const candidates = draftLines.flatMap((line) => {
        if (line.special || line.pricePending || line.unitPriceDirty || line.snapshotUnitPriceMinor === null || !line.catalogItemId) return [];
        const livePriceMinor = freshPricesByItem.get(line.catalogItemId)?.unitPriceMinor;
        if (!livePriceMinor || livePriceMinor === line.snapshotUnitPriceMinor) return [];
        return [{ id: line.id, catalogItemId: line.catalogItemId, name: line.catalogItemName, oldPriceMinor: line.snapshotUnitPriceMinor, newPriceMinor: livePriceMinor }];
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
    // Por concepto, no por id de fila: el diálogo puede llevar abierto varios autoguardados.
    const newPriceByItem = new Map(repriceCandidates.map((candidate) => [candidate.catalogItemId, candidate.newPriceMinor]));
    setDraftLines((lines) => lines.map((line) => {
      const newPriceMinor = line.catalogItemId ? newPriceByItem.get(line.catalogItemId) : undefined;
      if (newPriceMinor === undefined) return line;
      return { ...line, manualReason: '', snapshotUnitPriceMinor: null, unitPriceMinorOverride: '', unitPriceInput: moneyInputLabel(newPriceMinor), unitPriceDirty: false };
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
        lines: buildLinesPayload(draftLines, draftSections),
        sections: buildSectionsPayload(draftSections),
        // `${validUntil}T23:59:59.999Z` trataba la fecha local elegida como si ya fuera UTC -- en
        // America/Chihuahua (UTC-6/-7) eso adelantaba el vencimiento varias horas respecto a la
        // medianoche local real, así que una cotización "válida hasta" cierto día ya aparecía
        // vencida esa misma tarde para el cliente.
        ...(validUntil ? { validUntil: zonedCalendarDateEndOfDayToUtc(validUntil).toISOString() } : {}),
        ...(selectedTaxProfileId ? { taxProfileId: selectedTaxProfileId } : {}),
        scopeText: contentFields.scopeText || null,
        exclusionsText: contentFields.exclusionsText || null,
        paymentTermsText: contentFields.paymentTermsText || null,
        warrantyText: contentFields.warrantyText || null,
        publicNotesText: contentFields.publicNotesText || null,
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

  // Búsqueda instantánea al dejar de escribir (Enter la aplica al momento).
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === appliedSearch) return;
    const timer = window.setTimeout(() => { setPage(1); setAppliedSearch(trimmed); }, 350);
    return () => window.clearTimeout(timer);
  }, [appliedSearch, search]);

  // Un concepto del catálogo puede entrar a la propuesta con precio de lista (sin `mode`), con un precio
  // manual sólo para esta cotización, con el precio recién guardado en la lista o "por cotizar" (sin precio).
  const catalogDraftLine = (item: PricingTargetItem, mode?: PricingMode): DraftLine => ({
    id: `${item.id}-${Date.now()}`,
    special: false,
    sectionId: null,
    catalogItemId: item.id,
    catalogItemName: item.name,
    catalogItemCode: item.code,
    description: '',
    reason: '',
    manualReason: mode?.kind === 'manual' ? mode.reason : '',
    pricePending: mode?.kind === 'pending',
    unit: item.unit,
    quantity: '1',
    unitPriceMinorOverride: mode?.kind === 'manual' ? mode.minor : '',
    unitPriceInput: mode?.kind === 'manual' ? moneyInputLabel(mode.minor) : '',
    snapshotUnitPriceMinor: null,
    unitPriceDirty: mode?.kind === 'manual',
    discountBasisPoints: '0',
    taxBasisPoints: selectedTaxProfile ? String(selectedTaxProfile.ratePercentBasisPoints) : '0',
  });

  const addLineFromSearch = (item: PricingTargetItem, mode?: PricingMode) => {
    if (draftLines.some((line) => line.catalogItemId === item.id)) return;
    setDraftLines((lines) => [...lines, catalogDraftLine(item, mode)]);
  };

  // Una línea que ya estaba "por cotizar" recibe su precio: manual (sólo esta cotización) o el de la lista.
  const priceExistingLine = (catalogItemId: string, mode: Exclude<PricingMode, { kind: 'pending' }>) => setDraftLines((lines) => lines.map((line) => {
    if (line.catalogItemId !== catalogItemId) return line;
    return mode.kind === 'manual'
      ? { ...line, pricePending: false, manualReason: mode.reason, unitPriceMinorOverride: mode.minor, unitPriceInput: moneyInputLabel(mode.minor), snapshotUnitPriceMinor: null, unitPriceDirty: true }
      : { ...line, ...listPricedFields };
  }));

  const openPricing = (item: CatalogSearchResultItem) => {
    setPricingTarget({ item: { id: item.id, code: item.code, name: item.name, unit: item.unit }, existing: false });
    setPricingError(null);
  };

  const openPricingForLine = (line: DraftLine) => {
    if (!line.catalogItemId) return;
    setPricingTarget({ item: { id: line.catalogItemId, code: line.catalogItemCode, name: line.catalogItemName, unit: line.unit }, existing: true });
    setPricingError(null);
  };

  const closePricing = () => { if (!pricingBusy) setPricingTarget(null); };

  const submitPricing = async ({ scope, minor, reason }: PricingSubmission) => {
    if (!pricingTarget || pricingBusy) return;
    const { item, existing } = pricingTarget;
    if (scope === 'PENDING') {
      addLineFromSearch(item, { kind: 'pending' });
      setPricingTarget(null);
      showToast('Concepto agregado por cotizar. No suma al total; define su precio, o espera a que se asigne, para pasar a revisión.');
      return;
    }
    if (scope === 'QUOTE') {
      const mode = { kind: 'manual', minor: minor!, reason } as const;
      if (existing) priceExistingLine(item.id, mode); else addLineFromSearch(item, mode);
      setPricingTarget(null);
      showToast('Precio manual aplicado sólo a esta cotización. La lista de precios no cambió.');
      return;
    }
    if (!priceListDetail || !listDetailReady) { setPricingError('La lista de precios todavía se está cargando. Inténtalo de nuevo en un momento.'); return; }
    setPricingBusy(true);
    setPricingError(null);
    try {
      await assignListPrice({ id: priceListDetail.id, validFrom: priceListDetail.validFrom, validUntil: priceListDetail.validUntil }, item.id, minor!);
      const refreshed = await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { credentials: 'include', cache: 'no-store' });
      setPriceListDetail(await readApiResponseOrThrow<PriceListDetail>(refreshed, 'El precio se guardó, pero no fue posible actualizar la lista.'));
      if (existing) priceExistingLine(item.id, { kind: 'list' }); else addLineFromSearch(item, { kind: 'list' });
      setPricingTarget(null);
      showToast('Precio guardado en la lista y aplicado a la cotización.');
    } catch (caught) {
      setPricingError(caught instanceof Error ? caught.message : 'No fue posible guardar el precio en la lista.');
    } finally {
      setPricingBusy(false);
    }
  };

  const addSpecialLine = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!specialForm.name.trim() || !specialForm.unit.trim() || !specialForm.reason.trim()) return;
    setDraftLines((lines) => [...lines, {
      id: `special-${Date.now()}`,
      special: true,
      sectionId: null,
      catalogItemId: null,
      catalogItemName: specialForm.name.trim(),
      catalogItemCode: '',
      description: specialForm.description.trim(),
      reason: specialForm.reason.trim(),
      manualReason: '',
      pricePending: false,
      unit: specialForm.unit.trim(),
      quantity: '1',
      unitPriceMinorOverride: '',
      unitPriceInput: specialForm.amountInput,
      snapshotUnitPriceMinor: null,
      unitPriceDirty: true,
      discountBasisPoints: '0',
      taxBasisPoints: selectedTaxProfile ? String(selectedTaxProfile.ratePercentBasisPoints) : '0',
    }]);
    setSpecialForm({ name: '', unit: '', description: '', amountInput: '', reason: '' });
    setShowSpecialForm(false);
  };

  const updateLine = (id: string, field: keyof Omit<DraftLine, 'id' | 'catalogItemId' | 'special'>, value: string) => setDraftLines((lines) => lines.map((line) => line.id === id ? { ...line, [field]: value } : line));
  // Q1-03: el orden del arreglo es la fuente de verdad de `position` — reordenar aquí y dejar que
  // el autosave ya existente lo persista es suficiente; no hace falta ningún endpoint nuevo.
  // UX audit fix: sin la comprobación de `sectionId`, mover una línea con las flechas podía cruzar
  // el límite de una sección vecina -- `position` (el orden del arreglo) se persiste tal cual, pero
  // `sectionId` no cambiaba, así que la línea quedaba insertada en medio del bloque contiguo de otra
  // sección. Como el encabezado de sección (más abajo) asume que cada sección es un tramo contiguo,
  // el resultado era esa misma sección partida en dos fragmentos duplicados y mal etiquetados --
  // guardado y visible para cualquiera que reabriera el mismo borrador después. Reordenar con las
  // flechas ahora se queda dentro de la misma sección (o del grupo "sin sección"); cambiar de
  // sección sigue siendo el selector dedicado que ya existe para eso.
  const moveLine = (index: number, direction: -1 | 1) => setDraftLines((lines) => {
    const target = index + direction;
    if (target < 0 || target >= lines.length) return lines;
    if (lines[target].sectionId !== lines[index].sectionId) return lines;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const updateLineSection = (id: string, sectionId: string) => setDraftLines((lines) => lines.map((line) => line.id === id ? { ...line, sectionId: sectionId || null } : line));

  const addSection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sectionForm.title.trim()) return;
    setDraftSections((sections) => [...sections, { id: `section-${Date.now()}`, title: sectionForm.title.trim(), description: sectionForm.description.trim() }]);
    setSectionForm({ title: '', description: '' });
    setShowSectionForm(false);
  };
  // Quitar una sección nunca borra sus líneas -- sólo las deja "sin sección", igual que
  // cualquier línea que nunca tuvo una asignada.
  const removeSection = (id: string) => {
    setDraftSections((sections) => sections.filter((section) => section.id !== id));
    setDraftLines((lines) => lines.map((line) => line.sectionId === id ? { ...line, sectionId: null } : line));
  };

  const buildSectionsPayload = (sections: DraftSection[]) => sections.map((section) => ({ title: section.title, description: section.description.trim() || undefined }));

  const buildLinesPayload = (lines: DraftLine[], sections: DraftSection[]) => lines.map((line) => {
    const sectionIndex = line.sectionId ? sections.findIndex((section) => section.id === line.sectionId) : -1;
    const sectionIndexField = sectionIndex >= 0 ? { sectionIndex } : {};
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
        ...sectionIndexField,
      };
    }
    if (line.pricePending) {
      // Sin precio: el servidor lo guarda en cero, o lo resuelve con la lista si ya tiene precio ahí.
      return {
        catalogItemId: line.catalogItemId!,
        quantity: line.quantity,
        pricePending: true as const,
        discountBasisPoints: 0,
        taxBasisPoints: Number(line.taxBasisPoints || '0'),
        ...sectionIndexField,
      };
    }
    const unitPriceMinorOverride = line.unitPriceDirty
      ? parseMoneyInput(line.unitPriceInput)
      : line.snapshotUnitPriceMinor ?? line.unitPriceMinorOverride.trim();
    return {
      catalogItemId: line.catalogItemId!,
      quantity: line.quantity,
      ...(unitPriceMinorOverride ? { unitPriceMinorOverride } : {}),
      ...(line.manualReason ? { manualPriceReason: line.manualReason } : {}),
      discountBasisPoints: Number(line.discountBasisPoints || '0'),
      taxBasisPoints: Number(line.taxBasisPoints || '0'),
      ...sectionIndexField,
    };
  });

  // Q1-05: autosave del borrador en edición (creación inicial vía POST o edición de un BORRADOR vía PATCH).
  // La creación de una versión nueva a partir de una ya ENVIADA/EN_NEGOCIACION (canStartVersion) permanece
  // como acción manual explícita en `createVersionFromSent`, sin autosave: es una bifurcación deliberada, no una edición en curso.
  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (!workspace || !selectedPriceListId || draftLines.length === 0 || !preview.valid || !capabilities?.quotesCreate) return true;
    if (!currentVersion || currentVersion.status === 'BORRADOR') {
      const snapshotToPersist = editorSnapshotKey(selectedPriceListId, selectedTaxProfileId, validUntil, draftLines, contentFields, draftSections);
      if (snapshotToPersist === savedSnapshotRef.current) return true;
      if (snapshotToPersist !== lastAttemptSnapshotRef.current) errorRetryCountRef.current = 0;
      lastAttemptSnapshotRef.current = snapshotToPersist;
      // UX audit fix: agregar conceptos rápido (varias líneas en pocos segundos, cada una
      // reprogramando el debounce de 800ms) podía dejar dos invocaciones de `persistDraft` en vuelo
      // a la vez -- si la respuesta de la MÁS VIEJA llegaba DESPUÉS que la de la más nueva,
      // `savedSnapshotRef.current` (escrito sin ninguna guarda) se sobreescribía de vuelta a un
      // snapshot ya obsoleto. El efecto de autoguardado entonces reintentaba, pero mientras tanto
      // `snapshotUnitPriceMinor` de líneas ya agregadas podía quedar sin re-congelarse -- y
      // `checkReprice()` excluye cualquier línea con `snapshotUnitPriceMinor === null` de la
      // comparación, así que "Verificar precios vigentes" reportaba en silencio "ya están
      // actualizados" en vez de detectar el cambio real. Sólo la generación más reciente puede
      // ahora actualizar el snapshot guardado o el estado visible de autoguardado.
      const generation = (persistDraftGenerationRef.current += 1);
      setAutosaveState('saving');
      setAutosaveMessage(null);
      try {
        const isDraftUpdate = currentVersion?.status === 'BORRADOR';
        const payload = {
          priceListId: selectedPriceListId,
          lines: buildLinesPayload(draftLines, draftSections),
          sections: buildSectionsPayload(draftSections),
          ...(validUntil ? { validUntil: zonedCalendarDateEndOfDayToUtc(validUntil).toISOString() } : {}),
          ...(selectedTaxProfileId ? { taxProfileId: selectedTaxProfileId } : {}),
          ...(isDraftUpdate && expectedUpdatedAtRef.current ? { expectedUpdatedAt: expectedUpdatedAtRef.current } : {}),
          scopeText: contentFields.scopeText || null,
          exclusionsText: contentFields.exclusionsText || null,
          paymentTermsText: contentFields.paymentTermsText || null,
          warrantyText: contentFields.warrantyText || null,
          publicNotesText: contentFields.publicNotesText || null,
        };
        const response = await fetch(isDraftUpdate ? `/api/staff/quotes/versions/${currentVersion!.id}` : `/api/staff/quotes/${workspace.request.id}`, { method: isDraftUpdate ? 'PATCH' : 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.status === 409) {
          if (persistDraftGenerationRef.current === generation) {
            const body = await response.json().catch(() => ({}));
            setAutosaveMessage(getApiErrorMessage(body, 'La versión cambió desde la última lectura. Recarga el borrador antes de guardar.'));
            setAutosaveState('conflict');
          }
          return false;
        }
        const result = await readApiResponse(response, 'No fue posible guardar la cotización.');
        if (!result.ok) {
          if (persistDraftGenerationRef.current === generation) { errorRetryCountRef.current += 1; setAutosaveMessage(result.message); setAutosaveState('error'); }
          return false;
        }
        const [freshVersion] = await Promise.all([syncQuoteVersionMetadata(workspace.request.id), loadBase(page, appliedSearch)]);
        if (persistDraftGenerationRef.current !== generation) return true;
        errorRetryCountRef.current = 0;
        savedSnapshotRef.current = snapshotToPersist;
        savedEditorSnapshotRef.current = snapshotToPersist;
        // Re-congela el precio snapshot (fidelidad S0-02) sólo si nada cambió localmente durante el round-trip;
        // si el usuario ya siguió editando, dejamos sus ediciones intactas — el próximo ciclo las persistirá.
        const localUnchanged = editorSnapshotKey(selectedPriceListIdRef.current, selectedTaxProfileIdRef.current, validUntilRef.current, draftLinesRef.current, contentFieldsRef.current, draftSectionsRef.current) === snapshotToPersist;
        if (freshVersion && localUnchanged) {
          const persistedByItem = new Map(freshVersion.lines.filter((line) => line.catalogItemId !== null).map((line) => [line.catalogItemId as string, line]));
          // El servidor resuelve con la lista un concepto "por cotizar" que ya tiene precio ahí: se avisa.
          const healed = draftLinesRef.current.filter((line) => line.pricePending && line.catalogItemId && persistedByItem.get(line.catalogItemId)?.pricePending === false);
          if (healed.length > 0) showToast(healed.length === 1 ? `«${healed[0].catalogItemName}» ya tenía precio en la lista y se aplicó.` : `${healed.length} conceptos por cotizar ya tenían precio en la lista y se aplicaron.`);
          setDraftLines((lines) => lines.map((line) => {
            if (line.special || !line.catalogItemId) return line;
            const persisted = persistedByItem.get(line.catalogItemId);
            if (!persisted) return line;
            return {
              ...line,
              id: persisted.id,
              pricePending: Boolean(persisted.pricePending),
              catalogItemCode: persisted.catalogItemCode ?? line.catalogItemCode,
              snapshotUnitPriceMinor: persisted.unitPriceMinor,
              unitPriceInput: moneyInputLabel(persisted.unitPriceMinor),
              unitPriceMinorOverride: persisted.unitPriceMinor,
              unitPriceDirty: false,
            };
          }));
        } else if (freshVersion) {
          // El borrador cambió durante el viaje de ida y vuelta, pero las líneas que el servidor YA
          // guardó tienen su precio congelado: se fija en las que todavía no lo tenían, sin tocar nada
          // de lo que el usuario esté editando (ni ids, ni entradas, ni líneas con precio manual).
          // Sin esto, agregar y quitar una línea mientras se guardaba devolvía el borrador a "Guardado"
          // con líneas sin precio congelado: se mostraba el precio vivo del catálogo en lugar del
          // guardado (Q1-05) y "Verificar precios vigentes" ya no detectaba el cambio.
          const persistedByItem = new Map(freshVersion.lines.filter((line) => line.catalogItemId !== null).map((line) => [line.catalogItemId as string, line]));
          setDraftLines((lines) => lines.map((line) => {
            if (line.special || !line.catalogItemId || line.unitPriceDirty || line.snapshotUnitPriceMinor !== null) return line;
            const persisted = persistedByItem.get(line.catalogItemId);
            // Nunca se congela el cero de un concepto "por cotizar" en una línea que ya se resolvió mientras se guardaba.
            return persisted && !persisted.pricePending && !line.pricePending ? { ...line, snapshotUnitPriceMinor: persisted.unitPriceMinor } : line;
          }));
        }
        // Si el borrador cambió durante el viaje de ida y vuelta, lo persistido ya no es lo que se ve
        // (y el precio de las líneas nuevas todavía no se re-congeló): mostrar "Guardado" era una
        // señal falsa. Con 'dirty' el efecto de autoguardado programa el siguiente ciclo, y sólo ése
        // -- cuando lo guardado coincide con la pantalla -- vuelve a marcar "Guardado".
        setAutosaveState(localUnchanged ? 'saved' : 'dirty');
        return true;
      } catch (caught) {
        if (persistDraftGenerationRef.current === generation) {
          if (typeof navigator !== 'undefined' && !navigator.onLine) { setAutosaveState('offline'); return false; }
          errorRetryCountRef.current += 1;
          setAutosaveMessage(caught instanceof Error ? caught.message : 'No fue posible guardar la cotización.');
          setAutosaveState('error');
        }
        return false;
      }
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, selectedPriceListId, selectedTaxProfileId, draftLines, draftSections, validUntil, contentFields, preview.valid, capabilities, currentVersion, page, appliedSearch]);

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
    const liveSnapshot = editorSnapshotKey(selectedPriceListId, selectedTaxProfileId, validUntil, draftLines, contentFields, draftSections);
    if (liveSnapshot === savedSnapshotRef.current) { if (autosaveState !== 'saved') setAutosaveState('saved'); return; }
    if (autosaveState === 'error' && liveSnapshot === lastAttemptSnapshotRef.current && errorRetryCountRef.current >= 3) return;
    setAutosaveState((current) => current === 'saved' || current === 'error' ? 'dirty' : current);
    const timer = setTimeout(() => { void persistDraft(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [canEdit, workspace, selectedPriceListId, selectedTaxProfileId, validUntil, draftLines, draftSections, contentFields, autosaveState, persistDraft]);

  const retryDraftSaveNow = () => { errorRetryCountRef.current = 0; void persistDraft(); };

  const transition = async (toStatus: string, expectedContentDigest?: string): Promise<boolean> => {
    if (!currentVersion) return false;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toStatus === 'ENVIADA' ? { action: 'publish', expectedContentDigest } : { action: 'submit_for_review' }) });
      await readApiResponseOrThrow(response, 'No fue posible cambiar el estado.');
      showToast(toStatus === 'ENVIADA'
        ? `Cotización enviada: ${workspace?.request.client.displayName ?? 'el cliente'} recibirá un aviso para revisarla.`
        : toStatus === 'EN_REVISION'
          ? 'Versión en revisión. Si falta algo, puedes regresarla a borrador.'
          : `Cotización movida a ${statusLabel(toStatus).toLowerCase()}.`);
      await refresh();
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.'); return false; }
    finally { setSaving(false); }
  };

  // P1-04/P1-05: antes de publicar, un humano ve destinatario/total/documento reales y confirma
  // explícitamente — nunca un solo clic sin resumen. El digest leído al abrir este diálogo viaja
  // de vuelta como `expectedContentDigest`; si la versión volvió a borrador y se editó mientras el
  // diálogo seguía abierto en otra pestaña, el servidor lo detecta y rechaza el envío obsoleto.
  const openPublishPreflight = async () => {
    if (!currentVersion) return;
    setPublishPreflight({ documentStatus: 'MISSING', contentDigest: null, loading: true });
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/document`, { credentials: 'include', cache: 'no-store' });
      const data = await readApiResponseOrThrow<{ document: { status: DocumentStatus }; contentDigest: string }>(response, 'No fue posible consultar el documento.');
      setPublishPreflight({ documentStatus: data.document.status, contentDigest: data.contentDigest, loading: false });
    } catch {
      setPublishPreflight({ documentStatus: 'MISSING', contentDigest: null, loading: false });
    }
  };

  const confirmPublish = async () => {
    const expectedContentDigest = publishPreflight?.contentDigest ?? undefined;
    const succeeded = await transition('ENVIADA', expectedContentDigest);
    if (succeeded) setPublishPreflight(null);
  };

  // Q1-06: "volver a editar" no existía en la UI — una vez en revisión, la única salida era enviar
  // o esperar la aprobación; un error detectado tarde no tenía forma de corregirse. El comando ya
  // existía (D2-04), sólo faltaba conectarlo, y exige explicar la consecuencia real antes de confirmar:
  // invalida cualquier aprobación vigente y el PDF ya generado (el servidor deja de reutilizarlo).
  const [returnToDraftDialogOpen, setReturnToDraftDialogOpen] = useState(false);
  const [returnToDraftReason, setReturnToDraftReason] = useState('');

  // UX audit fix: `rejectQuoteVersion` (RECHAZADA, válida desde ENVIADA/EN_NEGOCIACION) ya estaba
  // completa del lado del servidor -- con su propia entrada de auditoría, y `ClientQuoteActions.tsx`
  // ya tiene un mensaje dedicado para cuando el cliente ve una versión en este estado -- pero ningún
  // botón de staff la disparaba jamás, así que el estado nunca se producía en la práctica. Mismo
  // patrón de diálogo con motivo obligatorio que "Volver a borrador".
  const [rejectVersionDialogOpen, setRejectVersionDialogOpen] = useState(false);
  const [rejectVersionReason, setRejectVersionReason] = useState('');

  // H1-05/UX audit: "Rechazar" disparaba con un solo clic un motivo fabricado en el cliente
  // ('No se autoriza el descuento en esta versión.') que el propio servidor exige real
  // (decideQuoteApproval ya valida "Indica el motivo del rechazo." si viene vacío) — un clic
  // accidental junto a "Aprobar" quedaba escrito en el historial como si el gerente lo hubiera
  // explicado. Mismo patrón de diálogo que "Volver a borrador" arriba.
  const [rejectApprovalDialog, setRejectApprovalDialog] = useState<{ kind: 'DISCOUNT' | 'SPECIAL_CONCEPT'; approvalId: string } | null>(null);
  // Pedir aprobación abre un resumen con el motivo para gerencia: antes se enviaba sin contexto y la
  // cola de aprobaciones (que sí muestra "Motivo de ventas") quedaba sin por qué.
  const [approvalRequestDialog, setApprovalRequestDialog] = useState<'DISCOUNT' | 'SPECIAL_CONCEPT' | null>(null);
  const [approvalRequestReason, setApprovalRequestReason] = useState('');
  const [rejectApprovalReason, setRejectApprovalReason] = useState('');
  const editorHasUnsavedChanges = editorSnapshotKey(selectedPriceListId, selectedTaxProfileId, validUntil, draftLines, contentFields, draftSections) !== savedEditorSnapshotRef.current;
  const remoteLoadBlocked = editorHasUnsavedChanges || autosaveState !== 'saved' || saving || pricingBusy || showSectionForm || showSpecialForm || pricingTarget !== null || repriceDialogOpen || returnToDraftDialogOpen || rejectVersionDialogOpen || rejectApprovalDialog !== null || approvalRequestDialog !== null || publishPreflight !== null;
  remoteInteractionRef.current = remoteLoadBlocked;
  useRealtimeRequest(selectedId, ['quote', 'approvals'], () => {
    if (!remoteInteractionRef.current && selectedId) void loadWorkspace(selectedId, { silent: true });
    else setRemoteChange(true);
  });

  const confirmReturnToDraft = async () => {
    if (!currentVersion || !returnToDraftReason.trim()) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'return_to_draft', reason: returnToDraftReason.trim() }) });
      await readApiResponseOrThrow(response, 'No fue posible volver a borrador.');
      showToast('La versión volvió a borrador. Ya puedes editarla de nuevo.');
      setReturnToDraftDialogOpen(false);
      setReturnToDraftReason('');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible volver a borrador.'); }
    finally { setSaving(false); }
  };

  const confirmRejectVersion = async () => {
    if (!currentVersion || !rejectVersionReason.trim()) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reject', reason: rejectVersionReason.trim() }) });
      await readApiResponseOrThrow(response, 'No fue posible rechazar la versión.');
      showToast('Versión marcada como rechazada.');
      setRejectVersionDialogOpen(false);
      setRejectVersionReason('');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible rechazar la versión.'); }
    finally { setSaving(false); }
  };

  const convertAcceptedToProject = async () => {
    if (!workspace?.acceptance) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/staff/projects', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteAcceptanceId: workspace.acceptance.id }) });
      const created = await readApiResponseOrThrow<{ id: string; folio: string }>(response, 'No fue posible crear el proyecto.');
      showToast(`Proyecto ${created.folio} creado. El arranque sigue en Proyectos.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear el proyecto.'); }
    finally { setSaving(false); }
  };

  const openApprovalRequest = (kind: 'DISCOUNT' | 'SPECIAL_CONCEPT') => {
    // Para el concepto especial se propone el motivo que ventas ya escribió en la línea.
    const specialReasons = kind === 'SPECIAL_CONCEPT' && currentVersion ? [...new Set(currentVersion.lines.filter((line) => line.catalogItemId === null && line.specialReason).map((line) => line.specialReason as string))] : [];
    setApprovalRequestReason(specialReasons.join(' · ').slice(0, 500));
    setApprovalRequestDialog(kind);
  };

  const requestDiscountApproval = async (reason?: string) => {
    if (!currentVersion || !requiresDiscountApproval || currentVersion.status !== 'EN_REVISION') return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/approvals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: Math.max(...currentVersion.lines.map((line) => line.discountBasisPoints), 0), ...(reason ? { reason } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible solicitar la aprobación.');
      setApprovalRequestDialog(null);
      showToast('Aprobación solicitada. Una persona autorizada debe resolverla antes de enviar la cotización.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible solicitar la aprobación.'); }
    finally { setSaving(false); }
  };

  const decideDiscountApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED', reason?: string) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/approvals/${approvalId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(decision === 'REJECTED' ? { reason } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible resolver la aprobación.');
      showToast(decision === 'APPROVED' ? 'Descuento aprobado. Ya puedes enviar la cotización.' : 'Aprobación rechazada; revisa la propuesta antes de continuar.');
      setRejectApprovalDialog(null);
      setRejectApprovalReason('');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible resolver la aprobación.'); }
    finally { setSaving(false); }
  };

  const requestSpecialApproval = async (reason?: string) => {
    if (!currentVersion || !hasSpecialLines || currentVersion.status !== 'EN_REVISION') return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/versions/${currentVersion.id}/approvals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'SPECIAL_CONCEPT', policyVersion: 'special-concept-v1', ...(reason ? { reason } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible solicitar la aprobación.');
      setApprovalRequestDialog(null);
      showToast('Aprobación solicitada. Una persona autorizada debe resolverla antes de enviar la cotización.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible solicitar la aprobación.'); }
    finally { setSaving(false); }
  };

  const decideSpecialApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED', reason?: string) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/staff/quotes/approvals/${approvalId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(decision === 'REJECTED' ? { reason } : {}) }),
      });
      await readApiResponseOrThrow(response, 'No fue posible resolver la aprobación.');
      showToast(decision === 'APPROVED' ? 'Concepto especial aprobado. Ya puedes enviar la cotización.' : 'Aprobación rechazada; revisa la propuesta antes de continuar.');
      setRejectApprovalDialog(null);
      setRejectApprovalReason('');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible resolver la aprobación.'); }
    finally { setSaving(false); }
  };

  // Nunca perder trabajo silenciosamente: si hay cambios sin persistir, se intenta guardar antes de cambiar de expediente.
  const selectRequest = async (id: string): Promise<boolean> => {
    if (id === selectedId) return true;
    if (autosaveState === 'conflict') return false;
    if (canEdit && ['dirty', 'error', 'offline'].includes(autosaveState)) {
      const persisted = await persistDraft();
      if (!persisted) return false;
    }
    setSelectedId(id);
    return true;
  };

  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (autosaveState === 'conflict') { event.preventDefault(); return; }
    if (canEdit && ['dirty', 'error', 'offline'].includes(autosaveState)) {
      event.preventDefault();
      void (async () => {
        const persisted = await persistDraft();
        if (persisted) router.push(href);
      })();
    }
  };

  if (restricted) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/staff/requests" variant="quiet">Volver a solicitudes</PrivateLinkButton></div>}>Inicia sesión con una cuenta de empleado con permiso comercial para usar el constructor.</PrivateBlockingState></PrivateSurfaceRoot>;

  return <PrivateSurfaceRoot className="staff-shell">
    <StaffHeader onNavigate={guardNavigation} />
    <div className="staff-content">
      <div className="staff-intro"><div><p className="staff-kicker">Trabajo comercial</p><h1>Cotizaciones</h1><p className="staff-intro__copy">Convierte el alcance de cada expediente en una propuesta trazable, precisa y lista para revisión.</p></div><div className="staff-intro__metric"><strong>{loading && requests.length === 0 ? '—' : total}</strong><span>{listScope === 'closed' ? (total === 1 ? 'expediente cerrado' : 'expedientes cerrados') : total === 1 ? 'expediente listo' : 'expedientes listos'}</span></div></div>
      {error && <p className="staff-error" role="alert">{error}</p>}
      <section className="quotes-workspace" aria-label="Constructor de cotizaciones">
        <aside className="quotes-rail">
          <form className="staff-filters" onSubmit={submitSearch} role="search" aria-label="Buscar expedientes"><label><span>Buscar expediente</span><span className="staff-search"><input aria-label="Buscar expediente" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Folio o cliente" maxLength={100} />{search && <button type="button" className="staff-search__clear" aria-label="Limpiar búsqueda" onClick={() => setSearch('')}><X size={15} aria-hidden="true" /></button>}</span></label></form>
          <div className="staff-views quotes-scope" role="group" aria-label="Qué cotizaciones ver">{(['open', 'closed'] as const).map((scope) => <button key={scope} type="button" className={listScope === scope ? 'is-selected' : ''} aria-pressed={listScope === scope} onClick={() => { if (listScope !== scope) { setPage(1); setListScope(scope); } }}>{scope === 'open' ? 'En curso' : 'Cerradas'}</button>)}</div>
          <div className="staff-inbox__head"><span>{loading ? 'Actualizando…' : `Mostrando ${requests.length} de ${total}`}</span></div>
          <div className="quotes-request-list" aria-live="polite">
            {loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}
            {!loading && requests.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span>{listScope === 'closed' ? <><h2>Sin cotizaciones cerradas.</h2><p>Aquí verás las aceptadas, las que ya son proyecto y las que se cerraron.</p></> : <><h2>Sin expedientes listos.</h2><p>Las solicitudes en elaboración o negociación aparecerán aquí.</p></>}</div>}
            {!loading && requests.map((item) => <button className={`quotes-request-row${selectedId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => { if (item.id === selectedId) { revealWhenStacked(mainRef.current, '(max-width: 1100px)'); return; } void selectRequest(item.id).then((switched) => { revealPendingRef.current = switched; }); }}><span className="quotes-request-row__signal" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.client.displayName}</b><small>{item.detail?.projectType ?? 'Sin tipo'} · {item.detail?.location ?? 'Sin ubicación'}</small></span><em>{item.quote?.currentVersion ? `V${item.quote.currentVersion.versionNumber}` : 'Nuevo'}</em></button>)}
          </div>
          <PrivatePagination page={page} totalPages={totalPages} disabled={loading} onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)} />
        </aside>
        <section className="quotes-main" ref={mainRef}>
          {(loadingWorkspace || (loading && !workspace)) && <div className="staff-detail__loading"><span /><span /><span /></div>}
          {!loadingWorkspace && !loading && !workspace && (error && requests.length === 0
            ? <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>No pudimos cargar el constructor.</h2><p>Revisa tu conexión e inténtalo de nuevo; tu trabajo guardado no se pierde.</p><button className="staff-button staff-button--dark" type="button" onClick={() => void loadBase(page, appliedSearch)}>Reintentar</button></div>
            : requests.length === 0 && !appliedSearch
              ? <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Nada por cotizar todavía.</h2><p>Cuando una solicitud pase a elaboración de cotización aparecerá aquí, lista para armar la propuesta.</p><Link className="staff-button" href="/staff/requests" onClick={(event) => guardNavigation(event, '/staff/requests')}>Revisar la bandeja</Link></div>
              : <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>Selecciona un expediente.</h2><p>El alcance y las líneas de cotización aparecerán aquí.</p></div>)}
          {!loadingWorkspace && workspace && <>
            <div className="quotes-main__top"><div><p className="staff-kicker">{workspace.request.origin === 'PUBLIC_FORM' ? 'Solicitud pública' : 'Solicitud interna'}</p><h2>{workspace.request.folio}</h2><p className="staff-detail__date">{workspace.request.client.displayName} · Actualizado {formatDateTime(workspace.request.updatedAt)}</p><Link className="quotes-main__request-link" href={`/staff/requests?request=${workspace.request.id}`} onClick={(event) => guardNavigation(event, `/staff/requests?request=${workspace.request.id}`)}>Ver expediente<ArrowUpRight size={14} aria-hidden="true" /></Link></div><StatusPill status={workspace.request.status} /></div>
            <ExpedienteJourney here="quote" requestId={workspace.request.id} requestStatus={workspace.request.status} quote={currentVersion ? { versionNumber: currentVersion.versionNumber, status: currentVersion.status, validUntil: currentVersion.validUntil } : null} project={workspace.project ?? null} />
            {workspace.declineRequest && <p className="quotes-action-note" role="status">El cliente declinó la V{workspace.declineRequest.versionNumber} · {workspace.declineRequest.reason}. Consulta el comentario en la conversación.</p>}
            <section className="quotes-stage" aria-label="Avance de la cotización"><ol className="quotes-stage__steps">{stageSteps.map((step, index) => <li key={step.key} className={`quotes-stage__step is-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}><span className="quotes-stage__marker" aria-hidden="true">{step.state === 'done' ? <Check size={13} strokeWidth={2.6} /> : step.state === 'closed' ? <X size={13} strokeWidth={2.6} /> : index + 1}</span><span className="quotes-stage__label">{step.label}<span className="sr-only">{STAGE_STATE_LABELS[step.state]}</span>{step.note && <small>{step.note}</small>}</span></li>)}</ol><div className={`quotes-next quotes-next--${nextStep.tone}`}><span className="quotes-next__icon" aria-hidden="true">{nextStep.tone === 'waiting' ? <Hourglass size={18} /> : nextStep.tone === 'blocked' ? <AlertTriangle size={18} /> : nextStep.tone === 'done' ? <CircleCheck size={18} /> : <Compass size={18} />}</span><div className="quotes-next__body"><p className="staff-section-label">Siguiente paso</p><h3>{nextStep.title}</h3><p>{nextStep.detail}</p></div>{(() => {
              // Aceptada: lleva al proyecto de arranque o lo crea con un clic (aceptaciones anteriores o
              // si la creación automática falló).
              if (currentVersion?.status === 'ACEPTADA' && workspace?.project) return <Link className="staff-button staff-button--dark quotes-next__cta" href={`/staff/projects/${workspace.project.id}`}>Abrir proyecto<ArrowRight size={15} aria-hidden="true" /></Link>;
              if (currentVersion?.status === 'ACEPTADA' && capabilities?.projectsCreate && workspace?.acceptance) return <button className="staff-button staff-button--dark quotes-next__cta" type="button" disabled={saving} onClick={() => void convertAcceptedToProject()}>{saving ? 'Creando…' : 'Convertir en proyecto'}<ArrowRight size={15} aria-hidden="true" /></button>;
              // Si el siguiente paso es una acción de un clic (y sin confirmación extra), el botón la
              // ejecuta; si pide decidir o revisar algo, lleva a la barra de acciones y la resalta.
              const direct = canStartVersion && ((stageInput.changesRequested !== null && stageInput.changesRequested !== undefined) || stageInput.publishedExpired || currentVersion?.status === 'RECHAZADA')
                ? { label: 'Crear nueva versión', run: () => void createVersionFromSent(), disabled: saving || !preview.valid || draftLines.length === 0 || !selectedPriceListId }
                : currentVersion?.status === 'BORRADOR' && capabilities?.quotesCreate && draftLines.length > 0 && nextStepTarget === 'actions'
                ? { label: 'Pasar a revisión', run: () => void transition('EN_REVISION'), disabled: saving || autosaveState === 'saving' || autosaveState === 'dirty' || autosaveState === 'conflict' }
                : currentVersion?.status === 'EN_REVISION' && capabilities?.quotesCreate && requiresDiscountApproval && !hasApprovedDiscount && !activeDiscountApproval
                  ? { label: 'Solicitar aprobación', run: () => openApprovalRequest('DISCOUNT'), disabled: saving }
                  : currentVersion?.status === 'EN_REVISION' && capabilities?.quotesCreate && hasSpecialLines && !hasApprovedSpecial && !activeSpecialApproval
                    ? { label: 'Solicitar aprobación', run: () => openApprovalRequest('SPECIAL_CONCEPT'), disabled: saving }
                    : currentVersion?.status === 'EN_REVISION' && canPublish && (!requiresDiscountApproval || hasApprovedDiscount) && (!hasSpecialLines || hasApprovedSpecial)
                      ? { label: 'Revisar y enviar', run: () => void openPublishPreflight(), disabled: saving }
                      : null;
              if (direct) return <button className="staff-button staff-button--dark quotes-next__cta" type="button" disabled={direct.disabled} onClick={direct.run}>{direct.label}<ArrowRight size={15} aria-hidden="true" /></button>;
              if (nextStepTarget === 'request' && workspace) return <Link className="staff-button staff-button--outline quotes-next__cta" href={`/staff/requests?request=${workspace.request.id}`} onClick={(event) => guardNavigation(event, `/staff/requests?request=${workspace.request.id}`)}>{NEXT_STEP_CTA.request}<ArrowRight size={15} aria-hidden="true" /></Link>;
              return nextStepTarget ? <button className="staff-button staff-button--outline quotes-next__cta" type="button" onClick={() => goToNextStep(nextStepTarget)}>{nextStep.cta ?? NEXT_STEP_CTA[nextStepTarget]}<ArrowRight size={15} aria-hidden="true" /></button> : null;
            })()}</div></section>
            <div className="quotes-brief"><div><p className="staff-section-label">Alcance</p><strong>{workspace.request.detail?.projectType ?? 'Sin tipo de proyecto'}</strong><span>{workspace.request.detail?.location ?? 'Sin ubicación'}{workspace.request.detail?.dimensions ? ` · ${workspace.request.detail.dimensions}` : ''}</span></div><div><p className="staff-section-label">Calificación</p><strong>{qualificationLabel(workspace.request.detail?.projectStage, QUOTE_REQUEST_PROJECT_STAGE_LABELS)}</strong><span>{qualificationLabel(workspace.request.detail?.timeline, QUOTE_REQUEST_TIMELINE_LABELS)} · {qualificationLabel(workspace.request.detail?.budgetRange, QUOTE_REQUEST_BUDGET_RANGE_LABELS)}</span></div><div><p className="staff-section-label">Contacto</p><strong>{workspace.request.contact.displayName}</strong><span>{workspace.request.contact.email}</span></div><div><p className="staff-section-label">Moneda</p><strong>{selectedCurrency}</strong><span>{workspace.request.detail?.budgetCents ? `Presupuesto ${moneyLabel(workspace.request.detail.budgetCents, workspace.request.detail.currencyCode)}` : 'Sin presupuesto declarado'}</span></div></div>
            <section className="quotes-builder"><div className="quotes-builder__head"><div><p className="staff-section-label">Composición</p><h3>{currentVersion ? `Versión ${currentVersion.versionNumber} · ${statusLabel(currentVersion.status)}` : 'Primera versión'}</h3>{canEdit && draftLines.length > 0 ? <AutosaveIndicator state={autosaveState} /> : null}</div><PrivateSelect id="quotes-price-list" optionalHint={false} className="quotes-list-select" label="Lista de precios" value={selectedPriceListId} onValueChange={handlePriceListChange} options={priceLists.map((list) => ({ value: list.id, label: `${list.name} · ${list.currencyCode}` }))} placeholder="Selecciona una lista" disabled={(!canEdit && !canStartVersion) || autosaveState === 'conflict'} /><PrivateSelect id="quotes-tax-profile" optionalHint={false} className="quotes-list-select" label="Perfil de IVA" value={selectedTaxProfileId} onValueChange={setSelectedTaxProfileId} options={(workspace?.taxProfiles ?? []).map((profile) => ({ value: profile.id, label: `${profile.name} · ${(profile.ratePercentBasisPoints / 100).toString()}%` }))} placeholder="Selecciona un perfil" disabled={!canEdit && !canStartVersion} />{(canEdit || canStartVersion) && draftLines.some((line) => !line.special) && <button className="staff-button staff-button--outline quotes-reprice-trigger" type="button" disabled={checkingReprice} onClick={() => void checkReprice()}>{checkingReprice ? 'Comprobando…' : 'Verificar precios vigentes'}</button>}</div>
              {autosaveState === 'conflict' && <div className="quotes-conflict" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{autosaveMessage ?? 'La versión cambió desde la última lectura.'}</p><div className="quotes-conflict__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => void reloadDiscardingLocalEdits()}>Recargar con los cambios del servidor</button><button className="staff-button staff-button--danger" type="button" onClick={() => void overwriteWithLocalEdits()}>Mantener mis cambios y sobrescribir</button></div></div>}
              {autosaveState === 'error' && autosaveMessage && <p className="staff-error" role="alert">{autosaveMessage} <button className="quotes-retry-link" type="button" onClick={retryDraftSaveNow}>Reintentar</button></p>}
              <PrivateDialog open={repriceDialogOpen} onClose={() => setRepriceDialogOpen(false)} className="quotes-reprice-dialog" overlayClassName="quotes-reprice-overlay" labelledBy="quotes-reprice-title" describedBy="quotes-reprice-description">
                <div className="quotes-reprice-dialog__head"><h3 id="quotes-reprice-title">Repreciar con la lista vigente</h3><button className="staff-dialog-close" type="button" onClick={() => setRepriceDialogOpen(false)} aria-label="Cerrar repreciado"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-reprice-description" className="quotes-reprice-dialog__copy">Estos conceptos conservan el precio con el que se guardaron. Repreciar los actualiza al precio vigente de <strong>{priceListDetail?.name ?? 'la lista seleccionada'}</strong>; el resto de la propuesta no cambia.</p>
                <ul className="quotes-reprice-lines">{repriceCandidates.map((candidate) => <li key={candidate.id}><span>{candidate.name}</span><span className="quotes-reprice-lines__before">{moneyLabel(candidate.oldPriceMinor, selectedCurrency)}</span><span aria-hidden="true">→</span><span className="quotes-reprice-lines__after">{moneyLabel(candidate.newPriceMinor, selectedCurrency)}</span></li>)}</ul>
                <div className="quotes-reprice-dialog__total"><span>Total de propuesta</span><span className="quotes-reprice-lines__before">{moneyLabel(preview.total, selectedCurrency)}</span><span aria-hidden="true">→</span><span className="quotes-reprice-lines__after">{repriceAfterTotal?.valid ? moneyLabel(repriceAfterTotal.total, selectedCurrency) : 'Revisa las líneas'}</span></div>
                <div className="quotes-reprice-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setRepriceDialogOpen(false)}>Cancelar</button><button className="staff-button staff-button--copper" type="button" onClick={confirmReprice}>Confirmar repreciado</button></div>
              </PrivateDialog>
              {currentVersion && <PrivateDialog open={publishPreflight !== null} onClose={() => { if (!saving) setPublishPreflight(null); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="quotes-preflight-title" describedBy="quotes-preflight-description">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-preflight-title">Confirmar envío al cliente</h3><button className="staff-dialog-close" type="button" onClick={() => setPublishPreflight(null)} disabled={saving} aria-label="Cerrar confirmación"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-preflight-description" className="quotes-preflight-dialog__copy">Esta versión quedará publicada y {workspace?.request.contact.displayName} recibirá un aviso para revisarla. Verifica que todo sea correcto antes de continuar.</p>
                <dl className="quotes-preflight-dialog__facts">
                  <div><dt>Destinatario</dt><dd>{workspace?.request.contact.displayName}<small>{workspace?.request.contact.email}</small></dd></div>
                  <div><dt>Versión</dt><dd>V{currentVersion.versionNumber}</dd></div>
                  <div><dt>Total</dt><dd>{moneyLabel(currentVersion.totalMinor, currentVersion.currencyCode)}</dd></div>
                  <div><dt>Vigencia</dt><dd>{currentVersion.validUntil ? formatDateTime(currentVersion.validUntil) : 'Sin fecha límite definida'}</dd></div>
                  <div><dt>Documento</dt><dd>{publishPreflight?.loading ? 'Consultando…' : publishPreflight?.documentStatus === 'READY' ? 'Listo, ya generado' : 'Se generará y verificará al confirmar'}</dd></div>
                </dl>
                {emptyContentSections.length > 0 && <p className="quotes-action-note">Sin contenido en: {emptyContentSections.join(', ')}. El cliente recibirá la propuesta sin esa sección.</p>}
                <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setPublishPreflight(null)} disabled={saving}>Cancelar</button><button className="staff-button staff-button--copper" type="button" disabled={saving || publishPreflight?.loading} onClick={() => void confirmPublish()}>{saving ? 'Enviando…' : 'Confirmar y enviar'}</button></div>
              </PrivateDialog>}
              {currentVersion && <PrivateDialog open={returnToDraftDialogOpen} onClose={() => { if (!saving) setReturnToDraftDialogOpen(false); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="quotes-return-draft-title" describedBy="quotes-return-draft-description">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-return-draft-title">Volver a borrador</h3><button className="staff-dialog-close" type="button" onClick={() => setReturnToDraftDialogOpen(false)} disabled={saving} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-return-draft-description" className="quotes-preflight-dialog__copy">Esto regresa la versión {currentVersion.versionNumber} a edición. {(hasDiscount || hasSpecialLines) ? 'Cualquier aprobación vigente quedará invalidada y habrá que solicitarla de nuevo. ' : ''}{currentVersion.status === 'EN_REVISION' ? 'El PDF ya generado deja de ser válido; se preparará uno nuevo la próxima vez que se envíe.' : ''}</p>
                <label className="quotes-preflight-field"><span>Motivo (obligatorio, queda en el historial)</span><textarea value={returnToDraftReason} onChange={(event) => setReturnToDraftReason(event.target.value)} maxLength={500} rows={3} required placeholder="Por ejemplo: falta corregir el alcance de una línea." /></label>
                <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setReturnToDraftDialogOpen(false)} disabled={saving}>Cancelar</button><button className="staff-button staff-button--danger" type="button" disabled={saving || !returnToDraftReason.trim()} onClick={() => void confirmReturnToDraft()}>{saving ? 'Guardando…' : 'Confirmar y volver a borrador'}</button></div>
              </PrivateDialog>}
              {currentVersion && <PrivateDialog open={rejectVersionDialogOpen} onClose={() => { if (!saving) setRejectVersionDialogOpen(false); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="quotes-reject-version-title" describedBy="quotes-reject-version-description">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-reject-version-title">Rechazar versión</h3><button className="staff-dialog-close" type="button" onClick={() => setRejectVersionDialogOpen(false)} disabled={saving} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-reject-version-description" className="quotes-preflight-dialog__copy">Esto marca la versión {currentVersion.versionNumber} como rechazada y lo notifica en el portal del cliente. No se puede deshacer; para retomar el trabajo habrá que crear una nueva versión.</p>
                <label className="quotes-preflight-field"><span>Motivo (obligatorio, queda en el historial)</span><textarea value={rejectVersionReason} onChange={(event) => setRejectVersionReason(event.target.value)} maxLength={500} rows={3} required placeholder="Por ejemplo: el cliente no aceptó los términos y no continuará." /></label>
                <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setRejectVersionDialogOpen(false)} disabled={saving}>Cancelar</button><button className="staff-button staff-button--danger" type="button" disabled={saving || !rejectVersionReason.trim()} onClick={() => void confirmRejectVersion()}>{saving ? 'Guardando…' : 'Confirmar y rechazar versión'}</button></div>
              </PrivateDialog>}
              {approvalRequestDialog && currentVersion && <PrivateDialog open onClose={() => { if (!saving) setApprovalRequestDialog(null); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="quotes-request-approval-title" describedBy="quotes-request-approval-description">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-request-approval-title">{approvalRequestDialog === 'DISCOUNT' ? 'Solicitar aprobación del descuento' : 'Solicitar aprobación del concepto especial'}</h3><button className="staff-dialog-close" type="button" onClick={() => setApprovalRequestDialog(null)} disabled={saving} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-request-approval-description" className="quotes-preflight-dialog__copy">Gerencia recibirá un aviso y verá esta versión en su cola. Con el motivo decide más rápido y sin tener que preguntarte.</p>
                <dl className="quotes-preflight-dialog__facts">
                  {approvalRequestDialog === 'DISCOUNT'
                    ? <><div><dt>Descuento más alto</dt><dd>{`${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(Math.max(...currentVersion.lines.map((line) => line.discountBasisPoints), 0) / 100)}%`}</dd></div><div><dt>Descuento total</dt><dd>{moneyLabel(preview.discount, selectedCurrency)}</dd></div></>
                    : <div><dt>Conceptos especiales</dt><dd>{currentVersion.lines.filter((line) => line.catalogItemId === null).map((line) => line.name).join(', ')}</dd></div>}
                  <div><dt>Total de la propuesta</dt><dd>{moneyLabel(preview.total, selectedCurrency)}</dd></div>
                </dl>
                <label className="quotes-preflight-field"><span>Motivo para gerencia (recomendado)</span><textarea value={approvalRequestReason} onChange={(event) => setApprovalRequestReason(event.target.value)} maxLength={500} rows={3} placeholder={approvalRequestDialog === 'DISCOUNT' ? 'Por ejemplo: cliente frecuente, compra por volumen o igualar una cotización de la competencia.' : 'Por ejemplo: condición del sitio que no está en el catálogo y cómo se calculó el precio.'} /></label>
                <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setApprovalRequestDialog(null)} disabled={saving}>Cancelar</button><button className="staff-button staff-button--dark" type="button" disabled={saving} onClick={() => void (approvalRequestDialog === 'DISCOUNT' ? requestDiscountApproval(approvalRequestReason.trim() || undefined) : requestSpecialApproval(approvalRequestReason.trim() || undefined))}>{saving ? 'Enviando…' : 'Enviar a aprobación'}</button></div>
              </PrivateDialog>}
              {rejectApprovalDialog && <PrivateDialog open onClose={() => { if (!saving) setRejectApprovalDialog(null); }} className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay" labelledBy="quotes-reject-approval-title" describedBy="quotes-reject-approval-description">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-reject-approval-title">Rechazar {rejectApprovalDialog.kind === 'DISCOUNT' ? 'el descuento' : 'el concepto especial'}</h3><button className="staff-dialog-close" type="button" onClick={() => setRejectApprovalDialog(null)} disabled={saving} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <p id="quotes-reject-approval-description" className="quotes-preflight-dialog__copy">Este rechazo queda en el historial de la cotización con el motivo exacto que escribas.</p>
                <label className="quotes-preflight-field"><span>Motivo (obligatorio, queda en el historial)</span><textarea value={rejectApprovalReason} onChange={(event) => setRejectApprovalReason(event.target.value)} maxLength={500} rows={3} required placeholder="Por ejemplo: el descuento supera lo autorizado para este cliente." /></label>
                <div className="quotes-preflight-dialog__actions"><button className="staff-button staff-button--outline" type="button" onClick={() => setRejectApprovalDialog(null)} disabled={saving}>Cancelar</button><button className="staff-button staff-button--danger" type="button" disabled={saving || !rejectApprovalReason.trim()} onClick={() => void (rejectApprovalDialog.kind === 'DISCOUNT' ? decideDiscountApproval(rejectApprovalDialog.approvalId, 'REJECTED', rejectApprovalReason.trim()) : decideSpecialApproval(rejectApprovalDialog.approvalId, 'REJECTED', rejectApprovalReason.trim()))}>{saving ? 'Guardando…' : 'Confirmar rechazo'}</button></div>
              </PrivateDialog>}
              <div className="quotes-builder__body">
              <div className="quotes-builder__content">
              <div className="quotes-lines-head"><span>Concepto</span><span>Cantidad</span><span>Precio</span><span>Descuento</span><span>Total</span><span className="sr-only">Acción</span></div>
              <div className="quotes-lines">
                {draftLines.map((line, lineIndex) => { const price = line.catalogItemId ? pricesByItem.get(line.catalogItemId)?.unitPriceMinor : undefined; const linePreview = calculatePreview(line, price); const displayedPrice = line.unitPriceDirty ? line.unitPriceInput : line.snapshotUnitPriceMinor ? moneyInputLabel(line.snapshotUnitPriceMinor) : price ? moneyInputLabel(price) : ''; const previousLine = draftLines[lineIndex - 1]; const currentSection = draftSections.find((section) => section.id === line.sectionId); const showSectionHeader = Boolean(line.sectionId) && line.sectionId !== (previousLine?.sectionId ?? null); const canMoveUp = lineIndex > 0 && draftLines[lineIndex - 1].sectionId === line.sectionId; const canMoveDown = lineIndex < draftLines.length - 1 && draftLines[lineIndex + 1].sectionId === line.sectionId; return <div key={line.id}>{showSectionHeader && currentSection && <div className="quotes-section-header"><strong>{currentSection.title}</strong>{(canEdit || canStartVersion) && <button type="button" className="quotes-section-header__remove" onClick={() => removeSection(currentSection.id)}>Quitar sección</button>}</div>}<div className={`quotes-line${line.special ? ' quotes-line--special' : ''}`}><div className="quotes-line__item">{line.special ? <div className="quotes-line__special"><input aria-label="Nombre del concepto especial" value={line.catalogItemName} onChange={(event) => updateLine(line.id, 'catalogItemName', event.target.value)} disabled={!canEdit && !canStartVersion} placeholder="Nombre" maxLength={180} /><input aria-label="Unidad del concepto especial" value={line.unit} onChange={(event) => updateLine(line.id, 'unit', event.target.value)} disabled={!canEdit && !canStartVersion} placeholder="Unidad" maxLength={40} /><small><strong>Especial</strong>{line.reason ? ` · ${line.reason}` : ''}</small></div> : <><strong>{line.catalogItemName}</strong><small>{line.catalogItemCode} · {line.unit}</small>{line.manualReason && <small className="quotes-line__manual"><strong>Precio manual</strong> · {line.manualReason}</small>}{line.pricePending && <small className="quotes-line__pending"><strong>Por cotizar</strong> · sin precio en la lista</small>}</>}{(canEdit || canStartVersion) && draftSections.length > 0 && <select aria-label={`Sección de ${line.catalogItemName}`} className="quotes-line__section-select" value={line.sectionId ?? ''} onChange={(event) => updateLineSection(line.id, event.target.value)}><option value="">Sin sección</option>{draftSections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select>}</div><label><span className="quotes-mobile-label">Cantidad</span><input aria-label={`Cantidad de ${line.catalogItemName}`} value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', event.target.value)} disabled={!canEdit && !canStartVersion} inputMode="decimal" /></label>{line.pricePending ? <div className="quotes-line__price-pending"><span className="quotes-mobile-label">Precio</span><span className="quotes-line__pending-badge">Por cotizar</span>{(canEdit || canStartVersion) && (capabilities?.quotesEditPrices || (capabilities?.pricesManage && listDetailReady)) && <button className="quotes-line__pending-action" type="button" aria-label={`Definir precio de ${line.catalogItemName}`} onClick={() => openPricingForLine(line)}>Definir precio</button>}</div> : <label><span className="quotes-mobile-label">Precio</span><input aria-label={`Precio de ${line.catalogItemName}`} value={displayedPrice} onChange={(event) => setDraftLines((lines) => lines.map((candidate) => candidate.id === line.id ? { ...candidate, unitPriceInput: event.target.value, unitPriceMinorOverride: parseMoneyInput(event.target.value) ?? '', unitPriceDirty: true } : candidate))} disabled={(!canEdit && !canStartVersion) || !capabilities?.quotesEditPrices} placeholder={price ? moneyInputLabel(price) : 'Sin precio'} inputMode="decimal" /></label>}<label><span className="quotes-mobile-label">Desc. %</span><input aria-label={`Descuento de ${line.catalogItemName}`} value={line.discountBasisPoints === '0' ? '' : (Number(line.discountBasisPoints) / 100).toString()} onChange={(event) => updateLine(line.id, 'discountBasisPoints', event.target.value === '' ? '0' : String(Math.round(Number(event.target.value) * 100)))} disabled={(!canEdit && !canStartVersion) || !capabilities?.quotesApplyDiscount || line.pricePending} inputMode="decimal" placeholder="0" /></label><strong className="quotes-line__total">{!line.pricePending && linePreview ? moneyLabel(linePreview.total, selectedCurrency) : '—'}</strong><div className="quotes-line__actions"><button className="quotes-line__move" type="button" aria-label={`Mover ${line.catalogItemName} hacia arriba`} onClick={() => moveLine(lineIndex, -1)} disabled={(!canEdit && !canStartVersion) || !canMoveUp}><ChevronUp size={14} aria-hidden="true" /></button><button className="quotes-line__move" type="button" aria-label={`Mover ${line.catalogItemName} hacia abajo`} onClick={() => moveLine(lineIndex, 1)} disabled={(!canEdit && !canStartVersion) || !canMoveDown}><ChevronDown size={14} aria-hidden="true" /></button><button className="quotes-line__remove" type="button" aria-label={`Quitar ${line.catalogItemName}`} onClick={() => setDraftLines((lines) => lines.filter((candidate) => candidate.id !== line.id))} disabled={!canEdit && !canStartVersion}><X size={16} aria-hidden="true" /></button></div></div></div>; })}
                {draftLines.length === 0 && <div className="quotes-lines__empty"><strong>Aún no hay conceptos.</strong><span>Agrega los servicios que componen esta propuesta.</span></div>}
              </div>
              {pendingPriceCount > 0 && <p className="quotes-manual-note quotes-manual-note--pending" role="status"><strong>{pendingPriceCount} {pendingPriceCount === 1 ? 'concepto por cotizar' : 'conceptos por cotizar'}</strong> — {pendingPriceCount === 1 ? 'no suma' : 'no suman'} al total. Define {pendingPriceCount === 1 ? 'su' : 'sus'} precio, o espera a que se asigne en el Catálogo, para pasar a revisión.</p>}
              {manualPriceCount > 0 && <p className="quotes-manual-note" role="status"><strong>{manualPriceCount} {manualPriceCount === 1 ? 'concepto con precio manual' : 'conceptos con precio manual'}</strong> — fuera de {priceListDetail?.name ?? 'la lista'}; el precio aplica sólo a esta cotización.</p>}
              {(canEdit || canStartVersion) && <div className="quotes-add-line"><CatalogItemSearchCombobox priceListId={selectedPriceListId} currencyCode={selectedCurrency} excludeIds={draftLines.map((line) => line.catalogItemId).filter((id): id is string => id !== null)} disabled={!selectedPriceListId} onSelect={(item) => addLineFromSearch(item)} onDefinePrice={openPricing} definePriceLabel={capabilities?.quotesEditPrices || capabilities?.pricesManage ? 'Definir precio' : 'Por cotizar'} definePriceHint={capabilities?.quotesEditPrices || capabilities?.pricesManage ? 'elige uno para definir su precio aquí mismo' : 'puedes agregarlos como por cotizar'} definingPrice={Boolean(pricingTarget)} /><button className="staff-button staff-button--outline" type="button" onClick={() => setShowSpecialForm(true)}>Agregar concepto especial</button><button className="staff-button staff-button--outline" type="button" onClick={() => setShowSectionForm(true)}>Agregar sección</button></div>}
              {(canEdit || canStartVersion) && pricingTarget && <QuotePricingDialog item={pricingTarget.item} priceListName={listDetailReady ? priceListDetail?.name ?? 'la lista seleccionada' : 'la lista seleccionada'} currencyCode={selectedCurrency} canSetQuotePrice={Boolean(capabilities?.quotesEditPrices)} canSaveToList={Boolean(capabilities?.pricesManage && listDetailReady)} canLeavePending={!pricingTarget.existing} forExistingLine={pricingTarget.existing} busy={pricingBusy} error={pricingError} onSubmit={(submission) => void submitPricing(submission)} onClose={closePricing} />}
              {(canEdit || canStartVersion) && showSpecialForm && <PrivateDialog open onClose={() => setShowSpecialForm(false)} labelledBy="quotes-special-dialog-title" className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-special-dialog-title">Agregar concepto especial</h3><button className="staff-dialog-close" type="button" onClick={() => setShowSpecialForm(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <form className="catalog-form" onSubmit={addSpecialLine}><label><span>Nombre</span><input required value={specialForm.name} onChange={(event) => setSpecialForm({ ...specialForm, name: event.target.value })} placeholder="Concepto fuera de catálogo" maxLength={180} /></label><label><span>Unidad</span><input required value={specialForm.unit} onChange={(event) => setSpecialForm({ ...specialForm, unit: event.target.value })} placeholder="pieza" maxLength={40} /></label><PrivateMoneyField id="quotes-special-amount" label="Importe del concepto especial" value={specialForm.amountInput} onValueChange={(value) => setSpecialForm({ ...specialForm, amountInput: value })} placeholder="1,250.00" /><label><span>Motivo</span><input required value={specialForm.reason} onChange={(event) => setSpecialForm({ ...specialForm, reason: event.target.value })} placeholder="Por qué no está en catálogo" maxLength={300} /></label><label><span>Descripción</span><textarea rows={2} value={specialForm.description} onChange={(event) => setSpecialForm({ ...specialForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit">Agregar a la propuesta</button></form>
              </PrivateDialog>}
              {(canEdit || canStartVersion) && showSectionForm && <PrivateDialog open onClose={() => setShowSectionForm(false)} labelledBy="quotes-section-dialog-title" className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-section-dialog-title">Agregar sección</h3><button className="staff-dialog-close" type="button" onClick={() => setShowSectionForm(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <form className="catalog-form" onSubmit={addSection}><label><span>Título de la sección</span><input required value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} placeholder="Por ejemplo: Alberca" maxLength={180} /></label><label><span>Descripción (opcional)</span><textarea rows={2} value={sectionForm.description} onChange={(event) => setSectionForm({ ...sectionForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit">Crear sección</button></form>
              </PrivateDialog>}
              <details className="quotes-content"><summary>Contenido de la propuesta (alcance, exclusiones, pago, garantías, notas)<span className={`quotes-content__count${contentFilledCount === 5 ? ' is-complete' : ''}`}>{contentFilledCount} de 5 con texto</span></summary><label><span>Alcance</span><textarea value={contentFields.scopeText} onChange={(event) => setContentFields((current) => ({ ...current, scopeText: event.target.value }))} disabled={!canEdit && !canStartVersion} rows={3} maxLength={10000} placeholder="Qué incluye esta propuesta" /></label><label><span>Exclusiones</span><textarea value={contentFields.exclusionsText} onChange={(event) => setContentFields((current) => ({ ...current, exclusionsText: event.target.value }))} disabled={!canEdit && !canStartVersion} rows={3} maxLength={10000} placeholder="Qué no incluye" /></label><label><span>Condiciones de pago</span><textarea value={contentFields.paymentTermsText} onChange={(event) => setContentFields((current) => ({ ...current, paymentTermsText: event.target.value }))} disabled={!canEdit && !canStartVersion} rows={3} maxLength={10000} placeholder="Anticipo, contra entrega, etc." /></label><label><span>Garantías</span><textarea value={contentFields.warrantyText} onChange={(event) => setContentFields((current) => ({ ...current, warrantyText: event.target.value }))} disabled={!canEdit && !canStartVersion} rows={3} maxLength={10000} placeholder="Por ejemplo: estructura, equipos e impermeabilización, con su plazo" /></label><label><span>Notas públicas</span><textarea value={contentFields.publicNotesText} onChange={(event) => setContentFields((current) => ({ ...current, publicNotesText: event.target.value }))} disabled={!canEdit && !canStartVersion} rows={3} maxLength={10000} placeholder="Visibles para el cliente en la propuesta y el PDF" /></label></details>
              </div>
              <aside className="quotes-builder__side">
              <button type="button" className="quotes-summary-toggle" aria-expanded={!summaryCollapsed} onClick={() => setSummaryCollapsed((current) => !current)}>{summaryCollapsed ? 'Mostrar resumen' : 'Ocultar resumen'}<ChevronDown size={14} aria-hidden="true" /></button>
              <div className="quotes-summary" data-collapsed={summaryCollapsed}><div><span>Subtotal</span><strong>{moneyLabel(preview.subtotal, selectedCurrency)}</strong></div><div><span>Descuentos</span><strong>− {moneyLabel(preview.discount, selectedCurrency)}</strong></div><div><span>Impuestos</span><strong>{moneyLabel(preview.tax, selectedCurrency)}</strong></div>{pendingPriceCount > 0 && <div><span>Por cotizar</span><strong>{pendingPriceCount} sin precio</strong></div>}<div className="quotes-summary__total"><span>Total de propuesta</span><strong>{preview.valid ? moneyLabel(preview.total, selectedCurrency) : 'Revisa las líneas'}</strong></div></div>
              </aside>
              </div>
              {draftLines.length > 0 && <button type="button" className="quotes-mobile-total-bar" onClick={() => document.getElementById('quotes-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span>Total<strong>{preview.valid ? moneyLabel(preview.total, selectedCurrency) : 'Revisa las líneas'}</strong></span><span className="quotes-mobile-total-bar__cta">Ver acciones<ChevronDown size={14} aria-hidden="true" /></span></button>}
              {remoteChange && <div className="quotes-remote-note" role="status"><span>Hay cambios nuevos en esta cotización; guarda para verlos.</span>{autosaveState === 'saved' && !remoteLoadBlocked && selectedId ? <button type="button" className="staff-button staff-button--outline" onClick={() => void loadWorkspace(selectedId, { silent: true })}>Actualizar</button> : null}</div>}<div className="quotes-actions" id="quotes-actions" tabIndex={-1}><PrivateDatePicker id="quotes-valid-until" label="Vigencia hasta" value={validUntil} onValueChange={setValidUntil} disabled={!canEdit && !canStartVersion} />{canEdit ? <button className="staff-button staff-button--dark" type="button" disabled={autosaveState === 'saving' || autosaveState === 'saved' || !preview.valid || draftLines.length === 0 || !selectedPriceListId} onClick={() => void persistDraft()}>{autosaveState === 'saving' ? 'Guardando…' : 'Guardar ahora'}</button> : null}{canStartVersion ? <button className="staff-button staff-button--dark" type="button" disabled={saving || !preview.valid || draftLines.length === 0 || !selectedPriceListId} onClick={() => void createVersionFromSent()}>{saving ? 'Creando…' : 'Crear nueva versión'}</button> : null}{(currentVersion?.status === 'ENVIADA' || currentVersion?.status === 'EN_NEGOCIACION') && capabilities?.quotesSend ? <button className="staff-button staff-button--outline" type="button" disabled={saving} onClick={() => { setRejectVersionReason(''); setRejectVersionDialogOpen(true); }}>Rechazar versión</button> : null}{currentVersion?.status === 'BORRADOR' && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || autosaveState === 'saving' || autosaveState === 'dirty' || autosaveState === 'conflict' || draftLines.length === 0 || pendingPriceCount > 0} title={pendingPriceCount > 0 ? 'Hay conceptos por cotizar: define su precio antes de pasar a revisión.' : undefined} onClick={() => void transition('EN_REVISION')}>Pasar a revisión</button> : null}{currentVersion?.status === 'EN_REVISION' && capabilities?.quotesCreate ? <button className="staff-button staff-button--outline" type="button" disabled={saving} onClick={() => { setReturnToDraftReason(''); setReturnToDraftDialogOpen(true); }}>Volver a borrador</button> : null}{currentVersion?.status === 'EN_REVISION' && requiresDiscountApproval && !hasApprovedDiscount && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || Boolean(activeDiscountApproval)} onClick={() => openApprovalRequest('DISCOUNT')}>{activeDiscountApproval?.status === 'REQUESTED' ? 'Aprobación solicitada' : 'Solicitar aprobación'}</button> : null}{currentVersion?.status === 'EN_REVISION' && hasDiscount && activeDiscountApproval?.status === 'REQUESTED' && capabilities?.quotesApproveDiscount ? <><button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void decideDiscountApproval(activeDiscountApproval.id, 'APPROVED')}>Aprobar descuento</button><button className="staff-button staff-button--danger" type="button" disabled={saving} onClick={() => { setRejectApprovalReason(''); setRejectApprovalDialog({ kind: 'DISCOUNT', approvalId: activeDiscountApproval.id }); }}>Rechazar</button></> : null}{currentVersion?.status === 'EN_REVISION' && hasSpecialLines && !hasApprovedSpecial && capabilities?.quotesCreate ? <button className="staff-button" type="button" disabled={saving || Boolean(activeSpecialApproval)} onClick={() => openApprovalRequest('SPECIAL_CONCEPT')}>{activeSpecialApproval?.status === 'REQUESTED' ? 'Aprobación solicitada' : 'Solicitar aprobación de concepto especial'}</button> : null}{currentVersion?.status === 'EN_REVISION' && hasSpecialLines && activeSpecialApproval?.status === 'REQUESTED' && capabilities?.quotesApproveDiscount ? <><button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void decideSpecialApproval(activeSpecialApproval.id, 'APPROVED')}>Aprobar concepto especial</button><button className="staff-button staff-button--danger" type="button" disabled={saving} onClick={() => { setRejectApprovalReason(''); setRejectApprovalDialog({ kind: 'SPECIAL_CONCEPT', approvalId: activeSpecialApproval.id }); }}>Rechazar</button></> : null}{currentVersion?.status === 'EN_REVISION' && canPublish && (!requiresDiscountApproval || hasApprovedDiscount) && (!hasSpecialLines || hasApprovedSpecial) ? <button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void openPublishPreflight()}>Enviar cotización</button> : null}{currentVersion?.status === 'EN_REVISION' && capabilities?.quotesSend && !capabilities.quotesPdfGenerate ? <p className="quotes-action-note">Tu perfil puede enviar, pero necesita permiso para preparar el PDF comercial.</p> : null}{currentVersion?.status === 'EN_REVISION' && requiresDiscountApproval ? <p className="quotes-action-note">{discountApproval ? `${approvalStatusLabel(discountApproval.status)}${discountApproval.status === 'REJECTED' && discountApproval.reason ? `: «${discountApproval.reason.trim().replace(/[.\s]+$/u, '')}»` : ''}. ` : ''}{hasApprovedDiscount ? 'La versión tiene una aprobación vigente.' : 'Esta versión no puede enviarse hasta contar con una aprobación vigente.'}</p> : null}{currentVersion?.status === 'EN_REVISION' && hasSpecialLines ? <p className="quotes-action-note">{specialApproval ? `${approvalStatusLabel(specialApproval.status)}${specialApproval.status === 'REJECTED' && specialApproval.reason ? `: «${specialApproval.reason.trim().replace(/[.\s]+$/u, '')}»` : ''}. ` : ''}{hasApprovedSpecial ? 'Los conceptos especiales tienen una aprobación vigente.' : 'Esta versión tiene conceptos especiales y no puede enviarse hasta contar con una aprobación vigente.'}</p> : null}</div>
              {hasDiscount && currentVersion?.approvals.length ? <div className="quotes-approval-summary" aria-label="Historial de aprobación de descuento"><strong>Control de descuento</strong>{currentVersion.approvals.filter((approval) => approval.type === 'DISCOUNT').slice(0, 3).map((approval) => <span key={approval.id}>{approvalStatusLabel(approval.status)} · {formatDateTime(approval.requestedAt)}</span>)}</div> : null}
              {hasSpecialLines && currentVersion?.approvals.length ? <div className="quotes-approval-summary" aria-label="Historial de aprobación de conceptos especiales"><strong>Control de concepto especial</strong>{currentVersion.approvals.filter((approval) => approval.type === 'SPECIAL_CONCEPT').slice(0, 3).map((approval) => <span key={approval.id}>{approvalStatusLabel(approval.status)} · {formatDateTime(approval.requestedAt)}</span>)}</div> : null}
            </section>
            {currentVersion && <StaffQuoteDocumentPanel key={`${currentVersion.id}-${workspace.project?.id ?? 'sin-proyecto'}`} versionId={currentVersion.id} versionNumber={currentVersion.versionNumber} canRead={Boolean(capabilities?.quotesPdfRead)} canGenerate={Boolean(capabilities?.quotesPdfGenerate)} canReadProject={Boolean(capabilities?.projectsRead)} canCreateProject={Boolean(capabilities?.projectsCreate)} />}
            {workspace.request.detail?.description && <section className="quotes-scope"><p className="staff-section-label">Alcance compartido</p><p>{workspace.request.detail.description}</p></section>}
            <section className="quotes-history"><div><p className="staff-section-label">Trazabilidad</p><h3>Historial de versiones</h3></div><ol>{workspace.quote?.versions.map((version) => <li key={version.id}><span className="quotes-history__mark">V{version.versionNumber}</span><div><strong>{statusLabel(version.status)}</strong><span>{moneyLabel(version.totalMinor, version.currencyCode)} · {version.createdBy.displayName}</span><time dateTime={version.createdAt}>{formatDateTime(version.createdAt)}</time></div></li>) ?? <li className="quotes-history__empty">Todavía no hay versiones guardadas.</li>}</ol></section>
          </>}
        </section>
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
