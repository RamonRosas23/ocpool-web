# OCPOOL — Catálogo comercial: rediseño de UI/IA

**Fecha:** 2026-09-25
**Estado:** diseño aprobado por el responsable de producto; pendiente de plan de implementación.
**Superficie:** `/staff/catalog` — `StaffCatalogPanel` y los componentes que lo reemplazan.
**Fuera de alcance:** cualquier cambio de API, modelo de datos o migración; la landing pública; el resto de paneles staff (`StaffQuotesPanel`, `StaffRequestsPanel`, activar `requestWorkspaceV2`, etc.) — son proyectos separados, identificados en la auditoría del 2026-09-25 y documentados en `PROJECT_STATUS.md`, cada uno con su propio ciclo diseño → plan → implementación.

## 1. Propósito

El catálogo (conceptos, categorías, listas de precio y la bandeja de conceptos especiales) hoy vive entero en `StaffCatalogPanel.tsx`, una sola pantalla de scroll continuo sin separación real. El responsable de producto no logra identificar dónde crear un concepto nuevo, y no hay separación perceptible entre "catálogo", "listas de precio" y "conceptos". El objetivo de este rediseño es que **con solo ver la pantalla, cualquier usuario sepa qué es cada cosa y qué botón tocar**, sin instrucciones previas.

## 2. Diagnóstico (evidencia de la auditoría 2026-09-25)

`StaffCatalogPanel.tsx` (434 líneas) apila, en un solo scroll sin tabs ni secciones reales:

1. Lista de conceptos + su detalle/edición.
2. Gestión de listas de precio + programación de precios (dentro del mismo bloque que el detalle del concepto).
3. El botón para agregar un concepto nuevo, ubicado *debajo* del bloque de precios.
4. Gestión de categorías, en otra sección colapsable más abajo.
5. La bandeja de "conceptos especiales" pendientes de promoción, hasta el final, colapsada por defecto.

Tres acciones de "crear algo nuevo" (concepto, lista, categoría) en tres lugares distintos de la página, con el mismo peso visual. No existe una entidad "Catálogo" en el modelo de datos — es la colección implícita de `CatalogItem`/`CatalogCategory`; el problema es 100% de organización de información, no de datos faltantes.

## 3. Diseño aprobado

### 3.1 Navegación

Una sola pantalla "Catálogo comercial" con **pestañas** (mismo patrón ya usado en `RequestWorkspaceDetailV2`, aunque ahí está implementado a mano): **Conceptos** (pestaña por defecto) · **Listas de precio** · **Por revisar**. El estado de la pestaña activa vive en la URL (`?tab=items|price-lists|review`, valores internos en inglés, nunca visibles al usuario) para que sea recargable y compartible por link.

La pestaña "Por revisar" muestra un badge numérico con la cantidad de grupos pendientes (hoy esa información existe pero está oculta detrás de un botón "Ver conceptos especiales" que nadie tiene motivo para tocar).

### 3.2 Pestaña "Conceptos"

Layout de 3 columnas (aprobado por mockup):

- **Columna izquierda (árbol de categorías, ~170px):** filtro jerárquico de categorías. Clic en una categoría filtra la lista de la columna central. Incluye un enlace "Gestionar categorías" al pie que abre un diálogo (ver §3.6) — las categorías dejan de tener su propia sección de página completa.
- **Columna central (lista de conceptos, ~260px):** buscador + lista paginada, igual que hoy.
- **Columna derecha (detalle):** datos del concepto seleccionado (nombre, código, unidad, categoría, descripción, estado) y acciones Editar/Archivar — igual que hoy. **No muestra precios**: toda la información de precios (incluido "¿en qué listas está este concepto y a qué precio?") vive únicamente en la pestaña "Listas de precio", para que cada pestaña tenga una sola responsabilidad y no se necesite ninguna consulta nueva al backend (una vista "precio de este concepto en todas las listas" implicaría un endpoint que hoy no existe — fuera de alcance).

CTA primario fijo arriba a la derecha de la pestaña: **"Nuevo concepto"** (antes "Agregar concepto" — se renombra por consistencia con "Nueva lista"/"Nueva categoría").

### 3.3 Pestaña "Listas de precio"

Master-detail de dos columnas: lista de listas de precio a la izquierda (código, moneda, nº de conceptos, estado), detalle a la derecha con la tabla de precios agrupada en Vigentes/Programados/Históricos (igual lógica que hoy) y el formulario "Programar precio". CTA primario fijo arriba a la derecha: **"Nueva lista"**.

### 3.4 Pestaña "Por revisar"

Bandeja plana (sin master-detail, es una cola de triage): una fila por grupo de concepto especial, con nombre, unidad, ocurrencias, folios recientes y su estado (`Pendiente` / `Ya existe: <código>` / `Promovido a <código>`), con el botón de acción correspondiente (`Promover a catálogo` / `Vincular`) a la derecha de cada fila. Sin colapsar por defecto — es su propia pestaña, ya no compite por atención con el resto del catálogo.

### 3.5 Reglas visuales transversales

- **Un solo botón de acento (relleno) por pestaña**, reservado para su acción principal: "Nuevo concepto" / "Nueva lista" / "Promover a catálogo". Todo lo demás (Editar, Archivar, Cancelar, Vincular, Gestionar categorías) usa estilo neutro/outline. Mapea a las clases ya existentes: acento = `staff-button--copper`, confirmaciones de formulario = `staff-button--dark`, resto = `staff-button`/`staff-button--outline`.
- **Estados vacíos con enseñanza:** kicker + título + una línea explicando qué es esa pestaña + CTA grande y centrado. Ejemplo para Conceptos sin datos: *"Todavía no tienes conceptos en tu catálogo — cada concepto es un producto o servicio que después podrás agregar a una propuesta con su precio. [Crear el primer concepto]"*. Mismo patrón para las 3 pestañas, adaptando el texto.

### 3.6 Gestión de categorías

"Gestionar categorías" abre un `PrivateDialog` (componente ya existente en `src/components/private/ui/PrivateDialog.tsx`, ya usado para flujos equivalentes en `RequestWorkspaceActionsV2`) con el árbol completo y las acciones crear/editar/archivar que ya existen hoy — mismo comportamiento, solo cambia el contenedor visual de "sección de página" a "diálogo".

## 4. Arquitectura de componentes

`StaffCatalogPanel.tsx` pasa de 434 líneas monolíticas a un shell delgado:

- Carga `capabilities` una vez (es lo único verdaderamente transversal a las 3 pestañas).
- Controla la pestaña activa vía URL.
- Renderiza uno de tres componentes nuevos, cada uno autocontenido y responsable de su propia carga de datos, estado de formularios y errores:
  - `StaffCatalogConceptsTab.tsx`
  - `StaffCatalogPriceListsTab.tsx`
  - `StaffCatalogReviewTab.tsx`
- `StaffCatalogCategoryDialog.tsx` — el diálogo de §3.6, usado por `StaffCatalogConceptsTab` (para el árbol/formularios) y por `StaffCatalogReviewTab` (para el selector de categoría al promover un concepto especial).
- `PrivateTabs.tsx`, nuevo, en `src/components/private/ui/` — primitivo de pestañas reutilizable (hoy no existe uno; `RequestWorkspaceDetailV2` tiene su propio `role="tablist"` hecho a mano). Se usa aquí; **no se toca `RequestWorkspaceDetailV2`** para adoptarlo — fuera de alcance de este proyecto.
- Tipos compartidos (`Category`, `CatalogItem`, `PriceList`, `PriceListDetail`, `Capabilities`, `SpecialConceptGroup`) se mueven a un archivo nuevo `src/lib/staff-catalog-types.ts`, importado por el shell y los 3 tabs, para no duplicar las definiciones.

**Decisión deliberada sobre categorías:** tanto `StaffCatalogConceptsTab` como `StaffCatalogReviewTab` necesitan la lista de categorías; en vez de que el shell la cargue y la pase por props (acoplando el shell a necesidades de una pestaña específica), cada tab la pide de forma independiente cuando se monta. Es una duplicación de fetch pequeña y aceptada a cambio de que cada pestaña sea 100% autónoma y entendible sin leer las otras.

## 5. Carga de datos

Ya no se hacen las 4 peticiones en paralelo siempre. Cada pestaña carga solo lo suyo, solo al montarse:

- **Conceptos** (pestaña por defecto): items + categorías, de inmediato.
- **Listas de precio**: lista de price lists al entrar a la pestaña; el detalle de la lista seleccionada, como hoy, al seleccionarla.
- **Por revisar**: igual que hoy — perezoso, solo al entrar a la pestaña (esto ya es así actualmente y se conserva).

## 6. Permisos

Sin cambios de comportamiento. `catalogRead`/`catalogManage` siguen gateando Conceptos y categorías; `pricesRead`/`pricesManage` siguen gateando Listas de precio. Un usuario sin `catalogManage` no ve "Nuevo concepto" ni "Gestionar categorías"; sin `pricesManage` no ve "Nueva lista" ni "Programar precio" — exactamente igual que hoy, solo reubicado.

## 7. Manejo de errores y estados

Mismo patrón ya establecido en el resto del sistema, replicado por pestaña: `notice`/`error` con `role="status"`/`role="alert"`, skeleton de carga, y `PrivateBlockingState` para acceso denegado. No se introduce ningún patrón nuevo.

## 8. Impacto en pruebas

- `tests/catalog.spec.ts` (E2E, Playwright): hoy ejercita todo el flujo como una sola página continua. Se reescribe para navegar entre pestañas — prueba exactamente los mismos casos (crear concepto, programar precio, crear categoría vía el diálogo, promover concepto especial, archivar/reactivar, mostrar archivados) con los nuevos selectores/flujo de pestañas.
- `tests/integration/catalog-api.test.ts`, `catalog-service.test.ts`, `catalog-search-service.test.ts`, `catalog-schedule-price.test.ts`, `catalog-quotes-schema.test.ts`, `tests/unit/catalog-quotes-domain.test.ts`: sin cambios — no se toca backend ni dominio.
- Pruebas de otros specs que puedan referenciar textos/selectores de catálogo de pasada (ninguna encontrada fuera de `catalog.spec.ts` en la auditoría) se verifican en la regresión completa del gate final.

## 9. Criterios de terminado

- Las 3 pestañas existen, cada una con su único CTA de acento y su propio estado vacío.
- Ningún flujo actual (crear/editar/archivar/reactivar concepto, categoría o lista; programar precio; promover concepto especial) pierde funcionalidad ni permisos.
- `tests/catalog.spec.ts` reescrito y en verde; regresión completa (unitarias/integración/E2E/tsc/lint) en verde.
- `StaffCatalogPanel.tsx` queda como shell (\<100 líneas aprox.); ningún componente nuevo supera ~250 líneas.
- Verificación manual contra el checklist de accesibilidad ya aplicado al resto del sistema (roles, foco, `aria-live`) en las 3 pestañas.

## 10. Fuera de alcance / backlog relacionado

Identificado en la misma auditoría, cada uno como proyecto propio futuro: activar `requestWorkspaceV2`/`commercialWorkspaceV2`; dividir `StaffQuotesPanel.tsx` (1,131 líneas — mezcla armado de propuesta, aprobaciones y generación de PDF/handoff a proyecto en una sola pantalla); aprobaciones accionables desde `StaffApprovalsPanel` sin abrir el expediente completo; historial de versiones navegable en el portal del cliente; notificar `PROJECT.CREATED` y agregar una página `/staff/projects`.
