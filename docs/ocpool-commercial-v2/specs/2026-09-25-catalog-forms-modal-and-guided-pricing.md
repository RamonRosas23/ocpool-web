# OCPOOL — Catálogo comercial: formularios modales y alta guiada con precio

**Fecha:** 2026-09-25
**Estado:** diseño aprobado por el responsable de producto; pendiente de plan de implementación.
**Superficie:** `/staff/catalog` — continúa directamente sobre [`2026-09-25-catalog-ux-redesign.md`](2026-09-25-catalog-ux-redesign.md), ya implementado en la rama `catalog-ux-redesign`.
**Fuera de alcance:** cualquier cambio de API, modelo de datos o migración; la pestaña "Por revisar" (sin formularios de alta); el resto de paneles staff.

## 1. Propósito

Tras usar el rediseño de tabs ya implementado, el responsable de producto reportó dos problemas reales de uso:

1. **Fricción de flujo:** dar de alta un concepto vendible con su precio exige salir de la pestaña Conceptos, entrar a Listas de precio, y volver a buscar el concepto recién creado — 6 pasos en 2 pestañas para una sola intención ("necesito vender esto"). Además, el formulario de "Nuevo concepto" no recuerda la categoría que ya tienes filtrada en el árbol.
2. **Inconsistencia visual:** "Nuevo concepto", "Editar concepto", "Nueva lista" y "Editar lista" empujan el contenido de la pantalla hacia abajo en vez de aparecer como diálogo modal — a diferencia de "Gestionar categorías", que sí es un modal. Dos comportamientos distintos para la misma acción de "crear/editar algo".

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

## 3. Arquitectura de componentes

- `StaffCatalogConceptsTab.tsx`: agrega estado de wizard (`createStep: 'form' | 'price' | null`), y una carga ligera y perezosa de `priceLists` (sólo `id`/`code`/`name`/`currencyCode`, mismo endpoint `GET /api/staff/catalog/price-lists?status=ACTIVE` que ya usa `StaffCatalogPriceListsTab`, pero sin el detalle de precios) — se pide sólo cuando se abre el modal de alta, no en cada carga de la pestaña, para no duplicar tráfico en el caso común de sólo navegar/editar. El formulario de edición no cambia de forma, sólo de contenedor (modal en vez de inline).
- `StaffCatalogPriceListsTab.tsx`: el formulario de "Programar precio" se mueve dentro de un `PrivateDialog` activado por un botón nuevo; "Nueva lista"/"Editar lista" pasan del bloque inline actual al mismo contenedor modal.
- Ningún componente nuevo — son cambios de contenedor (`<form>` inline → `<PrivateDialog><form>...`) y de estado (un paso más) dentro de los archivos ya existentes de la Task 4/5 del plan anterior.

## 4. Manejo de errores y estados

Mismo patrón (`notice`/`error`, `role="status"`/`role="alert"`) ahora dentro del modal en vez de en la página. Cerrar el modal a medias del paso 1 (antes de guardar) no persiste nada, igual que hoy. Cerrar el modal en el paso 2 sin guardar precio dejó el concepto ya creado — comportamiento esperado y explícito ("Omitir por ahora"), no un error.

## 5. Impacto en pruebas

`tests/catalog.spec.ts` (Task 8 de la implementación anterior) necesita ajustar los selectores del flujo de alta de concepto (ahora dentro de un `role="dialog"`, con un paso adicional a confirmar u omitir) y de "Nueva lista"/"Editar lista"/"Programar precio" (mismo cambio de contenedor). La cobertura funcional no cambia — se agrega una aserción nueva para el paso 2 del wizard (crear un concepto y asignarle un precio en el mismo flujo, sin cambiar de pestaña).

## 6. Criterios de terminado

- Los 5 formularios listados en §2.1 son modales, ninguno empuja el contenido de la página.
- Crear un concepto con categoría filtrada precarga esa categoría.
- Crear un concepto y asignarle un precio se puede hacer sin cambiar de pestaña, en un solo flujo.
- Editar concepto/lista sigue funcionando igual que hoy, sólo en modal.
- `tests/catalog.spec.ts` actualizado y en verde; regresión completa sin nuevas roturas relacionadas con este cambio.

## 7. Fuera de alcance

Todo lo ya listado en §10 de la spec anterior sigue igual de fuera de alcance (V2 de solicitudes, dividir `StaffQuotesPanel`, aprobaciones accionables, historial de versiones del portal, notificar `PROJECT.CREATED` + `/staff/projects`). No se agrega ningún flujo guiado equivalente a "Listas de precio" ni a "Por revisar" — el problema de fricción reportado era específicamente el de dar de alta un concepto con su primer precio.
