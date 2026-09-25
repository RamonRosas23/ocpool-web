# Sistema premium de modales, combobox de búsqueda y limpieza de formularios

**Fecha:** 2026-09-25
**Rama:** `catalog-ux-redesign`
**Contexto:** Inmediatamente después de cerrar la pieza de "Listas de precio + inputs + scrollbar", el responsable de producto probó el resultado en vivo y lo calificó como todavía deficiente: "la configuración de lista de precios es rara, mala ui/ux igual en los modales... para crear precio para un insumo... haz análisis de los putos modales, de absolutamente todo, los input, selects, buscadores, etc, todo tiene que ser optimizado, ui/ux de calidad premium".

## Diagnóstico (verificado en navegador real, no solo en código)

Con sesión de manager real se abrieron "Programar precio" y "Nuevo concepto" y se capturaron ambos. Hallazgos concretos:

1. **El selector de "Concepto" en "Programar precio" son DOS controles desconectados** ("Buscar concepto" como caja de texto aislada + "Concepto" como `<select>` separado debajo), cuando debería ser un solo control de tipo combobox (escribes y ves las coincidencias ahí mismo). Esto lo introdujo la pieza anterior de esta misma rama al intentar agregar búsqueda sin construir un combobox real.
2. **El cromado del modal se ve como un wireframe sin terminar**: borde de 1px sólido, esquinas cuadradas (`border-radius: 0`), fondo plano, sombra fuerte de "cortina" en vez de una elevación suave, y un botón "CERRAR" con borde rectangular de texto que compite visualmente con el título. Contrasta fuerte con `PrivateDialog`/`PrivateSelect`/`PrivateMoneyField`, que ya usan el sistema `private-ui` (esquinas de 2px, sombra suave `--private-shadow-popover`, tokens `--private-color-*`) — es decir, los CONTROLES de adentro ya se ven bien, pero el MARCO que los contiene se quedó en el lenguaje visual anterior. Esa mezcla es la causa real de la sensación de "no premium": no es un solo estilo, son dos conviviendo mal.
3. **Etiquetas de campo en mayúsculas + negritas + letter-spacing en todo `.catalog-form`** ("BUSCAR CONCEPTO", "CONCEPTO", "IMPORTE") — tratamiento tipográfico "administrativo", mientras que `.private-field__label` (usado por los campos ya migrados) es texto normal, más suave.
4. **Catálogo usa un botón "Cerrar" con borde y texto en los 7 diálogos que le pertenecen**, mientras que **Cotizaciones ya resolvió esto bien**: sus 7 diálogos (`repriceDialog`, `publishPreflight`, `returnToDraftDialog`, `rejectVersionDialog`, `rejectApprovalDialog`, `showSpecialForm`, `showSectionForm`) usan un botón de solo ícono (`X` de `lucide-react`, clase `.quotes-reprice-dialog__close`) consistente en los 7. Catálogo nunca adoptó ese patrón — hay que alinearlo, no inventar uno nuevo.
5. **Bug real, introducido por esta misma rama hace unos minutos** (no preexistente): al agregar `:not(.private-control)` a `.catalog-form input` en la pieza anterior para arreglar el símbolo "$", la especificidad de esa regla subió de `(0,1,1)` a `(0,2,1)` — con eso pasó a ganarle también a `.catalog-filters__toggle input { width: auto; min-height: 0; }` (especificidad `(0,1,1)`, antes ganaba por orden de aparición al empatar en especificidad). Resultado: el checkbox de "Especificar clave manualmente" ahora se renderiza con `width:100%; min-height:40px; padding:8px 10px; border:1px solid...` — un cuadro grande y descolocado en vez de un checkbox pequeño en línea con su etiqueta. Confirmado visualmente en la captura de "Nuevo concepto".

## Diseño de la solución

Alcance: los **14 diálogos** de Catálogo (`StaffCatalogConceptsTab.tsx` ×3, `StaffCatalogCategoryDialog.tsx` ×1, `StaffCatalogPriceListsTab.tsx` ×3) y Cotizaciones (`StaffQuotesPanel.tsx` ×7). No se toca ningún otro panel del shell de staff (dashboard, tablas, navegación) — el reclamo es específicamente sobre modales/formularios, y extenderlo a todo el shell sería una pieza de trabajo distinta y mucho mayor, fuera de lo pedido.

### 1. Fix inmediato del checkbox (bug de esta misma rama, no preexistente)

En `src/app/globals.css`, excluir también los checkboxes de la regla genérica de `.catalog-form`, ya que nunca debieron recibir padding/borde de input de texto:

```css
.catalog-form input:not(.private-control):not([type="checkbox"]), .catalog-form select, .catalog-form textarea:not(.private-control) { ... }
```

Con los checkboxes fuera de esa regla por completo, `.catalog-filters__toggle input` vuelve a aplicar limpio sin competir en especificidad.

### 2. `PrivateCombobox` — nuevo componente reutilizable

Un combobox de una sola selección sobre un arreglo de opciones ya cargado en memoria (no hace llamadas a la API — a diferencia de `CatalogItemSearchCombobox`, que sí busca en vivo porque su caso de uso son cientos de conceptos; aquí `pricableItems` ya viene acotado a 50). Modelado en el patrón de interacción ya probado de `CatalogItemSearchCombobox` (teclado con flechas, Enter, Escape, cierre al hacer clic fuera, ARIA `combobox`/`listbox`/`option`), pero genérico y estilizado con los tokens `private-ui` (borde, radio, sombra de `PrivateSelect`), para que sea el reemplazo natural de "caja de búsqueda + select separado" en cualquier parte del sistema, no solo en Catálogo.

Comportamiento: al escribir, filtra las opciones por coincidencia de texto (sin distinguir mayúsculas) contra `label` y un `sublabel` opcional; al seleccionar (clic o Enter), el input muestra el `label` de la opción elegida y el dropdown se cierra; al recibir foco con una opción ya seleccionada, el texto se preselecciona completo para que escribir de inmediato reemplace la búsqueda.

### 3. "Programar precio" usa `PrivateCombobox` para "Concepto"

Se elimina el campo "Buscar concepto" y el `PrivateSelect` de "Concepto" se sustituye por un único `PrivateCombobox`. El estado `conceptFilter` deja de existir como campo de texto separado; el propio combobox maneja su término de búsqueda internamente.

### 4. Cromado premium de diálogo (CSS compartido, cascada automática a los 14 diálogos)

Redisño de `.catalog-category-dialog`/`.catalog-category-dialog__overlay`/`.catalog-category-dialog__head` y `.quotes-preflight-dialog`/`.quotes-preflight-overlay`/`.quotes-preflight-dialog__head` y `.quotes-reprice-dialog`/`.quotes-reprice-overlay`/`.quotes-reprice-dialog__head`: esquinas redondeadas con `var(--private-radius-panel)`, sombra `var(--private-shadow-popover)` en vez del borde sólido pesado, borde más suave (`var(--private-color-border)` en vez de `var(--staff-line)` sólido), overlay con el mismo tono/opacidad ya usado por `PrivateDialog` en el resto de la app. Un solo bloque de reglas, tres selectores, cascada a los 14 diálogos sin tocar su JSX (salvo el botón de cerrar, punto 5).

### 5. Botón de cerrar consistente (ícono, no texto con borde)

Los 7 encabezados de diálogo de Catálogo (`catalog-category-dialog__head`) cambian su `<button className="staff-button">Cerrar</button>` por un botón de solo ícono (`X` de `lucide-react`, `aria-label="Cerrar"`), igual al que ya usan los 7 diálogos de Cotizaciones. En `globals.css`, `.quotes-reprice-dialog__close` se renombra a `.staff-dialog-close` (nombre neutral, ya que deja de ser exclusiva de "reprice") y las 7 referencias existentes en `StaffQuotesPanel.tsx` se actualizan al nuevo nombre; Catálogo reutiliza esa misma clase en sus 7 encabezados en vez de duplicar la regla.

### 6. Etiquetas de campo sin mayúsculas/letter-spacing

`.catalog-form label span` dej a de usar `text-transform: uppercase; letter-spacing: .08em; font-weight: 800` y adopta un tratamiento más cercano a `.private-field__label` (texto normal, peso medio, color `--staff-muted` conservado para no romper el contraste ya validado). Cambio puramente tipográfico, sin tocar estructura.

## Fuera de alcance

- No se convierte cada `<input>`/`<textarea>` plano (Clave, Nombre, Descripción, Motivo, Orden…) a `PrivateTextField`/`PrivateTextArea`. El mismo resultado visual (bordes suaves, radio, espaciado) se logra con las reglas CSS del punto 4/6 aplicadas directamente sobre `.catalog-form input/textarea`, sin el riesgo de tocar el cableado de cada campo (ARIA, handlers, validación) en 14 diálogos. Si en el futuro se necesita algo que solo `PrivateTextField` resuelve (p. ej. mensajes de error inline por campo), es una pieza aparte.
- No se toca ningún panel fuera de Catálogo/Cotizaciones (dashboard, solicitudes, aprobaciones, notificaciones, auditoría) ni la landing pública.
- No se cambia el radio de borde de elementos NO-modal del shell de staff (tablas, filas, botones de página) — siguen con esquinas rectas, que es el lenguaje ya establecido fuera de los diálogos.
- No se agregan llamadas nuevas a la API — `PrivateCombobox` opera sobre datos ya cargados.

## Verificación

- `tsc`/lint sobre los archivos tocados.
- Verificación manual en navegador: captura antes/después de "Programar precio" y "Nuevo concepto"; confirmar que el checkbox de "Especificar clave manualmente" vuelve a verse como checkbox pequeño en línea; confirmar que el combobox de concepto filtra y selecciona con teclado y mouse; confirmar visualmente los 14 diálogos con el nuevo cromado (al menos uno de cada archivo).
- E2E existente de Catálogo y Cotizaciones deben seguir pasando (la interacción de negocio no cambia, solo estilo y el combobox reemplaza al select+búsqueda — el spec de Catálogo necesitará actualizar el selector que usa `getByRole('combobox', { name: 'Concepto' })`/similar si el rol ARIA del nuevo control difiere del `PrivateSelect` anterior).
- Regresión completa `npm test` antes de cerrar la rama.
