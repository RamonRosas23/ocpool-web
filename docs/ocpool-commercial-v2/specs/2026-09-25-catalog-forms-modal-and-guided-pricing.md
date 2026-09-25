# OCPOOL — Catálogo comercial y constructor de cotizaciones: formularios modales y alta guiada con precio

**Fecha:** 2026-09-25
**Estado:** diseño aprobado por el responsable de producto; pendiente de plan de implementación.
**Superficie:** `/staff/catalog` (continúa directamente sobre [`2026-09-25-catalog-ux-redesign.md`](2026-09-25-catalog-ux-redesign.md), ya implementado en la rama `catalog-ux-redesign`) y, de forma acotada, `/staff/quotes` (sólo los dos formularios de alta descritos en §2.4 — el resto de esa pantalla queda intacto).
**Fuera de alcance:** cualquier cambio de API, modelo de datos o migración; la pestaña "Por revisar"; el resto de `StaffQuotesPanel.tsx` (líneas de catálogo, aprobaciones, PDF, handoff a proyecto — candidato a su propio proyecto de refactorización, documentado como tal, no tocado aquí); el resto de paneles staff.

## 1. Propósito

Tras usar el rediseño de tabs ya implementado, el responsable de producto reportó tres problemas reales de uso, dos en Catálogo y uno al comparar Catálogo contra el constructor de cotizaciones (auditoría en vivo de `/staff/quotes` pedida explícitamente para verificar alineación):

1. **Fricción de flujo:** dar de alta un concepto vendible con su precio exige salir de la pestaña Conceptos, entrar a Listas de precio, y volver a buscar el concepto recién creado — 6 pasos en 2 pestañas para una sola intención ("necesito vender esto"). Además, el formulario de "Nuevo concepto" no recuerda la categoría que ya tienes filtrada en el árbol.
2. **Inconsistencia visual dentro de Catálogo:** "Nuevo concepto", "Editar concepto", "Nueva lista" y "Editar lista" empujan el contenido de la pantalla hacia abajo en vez de aparecer como diálogo modal — a diferencia de "Gestionar categorías", que sí es un modal.
3. **La misma inconsistencia, encontrada también en el constructor de cotizaciones:** verificado en vivo contra una cotización real armada ex profeso (sección + 2 líneas de catálogo + 1 concepto especial) — "Agregar concepto especial" y "Agregar sección" en `StaffQuotesPanel.tsx` tienen el mismo defecto exacto (formulario inline que empuja contenido), uno junto al otro. El resto de esa pantalla (buscador de conceptos por escritura, selector de lista de precios, "Verificar precios vigentes") ya funciona bien y **no** necesita copiar el patrón de navegación de Catálogo — son tareas distintas (agregar una línea a un documento activo vs. explorar/administrar el catálogo completo).

## 2. Diseño aprobado

### 2.1 Todo formulario de alta/edición pasa a modal

Mismo primitivo ya usado (`PrivateDialog`), mismo criterio de "un modal, contenido atenuado detrás":

- Nuevo concepto / Editar concepto (`StaffCatalogConceptsTab`)
- Nueva lista / Editar lista (`StaffCatalogPriceListsTab`)
- Programar precio (`StaffCatalogPriceListsTab`) — deja de ser un formulario siempre visible al fondo de la pestaña; se activa con un botón "Programar precio" junto al encabezado de la lista seleccionada.

### 2.2 Precarga de categoría

Al abrir "Nuevo concepto" con una categoría específica filtrada en el árbol (no "Todos"), el campo Categoría del formulario arranca con esa categoría ya seleccionada.

### 2.3 Alta guiada con precio (el cambio central)

El modal de "Nuevo concepto" pasa a tener dos pasos dentro del mismo diálogo (sin cerrarlo entre uno y otro):

- **Paso 1 — Datos del concepto:** los mismos campos de hoy (clave, nombre, unidad, categoría, descripción). Botón "Continuar".
- **Paso 2 — Precio inicial (opcional):** aparece inmediatamente después de crear el concepto (ya persistido en el paso 1 — no se retiene sin guardar a la espera del paso 2, para no perder el concepto si el usuario cierra el modal a medias). Lista de precios (selector) + importe + fecha vigente desde, reutilizando `PrivateMoneyField`/`PrivateDatePicker`/el mismo endpoint `POST /price-lists/{id}/schedule` que ya usa Listas de precio. Dos botones: "Guardar precio y cerrar" y "Omitir por ahora".
  - Si no existe ninguna lista de precios activa todavía, el paso 2 se omite automáticamente y el modal cierra tras el paso 1 con un aviso: "Concepto creado. Crea una lista de precio para poder asignarle un precio."

**Decisión de alcance:** el paso 2 sólo aparece en la creación. Editar un concepto existente abre el modal de edición simple (paso 1 únicamente) — la fricción de "no puedo poner el precio sin salir de aquí" es específicamente un problema de alta de un concepto nuevo, no de edición; un concepto ya existente típicamente ya tiene precio o se gestiona desde Listas de precio de forma consciente, no como parte de un flujo de creación.

### 2.4 Mismo tratamiento, acotado, en el constructor de cotizaciones

En `StaffQuotesPanel.tsx`, sólo estos dos formularios (ambos ya inline, uno junto al otro, botones "Agregar concepto especial" / "Agregar sección") pasan a modal, sin ningún otro cambio en el resto del archivo:

- **"Agregar concepto especial"**: mismos campos de hoy (nombre, unidad, importe, motivo, descripción) dentro de un `PrivateDialog`, activado por el botón que ya existe.
- **"Agregar sección"**: mismos campos de hoy (título, descripción) dentro de un `PrivateDialog`, activado por el botón que ya existe.

No se agrega ningún paso guiado adicional aquí (a diferencia de §2.3) — el pedido específico era consistencia visual, no un flujo nuevo; el buscador de conceptos de catálogo (`CatalogItemSearchCombobox`) ya es de por sí una forma rápida y correcta de agregar líneas, y no se toca.

## 3. Arquitectura de componentes

- `StaffCatalogConceptsTab.tsx`: agrega estado de wizard (`createStep: 'form' | 'price' | null`), y una carga ligera y perezosa de `priceLists` (sólo `id`/`code`/`name`/`currencyCode`, mismo endpoint `GET /api/staff/catalog/price-lists?status=ACTIVE` que ya usa `StaffCatalogPriceListsTab`, pero sin el detalle de precios) — se pide sólo cuando se abre el modal de alta, no en cada carga de la pestaña, para no duplicar tráfico en el caso común de sólo navegar/editar. El formulario de edición no cambia de forma, sólo de contenedor (modal en vez de inline).
- `StaffCatalogPriceListsTab.tsx`: el formulario de "Programar precio" se mueve dentro de un `PrivateDialog` activado por un botón nuevo; "Nueva lista"/"Editar lista" pasan del bloque inline actual al mismo contenedor modal.
- `StaffQuotesPanel.tsx`: `showSpecialForm`/`showSectionForm` pasan de controlar un `<form className="catalog-form">` inline a controlar la visibilidad de un `PrivateDialog` cada uno — mismos campos, mismos manejadores (`addSpecialLine`/`addSection`), sin tocar el resto del archivo (líneas de catálogo, aprobaciones, documento/PDF, handoff a proyecto quedan exactamente igual).
- Ningún componente nuevo — son cambios de contenedor (`<form>` inline → `<PrivateDialog><form>...`) y de estado (un paso más en Conceptos) dentro de archivos ya existentes.

## 4. Manejo de errores y estados

Mismo patrón (`notice`/`error`, `role="status"`/`role="alert"`) ahora dentro del modal en vez de en la página. Cerrar el modal a medias del paso 1 (antes de guardar) no persiste nada, igual que hoy. Cerrar el modal en el paso 2 sin guardar precio dejó el concepto ya creado — comportamiento esperado y explícito ("Omitir por ahora"), no un error. En `StaffQuotesPanel.tsx`, cerrar el modal de "Agregar concepto especial"/"Agregar sección" sin enviar el formulario no persiste nada — igual que hoy (la línea/sección sólo se agrega al arreglo local en memoria al enviar; el autosave existente la guarda después, sin cambios en ese mecanismo).

## 5. Impacto en pruebas

`tests/catalog.spec.ts` (Task 8 de la implementación anterior) necesita ajustar los selectores del flujo de alta de concepto (ahora dentro de un `role="dialog"`, con un paso adicional a confirmar u omitir) y de "Nueva lista"/"Editar lista"/"Programar precio" (mismo cambio de contenedor). La cobertura funcional no cambia — se agrega una aserción nueva para el paso 2 del wizard (crear un concepto y asignarle un precio en el mismo flujo, sin cambiar de pestaña). `tests/quotes.spec.ts` necesita el mismo ajuste puntual de selectores para "Agregar concepto especial"/"Agregar sección" (buscar dentro de `role="dialog"` en vez de la página completa) — sin cambiar qué se afirma, sólo dónde se busca.

## 6. Criterios de terminado

- Los 5 formularios de Catálogo listados en §2.1 son modales, ninguno empuja el contenido de la página.
- Los 2 formularios de `/staff/quotes` listados en §2.4 son modales.
- Crear un concepto con categoría filtrada precarga esa categoría.
- Crear un concepto y asignarle un precio se puede hacer sin cambiar de pestaña, en un solo flujo.
- Editar concepto/lista sigue funcionando igual que hoy, sólo en modal.
- `tests/catalog.spec.ts` y `tests/quotes.spec.ts` actualizados y en verde; regresión completa sin nuevas roturas relacionadas con este cambio.

## 7. Fuera de alcance

Todo lo ya listado en §10 de la spec anterior sigue igual de fuera de alcance (V2 de solicitudes, aprobaciones accionables, historial de versiones del portal, notificar `PROJECT.CREATED` + `/staff/projects`). No se agrega ningún flujo guiado equivalente a "Listas de precio" ni a "Por revisar" — el problema de fricción reportado era específicamente el de dar de alta un concepto con su primer precio.

**Explícitamente fuera de alcance, decisión deliberada confirmada con el responsable de producto:** dividir `StaffQuotesPanel.tsx` completo (1,131 líneas — mezcla armado de líneas, decisiones de aprobación, generación de PDF/aceptación y handoff a proyecto en una sola pantalla continua, el monolito más severo del sistema). Es candidato real a su propio proyecto de rediseño con su propio ciclo brainstorm → spec → plan, no una extensión de este cambio puntual de consistencia visual. Tampoco se toca el comportamiento de "aplicar de inmediato sin confirmar" del selector de Perfil de IVA (inconsistente contra el re-precio, que sí confirma) — es una decisión de diseño ya documentada con su propia justificación ("una obra tiene una sola zona fiscal, no es una decisión de precio"), no un defecto de esta pieza; revisarla es una pieza aparte si se decide hacerlo.
