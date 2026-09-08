# Fase 8 — Plan de implementación PDF comercial y aceptación digital

> Plan ordenado posterior al cierre de Fase 7. Cada tarea requiere pruebas, documentación y commit lógico; no se habilita aceptación en UI mientras el backend no tenga evidencia transaccional.

## Tarea 1 — Contratos, permisos y persistencia

- [x] Escribir pruebas rojas de elegibilidad, estados, inmutabilidad, consentimiento, expiración, idempotencia y concurrencia.
- [x] Agregar permisos mínimos para lectura/generación PDF y aceptación cliente.
- [x] Crear modelos `GeneratedDocument` y `QuoteAcceptance` con FK compuesto, unicidad, hash, tamaño, template version, soft delete/retención y constraints.
- [x] Crear migración, seed idempotente y auditoría de invariantes.
- [x] Verificar typecheck, unitarias y persistencia PostgreSQL dirigida.
- [ ] Commit `feat: add quote document and acceptance contracts`.

### Evidencia de Tarea 1

- Contrato de dominio en `src/server/modules/quote-documents/domain.ts` con ciclo de vida monotónico, elegibilidad de versión y normalización acotada de consentimiento.
- Prueba roja inicial por módulo faltante; después 3/3 unitarias del dominio y 57/57 unitarias globales.
- Prisma validado y cliente regenerado; migración `20260908090000_quote_documents_acceptance` aplicada con enums, FK compuesto, unicidad, hashes, tamaño, MIME PDF, READY completo y evidencia no vacía.
- Catálogo RBAC ampliado con `quotes.pdf.read`, `quotes.pdf.generate` y `quotes.accept`; customer sólo recibe lectura/aceptación y sales/manager sólo lectura/generación.
- `tests/integration/quote-documents-schema.test.ts` pasó 1/1: READY incompleto rechazado, documento duplicado rechazado, hash inválido rechazado y aceptación vinculada al documento/versiones correctos.
- `npm run typecheck` pasó.

## Tarea 2 — Renderer determinista y storage

- [x] Implementar renderer `pdf-lib` basado exclusivamente en snapshot, con plantilla versionada, paginación, totales y fuentes PDF estándar portables.
- [x] Implementar hash/tamaño, generación idempotente y almacenamiento privado sin entregar bytes desde el cliente.
- [x] Renderizar PDFs de fixture a PNG y revisar visualmente encabezados, tabla, totales, footer, saltos y legibilidad.
- [x] Añadir extracción de texto, metadata y pruebas de regeneración idéntica.
- [x] Verificar servicio contra almacenamiento en memoria, hash persistido, Outbox y auditoría.
- [x] Commit `feat: add immutable quote pdf renderer`.

### Evidencia de Tarea 2

- `pdf-lib@1.17.1` se agregó como dependencia directa para generar PDF server-side sin servicio externo ni bytes controlados por el navegador.
- `renderQuotePdf` genera plantilla `quote-pdf-v1`, A4, encabezado, metadata comercial, tabla paginada, resumen, condiciones y footer estable.
- El renderer usa exclusivamente valores de `QuotePdfSnapshot`; no recibe catálogo, notas internas, IDs de cliente ni payload de UI.
- `tests/unit/quote-pdf-renderer.test.ts` pasó 3/3: determinismo byte a byte, hash SHA-256, metadata, paginación y payload interno ausente.
- `generateQuotePdf` valida el estado de la versión, crea/reintenta `PENDING`, escribe en `PrivateStorage`, verifica HEAD, persiste hash/tamaño y deja `READY` sólo tras verificación completa.
- `tests/integration/quote-pdf-service.test.ts` pasó 1/1: snapshot real, almacenamiento privado en memoria, replay idempotente, auditoría y Outbox único.
- Fixture QA: `output/pdf/quote-pdf-fixture.pdf`, 2 páginas; revisión PNG de ambas páginas sin overflow, colisiones ni saltos de página defectuosos. `pdfinfo` y `pypdf` confirmaron metadata, folio, resumen, total y ausencia de texto interno.

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
