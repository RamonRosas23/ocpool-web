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

- [ ] Crear schemas Zod estrictos para reserva, finalización, categoría, cursor y UUIDs.
- [ ] Crear APIs portal/staff con actor de sesión, scope de cliente, capabilities, no-store y same-origin en mutaciones.
- [ ] Uniformar 401/403/404/409/413/415/422 sin filtrar existencia indebida, paths ni scanner internals.
- [ ] Probar cliente propio/ajeno, staff limitado, sesión revocada, reservas repetidas, URL expirada, path traversal y visibilidad interna.
- [ ] Documentar request/response sin storage keys, hashes de idempotencia ni presigned URLs reutilizables.
- [ ] Commit `feat: expose protected private file APIs`.

## Tarea 4 — UI portal cliente

**Objetivo antes de iniciar:** permitir cargar y descargar archivos propios desde el detalle del expediente.

**Riesgos:** input de archivo como única validación, progreso engañoso, feedback pobre, filtrado sólo frontend y leaks en errores.

- [ ] Escribir E2E roja de carga/descarga/rechazo/cliente cruzado.
- [ ] Añadir sección de archivos con categorías, límites, progreso, cancelación, reintento y estados vacíos/error/pending/rejected.
- [ ] Integrar descarga efímera o proxy con nombre seguro y `Content-Disposition` de attachment.
- [ ] Verificar teclado, foco, hit area, Axe, reduced motion y no overflow 360/390/768/1440.
- [ ] Commit `feat: add customer private files workspace`.

## Tarea 5 — UI staff y operación

**Objetivo antes de iniciar:** dar al equipo una vista rápida y segura del archivo dentro del expediente.

**Riesgos:** visibilidad interna mezclada, acciones sin permisos, descarga lenta, nombres maliciosos y densidad excesiva.

- [ ] Añadir zona de archivos staff con compartidos/internos, filtros mínimos y metadata operativa segura.
- [ ] Ocultar borrar/administrar sin capacidad, conservando autorización backend.
- [ ] Mostrar estados de análisis y errores accionables sin revelar scanner internals.
- [ ] Verificar Axe, responsive, consola, no overflow, payloads mínimos y estado de sesión.
- [ ] Commit `feat: add staff private files workspace`.

## Tarea 6 — Gate de seguridad, cleanup y cierre

**Objetivo antes de iniciar:** demostrar que ningún archivo privado cruza cliente, estado o proveedor.

- [ ] Crear fixtures de dos clientes, staff manager y rol limitado con objetos disponibles, pendientes y rechazados.
- [ ] Ejecutar matriz IDOR, roles, sesión revocada, replay, same-origin, cuotas, tipos disfrazados, path traversal, URL expirada y cleanup.
- [ ] Auditar DB, storage, HTML, payloads, logs y Outbox para confirmar ausencia de secretos, bytes o keys.
- [ ] Ejecutar E2E portal/staff, Axe, responsive, consola limpia y cleanup exacto.
- [ ] Ejecutar gate DB, unit, integration, content, typecheck, lint, build, E2E, audit y diff check.
- [ ] Actualizar riesgos/deuda/decisiones y hacer commit `docs: close phase seven private files`.

## Gate de Fase 7

No se iniciará PDF comercial ni aceptación digital hasta demostrar autorización backend por expediente, no entrega antes de `AVAILABLE`, URLs efímeras, limpieza de objetos huérfanos, auditoría segura y evidencia de scanner local/operacional claramente delimitada.
