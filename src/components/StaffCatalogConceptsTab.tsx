'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, X } from 'lucide-react';
import { PrivateDatePicker, PrivateDialog, PrivateMoneyField, PrivatePagination, PrivateSelect } from '@/components/private/ui';
import StaffCatalogCategoryDialog from '@/components/StaffCatalogCategoryDialog';
import { formatDate } from '@/lib/format-date';
import { zonedCalendarDateToUtc } from '@/lib/calendar-timezone';
import { parseMoneyInput } from '@/lib/money-input';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { usePersistentState } from '@/lib/use-persistent-state';
import { buildCategoryTreeOrder, type CatalogCapabilities, type CatalogItem, type CatalogListResponse, type Category } from '@/lib/staff-catalog-types';

const CATALOG_UNIT_OPTIONS = ['pieza', 'servicio', 'hora', 'visita', 'm²', 'm³', 'lote', 'kit', 'mes'] as const;
const CATALOG_UNIT_CUSTOM = '__otra__';

type WizardPriceList = { id: string; code: string; name: string; currencyCode: string };

export type StaffCatalogConceptsTabProps = { capabilities: CatalogCapabilities };

export default function StaffCatalogConceptsTab({ capabilities }: StaffCatalogConceptsTabProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [showArchived, setShowArchived, showArchivedHydrated] = usePersistentState('ocpool.staff.catalog.items.showArchived', false);
  const emptyItemForm = { code: '', useManualCode: false, name: '', unitPreset: 'pieza', unitCustom: '', description: '', categoryId: '' };
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingItem, setEditingItem] = useState(false);
  const [itemEditForm, setItemEditForm] = useState({ name: '', description: '', unitPreset: 'pieza', unitCustom: '', categoryId: '' });

  // Alta guiada: 'form' = paso 1 (datos del concepto), 'price' = paso 2 (precio inicial opcional), null = cerrado.
  const [createStep, setCreateStep] = useState<'form' | 'price' | null>(null);
  const [createdItem, setCreatedItem] = useState<CatalogItem | null>(null);
  const [wizardPriceLists, setWizardPriceLists] = useState<WizardPriceList[]>([]);
  const emptyWizardPriceForm = { priceListId: '', amountInput: '', effectiveFrom: '' };
  const [wizardPriceForm, setWizardPriceForm] = useState(emptyWizardPriceForm);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId]);
  const categoryTreeOrder = useMemo(() => buildCategoryTreeOrder(categories), [categories]);

  const loadItems = useCallback(async (currentPage: number, query: string, categoryId: string | null) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '25' });
      if (!showArchived) params.set('status', 'ACTIVE');
      if (query) params.set('query', query);
      if (categoryId) params.set('categoryId', categoryId);
      const response = await fetch(`/api/staff/catalog/items?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponse<CatalogListResponse>(response, 'No fue posible cargar el catálogo.');
      if (!result.ok) {
        setAccessDenied(result.kind === 'forbidden');
        setError(result.message);
        setItems([]);
        return;
      }
      setItems(result.data.items);
      setTotal(result.data.total);
      setTotalPages(Math.max(result.data.totalPages, 1));
      setAccessDenied(false);
      setSelectedItemId((current) => (current && result.data.items.some((item) => item.id === current) ? current : result.data.items[0]?.id ?? null));
    } catch (caught) {
      setAccessDenied(false);
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el catálogo.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const loadCategories = useCallback(async () => {
    try {
      const statusSuffix = showArchived ? '' : '?status=ACTIVE';
      const response = await fetch(`/api/staff/catalog/categories${statusSuffix}`, { credentials: 'include', cache: 'no-store' });
      setCategories(await readApiResponseOrThrow<Category[]>(response, 'No fue posible cargar las categorías.'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar las categorías.');
    }
  }, [showArchived]);

  useEffect(() => { if (showArchivedHydrated) void loadItems(page, appliedSearch, selectedCategoryId); }, [appliedSearch, loadItems, page, selectedCategoryId, showArchivedHydrated]);
  useEffect(() => { if (showArchivedHydrated) void loadCategories(); }, [loadCategories, showArchivedHydrated]);

  const refresh = async () => { await loadItems(page, appliedSearch, selectedCategoryId); await loadCategories(); };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); };

  const selectCategory = (categoryId: string | null) => { setPage(1); setSelectedCategoryId(categoryId); };

  const openCreateDialog = () => {
    setItemForm({ ...emptyItemForm, categoryId: selectedCategoryId ?? '' });
    setCreatedItem(null);
    setWizardPriceForm(emptyWizardPriceForm);
    setError(null);
    setCreateStep('form');
  };

  const closeCreateDialog = () => {
    setCreateStep(null);
    setCreatedItem(null);
    setItemForm(emptyItemForm);
    setWizardPriceForm(emptyWizardPriceForm);
  };

  // Se pide fresco en el momento en que hace falta (justo tras crear el concepto), no al abrir el
  // diálogo -- así nunca compite en una carrera contra lo rápido que el usuario llene el paso 1.
  const loadWizardPriceLists = async (): Promise<WizardPriceList[]> => {
    try {
      const response = await fetch('/api/staff/catalog/price-lists?status=ACTIVE', { credentials: 'include', cache: 'no-store' });
      const lists = await readApiResponseOrThrow<WizardPriceList[]>(response, 'No fue posible cargar las listas de precio.');
      setWizardPriceLists(lists);
      return lists;
    } catch {
      setWizardPriceLists([]);
      return [];
    }
  };

  const createItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const unit = itemForm.unitPreset === CATALOG_UNIT_CUSTOM ? itemForm.unitCustom.trim() : itemForm.unitPreset;
      const response = await fetch('/api/staff/catalog/items', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: itemForm.useManualCode ? itemForm.code : undefined, name: itemForm.name, unit, description: itemForm.description || undefined, categoryId: itemForm.categoryId || undefined }) });
      const created = await readApiResponseOrThrow<CatalogItem>(response, 'No fue posible completar la operación.');
      setNotice(`Concepto ${created.code} creado.`);
      await refresh();
      setSelectedItemId(created.id);
      if (capabilities.pricesManage) {
        const lists = await loadWizardPriceLists();
        if (lists.length > 0) {
          setCreatedItem(created);
          setCreateStep('price');
          return;
        }
        setNotice(`Concepto ${created.code} creado. Crea una lista de precio para poder asignarle un precio.`);
      }
      closeCreateDialog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear el concepto.'); }
    finally { setSaving(false); }
  };

  const saveWizardPrice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createdItem) return;
    if (!wizardPriceForm.priceListId) { setError('Selecciona una lista de precio.'); return; }
    if (!wizardPriceForm.effectiveFrom) { setError('Selecciona la fecha desde la que aplica el precio.'); return; }
    const unitPriceMinor = parseMoneyInput(wizardPriceForm.amountInput);
    if (!unitPriceMinor) { setError('Escribe un importe válido, por ejemplo 1250.00.'); return; }
    setSaving(true); setError(null);
    try {
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/price-lists/${wizardPriceForm.priceListId}/schedule`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogItemId: createdItem.id, unitPriceMinor, effectiveFrom: zonedCalendarDateToUtc(wizardPriceForm.effectiveFrom).toISOString() }),
      }), 'No fue posible completar la operación.');
      setNotice(`Concepto ${createdItem.code} creado y precio asignado.`);
      closeCreateDialog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible asignar el precio.'); }
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
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/items/${selectedItem.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: itemEditForm.name, description: itemEditForm.description || null, unit, categoryId: itemEditForm.categoryId || null }) }), 'No fue posible completar la operación.');
      setNotice('Concepto actualizado.'); setEditingItem(false); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el concepto.'); }
    finally { setSaving(false); }
  };

  const toggleItemStatus = async () => {
    if (!selectedItem) return; setSaving(true); setError(null); setNotice(null);
    const nextStatus = selectedItem.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/items/${selectedItem.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) }), 'No fue posible completar la operación.');
      setNotice(nextStatus === 'ARCHIVED' ? 'Concepto archivado.' : 'Concepto reactivado.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el concepto.'); }
    finally { setSaving(false); }
  };

  if (accessDenied) return <p className="staff-error" role="alert">No tienes permiso para ver el catálogo de conceptos.</p>;

  const isTrulyEmpty = !loading && items.length === 0 && total === 0 && !appliedSearch && !selectedCategoryId;
  const isEmptyFromFilter = !loading && items.length === 0 && !isTrulyEmpty;

  return (
    <div className="catalog-concepts">
      <div className="catalog-concepts__toolbar">
        <p className="catalog-tab-intro">Cada concepto es un producto o servicio que después podrás agregar a una propuesta con su precio.</p>
        {capabilities.catalogManage && <button className="staff-button staff-button--copper" type="button" onClick={openCreateDialog}>Nuevo concepto</button>}
      </div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && !createStep && <p className="staff-error" role="alert">{error}</p>}
      <div className="catalog-concepts__body">
        <aside className="catalog-concepts__categories" aria-label="Filtrar por categoría">
          <p className="staff-section-label">Categorías</p>
          <button type="button" className={`catalog-tree-row${selectedCategoryId === null ? ' is-selected' : ''}`} onClick={() => selectCategory(null)}>Todos</button>
          {categoryTreeOrder.map(({ category, depth }) => (
            <button type="button" key={category.id} className={`catalog-tree-row${selectedCategoryId === category.id ? ' is-selected' : ''}`} style={depth ? { paddingLeft: 12 + depth * 14 } : undefined} onClick={() => selectCategory(category.id)}>
              {category.name}{category.status === 'ARCHIVED' ? ' · Archivada' : ''}
            </button>
          ))}
          {capabilities.catalogManage && <button type="button" className="catalog-tree-manage" onClick={() => setShowCategoryDialog(true)}>Gestionar categorías</button>}
        </aside>
        <div className="catalog-concepts__list">
          <form className="staff-filters" onSubmit={submitSearch}>
            <label><span>Buscar concepto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Clave o nombre" maxLength={100} /></label>
            <label className="catalog-filters__toggle"><input type="checkbox" checked={showArchived} onChange={(event) => { setPage(1); setShowArchived(event.target.checked); }} /><span>Mostrar archivados</span></label>
            <button className="staff-button staff-button--filter" type="submit">Buscar</button>
          </form>
          <div className="staff-inbox__head"><span>{loading ? 'Actualizando…' : `${items.length} de ${total}`}</span><span>Página {page} / {totalPages}</span></div>
          <div className="catalog-item-list" aria-live="polite">
            {loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}
            {isTrulyEmpty && (
              <div className="staff-empty staff-empty--compact">
                <span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span>
                <h2>Todavía no tienes conceptos en tu catálogo</h2>
                <p>Cada concepto es un producto o servicio que después podrás agregar a una propuesta con su precio.</p>
                {capabilities.catalogManage && <button className="staff-button staff-button--copper" type="button" onClick={openCreateDialog}>Crear el primer concepto</button>}
              </div>
            )}
            {isEmptyFromFilter && (
              <div className="staff-empty staff-empty--compact">
                <span className="staff-empty__mark" aria-hidden="true"><Inbox size={20} /></span>
                <h2>Sin conceptos que coincidan</h2>
                <p>Prueba otra búsqueda o quita el filtro de categoría.</p>
              </div>
            )}
            {!loading && items.map((item) => (
              <button className={`catalog-item-row${selectedItemId === item.id ? ' is-selected' : ''}`} type="button" key={item.id} onClick={() => setSelectedItemId(item.id)}>
                <span className="catalog-item-row__code">{item.code}</span>
                <strong>{item.name}</strong>
                <small>{item.category?.name ?? 'Sin categoría'} · {item.unit}{item.status === 'ARCHIVED' ? ' · Archivado' : ''}</small>
              </button>
            ))}
          </div>
          <PrivatePagination page={page} totalPages={totalPages} disabled={loading} onPrevious={() => setPage((current) => current - 1)} onNext={() => setPage((current) => current + 1)} />
        </div>
        <section className="catalog-concepts__detail">
          <div className="catalog-main__top">
            <div>
              <p className="staff-section-label">Concepto seleccionado</p>
              {selectedItem ? <><h2>{selectedItem.name}</h2><p className="catalog-main__meta">{selectedItem.code} · {selectedItem.unit} · actualizado {formatDate(selectedItem.updatedAt)}</p></> : <h2>Selecciona un concepto</h2>}
            </div>
            {selectedItem && capabilities.catalogManage && (
              <div className="catalog-main__actions">
                <button className="staff-button" type="button" disabled={saving} onClick={startEditItem}>Editar</button>
                <button className="staff-button" type="button" disabled={saving} onClick={() => void toggleItemStatus()}>{selectedItem.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button>
              </div>
            )}
          </div>
          {!selectedItem && <div className="staff-empty staff-empty--detail"><h2>Selecciona un concepto de la lista para ver su detalle.</h2></div>}
          {selectedItem && (
            <div className="catalog-detail">
              <p>{selectedItem.description ?? 'Este concepto todavía no tiene descripción.'}</p>
              <dl>
                <div><dt>Categoría</dt><dd>{selectedItem.category?.name ?? 'Sin categoría'}</dd></div>
                <div><dt>Estado</dt><dd>{selectedItem.status === 'ACTIVE' ? 'Activo' : 'Archivado'}</dd></div>
              </dl>
            </div>
          )}
        </section>
      </div>

      {createStep === 'form' && (
        <PrivateDialog open onClose={closeCreateDialog} labelledBy="catalog-item-create-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-create-title">Nuevo concepto</h2>
            <button className="staff-dialog-close" type="button" onClick={closeCreateDialog} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form" onSubmit={createItem}>
            <label className="catalog-filters__toggle"><input type="checkbox" checked={itemForm.useManualCode} onChange={(event) => setItemForm({ ...itemForm, useManualCode: event.target.checked })} /><span>Especificar clave manualmente</span></label>
            {itemForm.useManualCode && <label><span>Clave</span><input required value={itemForm.code} onChange={(event) => setItemForm({ ...itemForm, code: event.target.value })} placeholder="EQUIPO-001" maxLength={64} /></label>}
            <label><span>Nombre</span><input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Bomba de filtrado" maxLength={180} /></label>
            <PrivateSelect id="catalog-item-new-unit" label="Unidad" required value={itemForm.unitPreset} onValueChange={(value) => setItemForm({ ...itemForm, unitPreset: value })} options={[...CATALOG_UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })), { value: CATALOG_UNIT_CUSTOM, label: 'Otra…' }]} disabled={saving} />
            {itemForm.unitPreset === CATALOG_UNIT_CUSTOM && <label><span>Unidad personalizada</span><input required value={itemForm.unitCustom} onChange={(event) => setItemForm({ ...itemForm, unitCustom: event.target.value })} maxLength={40} /></label>}
            <PrivateSelect id="catalog-item-new-category" label="Categoría" value={itemForm.categoryId} onValueChange={(value) => setItemForm({ ...itemForm, categoryId: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} />
            <label><span>Descripción</span><textarea rows={3} value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} maxLength={2000} /></label>
            <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Continuar</button>
          </form>
        </PrivateDialog>
      )}

      {createStep === 'price' && createdItem && (
        <PrivateDialog open onClose={closeCreateDialog} labelledBy="catalog-item-price-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-price-title">Precio inicial de {createdItem.name}</h2>
            <button className="staff-dialog-close" type="button" onClick={closeCreateDialog} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
          <p className="catalog-tab-intro">Concepto creado. Opcional: asígnale su primer precio sin salir de aquí.</p>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form catalog-form--price" onSubmit={saveWizardPrice}>
            <PrivateSelect id="catalog-item-price-list" label="Lista de precios" required value={wizardPriceForm.priceListId} onValueChange={(value) => setWizardPriceForm({ ...wizardPriceForm, priceListId: value })} options={wizardPriceLists.map((list) => ({ value: list.id, label: `${list.name} · ${list.currencyCode}` }))} placeholder="Selecciona una lista" disabled={saving} />
            <PrivateMoneyField id="catalog-item-price-amount" label="Importe" value={wizardPriceForm.amountInput} onValueChange={(value) => setWizardPriceForm({ ...wizardPriceForm, amountInput: value })} placeholder="1,250.00" required disabled={saving} />
            <PrivateDatePicker id="catalog-item-price-effective-from" label="Vigente desde" required value={wizardPriceForm.effectiveFrom} onValueChange={(value) => setWizardPriceForm({ ...wizardPriceForm, effectiveFrom: value })} disabled={saving} />
            <div className="catalog-form__actions">
              <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar precio y cerrar</button>
              <button className="staff-button" type="button" disabled={saving} onClick={closeCreateDialog}>Omitir por ahora</button>
            </div>
          </form>
        </PrivateDialog>
      )}

      {selectedItem && editingItem && (
        <PrivateDialog open onClose={() => setEditingItem(false)} labelledBy="catalog-item-edit-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-edit-title">Editar concepto</h2>
            <button className="staff-dialog-close" type="button" onClick={() => setEditingItem(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form" onSubmit={saveItemEdit}>
            <label><span>Nombre</span><input required value={itemEditForm.name} onChange={(event) => setItemEditForm({ ...itemEditForm, name: event.target.value })} maxLength={180} /></label>
            <PrivateSelect id="catalog-item-edit-unit" label="Unidad" required value={itemEditForm.unitPreset} onValueChange={(value) => setItemEditForm({ ...itemEditForm, unitPreset: value })} options={[...CATALOG_UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })), { value: CATALOG_UNIT_CUSTOM, label: 'Otra…' }]} disabled={saving} />
            {itemEditForm.unitPreset === CATALOG_UNIT_CUSTOM && <label><span>Unidad personalizada</span><input required value={itemEditForm.unitCustom} onChange={(event) => setItemEditForm({ ...itemEditForm, unitCustom: event.target.value })} maxLength={40} /></label>}
            <PrivateSelect id="catalog-item-edit-category" label="Categoría" value={itemEditForm.categoryId} onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} />
            <label><span>Descripción</span><textarea rows={3} value={itemEditForm.description} onChange={(event) => setItemEditForm({ ...itemEditForm, description: event.target.value })} maxLength={2000} /></label>
            <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar cambios</button>
          </form>
        </PrivateDialog>
      )}

      <StaffCatalogCategoryDialog
        open={showCategoryDialog}
        onClose={() => setShowCategoryDialog(false)}
        categories={categories}
        canManage={capabilities.catalogManage}
        onChanged={() => { void loadCategories(); void loadItems(page, appliedSearch, selectedCategoryId); }}
      />
    </div>
  );
}
