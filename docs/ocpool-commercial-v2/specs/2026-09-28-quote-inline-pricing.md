# Cotizar un concepto sin precio en la lista, sin salir del constructor

Fecha: 2026-09-28 · Rama: `feat/quote-inline-pricing`

## Problema

En el constructor de cotizaciones, un concepto que no tenía precio en la lista elegida aparecía
bloqueado ("Sin precio", "asígnale precio en Catálogo"). Quien cotiza tenía que abandonar la
propuesta, ir al Catálogo, asignar el precio y volver.

## Decisión

La lista de precios es un dato compartido de toda la empresa (con vigencias); una cotización no debe
cambiarla en silencio. Por eso el precio se define en el mismo lugar, pero con una elección explícita:

- **Solo en esta cotización (precio manual):** la línea se agrega con el precio escrito y un motivo
  obligatorio; la lista no cambia. Requiere `quotes.edit_prices` (lo mismo que ya se pide hoy para
  ajustar un precio). Sin aprobación (la de ajustes de precio sigue deshabilitada); queda motivo y
  auditoría de la versión.
- **Guardar también en la lista:** sólo con `prices.manage`. Reutiliza `upsertPriceListItem` (su
  validación de vigencias y auditoría) y agrega la línea con el precio de lista, sin marca manual.
- Quien no tiene `quotes.edit_prices` sigue viendo el concepto bloqueado como antes.

## Qué cambia

- **Buscador:** los conceptos sin precio dejan de estar deshabilitados si la persona puede definirlo;
  muestran "Definir precio" y abren un diálogo (precio, dónde se guarda, motivo).
- **Línea:** etiqueta "Precio manual · motivo" y un aviso "N conceptos con precio manual — fuera de
  la lista; aplica sólo a esta cotización".
- **Servidor:** `CatalogPricingLineInput.manualPriceReason`. Un concepto sin precio vigente en la lista
  se acepta sólo con `unitPriceMinorOverride` + `manualPriceReason` (si no, 409 como antes) y
  `quotes.edit_prices` (salvo que sea el mismo precio ya congelado, regla del autoguardado). Se guarda
  en columnas existentes (**sin migración**): `overrideReason` = motivo y `baseUnitPriceMinor` = null.
  Al crear una versión nueva desde la publicada, el precio manual y su motivo se conservan. Las listas
  ofrecidas para cambiar ya no se restringen por las líneas de precio manual.
- El motivo es interno: no se muestra en el PDF ni en el portal.
- **Auditoría:** fijar o cambiar un precio manual registra `quote.price.manual` (folio, versión, concepto,
  importe y motivo) en la bitácora; reenviar el mismo borrador (autoguardado) no duplica el registro.
- **Quien aprueba lo ve:** en la cola de Aprobaciones la línea con precio manual se resalta con su motivo,
  sea cual sea el tipo de aprobación.
- **Corrección relacionada (preexistente):** "Ver conceptos de la versión" en Aprobaciones siempre decía
  "La versión no tiene conceptos" desde que el expediente devuelve un resumen de versiones sin líneas
  (D2-05); ahora lee la versión completa (vigente, de trabajo o publicada).
- **Detalles de uso:** el foco pasa al importe al abrir el diálogo y regresa al buscador al cerrarlo sin
  reabrir el desplegable; la opción "Guardar también en la lista" espera a que la lista esté cargada; las
  opciones sin precio anuncian "Definir precio" a los lectores de pantalla; el aviso del Catálogo
  ("Sin precio en una lista…") ya no dice que el concepto no se puede cotizar.

## Verificación

- `tsc`, lint (incluido `src/server`), 375 pruebas unitarias y la integración completa 151/151 (nueva en
  `quotes-service`: precio manual, permisos, motivo obligatorio, autoguardado sin duplicar auditoría,
  cambio de precio auditado y clonado de versión; el espacio de trabajo expone la marca y no restringe
  las listas por líneas manuales).
- E2E opt-in `tests/quotes-manual-price.spec.ts` (gerente: manual y "guardar en la lista", foco,
  persistencia y recarga; ventas: sigue bloqueado) y `tests/quotes-approvals-lines.spec.ts` (la cola de
  aprobaciones lista los conceptos y resalta el precio manual).
- Revisado en capturas de escritorio y celular (búsqueda, diálogo, línea con etiqueta, aprobaciones).

## Fuera de alcance (fase 2)

"Precio por definir": agregar la línea sin precio y bloquear el envío hasta resolverla; "Pedir a
catálogo que lo asigne" con aviso a quien administra precios.
