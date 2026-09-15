'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import DateField from '@/components/DateField';
import SelectField from '@/components/SelectField';
import MoneyField from '@/components/MoneyField';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { parseMoneyInput } from '@/lib/money-input';

const CATALOG_UNIT_OPTIONS = ['pieza', 'servicio', 'hora', 'visita', 'm²', 'm³', 'lote', 'kit', 'mes'] as const;
const CATALOG_UNIT_CUSTOM = '__otra__';

function categoryDescendantIds(categoryId: string, categories: Category[]): Set<string> {
  const result = new Set<string>();
  let frontier = [categoryId];
  while (frontier.length) {
    const next = categories.filter((entry) => entry.parentId && frontier.includes(entry.parentId)).map((entry) => entry.id);
    for (const id of next) result.add(id);
    frontier = next;
  }
  return result;
}

function buildCategoryTreeOrder(categories: Category[]): Array<{ category: Category; depth: number }> {
  const byParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const key = category.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(category);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const result: Array<{ category: Category; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      result.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const category of categories) if (!seen.has(category.id)) result.push({ category, depth: 0 });
  return result;
}

type Category = { id: string; code: string; name: string; description: string | null; status: string; sortOrder: number; parentId: string | null };
type CatalogItem = { id: string; code: string; name: string; description: string | null; unit: string; status: string; category: { id: string; code: string; name: string } | null; createdAt: string; updatedAt: string };
type PriceList = { id: string; code: string; name: string; currencyCode: string; status: string; validFrom: string; validUntil: string | null; _count: { items: number } };
type PriceListDetail = PriceList & { items: Array<{ id: string; catalogItemId: string; unitPriceMinor: string; validFrom: string; validUntil: string | null; catalogItem: { code: string; name: string; unit: string; status: string } }> };
type ListResponse = { items: CatalogItem[]; page: number; pageSize: number; total: number; totalPages: number };
type Capabilities = { catalogRead: boolean; catalogManage: boolean; pricesRead: boolean; pricesManage: boolean };
type SpecialConceptGroup = { normalizedName: string; unit: string; name: string; occurrences: number; recentFolios: string[]; status: 'PENDING' | 'MATCHES_EXISTING' | 'PROMOTED'; matchingCatalogItem: { id: string; code: string; name: string } | null };
type ErrorResponse = { error?: { message?: string } };

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'No fue posible completar la operación.');
  return data as T;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function moneyLabel(minor: string, currency: string): string {
  const normalized = minor.padStart(3, '0');
  const whole = normalized.slice(0, -2);
  const fraction = normalized.slice(-2);
  return `${currency} ${new Intl.NumberFormat('es-MX').format(BigInt(whole))}.${fraction}`;
}

export default function StaffCatalogPanel() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListDetail, setPriceListDetail] = useState<PriceListDetail | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({ catalogRead: false, catalogManage: false, pricesRead: false, pricesManage: false });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedPriceListId, setSelectedPriceListId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [showPriceListForm, setShowPriceListForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [itemForm, setItemForm] = useState({ code: '', useManualCode: false, name: '', unitPreset: 'pieza', unitCustom: '', description: '', categoryId: '' });
  const [priceListForm, setPriceListForm] = useState({ code: '', name: '', currencyCode: 'MXN' });
  const [priceForm, setPriceForm] = useState({ catalogItemId: '', amountInput: '', effectiveFrom: '', reason: '' });
  const [categoryForm, setCategoryForm] = useState({ code: '', useManualCode: false, name: '', description: '', sortOrder: '0', parentId: '' });
  const [editingItem, setEditingItem] = useState(false);
  const [itemEditForm, setItemEditForm] = useState({ name: '', description: '', unitPreset: 'pieza', unitCustom: '', categoryId: '' });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryEditForm, setCategoryEditForm] = useState({ name: '', description: '', sortOrder: '0', parentId: '' });
  const [editingPriceList, setEditingPriceList] = useState(false);
  const [priceListEditForm, setPriceListEditForm] = useState({ name: '' });
  const [showSpecialConcepts, setShowSpecialConcepts] = useState(false);
  const [specialConcepts, setSpecialConcepts] = useState<SpecialConceptGroup[] | null>(null);
  const [loadingSpecialConcepts, setLoadingSpecialConcepts] = useState(false);
  const [specialConceptCategoryId, setSpecialConceptCategoryId] = useState<Record<string, string>>({});

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId]);
  const previewItem = useMemo(() => priceListDetail?.items.find((price) => price.catalogItemId === priceForm.catalogItemId && price.validUntil === null) ?? null, [priceListDetail, priceForm.catalogItemId]);
  const previewText = !priceForm.catalogItemId ? '' : previewItem ? `Se cerrará el precio vigente de ${moneyLabel(previewItem.unitPriceMinor, priceListDetail!.currencyCode)} (desde ${formatDate(previewItem.validFrom)}) el día que elijas abajo.` : 'Este concepto no tiene un precio vigente en esta lista; se creará el primero.';
  const priceGroups = useMemo(() => {
    const groups = { actuales: [] as PriceListDetail['items'], futuros: [] as PriceListDetail['items'], historicos: [] as PriceListDetail['items'] };
    if (!priceListDetail) return groups;
    const now = Date.now();
    for (const price of priceListDetail.items) {
      const from = new Date(price.validFrom).getTime();
      const until = price.validUntil ? new Date(price.validUntil).getTime() : null;
      if (from > now) groups.futuros.push(price);
      else if (until !== null && until <= now) groups.historicos.push(price);
      else groups.actuales.push(price);
    }
    groups.futuros = [...groups.futuros].reverse();
    return groups;
  }, [priceListDetail]);
  const categoryTreeOrder = useMemo(() => buildCategoryTreeOrder(categories), [categories]);

  const loadCatalog = useCallback(async (currentPage: number, query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '25' });
      if (!showArchived) params.set('status', 'ACTIVE');
      if (query) params.set('query', query);
      const statusSuffix = showArchived ? '' : '?status=ACTIVE';
      const [itemsResponse, categoriesResponse, listsResponse, capabilitiesResponse] = await Promise.all([
        fetch(`/api/staff/catalog/items?${params.toString()}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/staff/catalog/categories${statusSuffix}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/staff/catalog/price-lists${statusSuffix}`, { credentials: 'include', cache: 'no-store' }),
        fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store' }),
      ]);
      const [itemsData, categoriesData, listsData, capabilitiesData] = await Promise.all([
        readResponse<ListResponse>(itemsResponse),
        readResponse<Category[]>(categoriesResponse),
        readResponse<PriceList[]>(listsResponse),
        readResponse<Capabilities>(capabilitiesResponse),
      ]);
      setItems(itemsData.items);
      setCategories(categoriesData);
      setPriceLists(listsData);
      setCapabilities(capabilitiesData);
      setTotal(itemsData.total);
      setTotalPages(Math.max(itemsData.totalPages, 1));
      setAccessDenied(false);
      setSelectedItemId((current) => current ?? itemsData.items[0]?.id ?? null);
      setSelectedPriceListId((current) => current ?? listsData[0]?.id ?? null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el catálogo.';
      setAccessDenied(message.includes('autenticada') || message.includes('permisos'));
      setError(message);
      setItems([]);
      setPriceLists([]);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const loadPriceList = useCallback(async (priceListId: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/staff/catalog/price-lists/${priceListId}`, { credentials: 'include', cache: 'no-store' });
      setPriceListDetail(await readResponse<PriceListDetail>(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la lista de precios.');
      setPriceListDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { void loadCatalog(page, appliedSearch); }, [appliedSearch, loadCatalog, page]);
  useEffect(() => { if (selectedPriceListId) void loadPriceList(selectedPriceListId); else setPriceListDetail(null); }, [loadPriceList, selectedPriceListId]);
  useEffect(() => { if (!priceForm.catalogItemId && selectedItemId) setPriceForm((current) => ({ ...current, catalogItemId: selectedItemId })); }, [priceForm.catalogItemId, selectedItemId]);

  const refresh = async () => {
    await loadCatalog(page, appliedSearch);
    if (selectedPriceListId) await loadPriceList(selectedPriceListId);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); };

  const createItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const unit = itemForm.unitPreset === CATALOG_UNIT_CUSTOM ? itemForm.unitCustom.trim() : itemForm.unitPreset;
      const response = await fetch('/api/staff/catalog/items', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: itemForm.useManualCode ? itemForm.code : undefined, name: itemForm.name, unit, description: itemForm.description || undefined, categoryId: itemForm.categoryId || undefined }) });
      const created = await readResponse<CatalogItem>(response);
      setNotice(`Concepto ${created.code} creado.`); setItemForm({ code: '', useManualCode: false, name: '', unitPreset: 'pieza', unitCustom: '', description: '', categoryId: '' }); setShowItemForm(false); await refresh(); setSelectedItemId(created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear el concepto.'); }
    finally { setSaving(false); }
  };

  const startEditItem = () => {
    if (!selectedItem) return;
    const isPreset = (CATALOG_UNIT_OPTIONS as readonly string[]).includes(selectedItem.unit);
    setItemEditForm({ name: selectedItem.name, description: selectedItem.description ?? '', unitPreset: isPreset ? selectedItem.unit : CATALOG_UNIT_CUSTOM, unitCustom: isPreset ? '' : selectedItem.unit, categoryId: selectedItem.category?.id ?? '' });
    setEditingItem(true);
  };

  const saveItemEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const unit = itemEditForm.unitPreset === CATALOG_UNIT_CUSTOM ? itemEditForm.unitCustom.trim() : itemEditForm.unitPreset;
      await readResponse(await fetch(`/api/staff/catalog/items/${selectedItem.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: itemEditForm.name, description: itemEditForm.description || null, unit, categoryId: itemEditForm.categoryId || null }) }));
      setNotice('Concepto actualizado.'); setEditingItem(false); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el concepto.'); }
    finally { setSaving(false); }
  };

  const toggleItemStatus = async () => {
    if (!selectedItem) return; setSaving(true); setError(null); setNotice(null);
    const nextStatus = selectedItem.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await readResponse(await fetch(`/api/staff/catalog/items/${selectedItem.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) }));
      setNotice(nextStatus === 'ARCHIVED' ? 'Concepto archivado.' : 'Concepto reactivado.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el concepto.'); }
    finally { setSaving(false); }
  };

  const createCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/staff/catalog/categories', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: categoryForm.useManualCode ? categoryForm.code : undefined, name: categoryForm.name, description: categoryForm.description || undefined, sortOrder: Number(categoryForm.sortOrder) || 0, parentId: categoryForm.parentId || undefined }) });
      const created = await readResponse<Category>(response);
      setNotice(`Categoría ${created.code} creada.`); setCategoryForm({ code: '', useManualCode: false, name: '', description: '', sortOrder: '0', parentId: '' }); setShowCategoryForm(false); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear la categoría.'); }
    finally { setSaving(false); }
  };

  const startEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryEditForm({ name: category.name, description: category.description ?? '', sortOrder: String(category.sortOrder), parentId: category.parentId ?? '' });
  };

  const saveCategoryEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCategoryId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await readResponse(await fetch(`/api/staff/catalog/categories/${editingCategoryId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: categoryEditForm.name, description: categoryEditForm.description || null, sortOrder: Number(categoryEditForm.sortOrder) || 0, parentId: categoryEditForm.parentId || null }) }));
      setNotice('Categoría actualizada.'); setEditingCategoryId(null); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la categoría.'); }
    finally { setSaving(false); }
  };

  const toggleCategoryStatus = async (category: Category) => {
    setSaving(true); setError(null); setNotice(null);
    const nextStatus = category.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await readResponse(await fetch(`/api/staff/catalog/categories/${category.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) }));
      setNotice(nextStatus === 'ARCHIVED' ? 'Categoría archivada.' : 'Categoría reactivada.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la categoría.'); }
    finally { setSaving(false); }
  };

  const startEditPriceList = () => {
    if (!priceListDetail) return;
    setPriceListEditForm({ name: priceListDetail.name });
    setEditingPriceList(true);
  };

  const savePriceListEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPriceListId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await readResponse(await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: priceListEditForm.name }) }));
      setNotice('Lista actualizada.'); setEditingPriceList(false); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la lista.'); }
    finally { setSaving(false); }
  };

  const togglePriceListStatus = async () => {
    if (!selectedPriceListId || !priceListDetail) return;
    setSaving(true); setError(null); setNotice(null);
    const nextStatus = priceListDetail.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await readResponse(await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) }));
      setNotice(nextStatus === 'ARCHIVED' ? 'Lista archivada.' : 'Lista reactivada.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la lista.'); }
    finally { setSaving(false); }
  };

  const createPriceList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/staff/catalog/price-lists', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...priceListForm, validFrom: new Date().toISOString() }) });
      const created = await readResponse<PriceList>(response);
      setNotice(`Lista ${created.code} creada.`); setPriceListForm({ code: '', name: '', currencyCode: 'MXN' }); setShowPriceListForm(false); await refresh(); setSelectedPriceListId(created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear la lista.'); }
    finally { setSaving(false); }
  };

  const schedulePriceForItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPriceListId) return;
    if (!priceForm.effectiveFrom) { setError('Selecciona la fecha desde la que aplica el precio.'); return; }
    const unitPriceMinor = parseMoneyInput(priceForm.amountInput);
    if (!unitPriceMinor) { setError('Escribe un importe válido, por ejemplo 1250.00.'); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await readResponse(await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}/schedule`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          catalogItemId: priceForm.catalogItemId,
          unitPriceMinor,
          effectiveFrom: new Date(`${priceForm.effectiveFrom}T00:00:00.000Z`).toISOString(),
          ...(priceForm.reason.trim() ? { reason: priceForm.reason.trim() } : {}),
        }),
      }));
      setNotice('Precio programado.');
      setPriceForm((current) => ({ ...current, amountInput: '', reason: '' }));
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible programar el precio.'); }
    finally { setSaving(false); }
  };

  const loadSpecialConcepts = async () => {
    setLoadingSpecialConcepts(true); setError(null);
    try {
      const response = await fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' });
      setSpecialConcepts(await readResponse<SpecialConceptGroup[]>(response));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible cargar los conceptos especiales.'); }
    finally { setLoadingSpecialConcepts(false); }
  };

  const toggleSpecialConcepts = () => {
    const next = !showSpecialConcepts;
    setShowSpecialConcepts(next);
    if (next && specialConcepts === null) void loadSpecialConcepts();
  };

  const promoteGroup = async (group: SpecialConceptGroup) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const key = `${group.normalizedName}::${group.unit}`;
      const categoryId = specialConceptCategoryId[key];
      const response = await fetch('/api/staff/catalog/special-concepts/promote', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: group.name, unit: group.unit, categoryId: categoryId || undefined }) });
      const result = await readResponse<{ catalogItem: { id: string; code: string; name: string }; alreadyPromoted: boolean }>(response);
      setNotice(`Concepto ${result.catalogItem.code} · ${result.catalogItem.name} vinculado.`);
      await loadSpecialConcepts();
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible promover el concepto.'); }
    finally { setSaving(false); }
  };

  if (accessDenied) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><section className="staff-empty"><WorkspaceLogo className="staff-empty__logo" /><p className="staff-kicker">Área interna</p><h1>Acceso restringido.</h1><p>Inicia sesión con una cuenta de empleado autorizada para consultar el catálogo.</p><div className="staff-empty__actions"><Link className="staff-button staff-button--dark" href="/login">Iniciar sesión</Link><Link className="staff-empty__link" href="/">Volver al sitio</Link></div></section></PrivateSurfaceRoot>;

  return <PrivateSurfaceRoot className="staff-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Catálogo y precios</div></div></header>
    <div className="staff-content catalog-content">
      <div className="staff-intro"><div><p className="staff-kicker">Fuente comercial</p><h1>Catálogo</h1><p className="staff-intro__copy">Mantén conceptos y precios claros para que cada cotización nazca de una fuente controlada.</p></div><div className="staff-intro__metric"><strong>{total}</strong><span>conceptos activos</span></div></div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}{error && <p className="staff-error" role="alert">{error}</p>}
      <section className="catalog-workspace" aria-label="Gestión de catálogo y precios">
        <aside className="catalog-rail">
          <form className="staff-filters" onSubmit={submitSearch}><label><span>Buscar concepto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Clave o nombre" maxLength={100} /></label><label className="catalog-filters__toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Mostrar archivados</span></label><button className="staff-button staff-button--filter" type="submit">Buscar</button></form>
          <div className="staff-inbox__head"><span>{loading ? 'Actualizando…' : `${items.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
          <div className="catalog-item-list" aria-live="polite">{loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}{!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark">—</span><h2>Catálogo vacío.</h2><p>Prueba otra búsqueda o agrega el primer concepto.</p></div>}{!loading && items.map((item) => <button className={`catalog-item-row${selectedItemId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedItemId(item.id)}><span className="catalog-item-row__code">{item.code}</span><strong>{item.name}</strong><small>{item.category?.name ?? 'Sin categoría'} · {item.unit}{item.status === 'ARCHIVED' ? ' · Archivado' : ''}</small></button>)}</div>
          <div className="staff-pagination"><button type="button" className="staff-pagination__button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</button><button type="button" className="staff-pagination__button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div>
        </aside>
        <section className="catalog-main">
          <div className="catalog-main__top"><div><p className="staff-section-label">Concepto seleccionado</p>{selectedItem ? <><h2>{selectedItem.name}</h2><p className="catalog-main__meta">{selectedItem.code} · {selectedItem.unit} · actualizado {formatDate(selectedItem.updatedAt)}</p></> : <h2>Selecciona un concepto</h2>}</div>{selectedItem && capabilities.catalogManage && <div className="catalog-main__actions"><button className="staff-button" type="button" disabled={saving} onClick={startEditItem}>Editar</button><button className="staff-button" type="button" disabled={saving} onClick={() => void toggleItemStatus()}>{selectedItem.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button></div>}</div>
          {!selectedItem && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>La fuente antes de la propuesta.</h2><p>Selecciona un concepto para revisar sus precios o crea uno nuevo.</p></div>}
          {selectedItem && !editingItem && <div className="catalog-detail"><p>{selectedItem.description ?? 'Este concepto todavía no tiene descripción.'}</p><dl><div><dt>Categoría</dt><dd>{selectedItem.category?.name ?? 'Sin categoría'}</dd></div><div><dt>Estado</dt><dd>{selectedItem.status === 'ACTIVE' ? 'Activo' : 'Archivado'}</dd></div></dl></div>}
          {selectedItem && editingItem && <form className="catalog-form" onSubmit={saveItemEdit}><label><span>Nombre</span><input required value={itemEditForm.name} onChange={(event) => setItemEditForm({ ...itemEditForm, name: event.target.value })} maxLength={180} /></label><label><span>Unidad</span><SelectField ariaLabel="Unidad (editar concepto)" value={itemEditForm.unitPreset} onValueChange={(value) => setItemEditForm({ ...itemEditForm, unitPreset: value })} options={[...CATALOG_UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })), { value: CATALOG_UNIT_CUSTOM, label: 'Otra…' }]} disabled={saving} /></label>{itemEditForm.unitPreset === CATALOG_UNIT_CUSTOM && <label><span>Unidad personalizada</span><input required value={itemEditForm.unitCustom} onChange={(event) => setItemEditForm({ ...itemEditForm, unitCustom: event.target.value })} maxLength={40} /></label>}<label><span>Categoría</span><SelectField ariaLabel="Categoría (editar concepto)" value={itemEditForm.categoryId} onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} /></label><label><span>Descripción</span><textarea rows={3} value={itemEditForm.description} onChange={(event) => setItemEditForm({ ...itemEditForm, description: event.target.value })} maxLength={2000} /></label><div className="catalog-form__actions"><button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar cambios</button><button className="staff-button" type="button" disabled={saving} onClick={() => setEditingItem(false)}>Cancelar</button></div></form>}
          <section className="catalog-price-panel"><div className="catalog-price-panel__head"><div><p className="staff-section-label">Listas de precio</p><h3>{priceLists.length ? 'Precios vigentes' : 'Todavía no hay listas'}</h3></div>{capabilities.pricesManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowPriceListForm((current) => !current)}>{showPriceListForm ? 'Cerrar' : 'Nueva lista'}</button>}</div>
            {showPriceListForm && capabilities.pricesManage && <form className="catalog-form" onSubmit={createPriceList}><label><span>Clave</span><input required value={priceListForm.code} onChange={(event) => setPriceListForm({ ...priceListForm, code: event.target.value })} placeholder="LISTA-MXN" maxLength={64} /></label><label><span>Nombre</span><input required value={priceListForm.name} onChange={(event) => setPriceListForm({ ...priceListForm, name: event.target.value })} placeholder="Lista residencial" maxLength={180} /></label><label><span>Moneda</span><input required value={priceListForm.currencyCode} onChange={(event) => setPriceListForm({ ...priceListForm, currencyCode: event.target.value.toUpperCase() })} maxLength={3} /></label><button className="staff-button staff-button--dark" type="submit" disabled={saving}>Crear lista</button></form>}
            <div className="catalog-list-picker">{priceLists.map((list) => <button className={`catalog-list-row${selectedPriceListId === list.id ? ' is-selected' : ''}`} type="button" key={list.id} onClick={() => setSelectedPriceListId(list.id)}><span><strong>{list.name}</strong><small>{list.code} · {list.currencyCode} · {list._count.items} conceptos{list.status === 'ARCHIVED' ? ' · Archivada' : ''}</small></span><b>{formatDate(list.validFrom)}</b></button>)}</div>
            {loadingDetail && <div className="catalog-detail-loading"><span /><span /></div>}
            {!loadingDetail && priceListDetail && <>
              <div className="catalog-price-summary"><span>{priceListDetail.name}{priceListDetail.status === 'ARCHIVED' ? ' · Archivada' : ''}</span><strong>{priceListDetail.items.length} precios</strong>{capabilities.pricesManage && !editingPriceList && <div className="catalog-main__actions"><button className="staff-button" type="button" disabled={saving} onClick={startEditPriceList}>Editar</button><button className="staff-button" type="button" disabled={saving} onClick={() => void togglePriceListStatus()}>{priceListDetail.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button></div>}</div>
              {editingPriceList && <form className="catalog-form catalog-form--inline" onSubmit={savePriceListEdit}><label><span>Nombre</span><input required value={priceListEditForm.name} onChange={(event) => setPriceListEditForm({ name: event.target.value })} maxLength={180} /></label><div className="catalog-form__actions"><button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar cambios</button><button className="staff-button" type="button" disabled={saving} onClick={() => setEditingPriceList(false)}>Cancelar</button></div></form>}
              {[
                { key: 'actuales', label: 'Vigentes', items: priceGroups.actuales },
                { key: 'futuros', label: 'Programados', items: priceGroups.futuros },
                { key: 'historicos', label: 'Históricos', items: priceGroups.historicos },
              ].map((group) => <div className="catalog-price-group" key={group.key}>
                <div className="catalog-price-group__head"><span>{group.label}</span><span>{group.items.length}</span></div>
                {group.items.length === 0 && <p className="catalog-price-group__empty">Sin precios en este grupo.</p>}
                {group.items.length > 0 && <div className="catalog-price-table" role="table" aria-label={`Precios ${group.label.toLowerCase()}`}><div className="catalog-price-table__head" role="row"><span role="columnheader">Concepto</span><span role="columnheader">Importe</span><span role="columnheader">Vigencia</span></div>{group.items.map((price) => <div className="catalog-price-table__row" role="row" key={price.id}><span role="cell"><strong>{price.catalogItem.name}</strong><small>{price.catalogItem.code} · {price.catalogItem.unit}</small></span><b role="cell">{moneyLabel(price.unitPriceMinor, priceListDetail.currencyCode)}</b><small role="cell">{formatDate(price.validFrom)}{price.validUntil ? ` — ${formatDate(price.validUntil)}` : ' — abierta'}</small></div>)}</div>}
              </div>)}
            </>}
            {capabilities.pricesManage && selectedPriceListId && priceListDetail?.status === 'ACTIVE' && <form className="catalog-form catalog-form--price" onSubmit={schedulePriceForItem}><p className="staff-section-label">Programar precio</p><label><span>Concepto</span><SelectField ariaLabel="Concepto" value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={items.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Selecciona un concepto" disabled={saving} /></label><label><span>Importe</span><MoneyField ariaLabel="Importe" value={priceForm.amountInput} onValueChange={(value) => setPriceForm({ ...priceForm, amountInput: value })} placeholder="1,250.00" required disabled={saving} /></label><label><span>Vigente desde</span><DateField ariaLabel="Vigente desde" value={priceForm.effectiveFrom} onValueChange={(value) => setPriceForm({ ...priceForm, effectiveFrom: value })} disabled={saving} /></label><label><span>Motivo opcional</span><input value={priceForm.reason} onChange={(event) => setPriceForm({ ...priceForm, reason: event.target.value })} placeholder="Ajuste de proveedor" maxLength={300} /></label>{previewText && <p className="catalog-form__preview" aria-live="polite">{previewText}</p>}<button className="staff-button staff-button--dark" type="submit" disabled={saving}>Programar precio</button></form>}
            {capabilities.pricesManage && selectedPriceListId && priceListDetail?.status === 'ARCHIVED' && <p className="catalog-form__note">Esta lista está archivada. Reactívala para poder programar nuevos precios.</p>}
          </section>
          {capabilities.catalogManage && <section className="catalog-add"><button className="staff-button staff-button--outline" type="button" onClick={() => setShowItemForm((current) => !current)}>{showItemForm ? 'Cerrar alta' : 'Agregar concepto'}</button>{showItemForm && <form className="catalog-form" onSubmit={createItem}><label className="catalog-filters__toggle"><input type="checkbox" checked={itemForm.useManualCode} onChange={(event) => setItemForm({ ...itemForm, useManualCode: event.target.checked })} /><span>Especificar clave manualmente</span></label>{itemForm.useManualCode && <label><span>Clave</span><input required value={itemForm.code} onChange={(event) => setItemForm({ ...itemForm, code: event.target.value })} placeholder="EQUIPO-001" maxLength={64} /></label>}<label><span>Nombre</span><input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Bomba de filtrado" maxLength={180} /></label><label><span>Unidad</span><SelectField ariaLabel="Unidad" value={itemForm.unitPreset} onValueChange={(value) => setItemForm({ ...itemForm, unitPreset: value })} options={[...CATALOG_UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })), { value: CATALOG_UNIT_CUSTOM, label: 'Otra…' }]} disabled={saving} /></label>{itemForm.unitPreset === CATALOG_UNIT_CUSTOM && <label><span>Unidad personalizada</span><input required value={itemForm.unitCustom} onChange={(event) => setItemForm({ ...itemForm, unitCustom: event.target.value })} maxLength={40} /></label>}<label><span>Categoría</span><SelectField ariaLabel="Categoría" value={itemForm.categoryId} onValueChange={(value) => setItemForm({ ...itemForm, categoryId: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} /></label><label><span>Descripción</span><textarea rows={3} value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit" disabled={saving}>Guardar concepto</button></form>}</section>}
          <section className="catalog-category-panel" aria-label="Gestión de categorías"><div className="catalog-price-panel__head"><div><p className="staff-section-label">Categorías</p><h3>{categories.length ? 'Organiza el catálogo' : 'Todavía no hay categorías'}</h3></div>{capabilities.catalogManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowCategoryForm((current) => !current)}>{showCategoryForm ? 'Cerrar' : 'Nueva categoría'}</button>}</div>
            {showCategoryForm && capabilities.catalogManage && <form className="catalog-form" onSubmit={createCategory}><label className="catalog-filters__toggle"><input type="checkbox" checked={categoryForm.useManualCode} onChange={(event) => setCategoryForm({ ...categoryForm, useManualCode: event.target.checked })} /><span>Especificar clave manualmente</span></label>{categoryForm.useManualCode && <label><span>Clave</span><input required value={categoryForm.code} onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value })} placeholder="CAT-EQUIPO" maxLength={64} /></label>}<label><span>Nombre</span><input required value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} placeholder="Equipo de filtrado" maxLength={180} /></label><label><span>Orden</span><input inputMode="numeric" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: event.target.value })} maxLength={6} /></label><label><span>Categoría padre</span><SelectField ariaLabel="Categoría padre" value={categoryForm.parentId} onValueChange={(value) => setCategoryForm({ ...categoryForm, parentId: value })} options={categoryTreeOrder.filter(({ category }) => category.status === 'ACTIVE').map(({ category, depth }) => ({ value: category.id, label: `${'—'.repeat(depth)}${depth ? ' ' : ''}${category.name}` }))} placeholder="Sin categoría padre (raíz)" disabled={saving} /></label><label><span>Descripción</span><textarea rows={2} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} maxLength={500} /></label><button className="staff-button staff-button--dark" type="submit" disabled={saving}>Crear categoría</button></form>}
            <div className="catalog-category-list">{categories.length === 0 && <p className="catalog-form__note">Todavía no hay categorías registradas.</p>}{categoryTreeOrder.map(({ category, depth }) => { const parent = category.parentId ? categories.find((entry) => entry.id === category.parentId) : null; return <div className="catalog-category-row" key={category.id} style={depth ? { marginLeft: depth * 18 } : undefined}>
              {editingCategoryId === category.id
                ? <form className="catalog-form catalog-form--inline" onSubmit={saveCategoryEdit}><label><span>Nombre</span><input required value={categoryEditForm.name} onChange={(event) => setCategoryEditForm({ ...categoryEditForm, name: event.target.value })} maxLength={180} /></label><label><span>Orden</span><input inputMode="numeric" value={categoryEditForm.sortOrder} onChange={(event) => setCategoryEditForm({ ...categoryEditForm, sortOrder: event.target.value })} maxLength={6} /></label><label><span>Categoría padre</span><SelectField ariaLabel="Categoría padre (editar categoría)" value={categoryEditForm.parentId} onValueChange={(value) => setCategoryEditForm({ ...categoryEditForm, parentId: value })} options={categoryTreeOrder.filter(({ category: candidate }) => candidate.status === 'ACTIVE' && candidate.id !== category.id && !categoryDescendantIds(category.id, categories).has(candidate.id)).map(({ category: candidate, depth: candidateDepth }) => ({ value: candidate.id, label: `${'—'.repeat(candidateDepth)}${candidateDepth ? ' ' : ''}${candidate.name}` }))} placeholder="Sin categoría padre (raíz)" disabled={saving} /></label><label><span>Descripción</span><textarea rows={2} value={categoryEditForm.description} onChange={(event) => setCategoryEditForm({ ...categoryEditForm, description: event.target.value })} maxLength={500} /></label><div className="catalog-form__actions"><button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar</button><button className="staff-button" type="button" disabled={saving} onClick={() => setEditingCategoryId(null)}>Cancelar</button></div></form>
                : <><span><strong>{category.name}</strong><small>{category.code} · orden {category.sortOrder}{category.status === 'ARCHIVED' ? ' · Archivada' : ''}{parent ? ` · en ${parent.name}` : ''}</small></span>{capabilities.catalogManage && <div className="catalog-category-row__actions"><button className="staff-button" type="button" disabled={saving} onClick={() => startEditCategory(category)}>Editar</button><button className="staff-button" type="button" disabled={saving} onClick={() => void toggleCategoryStatus(category)}>{category.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button></div>}</>}
            </div>; })}</div>
          </section>
          {capabilities.catalogManage && <section className="catalog-special-panel" aria-label="Conceptos especiales pendientes de promoción"><div className="catalog-price-panel__head"><div><p className="staff-section-label">Conceptos especiales</p><h3>Texto libre usado en cotizaciones</h3></div><button className="staff-button" type="button" onClick={toggleSpecialConcepts}>{showSpecialConcepts ? 'Ocultar' : 'Ver conceptos especiales'}</button></div>
            {showSpecialConcepts && <>
              {loadingSpecialConcepts && <div className="catalog-detail-loading"><span /><span /></div>}
              {!loadingSpecialConcepts && specialConcepts && specialConcepts.length === 0 && <p className="catalog-form__note">No hay conceptos especiales pendientes de revisión.</p>}
              {!loadingSpecialConcepts && specialConcepts && specialConcepts.length > 0 && <div className="catalog-category-list">{specialConcepts.map((group) => {
                const key = `${group.normalizedName}::${group.unit}`;
                return <div className="catalog-category-row" key={key}>
                  <span><strong>{group.name}</strong><small>{group.unit} · {group.occurrences} {group.occurrences === 1 ? 'cotización' : 'cotizaciones'} · {group.recentFolios.join(', ')}</small></span>
                  {group.status === 'PROMOTED' && <small className="catalog-special-status catalog-special-status--done">Promovido a {group.matchingCatalogItem!.code} · {group.matchingCatalogItem!.name}</small>}
                  {group.status === 'MATCHES_EXISTING' && <div className="catalog-category-row__actions"><small className="catalog-special-status">Ya existe {group.matchingCatalogItem!.code} · {group.matchingCatalogItem!.name}</small><button className="staff-button" type="button" disabled={saving} onClick={() => void promoteGroup(group)}>Vincular</button></div>}
                  {group.status === 'PENDING' && <div className="catalog-category-row__actions"><SelectField ariaLabel={`Categoría para ${group.name}`} value={specialConceptCategoryId[key] ?? ''} onValueChange={(value) => setSpecialConceptCategoryId({ ...specialConceptCategoryId, [key]: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} /><button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void promoteGroup(group)}>Promover a catálogo</button></div>}
                </div>;
              })}</div>}
            </>}
          </section>}
        </section>
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
