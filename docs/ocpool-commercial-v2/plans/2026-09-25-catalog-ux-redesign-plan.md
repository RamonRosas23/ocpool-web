# Catálogo comercial — rediseño de UI/IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar `StaffCatalogPanel.tsx` (434 líneas, una sola pantalla sin separación) por tres pestañas autocontenidas — Conceptos, Listas de precio, Por revisar — cada una con un único botón de acción primaria, sin ningún cambio de backend.

**Architecture:** Un shell delgado (`StaffCatalogPanel.tsx`) que resuelve permisos y pestaña activa (sincronizada en la URL) y monta uno de tres componentes de pestaña, cada uno dueño de su propia carga de datos y estado. Un diálogo compartido (`StaffCatalogCategoryDialog`) para gestión de categorías. Un primitivo nuevo y genérico (`PrivateTabs`) para la barra de pestañas, reutilizable a futuro.

**Tech Stack:** Next.js App Router (client components), TypeScript, Prisma (sin cambios), Vitest (unit/integration, sin cambios en este proyecto), Playwright (`tests/catalog.spec.ts`, se reescribe).

**Spec de referencia:** [`docs/ocpool-commercial-v2/specs/2026-09-25-catalog-ux-redesign.md`](../specs/2026-09-25-catalog-ux-redesign.md)

## Global Constraints

- Cero cambios de API, modelo de datos o migraciones — solo frontend.
- No se toca `StaffQuotesPanel.tsx`, `StaffRequestsPanel.tsx`, `RequestWorkspaceDetailV2.tsx` ni ninguna otra superficie fuera de `/staff/catalog`.
- Verificación por bloque, no por cambio microscópico: `tsc --noEmit` rápido después de cada archivo nuevo; la regresión completa (`npm test`) solo al cierre de los Tasks 7 y 8 — esta es una convención explícita y documentada de este proyecto (ver `docs/historicos/plans/2026-09-19-ocpool-commercial-v3-continuacion.md`, §0.1), no una desviación de la disciplina TDD habitual.
- Un solo botón de acento (`staff-button--copper`) por pestaña, reservado para su acción principal ("Nuevo concepto" / "Nueva lista" / "Promover a catálogo"). Todo lo demás usa `staff-button`/`staff-button--outline`/`staff-button--dark` (confirmación de formulario).
- Los permisos (`catalogRead`/`catalogManage`/`pricesRead`/`pricesManage`) gatean exactamente las mismas acciones que hoy.
- Commits pequeños, uno por task, con el estilo de mensaje ya usado en el repo (`fix:`/`feat:` + descripción concisa, sin ceremonia de PR — se trabaja directo en `main`).
- No se agregan conteos numéricos por categoría en el árbol de filtro (el endpoint `GET /api/staff/catalog/categories` no expone `_count`; agregarlo sería un cambio de backend fuera de alcance). El árbol muestra solo nombres.

---

### Task 1: Tipos compartidos del catálogo

**Files:**
- Create: `src/lib/staff-catalog-types.ts`

**Interfaces:**
- Produces: `CatalogStatus`, `Category`, `CatalogItem`, `PriceList`, `PriceListDetail`, `CatalogListResponse`, `CatalogCapabilities`, `SpecialConceptGroup` (tipos); `categoryDescendantIds(categoryId: string, categories: Category[]): Set<string>`; `buildCategoryTreeOrder(categories: Category[]): Array<{ category: Category; depth: number }>`. Todos los tasks siguientes los consumen vía `import ... from '@/lib/staff-catalog-types'`.

- [ ] **Step 1: Crear el archivo de tipos y helpers**

```ts
// src/lib/staff-catalog-types.ts
export type CatalogStatus = 'ACTIVE' | 'ARCHIVED';

export type Category = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: CatalogStatus;
  sortOrder: number;
  parentId: string | null;
};

export type CatalogItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  status: CatalogStatus;
  category: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type PriceList = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  validFrom: string;
  validUntil: string | null;
  _count: { items: number };
};

export type PriceListDetail = PriceList & {
  items: Array<{
    id: string;
    catalogItemId: string;
    unitPriceMinor: string;
    validFrom: string;
    validUntil: string | null;
    catalogItem: { code: string; name: string; unit: string; status: string };
  }>;
};

export type CatalogListResponse = { items: CatalogItem[]; page: number; pageSize: number; total: number; totalPages: number };

export type CatalogCapabilities = { catalogRead: boolean; catalogManage: boolean; pricesRead: boolean; pricesManage: boolean };

export type SpecialConceptGroup = {
  normalizedName: string;
  unit: string;
  name: string;
  occurrences: number;
  recentFolios: string[];
  status: 'PENDING' | 'MATCHES_EXISTING' | 'PROMOTED';
  matchingCatalogItem: { id: string; code: string; name: string } | null;
};

export function categoryDescendantIds(categoryId: string, categories: Category[]): Set<string> {
  const result = new Set<string>();
  let frontier = [categoryId];
  while (frontier.length) {
    const next = categories.filter((entry) => entry.parentId && frontier.includes(entry.parentId)).map((entry) => entry.id);
    for (const id of next) result.add(id);
    frontier = next;
  }
  return result;
}

export function buildCategoryTreeOrder(categories: Category[]): Array<{ category: Category; depth: number }> {
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
```

Nota: `categoryDescendantIds` y `buildCategoryTreeOrder` son exactamente las mismas funciones que hoy viven inline en `StaffCatalogPanel.tsx:21-53` — se mueven sin cambiar su lógica.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados con `staff-catalog-types.ts` (el archivo no es importado todavía por nadie, así que solo se valida que compile de forma aislada).

- [ ] **Step 3: Commit**

```bash
git add src/lib/staff-catalog-types.ts
git commit -m "refactor: extract shared catalog types ahead of StaffCatalogPanel split"
```

---

### Task 2: Primitivo de pestañas reutilizable (`PrivateTabs`)

**Files:**
- Create: `src/components/private/ui/PrivateTabs.tsx`
- Modify: `src/components/private/ui/index.ts`
- Modify: `src/components/private/ui/private-ui.css`

**Interfaces:**
- Consumes: `nextRovingTabIndex(key: string, currentIndex: number, count: number): number | null` (ya existe en `src/components/private/ui/a11y.ts`).
- Produces: `PrivateTabs({ tabs, activeKey, ariaLabel, tabpanelId, className }: PrivateTabsProps)`, tipos `PrivateTabItem = { key: string; label: string; href: string; badge?: number }` y `PrivateTabsProps`. Task 7 lo consume así: `import { PrivateTabs } from '@/components/private/ui'`.

- [ ] **Step 1: Crear el componente**

```tsx
// src/components/private/ui/PrivateTabs.tsx
'use client';

import Link from 'next/link';
import type { KeyboardEvent } from 'react';
import { nextRovingTabIndex } from './a11y';

export type PrivateTabItem = {
  key: string;
  label: string;
  href: string;
  badge?: number;
};

export type PrivateTabsProps = {
  tabs: PrivateTabItem[];
  activeKey: string;
  ariaLabel: string;
  tabpanelId: string;
  className?: string;
};

function handleTabKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
  const tabLinks = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? []);
  const currentIndex = tabLinks.indexOf(event.currentTarget);
  const nextIndex = nextRovingTabIndex(event.key, currentIndex, tabLinks.length);
  if (nextIndex === null) return;
  event.preventDefault();
  tabLinks[nextIndex]?.focus();
}

export function PrivateTabs({ tabs, activeKey, ariaLabel, tabpanelId, className }: PrivateTabsProps) {
  return (
    <nav className={['private-tabs', className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          role="tab"
          tabIndex={activeKey === tab.key ? 0 : -1}
          aria-selected={activeKey === tab.key}
          aria-controls={tabpanelId}
          className={['private-tabs__tab', activeKey === tab.key ? 'is-active' : ''].filter(Boolean).join(' ')}
          href={tab.href}
          onKeyDown={handleTabKeyDown}
        >
          {tab.label}
          {typeof tab.badge === 'number' && tab.badge > 0 && <span className="private-tabs__badge">{tab.badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Exportarlo desde el índice**

En `src/components/private/ui/index.ts`, agregar (después de la línea que exporta `PrivateMenu`):

```ts
export { PrivateTabs } from './PrivateTabs';
export type { PrivateTabItem, PrivateTabsProps } from './PrivateTabs';
```

- [ ] **Step 3: Estilos base (token system "private")**

Al final de `src/components/private/ui/private-ui.css`, agregar:

```css
.private-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--private-color-border); }
.private-tabs__tab { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; border-bottom: 2px solid transparent; padding: 0 16px; color: var(--private-color-ink-muted); font-size: 12px; font-weight: 800; text-decoration: none; white-space: nowrap; }
.private-tabs__tab:hover, .private-tabs__tab:focus-visible { color: var(--private-color-brand); }
.private-tabs__tab.is-active { border-bottom-color: var(--private-color-accent); color: var(--private-color-brand); }
.private-tabs__badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; border-radius: 999px; background: var(--private-color-accent); padding: 0 5px; color: #fff; font-size: 10px; font-weight: 800; line-height: 1; }
```

- [ ] **Step 4: Verificar tipos y lint**

Run: `npx tsc --noEmit && npx eslint src/components/private/ui/PrivateTabs.tsx src/components/private/ui/index.ts`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/components/private/ui/PrivateTabs.tsx src/components/private/ui/index.ts src/components/private/ui/private-ui.css
git commit -m "feat: add reusable PrivateTabs primitive"
```

---

### Task 3: Diálogo de gestión de categorías

**Files:**
- Create: `src/components/StaffCatalogCategoryDialog.tsx`

**Interfaces:**
- Consumes: `PrivateDialog`, `PrivateSelect` (de `@/components/private/ui`); `readApiResponseOrThrow` (de `@/lib/api-response-error`); `buildCategoryTreeOrder`, `categoryDescendantIds`, `type Category` (de `@/lib/staff-catalog-types`, Task 1).
- Produces: `StaffCatalogCategoryDialog({ open, onClose, categories, canManage, onChanged }: StaffCatalogCategoryDialogProps)`. Task 4 (`StaffCatalogConceptsTab`) lo monta así: `<StaffCatalogCategoryDialog open={showCategoryDialog} onClose={() => setShowCategoryDialog(false)} categories={categories} canManage={capabilities.catalogManage} onChanged={() => { void loadCategories(); void loadItems(page, appliedSearch, selectedCategoryId); }} />`.

- [ ] **Step 1: Crear el componente**

```tsx
// src/components/StaffCatalogCategoryDialog.tsx
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
```

Nota: toda la lógica de `createCategory`/`startEdit`/`saveEdit`/`toggleStatus` es la misma que hoy vive en `StaffCatalogPanel.tsx:233-268`, solo renombrada (`startEditCategory`→`startEdit`, etc.) y con `onChanged()` reemplazando el `await refresh()` original (el padre decide qué recargar).

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/StaffCatalogCategoryDialog.tsx
git commit -m "feat: extract category management into its own dialog"
```

---

### Task 4: Pestaña "Conceptos"

**Files:**
- Create: `src/components/StaffCatalogConceptsTab.tsx`

**Interfaces:**
- Consumes: `PrivatePagination`, `PrivateSelect` (de `@/components/private/ui`); `StaffCatalogCategoryDialog` (Task 3); tipos/helpers de `@/lib/staff-catalog-types` (Task 1); `readApiResponse`, `readApiResponseOrThrow` (`@/lib/api-response-error`); `usePersistentState` (`@/lib/use-persistent-state`); `formatDate` (`@/lib/format-date`).
- Produces: `StaffCatalogConceptsTab({ capabilities }: StaffCatalogConceptsTabProps)` donde `StaffCatalogConceptsTabProps = { capabilities: CatalogCapabilities }`. Task 7 lo monta como `<StaffCatalogConceptsTab capabilities={capabilities} />`.

- [ ] **Step 1: Crear el componente**

```tsx
// src/components/StaffCatalogConceptsTab.tsx
'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { PrivatePagination, PrivateSelect } from '@/components/private/ui';
import StaffCatalogCategoryDialog from '@/components/StaffCatalogCategoryDialog';
import { formatDate } from '@/lib/format-date';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';
import { usePersistentState } from '@/lib/use-persistent-state';
import { buildCategoryTreeOrder, type CatalogCapabilities, type CatalogItem, type CatalogListResponse, type Category } from '@/lib/staff-catalog-types';

const CATALOG_UNIT_OPTIONS = ['pieza', 'servicio', 'hora', 'visita', 'm²', 'm³', 'lote', 'kit', 'mes'] as const;
const CATALOG_UNIT_CUSTOM = '__otra__';

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
  const [showItemForm, setShowItemForm] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [showArchived, setShowArchived, showArchivedHydrated] = usePersistentState('ocpool.staff.catalog.items.showArchived', false);
  const [itemForm, setItemForm] = useState({ code: '', useManualCode: false, name: '', unitPreset: 'pieza', unitCustom: '', description: '', categoryId: '' });
  const [editingItem, setEditingItem] = useState(false);
  const [itemEditForm, setItemEditForm] = useState({ name: '', description: '', unitPreset: 'pieza', unitCustom: '', categoryId: '' });

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

  const createItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const unit = itemForm.unitPreset === CATALOG_UNIT_CUSTOM ? itemForm.unitCustom.trim() : itemForm.unitPreset;
      const response = await fetch('/api/staff/catalog/items', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: itemForm.useManualCode ? itemForm.code : undefined, name: itemForm.name, unit, description: itemForm.description || undefined, categoryId: itemForm.categoryId || undefined }) });
      const created = await readApiResponseOrThrow<CatalogItem>(response, 'No fue posible completar la operación.');
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
        {capabilities.catalogManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowItemForm((current) => !current)}>{showItemForm ? 'Cerrar' : 'Nuevo concepto'}</button>}
      </div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {showItemForm && capabilities.catalogManage && (
        <form className="catalog-form" onSubmit={createItem}>
          <label className="catalog-filters__toggle"><input type="checkbox" checked={itemForm.useManualCode} onChange={(event) => setItemForm({ ...itemForm, useManualCode: event.target.checked })} /><span>Especificar clave manualmente</span></label>
          {itemForm.useManualCode && <label><span>Clave</span><input required value={itemForm.code} onChange={(event) => setItemForm({ ...itemForm, code: event.target.value })} placeholder="EQUIPO-001" maxLength={64} /></label>}
          <label><span>Nombre</span><input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Bomba de filtrado" maxLength={180} /></label>
          <PrivateSelect id="catalog-item-new-unit" label="Unidad" required value={itemForm.unitPreset} onValueChange={(value) => setItemForm({ ...itemForm, unitPreset: value })} options={[...CATALOG_UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })), { value: CATALOG_UNIT_CUSTOM, label: 'Otra…' }]} disabled={saving} />
          {itemForm.unitPreset === CATALOG_UNIT_CUSTOM && <label><span>Unidad personalizada</span><input required value={itemForm.unitCustom} onChange={(event) => setItemForm({ ...itemForm, unitCustom: event.target.value })} maxLength={40} /></label>}
          <PrivateSelect id="catalog-item-new-category" label="Categoría" value={itemForm.categoryId} onValueChange={(value) => setItemForm({ ...itemForm, categoryId: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} />
          <label><span>Descripción</span><textarea rows={3} value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} maxLength={2000} /></label>
          <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar concepto</button>
        </form>
      )}
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
                {capabilities.catalogManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowItemForm(true)}>Crear el primer concepto</button>}
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
          {selectedItem && !editingItem && (
            <div className="catalog-detail">
              <p>{selectedItem.description ?? 'Este concepto todavía no tiene descripción.'}</p>
              <dl>
                <div><dt>Categoría</dt><dd>{selectedItem.category?.name ?? 'Sin categoría'}</dd></div>
                <div><dt>Estado</dt><dd>{selectedItem.status === 'ACTIVE' ? 'Activo' : 'Archivado'}</dd></div>
              </dl>
            </div>
          )}
          {selectedItem && editingItem && (
            <form className="catalog-form" onSubmit={saveItemEdit}>
              <label><span>Nombre</span><input required value={itemEditForm.name} onChange={(event) => setItemEditForm({ ...itemEditForm, name: event.target.value })} maxLength={180} /></label>
              <PrivateSelect id="catalog-item-edit-unit" label="Unidad" required value={itemEditForm.unitPreset} onValueChange={(value) => setItemEditForm({ ...itemEditForm, unitPreset: value })} options={[...CATALOG_UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })), { value: CATALOG_UNIT_CUSTOM, label: 'Otra…' }]} disabled={saving} />
              {itemEditForm.unitPreset === CATALOG_UNIT_CUSTOM && <label><span>Unidad personalizada</span><input required value={itemEditForm.unitCustom} onChange={(event) => setItemEditForm({ ...itemEditForm, unitCustom: event.target.value })} maxLength={40} /></label>}
              <PrivateSelect id="catalog-item-edit-category" label="Categoría" value={itemEditForm.categoryId} onValueChange={(value) => setItemEditForm({ ...itemEditForm, categoryId: value })} options={categories.filter((category) => category.status === 'ACTIVE').map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} />
              <label><span>Descripción</span><textarea rows={3} value={itemEditForm.description} onChange={(event) => setItemEditForm({ ...itemEditForm, description: event.target.value })} maxLength={2000} /></label>
              <div className="catalog-form__actions">
                <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar cambios</button>
                <button className="staff-button" type="button" disabled={saving} onClick={() => setEditingItem(false)}>Cancelar</button>
              </div>
            </form>
          )}
        </section>
      </div>
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

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores (el import de `StaffCatalogPanel.tsx` todavía no existe hasta el Task 7, así que este archivo se valida de forma aislada).

- [ ] **Step 3: Commit**

```bash
git add src/components/StaffCatalogConceptsTab.tsx
git commit -m "feat: add standalone Conceptos tab with category tree filter"
```

---

### Task 5: Pestaña "Listas de precio"

**Files:**
- Create: `src/components/StaffCatalogPriceListsTab.tsx`

**Interfaces:**
- Consumes: `PrivateSelect`, `PrivateMoneyField`, `PrivateDatePicker` (de `@/components/private/ui`); tipos de `@/lib/staff-catalog-types` (Task 1); `readApiResponse`, `readApiResponseOrThrow`; `usePersistentState`; `formatDate`, `moneyLabel` (`@/lib/money`), `parseMoneyInput` (`@/lib/money-input`), `zonedCalendarDateToUtc` (`@/lib/calendar-timezone`).
- Produces: `StaffCatalogPriceListsTab({ capabilities }: StaffCatalogPriceListsTabProps)`. Task 7 lo monta como `<StaffCatalogPriceListsTab capabilities={capabilities} />`.

- [ ] **Step 1: Crear el componente**

```tsx
// src/components/StaffCatalogPriceListsTab.tsx
'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PrivateDatePicker, PrivateMoneyField, PrivateSelect } from '@/components/private/ui';
import { formatDate } from '@/lib/format-date';
import { zonedCalendarDateToUtc } from '@/lib/calendar-timezone';
import { moneyLabel } from '@/lib/money';
import { parseMoneyInput } from '@/lib/money-input';
import { usePersistentState } from '@/lib/use-persistent-state';
import { readApiResponseOrThrow, type ApiResponseErrorKind } from '@/lib/api-response-error';
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
        {capabilities.pricesManage && <button className="staff-button staff-button--copper" type="button" onClick={() => setShowPriceListForm((current) => !current)}>{showPriceListForm ? 'Cerrar' : 'Nueva lista'}</button>}
      </div>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {showPriceListForm && capabilities.pricesManage && (
        <form className="catalog-form" onSubmit={createPriceList}>
          <label><span>Clave</span><input required value={priceListForm.code} onChange={(event) => setPriceListForm({ ...priceListForm, code: event.target.value })} placeholder="LISTA-MXN" maxLength={64} /></label>
          <label><span>Nombre</span><input required value={priceListForm.name} onChange={(event) => setPriceListForm({ ...priceListForm, name: event.target.value })} placeholder="Lista residencial" maxLength={180} /></label>
          <label><span>Moneda</span><input required value={priceListForm.currencyCode} onChange={(event) => setPriceListForm({ ...priceListForm, currencyCode: event.target.value.toUpperCase() })} maxLength={3} /></label>
          <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Crear lista</button>
        </form>
      )}
      <div className="catalog-pricelists__body">
        <aside className="catalog-rail">
          <label className="catalog-filters__toggle catalog-pricelists__archived"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Mostrar archivadas</span></label>
          {loading && <div className="staff-list-placeholder"><span /><span /><span /></div>}
          {!loading && priceLists.length === 0 && <div className="staff-empty staff-empty--compact"><h2>Todavía no tienes listas de precio</h2><p>Crea una lista para empezar a programar precios de tus conceptos.</p></div>}
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
                {capabilities.pricesManage && !editingPriceList && (
                  <div className="catalog-main__actions">
                    <button className="staff-button" type="button" disabled={saving} onClick={startEditPriceList}>Editar</button>
                    <button className="staff-button" type="button" disabled={saving} onClick={() => void togglePriceListStatus()}>{priceListDetail.status === 'ACTIVE' ? 'Archivar' : 'Reactivar'}</button>
                  </div>
                )}
              </div>
              {editingPriceList && (
                <form className="catalog-form catalog-form--inline" onSubmit={savePriceListEdit}>
                  <label><span>Nombre</span><input required value={priceListEditForm.name} onChange={(event) => setPriceListEditForm({ name: event.target.value })} maxLength={180} /></label>
                  <div className="catalog-form__actions">
                    <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Guardar cambios</button>
                    <button className="staff-button" type="button" disabled={saving} onClick={() => setEditingPriceList(false)}>Cancelar</button>
                  </div>
                </form>
              )}
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
              {capabilities.pricesManage && priceListDetail.status === 'ACTIVE' && (
                <form className="catalog-form catalog-form--price" onSubmit={schedulePriceForItem}>
                  <p className="staff-section-label">Programar precio</p>
                  <PrivateSelect id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={pricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Selecciona un concepto" disabled={saving} />
                  <PrivateMoneyField id="catalog-price-amount" label="Importe" value={priceForm.amountInput} onValueChange={(value) => setPriceForm({ ...priceForm, amountInput: value })} placeholder="1,250.00" required disabled={saving} />
                  <PrivateDatePicker id="catalog-price-effective-from" label="Vigente desde" required value={priceForm.effectiveFrom} onValueChange={(value) => setPriceForm({ ...priceForm, effectiveFrom: value })} disabled={saving} />
                  <label><span>Motivo opcional</span><input value={priceForm.reason} onChange={(event) => setPriceForm({ ...priceForm, reason: event.target.value })} placeholder="Ajuste de proveedor" maxLength={300} /></label>
                  {previewText && <p className="catalog-form__preview" aria-live="polite">{previewText}</p>}
                  <button className="staff-button staff-button--dark" type="submit" disabled={saving}>Programar precio</button>
                </form>
              )}
              {capabilities.pricesManage && priceListDetail.status === 'ARCHIVED' && <p className="catalog-form__note">Esta lista está archivada. Reactívala para poder programar nuevos precios.</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
```

Nota sobre `ApiResponseErrorKind`: se importa el tipo aunque no se use explícitamente en este archivo porque `readApiResponseOrThrow` no lo requiere — **eliminar ese import si `tsc`/`eslint` lo marca como no usado** (ver Step 2).

- [ ] **Step 2: Verificar tipos y lint; quitar imports no usados si aplica**

Run: `npx tsc --noEmit && npx eslint src/components/StaffCatalogPriceListsTab.tsx`
Expected: si `ApiResponseErrorKind` aparece como import no usado, quitar esa parte del import (`import { readApiResponseOrThrow } from '@/lib/api-response-error';`) y volver a correr el comando hasta que quede limpio.

- [ ] **Step 3: Commit**

```bash
git add src/components/StaffCatalogPriceListsTab.tsx
git commit -m "feat: add standalone Listas de precio tab"
```

---

### Task 6: Pestaña "Por revisar"

**Files:**
- Create: `src/components/StaffCatalogReviewTab.tsx`

**Interfaces:**
- Consumes: `PrivateSelect` (de `@/components/private/ui`); tipos de `@/lib/staff-catalog-types` (Task 1); `readApiResponseOrThrow`.
- Produces: `StaffCatalogReviewTab({ onPromoted }: StaffCatalogReviewTabProps)` donde `StaffCatalogReviewTabProps = { onPromoted: () => void }`. Task 7 lo monta como `<StaffCatalogReviewTab onPromoted={() => setPendingReviewCount((current) => Math.max(0, current - 1))} />`.

- [ ] **Step 1: Crear el componente**

```tsx
// src/components/StaffCatalogReviewTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { PrivateSelect } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import type { Category, SpecialConceptGroup } from '@/lib/staff-catalog-types';

export type StaffCatalogReviewTabProps = { onPromoted: () => void };

export default function StaffCatalogReviewTab({ onPromoted }: StaffCatalogReviewTabProps) {
  const [groups, setGroups] = useState<SpecialConceptGroup[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryByGroup, setCategoryByGroup] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [groupsResponse, categoriesResponse] = await Promise.all([
          fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/staff/catalog/categories?status=ACTIVE', { credentials: 'include', cache: 'no-store' }),
        ]);
        const [groupsData, categoriesData] = await Promise.all([
          readApiResponseOrThrow<SpecialConceptGroup[]>(groupsResponse, 'No fue posible cargar los conceptos por revisar.'),
          readApiResponseOrThrow<Category[]>(categoriesResponse, 'No fue posible cargar las categorías.'),
        ]);
        if (cancelled) return;
        setGroups(groupsData);
        setCategories(categoriesData);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'No fue posible cargar los conceptos por revisar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reloadGroups = async () => {
    const response = await fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' });
    setGroups(await readApiResponseOrThrow<SpecialConceptGroup[]>(response, 'No fue posible completar la operación.'));
  };

  const promoteGroup = async (group: SpecialConceptGroup) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const key = `${group.normalizedName}::${group.unit}`;
      const categoryId = categoryByGroup[key];
      const response = await fetch('/api/staff/catalog/special-concepts/promote', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: group.name, unit: group.unit, categoryId: categoryId || undefined }) });
      const result = await readApiResponseOrThrow<{ catalogItem: { id: string; code: string; name: string }; alreadyPromoted: boolean }>(response, 'No fue posible completar la operación.');
      setNotice(`Concepto ${result.catalogItem.code} · ${result.catalogItem.name} vinculado.`);
      await reloadGroups();
      onPromoted();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible promover el concepto.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="catalog-review">
      <p className="catalog-tab-intro">Texto libre usado en propuestas que todavía no es un concepto real del catálogo.</p>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {loading && <div className="catalog-detail-loading"><span /><span /></div>}
      {!loading && groups && groups.length === 0 && <p className="catalog-form__note">No hay conceptos especiales pendientes de revisión.</p>}
      {!loading && groups && groups.length > 0 && (
        <div className="catalog-review-list">
          {groups.map((group) => {
            const key = `${group.normalizedName}::${group.unit}`;
            return (
              <div className="catalog-review-row" key={key}>
                <span>
                  <strong>{group.name}</strong>
                  <small>{group.unit} · {group.occurrences} {group.occurrences === 1 ? 'cotización' : 'cotizaciones'} · {group.recentFolios.join(', ')}</small>
                </span>
                {group.status === 'PROMOTED' && <small className="catalog-special-status catalog-special-status--done">Promovido a {group.matchingCatalogItem!.code} · {group.matchingCatalogItem!.name}</small>}
                {group.status === 'MATCHES_EXISTING' && (
                  <div className="catalog-review-row__actions">
                    <small className="catalog-special-status">Ya existe {group.matchingCatalogItem!.code} · {group.matchingCatalogItem!.name}</small>
                    <button className="staff-button" type="button" disabled={saving} onClick={() => void promoteGroup(group)}>Vincular</button>
                  </div>
                )}
                {group.status === 'PENDING' && (
                  <div className="catalog-review-row__actions">
                    <PrivateSelect id={`special-concept-category-${key}`} label={`Categoría para ${group.name}`} hideLabel value={categoryByGroup[key] ?? ''} onValueChange={(value) => setCategoryByGroup({ ...categoryByGroup, [key]: value })} options={categories.map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} />
                    <button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void promoteGroup(group)}>Promover a catálogo</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/StaffCatalogReviewTab.tsx
git commit -m "feat: add standalone Por revisar tab for special concepts"
```

---

### Task 7: Shell (`StaffCatalogPanel`) + CSS + regresión completa

**Files:**
- Modify: `src/components/StaffCatalogPanel.tsx` (reescritura completa, de 434 líneas a shell)
- Modify: `src/app/globals.css:1003-1101` (reemplazar el bloque de CSS de catálogo)

**Interfaces:**
- Consumes: `StaffCatalogConceptsTab` (Task 4), `StaffCatalogPriceListsTab` (Task 5), `StaffCatalogReviewTab` (Task 6), `PrivateTabs` (Task 2), tipos de `@/lib/staff-catalog-types` (Task 1).
- Produces: nada nuevo — es la página final montada en `src/app/staff/catalog/page.tsx` (sin cambios en ese archivo, sigue haciendo `import StaffCatalogPanel from '@/components/StaffCatalogPanel'`).

- [ ] **Step 1: Reescribir el shell**

Reemplazar **todo el contenido** de `src/components/StaffCatalogPanel.tsx` por:

```tsx
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import StaffTopNav from '@/components/StaffTopNav';
import StaffCatalogConceptsTab from '@/components/StaffCatalogConceptsTab';
import StaffCatalogPriceListsTab from '@/components/StaffCatalogPriceListsTab';
import StaffCatalogReviewTab from '@/components/StaffCatalogReviewTab';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateLinkButton, PrivateSkeleton, PrivateTabs } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import type { CatalogCapabilities, SpecialConceptGroup } from '@/lib/staff-catalog-types';

const CATALOG_TABS = ['items', 'price-lists', 'review'] as const;
type CatalogTab = (typeof CATALOG_TABS)[number];

function normalizeCatalogTab(value: string | null, canReview: boolean): CatalogTab {
  if (value === 'price-lists') return 'price-lists';
  if (value === 'review' && canReview) return 'review';
  return 'items';
}

function catalogTabHref(tab: CatalogTab): string {
  return tab === 'items' ? '/staff/catalog' : `/staff/catalog?tab=${tab}`;
}

const TAB_LABELS: Record<CatalogTab, string> = { items: 'Conceptos', 'price-lists': 'Listas de precio', review: 'Por revisar' };

export default function StaffCatalogPanel() {
  const searchParams = useSearchParams();
  const [capabilities, setCapabilities] = useState<CatalogCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/staff/capabilities', { credentials: 'include', cache: 'no-store' });
        const data = await readApiResponseOrThrow<CatalogCapabilities>(response, 'No fue posible validar los permisos.');
        if (cancelled) return;
        setCapabilities(data);
        if (data.catalogManage) {
          const specialResponse = await fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' });
          const groups = await readApiResponseOrThrow<SpecialConceptGroup[]>(specialResponse, 'No fue posible cargar los conceptos por revisar.');
          if (!cancelled) setPendingReviewCount(groups.filter((group) => group.status !== 'PROMOTED').length);
        }
      } catch (caught) {
        if (!cancelled) setCapabilitiesError(caught instanceof Error ? caught.message : 'No fue posible validar los permisos.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeTab = normalizeCatalogTab(searchParams.get('tab'), capabilities?.catalogManage ?? false);

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <header className="staff-header">
        <WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" />
        <StaffTopNav />
        <div className="staff-header__tools">
          <Link className="staff-header__home" href="/staff">Volver al dashboard</Link>
          <div className="staff-header__context"><span className="staff-header__pulse" aria-hidden="true" /> Catálogo y precios</div>
        </div>
      </header>
      <div className="staff-content catalog-content">
        <div className="staff-intro">
          <div>
            <p className="staff-kicker">Fuente comercial</p>
            <h1>Catálogo</h1>
            <p className="staff-intro__copy">Conceptos, listas de precio y conceptos especiales pendientes de revisar, cada uno en su propio lugar.</p>
          </div>
        </div>
        {capabilitiesError && <PrivateBlockingState title="No fue posible validar las acciones." onRetry={() => window.location.reload()}>{capabilitiesError}</PrivateBlockingState>}
        {!capabilitiesError && !capabilities && <PrivateSkeleton label="Validando permisos" />}
        {!capabilitiesError && capabilities && !capabilities.catalogRead && (
          <PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton><PrivateLinkButton href="/" variant="quiet">Volver al sitio</PrivateLinkButton></div>}>
            Inicia sesión con una cuenta de empleado autorizada para consultar el catálogo.
          </PrivateBlockingState>
        )}
        {!capabilitiesError && capabilities && capabilities.catalogRead && (
          <>
            <PrivateTabs
              ariaLabel="Secciones del catálogo"
              tabpanelId="catalog-tabpanel"
              activeKey={activeTab}
              tabs={[
                { key: 'items', label: TAB_LABELS.items, href: catalogTabHref('items') },
                { key: 'price-lists', label: TAB_LABELS['price-lists'], href: catalogTabHref('price-lists') },
                ...(capabilities.catalogManage ? [{ key: 'review', label: TAB_LABELS.review, href: catalogTabHref('review'), badge: pendingReviewCount }] : []),
              ]}
            />
            <section id="catalog-tabpanel" role="tabpanel" aria-label={TAB_LABELS[activeTab]} className="catalog-tabpanel">
              {activeTab === 'items' && <StaffCatalogConceptsTab capabilities={capabilities} />}
              {activeTab === 'price-lists' && <StaffCatalogPriceListsTab capabilities={capabilities} />}
              {activeTab === 'review' && capabilities.catalogManage && <StaffCatalogReviewTab onPromoted={() => setPendingReviewCount((current) => Math.max(0, current - 1))} />}
            </section>
          </>
        )}
      </div>
    </PrivateSurfaceRoot>
  );
}
```

- [ ] **Step 2: Reemplazar el bloque de CSS de catálogo**

En `src/app/globals.css`, el bloque actual de catálogo va de la línea 1003 (`.catalog-workspace { ... }`) a la línea 1101 (cierre del `@media (prefers-reduced-motion: reduce)` que solo tiene `.catalog-detail-loading span { animation: none; }`), justo antes de que empiece `.quotes-workspace { ... }` en la línea 1103. Reemplazar **todo ese rango** (1003-1101) por:

```css
.catalog-tabpanel { padding-top: 24px; }
.catalog-tab-intro { max-width: 560px; margin: 0 0 18px; color: var(--staff-muted); font-size: 12px; }
.catalog-concepts__toolbar, .catalog-pricelists .catalog-concepts__toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.catalog-concepts__body { display: grid; grid-template-columns: 190px minmax(240px, .8fr) minmax(0, 1.4fr); gap: 0; margin-top: 18px; border: 1px solid var(--staff-line); background: var(--staff-paper); }
.catalog-concepts__categories { display: flex; flex-direction: column; gap: 2px; padding: 18px 14px; border-right: 1px solid var(--staff-line); }
.catalog-tree-row { border: 0; border-left: 2px solid transparent; background: transparent; padding: 7px 8px; color: var(--staff-ink); font-size: 12px; text-align: left; }
.catalog-tree-row:hover, .catalog-tree-row.is-selected { border-left-color: var(--copper); background: #f2eee6; }
.catalog-tree-manage { margin-top: 10px; padding-top: 10px; border: 0; border-top: 1px solid var(--staff-line); background: transparent; color: var(--staff-muted); font-size: 10px; font-weight: 700; letter-spacing: .04em; text-decoration: underline; text-align: left; text-transform: uppercase; }
.catalog-concepts__list { display: flex; min-width: 0; flex-direction: column; border-right: 1px solid var(--staff-line); }
.catalog-item-list { min-height: 0; flex: 1; }
.catalog-item-row { display: grid; width: 100%; gap: 4px; border: 0; border-top: 1px solid rgba(24,37,42,.1); border-left: 2px solid transparent; padding: 17px 20px 16px; background: transparent; color: var(--staff-ink); text-align: left; }
.catalog-item-row:hover, .catalog-item-row.is-selected { border-left-color: var(--copper); background: #f2eee6; }
.catalog-item-row__code { color: var(--copper); font-size: 9px; font-weight: 800; letter-spacing: .12em; }
.catalog-item-row strong { overflow: hidden; color: var(--staff-deep); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.catalog-item-row small { overflow: hidden; color: var(--staff-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.catalog-concepts__detail, .catalog-main { min-width: 0; padding: clamp(20px, 3vw, 36px); }
.catalog-main__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 22px; border-bottom: 1px solid var(--staff-line); }
.catalog-main__top > div { min-width: 0; }
.catalog-main__top h2 { margin: 0; color: var(--staff-deep); font-family: var(--private-font-display); font-size: clamp(28px, 3.4vw, 44px); font-weight: 500; letter-spacing: -.05em; line-height: .9; overflow-wrap: anywhere; }
.catalog-main__meta { margin: 13px 0 0; color: var(--staff-muted); font-size: 11px; }
.catalog-main__actions { display: flex; flex-shrink: 0; gap: 10px; }
.catalog-detail { padding: 22px 0; }
.catalog-detail > p { max-width: 640px; margin: 0; color: var(--staff-ink); font-family: var(--private-font-display); font-size: 19px; line-height: 1.2; }
.catalog-detail dl { display: flex; flex-wrap: wrap; gap: 28px; margin: 22px 0 0; }
.catalog-detail dl div { display: grid; gap: 3px; }
.catalog-detail dt { color: var(--staff-muted); font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.catalog-detail dd { margin: 0; color: var(--staff-deep); font-size: 12px; font-weight: 700; }
.catalog-pricelists__body { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.4fr); gap: 0; margin-top: 18px; border: 1px solid var(--staff-line); background: var(--staff-paper); }
.catalog-rail { display: flex; min-width: 0; flex-direction: column; border-right: 1px solid var(--staff-line); padding: 14px 0; }
.catalog-pricelists__archived { padding: 0 16px 12px; }
.catalog-list-picker { display: grid; gap: 1px; border-top: 1px solid var(--staff-line); }
.catalog-list-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; border: 0; border-bottom: 1px solid var(--staff-line); border-left: 2px solid transparent; padding: 13px 16px; background: transparent; color: var(--staff-ink); text-align: left; }
.catalog-list-row:hover, .catalog-list-row.is-selected { border-left-color: var(--copper); background: #f2eee6; }
.catalog-list-row span { display: grid; min-width: 0; gap: 3px; }
.catalog-list-row strong { overflow: hidden; color: var(--staff-deep); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.catalog-list-row small, .catalog-list-row b { color: var(--staff-muted); font-size: 9px; font-weight: 600; }
.catalog-list-row b { white-space: nowrap; }
.catalog-price-summary { display: flex; justify-content: space-between; gap: 15px; color: var(--staff-muted); font-size: 10px; }
.catalog-price-summary span { min-width: 0; overflow-wrap: anywhere; }
.catalog-price-summary strong { color: var(--staff-deep); font-weight: 800; }
.catalog-price-table { margin-top: 10px; border-top: 1px solid var(--staff-line); }
.catalog-price-table__head, .catalog-price-table__row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(90px, .55fr) minmax(125px, .75fr); gap: 14px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--staff-line); }
.catalog-price-table__head { color: var(--staff-muted); font-size: 9px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
.catalog-price-table__row strong, .catalog-price-table__row b { display: block; color: var(--staff-deep); font-size: 11px; }
.catalog-price-table__row small { display: block; overflow: hidden; color: var(--staff-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.catalog-price-table__row b { font-size: 13px; font-weight: 700; }
.catalog-detail-loading { display: grid; gap: 8px; margin-top: 22px; }
.catalog-detail-loading span { height: 16px; background: rgba(24,37,42,.08); animation: staff-shimmer 1.4s ease-in-out infinite; }
.catalog-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; margin-top: 18px; padding: 18px; border: 1px solid var(--staff-line); background: rgba(239,235,226,.6); }
.catalog-form label { display: grid; gap: 6px; }
.catalog-form label span, .catalog-form > p { color: var(--staff-muted); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.catalog-form input, .catalog-form select, .catalog-form textarea { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
.catalog-form textarea { resize: vertical; }
.catalog-form button, .catalog-form > p, .catalog-form__pair { grid-column: 1 / -1; }
.catalog-form__pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.catalog-form--price { margin-top: 26px; }
.catalog-form--price > p { margin: 0; }
.catalog-form p.catalog-form__preview { padding: 10px 12px; border: 1px solid var(--staff-line); background: var(--staff-paper); color: var(--staff-ink); font-size: 11px; font-weight: 400; letter-spacing: normal; text-transform: none; }
.staff-filters label.catalog-filters__toggle, .catalog-form label.catalog-filters__toggle { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.catalog-form label.catalog-filters__toggle { grid-column: 1 / -1; }
.catalog-filters__toggle input { width: auto; min-height: 0; }
.catalog-filters__toggle span { color: var(--staff-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.catalog-form__actions { display: flex; grid-column: 1 / -1; gap: 10px; }
.catalog-form__note { margin: 18px 0 0; padding: 12px 14px; border: 1px solid var(--staff-line); background: rgba(239,235,226,.6); color: var(--staff-muted); font-size: 11px; }
.catalog-form--inline { margin-top: 14px; }
.catalog-category-list { display: grid; gap: 1px; margin-top: 14px; border-top: 1px solid var(--staff-line); }
.catalog-category-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; border-bottom: 1px solid var(--staff-line); padding: 13px 2px; min-width: 0; overflow: hidden; }
.catalog-category-row span { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 3px; }
.catalog-category-row strong { overflow: hidden; color: var(--staff-deep); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.catalog-category-row small { color: var(--staff-muted); font-size: 9px; font-weight: 600; }
.catalog-category-row__actions { display: flex; flex-shrink: 0; gap: 8px; }
.catalog-category-row .catalog-form--inline { flex: 1; }
.catalog-category-row__actions .private-select__trigger { width: 200px; }
.catalog-price-group { margin-top: 22px; }
.catalog-price-group__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--staff-muted); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.catalog-price-group__empty { margin: 8px 0 0; color: var(--staff-muted); font-size: 10px; }
.catalog-price-group .catalog-price-table { margin-top: 8px; }
.catalog-review-list { display: grid; gap: 1px; margin-top: 16px; border-top: 1px solid var(--staff-line); }
.catalog-review-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; border-bottom: 1px solid var(--staff-line); padding: 15px 2px; min-width: 0; }
.catalog-review-row span { display: grid; min-width: 0; gap: 3px; }
.catalog-review-row strong { overflow: hidden; color: var(--staff-deep); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.catalog-review-row small { color: var(--staff-muted); font-size: 9px; font-weight: 600; overflow-wrap: anywhere; }
.catalog-review-row__actions { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.catalog-review-row__actions .private-select__trigger { width: 200px; }
.catalog-special-status { color: var(--staff-muted); font-size: 10px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.catalog-special-status--done { color: #2e634f; }
.catalog-category-dialog { position: fixed; top: 50%; left: 50%; z-index: 30; width: min(640px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 64px)); overflow-y: auto; transform: translate(-50%, -50%); border: 1px solid var(--staff-line); background: var(--staff-paper); padding: 26px; }
.catalog-category-dialog__overlay { position: fixed; inset: 0; z-index: 29; background: rgba(9,36,51,.45); }
.catalog-category-dialog__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.catalog-category-dialog__head h2 { margin: 0; color: var(--staff-deep); font-family: var(--private-font-display); font-size: 24px; font-weight: 500; }
.staff-shell .private-tabs { margin-top: 24px; }
.staff-shell .private-tabs__tab.is-active { border-bottom-color: var(--copper); color: var(--staff-deep); }
.staff-shell .private-tabs__tab:hover, .staff-shell .private-tabs__tab:focus-visible { color: var(--staff-deep); }
.staff-shell .private-tabs__badge { background: var(--copper); }

@media (max-width: 980px) {
  .catalog-concepts__body, .catalog-pricelists__body { grid-template-columns: 1fr; }
  .catalog-concepts__categories, .catalog-rail { border-right: 0; border-bottom: 1px solid var(--staff-line); }
  .catalog-concepts__list { border-right: 0; border-bottom: 1px solid var(--staff-line); }
  .catalog-item-list { max-height: 360px; overflow-y: auto; }
}

@media (max-width: 620px) {
  .catalog-concepts__toolbar { flex-direction: column; align-items: stretch; }
  .catalog-main, .catalog-concepts__detail { padding: 20px 16px 30px; }
  .catalog-main__top { align-items: flex-start; flex-direction: column; }
  .catalog-main__actions { flex-wrap: wrap; }
  .catalog-price-summary { flex-wrap: wrap; }
  .catalog-price-table__head, .catalog-price-table__row { grid-template-columns: minmax(0, 1.25fr) minmax(80px, .75fr); }
  .catalog-price-table__head span:last-child, .catalog-price-table__row > small { display: none; }
  .catalog-form, .catalog-form__pair { grid-template-columns: 1fr; }
  .catalog-category-row, .catalog-review-row { flex-direction: column; align-items: flex-start; gap: 8px; }
  .catalog-category-row__actions, .catalog-review-row__actions { width: 100%; flex-wrap: wrap; }
  .catalog-category-row__actions .private-select__trigger, .catalog-review-row__actions .private-select__trigger { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-detail-loading span { animation: none; }
}
```

- [ ] **Step 3: Verificar tipos y lint**

Run: `npx tsc --noEmit && npx eslint src/components/StaffCatalogPanel.tsx src/app/globals.css`
Expected: sin errores. Si `eslint` no cubre `.css`, omitir esa parte del comando (`npx eslint src/components/StaffCatalogPanel.tsx`).

- [ ] **Step 4: Verificación manual en el navegador**

Levantar el servidor de desarrollo, entrar como un usuario `manager` (o el fixture de pruebas) a `/staff/catalog`, y confirmar visualmente:
- Las 3 pestañas aparecen, "Conceptos" es la que carga por defecto.
- El árbol de categorías filtra la lista al hacer clic.
- "Nuevo concepto" crea un concepto y aparece en la lista.
- Cambiar a "Listas de precio" muestra el master-detail y "Nueva lista" funciona.
- "Por revisar" muestra el badge en la pestaña si hay conceptos especiales pendientes (crear una cotización con un concepto especial vía la UI de cotizaciones si hace falta un fixture, o confiar en el fixture del E2E del Task 8).
- No hay overflow horizontal en 360px/768px/1440px (usar las herramientas de responsive del navegador).

- [ ] **Step 5: Regresión completa (primera vez, punto de verificación por bloque)**

Run: `npm run typecheck && npm run test:unit && npm run lint`
Expected: todo en verde. (La integración y E2E completos se corren al cierre del Task 8, junto con la reescritura de `tests/catalog.spec.ts`, para no duplicar la corrida pesada dos veces seguidas.)

- [ ] **Step 6: Commit**

```bash
git add src/components/StaffCatalogPanel.tsx src/app/globals.css
git commit -m "refactor: replace monolithic StaffCatalogPanel with tabbed shell"
```

---

### Task 8: Reescribir `tests/catalog.spec.ts`

**Files:**
- Modify: `tests/catalog.spec.ts` (reescritura completa del cuerpo del test; `beforeAll`/`afterAll`/fixtures se mantienen igual — no cambian porque no dependen de la UI)

**Interfaces:**
- No produce nada nuevo; consume la UI de los Tasks 4-7.

- [ ] **Step 1: Reemplazar el cuerpo del test (línea 113 en adelante, dentro de `test('manages concepts and dated prices without losing responsive usability', ...)`)**

Mantener sin cambios las líneas 1-112 (imports, `test.describe`, `test.skip`, `beforeAll`, `afterAll`) y reemplazar el contenido de la función de test (líneas 113-283) por:

```ts
  test('manages concepts and dated prices without losing responsive usability', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.context().addCookies([{ name: 'ocpool_session', value: sessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/staff/catalog');

    await expect(page.getByRole('heading', { name: 'Catálogo', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al dashboard' })).toHaveAttribute('href', '/staff');
    await expect(page.getByRole('tab', { name: 'Conceptos' })).toHaveAttribute('aria-selected', 'true');

    // --- Pestaña Conceptos: alta, edición, archivado/reactivado ---
    const fixtureItemRow = page.getByRole('button', { name: new RegExp(itemCode) });
    await expect(fixtureItemRow).toBeVisible();
    await fixtureItemRow.click();
    await expectNoSeriousA11yViolations(page);

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

    const itemActions = page.locator('.catalog-main__top .catalog-main__actions');
    await itemActions.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto archivado.');
    await expect(page.getByRole('button', { name: new RegExp(createdItemCode) })).toHaveCount(0);

    // Categorías ahora viven en el diálogo "Gestionar categorías".
    await page.getByRole('button', { name: 'Gestionar categorías' }).click();
    const categoryDialog = page.getByRole('dialog', { name: 'Categorías del catálogo' });
    await expect(categoryDialog).toBeVisible();
    await categoryDialog.getByRole('button', { name: 'Nueva categoría' }).click();
    await categoryDialog.getByLabel('Nombre', { exact: true }).fill(`Categoría nueva ${suffix}`);
    await categoryDialog.getByRole('button', { name: 'Crear categoría' }).click();
    const categoryNotice = await categoryDialog.getByRole('status').innerText();
    const categoryMatch = /Categoría (CAT-\d{6}) creada\./.exec(categoryNotice);
    expect(categoryMatch).not.toBeNull();
    const newCategoryCode = categoryMatch![1];
    newCategoryId = (await prisma.catalogCategory.findUniqueOrThrow({ where: { code: newCategoryCode }, select: { id: true } })).id;
    await expect(categoryDialog.locator('.catalog-category-row', { hasText: newCategoryCode })).toBeVisible();

    await categoryDialog.getByRole('button', { name: 'Nueva categoría' }).click();
    await categoryDialog.getByLabel('Nombre', { exact: true }).fill(`Subcategoría E2E ${suffix}`);
    await categoryDialog.getByRole('combobox', { name: 'Categoría padre' }).click();
    await page.getByRole('option', { name: `Categoría nueva ${suffix}`, exact: true }).click();
    await categoryDialog.getByRole('button', { name: 'Crear categoría' }).click();
    const childNotice = await categoryDialog.getByRole('status').innerText();
    const childMatch = /Categoría (CAT-\d{6}) creada\./.exec(childNotice);
    expect(childMatch).not.toBeNull();
    const childCategoryCode = childMatch![1];
    childCategoryId = (await prisma.catalogCategory.findUniqueOrThrow({ where: { code: childCategoryCode }, select: { id: true } })).id;
    await expect(categoryDialog.locator('.catalog-category-row', { hasText: childCategoryCode })).toContainText(`en Categoría nueva ${suffix}`);
    await categoryDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(categoryDialog).not.toBeVisible();

    // El árbol de categorías filtra la lista de conceptos.
    await page.getByRole('button', { name: `Categoría nueva ${suffix}` }).click();
    await expect(page.getByRole('button', { name: new RegExp(itemCode) })).toHaveCount(0);
    await page.getByRole('button', { name: 'Todos' }).click();
    await expect(fixtureItemRow).toBeVisible();

    await fixtureItemRow.click();
    await itemActions.getByRole('button', { name: 'Editar' }).click();
    const editedItemName = `Concepto E2E editado ${suffix}`;
    await page.getByLabel('Nombre', { exact: true }).fill(editedItemName);
    await page.getByRole('combobox', { name: 'Unidad', exact: true }).click();
    await page.getByRole('option', { name: 'lote', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto actualizado.');
    await expect(fixtureItemRow).toContainText(editedItemName);

    await itemActions.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto archivado.');
    await expect(page.getByRole('button', { name: new RegExp(itemCode) })).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Mostrar archivados' }).check();
    await expect(fixtureItemRow).toBeVisible();
    await expect(fixtureItemRow).toContainText('Archivado');
    await fixtureItemRow.click();
    await itemActions.getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByRole('status')).toContainText('Concepto reactivado.');
    await page.getByRole('checkbox', { name: 'Mostrar archivados' }).uncheck();

    // --- Pestaña Listas de precio ---
    await page.getByRole('tab', { name: 'Listas de precio' }).click();
    await expect(page.getByRole('tab', { name: 'Listas de precio' })).toHaveAttribute('aria-selected', 'true');
    const fixturePriceList = page.getByRole('button', { name: new RegExp(priceListCode) });
    await expect(fixturePriceList).toBeVisible();
    await fixturePriceList.click();
    await expect(page.getByRole('table', { name: 'Precios vigentes' })).toContainText('MXN 1,250.00');
    await expectNoSeriousA11yViolations(page);

    const effectiveFrom = page.getByRole('textbox', { name: 'Vigente desde', exact: true });
    await page.getByRole('combobox', { name: 'Concepto' }).click();
    await page.getByRole('option', { name: new RegExp(`^${itemCode} ·`) }).click();
    await expect(page.locator('.catalog-form__preview')).toContainText('Se cerrará el precio vigente de MXN 1,250.00');

    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('1100.00');
    await effectiveFrom.fill('2026-02-01');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    await expect(page.getByRole('status')).toContainText('Precio programado.');

    await effectiveFrom.fill('');
    await page.getByRole('textbox', { name: 'Importe', exact: true }).fill('990.00');
    await page.getByRole('button', { name: 'Programar precio' }).click();
    expect(await effectiveFrom.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);

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

    await priceListActions.getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status')).toContainText('Lista archivada.');
    await expect(page.getByText('Esta lista está archivada.')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Mostrar archivadas' }).check();
    await expect(fixturePriceList).toContainText('Archivada');
    await priceListActions.getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByRole('status')).toContainText('Lista reactivada.');
    await page.getByRole('checkbox', { name: 'Mostrar archivadas' }).uncheck();

    // --- Pestaña Por revisar ---
    await page.getByRole('tab', { name: 'Por revisar' }).click();
    await expect(page.getByRole('tab', { name: 'Por revisar' })).toHaveAttribute('aria-selected', 'true');
    const specialRow = page.locator('.catalog-review-row', { hasText: specialConceptName });
    await expect(specialRow).toBeVisible();
    await specialRow.getByRole('combobox').click();
    await page.getByRole('option', { name: `Categoría nueva ${suffix}`, exact: true }).click();
    await specialRow.getByRole('button', { name: 'Promover a catálogo' }).click();
    await expect(page.getByRole('status')).toContainText('vinculado.');
    await expect(specialRow).toContainText('Promovido a');

    await page.getByRole('tab', { name: 'Conceptos' }).click();
    await page.getByLabel('Buscar concepto', { exact: true }).fill(specialConceptName);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(specialConceptName) })).toBeVisible();
    promotedItemId = (await prisma.catalogItem.findFirstOrThrow({ where: { name: specialConceptName }, select: { id: true } })).id;

    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll<HTMLElement>('*')]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > viewportWidth + 1 || rect.left < -1)
          .slice(0, 20)
          .map(({ element, rect }) => ({ tag: element.tagName, className: element.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), text: element.textContent?.trim().slice(0, 80) }));
        return { scrollWidth: document.documentElement.scrollWidth, viewportWidth, offenders };
      });
      expect(layout.scrollWidth <= layout.viewportWidth, `horizontal overflow at ${width}px: ${JSON.stringify(layout)}`).toBe(true);
    }
    expect(consoleErrors).toEqual([]);
  });
```

Cambios respecto al original, todos intencionales:
- Cada bloque ahora empieza navegando a su pestaña con `page.getByRole('tab', { name: ... }).click()`.
- "Agregar concepto" → "Nuevo concepto" (nuevo texto del botón, ver Task 4).
- Las acciones de categoría se buscan dentro de `categoryDialog` (el diálogo abierto), no en la página completa.
- Se agregan dos aserciones nuevas: filtrar por categoría en el árbol oculta/muestra conceptos, y el checkbox de "Mostrar archivados" de listas de precio ahora es independiente del de conceptos (ya se ejercita por separado en cada pestaña).
- El resto de aserciones (mensajes de `status`, tablas de precios, promoción de concepto especial, el barrido de anchos de viewport, "sin errores de consola") son literalmente las mismas.

- [ ] **Step 2: Correr el E2E de catálogo de forma aislada**

Run: `cross-env CATALOG_E2E=1 APP_URL=http://127.0.0.1:3100 npx playwright test tests/catalog.spec.ts`
Expected: PASS. Si algún selector no coincide (por ejemplo, el nombre exacto que Playwright ve para el `role="dialog"` o el `role="tab"`), ajustar el selector en el test para que coincida con el DOM real renderizado por los Tasks 4-7 — no relajar ninguna aserción de contenido/estado.

- [ ] **Step 3: Regresión completa del proyecto**

Run: `npm test`
Expected: `typecheck`, `test:unit`, `test:integration`, `test:content`, `build`, `test:e2e`, `test:e2e:foundation` todos en verde. Este es el segundo y último punto de verificación pesada del proyecto (el primero fue al cierre del Task 7), consistente con la disciplina de "verificación por bloque" documentada en `Global Constraints`.

- [ ] **Step 4: Commit**

```bash
git add tests/catalog.spec.ts
git commit -m "test: rewrite catalog E2E spec for the tabbed Catálogo UI"
```

---

### Task 9: Cerrar la pieza en `PROJECT_STATUS.md`

**Files:**
- Modify: `PROJECT_STATUS.md` (agregar una entrada nueva, siguiendo el mismo estilo denso ya usado en el resto del archivo — no se muestra el texto exacto aquí porque depende de la fecha y los conteos de prueba reales del momento en que se ejecute este plan; usar como plantilla cualquier entrada reciente del archivo, por ejemplo la de "audit log").

- [ ] **Step 1: Agregar la entrada de cierre**

Agregar una entrada nueva (con la fecha real del día en que se complete el plan) describiendo: qué se encontró (el monolito de 434 líneas, sin separación), qué se decidió (3 pestañas + diálogo de categorías + `PrivateTabs` reutilizable), qué se verificó (regresión completa en verde, conteo de pruebas del gate final del Task 8), y qué queda fuera (los 5 proyectos relacionados listados en la spec §10: V2 de solicitudes, dividir `StaffQuotesPanel`, aprobaciones accionables, historial de versiones del portal, notificar `PROJECT.CREATED` + página `/staff/projects`).

- [ ] **Step 2: Commit**

```bash
git add PROJECT_STATUS.md
git commit -m "docs: close out the Catálogo UX redesign in PROJECT_STATUS"
```

---

## Self-Review (completado antes de entregar este plan)

**1. Cobertura de la spec:** las 6 secciones de diseño de la spec (§3.1 navegación → Tasks 2/7; §3.2 Conceptos → Task 4; §3.3 Listas de precio → Task 5; §3.4 Por revisar → Task 6; §3.5 reglas visuales → CSS del Task 7 + botón único por pestaña en cada tab; §3.6 diálogo de categorías → Task 3) tienen tarea. §8 (impacto en pruebas) → Task 8. §9 (criterios de terminado) → verificado en los Steps de regresión de los Tasks 7 y 8, y en el tamaño de archivo objetivo (`StaffCatalogPanel.tsx` queda en ~95 líneas en el Task 7, cada tab entre 120-260 líneas).

**2. Placeholders:** ninguno — cada step de código trae el archivo completo, no fragmentos "similares a".

**3. Consistencia de tipos:** `CatalogCapabilities`, `Category`, `CatalogItem`, `PriceList`, `PriceListDetail`, `SpecialConceptGroup` se definen una sola vez (Task 1) y se importan idénticos en los Tasks 3-7 — verificado nombre por nombre al escribir cada import. `StaffCatalogReviewTabProps.onPromoted` se define en el Task 6 y se usa con la misma firma en el Task 7. Corregido durante la escritura: el import de `ApiResponseErrorKind` en el Task 5 puede quedar sin usar — señalado explícitamente en su propio Step 2 para que se elimine si el linter lo marca.

**Hallazgo de scope resuelto durante la escritura del plan (no estaba en la spec):** el árbol de categorías del mockup aprobado mostraba un conteo de conceptos por categoría (p. ej. "Equipo de filtrado (34)"). Verifiqué `GET /api/staff/catalog/categories` y su servicio (`listCatalogCategories`) — no exponen `_count`, y agregarlo sería un cambio de backend fuera de alcance. Se omiten los conteos en el Task 4/CSS; documentado en `Global Constraints`. El filtro por categoría en sí (clic → filtra la lista) **sí** es 100% viable sin backend nuevo: confirmé que `GET /api/staff/catalog/items` ya acepta `categoryId` como query param (`src/app/api/staff/catalog/items/route.ts`), simplemente nunca fue usado por la UI anterior.

## Execution Handoff

Plan completo y guardado en `docs/ocpool-commercial-v2/plans/2026-09-25-catalog-ux-redesign-plan.md`. Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — despacho un subagente nuevo por task, con revisión entre tasks, iteración rápida.

**2. Ejecución en esta misma sesión** — ejecuto los tasks en bloque en esta conversación, con checkpoints para tu revisión.

¿Cuál prefieres?
