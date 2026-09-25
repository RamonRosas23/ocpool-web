'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { PrivateCombobox, PrivateDatePicker, PrivateDialog, PrivateMoneyField } from '@/components/private/ui';
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
  const [tableFilter, setTableFilter] = useState('');

  const previewItem = useMemo(() => priceListDetail?.items.find((price) => price.catalogItemId === priceForm.catalogItemId && price.validUntil === null) ?? null, [priceListDetail, priceForm.catalogItemId]);
  const previewText = !priceForm.catalogItemId ? '' : previewItem ? `Se cerrará el precio vigente de ${moneyLabel(previewItem.unitPriceMinor, priceListDetail!.currencyCode)} (desde ${formatDate(previewItem.validFrom)}) el día que elijas abajo.` : 'Este concepto no tiene un precio vigente en esta lista; se creará el primero.';
  const priceGroups = useMemo(() => {
    const groups = { actuales: [] as PriceListDetail['items'], futuros: [] as PriceListDetail['items'], historicos: [] as PriceListDetail['items'] };
    if (!priceListDetail) return groups;
    const query = tableFilter.trim().toLowerCase();
    const now = Date.now();
    for (const price of priceListDetail.items) {
      if (query && !price.catalogItem.code.toLowerCase().includes(query) && !price.catalogItem.name.toLowerCase().includes(query)) continue;
      const from = new Date(price.validFrom).getTime();
      const until = price.validUntil ? new Date(price.validUntil).getTime() : null;
      if (from > now) groups.futuros.push(price);
      else if (until !== null && until <= now) groups.historicos.push(price);
      else groups.actuales.push(price);
    }
    groups.futuros = [...groups.futuros].reverse();
    return groups;
  }, [priceListDetail, tableFilter]);

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
  useEffect(() => { setTableFilter(''); if (selectedPriceListId) void loadPriceListDetail(selectedPriceListId); else setPriceListDetail(null); }, [loadPriceListDetail, selectedPriceListId]);
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

  const openScheduleDialogForItem = (catalogItemId: string) => {
    setPriceForm({ catalogItemId, amountInput: '', effectiveFrom: '', reason: '' });
    setShowScheduleDialog(true);
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
              {priceListDetail.items.length > 8 && (
                <label className="staff-filters catalog-pricelists__table-filter"><span>Buscar en esta lista</span><input value={tableFilter} onChange={(event) => setTableFilter(event.target.value)} placeholder="Clave o nombre del concepto" maxLength={100} /></label>
              )}
              {[
                { key: 'actuales', label: 'Vigentes', items: priceGroups.actuales, allowReschedule: true },
                { key: 'futuros', label: 'Programados', items: priceGroups.futuros, allowReschedule: true },
                { key: 'historicos', label: 'Históricos', items: priceGroups.historicos, allowReschedule: false },
              ].map((group) => (
                <div className="catalog-price-group" key={group.key}>
                  <div className="catalog-price-group__head"><span>{group.label}</span><span>{group.items.length}</span></div>
                  {group.items.length === 0 && <p className="catalog-price-group__empty">Sin precios en este grupo.</p>}
                  {group.items.length > 0 && (
                    <div className={`catalog-price-table${group.allowReschedule ? ' catalog-price-table--actionable' : ''}`} role="table" aria-label={`Precios ${group.label.toLowerCase()}`}>
                      <div className="catalog-price-table__head" role="row">
                        <span role="columnheader">Concepto</span><span role="columnheader">Importe</span><span role="columnheader">Vigencia</span>
                        {group.allowReschedule && <span role="columnheader" aria-hidden="true" />}
                      </div>
                      {group.items.map((price) => (
                        <div className="catalog-price-table__row" role="row" key={price.id}>
                          <span role="cell"><strong>{price.catalogItem.name}</strong><small>{price.catalogItem.code} · {price.catalogItem.unit}</small></span>
                          <b role="cell">{moneyLabel(price.unitPriceMinor, priceListDetail.currencyCode)}</b>
                          <small role="cell">{formatDate(price.validFrom)}{price.validUntil ? ` — ${formatDate(price.validUntil)}` : ' — abierta'}</small>
                          {group.allowReschedule && capabilities.pricesManage && (
                            <span role="cell">
                              <button className="staff-button staff-button--outline catalog-price-table__action" type="button" onClick={() => openScheduleDialogForItem(price.catalogItemId)}>Reprogramar</button>
                            </span>
                          )}
                          {group.allowReschedule && !capabilities.pricesManage && <span role="cell" aria-hidden="true" />}
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
            <button className="staff-dialog-close" type="button" onClick={() => setShowPriceListForm(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
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
            <button className="staff-dialog-close" type="button" onClick={() => setEditingPriceList(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
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
            <button className="staff-dialog-close" type="button" onClick={() => setShowScheduleDialog(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <form className="catalog-form catalog-form--price" onSubmit={schedulePriceForItem}>
            <PrivateCombobox id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={pricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Escribe la clave o el nombre del concepto" disabled={saving} />
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
