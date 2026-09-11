# Fase 8 — Plan de implementación PDF comercial y aceptación digital

> Plan ordenado posterior al cierre de Fase 7. Cada tarea requiere pruebas, documentación y commit lógico; no se habilita aceptación en UI mientras el backend no tenga evidencia transaccional.

## Tarea 1 — Contratos, permisos y persistencia

- [x] Escribir pruebas rojas de elegibilidad, estados, inmutabilidad, consentimiento, expiración, idempotencia y concurrencia.
- [x] Agregar permisos mínimos para lectura/generación PDF y aceptación cliente.
- [x] Crear modelos `GeneratedDocument` y `QuoteAcceptance` con FK compuesto, unicidad, hash, tamaño, template version, soft delete/retención y constraints.
- [x] Crear migración, seed idempotente y auditoría de invariantes.
- [x] Verificar typecheck, unitarias y persistencia PostgreSQL dirigida.
- [x] Commit `feat: add quote document and acceptance contracts` (`c392a1b`).

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

- [x] Implementar lectura/generación/descarga PDF con scope por request+client y URL efímera.
- [x] Implementar servicio de aceptación con lock de versión/solicitud, validación de PDF, nombre, consentimiento e idempotencia.
- [x] Exponer APIs portal/staff con same-origin, no-store, Zod estricto y errores seguros.
- [x] Probar IDOR, historical version, expired quote, missing PDF, replay, concurrent acceptance, wrong client y rol sin capacidad.
- [x] Commit `feat: expose quote pdf and acceptance services`.

### Evidencia de Tarea 3

- `acceptance-service.ts` exige actor cliente con `quotes.accept`, bloquea cotización/solicitud, acepta exclusivamente la versión vigente `ENVIADA`/`EN_NEGOCIACION`, valida vigencia y consistencia HEAD/hash/MIME/tamaño del PDF, persiste aceptación y cambios de estado en una transacción, y publica auditoría/Outbox sin IP, user-agent ni claves de idempotencia crudas.
- `access-service.ts` exige `quotes.read` + `quotes.pdf.read` para staff y scope `clientId` para cliente; sólo emite URL presigned de 60 segundos para documentos `READY` físicamente disponibles, audita la emisión y nunca serializa `storageKey` ni `sha256`.
- `generateQuotePdf` ahora exige backend staff con `quotes.read` y `quotes.pdf.generate`; la API no permite que un cliente invoque generación.
- APIs agregadas: `GET /api/portal/quotes/[id]/pdf`, `POST /api/portal/quotes/[id]/accept`, `GET/POST /api/staff/quotes/versions/[versionId]/pdf`, con same-origin en mutaciones, body Zod estricto, `cache-control: no-store` y envelope de errores existente.
- `quote-acceptance-service.test.ts` pasó 1/1: evidencia hash/version/PDF, replay idempotente, transición de solicitud/cotización y carrera concurrente con un solo ganador.
- `quote-documents-api.test.ts` pasó 2/2: 401/403/404, IDOR cliente cruzado, CSRF, schema estricto, permisos staff, URL efímera, `no-store`, no filtrado de storage key/hash y replay/segunda clave.
- `npm run typecheck`, `npm run lint` y pruebas unitarias dirigidas del dominio/renderer pasaron.

## Tarea 4 — Portal cliente

- [x] Integrar descarga PDF y acción aceptar en la tarjeta de propuesta.
- [x] Añadir modal/panel de confirmación, nombre escrito, checkbox, estados elegible/vencida/aceptada/error y feedback accesible.
- [x] Añadir E2E portal: descargar, aceptar, reload, idempotencia visual, versión histórica sin acción y rechazo por vencimiento.
- [x] Commit `feat: add customer quote acceptance flow`.

### Evidencia de Tarea 4

- `ClientQuoteActions` integra descarga privada con URL efímera, estado de preparación/error, acción de aceptación sólo para versión vigente no vencida y estado explícito de aceptación.
- El diálogo controla foco inicial, `Escape`, navegación `Tab`, click fuera no destructivo, reduced motion heredado, feedback `role=status`/`role=alert` y confirmación explícita con nombre y checkbox.
- La UI no serializa hash, storage key ni datos internos; el refresh del expediente ocurre después de que el cliente ve el resultado de éxito y pulsa `Continuar`.
- `tests/client-portal.spec.ts` pasó 2/2 con PostgreSQL/MinIO reales: descarga, popup/API firmado, validación negativa del checkbox, aceptación, estado posterior, reload, mensajería, archivos, Axe, consola y responsive móvil.
- `npm run typecheck` y `npm run lint` pasaron después de la integración.

## Tarea 5 — Staff y operación

- [x] Mostrar estado/documento y evidencia de aceptación en inbox/constructor sin datos sensibles.
- [x] Añadir generación/reintento operativo sólo para documento inexistente o fallido; un documento READY permanece inmutable y sólo se descarga.
- [x] Verificar permisos, responsive, Axe, consola y payloads mínimos.
- [x] Commit `feat: add staff quote document operations`.

### Evidencia de Tarea 5

- `GET /api/staff/quotes/versions/[versionId]/document` devuelve estado seguro `MISSING`/`PENDING`/`READY`/`FAILED`/`DELETED`, metadata operativa mínima, aceptación asociada y acciones permitidas; nunca serializa `storageKey`, `sha256` ni códigos internos de fallo.
- `StaffQuoteDocumentPanel` queda integrado en el constructor staff con descarga privada, generación/reintento condicionado por capability y estado, evidencia visible de firmante/términos/fecha y estados accesibles de carga/error/vacío.
- La ruta de generación conserva idempotencia: `READY` se devuelve sin mutación, `PENDING` no se duplica, `FAILED` puede reintentarse y `DELETED` permanece retirado.
- `quote-documents-api.test.ts` pasó 2/2 con estados inicial/final, scope de cliente, `no-store`, permisos y ausencia de datos internos.
- `npx cross-env QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts` pasó 1/1 con login real, creación/envío, generación PDF en MinIO, descarga presigned, Axe, consola limpia, payload mínimo y no overflow en desktop/móvil.
- `npm run typecheck`, `npm run lint` y `git diff --check` pasaron después de la integración.

## Tarea 6 — Gate Fase 8

- [x] Ejecutar pruebas unitarias, integración, API, E2E portal/staff, PDF render/visual QA, audit, build y regresión global.
- [x] Verificar hash del PDF aceptado, trazabilidad, outbox/auditoría, no filtrado y cleanup exacto.
- [x] Actualizar riesgos legales, proveedor de firma, retención y producción.
- [x] Commit `docs: close phase eight quote pdf acceptance`.

### Evidencia de Tarea 6

- `npm run db:validate`, `npm run db:migrate:deploy` sin migraciones pendientes y `npm run db:seed` idempotente pasaron.
- `npm test` pasó completo: typecheck, 61/61 unitarias, 52/52 integraciones serializadas, contrato de contenido, build, E2E pública 34/34 con 7 omitidas explícitamente y foundation 1/1.
- Suites opt-in dedicadas pasaron: auth 1/1, portal cliente 2/2, mensajería staff 2/2 y constructor/PDF staff 1/1; se verificaron login real, PostgreSQL, MinIO, descarga presigned, aceptación, Axe, consola y responsive.
- `npm audit --omit=dev --audit-level=high` reportó 0 vulnerabilidades; `git diff --check` y árbol de trabajo limpios.
- La evidencia de aceptación conserva el hash del PDF en PostgreSQL, enlaza versión/documento/cliente, publica Outbox y auditoría transaccionales, y no filtra hash, storage key, fingerprints ni cuerpos sensibles a portal/staff.
- Riesgos que permanecen abiertos: revisión jurídica de términos y nivel de firma, proveedor de correo/antivirus productivo, retención/privacidad, backups/restauración, proxy confiable y destino de producción.
