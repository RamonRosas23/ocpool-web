# Listas de precio UX + pulido de inputs/selects + fix de scrollbar en modales

**Fecha:** 2026-09-25
**Rama:** `catalog-ux-redesign`
**Contexto:** Tercera ronda de refinamiento del Catálogo comercial, después de (1) el rediseño de IA/pestañas y (2) los formularios modales + wizard guiado de primer precio. El usuario reportó tres problemas concretos tras probar el trabajo anterior en vivo.

## Problemas reportados

1. **"Listas de precio" es difícil de usar para agregar/editar conceptos con precio.** Para reprogramar el precio de un concepto que ya tiene uno, hay que reabrir "Programar precio" y volver a buscar ese concepto desde cero en un `<select>` plano de hasta 50 opciones. No hay atajo desde la tabla de precios ya visible en pantalla.
2. **El prefijo "$" de los campos de dinero se encima con lo que el usuario escribe** ("escribes y no se quita y sale arriba del número"). Pidió también un pulido "top premium" de inputs y selects en general.
3. **Al abrir cualquier modal aparece una scrollbar lateral que hace que el modal "brinque" hacia la izquierda.**

## Causa raíz (verificada en código, no solo en el navegador)

### El bug del "$" y el pulido de inputs

`src/app/globals.css:1054` define:

```css
.catalog-form input, .catalog-form select, .catalog-form textarea { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

Especificidad `(0,1,1)`. Esta regla se escribió cuando `.catalog-form` sólo contenía `<input>`/`<textarea>` planos (Clave, Nombre, Motivo, etc.). Desde el rediseño modal, `.catalog-form` también hospeda componentes del sistema de diseño (`PrivateMoneyField`, `PrivateDatePicker`) cuyo `<input>` lleva la clase `.private-control` con estilos propios:

- `.private-control { min-height: 44px; padding: 10px 12px; border-radius: var(--private-radius-control); ... }` — especificidad `(0,1,0)`
- `.private-money-field__input { padding-left: 26px; }` — especificidad `(0,1,0)`

Como `(0,1,1) > (0,1,0)`, la regla genérica de `.catalog-form` gana y pisa el padding/min-height que estos componentes necesitan. Confirmado con medición directa en el DOM (`getComputedStyle`): `padding-left` real del input de dinero era `10px` en vez de `26px`, dejando el texto tecleado a ~2px del símbolo "$". El mismo choque afecta `PrivateDatePicker` (también renderiza un `<input>` con rol `textbox`).

**Esto no es solo un bug del símbolo "$": es una fuga de estilos entre dos sistemas de CSS que hoy coexisten en el mismo formulario.** El arreglo correcto es a nivel de la regla, no parchar cada componente por separado.

**Fix:** excluir `.private-control` de la regla genérica con `:not()`:

```css
.catalog-form input:not(.private-control), .catalog-form select, .catalog-form textarea:not(.private-control) { width: 100%; min-height: 40px; border: 1px solid var(--staff-line); border-radius: 0; padding: 8px 10px; background: var(--staff-paper); color: var(--staff-ink); font-size: 12px; outline: none; }
```

Con esto, cualquier `<input>`/`<textarea>` que use `.private-control` (dinero, fecha, y cualquier campo futuro del sistema de diseño) queda totalmente fuera del alcance de esta regla y se renderiza con su propio diseño (44px de alto, padding correcto, radio de borde, transiciones de foco/hover) — resolviendo el símbolo "$", la fecha, y sirviendo como pulido general "top premium" para todos los campos del sistema de diseño usados dentro de Catálogo y Cotizaciones (`.catalog-form` se reutiliza en `StaffQuotesPanel.tsx` para "Agregar concepto especial"). No se requiere tocar `PrivateSelect` — su trigger es un `<button>`, no coincide con `.catalog-form select`, y ya se renderiza sin este choque.

Un único cambio en CSS compartido corrige los tres campos de dinero/fecha existentes en Catálogo (Conceptos, Listas de precio) y Cotizaciones a la vez.

### El brinco de la scrollbar en modales

`PrivateDialog.tsx` bloquea el scroll del fondo así:

```tsx
if (modal) document.body.style.overflow = 'hidden';
```

Esto oculta la scrollbar del documento sin compensar el ancho que libera, así que el contenido (incluido el modal centrado) se recorre unos pixeles a la derecha al abrir y salta de vuelta al cerrar. Se descarta una solución global (`scrollbar-gutter: stable` en `html`) porque afectaría también la landing pública, que está fuera de alcance (regla del proyecto: no tocar la landing). El fix queda local al componente.

## Diseño de la solución

### 1. Fix de CSS compartido (input/select/dinero/fecha)

Un cambio en `src/app/globals.css:1054`, descrito arriba. Efecto colateral deseado: eleva automáticamente la calidad visual de `PrivateMoneyField` y `PrivateDatePicker` en cualquier `.catalog-form` existente o futuro, sin tocar componente por componente.

### 2. Fix de `PrivateDialog` (scrollbar)

En el `useEffect` que bloquea el scroll (`PrivateDialog.tsx:41-70`), medir el ancho real de la scrollbar (`window.innerWidth - document.documentElement.clientWidth`) y aplicarlo como `padding-right` en `document.body` mientras el modal está abierto, restaurando el valor previo al cerrar — igual que ya se hace con `overflow`. Cambio contenido en el componente compartido; los 7 modales existentes (Catálogo + Cotizaciones) quedan arreglados automáticamente.

### 3. Rediseño de "Listas de precio" (`StaffCatalogPriceListsTab.tsx`)

**Objetivo:** que reprogramar el precio de un concepto ya existente sea un clic desde la tabla, y que encontrar un concepto entre muchos (al agregar o reprogramar) no dependa de scrollear un `<select>` plano.

**a) Acción "Reprogramar" por fila.** Cada fila de precio en los grupos **Vigentes** y **Programados** (no en Históricos — un precio cerrado no se "reprograma", se agrega uno nuevo desde cero) gana un botón discreto "Reprogramar". Al hacer clic:
- Se abre el diálogo "Programar precio" ya existente.
- `priceForm.catalogItemId` queda pre-seleccionado con el concepto de esa fila.
- `amountInput`, `effectiveFrom` y `reason` se limpian (es un precio nuevo, no una edición in-place del registro histórico — coherente con el modelo de datos append-only ya usado por `schedulePriceForItem`).
- El texto de vista previa (`previewText`) ya existente sigue funcionando sin cambios: al tener el concepto preseleccionado, inmediatamente le dice al usuario qué precio vigente se cerrará.

No se requiere ningún endpoint nuevo — reutiliza `schedulePriceForItem` tal cual.

**b) Buscador dentro del selector de "Concepto".** En el diálogo "Programar precio", un campo de texto simple justo arriba del `PrivateSelect` de "Concepto" filtra la lista de `pricableItems` (por clave o nombre, client-side, sin llamadas nuevas a la API) antes de pasarla como `options` al select. Estado local `conceptFilter: string`, se reinicia al abrir/cerrar el diálogo. Si el concepto fue preseleccionado por "Reprogramar" (punto a), el filtro nace vacío y el select ya muestra la opción correcta — el buscador solo entra en juego cuando el usuario abre el diálogo desde el botón genérico "Programar precio".

**c) Buscador sobre la tabla de precios.** Un campo de texto sobre las tres secciones (Vigentes/Programados/Históricos) filtra `priceListDetail.items` por clave o nombre del concepto antes de agruparlos (`priceGroups` ya es un `useMemo`, se le agrega esta entrada como dependencia). Mejora el escaneo en listas con muchos conceptos con precio. Solo se muestra si `priceListDetail.items.length` supera un umbral pequeño (p. ej. > 8) para no añadir ruido visual a listas cortas.

## Fuera de alcance

- No se toca `StaffQuotesPanel.tsx` más allá de heredar automáticamente el fix de CSS (ya usa `.catalog-form` + `PrivateMoneyField`).
- No se agrega capacidad de cancelar/eliminar un precio ya programado — no existe endpoint para eso hoy y es una decisión de producto aparte, no un problema de UI/UX.
- No se unifica el radio de borde/tipografía entre `.catalog-form` (esquinas rectas, estética del shell legado) y `.private-control` (2px de radio) — es una diferencia de estilo deliberada entre dos generaciones de diseño en el código, no un bug.
- No se convierte `PrivateSelect` en un componente "searchable" genérico y reutilizable — el buscador de concepto es local a este diálogo, del tamaño exacto del problema reportado.

## Verificación

- `tsc`/lint sobre los archivos tocados.
- Verificación manual en navegador: crear/reprogramar un precio desde la tabla, confirmar que "$" y la fecha ya no se encimen con el texto, confirmar que abrir cualquiera de los 7 modales no produce brinco visual (medir `document.body.getBoundingClientRect()` o el `left` de un elemento fijo antes/después de abrir).
- E2E existente de Catálogo (`tests/catalog.spec.ts`) y de Cotizaciones (`tests/quotes.spec.ts`) deben seguir pasando sin cambios (no alteran flujo, solo estilo y un atajo adicional).
- Regresión completa `npm test` antes de cerrar la rama.
