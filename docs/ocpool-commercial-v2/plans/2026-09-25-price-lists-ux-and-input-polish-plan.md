# Listas de precio UX + pulido de inputs/selects + fix de scrollbar — Plan de implementación

> **Spec:** `docs/ocpool-commercial-v2/specs/2026-09-25-price-lists-ux-and-input-polish.md`

**Goal:** Corregir el choque de CSS que rompe el campo de dinero/fecha dentro de `.catalog-form`, eliminar el brinco de scrollbar al abrir cualquier modal, y hacer que "Listas de precio" permita reprogramar y encontrar conceptos con precio sin fricción.

**Architecture:** Dos arreglos de raíz compartidos (CSS global + `PrivateDialog`) que benefician automáticamente a todos los modales/formularios existentes, más tres mejoras localizadas en `StaffCatalogPriceListsTab.tsx` (acción "Reprogramar" por fila, buscador de concepto en el diálogo, buscador sobre la tabla).

**Tech Stack:** Next.js App Router, TypeScript, React (client components), CSS (sin nuevas dependencias).

## Global Constraints

- No tocar la landing pública ni sus estilos (`globals.css` fuera del bloque `.catalog-form`/`.private-*` ya usado por el shell privado).
- No agregar llamadas nuevas a la API — todo el filtrado de "Concepto" y de la tabla de precios es client-side sobre datos ya cargados.
- No modificar el modelo de datos ni agregar endpoints — "Reprogramar" reutiliza `schedulePriceForItem`/`POST .../schedule` tal cual existe hoy.
- Mantener la rama única `catalog-ux-redesign` (sin crear rama nueva, sin worktree).
- Seguir el patrón de atribución de commits ya usado en la rama (`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`).

---

### Task 1: Fix de la colisión de especificidad CSS (`$` encimado + pulido de inputs/selects)

**Files:**
- Modify: `src/app/globals.css:1054`

**Interfaces:**
- No introduce ninguna función ni tipo nuevo. Es un cambio puramente de selector CSS.

- [ ] **Step 1: Reproducir el bug antes del fix (verificación manual rápida)**

Con el servidor de desarrollo corriendo y sesión de manager activa, abrir `/staff/catalog?tab=price-lists`, abrir "Programar precio", y confirmar visualmente (o vía `getComputedStyle` en devtools) que el `padding-left` del input de "Importe" es `10px` en vez de `26px`.

- [ ] **Step 2: Aplicar el fix de especificidad**

En `src/app/globals.css`, reemplazar la línea 1054:

```css
.catalog-form input, .catalog-form select, .catalog-form textarea { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

por:

```css
.catalog-form input:not(.private-control), .catalog-form select, .catalog-form textarea:not(.private-control) { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

- [ ] **Step 3: Verificar en navegador**

Recargar `/staff/catalog?tab=price-lists`, reabrir "Programar precio". Confirmar con `getComputedStyle(document.querySelector('.private-money-field__input')).paddingLeft` que ahora es `26px`, y que el "$" ya no se encima con el texto tecleado. Repetir en el campo "Vigente desde" (`.private-date-field__input`) y confirmar que su padding/min-height también corresponden a `.private-control` (`10px 12px` / `44px`) y no a los valores genéricos de `.catalog-form`. Confirmar también en `/staff/quotes` → "Agregar concepto especial" (mismo `.catalog-form` + `PrivateMoneyField`).

- [ ] **Step 4: Lint**

Run: `npm run lint -- src/app/globals.css` (o el comando de lint de CSS que use el proyecto; si no hay lint de CSS configurado, omitir y confiar en la verificación visual).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "fix: stop .catalog-form generic input styles from overriding private-control fields"
```

---

### Task 2: Fix del brinco de scrollbar en `PrivateDialog`

**Files:**
- Modify: `src/components/private/ui/PrivateDialog.tsx:41-70`

**Interfaces:**
- No cambia la firma pública de `PrivateDialog` ni `PrivateDialogProps`. Cambio interno al `useEffect` existente.

- [ ] **Step 1: Reproducir el bug antes del fix**

Abrir cualquier modal de Catálogo (p. ej. "Nueva lista") en una ventana con scrollbar visible (viewport de escritorio, contenido de página más alto que la ventana) y observar el corrimiento horizontal del contenido al abrir/cerrar.

- [ ] **Step 2: Aplicar la compensación de ancho de scrollbar**

En `src/components/private/ui/PrivateDialog.tsx`, reemplazar el segundo `useEffect` (líneas 41-70):

```tsx
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    if (modal) document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!modal || event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const elements = focusableElements(container);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (modal) document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modal, onClose, open]);
```

por:

```tsx
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    if (modal) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!modal || event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const elements = focusableElements(container);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (modal) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modal, onClose, open]);
```

- [ ] **Step 3: Verificar en navegador**

Medir `document.body.getBoundingClientRect().left` (siempre 0, no es lo relevante) — en su lugar, medir un elemento de referencia fijo visualmente o simplemente confirmar `document.body.style.paddingRight` antes/después de abrir un modal, y confirmar visualmente que el contenido de fondo ya no se desplaza al abrir/cerrar "Nueva lista", "Programar precio" y "Agregar concepto especial" (Cotizaciones).

- [ ] **Step 4: `tsc` sobre el archivo**

Run: `npx tsc --noEmit -p .` (o el comando de type-check del proyecto) y confirmar que no hay errores nuevos originados en `PrivateDialog.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/private/ui/PrivateDialog.tsx
git commit -m "fix: compensate scrollbar width when PrivateDialog locks body scroll"
```

---

### Task 3: Acción "Reprogramar" por fila en Vigentes/Programados

**Files:**
- Modify: `src/components/StaffCatalogPriceListsTab.tsx`
- Modify: `src/app/globals.css` (nuevas reglas para la columna de acción)

**Interfaces:**
- Produce: `openScheduleDialogForItem(catalogItemId: string): void` — nueva función interna del componente, usada por el botón "Reprogramar" de cada fila.
- Consume: `setPriceForm`, `setShowScheduleDialog` (ya existentes en el componente, sin cambios de firma).

- [ ] **Step 1: Agregar la función `openScheduleDialogForItem` y el flag `allowReschedule` por grupo**

En `src/components/StaffCatalogPriceListsTab.tsx`, justo después de `schedulePriceForItem` (después de la línea 159, antes de `return (`), agregar:

```tsx
  const openScheduleDialogForItem = (catalogItemId: string) => {
    setPriceForm({ catalogItemId, amountInput: '', effectiveFrom: '', reason: '' });
    setShowScheduleDialog(true);
  };
```

- [ ] **Step 2: Marcar qué grupos permiten reprogramar**

Reemplazar el array de configuración de grupos dentro del render (líneas 207-211):

```tsx
              {[
                { key: 'actuales', label: 'Vigentes', items: priceGroups.actuales },
                { key: 'futuros', label: 'Programados', items: priceGroups.futuros },
                { key: 'historicos', label: 'Históricos', items: priceGroups.historicos },
              ].map((group) => (
```

por:

```tsx
              {[
                { key: 'actuales', label: 'Vigentes', items: priceGroups.actuales, allowReschedule: true },
                { key: 'futuros', label: 'Programados', items: priceGroups.futuros, allowReschedule: true },
                { key: 'historicos', label: 'Históricos', items: priceGroups.historicos, allowReschedule: false },
              ].map((group) => (
```

- [ ] **Step 3: Renderizar la columna de acción en la tabla**

Reemplazar el bloque de la tabla de precios (líneas 216-225):

```tsx
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
```

por:

```tsx
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
```

- [ ] **Step 4: Agregar CSS de la columna de acción**

En `src/app/globals.css`, justo después de la línea de `.catalog-price-table__row b` (línea 1048), agregar:

```css
.catalog-price-table--actionable .catalog-price-table__head, .catalog-price-table--actionable .catalog-price-table__row { grid-template-columns: minmax(0, 1.2fr) minmax(90px, .55fr) minmax(125px, .75fr) auto; }
.catalog-price-table__action { min-height: 30px; padding: 6px 10px; font-size: 9px; }
```

Y dentro del bloque `@media (max-width: 900px)` existente, justo después de la línea `.catalog-price-table__head span:last-child, .catalog-price-table__row > small { display: none; }` (línea 1112), agregar:

```css
  .catalog-price-table--actionable .catalog-price-table__head, .catalog-price-table--actionable .catalog-price-table__row { grid-template-columns: minmax(0, 1.25fr) minmax(80px, .75fr) auto; }
```

- [ ] **Step 5: Verificar en navegador**

Con una lista de precio que tenga al menos un precio vigente, abrir `/staff/catalog?tab=price-lists`, hacer clic en "Reprogramar" en una fila de "Vigentes". Confirmar que el diálogo "Programar precio" abre con ese concepto ya seleccionado en el select y los campos de importe/fecha/motivo vacíos. Confirmar que "Históricos" no muestra el botón.

- [ ] **Step 6: `tsc` y lint**

Run: `npx tsc --noEmit -p .` — confirmar sin errores nuevos en `StaffCatalogPriceListsTab.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/StaffCatalogPriceListsTab.tsx src/app/globals.css
git commit -m "feat: add per-row Reprogramar shortcut to the price lists table"
```

---

### Task 4: Buscador de concepto dentro de "Programar precio"

**Files:**
- Modify: `src/components/StaffCatalogPriceListsTab.tsx`
- Modify: `src/app/globals.css` (una regla de layout)

**Interfaces:**
- Produce: estado local `conceptFilter: string` y `filteredPricableItems: PricableItem[]` (memoizado), consumidos solo dentro de este componente para construir las `options` del `PrivateSelect` de "Concepto".

- [ ] **Step 1: Agregar el estado del filtro**

En `src/components/StaffCatalogPriceListsTab.tsx`, junto a los demás `useState` (después de la línea 33, antes de `const previewItem = ...`), agregar:

```tsx
  const [conceptFilter, setConceptFilter] = useState('');
```

- [ ] **Step 2: Memoizar la lista filtrada**

Justo después de `previewText` (línea 36), agregar:

```tsx
  const filteredPricableItems = useMemo(() => {
    const query = conceptFilter.trim().toLowerCase();
    if (!query) return pricableItems;
    return pricableItems.filter((item) => item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query));
  }, [pricableItems, conceptFilter]);
```

- [ ] **Step 3: Resetear el filtro al abrir/cerrar el diálogo**

Modificar `openScheduleDialogForItem` (agregada en Task 3) para limpiar el filtro:

```tsx
  const openScheduleDialogForItem = (catalogItemId: string) => {
    setPriceForm({ catalogItemId, amountInput: '', effectiveFrom: '', reason: '' });
    setConceptFilter('');
    setShowScheduleDialog(true);
  };
```

Y en el botón genérico "Programar precio" (línea 198), agregar el reset del filtro:

```tsx
                  {capabilities.pricesManage && priceListDetail.status === 'ACTIVE' && <button className="staff-button" type="button" disabled={saving} onClick={() => { setConceptFilter(''); setShowScheduleDialog(true); }}>Programar precio</button>}
```

- [ ] **Step 4: Renderizar el campo de búsqueda y usar la lista filtrada en el select**

Reemplazar la línea del `PrivateSelect` de Concepto dentro del formulario del diálogo (línea 273):

```tsx
            <PrivateSelect id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={pricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder="Selecciona un concepto" disabled={saving} />
```

por:

```tsx
            <label className="catalog-form__concept-filter"><span>Buscar concepto</span><input value={conceptFilter} onChange={(event) => setConceptFilter(event.target.value)} placeholder="Clave o nombre" maxLength={100} disabled={saving} /></label>
            <PrivateSelect id="catalog-price-item" label="Concepto" required value={priceForm.catalogItemId} onValueChange={(value) => setPriceForm({ ...priceForm, catalogItemId: value })} options={filteredPricableItems.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} placeholder={filteredPricableItems.length === 0 ? 'Sin coincidencias' : 'Selecciona un concepto'} disabled={saving} />
```

- [ ] **Step 5: CSS para que el buscador ocupe el ancho completo del formulario**

En `src/app/globals.css`, en la línea 1056 (regla que agrupa selectores de ancho completo dentro de `.catalog-form`):

```css
.catalog-form button, .catalog-form > p, .catalog-form__pair { grid-column: 1 / -1; }
```

reemplazar por:

```css
.catalog-form button, .catalog-form > p, .catalog-form__pair, .catalog-form__concept-filter { grid-column: 1 / -1; }
```

- [ ] **Step 6: Verificar en navegador**

Abrir "Programar precio" desde el botón genérico, escribir parte de una clave o nombre en "Buscar concepto", confirmar que las opciones del select se reducen a las coincidencias. Borrar el filtro y confirmar que vuelve a mostrar todas. Abrir vía "Reprogramar" de una fila y confirmar que el filtro nace vacío y el concepto ya viene preseleccionado.

- [ ] **Step 7: `tsc`**

Run: `npx tsc --noEmit -p .` — sin errores nuevos.

- [ ] **Step 8: Commit**

```bash
git add src/components/StaffCatalogPriceListsTab.tsx src/app/globals.css
git commit -m "feat: filter the concepto select in Programar precio by code or name"
```

---

### Task 5: Buscador sobre la tabla de precios (Vigentes/Programados/Históricos)

**Files:**
- Modify: `src/components/StaffCatalogPriceListsTab.tsx`

**Interfaces:**
- Produce: estado local `tableFilter: string`, incorporado como dependencia de `priceGroups` (ya existente, `useMemo`).

- [ ] **Step 1: Agregar el estado y resetearlo al cambiar de lista**

Junto a `conceptFilter` (agregado en Task 4), agregar:

```tsx
  const [tableFilter, setTableFilter] = useState('');
```

En el `useEffect` que carga el detalle al cambiar `selectedPriceListId` (línea 93), resetear el filtro de tabla junto con la carga:

```tsx
  useEffect(() => { setTableFilter(''); if (selectedPriceListId) void loadPriceListDetail(selectedPriceListId); else setPriceListDetail(null); }, [loadPriceListDetail, selectedPriceListId]);
```

- [ ] **Step 2: Incorporar el filtro al cálculo de `priceGroups`**

Reemplazar el `useMemo` de `priceGroups` (líneas 37-50):

```tsx
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
```

por:

```tsx
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
```

- [ ] **Step 3: Renderizar el campo de búsqueda sobre las tres secciones**

En el render, justo antes del bloque `{[...].map((group) => (` (línea 207), insertar:

```tsx
              {priceListDetail.items.length > 8 && (
                <label className="staff-filters catalog-pricelists__table-filter"><span>Buscar en esta lista</span><input value={tableFilter} onChange={(event) => setTableFilter(event.target.value)} placeholder="Clave o nombre del concepto" maxLength={100} /></label>
              )}
```

- [ ] **Step 4: CSS del buscador de tabla**

En `src/app/globals.css`, después de la regla `.catalog-price-group` (línea 1076), agregar:

```css
.catalog-pricelists__table-filter { display: grid; gap: 6px; margin-top: 18px; }
.catalog-pricelists__table-filter span { color: var(--staff-muted); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.catalog-pricelists__table-filter input { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

- [ ] **Step 5: Verificar en navegador**

Seleccionar una lista de precio con varios conceptos. Si tiene 9 o más precios, confirmar que aparece "Buscar en esta lista" y que escribir filtra las tres secciones simultáneamente. Confirmar que cambiar de lista limpia el filtro. Confirmar que una lista con 8 o menos precios no muestra el buscador.

- [ ] **Step 6: `tsc`**

Run: `npx tsc --noEmit -p .` — sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
git add src/components/StaffCatalogPriceListsTab.tsx src/app/globals.css
git commit -m "feat: filter the price lists table by concepto code or name"
```

---

### Task 6: Verificación final, regresión y cierre de documentación

**Files:**
- Modify: `PROJECT_STATUS.md` (nueva entrada, mismo estilo que las dos entradas previas de esta rama)
- No crea archivos nuevos de prueba — reutiliza la suite E2E y unitaria existente.

- [ ] **Step 1: Verificación manual de extremo a extremo**

Con sesión de manager activa en el navegador:
1. Crear un concepto especial en Cotizaciones y confirmar que el símbolo "$" ya no se encima con el importe.
2. En Listas de precio, reprogramar un precio vigente desde el botón de fila, confirmar el flujo completo (concepto preseleccionado → nuevo importe/fecha → guardar → la tabla refleja el cambio).
3. Abrir los 7 modales existentes (Nueva lista, Editar lista, Programar precio, Nuevo concepto + wizard, Editar concepto, Agregar concepto especial, Agregar sección) y confirmar que ninguno produce el brinco de scrollbar.
4. Limpiar cualquier dato de prueba creado durante esta verificación (precios/listas/conceptos de prueba) siguiendo el mismo criterio de limpieza usado en rondas anteriores de esta rama.

- [ ] **Step 2: E2E dirigido**

Run: `npx playwright test tests/catalog.spec.ts tests/quotes.spec.ts`
Expected: ambos specs en verde (no deberían requerir cambios — el flujo no cambia, solo estilo y un atajo adicional).

- [ ] **Step 3: Regresión completa**

Run: `npm test`
Expected: verde. Si aparece contaminación de datos preexistente y no relacionada (como en rondas anteriores de esta rama), diagnosticar con `git diff main...catalog-ux-redesign --stat` antes de tocar cualquier dato, y seguir el mismo criterio ya usado (limpiar solo lo que se confirme ajeno a esta rama, con autorización si aplica).

- [ ] **Step 4: Limpieza de scripts de verificación manual**

Eliminar `scripts/manual-check-ui.ts` y cualquier usuario/sesión de prueba que haya quedado en la base de datos de desarrollo por su uso.

```bash
rm scripts/manual-check-ui.ts
```

- [ ] **Step 5: Entrada en `PROJECT_STATUS.md`**

Agregar una nueva entrada (mismo estilo de título en negrita + fecha que las dos entradas previas de esta rama), inmediatamente después de la entrada más reciente de Catálogo, resumiendo: fix de la colisión CSS `.catalog-form`/`.private-control`, fix del brinco de scrollbar en `PrivateDialog`, y las tres mejoras de "Listas de precio" (Reprogramar por fila, buscador de concepto, buscador de tabla).

- [ ] **Step 6: Commit de cierre**

```bash
git add PROJECT_STATUS.md
git commit -m "docs: close out price-lists UX and input/modal polish in PROJECT_STATUS"
```

- [ ] **Step 7: Iniciar `superpowers:finishing-a-development-branch`**

Presentar el menú de 4 opciones estándar (merge local / PR / mantener / descartar) una vez todo lo anterior esté en verde.
