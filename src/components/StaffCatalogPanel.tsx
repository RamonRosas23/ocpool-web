'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import WorkspaceLogo from '@/components/WorkspaceLogo';
import DateField from '@/components/DateField';
import SelectField from '@/components/SelectField';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { parseMoneyInput } from '@/lib/money-input';

type Category = { id: string; code: string; name: string; status: string };
type CatalogItem = { id: string; code: string; name: string; description: string | null; unit: string; status: string; category: { id: string; code: string; name: string } | null; createdAt: string; updatedAt: string };
type PriceList = { id: string; code: string; name: string; currencyCode: string; status: string; validFrom: string; validUntil: string | null; _count: { items: number } };
type PriceListDetail = PriceList & { items: Array<{ id: string; catalogItemId: string; unitPriceMinor: string; validFrom: string; validUntil: string | null; catalogItem: { code: string; name: string; unit: string; status: string } }> };
type ListResponse = { items: CatalogItem[]; page: number; pageSize: number; total: number; totalPages: number };
type Capabilities = { catalogRead: boolean; catalogManage: boolean; pricesRead: boolean; pricesManage: boolean };
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
  const [itemForm, setItemForm] = useState({ code: '', name: '', unit: 'pieza', description: '', categoryId: '' });
  const [priceListForm, setPriceListForm] = useState({ code: '', name: '', currencyCode: 'MXN' });
  const [priceForm, setPriceForm] = useState({ catalogItemId: '', amountInput: '', effectiveFrom: '', reason: '' });

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId]);
  const previewItem = useMemo(() => priceListDetail?.items.find((price) => price.catalogItemId === priceForm.catalogItemId && price.validUntil === null) ?? null, [priceListDetail, priceForm.catalogItemId]);
  const previewText = !priceForm.catalogItemId ? '' : previewItem ? `Se cerrará el precio vigente de ${moneyLabel(previewItem.unitPriceMinor, priceListDetail!.currencyCode)} (desde ${formatDate(previewItem.validFrom)}) el día que elijas abajo.` : 'Este concepto no tiene un precio vigente en esta lista; se creará el primero.';

  const loadCatalog = useCallback(async (currentPage: number, query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '25', status: 'ACTIVE' });
      if (query) params.set('query', query);
      const [itemsResponse, categoriesResponse, listsResponse, capabilitiesResponse] = await Promise.all([
        fetch(`/api/staff/catalog/items?${params.toString()}`, { credentials: 'include', cache: 'no-store' }),
        fetch('/api/staff/catalog/categories?status=ACTIVE', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/staff/catalog/price-lists?status=ACTIVE', { credentials: 'include', cache: 'no-store' }),
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
      setSelectedItemId((current) => current && itemsData.items.some((item) => item.id === current) ? current : itemsData.items[0]?.id ?? null);
      setSelectedPriceListId((current) => current && listsData.some((list) => list.id === current) ? current : listsData[0]?.id ?? null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No fue posible cargar el catálogo.';
      setAccessDenied(message.includes('autenticada') || message.includes('permisos'));
      setError(message);
      setItems([]);
      setPriceLists([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
      const response = await fetch('/api/staff/catalog/items', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...itemForm, description: itemForm.description || undefined, categoryId: itemForm.categoryId || undefined }) });
      const created = await readResponse<CatalogItem>(response);
      setNotice(`Concepto ${created.code} creado.`); setItemForm({ code: '', name: '', unit: 'pieza', description: '', categoryId: '' }); setShowItemForm(false); await refresh(); setSelectedItemId(created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear el concepto.'); }
    finally { setSaving(false); }
  };

  const archiveItem = async () => {
    if (!selectedItem) return; setSaving(true); setError(null); setNotice(null);
    try {
      await readResponse(await fetch(`/api/staff/catalog/items/${selectedItem.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ARCHIVED' }) }));
      setNotice('Concepto archivado.'); setSelectedItemId(null); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible archivar el concepto.'); }
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

  if (accessDenied) return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><section className="staff-empty"><WorkspaceLogo className="staff-empty__logo" /><p className="staff-kicker">Área interna</p><h1>Acceso restringido.</h1><p>Inicia sesión con una cuenta de empleado autorizada para consultar el catálogo.</p><div className="staff-empty__actions"><Link className="staff-button staff-button--dark" href="/login">Iniciar sesión</Link><Link className="staff-empty__link" href="/">Volver al sitio</Link></div></section></PrivateSurfaceRoot>;

  return <PrivateSurfaceRoot className="staff-shell">
    <header className="staff-header"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><div className="staff-header__tools"><Link className="staff-header__home" href="/staff">Volver al dashboard</Link><div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Catálogo y precios</div></div></header>
    <div className="staff-content catalog-content">
      <div className="staff-intro"><div><p className="staff-kicker">Fuente comercial</p><h1>Catálogo</h1><p className="staff-intro__copy">Mantén conceptos y precios claros para que cada cotización nazca de una fuente controlada.</p></div><div className="staff-intro__metric"><strong>{total}</strong><span>conceptos activos</span></div></div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}{error && <p className="staff-error" role="alert">{error}</p>}
      <section className="catalog-workspace" aria-label="Gestión de catálogo y precios">
        <aside className="catalog-rail">
          <form className="staff-filters" onSubmit={submitSearch}><label><span>Buscar concepto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Clave o nombre" maxLength={100} /></label><button className="staff-button staff-button--filter" type="submit">Buscar</button></form>
          <div className="staff-inbox__head"><span>{loading ? 'Actualizando…' : `${items.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
          <div className="catalog-item-list" aria-live="polite">{loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}{!loading && items.length === 0 && <div className="staff-empty staff-empty--compact"><span className="staff-empty__mark">—</span><h2>Catálogo vacío.</h2><p>Prueba otra búsqueda o agrega el primer concepto.</p></div>}{!loading && items.map((item) => <button className={`catalog-item-row${selectedItemId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedItemId(item.id)}><span className="catalog-item-row__code">{item.code}</span><strong>{item.name}</strong><small>{item.category?.name ?? 'Sin categoría'} · {item.unit}</small></button>)}</div>
          <div className="staff-pagination"><button type="button" className="staff-pagination__button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</button><button type="button" className="staff-pagination__button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div>
        </aside>
        <section className="catalog-main">
          <div className="catalog-main__top"><div><p className="staff-section-label">Concepto seleccionado</p>{selectedItem ? <><h2>{selectedItem.name}</h2><p className="catalog-main__meta">{selectedItem.code} · {selectedItem.unit} · actualizado {formatDate(selectedItem.updatedAt)}</p></> : <h2>Selecciona un concepto</h2>}</div>{selectedItem && capabilities.catalogManage && <button className="staff-button" type="button" disabled={saving} onClick={() => void archiveItem()}>Archivar</button>}</div>
          {!selectedItem && <div className="staff-empty staff-empty--detail"><WorkspaceLogo className="staff-empty__logo staff-empty__logo--compact" /><h2>La fuente antes de la propuesta.</h2><p>Selecciona un concepto para revisar sus precios o crea uno nuevo.</p></div>}
          {selectedItem && <div className="catalog-detail"><p>{selectedItem.description ?? 'Este concepto todavía no tiene descripción.'}</p><dl><div><dt>Categoría</dt><dd>{selectedItem.category?.name ?? 'Sin categoría'}</dd></div><div><dt>Estado</dt><dd>{selectedItem.status === 'ACTIVE' ? 'Activo' : 'Archivado'}</dd></div></dl></div>}
          <section className="catalog-price-panel"><div className="catalog-price-panel__head"><div><p className="staff-section-label">Listas de precio</p><h3>{priceLists.length ? 'Precios vigentes' : 'Todavía no hay listas'}</h3></div>{capabilities.pricesManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowPriceListForm((current) => !current)}>{showPriceListForm ? 'Cerrar' : 'Nueva lista'}</button>}</div>
            {showPriceListForm && capabilities.pricesManage && <form className="catalog-form" onSubmit={createPriceList}><label><span>Clave</span><input required value={priceListForm.code} onChange={(event) => setPriceListForm({ ...priceListForm, code: event.target.value })} placeholder="LISTA-MXN" maxLength={64} /></label><label><span>Nombre</span><input required value={priceListForm.name} onChange={(event) => setPriceListForm({ ...priceListForm, name: event.target.value })} placeholder="Lista residencial" maxLength={180} /></label><label><span>Moneda</span><input required value={priceListForm.currencyCode} onChange={(event) => setPriceListForm({ ...priceListForm, currencyCode: event.target.value.toUpperCase() })} maxLength={3} /></label><button className="staff-button staff-button--dark" type="submit" disabled={saving}>Crear lista</button></form>}
            <div className="catalog-list-picker">{priceLists.map((list) => <button className={`catalog-list-row${selectedPriceListId === list.id ? ' is-selected' : ''}`} type="button" key={list.id} onClick={() => setSelectedPriceListId(list.id)}><span><strong>{list.name}</strong><small>{list.code} · {list.currencyCode} · {list._count.items} conceptos</small></span><b>{formatDate(list.validFrom)}</b></button>)}</div>
            {loadingDetail && <div className="catalog-detail-loading"><span /><span /></div>}
            {!loadingDetail && priceListDetail && <><div className="catalog-price-summary"><span>{priceListDetail.name}</span><strong>{priceListDetail.items.length} precios</strong></div><div className="catalog-price-table" role="table" aria-label="Precios de la lista seleccionada"><div className="catalog-price-table__head" role="row"><span role="columnheader">Concepto</span><span role="columnheader">Importe</span><span role="columnheader">Vigencia</span></div>{priceListDetail.items.map((price) => <div className="catalog-price-table__row" role="row" key={price.id}><span role="cell"><strong>{price.catalogItem.name}</strong><small>{price.catalogItem.code} · {price.catalogItem.unit}</small></span><b role="cell">{moneyLabel(price.unitPriceMinor, priceListDetail.currencyCode)}</b><small role="cell">{formatDate(price.validFrom)}{price.validUntil ? ` — ${formatDate(price.validUntil)}` : ' — abierta'}</small></div>)}</div></>}
            {capabilities.pricesManage && selectedPriceListId && <form className="catalog-form catalog-form--price" onSubmit={schedulePriceForItem}><p className="staff-section-label">Programar precio</p><label><span>Concepto</span><SelectField ariaLabel="Concepto" value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={items.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Selecciona un concepto" disabled={saving} /></label><label><span>Importe</span><input required inputMode="decimal" value={priceForm.amountInput} onChange={(event) => setPriceForm({ ...priceForm, amountInput: event.target.value })} placeholder="1,250.00" /></label><label><span>Vigente desde</span><DateField ariaLabel="Vigente desde" value={priceForm.effectiveFrom} onValueChange={(value) => setPriceForm({ ...priceForm, effectiveFrom: value })} disabled={saving} /></label><label><span>Motivo opcional</span><input value={priceForm.reason} onChange={(event) => setPriceForm({ ...priceForm, reason: event.target.value })} placeholder="Ajuste de proveedor" maxLength={300} /></label>{previewText && <p className="catalog-form__preview" aria-live="polite">{previewText}</p>}<button className="staff-button staff-button--dark" type="submit" disabled={saving}>Programar precio</button></form>}
          </section>
          {capabilities.catalogManage && <section className="catalog-add"><button className="staff-button staff-button--outline" type="button" onClick={() => setShowItemForm((current) => !current)}>{showItemForm ? 'Cerrar alta' : 'Agregar concepto'}</button>{showItemForm && <form className="catalog-form" onSubmit={createItem}><label><span>Clave</span><input required value={itemForm.code} onChange={(event) => setItemForm({ ...itemForm, code: event.target.value })} placeholder="EQUIPO-001" maxLength={64} /></label><label><span>Nombre</span><input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Bomba de filtrado" maxLength={180} /></label><label><span>Unidad</span><input required value={itemForm.unit} onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })} placeholder="pieza" maxLength={40} /></label><label><span>Categoría</span><SelectField ariaLabel="Categoría" value={itemForm.categoryId} onValueChange={(value) => setItemForm({ ...itemForm, categoryId: value })} options={categories.map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} /></label><label><span>Descripción</span><textarea rows={3} value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit" disabled={saving}>Guardar concepto</button></form>}</section>}
        </section>
      </section>
    </div>
  </PrivateSurfaceRoot>;
}
