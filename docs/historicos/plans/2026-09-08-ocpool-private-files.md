# Fase 7 — Archivos privados por expediente — Plan de implementación

> Plan ordenado para ejecución incremental. Cada tarea requiere pruebas, `git diff --check`, actualización de `PROJECT_STATUS.md` y commit lógico antes de avanzar.

**Goal:** incorporar archivos privados por expediente con storage S3-compatible local, metadata relacional, validación fuerte y acceso autorizado.

**Architecture:** monolito modular Next.js App Router; PostgreSQL como fuente de verdad; MinIO privado para desarrollo local; puerto `PrivateStorage` para desacoplar S3/MinIO de dominio; uploads reservados y finalizados por backend; URLs efímeras o descarga proxy; auditoría sin contenido sensible.

**Dependencies:** Fases 1–6 terminadas; no se agregan archivos a mensajería hasta cerrar este contrato.

## Tarea 1 — Contrato de dominio, permisos y persistencia

**Objetivo antes de iniciar:** fijar categorías, estados, límites, visibilidad, permisos y relaciones sin exponer bytes.

**Riesgos:** FK que permita cruzar clientes, estados que entreguen objetos incompletos, duplicados de reserva, metadata sensible o migración difícil de limpiar.

- [x] Escribir pruebas rojas para categorías, nombres, tamaño, MIME declarado, estados y visibilidad.
- [x] Agregar permisos de archivos a RBAC y asignarlos de forma mínima a customer/sales/manager/admin.
- [x] Crear enums/modelos `StorageObject` y `FileAttachment` con FK compuesto request+client, unicidad, índices y soft delete.
- [x] Definir constraints de tamaño, hash, key, nombre y estados; documentar límite 25 MiB y cuota por expediente.
- [x] Crear migración, generar Prisma, seed idempotente y validar cleanup exacto.
- [x] Ejecutar unitarias dirigidas, schema dirigido, typecheck, lint y diff check.
- [x] Commit `feat: add private file persistence contracts`.

Evidencia de cierre:

- `tests/unit/private-files-domain.test.ts` pasó 6/6; cubre categorías, visibilidad, estados, nombre seguro, tipos permitidos, límite 25 MiB, documento interno y key opaca.
- RBAC pasó de 27 a 33 capacidades; customer sólo recibe lectura/carga/descarga/borrado propio, sales agrega lectura interna y manager agrega administración; admin conserva el catálogo completo.
- Migración `20260908083258_private_files` aplicada; Prisma validado/generado; `StorageObject` y `FileAttachment` usan FK compuesto request+client, soft delete, índices y constraints SQL de tamaño, hash, key y visibilidad.
- `tests/integration/private-files-schema.test.ts` pasó 1/1 con scope cruzado, invariantes de DB y cleanup exacto; `npm run typecheck`, `npm run lint`, `git diff --check` correctos.
- `npm run db:seed` permanece idempotente; no se agregó storage externo ni dependencia durante Tarea 1.

## Tarea 2 — Storage privado y servicio transaccional

**Objetivo antes de iniciar:** reservar, cargar, verificar y finalizar un archivo sin convertir el storage en autoridad.

**Riesgos:** path traversal, presigned URLs permanentes, carrera reserve/complete, objeto huérfano, hash incorrecto o entrega antes del scan.

- [x] Agregar MinIO privado a Compose y variables de entorno no secretas en `.env.example`; documentar bucket/bootstrap.
- [x] Agregar sólo dependencias justificadas para cliente S3/presign y detección de tipo real; fijar razones en README/runbook.
- [x] Implementar `PrivateStorage` con `reserve`, `put/complete`, `head`, `presignDownload` y `delete` sin aceptar claves del cliente.
- [x] Implementar scanner adapter de firma/tipo y estados `PENDING_SCAN`, `AVAILABLE`, `REJECTED`, dejando explícito el límite antivirus local.
- [x] Implementar servicio de reserva, finalización idempotente, cuota, cleanup, soft delete, descarga y auditoría.
- [x] Probar transacciones, concurrencia, cleanup y payload/log audit.
- [x] Commit `feat: add private file storage service`.

Evidencia de cierre:

- MinIO `RELEASE.2025-04-22T22-12-26Z` quedó versionado en Compose, saludable en `localhost:19000` y con bucket privado creado bajo demanda; Console local en `localhost:19001`.
- Dependencias justificadas y fijadas por lockfile: `@aws-sdk/client-s3@3.1127.0` y `@aws-sdk/s3-request-presigner@3.1127.0`; el scanner usa firmas mágicas propias para PDF/JPEG/PNG/WebP sin sumar otra dependencia.
- `PrivateStorage` encapsula S3, path-style local, presigned PUT/GET de 15/60 segundos, HEAD, lectura acotada y delete; el dominio sólo trabaja con keys generadas por servidor.
- `private-files-scanner.test.ts` pasó 3/3; `private-files-service.test.ts` pasó 3/3 con replay, reserva concurrente, rechazo por firma, aislamiento interno, descarga, soft delete y expiración; storage real pasó 1/1.
- La reserva idempotente quedó persistida por actor con `reservationKeyHash` y `reservationExpiresAt` en migración `20260908083900_private_file_reservations`; `sha256` se vuelve nullable en reserva mediante `20260908084000_private_file_hash_nullable` y sólo se llena tras validación.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` 54/54, `docker compose config --quiet`, `npm audit --audit-level=moderate` y `npm audit --omit=dev --audit-level=high` correctos.

## Tarea 3 — APIs privadas y seguridad negativa

**Objetivo antes de iniciar:** publicar contratos HTTP mínimos para cliente/staff.

**Riesgos:** IDOR, filtrado de internos, enumeración por status, cache de URLs, same-origin incompleto y errores de tipo.

- [x] Crear schemas Zod estrictos para reserva, finalización, categoría, cursor y UUIDs.
- [x] Crear APIs portal/staff con actor de sesión, scope de cliente, capabilities, no-store y same-origin en mutaciones.
- [x] Uniformar 401/403/404/409/413/415/422 sin filtrar existencia indebida, paths ni scanner internals.
- [x] Probar cliente propio/ajeno, staff limitado, sesión revocada, reservas repetidas, URL expirada, path traversal y visibilidad interna.
- [x] Documentar request/response sin storage keys, hashes de idempotencia ni presigned URLs reutilizables.
- [x] Commit `feat: expose protected private file APIs`.

Evidencia de cierre:

- Schemas Zod estrictos para reserva, finalización y lista; la API no acepta `clientId`, `uploadedById`, `storageKey`, estado, hash ni resultado de scanner desde el request.
- Portal y staff comparten servicio autorizado, pero mantienen guards de sesión y rutas separadas; las mutaciones exigen same-origin y todas las respuestas privadas usan `cache-control: no-store`.
- `private-files-api.test.ts` pasó 4/4: capabilities sin permisos crudos, 401/403/404, cliente cruzado, same-origin, campos desconocidos, carga presigned, finalización, descarga, borrado, visibilidad interna, rol limitado y rate limit persistido.
- Las proyecciones no incluyen `clientId`, `storageKey` ni hash de idempotencia; la URL de upload sólo se entrega como transporte presigned de vida corta y nunca se persiste en DB, logs, auditoría o Outbox.
- El listado verifica existencia y scope del expediente antes de responder para evitar enumeración silenciosa de clientes ajenos; la descarga exige `AVAILABLE` + `PASSED` en backend.
- `npm run typecheck`, lint dirigido y la suite API PostgreSQL 4/4 correctos; cleanup eliminó metadata, objetos físicos, sesiones, roles y buckets de rate limit de fixtures.

## Tarea 4 — UI portal cliente

**Objetivo antes de iniciar:** permitir cargar y descargar archivos propios desde el detalle del expediente.

**Riesgos:** input de archivo como única validación, progreso engañoso, feedback pobre, filtrado sólo frontend y leaks en errores.

- [x] Escribir E2E roja de carga/descarga/rechazo/cliente cruzado.
- [x] Añadir sección de archivos con categoría de documento cliente, límite 25 MiB, progreso, reintento, eliminación confirmada y estados vacíos/error/pending/rejected.
- [x] Integrar descarga efímera mediante endpoint autorizado y nombre seguro; el navegador recibe una URL de 60 segundos sin persistirla en el componente.
- [x] Verificar teclado, foco, hit area, Axe, reduced motion y no overflow en el viewport móvil cubierto por el portal.
- [x] Commit lógico de la UI portal cliente.

Evidencia de cierre:

- `ClientFilesPanel` quedó integrado en el detalle de `/portal` con input accesible, estados `Preparando carga…`, `Subiendo archivo…`, `Validando archivo…`, reintento, estado vacío y confirmación de borrado lógico.
- El navegador sólo reserva/finaliza por API; el upload presigned se usa como transporte temporal y la descarga vuelve a pedir autorización al backend. No se muestran `storageKey`, hashes, IDs de cliente ni información del scanner.
- `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` pasó 2/2; cubre carga real PDF a MinIO, disponibilidad después de validación, persistencia tras reload, acción de descarga, logout, payload mínimo, Axe, consola limpia y no overflow.
- `npm run typecheck`, `npm run lint` y `git diff --check` correctos; se corrigió un contraste WCAG AA del distintivo de formato detectado por Axe durante la iteración.
- El alcance deliberadamente no incluye preview embebido, cancelación de bytes a mitad de un PUT ni antivirus productivo; esas garantías requieren contrato de operación y proveedor, y quedan registradas como riesgo de Fase 7.

## Tarea 5 — UI staff y operación

**Objetivo antes de iniciar:** dar al equipo una vista rápida y segura del archivo dentro del expediente.

**Riesgos:** visibilidad interna mezclada, acciones sin permisos, descarga lenta, nombres maliciosos y densidad excesiva.

- [x] Añadir zona de archivos staff con compartidos/internos, filtros mínimos y metadata operativa segura.
- [x] Ocultar borrar/administrar sin capacidad, conservando autorización backend.
- [x] Mostrar estados de análisis y errores accionables sin revelar scanner internals.
- [x] Verificar Axe, responsive, consola, no overflow, payloads mínimos y estado de sesión.
- [x] Commit `feat: add staff private files workspace`.

Evidencia de cierre:

- La UI staff vive en `StaffFilesPanel` dentro del detalle del inbox; manager ve `CUSTOMER`/`INTERNAL` en tabs separados y el rol limitado sólo recibe la proyección compartida.
- El manager completó carga, validación, descarga disponible y borrado confirmado desde navegador; ningún control se considera autorización y el backend conserva el scope/capability.
- `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` pasó 2/2 con Axe, consola limpia y no overflow; typecheck, lint y diff check correctos.

## Tarea 6 — Gate de seguridad, cleanup y cierre

**Objetivo antes de iniciar:** demostrar que ningún archivo privado cruza cliente, estado o proveedor.

- [x] Crear fixtures de dos clientes, staff manager y rol limitado con objetos disponibles, pendientes y rechazados.
- [x] Ejecutar matriz IDOR, roles, sesión revocada, replay, same-origin, cuotas, tipos disfrazados, path traversal, URL expirada y cleanup.
- [x] Auditar DB, storage, HTML, payloads, logs y Outbox para confirmar ausencia de secretos, bytes o keys.
- [x] Ejecutar E2E portal/staff, Axe, responsive, consola limpia y cleanup exacto.
- [x] Ejecutar gate DB, unit, integration, content, typecheck, lint, build, E2E, audit y diff check.
- [x] Actualizar riesgos/deuda/decisiones y hacer commit `docs: close phase seven private files`.

Evidencia de cierre:

- Los fixtures de API cubren dos clientes, manager y rol limitado, con archivos compartidos/internos, reserva pendiente, rechazo por firma, replay, rate limit y expiración; cada suite elimina metadata y objetos físicos de MinIO por key conocida.
- `private-files-api.test.ts` pasó 4/4 y la integración completa 47/47; se verifican IDOR, visibilidad, RBAC, same-origin, schemas estrictos, `no-store`, URLs efímeras, entrega sólo `AVAILABLE` + `PASSED`, auditoría/Outbox sin bytes/keys y cleanup.
- `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` pasó 2/2 y `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` pasó 2/2; ambas validan Axe, consola limpia, responsive/no overflow y aislamiento de payloads. Constructor de cotizaciones y autenticación opt-in se conservaron verdes en sus ejecuciones previas 1/1.
- Gate reproducible: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npx prisma migrate status`, `npm test`, `npm audit --audit-level=moderate`, `npm audit --omit=dev --audit-level=high` y `git diff --check` correctos; Compose reporta PostgreSQL, Mailpit y MinIO saludables.
- Fase 7 queda cerrada para el alcance local. El scanner `basic-signature-v1` es una validación de tipo/firma/hash, no antivirus productivo; proveedor de antivirus, cuarentena, backups/restauración de objetos y política de retención permanecen como riesgos explícitos de hardening.

## Gate de Fase 7

No se iniciará PDF comercial ni aceptación digital hasta demostrar autorización backend por expediente, no entrega antes de `AVAILABLE`, URLs efímeras, limpieza de objetos huérfanos, auditoría segura y evidencia de scanner local/operacional claramente delimitada.
