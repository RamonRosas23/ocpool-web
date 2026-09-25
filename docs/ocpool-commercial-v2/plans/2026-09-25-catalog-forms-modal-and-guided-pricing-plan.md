# Catálogo y cotizaciones — formularios modales y alta guiada con precio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir los 7 formularios inline restantes (5 en Catálogo, 2 en el constructor de cotizaciones) a diálogos modales consistentes, precargar la categoría filtrada al crear un concepto, y dejar que crear un concepto incluya opcionalmente su primer precio sin cambiar de pestaña.

**Architecture:** Cambios de contenedor (`<form>` inline → `<PrivateDialog><form>...`) y de estado (un paso más en Conceptos) dentro de archivos ya existentes. Ningún componente nuevo, ningún cambio de backend.

**Tech Stack:** Next.js App Router (client components), TypeScript, `PrivateDialog` ya existente en `src/components/private/ui/`.

**Spec de referencia:** [`docs/ocpool-commercial-v2/specs/2026-09-25-catalog-forms-modal-and-guided-pricing.md`](../specs/2026-09-25-catalog-forms-modal-and-guided-pricing.md)

## Global Constraints

- Cero cambios de API, modelo de datos o migraciones.
- No se toca nada de `StaffQuotesPanel.tsx` fuera de los dos formularios listados en la spec §2.4 (líneas de catálogo, aprobaciones, PDF, handoff a proyecto quedan exactamente igual).
- Cada dialogo nuevo reutiliza las clases CSS ya existentes de su propio archivo (`catalog-category-dialog`/`catalog-category-dialog__overlay`/`catalog-category-dialog__head` en Catálogo; `quotes-preflight-dialog`/`quotes-preflight-overlay`/`quotes-preflight-dialog__head`/`quotes-reprice-dialog__close` en Cotizaciones) — cero CSS nuevo.
- Un solo botón de acento por acción, header del diálogo con título + botón de texto "Cerrar" (Catálogo) o icono `X` (Cotizaciones, mismo patrón que sus diálogos hermanos ya existentes) — sin duplicar un botón "Cancelar" dentro del formulario.
- Verificación por bloque: `npx tsc --noEmit`/`npm run lint` rápido por archivo tocado; la regresión pesada (`CATALOG_E2E`, `QUOTES_E2E`, `npm test` completo) sólo al final.

---

### Task 1: `StaffCatalogConceptsTab.tsx` — modal + alta guiada con precio

**Files:**
- Modify: `src/components/StaffCatalogConceptsTab.tsx` (reescritura completa)

**Interfaces:**
- Sin cambios de props (`StaffCatalogConceptsTabProps` igual). Sigue usando `StaffCatalogCategoryDialog` (Task 3 del plan anterior) sin cambios.

- [ ] **Step 1: Reemplazar todo el archivo**

```tsx
// src/components/StaffCatalogConceptsTab.tsx
'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
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
            <button className="staff-button" type="button" onClick={closeCreateDialog}>Cerrar</button>
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
            <button className="staff-button" type="button" onClick={closeCreateDialog}>Cerrar</button>
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
            <button className="staff-button" type="button" onClick={() => setEditingItem(false)}>Cerrar</button>
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
```

Nota sobre `error && !createStep`: cuando el diálogo de alta está abierto, el error se muestra **dentro** del diálogo (ya agregado ahí); fuera del diálogo sólo se muestra cuando no hay ningún paso de alta activo, para no duplicar el mismo mensaje en dos lugares a la vez.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificación manual en el navegador**

Con el servidor de desarrollo corriendo y una sesión de manager real (mismo procedimiento ya usado antes: crear un usuario/sesión ex profeso, limpiar después):
- "Nuevo concepto" abre un diálogo modal (no empuja la página).
- Con una categoría filtrada en el árbol, el campo Categoría del diálogo ya viene seleccionado.
- Completar el paso 1 y dar clic en "Continuar": si hay al menos una lista de precios activa, aparece el paso 2 ("Precio inicial de <nombre>"); si no hay ninguna, el diálogo cierra con el aviso correspondiente.
- En el paso 2, "Guardar precio y cerrar" crea el precio y cierra; "Omitir por ahora" cierra sin crear precio, dejando el concepto ya creado.
- "Editar" abre un diálogo modal con los mismos campos de antes.

- [ ] **Step 4: Commit**

```bash
git add src/components/StaffCatalogConceptsTab.tsx
git commit -m "feat: modal forms + guided first-price wizard in Conceptos tab"
```

---

### Task 2: `StaffCatalogPriceListsTab.tsx` — modal para alta/edición/programar precio

**Files:**
- Modify: `src/components/StaffCatalogPriceListsTab.tsx` (reescritura completa)

**Interfaces:** sin cambios de props.

- [ ] **Step 1: Reemplazar todo el archivo**

```tsx
// src/components/StaffCatalogPriceListsTab.tsx
'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PrivateDatePicker, PrivateDialog, PrivateMoneyField, PrivateSelect } from '@/components/private/ui';
import { formatDate } from '@/lib/format-date';
import { zonedCalendarDateToUtc } from '@/lib/calendar-timezone';
import { moneyLabel } from '@/lib/money';
import { parseMoneyInput } from '@/lib/money-input';
import { usePersistentState } from '@/lib/use-persistent-state';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import type { CatalogCapabilities, PriceList, PriceListDetail } from '@/lib/staff-catalog-types';

type PricableItem = { id: string; code: string; name: string };

export type StaffCatalogPriceListsTabProps = { capabilities: CatalogCapabilities };

export default function StaffCatalogPriceListsTab({ capabilities }: StaffCatalogPriceListsTabProps) {
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListDetail, setPriceListDetail] = useState<PriceListDetail | null>(null);
  const [pricableItems, setPricableItems] = useState<PricableItem[]>([]);
  const [selectedPriceListId, setSelectedPriceListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPriceListForm, setShowPriceListForm] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showArchived, setShowArchived, showArchivedHydrated] = usePersistentState('ocpool.staff.catalog.priceLists.showArchived', false);
  const [priceListForm, setPriceListForm] = useState({ code: '', name: '', currencyCode: 'MXN' });
  const [priceForm, setPriceForm] = useState({ catalogItemId: '', amountInput: '', effectiveFrom: '', reason: '' });
  const [editingPriceList, setEditingPriceList] = useState(false);
  const [priceListEditForm, setPriceListEditForm] = useState({ name: '' });

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

  const loadPriceLists = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const statusSuffix = showArchived ? '' : '?status=ACTIVE';
      const response = await fetch(`/api/staff/catalog/price-lists${statusSuffix}`, { credentials: 'include', cache: 'no-store' });
      const lists = await readApiResponseOrThrow<PriceList[]>(response, 'No fue posible cargar las listas de precio.');
      setPriceLists(lists);
      setSelectedPriceListId((current) => (current && lists.some((list) => list.id === current) ? current : lists[0]?.id ?? null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar las listas de precio.');
      setPriceLists([]);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const loadPriceListDetail = useCallback(async (priceListId: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/staff/catalog/price-lists/${priceListId}`, { credentials: 'include', cache: 'no-store' });
      setPriceListDetail(await readApiResponseOrThrow<PriceListDetail>(response, 'No fue posible completar la operación.'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la lista de precios.');
      setPriceListDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const loadPricableItems = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/catalog/items?status=ACTIVE&pageSize=50', { credentials: 'include', cache: 'no-store' });
      const result = await readApiResponseOrThrow<{ items: PricableItem[] }>(response, 'No fue posible cargar los conceptos.');
      setPricableItems(result.items);
    } catch {
      // El selector de "Concepto" simplemente queda vacío; el resto de la pestaña sigue usable.
    }
  }, []);

  useEffect(() => { if (showArchivedHydrated) void loadPriceLists(); }, [loadPriceLists, showArchivedHydrated]);
  useEffect(() => { void loadPricableItems(); }, [loadPricableItems]);
  useEffect(() => { if (selectedPriceListId) void loadPriceListDetail(selectedPriceListId); else setPriceListDetail(null); }, [loadPriceListDetail, selectedPriceListId]);
  useEffect(() => { if (!priceForm.catalogItemId && pricableItems[0]) setPriceForm((current) => ({ ...current, catalogItemId: pricableItems[0].id })); }, [pricableItems, priceForm.catalogItemId]);

  const createPriceList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/staff/catalog/price-lists', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...priceListForm, validFrom: new Date().toISOString() }) });
      const created = await readApiResponseOrThrow<PriceList>(response, 'No fue posible completar la operación.');
      setNotice(`Lista ${created.code} creada.`); setPriceListForm({ code: '', name: '', currencyCode: 'MXN' }); setShowPriceListForm(false); await loadPriceLists(); setSelectedPriceListId(created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear la lista.'); }
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
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: priceListEditForm.name }) }), 'No fue posible completar la operación.');
      setNotice('Lista actualizada.'); setEditingPriceList(false); await loadPriceLists(); await loadPriceListDetail(selectedPriceListId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la lista.'); }
    finally { setSaving(false); }
  };

  const togglePriceListStatus = async () => {
    if (!selectedPriceListId || !priceListDetail) return;
    setSaving(true); setError(null); setNotice(null);
    const nextStatus = priceListDetail.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) }), 'No fue posible completar la operación.');
      setNotice(nextStatus === 'ARCHIVED' ? 'Lista archivada.' : 'Lista reactivada.');
      await loadPriceLists(); await loadPriceListDetail(selectedPriceListId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la lista.'); }
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
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/price-lists/${selectedPriceListId}/schedule`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          catalogItemId: priceForm.catalogItemId,
          unitPriceMinor,
          effectiveFrom: zonedCalendarDateToUtc(priceForm.effectiveFrom).toISOString(),
          ...(priceForm.reason.trim() ? { reason: priceForm.reason.trim() } : {}),
        }),
      }), 'No fue posible completar la operación.');
      setNotice('Precio programado.');
      setPriceForm((current) => ({ ...current, amountInput: '', reason: '' }));
      await loadPriceListDetail(selectedPriceListId); await loadPriceLists();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible programar el precio.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="catalog-pricelists">
      <div className="catalog-concepts__toolbar">
        <p className="catalog-tab-intro">Cada lista es un conjunto de precios (por ejemplo, por moneda o por zona) que puedes asignar a una propuesta.</p>
        {capabilities.pricesManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowPriceListForm(true)}>Nueva lista</button>}
      </div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && !showPriceListForm && !showScheduleDialog && !editingPriceList && <p className="staff-error" role="alert">{error}</p>}
      <div className="catalog-pricelists__body">
        <aside className="catalog-rail">
          <label className="catalog-filters__toggle catalog-pricelists__archived"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Mostrar archivadas</span></label>
          {loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}
          {!loading && priceLists.length === 0 && (
            <div className="staff-empty staff-empty--compact">
              <h2>Todavía no tienes listas de precio</h2>
              <p>Crea una lista para empezar a programar precios de tus conceptos.</p>
              {capabilities.pricesManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowPriceListForm(true)}>Crear la primera lista</button>}
            </div>
          )}
          <div className="catalog-list-picker">
            {priceLists.map((list) => (
              <button className={`catalog-list-row${selectedPriceListId === list.id ? ' is-selected' : ''}`} type="button" key={list.id} onClick={() => setSelectedPriceListId(list.id)}>
                <span><strong>{list.name}</strong><small>{list.code} · {list.currencyCode} · {list._count.items} conceptos{list.status === 'ARCHIVED' ? ' · Archivada' : ''}</small></span>
                <b>{formatDate(list.validFrom)}</b>
              </button>
            ))}
          </div>
        </aside>
        <section className="catalog-main">
          {!selectedPriceListId && <div className="staff-empty staff-empty--detail"><h2>Selecciona una lista de precio.</h2></div>}
          {loadingDetail && <div className="catalog-detail-loading"><span /><span /></div>}
          {!loadingDetail && priceListDetail && (
            <>
              <div className="catalog-price-summary">
                <span>{priceListDetail.name}{priceListDetail.status === 'ARCHIVED' ? ' · Archivada' : ''}</span>
                <strong>{priceListDetail.items.length} precios</strong>
                <div className="catalog-main__actions">
                  {capabilities.pricesManage && priceListDetail.status === 'ACTIVE' && <button className="staff-button" type="button" disabled={saving} onClick={() => setShowScheduleDialog(true)}>Programar precio</button>}
                  {capabilities.pricesManage && (
                    <>
                      <button className="staff-button" type="button" disabled={saving} onClick={startEditPriceList}>Editar</button>
                      <button className="staff-button" type="button" disabled={saving} onClick={() => void togglePriceListStatus()}>{priceListDetail.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button>
                    </>
                  )}
                </div>
              </div>
              {[
                { key: 'actuales', label: 'Vigentes', items: priceGroups.actuales },
                { key: 'futuros', label: 'Programados', items: priceGroups.futuros },
                { key: 'historicos', label: 'Históricos', items: priceGroups.historicos },
              ].map((group) => (
                <div className="catalog-price-group" key={group.key}>
                  <div className="catalog-price-group__head"><span>{group.label}</span><span>{group.items.length}</span></div>
                  {group.items.length === 0 && <p className="catalog-price-group__empty">Sin precios en este grupo.</p>}
                  {group.items.length > 0 && (
                    <div className="catalog-price-table" role="table" aria-label={`Precios ${group.label.toLowerCase()}`}>
                      <div className="catalog-price-table__head" role="row"><span role="columnheader">Concepto</span><span role="columnheader">Importe</span><span role="columnheader">Vigencia</span></div>
                      {group.items.map((price) => (
                        <div className="catalog-price-table__row" role="row" key={price.id}>
                          <span role="cell"><strong>{price.catalogItem.name}</strong><small>{price.catalogItem.code} · {price.catalogItem.unit}</small></span>
                          <b role="cell">{moneyLabel(price.unitPriceMinor, priceListDetail.currencyCode)}</b>
                          <small role="cell">{formatDate(price.validFrom)}{price.validUntil ? ` — ${formatDate(price.validUntil)}` : ' — abierta'}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {capabilities.pricesManage && priceListDetail.status === 'ARCHIVED' && <p className="catalog-form__note">Esta lista está archivada. Reactívala para poder programar nuevos precios.</p>}
            </>
          )}
        </section>
      </div>

      {showPriceListForm && (
        <PrivateDialog open onClose={() => setShowPriceListForm(false)} labelledBy="catalog-pricelist-create-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-pricelist-create-title">Nueva lista</h2>
            <button className="staff-button" type="button" onClick={() => setShowPriceListForm(false)}>Cerrar</button>
          </div>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form" onSubmit={createPriceList}>
            <label><span>Clave</span><input required value={priceListForm.code} onChange={(event) => setPriceListForm({ ...priceListForm, code: event.target.value })} placeholder="LISTA-MXN" maxLength={64} /></label>
            <label><span>Nombre</span><input required value={priceListForm.name} onChange={(event) => setPriceListForm({ ...priceListForm, name: event.target.value })} placeholder="Lista residencial" maxLength={180} /></label>
            <label><span>Moneda</span><input required value={priceListForm.currencyCode} onChange={(event) => setPriceListForm({ ...priceListForm, currencyCode: event.target.value.toUpperCase() })} maxLength={3} /></label>
            <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Crear lista</button>
          </form>
        </PrivateDialog>
      )}

      {editingPriceList && priceListDetail && (
        <PrivateDialog open onClose={() => setEditingPriceList(false)} labelledBy="catalog-pricelist-edit-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-pricelist-edit-title">Editar lista</h2>
            <button className="staff-button" type="button" onClick={() => setEditingPriceList(false)}>Cerrar</button>
          </div>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form" onSubmit={savePriceListEdit}>
            <label><span>Nombre</span><input required value={priceListEditForm.name} onChange={(event) => setPriceListEditForm({ name: event.target.value })} maxLength={180} /></label>
            <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar cambios</button>
          </form>
        </PrivateDialog>
      )}

      {showScheduleDialog && priceListDetail && (
        <PrivateDialog open onClose={() => setShowScheduleDialog(false)} labelledBy="catalog-schedule-price-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-schedule-price-title">Programar precio</h2>
            <button className="staff-button" type="button" onClick={() => setShowScheduleDialog(false)}>Cerrar</button>
          </div>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form catalog-form--price" onSubmit={schedulePriceForItem}>
            <PrivateSelect id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={pricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Selecciona un concepto" disabled={saving} />
            <PrivateMoneyField id="catalog-price-amount" label="Importe" value={priceForm.amountInput} onValueChange={(value) => setPriceForm({ ...priceForm, amountInput: value })} placeholder="1,250.00" required disabled={saving} />
            <PrivateDatePicker id="catalog-price-effective-from" label="Vigente desde" required value={priceForm.effectiveFrom} onValueChange={(value) => setPriceForm({ ...priceForm, effectiveFrom: value })} disabled={saving} />
            <label><span>Motivo opcional</span><input value={priceForm.reason} onChange={(event) => setPriceForm({ ...priceForm, reason: event.target.value })} placeholder="Ajuste de proveedor" maxLength={300} /></label>
            {previewText && <p className="catalog-form__preview" aria-live="polite">{previewText}</p>}
            <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Programar precio</button>
          </form>
        </PrivateDialog>
      )}
    </div>
  );
}
```

Nota: el diálogo "Programar precio" **no se cierra solo** tras un envío exitoso (a propósito — programar varios precios seguidos, para distintas fechas o conceptos, es un flujo común y forzar reabrir el diálogo cada vez sería un paso atrás en fricción); el usuario lo cierra con el botón "Cerrar" cuando termine. "Nueva lista" y "Editar lista" sí se cierran solos al guardar (mismo comportamiento que ya tenían).

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/StaffCatalogPriceListsTab.tsx
git commit -m "feat: modal forms for Nueva/Editar lista and Programar precio"
```

---

### Task 3: `StaffQuotesPanel.tsx` — modal para "Agregar concepto especial" y "Agregar sección"

**Files:**
- Modify: `src/components/StaffQuotesPanel.tsx:1108-1110` (sólo estas 3 líneas; nada más del archivo cambia)

**Interfaces:** ninguna — `addSpecialLine`/`addSection`/`specialForm`/`sectionForm`/`showSpecialForm`/`showSectionForm` ya existen sin cambios; sólo cambia el contenedor JSX que los envuelve.

- [ ] **Step 1: Reemplazar las 3 líneas**

Buscar en `src/components/StaffQuotesPanel.tsx` el bloque que empieza en `{(canEdit || canStartVersion) && <div className="quotes-add-line">` (línea 1108 al momento de escribir este plan) y termina en el `</form>}` de "Agregar sección" (línea 1110). Reemplazar esas 3 líneas por:

```tsx
              {(canEdit || canStartVersion) && <div className="quotes-add-line"><CatalogItemSearchCombobox priceListId={selectedPriceListId} currencyCode={selectedCurrency} excludeIds={draftLines.map((line) => line.catalogItemId).filter((id): id is string => id !== null)} disabled={!selectedPriceListId} onSelect={addLineFromSearch} /><button className="staff-button staff-button--outline" type="button" onClick={() => setShowSpecialForm(true)}>Agregar concepto especial</button><button className="staff-button staff-button--outline" type="button" onClick={() => setShowSectionForm(true)}>Agregar sección</button></div>}
              {(canEdit || canStartVersion) && showSpecialForm && <PrivateDialog open onClose={() => setShowSpecialForm(false)} labelledBy="quotes-special-dialog-title" className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-special-dialog-title">Agregar concepto especial</h3><button className="quotes-reprice-dialog__close" type="button" onClick={() => setShowSpecialForm(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <form className="catalog-form" onSubmit={addSpecialLine}><label><span>Nombre</span><input required value={specialForm.name} onChange={(event) => setSpecialForm({ ...specialForm, name: event.target.value })} placeholder="Concepto fuera de catálogo" maxLength={180} /></label><label><span>Unidad</span><input required value={specialForm.unit} onChange={(event) => setSpecialForm({ ...specialForm, unit: event.target.value })} placeholder="pieza" maxLength={40} /></label><PrivateMoneyField id="quotes-special-amount" label="Importe del concepto especial" value={specialForm.amountInput} onValueChange={(value) => setSpecialForm({ ...specialForm, amountInput: value })} placeholder="1,250.00" /><label><span>Motivo</span><input required value={specialForm.reason} onChange={(event) => setSpecialForm({ ...specialForm, reason: event.target.value })} placeholder="Por qué no está en catálogo" maxLength={300} /></label><label><span>Descripción</span><textarea rows={2} value={specialForm.description} onChange={(event) => setSpecialForm({ ...specialForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit">Agregar a la propuesta</button></form>
              </PrivateDialog>}
              {(canEdit || canStartVersion) && showSectionForm && <PrivateDialog open onClose={() => setShowSectionForm(false)} labelledBy="quotes-section-dialog-title" className="quotes-preflight-dialog" overlayClassName="quotes-preflight-overlay">
                <div className="quotes-preflight-dialog__head"><h3 id="quotes-section-dialog-title">Agregar sección</h3><button className="quotes-reprice-dialog__close" type="button" onClick={() => setShowSectionForm(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button></div>
                <form className="catalog-form" onSubmit={addSection}><label><span>Título de la sección</span><input required value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} placeholder="Por ejemplo: Alberca" maxLength={180} /></label><label><span>Descripción (opcional)</span><textarea rows={2} value={sectionForm.description} onChange={(event) => setSectionForm({ ...sectionForm, description: event.target.value })} maxLength={2000} /></label><button className="staff-button staff-button--copper" type="submit">Crear sección</button></form>
              </PrivateDialog>}
```

`PrivateDialog`, `PrivateMoneyField` y `X` (de `lucide-react`) ya están importados en este archivo — no hace falta ningún import nuevo.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/StaffQuotesPanel.tsx
git commit -m "feat: modal for Agregar concepto especial / Agregar sección"
```

---

### Task 4: Actualizar `tests/catalog.spec.ts` para los nuevos modales y el wizard

**Files:**
- Modify: `tests/catalog.spec.ts` (sólo el cuerpo del test, no `beforeAll`/`afterAll`)

- [ ] **Step 1: Reemplazar el tramo de alta de concepto (líneas 130-143 al momento de escribir este plan)**

Buscar:

```ts
    await page.getByRole('button', { name: 'Nuevo concepto' }).click();
    await page.getByRole('checkbox', { name: 'Especificar clave manualmente' }).check();
    await page.getByLabel('Clave', { exact: true }).fill(createdItemCode);
    await page.getByLabel('Nombre', { exact: true }).fill(`Nuevo concepto ${suffix}`);
    await page.getByRole('combobox', { name: 'Unidad', exact: true }).click();
    await page.getByRole('option', { name: 'servicio', exact: true }).click();
    await page.getByLabel('Descripción', { exact: true }).fill('Concepto creado desde el flujo de catálogo.');
    await page.getByRole('combobox', { name: 'Categoría' }).click();
    await page.getByRole('option', { name: `E2E categoría ${suffix}`, exact: true }).click();
    await page.getByRole('button', { name: 'Guardar concepto' }).click();
    await expect(page.getByRole('status')).toContainText(`Concepto ${createdItemCode} creado.`);
    const createdRow = page.getByRole('button', { name: new RegExp(createdItemCode) });
    await expect(createdRow).toBeVisible();
    createdItemId = (await prisma.catalogItem.findUniqueOrThrow({ where: { code: createdItemCode }, select: { id: true } })).id;
```

Reemplazar por:

```ts
    await page.getByRole('button', { name: 'Nuevo concepto' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Nuevo concepto' });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole('checkbox', { name: 'Especificar clave manualmente' }).check();
    await createDialog.getByLabel('Clave', { exact: true }).fill(createdItemCode);
    await createDialog.getByLabel('Nombre', { exact: true }).fill(`Nuevo concepto ${suffix}`);
    await createDialog.getByRole('combobox', { name: 'Unidad', exact: true }).click();
    await page.getByRole('option', { name: 'servicio', exact: true }).click();
    await createDialog.getByLabel('Descripción', { exact: true }).fill('Concepto creado desde el flujo de catálogo.');
    await createDialog.getByRole('combobox', { name: 'Categoría' }).click();
    await page.getByRole('option', { name: `E2E categoría ${suffix}`, exact: true }).click();
    await createDialog.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('status')).toContainText(`Concepto ${createdItemCode} creado.`);
    createdItemId = (await prisma.catalogItem.findUniqueOrThrow({ where: { code: createdItemCode }, select: { id: true } })).id;

    // K1-03/UX audit: alta guiada -- crear un concepto ofrece asignarle su primer precio en el
    // mismo flujo, sin cambiar de pestaña. El fixture ya tiene una lista de precios activa
    // (`priceListCode`), así que el paso 2 del wizard debe aparecer.
    const priceStepDialog = page.getByRole('dialog', { name: `Precio inicial de Nuevo concepto ${suffix}` });
    await expect(priceStepDialog).toBeVisible();
    await priceStepDialog.getByRole('combobox', { name: 'Lista de precios' }).click();
    await page.getByRole('option', { name: `Lista E2E ${suffix} · MXN` }).click();
    await priceStepDialog.getByRole('textbox', { name: 'Importe', exact: true }).fill('300.00');
    await priceStepDialog.getByRole('textbox', { name: 'Vigente desde', exact: true }).fill(new Date().toISOString().slice(0, 10));
    await priceStepDialog.getByRole('button', { name: 'Guardar precio y cerrar' }).click();
    await expect(page.getByRole('status')).toContainText(`Concepto ${createdItemCode} creado y precio asignado.`);
    await expect(priceStepDialog).not.toBeVisible();
    const createdRow = page.getByRole('button', { name: new RegExp(createdItemCode) });
    await expect(createdRow).toBeVisible();
```

- [ ] **Step 2: Actualizar el tramo de edición de concepto**

Buscar:

```ts
    await fixtureItemRow.click();
    await itemActions.getByRole('button', { name: 'Editar' }).click();
    const editedItemName = `Concepto E2E editado ${suffix}`;
    await page.getByLabel('Nombre', { exact: true }).fill(editedItemName);
    await page.getByRole('combobox', { name: 'Unidad', exact: true }).click();
    await page.getByRole('option', { name: 'lote', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto actualizado.');
    await expect(fixtureItemRow).toContainText(editedItemName);
```

Reemplazar por:

```ts
    await fixtureItemRow.click();
    await itemActions.getByRole('button', { name: 'Editar' }).click();
    const editItemDialog = page.getByRole('dialog', { name: 'Editar concepto' });
    await expect(editItemDialog).toBeVisible();
    const editedItemName = `Concepto E2E editado ${suffix}`;
    await editItemDialog.getByLabel('Nombre', { exact: true }).fill(editedItemName);
    await editItemDialog.getByRole('combobox', { name: 'Unidad', exact: true }).click();
    await page.getByRole('option', { name: 'lote', exact: true }).click();
    await editItemDialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto actualizado.');
    await expect(editItemDialog).not.toBeVisible();
    await expect(fixtureItemRow).toContainText(editedItemName);
```

- [ ] **Step 3: Actualizar el tramo de "Programar precio"**

Buscar:

```ts
    const effectiveFrom = page.getByRole('textbox', { name: 'Vigente desde', exact: true });
    await page.getByRole('combobox', { name: 'Concepto' }).click();
    await page.getByRole('option', { name: new RegExp(`^${itemCode} ·`) }).click();
    await expect(page.locator('.catalog-form__preview')).toContainText('Se cerrará el precio vigente de MXN 1,250.00');

    // K1-03 parte 2: an intermediate schedule (already in the past relative to "now") so that,
    // once the schedule below closes it out too, the price table exercises all three
    // actuales/futuros/históricos buckets from a single fixture.
    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('1100.00');
    await effectiveFrom.fill('2026-02-01');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await effectiveFrom.fill('');
    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('990.00');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    // K1-03/UX audit fix: "Vigente desde" ahora lleva el atributo `required` nativo (antes sólo
    // alimentaba `aria-required`, ver PrivateDatePicker.tsx) -- el navegador bloquea el envío del
    // formulario ANTES de que `schedulePriceForItem` llegue a ejecutarse, así que el mensaje
    // personalizado de la app para este caso concreto ("Selecciona la fecha...", todavía presente
    // como defensa en el propio handler) ya no es alcanzable por esta vía. Se confirma en su lugar
    // la validación nativa del campo y que la petición nunca llegó al servidor.
    expect(await effectiveFrom.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);

    // Hardcoded as a literal calendar date this went stale the moment real time caught up to it --
    // computed relative to whenever the test actually runs so "Programados" stays genuinely future.
    const scheduledFrom = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await effectiveFrom.fill(scheduledFrom);
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await expect(page.locator('.catalog-price-group', { hasText: 'Históricos' })).toContainText('MXN 1,250.00');
    await expect(page.locator('.catalog-price-group', { hasText: 'Vigentes' })).toContainText('MXN 1,100.00');
    await expect(page.locator('.catalog-price-group', { hasText: 'Programados' })).toContainText('MXN 990.00');

    const priceListActions = page.locator('.catalog-price-summary .catalog-main__actions');
    await priceListActions.getByRole('button', { name: 'Editar' }).click();
    const editedPriceListName = `Lista E2E editada ${suffix}`;
    await page.getByLabel('Nombre', { exact: true }).fill(editedPriceListName);
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Lista actualizada.');
    await expect(fixturePriceList).toContainText(editedPriceListName);
```

Reemplazar por:

```ts
    await page.getByRole('button', { name: 'Programar precio' }).click();
    const scheduleDialog = page.getByRole('dialog', { name: 'Programar precio' });
    await expect(scheduleDialog).toBeVisible();
    const effectiveFrom = scheduleDialog.getByRole('textbox', { name: 'Vigente desde', exact: true });
    await scheduleDialog.getByRole('combobox', { name: 'Concepto' }).click();
    await page.getByRole('option', { name: new RegExp(`^${itemCode} ·`) }).click();
    await expect(scheduleDialog.locator('.catalog-form__preview')).toContainText('Se cerrará el precio vigente de MXN 1,250.00');

    // K1-03 parte 2: an intermediate schedule (already in the past relative to "now") so that,
    // once the schedule below closes it out too, the price table exercises all three
    // actuales/futuros/históricos buckets from a single fixture.
    await scheduleDialog.getByRole('textbox', { name: 'Importe', exact: true }).fill('1100.00');
    await effectiveFrom.fill('2026-02-01');
    await scheduleDialog.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await effectiveFrom.fill('');
    await scheduleDialog.getByRole('textbox', { name: 'Importe', exact: true }).fill('990.00');
    await scheduleDialog.getByRole('button', { name: 'Programar precio' }).click();
    // K1-03/UX audit fix: "Vigente desde" ahora lleva el atributo `required` nativo (antes sólo
    // alimentaba `aria-required`, ver PrivateDatePicker.tsx) -- el navegador bloquea el envío del
    // formulario ANTES de que `schedulePriceForItem` llegue a ejecutarse, así que el mensaje
    // personalizado de la app para este caso concreto ("Selecciona la fecha...", todavía presente
    // como defensa en el propio handler) ya no es alcanzable por esta vía. Se confirma en su lugar
    // la validación nativa del campo y que la petición nunca llegó al servidor.
    expect(await effectiveFrom.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);

    // Hardcoded as a literal calendar date this went stale the moment real time caught up to it --
    // computed relative to whenever the test actually runs so "Programados" stays genuinely future.
    const scheduledFrom = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await effectiveFrom.fill(scheduledFrom);
    await scheduleDialog.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');
    await scheduleDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(scheduleDialog).not.toBeVisible();

    await expect(page.locator('.catalog-price-group', { hasText: 'Históricos' })).toContainText('MXN 1,250.00');
    await expect(page.locator('.catalog-price-group', { hasText: 'Vigentes' })).toContainText('MXN 1,100.00');
    await expect(page.locator('.catalog-price-group', { hasText: 'Programados' })).toContainText('MXN 990.00');

    const priceListActions = page.locator('.catalog-price-summary .catalog-main__actions');
    await priceListActions.getByRole('button', { name: 'Editar' }).click();
    const editListDialog = page.getByRole('dialog', { name: 'Editar lista' });
    await expect(editListDialog).toBeVisible();
    const editedPriceListName = `Lista E2E editada ${suffix}`;
    await editListDialog.getByLabel('Nombre', { exact: true }).fill(editedPriceListName);
    await editListDialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Lista actualizada.');
    await expect(editListDialog).not.toBeVisible();
    await expect(fixturePriceList).toContainText(editedPriceListName);
```

- [ ] **Step 4: Correr el E2E de catálogo de forma aislada**

Run: `cross-env CATALOG_E2E=1 APP_URL=http://127.0.0.1:3100 npx playwright test tests/catalog.spec.ts`
Expected: PASS. Si algún selector no coincide exactamente con el DOM real, ajustar el selector — no relajar ninguna aserción de contenido/estado.

- [ ] **Step 5: Commit**

```bash
git add tests/catalog.spec.ts
git commit -m "test: adapt catalog E2E spec to modal forms and the guided price wizard"
```

---

### Task 5: Verificar `tests/quotes.spec.ts` contra los nuevos modales

**Files:** ninguno se modifica si la Step 1 pasa tal cual — `getByRole`/`getByLabel` ya buscan en toda la página, incluido el contenido de un diálogo abierto, así que el único cambio real (formulario inline → modal) no debería requerir tocar el test.

- [ ] **Step 1: Correr el E2E de cotizaciones de forma aislada**

Run: `cross-env QUOTES_E2E=1 APP_URL=http://127.0.0.1:3100 npx playwright test tests/quotes.spec.ts`
Expected: PASS sin tocar el archivo. Si falla específicamente en el tramo de "Agregar concepto especial" (línea ~345 al momento de escribir este plan), diagnosticar antes de tocar nada: lo más probable es una colisión de accesibilidad-name si el trigger y el botón de envío dentro del diálogo comparten el mismo texto visible en un contexto donde Playwright no logra distinguirlos por rol — en ese caso, escribir el fix mínimo (encadenar `.getByRole('dialog', { name: 'Agregar concepto especial' })` antes de `.getByLabel(...)`, igual que en la Task 4) en vez de relajar la aserción.

- [ ] **Step 2 (sólo si el Step 1 falló): aplicar el fix mínimo y volver a correr**

Si hizo falta el fix, commitear:

```bash
git add tests/quotes.spec.ts
git commit -m "test: scope quotes E2E selectors to the new special-concept/section dialogs"
```

Si el Step 1 pasó sin tocar nada, no hay commit en esta tarea.

---

### Task 6: Regresión completa y cierre en `PROJECT_STATUS.md`

**Files:**
- Modify: `PROJECT_STATUS.md` (nueva entrada de cierre)

- [ ] **Step 1: Regresión completa**

Run: `npm test`
Expected: `typecheck`/`test:unit`/`test:integration`/`build`/`test:e2e`/`test:e2e:foundation` en verde. `test:content` puede seguir fallando por el hallazgo preexistente y ajeno ya documentado (imágenes de galería faltantes en `public/proyectos/cdp|asipona`) — si es el único fallo, confirmar que es exactamente ese (mismo mensaje `Missing asset: public/proyectos/...`) y continuar; si aparece cualquier otro fallo, diagnosticarlo antes de cerrar la tarea.

- [ ] **Step 2: Agregar la entrada de cierre en `PROJECT_STATUS.md`**

Agregar una entrada nueva (estilo denso ya usado en el resto del archivo, ver la entrada "Rediseño de UI/IA del Catálogo comercial" ya existente como plantilla) describiendo: los 3 hallazgos de esta pieza (fricción de flujo categoría→concepto→lista, inconsistencia de formularios inline en Catálogo, la misma inconsistencia encontrada en vivo en `/staff/quotes`), la decisión de alcance (los 7 formularios listados, nada más de `StaffQuotesPanel` tocado), y los conteos de verificación reales del Step 1.

- [ ] **Step 3: Commit**

```bash
git add PROJECT_STATUS.md
git commit -m "docs: close out modal forms + guided pricing wizard in PROJECT_STATUS"
```

---

## Self-Review (completado antes de entregar este plan)

**1. Cobertura de la spec:** §2.1 (modales de Catálogo) → Tasks 1-2. §2.2 (precarga de categoría) → Task 1 (`openCreateDialog`). §2.3 (alta guiada) → Task 1 (`createStep`/`saveWizardPrice`). §2.4 (modales de Cotizaciones) → Task 3. §5 (impacto en pruebas) → Tasks 4-5. §6 (criterios de terminado) → verificado en los Steps de cada task y la regresión del Task 6.

**2. Placeholders:** ninguno — cada step trae el código completo o el diff exacto a aplicar.

**3. Consistencia de tipos:** `WizardPriceList` se define una sola vez en `StaffCatalogConceptsTab.tsx` (Task 1) y no se reutiliza fuera de ese archivo — correcto, es un tipo puramente local a la carga ligera de listas de precio para el wizard, distinto a `PricableItem` (también local, en `StaffCatalogPriceListsTab.tsx`, con propósito distinto). `createStep`/`createdItem`/`wizardPriceForm`/`loadWizardPriceLists`/`saveWizardPrice` se usan consistentemente dentro del mismo archivo en todos los pasos del Task 1.

**Hallazgo resuelto durante la escritura del plan (no estaba en la spec):** el diálogo "Programar precio" originalmente iba a cerrarse solo tras cada envío exitoso, igual que los demás — pero el propio test E2E existente programa 3 precios seguidos para el mismo concepto en una sola pasada, y forzar reabrir el diálogo 3 veces habría sido un paso atrás de fricción, no una mejora. Decisión explícita: este diálogo en particular se queda abierto tras guardar (mismo criterio ya usado en "Verificar precios vigentes" y otros flujos de "varias acciones seguidas" del propio proyecto), y se cierra manualmente con "Cerrar" — documentado en el propio Task 2.

## Execution Handoff

Plan completo y guardado en `docs/ocpool-commercial-v2/plans/2026-09-25-catalog-forms-modal-and-guided-pricing-plan.md`. Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — despacho un subagente nuevo por tarea, con revisión entre cada una.

**2. Ejecución en esta misma sesión** — voy ejecutando las 6 tareas en esta conversación, con puntos de control para que revises.

¿Cuál prefieres?
