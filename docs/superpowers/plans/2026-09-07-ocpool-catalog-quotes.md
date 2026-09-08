# OCPOOL — Plan Fase 4: Catálogo, precios y cotizaciones versionadas

> Estado: Tareas 1 y 2 ejecutadas y verificadas. Tarea 3 lista para ejecución. No se implementará una pantalla de cotización antes de cerrar contratos monetarios, snapshots e invariantes.

## Objetivo

Construir la fuente de verdad comercial para conceptos, servicios, equipamiento y precios, y usarla para generar cotizaciones versionadas cuyos importes históricos sean inmutables y reproducibles aunque el catálogo cambie después.

## Alcance

Incluye:

- categorías y catálogo comercial administrable;
- unidades, conceptos, descripciones y estado activo/archivado;
- listas de precios por moneda y vigencia;
- reglas explícitas de precisión, redondeo, impuestos y descuentos;
- plantillas reutilizables de cotización sin convertirlas en la fuente histórica;
- cotización raíz vinculada a una solicitud;
- versiones inmutables al enviarse o aceptarse;
- snapshots de nombre, descripción, unidad, precio, impuestos y descuentos por concepto;
- cálculo de subtotales, impuestos, descuentos y total con enteros en unidad mínima;
- permisos separados para consultar catálogo, editar precios, aplicar descuentos y aprobarlos;
- API interna y constructor operativo, con estados de carga, error, vacío y confirmación;
- pruebas de precisión, límites, concurrencia, autorización, snapshots y E2E.

Fuera de esta fase:

- aceptación digital y firma;
- PDF definitivo y envío por correo productivo;
- portal autenticado completo del cliente;
- pagos, facturación fiscal y contabilidad;
- multiempresa/sucursales hasta confirmar alcance comercial;
- descuentos o impuestos cuya regla legal no esté confirmada.

## Dependencias

- Fase 1: PostgreSQL, Prisma, errores, logging, Outbox y toolchain.
- Fase 2: sesiones, RBAC y permisos backend.
- Fase 3: solicitud, cliente/contacto, folio y expediente raíz.
- Decisión comercial pendiente: moneda primaria, IVA, descuentos, redondeo y reglas de vigencia.

## Principios de datos

- Nunca usar `number` de JavaScript para dinero persistido o cálculos críticos.
- Persistir importes en unidades mínimas como `BigInt` o estructura equivalente, con moneda explícita.
- No recalcular una versión histórica desde el catálogo vigente.
- Un concepto de versión guarda snapshot de identidad comercial y valores monetarios usados.
- Una versión enviada o aceptada no se edita; cualquier cambio genera nueva versión.
- Las fechas de vigencia de listas de precios no deben producir dos precios activos ambiguos para la misma combinación.
- Los cambios de catálogo son auditables y no eliminan físicamente conceptos referenciados.
- Totales y redondeos se calculan en el servidor dentro de una transacción.

## Modelo propuesto

- `CatalogCategory`: categoría jerárquica opcional, nombre, clave, orden y estado.
- `CatalogItem`: concepto comercial, unidad, descripción, categoría, estado y metadatos de operación limitados.
- `PriceList`: lista identificable, moneda, vigencia, estado y precisión acordada.
- `PriceListItem`: precio del concepto por lista, unidad mínima, fechas y auditoría.
- `Quote`: cotización raíz vinculada a `QuoteRequest`, cliente y versión actual.
- `QuoteVersion`: número, estado, moneda, vigencia, snapshot de condiciones y totales calculados.
- `QuoteLineSnapshot`: concepto histórico, cantidad, unidad, precio unitario, descuento, impuesto, subtotal y total.
- `QuoteStatusHistory`: cambios de estado de la cotización.

Las relaciones exactas, constraints e índices se validarán en Tarea 2 antes de migrar.

## Estados iniciales

```text
BORRADOR → EN_REVISION → ENVIADA → EN_NEGOCIACION → ACEPTADA
                         ↘ RECHAZADA | VENCIDA
```

Reglas:

- sólo `BORRADOR` puede editar líneas y condiciones;
- cualquier estado distinto de `BORRADOR` es inmutable para edición de líneas y condiciones;
- una solicitud de cambio genera una nueva versión de la misma cotización;
- `ACEPTADA` sólo será posible cuando exista el módulo de aceptación y evidencia requerido.

## Permisos previstos

- `catalog.read`
- `catalog.manage`
- `prices.read`
- `prices.manage`
- `quotes.read`
- `quotes.create`
- `quotes.edit_prices`
- `quotes.apply_discount`
- `quotes.approve_discount`
- `quotes.send`

Los permisos existentes de cotizaciones se conservarán y se separará explícitamente catálogo/precios cuando el servicio lo requiera.

## Tareas ordenadas

## Seguimiento de ejecución

- [x] Tarea 1 — contratos monetarios, estados, snapshots y permisos adicionales.
- [x] Tarea 2 — schema relacional de catálogo, listas y cotizaciones.
- [ ] Tarea 3 — servicio de precios y creación de versión reproducible.
- [ ] Tarea 4 — API y UI de catálogo/listas de precios.
- [ ] Tarea 5 — constructor de cotizaciones y operaciones protegidas.
- [ ] Tarea 6 — gate de fase.

### Tarea 1 — Contratos e invariantes

- Definir tipos de dinero, moneda, precisión, redondeo y límites.
- Definir estados y transiciones sin habilitar aceptación prematuramente.
- Definir snapshots y reglas de inmutabilidad.
- Escribir pruebas rojas para sumas, porcentajes, impuestos, descuentos, cero, límites y negativos.

Evidencia de cierre:

- Commit `4240d15` (`feat: establish quote money and snapshot contracts`).
- `src/server/modules/quotes/domain.ts` usa `BigInt` para unidad mínima, cantidades fijas en milésimas y porcentajes en basis points.
- El redondeo es half-up explícito; se rechazan negativos, overflow, monedas inválidas, cantidades con más de tres decimales y monedas mezcladas.
- `buildQuoteVersionSnapshot` conserva identidad, precio, descuento, impuesto, subtotales y totales, y congela el snapshot en memoria.
- `canTransitionQuoteVersion` bloquea `ACEPTADA` sin evidencia explícita; sólo `BORRADOR` es editable.
- Se incorporaron `catalog.read`, `catalog.manage`, `prices.read` y `prices.manage` con asignación least-privilege a ventas/gerencia.
- Verificación: `npm run test:unit` 41/41, `npm run test:integration` 20/20, `npm run typecheck` y `npm run lint` correctos.

Decisiones mantenidas abiertas para validación comercial: monedas soportadas, IVA y demás impuestos, descuentos acumulados y reglas legales de aceptación.

### Tarea 2 — Schema relacional

- Crear categorías, items, listas y precios con constraints e índices.
- Crear cotización, versiones, líneas snapshot e historial.
- Crear migración inspeccionada y seed sólo con catálogo demo no sensible.
- Verificar que borrar/archivar catálogo no rompa solicitudes ni versiones.

Evidencia de cierre:

- Commits `cea2064` (`feat: add catalog and quote relational schema`) y `78bd3fb` (`test: verify catalog seed and schema integrity`).
- Migración `prisma/migrations/20260908032000_catalog_quotes/migration.sql` aplicada y confirmada sin pendientes.
- El modelo incluye categorías, conceptos archivables, listas por moneda, precios con vigencia, cotización raíz vinculada por FK compuesto a solicitud+cliente, versiones, líneas snapshot e historial.
- PostgreSQL impide precios negativos, importes imposibles, basis points fuera de rango, cantidades no positivas y totales inconsistentes.
- `btree_gist` + `EXCLUDE USING gist` impide dos vigencias solapadas para el mismo concepto en una lista.
- `ON DELETE RESTRICT` protege conceptos referenciados; el histórico no depende de recalcular desde el catálogo.
- `seedCatalogDemo` es idempotente y crea únicamente datos demo local no sensibles.
- Verificación: schema dirigido 3/3, `npm run test:integration` 23/23, `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npx prisma migrate status`, `npm run db:seed`, `npm run typecheck` y `npm run lint` correctos.

### Tarea 3 — Servicio transaccional

- Resolver lista/precio vigente dentro de transacción.
- Crear versión con snapshots completos y totales calculados en servidor.
- Rechazar cambios en versiones no editables.
- Auditar creación, edición, envío y aprobación.
- Probar concurrencia, replay, conflicto de versiones e invariancia histórica.

### Tarea 4 — API y UI de catálogo

- Listado paginado, búsqueda, filtros, alta/edición/archivo autorizados.
- Gestión de listas y precios con confirmación, validación y feedback.
- No exponer operaciones administrativas a clientes.

### Tarea 5 — Constructor de cotizaciones

- Selección de solicitud y cliente autorizado.
- Líneas, cantidades, precios, descuentos e impuestos con resumen vivo.
- Permisos separados para modificar precio y aprobar descuento.
- Versionado explícito, historial visible y estados de error/carga/vacío.
- E2E empleado: solicitud → borrador → revisión → envío/versionado.

### Tarea 6 — Gate de fase

- Migración/seed desde entorno local limpio.
- Unitarias monetarias, integración PostgreSQL, API negativa y pruebas de snapshot.
- E2E de constructor y regresión pública/interna.
- Lint, typecheck, build, auditoría de dependencias, `git diff --check` y documentación.

## Criterios de terminado

La fase sólo se marca terminada cuando:

- los cálculos no dependen de floats ni de redondeos implícitos;
- una versión histórica conserva valores aunque el catálogo o precio cambie;
- los cambios a versiones enviadas/aceptadas generan nueva versión o son rechazados;
- descuentos y cambios de precio requieren permisos adecuados;
- una cotización no puede cruzar clientes o solicitudes sin autorización;
- los totales se validan de nuevo en backend;
- los estados inválidos, importes negativos, overflow, moneda incorrecta y duplicados tienen pruebas negativas;
- el constructor es usable en escritorio y móvil, con accesibilidad y estados completos;
- auditoría y Outbox no almacenan secretos ni datos innecesarios;
- el gate final pasa y la documentación registra decisiones abiertas.

## Riesgos y decisiones abiertas

- Confirmar IVA, impuestos adicionales, descuentos acumulados y redondeo comercial.
- Confirmar monedas soportadas y si una cotización puede mezclar moneda.
- Confirmar si el catálogo necesita proveedores, costos internos o sólo precio de venta.
- Confirmar si las plantillas se pueden editar después de usarse o deben versionarse.
- Confirmar reglas jurídicas para vigencia y aceptación de cotizaciones.
- No habilitar aceptación digital ni PDF final hasta cerrar evidencia legal y snapshots.
