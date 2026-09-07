# OCPOOL — Estado del proyecto

> Fuente única de seguimiento del proyecto de plataforma comercial. Este archivo se actualiza después de cada fase, vertical slice y verificación relevante.

## Estado actual

- **Fase:** Fase 1 — Fundamentos técnicos.
- **Estado:** Fase cerrada con gate técnico completo; lista para planificar Fase 2.
- **Última actualización:** 2026-09-07.
- **Rama de implementación:** `codex/ocpool-foundation`.
- **Commits de la fase:** `f933bd2`, `8b31e67`, `84fdeb2`, `f29db17`, `46c9796`.

## Orden documental obligatorio

1. Auditoría y decisiones iniciales.
2. Especificación de diseño en `docs/superpowers/specs/`.
3. Autorrevisión de la especificación.
4. Plan de implementación en `docs/superpowers/plans/`.
5. Implementación por vertical slices.
6. Verificación de fase.
7. Actualización de este archivo y documentación técnica.

No se iniciará una fase posterior si la fase anterior no tiene criterios de terminado verificables.

## Módulos

### Terminados para el alcance actual de la web pública

- Landing pública editorial de OCPOOL.
- Identidad visual y sistema de estilos de la landing.
- Portafolio de proyectos y diálogo accesible.
- Navegación responsive.
- Formulario público básico de contacto.
- Metadata, Open Graph, Twitter card, JSON-LD, robots y sitemap.
- Contrato de contenido de la web.
- Pruebas E2E de calidad visual, interacción, responsive, consola y accesibilidad.

### Fundamentos terminados en esta fase

- Toolchain ESM con TypeScript ES2023, Vitest y scripts reproducibles.
- Separación de descubrimiento E2E (`*.spec.ts`) y pruebas unitarias/integración.
- PostgreSQL 16 y Mailpit versionados en Docker Compose con healthcheck.
- `.env.example`, guard de variables y runbook de desarrollo local.
- Prisma 7.10.0 con adaptador PostgreSQL, schema foundation y migración aplicada.
- Seed idempotente de `system.schema_version`.
- Cliente Prisma lazy y servicio de health de base de datos.
- Logger estructurado con redacción y sanitización de valores sensibles.
- Contrato de errores HTTP públicos sin stack traces, SQL ni secretos.
- Endpoint `GET /api/health` con `requestId` y estado degradado seguro.
- Pruebas unitarias, integración PostgreSQL, E2E foundation y regresión de landing.

### En desarrollo

- Ningún módulo: Fase 1 está cerrada y la siguiente implementación requiere el plan de Fase 2.

### Prototipo o incompletos para el producto comercial

- Formulario de cotización: sólo valida datos y prepara un `mailto`; no crea una solicitud persistida.
- Contacto: no existe confirmación transaccional ni expediente.

### Pendientes

- Arquitectura de aplicación comercial.
- PostgreSQL, migraciones y seeds.
- Identidad, sesiones y RBAC.
- Clientes, contactos y expedientes.
- Solicitudes, folios, estados y asignaciones.
- Catálogo, precios y plantillas.
- Constructor de cotizaciones.
- Snapshots y versionado inmutable.
- Portal del cliente.
- Mensajería y notas internas.
- Archivos privados.
- PDF comercial.
- Aceptación digital.
- Notificaciones y Outbox.
- Auditoría comercial y de seguridad.
- Dashboard y métricas.
- Hardening, backups, observabilidad y preparación para producción.

## Decisiones arquitectónicas vigentes

1. Mantener la web pública existente y su identidad visual.
2. Construir un monolito modular, no microservicios.
3. Mantener Next.js App Router como aplicación principal.
4. Usar PostgreSQL como fuente de verdad transaccional.
5. Separar marketing, portal de cliente y sistema interno mediante route groups y módulos de dominio.
6. Mantener sesiones privadas y autorización en backend; no usar el folio como autenticación.
7. Separar el folio comercial del identificador interno UUID/ULID.
8. Tratar las versiones enviadas o aceptadas como inmutables.
9. Guardar snapshots de precios, impuestos y conceptos dentro de cada versión de cotización.
10. Iniciar localmente con aplicación, PostgreSQL y Mailpit; agregar storage, worker, antivirus o Redis sólo cuando el módulo lo justifique.
11. Mantener WhatsApp y otros canales externos desacoplados del flujo principal.
12. No afirmar que la aceptación digital sustituye contratos formales sin revisión jurídica.

## Pruebas realizadas

Gate final ejecutado después de `npm ci`:

- `npm test` — suite unificada documentada; se repetirá como verificación final de cierre.
- `npm run db:up` — PostgreSQL y Mailpit activos.
- `npm run db:validate` — schema válido.
- `npm run db:generate` — cliente Prisma 7.10.0 generado.
- `npm run db:migrate:deploy` — sin migraciones pendientes.
- `npm run db:seed` — correcto e idempotente.
- `npm run test:unit` — 12 pruebas correctas.
- `npm run test:integration` — 1 prueba correcta contra PostgreSQL.
- `npm run test:e2e:foundation` — 1 prueba correcta.
- `npm run test:content` — correcto.
- `npm run build` — correcto; lint y tipos de Next.js completados.
- `npm run test:e2e` — 29 correctas y 1 omitida de forma explícita por ser opt-in.
- `git diff --check` — correcto.

La suite E2E completa descubrió 30 pruebas: la foundation se omite en el comando normal para no exigir Docker; su ejecución dedicada sí fue validada.

## Pruebas pendientes

- Pruebas unitarias de dominio.
- Pruebas de servicios y transacciones de base de datos.
- Pruebas de API y autorización.
- Pruebas de IDOR, enumeración, sesiones y rate limiting.
- Pruebas de archivos privados y URLs temporales.
- Pruebas de snapshots e inmutabilidad.
- Pruebas de cálculo de cotizaciones.
- E2E cliente y empleado.
- Pruebas de PDF y aceptación.
- Pruebas de notificaciones y reintentos.
- Pruebas de carga y restauración de backups.
- Diagnóstico y ejecución independiente de `npm run lint` fuera del gate de Next.js.

## Riesgos abiertos

- Reglas de moneda, IVA, descuentos y redondeos aún no confirmadas.
- Alcance de datos por ejecutivo, sucursal o zona aún no confirmado.
- Proveedor de correo transaccional de producción aún no seleccionado.
- Política de retención y eliminación de datos personales pendiente de revisión formal.
- Requisitos legales de aceptación y evidencia pendientes de revisión jurídica.
- Destino de despliegue de producción aún no definido.
- `npm audit` reporta 5 vulnerabilidades transitorias tras incorporar Prisma CLI 7.10.0: 4 altas asociadas a `deepmerge-ts`/`mysql2` y 1 moderada asociada a `@humanfs/node`. La corrección automática propone degradar Prisma a 6.19.3; queda pendiente una resolución compatible o una excepción de riesgo documentada.
- El health check cubre disponibilidad de PostgreSQL, pero todavía no existe autenticación, autorización ni rate limiting.

## Deuda técnica conocida

- Los módulos comerciales todavía no existen: no hay capa de dominio de clientes, solicitudes, cotizaciones ni portal.
- El endpoint de contacto actual no debe considerarse backend comercial.
- El lint independiente necesita diagnóstico para quedar reproducible y documentado.
- El timestamp de la migración foundation es el generado por Prisma en la ejecución local (`20260907231807_foundation`); no se renombró después de aplicarlo para no desalinear el historial de migraciones.

## Dependencias entre módulos

- `src/server/env.ts` es dependencia de Prisma, seed y runtime del servidor.
- Docker Compose debe proporcionar PostgreSQL antes de migraciones, integración y health E2E.
- Prisma schema/migraciones son dependencia de cualquier módulo comercial con persistencia.
- Logger y errores HTTP son dependencias transversales de las futuras APIs.
- La separación Playwright/Vitest protege la regresión de landing mientras crece el backend.
- Fase 2 (identidad/RBAC) debe preceder a expedientes, cotizaciones y portal porque todos requieren autorización backend.

## Problemas encontrados y resolución

- Vitest 5 exigía tipos Node 22; se actualizó `@types/node` al rango compatible con Node 22.14.
- Playwright descubría pruebas unitarias `.test.ts`; se limitó el patrón E2E a `*.spec.ts`.
- Vitest no cargaba `.env` en integración; se añadió `tests/setup-env.ts`.
- El guard de migraciones no cargaba `.env`; se añadió `dotenv/config` y una prueba de contrato.
- La primera prueba E2E pública tuvo un timeout intermitente en overflow horizontal; la repetición posterior con la configuración corregida terminó en 29/29.
- El wrapper npm para argumentos Prisma eliminó `--name`; se usó el CLI directo y se conservó el timestamp generado para no renombrar una migración aplicada.

## Criterio de terminado de Fase 1

Se considera terminada porque la base instala desde cero, levanta servicios reproducibles, valida y aplica migraciones, ejecuta seed idempotente, expone un health check seguro, separa pruebas por capa, conserva la landing y pasa el gate documentado. No implica que el producto comercial completo esté terminado.

## Planes vigentes

- `docs/superpowers/plans/2026-09-07-ocpool-foundation.md` — Fase 1, fundamentos técnicos, ejecutado.

## Próximo paso autorizado

Crear y revisar el plan ordenado de Fase 2 — Identidad y RBAC. No iniciar clientes, solicitudes ni cotizaciones hasta resolver el modelo de usuarios, sesiones, roles, permisos, recuperación y auditoría de seguridad.
