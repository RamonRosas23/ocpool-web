'use client';

import { FormEvent, useState } from 'react';
import { PrivateDialog, PrivateSelect } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import { buildCategoryTreeOrder, categoryDescendantIds, type Category } from '@/lib/staff-catalog-types';

export type StaffCatalogCategoryDialogProps = {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  canManage: boolean;
  onChanged: () => void;
};

const EMPTY_FORM = { code: '', useManualCode: false, name: '', description: '', sortOrder: '0', parentId: '' };

export default function StaffCatalogCategoryDialog({ open, onClose, categories, canManage, onChanged }: StaffCatalogCategoryDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', sortOrder: '0', parentId: '' });

  const categoryTreeOrder = buildCategoryTreeOrder(categories);

  const createCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/staff/catalog/categories', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: form.useManualCode ? form.code : undefined, name: form.name, description: form.description || undefined, sortOrder: Number(form.sortOrder) || 0, parentId: form.parentId || undefined }) });
      const created = await readApiResponseOrThrow<Category>(response, 'No fue posible completar la operación.');
      setNotice(`Categoría ${created.code} creada.`); setForm(EMPTY_FORM); setShowForm(false); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible crear la categoría.'); }
    finally { setSaving(false); }
  };

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setEditForm({ name: category.name, description: category.description ?? '', sortOrder: String(category.sortOrder), parentId: category.parentId ?? '' });
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/categories/${editingId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: editForm.name, description: editForm.description || null, sortOrder: Number(editForm.sortOrder) || 0, parentId: editForm.parentId || null }) }), 'No fue posible completar la operación.');
      setNotice('Categoría actualizada.'); setEditingId(null); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la categoría.'); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (category: Category) => {
    setSaving(true); setError(null); setNotice(null);
    const nextStatus = category.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await readApiResponseOrThrow(await fetch(`/api/staff/catalog/categories/${category.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) }), 'No fue posible completar la operación.');
      setNotice(nextStatus === 'ARCHIVED' ? 'Categoría archivada.' : 'Categoría reactivada.'); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible actualizar la categoría.'); }
    finally { setSaving(false); }
  };

  return (
    <PrivateDialog open={open} onClose={onClose} labelledBy="catalog-category-dialog-title" className="catalog-category-dialog" overlayClassName="catalog-category-dialog__overlay">
      <div className="catalog-category-dialog__head">
        <h2 id="catalog-category-dialog-title">Categorías del catálogo</h2>
        <button className="staff-button" type="button" onClick={onClose}>Cerrar</button>
      </div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {canManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowForm((current) => !current)}>{showForm ? 'Cerrar' : 'Nueva categoría'}</button>}
      {showForm && canManage && (
        <form className="catalog-form" onSubmit={createCategory}>
          <label className="catalog-filters__toggle"><input type="checkbox" checked={form.useManualCode} onChange={(event) => setForm({ ...form, useManualCode: event.target.checked })} /><span>Especificar clave manualmente</span></label>
          {form.useManualCode && <label><span>Clave</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="CAT-EQUIPO" maxLength={64} /></label>}
          <label><span>Nombre</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Equipo de filtrado" maxLength={180} /></label>
          <label><span>Orden</span><input inputMode="numeric" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} maxLength={6} /></label>
          <PrivateSelect id="catalog-category-new-parent" label="Categoría padre" value={form.parentId} onValueChange={(value) => setForm({ ...form, parentId: value })} options={categoryTreeOrder.filter(({ category }) => category.status === 'ACTIVE').map(({ category, depth }) => ({ value: category.id, label: `${'—'.repeat(depth)}${depth ? ' ' : ''}${category.name}` }))} placeholder="Sin categoría padre (raíz)" disabled={saving} />
          <label><span>Descripción</span><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} /></label>
          <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Crear categoría</button>
        </form>
      )}
      <div className="catalog-category-list">
        {categories.length === 0 && <p className="catalog-form__note">Todavía no hay categorías registradas.</p>}
        {categoryTreeOrder.map(({ category, depth }) => {
          const parent = category.parentId ? categories.find((entry) => entry.id === category.parentId) : null;
          return (
            <div className="catalog-category-row" key={category.id} style={depth ? { marginLeft: depth * 18 } : undefined}>
              {editingId === category.id ? (
                <form className="catalog-form catalog-form--inline" onSubmit={saveEdit}>
                  <label><span>Nombre</span><input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} maxLength={180} /></label>
                  <label><span>Orden</span><input inputMode="numeric" value={editForm.sortOrder} onChange={(event) => setEditForm({ ...editForm, sortOrder: event.target.value })} maxLength={6} /></label>
                  <PrivateSelect id="catalog-category-edit-parent" label="Categoría padre" value={editForm.parentId} onValueChange={(value) => setEditForm({ ...editForm, parentId: value })} options={categoryTreeOrder.filter(({ category: candidate }) => candidate.status === 'ACTIVE' && candidate.id !== category.id && !categoryDescendantIds(category.id, categories).has(candidate.id)).map(({ category: candidate, depth: candidateDepth }) => ({ value: candidate.id, label: `${'—'.repeat(candidateDepth)}${candidateDepth ? ' ' : ''}${candidate.name}` }))} placeholder="Sin categoría padre (raíz)" disabled={saving} />
                  <label><span>Descripción</span><textarea rows={2} value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} maxLength={500} /></label>
                  <div className="catalog-form__actions">
                    <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar</button>
                    <button className="staff-button" type="button" disabled={saving} onClick={() => setEditingId(null)}>Cancelar</button>
                  </div>
                </form>
              ) : (
                <>
                  <span><strong>{category.name}</strong><small>{category.code} · orden {category.sortOrder}{category.status === 'ARCHIVED' ? ' · Archivada' : ''}{parent ? ` · en ${parent.name}` : ''}</small></span>
                  {canManage && (
                    <div className="catalog-category-row__actions">
                      <button className="staff-button" type="button" disabled={saving} onClick={() => startEdit(category)}>Editar</button>
                      <button className="staff-button" type="button" disabled={saving} onClick={() => void toggleStatus(category)}>{category.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </PrivateDialog>
  );
}
