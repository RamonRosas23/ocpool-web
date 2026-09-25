# Sistema premium de modales, combobox de búsqueda y limpieza de formularios — Plan de implementación

> **Spec:** `docs/ocpool-commercial-v2/specs/2026-09-25-premium-modal-system.md`

**Goal:** Elevar el cromado de los 14 diálogos de Catálogo/Cotizaciones al lenguaje visual `private-ui`, reemplazar el selector de "Concepto" roto (caja de búsqueda + select separados) por un combobox real, corregir el checkbox de "Especificar clave manualmente" (regresión de esta misma rama) y limpiar la tipografía de etiquetas de formulario.

**Architecture:** Un componente nuevo (`PrivateCombobox`, modelado en el patrón ya probado de `CatalogItemSearchCombobox` pero genérico/en memoria), tres bloques de CSS compartidos que cascadan automáticamente a los 14 diálogos existentes sin tocar su lógica, y ediciones puntuales de JSX solo donde son estructuralmente necesarias (botón de cerrar, y el picker de concepto en "Programar precio").

**Tech Stack:** Next.js App Router, TypeScript, React (client components), CSS. Sin dependencias nuevas (reutiliza `lucide-react`, ya instalado).

## Global Constraints

- No tocar ningún panel fuera de Catálogo/Cotizaciones ni la landing pública.
- No agregar llamadas nuevas a la API.
- No convertir los `<input>`/`<textarea>` planos a componentes `PrivateTextField`/`PrivateTextArea` — el resultado visual se logra con CSS directo sobre `.catalog-form input/textarea` (ver spec, sección "Fuera de alcance").
- Mantener la rama única `catalog-ux-redesign`.
- Atribución de commits: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Fix del checkbox (regresión de esta misma rama)

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:** Ninguna — cambio de selector CSS.

- [ ] **Step 1: Reproducir el bug**

Con el servidor de desarrollo corriendo y sesión de manager activa, abrir "Nuevo concepto" en `/staff/catalog` y confirmar visualmente que el checkbox de "Especificar clave manualmente" se ve como un recuadro grande (no un checkbox pequeño en línea con su etiqueta).

- [ ] **Step 2: Aplicar el fix**

Buscar en `src/app/globals.css` la línea (agregada en la pieza anterior de esta rama):

```css
.catalog-form input:not(.private-control), .catalog-form select, .catalog-form textarea:not(.private-control) { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

Reemplazarla por:

```css
.catalog-form input:not(.private-control):not([type="checkbox"]), .catalog-form select, .catalog-form textarea:not(.private-control) { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

- [ ] **Step 3: Verificar**

Recargar y reabrir "Nuevo concepto". Confirmar que el checkbox vuelve a verse pequeño, alineado en línea con "Especificar clave manualmente" (mismo tamaño que antes de la pieza anterior).

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "fix: stop the generic catalog-form input rule from resizing checkboxes"
```

---

### Task 2: Componente `PrivateCombobox`

**Files:**
- Modify: `src/components/private/ui/PrivateControls.tsx`
- Modify: `src/components/private/ui/index.ts`
- Modify: `src/components/private/ui/private-ui.css`

**Interfaces:**
- Produce: `PrivateCombobox({ id, label, description, error, required, hideLabel, className, value, options, onValueChange, placeholder, noResultsLabel, disabled }: PrivateComboboxProps)` — componente exportado. `PrivateComboboxProps = Omit<PrivateFieldChromeProps, 'children'> & { value: string; options: readonly PrivateSelectOption[]; onValueChange: (value: string) => void; placeholder?: string; noResultsLabel?: string; disabled?: boolean }`. Reutiliza el tipo `PrivateSelectOption` (`{ value: string; label: string; disabled?: boolean }`) ya definido en el mismo archivo — drop-in compatible con cualquier `options` que hoy alimente un `PrivateSelect`.
- Consume: `PrivateField`, `privateFieldA11y`, `joinClasses` (ya existentes en el archivo).

- [ ] **Step 1: Agregar los imports de React que hacen falta**

En `src/components/private/ui/PrivateControls.tsx`, la línea 4 actual es:

```tsx
import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
```

Ya incluye `useEffect`, `useRef`, `useState`. Agregar `type KeyboardEvent`:

```tsx
import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react';
```

- [ ] **Step 2: Agregar el componente al final del archivo**

Justo después del cierre de `PrivateSelect` (después de la línea `}` que cierra la función, antes del final del archivo), agregar:

```tsx
export type PrivateComboboxProps = Omit<PrivateFieldChromeProps, 'children'> & {
  value: string;
  options: readonly PrivateSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  noResultsLabel?: string;
  disabled?: boolean;
};

export function PrivateCombobox({ id, label, description, error, required, hideLabel, className, value, options, onValueChange, placeholder = 'Escribe para buscar…', noResultsLabel = 'Sin coincidencias', disabled = false }: PrivateComboboxProps) {
  const a11y = privateFieldA11y(id, Boolean(description), Boolean(error), required);
  const listboxId = `${id}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const [term, setTerm] = useState(selectedOption?.label ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!open) setTerm(selectedOption?.label ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe re-sincronizar cuando cambia el valor seleccionado externamente, no en cada tecleo
  }, [value]);

  // Al abrir (clic, foco o flecha abajo) se limpia el término de búsqueda para mostrar TODAS las
  // opciones de inmediato -- si en su lugar se precargara con la etiqueta ya seleccionada, abrir
  // el combobox filtraría de entrada a un solo resultado y el usuario no podría explorar el resto
  // sin borrar primero. Cerrar sin elegir restaura la etiqueta de la selección vigente.
  const openDropdown = () => { setTerm(''); setOpen(true); setActiveIndex(-1); };
  const closeDropdown = () => { setOpen(false); setTerm(selectedOption?.label ?? ''); setActiveIndex(-1); };

  const visibleOptions = options.filter((option) => !option.disabled && (!term.trim() || option.label.toLowerCase().includes(term.trim().toLowerCase())));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => { if (!containerRef.current?.contains(event.target as Node)) closeDropdown(); };
    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeDropdown lee selectedOption ya vigente en cada render; no hace falta re-suscribir el listener por eso
  }, [open]);

  const choose = (option: PrivateSelectOption) => {
    onValueChange(option.value);
    setTerm(option.label);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { openDropdown(); return; }
      setActiveIndex((current) => visibleOptions.length ? (current + 1) % visibleOptions.length : -1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => visibleOptions.length ? (current - 1 + visibleOptions.length) % visibleOptions.length : -1);
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && visibleOptions[activeIndex]) { event.preventDefault(); choose(visibleOptions[activeIndex]); }
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); closeDropdown(); }
    }
  };

  return (
    <PrivateField id={id} label={label} description={description} error={error} required={required} hideLabel={hideLabel}>
      <div className={joinClasses('private-combobox', className)} ref={containerRef}>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && visibleOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          aria-describedby={a11y.describedBy}
          aria-invalid={a11y.invalid}
          aria-labelledby={a11y.labelId}
          aria-required={a11y.required}
          autoComplete="off"
          className="private-control private-combobox__input"
          placeholder={placeholder}
          value={term}
          disabled={disabled}
          onFocus={openDropdown}
          onClick={openDropdown}
          onChange={(event) => { setTerm(event.target.value); setActiveIndex(-1); if (!open) setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
        {open && (
          <ul id={listboxId} role="listbox" aria-label={label} className="private-combobox__listbox">
            {visibleOptions.length === 0 && <li className="private-combobox__status">{noResultsLabel}</li>}
            {visibleOptions.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`private-combobox__option${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => { event.preventDefault(); choose(option); }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PrivateField>
  );
}
```

- [ ] **Step 3: Exportar desde el índice del kit**

En `src/components/private/ui/index.ts`, la línea 5-16 actual exporta desde `PrivateControls`:

```ts
export {
  PrivateButton,
  PrivateIconButton,
  PrivateLinkButton,
  PrivateTextField,
  PrivateTextArea,
  PrivateNumberField,
  PrivateMoneyField,
  PrivatePercentField,
  PrivateSelect,
} from './PrivateControls';
export type { PrivateButtonProps, PrivateIconButtonProps, PrivateLinkButtonProps, PrivateSelectOption, PrivateSelectProps, PrivateMoneyFieldProps } from './PrivateControls';
```

Reemplazar por:

```ts
export {
  PrivateButton,
  PrivateIconButton,
  PrivateLinkButton,
  PrivateTextField,
  PrivateTextArea,
  PrivateNumberField,
  PrivateMoneyField,
  PrivatePercentField,
  PrivateSelect,
  PrivateCombobox,
} from './PrivateControls';
export type { PrivateButtonProps, PrivateIconButtonProps, PrivateLinkButtonProps, PrivateSelectOption, PrivateSelectProps, PrivateMoneyFieldProps, PrivateComboboxProps } from './PrivateControls';
```

- [ ] **Step 4: CSS del combobox**

En `src/components/private/ui/private-ui.css`, justo después del bloque `.private-money-field*` (después de la línea `.private-money-field__prefix { ... }`), agregar:

```css
.private-combobox { position: relative; min-width: 0; }
.private-combobox__input { cursor: text; }
.private-combobox__listbox { position: absolute; z-index: var(--private-z-popover); top: calc(100% + 6px); left: 0; right: 0; max-height: min(280px, 45vh); overflow-y: auto; margin: 0; padding: var(--private-space-1); list-style: none; border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); background: var(--private-color-surface); box-shadow: var(--private-shadow-popover); }
.private-combobox__status { padding: 8px 10px; color: var(--private-color-ink-muted); font-size: 12px; }
.private-combobox__option { display: flex; min-height: 40px; align-items: center; border-radius: var(--private-radius-control); padding: 8px 10px; color: var(--private-color-ink); cursor: pointer; font-size: 12px; }
.private-combobox__option.is-active { background: var(--private-color-brand); color: #fff; }
```

- [ ] **Step 5: `tsc`**

Run: `npx tsc --noEmit -p .` — sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/components/private/ui/PrivateControls.tsx src/components/private/ui/index.ts src/components/private/ui/private-ui.css
git commit -m "feat: add PrivateCombobox, a searchable single-select over in-memory options"
```

---

### Task 3: Cromado premium de diálogo (CSS compartido)

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:** Ninguna — cambio de CSS puro, sin tocar JSX en este task.

- [ ] **Step 1: Redisñar `.catalog-category-dialog*`**

Localizar en `src/app/globals.css`:

```css
.catalog-category-dialog { position: fixed; top: 50%; left: 50%; z-index: 30; width: min(640px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 64px)); overflow-y: auto; transform: translate(-50%, -50%); border: 1px solid var(--staff-line); background: var(--staff-paper); padding: 26px; }
.catalog-category-dialog__overlay { position: fixed; inset: 0; z-index: 29; background: rgba(9,36,51,.45); }
.catalog-category-dialog__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.catalog-category-dialog__head h2 { margin: 0; color: var(--staff-deep); font-family: var(--private-font-display); font-size: 24px; font-weight: 500; }
```

Reemplazar por:

```css
.catalog-category-dialog { position: fixed; top: 50%; left: 50%; z-index: 30; width: min(640px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 64px)); overflow-y: auto; transform: translate(-50%, -50%); border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); background: var(--staff-paper); padding: 26px; box-shadow: var(--private-shadow-popover); }
.catalog-category-dialog__overlay { position: fixed; inset: 0; z-index: 29; background: rgba(9,36,51,.4); }
.catalog-category-dialog__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.catalog-category-dialog__head h2 { margin: 0; color: var(--staff-deep); font-family: var(--private-font-display); font-size: 24px; font-weight: 500; }
```

- [ ] **Step 2: Redisñar `.quotes-preflight-dialog*` y `.quotes-reprice-dialog*`**

Localizar:

```css
.quotes-reprice-overlay { position: fixed; z-index: 30; inset: 0; display: grid; overflow-y: auto; place-items: center; padding: 24px; background: rgba(24,20,12,.55); }
.quotes-reprice-dialog { width: min(100%, 560px); padding: clamp(22px, 5vw, 34px); border: 1px solid var(--staff-line); background: var(--staff-paper); color: var(--staff-ink); box-shadow: 0 28px 100px rgba(24,20,12,.3); }
```

Reemplazar por:

```css
.quotes-reprice-overlay { position: fixed; z-index: 30; inset: 0; display: grid; overflow-y: auto; place-items: center; padding: 24px; background: rgba(9,36,51,.4); }
.quotes-reprice-dialog { width: min(100%, 560px); padding: clamp(22px, 5vw, 34px); border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); background: var(--staff-paper); color: var(--staff-ink); box-shadow: var(--private-shadow-popover); }
```

Localizar:

```css
.quotes-preflight-overlay { position: fixed; z-index: 30; inset: 0; display: grid; overflow-y: auto; place-items: center; padding: 24px; background: rgba(24,20,12,.55); }
```

Reemplazar por:

```css
.quotes-preflight-overlay { position: fixed; z-index: 30; inset: 0; display: grid; overflow-y: auto; place-items: center; padding: 24px; background: rgba(9,36,51,.4); }
```

Localizar:

```css
.quotes-preflight-dialog { width: min(100%, 480px); padding: clamp(22px, 5vw, 34px); border: 1px solid var(--staff-line); background: var(--staff-paper); color: var(--staff-ink); box-shadow: 0 28px 100px rgba(24,20,12,.3); }
```

Reemplazar por:

```css
.quotes-preflight-dialog { width: min(100%, 480px); padding: clamp(22px, 5vw, 34px); border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); background: var(--staff-paper); color: var(--staff-ink); box-shadow: var(--private-shadow-popover); }
```

- [ ] **Step 3: Verificar en navegador**

Abrir al menos un diálogo de cada familia (uno de Catálogo, `quotes-preflight-dialog` vía "Agregar concepto especial", y `quotes-reprice-dialog` vía "Verificar precios vigentes" si hay una cotización con líneas de catálogo). Confirmar visualmente esquinas redondeadas y sombra suave en vez de borde grueso.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "style: give catalog and quotes dialog chrome the private-ui radius and shadow"
```

---

### Task 4: Botón de cerrar consistente (ícono) en los 7 diálogos de Catálogo

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/StaffQuotesPanel.tsx`
- Modify: `src/components/StaffCatalogConceptsTab.tsx`
- Modify: `src/components/StaffCatalogCategoryDialog.tsx`
- Modify: `src/components/StaffCatalogPriceListsTab.tsx`

**Interfaces:** Ninguna nueva — solo renombre de una clase CSS ya existente y su reutilización en 7 sitios adicionales.

- [ ] **Step 1: Renombrar la clase en CSS**

En `src/app/globals.css`, localizar:

```css
.quotes-reprice-dialog__close { width: 32px; height: 32px; border: 1px solid var(--staff-line); background: transparent; color: var(--staff-muted); }
.quotes-reprice-dialog__close:hover, .quotes-reprice-dialog__close:focus-visible { border-color: var(--staff-deep); color: var(--staff-deep); }
```

Reemplazar por:

```css
.staff-dialog-close { flex: 0 0 auto; width: 32px; height: 32px; border: 1px solid var(--staff-line); border-radius: var(--private-radius-control); background: transparent; color: var(--staff-muted); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.staff-dialog-close:hover, .staff-dialog-close:focus-visible { border-color: var(--staff-deep); color: var(--staff-deep); }
```

- [ ] **Step 2: Actualizar las 7 referencias en `StaffQuotesPanel.tsx`**

Con una búsqueda y reemplazo exacto de texto, reemplazar cada aparición de `className="quotes-reprice-dialog__close"` por `className="staff-dialog-close"` en `src/components/StaffQuotesPanel.tsx` (7 apariciones: líneas ~1064, 1071, 1084, 1090, 1096, 1110, 1114 del archivo antes de este task — confirmar con `grep -n "quotes-reprice-dialog__close" src/components/StaffQuotesPanel.tsx` y reemplazar cada una).

- [ ] **Step 3: Agregar el import de `X` en los 3 archivos de Catálogo que aún no lo tienen**

`src/components/StaffCatalogConceptsTab.tsx` — línea 4 actual:

```tsx
import { Inbox } from 'lucide-react';
```

Reemplazar por:

```tsx
import { Inbox, X } from 'lucide-react';
```

`src/components/StaffCatalogCategoryDialog.tsx` — no importa nada de `lucide-react` todavía. Agregar después de la línea 3 (`import { PrivateDialog, PrivateSelect } from '@/components/private/ui';`):

```tsx
import { X } from 'lucide-react';
```

`src/components/StaffCatalogPriceListsTab.tsx` — no importa nada de `lucide-react` todavía. Agregar después de la línea 3 (`import { PrivateDatePicker, PrivateDialog, PrivateMoneyField, PrivateSelect } from '@/components/private/ui';`):

```tsx
import { X } from 'lucide-react';
```

- [ ] **Step 4: Reemplazar los 3 encabezados de `StaffCatalogConceptsTab.tsx`**

Reemplazar (línea ~290-293):

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-create-title">Nuevo concepto</h2>
            <button className="staff-button" type="button" onClick={closeCreateDialog}>Cerrar</button>
          </div>
```

por:

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-create-title">Nuevo concepto</h2>
            <button className="staff-dialog-close" type="button" onClick={closeCreateDialog} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
```

Reemplazar (línea ~310-313):

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-price-title">Precio inicial de {createdItem.name}</h2>
            <button className="staff-button" type="button" onClick={closeCreateDialog}>Cerrar</button>
          </div>
```

por:

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-price-title">Precio inicial de {createdItem.name}</h2>
            <button className="staff-dialog-close" type="button" onClick={closeCreateDialog} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
```

Reemplazar (línea ~330-333):

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-edit-title">Editar concepto</h2>
            <button className="staff-button" type="button" onClick={() => setEditingItem(false)}>Cerrar</button>
          </div>
```

por:

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-item-edit-title">Editar concepto</h2>
            <button className="staff-dialog-close" type="button" onClick={() => setEditingItem(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
```

- [ ] **Step 5: Reemplazar el encabezado de `StaffCatalogCategoryDialog.tsx`**

Reemplazar (línea 67-70):

```tsx
      <div className="catalog-category-dialog__head">
        <h2 id="catalog-category-dialog-title">Categorías del catálogo</h2>
        <button className="staff-button" type="button" onClick={onClose}>Cerrar</button>
      </div>
```

por:

```tsx
      <div className="catalog-category-dialog__head">
        <h2 id="catalog-category-dialog-title">Categorías del catálogo</h2>
        <button className="staff-dialog-close" type="button" onClick={onClose} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
      </div>
```

- [ ] **Step 6: Reemplazar los 3 encabezados de `StaffCatalogPriceListsTab.tsx`**

Reemplazar (bloque de "Nueva lista"):

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-pricelist-create-title">Nueva lista</h2>
            <button className="staff-button" type="button" onClick={() => setShowPriceListForm(false)}>Cerrar</button>
          </div>
```

por:

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-pricelist-create-title">Nueva lista</h2>
            <button className="staff-dialog-close" type="button" onClick={() => setShowPriceListForm(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
```

Reemplazar (bloque de "Editar lista"):

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-pricelist-edit-title">Editar lista</h2>
            <button className="staff-button" type="button" onClick={() => setEditingPriceList(false)}>Cerrar</button>
          </div>
```

por:

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-pricelist-edit-title">Editar lista</h2>
            <button className="staff-dialog-close" type="button" onClick={() => setEditingPriceList(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
```

Reemplazar (bloque de "Programar precio"):

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-schedule-price-title">Programar precio</h2>
            <button className="staff-button" type="button" onClick={() => setShowScheduleDialog(false)}>Cerrar</button>
          </div>
```

por:

```tsx
          <div className="catalog-category-dialog__head">
            <h2 id="catalog-schedule-price-title">Programar precio</h2>
            <button className="staff-dialog-close" type="button" onClick={() => setShowScheduleDialog(false)} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
          </div>
```

- [ ] **Step 7: Verificar en navegador**

Abrir cada uno de los 5 diálogos de Catálogo modificados (Nuevo concepto paso 1 y 2, Editar concepto, Categorías, Nueva/Editar lista, Programar precio) y confirmar que el botón de cerrar ahora es un ícono `X` circular/cuadrado pequeño, igual al de Cotizaciones, y que sigue cerrando el diálogo al hacer clic.

- [ ] **Step 8: `tsc`**

Run: `npx tsc --noEmit -p .` — sin errores nuevos (confirma que `X` se usa y no queda como import sin uso en ningún archivo).

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/components/StaffQuotesPanel.tsx src/components/StaffCatalogConceptsTab.tsx src/components/StaffCatalogCategoryDialog.tsx src/components/StaffCatalogPriceListsTab.tsx
git commit -m "feat: unify dialog close buttons on the icon-only pattern already used by Quotes"
```

---

### Task 5: Tipografía de etiquetas de formulario

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:** Ninguna — CSS puro.

- [ ] **Step 1: Redisñar `.catalog-form label span`**

Localizar:

```css
.catalog-form label span, .catalog-form > p { color: var(--staff-muted); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
```

Reemplazar por:

```css
.catalog-form label span, .catalog-form > p { color: var(--staff-muted); font-size: 11px; font-weight: 700; letter-spacing: normal; text-transform: none; }
```

- [ ] **Step 2: Verificar en navegador**

Abrir cualquier diálogo de Catálogo o Cotizaciones con campos de texto planos (por ejemplo "Nueva lista": Clave, Nombre, Moneda). Confirmar que las etiquetas ya no están en mayúsculas ni con espaciado de letras, y que siguen siendo legibles y con jerarquía clara frente al valor del campo.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: drop the all-caps letter-spaced treatment on catalog-form field labels"
```

---

### Task 6: `PrivateCombobox` reemplaza el picker de "Concepto" en Programar precio

**Files:**
- Modify: `src/components/StaffCatalogPriceListsTab.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consume: `PrivateCombobox` (Task 2).
- Elimina: el estado `conceptFilter` y el memo `filteredPricableItems` agregados en la pieza anterior de esta rama (ya no hacen falta — el combobox filtra internamente).

- [ ] **Step 1: Quitar el import de `PrivateSelect` si deja de usarse en otro lugar del archivo, y agregar `PrivateCombobox`**

`PrivateSelect` sigue usándose en este archivo solo si hay otro campo con ese componente — no lo hay en `StaffCatalogPriceListsTab.tsx` fuera del picker de Concepto que este task reemplaza, así que se retira de los imports. Línea 4 actual:

```tsx
import { PrivateDatePicker, PrivateDialog, PrivateMoneyField, PrivateSelect } from '@/components/private/ui';
```

Reemplazar por:

```tsx
import { PrivateCombobox, PrivateDatePicker, PrivateDialog, PrivateMoneyField } from '@/components/private/ui';
```

(El import de `X` de `lucide-react` ya se agregó en el Task 4, paso 3 — no se repite aquí.)

- [ ] **Step 2: Quitar el estado `conceptFilter` y el memo `filteredPricableItems`**

Localizar (agregado en la pieza anterior):

```tsx
  const [conceptFilter, setConceptFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');
```

Reemplazar por (se conserva solo `tableFilter`, que sigue en uso para el buscador de la tabla de precios):

```tsx
  const [tableFilter, setTableFilter] = useState('');
```

Localizar:

```tsx
  const filteredPricableItems = useMemo(() => {
    const query = conceptFilter.trim().toLowerCase();
    if (!query) return pricableItems;
    return pricableItems.filter((item) => item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query));
  }, [pricableItems, conceptFilter]);
```

Eliminar ese bloque por completo (ya no hace falta — `PrivateCombobox` filtra sobre las `options` que se le pasan directamente).

- [ ] **Step 3: Quitar las referencias a `setConceptFilter`**

En `openScheduleDialogForItem`:

```tsx
  const openScheduleDialogForItem = (catalogItemId: string) => {
    setPriceForm({ catalogItemId, amountInput: '', effectiveFrom: '', reason: '' });
    setConceptFilter('');
    setShowScheduleDialog(true);
  };
```

Reemplazar por:

```tsx
  const openScheduleDialogForItem = (catalogItemId: string) => {
    setPriceForm({ catalogItemId, amountInput: '', effectiveFrom: '', reason: '' });
    setShowScheduleDialog(true);
  };
```

En el botón genérico "Programar precio":

```tsx
                  {capabilities.pricesManage && priceListDetail.status === 'ACTIVE' && <button className="staff-button" type="button" disabled={saving} onClick={() => { setConceptFilter(''); setShowScheduleDialog(true); }}>Programar precio</button>}
```

Reemplazar por:

```tsx
                  {capabilities.pricesManage && priceListDetail.status === 'ACTIVE' && <button className="staff-button" type="button" disabled={saving} onClick={() => setShowScheduleDialog(true)}>Programar precio</button>}
```

- [ ] **Step 4: Reemplazar el buscador + select por el combobox**

Localizar (agregado en la pieza anterior):

```tsx
            <label className="catalog-form__concept-filter"><span>Buscar concepto</span><input value={conceptFilter} onChange={(event) => setConceptFilter(event.target.value)} placeholder="Clave o nombre" maxLength={100} disabled={saving} /></label>
            <PrivateSelect id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={filteredPricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder={filteredPricableItems.length === 0 ? 'Sin coincidencias' : 'Selecciona un concepto'} disabled={saving} />
```

Reemplazar por:

```tsx
            <PrivateCombobox id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={pricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Escribe la clave o el nombre del concepto" disabled={saving} />
```

- [ ] **Step 5: Quitar la regla CSS que ya no aplica**

En `src/app/globals.css`, localizar y eliminar (agregada en la pieza anterior, ya no tiene ningún elemento que la use):

```css
.catalog-form button, .catalog-form > p, .catalog-form__pair, .catalog-form__concept-filter { grid-column: 1 / -1; }
```

Reemplazar por:

```css
.catalog-form button, .catalog-form > p, .catalog-form__pair { grid-column: 1 / -1; }
```

- [ ] **Step 6: Verificar en navegador**

Abrir "Programar precio" desde el botón genérico: confirmar que el campo "Concepto" es un único control de texto, que escribir filtra las opciones en un dropdown, que seleccionar una la deja escrita en el campo, y que navegar con flechas + Enter también selecciona. Abrir vía "Reprogramar" desde una fila: confirmar que el campo ya trae escrito el nombre del concepto correcto.

- [ ] **Step 7: `tsc` y lint**

Run: `npx tsc --noEmit -p .` — confirmar que no quedan referencias sueltas a `conceptFilter`/`filteredPricableItems`/`PrivateSelect` sin usar en este archivo.

- [ ] **Step 8: Commit**

```bash
git add src/components/StaffCatalogPriceListsTab.tsx src/app/globals.css
git commit -m "feat: replace the split search-box-plus-select with PrivateCombobox in Programar precio"
```

---

### Task 7: Ajuste de E2E, verificación final y cierre de documentación

**Files:**
- Ninguno de los specs E2E necesita cambios (ver Step 1 — ya verificado por lectura directa).
- Modify: `PROJECT_STATUS.md`

**Interfaces:** Ninguna nueva.

- [ ] **Step 1: Confirmar que los E2E existentes no necesitan cambios (ya verificado, no repetir la búsqueda)**

Ya se confirmó por lectura directa de `tests/catalog.spec.ts` y `tests/quotes.spec.ts` que ningún cambio de este plan rompe una aserción existente:
- `tests/catalog.spec.ts:237-238` ejercita el picker de "Concepto" del diálogo standalone "Programar precio": `await scheduleDialog.getByRole('combobox', { name: 'Concepto' }).click(); await page.getByRole('option', { name: new RegExp(`^${itemCode} ·`) }).click();`. El nuevo `PrivateCombobox` expone `role="combobox"` sobre un `<input>` con el mismo nombre accesible ("Concepto", vía `aria-labelledby` al label de `PrivateField`, igual que antes con `PrivateSelect`), y al abrir (clic) limpia el término de búsqueda y muestra TODAS las opciones como `role="option"` — el mismo `.click()` sin escribir nada sigue revelando la lista completa, y `getByRole('option', { name: /^.../ })` sigue encontrando la opción por su texto. **No requiere cambios.**
- `tests/catalog.spec.ts:190` y `:266` usan `getByRole('button', { name: 'Cerrar' })` para los botones de cerrar que este plan convierte a ícono con `aria-label="Cerrar"` — el nombre accesible sigue siendo el texto "Cerrar" (ahora vía `aria-label` en vez de contenido visible), así que el selector sigue encontrando el botón sin cambios. **No requiere cambios.**
- `tests/quotes.spec.ts` no referencia ningún picker de "Concepto" de Catálogo (usa su propio `CatalogItemSearchCombobox`, no tocado por este plan) ni ningún botón "Cerrar" por texto. **No requiere cambios.**

- [ ] **Step 2: E2E dirigido**

Run: `npx cross-env CATALOG_E2E=1 npx playwright test tests/catalog.spec.ts` y `npx cross-env QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts`
Expected: ambos en verde, sin haber tocado ningún archivo de test.

- [ ] **Step 3: Verificación manual completa en navegador**

Con sesión de manager activa: reproducir capturas antes/después de "Programar precio" y "Nuevo concepto" (las mismas dos vistas capturadas durante el diagnóstico) para confirmar visualmente el cromado nuevo, el checkbox corregido, el combobox funcionando, y las etiquetas sin mayúsculas. Revisar al menos un diálogo de Cotizaciones (Agregar concepto especial) para confirmar que el cromado también mejoró ahí. Limpiar cualquier dato de prueba creado durante la verificación.

- [ ] **Step 4: Regresión completa**

Run: `npm test`
Expected: verde. Si aparece contaminación de datos preexistente (mismo patrón ya visto en esta rama: `analytics-service.test.ts`/`notifications-staff.test.ts`), correr `npm run pilot:clean` (ya autorizado para este patrón recurrente en esta sesión) y repetir.

- [ ] **Step 5: Limpieza de scripts de verificación manual**

Confirmar que no quedan scripts `scripts/manual-check-*.ts` sin borrar ni usuarios `manual-check-*@example.test` en la base de datos de desarrollo (usar el mismo patrón de limpieza ya usado en las piezas anteriores de esta rama).

- [ ] **Step 6: Entrada en `PROJECT_STATUS.md`**

Agregar una nueva entrada (mismo estilo de título en negrita + fecha que las entradas previas de esta rama), inmediatamente después de la entrada de "Listas de precio con atajo Reprogramar...", resumiendo: el diagnóstico en vivo que encontró el cromado de modal desalineado del sistema `private-ui`, el picker de Concepto roto en dos controles, y el bug de checkbox introducido por la propia rama; el nuevo `PrivateCombobox`; el cromado premium compartido en los 14 diálogos; los botones de cerrar unificados; y la tipografía de etiquetas limpia.

- [ ] **Step 7: Commit de cierre**

```bash
git add PROJECT_STATUS.md
git commit -m "docs: close out the premium modal system pass in PROJECT_STATUS"
```

- [ ] **Step 8: Iniciar `superpowers:finishing-a-development-branch`**

Presentar el menú de 4 opciones estándar una vez todo lo anterior esté en verde.
