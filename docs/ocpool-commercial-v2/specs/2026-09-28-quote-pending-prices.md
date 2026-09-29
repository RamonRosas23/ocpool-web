# Conceptos «por cotizar» y «Precios por asignar»

Fecha: 2026-09-28 · Rama: `feat/quote-inline-pricing` (continúa [cotizar sin precio de lista](2026-09-28-quote-inline-pricing.md))

## Problema

La primera parte resuelve el caso de quien puede fijar precios (`quotes.edit_prices`). Quedaban dos huecos:

- **Ventas no puede fijar precios** (su rol no tiene `quotes.edit_prices` ni `prices.manage`): ante un concepto
  sin precio en la lista seguía en un callejón sin salida.
- **Quien puede, a veces no sabe el precio todavía** (lo espera de un proveedor). Sin una salida honesta, la
  tentación es poner un precio provisional y olvidarlo.

## Decisión

Un concepto sin precio se puede agregar **«por cotizar»**: entra a la propuesta sin precio, no suma al total y
la propuesta **no puede salir del borrador** mientras exista alguno. La línea pendiente *es* la solicitud: no
hay otra tabla. Quien administra los precios la ve en un lugar propio, le pone precio a la lista una vez, y
todas las propuestas que lo esperaban lo aplican solas al abrirse.

| Quién | Opciones al elegir un concepto sin precio |
| --- | --- |
| Puede fijar precios (`quotes.edit_prices`) | Solo en esta cotización · Dejarlo por cotizar |
| Además administra precios (`prices.manage`) | + Guardar también en la lista |
| Ventas (ninguno de los dos) | Dejarlo por cotizar (sin campos que capturar) |
| Una línea que ya está por cotizar | Las mismas, salvo «dejarlo por cotizar» |

## Qué cambia

- **Constructor:** la línea muestra «Por cotizar» (sin descuento ni total), un aviso con el conteo, «Por cotizar
  · N sin precio» en el resumen, «Faltan precios por definir» como siguiente paso y «Pasar a revisión»
  deshabilitado. Al abrir la propuesta se conserva la lista con la que se armó.
- **Se resuelve solo:** en cuanto la lista tiene el precio, el constructor lo aplica (con aviso); el servidor
  hace lo mismo en cualquier guardado (`pricePending` se ignora si la lista ya tiene precio), así que nunca
  queda una línea con el cero congelado.
- **Servidor:** `pricePending` en la línea del borrador. Se guarda en cero, sin descuento, fuera de los
  totales. `performQuoteVersionTransition` rechaza (409) pasar a `EN_REVISION` o `ENVIADA` con líneas por
  cotizar. La proyección del espacio de trabajo agrega el bloqueo `PRICE_PENDING` (sin acción principal).
- **Catálogo → Precios por asignar** (`prices.manage`, con insignia): agrupa por lista + concepto, muestra las
  propuestas que lo esperan (folio, cliente, cantidad, quién, cuándo) y permite asignar el precio ahí mismo
  (reutiliza `upsertPriceListItem`: vigencias, auditoría). API: `GET /api/staff/catalog/pending-prices`.
- **Tablero:** tarjeta «Precios por asignar» solo para quien puede asignarlos.
- **Datos:** migración `20260928020000_quote_line_price_pending`
  (`quote_line_snapshots.pricePending BOOLEAN NOT NULL DEFAULT false` + índice). `QuoteVersion.sourcePriceListId`
  (existía sin usarse) ahora se escribe al crear o guardar el borrador: restaura la lista al reabrir y liga cada
  pendiente con su lista.
- **Corrección relacionada:** el constructor tomaba por «vigente» cualquier fila de la lista de precios (también
  vencidas y programadas) al previsualizar y al comparar en «Verificar precios vigentes»; ahora solo cuenta la
  vigente hoy, como el servidor.

## Endurecimiento tras una segunda revisión

- **Carrera al definir el precio de una línea existente:** el servidor regenera los ids de las filas en cada
  guardado; si un autoguardado terminaba con el diálogo abierto, el precio se aplicaba a un id que ya no
  existía y no pasaba nada. Ahora la línea se identifica por su concepto. Mismo defecto (preexistente) en
  «Verificar precios vigentes»: el diálogo de confirmación puede llevar abierto varios autoguardados.
- **«Verificar precios vigentes»** comparaba contra cualquier fila de la lista (podía ofrecer «repreciar»
  al precio vencido); ahora usa `currentPriceRows` (`src/lib/price-list-current.ts`, con pruebas), igual que
  la vista previa.
- **Texto para Ventas:** decía que el precio se aplicaría «solo a esta propuesta»; el precio se asigna a la
  lista y la propuesta lo toma automáticamente.
- **Pestañas en celular:** la activa (p. ej. «Precios por asignar» al llegar desde el tablero) se desplaza a la
  vista (`PrivateTabs`, componente compartido).
- **Cobertura:** revisión de accesibilidad automatizada (axe, sin violaciones graves) del diálogo en sus
  variantes, la propuesta con una línea por cotizar, la pestaña del Catálogo y la tarjeta del tablero; flujo
  completo solo con teclado (flechas + Enter, foco al importe y de regreso al buscador).

## Verificación

- `tsc`, lint (incluido `src/server`), pruebas unitarias (etapa del constructor y proyección con el nuevo
  bloqueo) e integración (`quotes-service`: por cotizar sin permisos, sin precio ni descuento, bloqueo del paso a
  revisión, lista restaurada, «Precios por asignar» solo con `prices.manage`, resolución al asignar el precio).
- E2E opt-in `tests/quotes-pending-price.spec.ts`: Ventas deja el concepto por cotizar → aviso y tarjeta en el
  tablero de gerencia → asigna el precio en Catálogo → Ventas reabre y el precio ya está aplicado y puede pasar
  a revisión; y gerencia convierte una línea por cotizar en precio manual.
- Revisado en capturas de escritorio y celular.

## Fuera de alcance

Correo o notificación push a quien administra precios (el tablero y la pestaña cubren el aviso dentro de la
app), nota libre del vendedor para quien asigna, y asignación masiva.

## Nota de despliegue

Tras `prisma migrate deploy` y `prisma generate` hay que **reiniciar `npm run dev`**: el cliente de Prisma vive
en `globalThis` y un servidor ya abierto sigue con el anterior.
