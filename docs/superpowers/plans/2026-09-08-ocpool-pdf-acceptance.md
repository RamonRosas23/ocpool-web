# Fase 8 — Plan de implementación PDF comercial y aceptación digital

> Plan ordenado posterior al cierre de Fase 7. Cada tarea requiere pruebas, documentación y commit lógico; no se habilita aceptación en UI mientras el backend no tenga evidencia transaccional.

## Tarea 1 — Contratos, permisos y persistencia

- [ ] Escribir pruebas rojas de elegibilidad, estados, inmutabilidad, consentimiento, expiración, idempotencia y concurrencia.
- [ ] Agregar permisos mínimos para lectura/generación PDF y aceptación cliente.
- [ ] Crear modelos `GeneratedDocument` y `QuoteAcceptance` con FK compuesto, unicidad, hash, tamaño, template version, soft delete/retención y constraints.
- [ ] Crear migración, seed idempotente y auditoría de invariantes.
- [ ] Commit `feat: add quote document and acceptance contracts`.

## Tarea 2 — Renderer determinista y storage

- [ ] Implementar renderer `pdf-lib` basado exclusivamente en snapshot, con plantilla versionada, paginación, totales y fuentes controladas.
- [ ] Implementar hash/tamaño, generación idempotente y almacenamiento privado sin entregar bytes desde el cliente.
- [ ] Renderizar PDFs de fixture a PNG y revisar visualmente encabezados, tabla, totales, footer, saltos y legibilidad.
- [ ] Añadir extracción de texto, metadata y pruebas de regeneración idéntica.
- [ ] Commit `feat: add immutable quote pdf renderer`.

## Tarea 3 — Servicios y APIs protegidas

- [ ] Implementar lectura/generación/descarga PDF con scope por request+client y URL efímera.
- [ ] Implementar servicio de aceptación con lock de versión/solicitud, validación de PDF, nombre, consentimiento e idempotencia.
- [ ] Exponer APIs portal/staff con same-origin, no-store, Zod estricto y errores seguros.
- [ ] Probar IDOR, historical version, expired quote, missing PDF, replay, concurrent acceptance, wrong client y rol sin capacidad.
- [ ] Commit `feat: expose quote pdf and acceptance services`.

## Tarea 4 — Portal cliente

- [ ] Integrar descarga PDF y acción aceptar en la tarjeta de propuesta.
- [ ] Añadir modal/panel de confirmación, nombre escrito, checkbox, estados elegible/vencida/aceptada/error y feedback accesible.
- [ ] Añadir E2E portal: descargar, aceptar, reload, idempotencia visual, versión histórica sin acción y rechazo por vencimiento.
- [ ] Commit `feat: add customer quote acceptance flow`.

## Tarea 5 — Staff y operación

- [ ] Mostrar estado/documento y evidencia de aceptación en inbox/constructor sin datos sensibles.
- [ ] Añadir regeneración administrativa sólo si el hash/template/bytes faltan; nunca modificar un documento READY.
- [ ] Verificar permisos, responsive, Axe, consola y payloads mínimos.
- [ ] Commit `feat: add staff quote document operations`.

## Tarea 6 — Gate Fase 8

- [ ] Ejecutar pruebas unitarias, integración, API, E2E portal/staff, PDF render/visual QA, audit, build y regresión global.
- [ ] Verificar hash del PDF aceptado, trazabilidad, outbox/auditoría, no filtrado y cleanup exacto.
- [ ] Actualizar riesgos legales, proveedor de firma, retención y producción.
- [ ] Commit `docs: close phase eight quote pdf acceptance`.
