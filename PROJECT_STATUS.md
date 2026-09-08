# OCPOOL — Estado del proyecto

> Fuente única de seguimiento del proyecto de plataforma comercial. Este archivo se actualiza después de cada fase, vertical slice y verificación relevante.

## Estado actual

- **Fase:** Fase 4 — Catálogo, precios y cotizaciones versionadas.
- **Estado:** Fase 4 está en ejecución. La Tarea 1 está terminada con contratos monetarios, estados, snapshots y permisos probados; la Tarea 2 es el siguiente incremento autorizado.
- **Última actualización:** 2026-09-07.
- **Rama de implementación:** `codex/ocpool-foundation`.
- **Commits de la fase:** `cda7a7a`, `4240d15`.

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
- Formulario público de cotización conectado al expediente persistido, con validación, consentimiento, estados de UI, folio e idempotencia de reintentos.
- Endpoint público `POST /api/quote-requests` con protección same-origin, límite de body, rate limiting por email/IP confiable y respuesta sin IDs internos.
- Inbox interno `/staff/requests` con lista paginada, filtros, detalle, historial, estados vacíos/carga/error y diseño responsive.
- Endpoints internos protegidos por sesión de empleado, RBAC, same-origin en mutaciones, bloqueo transaccional, asignación histórica y transiciones de estado auditadas.

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
- Contrato de entorno para MFA, sesiones, tokens y rate limiting.
- Modelo relacional de clientes, usuarios, roles, permisos, sesiones, tokens, eventos y buckets de intentos.
- Migración adicional de protección contra replay de MFA (`20260908002806_mfa_replay_protection`).
- Argon2id para contraseñas de empleados; huellas SHA-256 para tokens y sesiones; AES-256-GCM para secretos MFA.
- Catálogo RBAC inicial con roles `customer`, `sales`, `manager` y `admin`, seed idempotente y guardias backend deny-by-default.
- Sesiones persistidas con expiración, revocación, actor derivado desde PostgreSQL y cookie `ocpool_session` con política segura.
- Tokens de autenticación de un solo uso y rate limiting de ventana fija con bloqueo de fila PostgreSQL.
- MFA TOTP con ventana controlada y contador persistido para rechazar replays.
- Servicios y rutas API de autenticación: login empleado, magic link, recovery, sesión y logout.
- Eventos de autenticación y Outbox transaccionales; tokens de entrega cifrados con clave separada de MFA.
- Protección same-origin, validación JSON con límite de body, errores públicos genéricos y request IDs.
- Rate limit por email/IP confiable sin bucket global `unknown-client`; circuit breaker global separado sólo para solicitudes sin IP confiable.
- Parser de cuerpos JSON con límite streaming de 16 KiB y cancelación temprana para requests chunked.
- Typecheck explícito (`npm run typecheck`) integrado en `npm test`.
- Contratos puros iniciales de solicitudes: estados, transiciones, folio provisional `OCQ-YYYY-NNNNNN`, normalización y permisos RBAC de solicitudes.
- Schema relacional de clientes/contactos, solicitudes, detalles, asignaciones, historial, folios e índices; migración `20260908025713_clients_requests` aplicada.
- Seed idempotente de `FolioSequence.quote_request` y catálogo RBAC ampliado para solicitudes.
- Servicio transaccional de solicitudes: cliente/contacto, folio bloqueado, detalle, historial inicial, auditoría y Outbox en una transacción.
- Idempotencia pública mediante huella SHA-256 de clave de reintento limitada; migración `20260908030200_quote_request_idempotency` aplicada.
- Captación pública E2E sobre navegador de producción local; el endpoint legado de `mailto` fue retirado para evitar flujos no persistentes.
- Servicio operativo de inbox: listado/detalle con proyección segura, responsables activos, asignación con cierre de asignación previa y eventos Outbox de operación.
- Gate reproducible de Fase 3: migraciones/seed al día, auditoría de producción sin vulnerabilidades conocidas y lockfile con overrides compatibles de dependencias transitorias.
- Contratos de Fase 4 para dinero, cantidades de punto fijo, porcentajes en basis points, redondeo half-up, límites y monedas explícitas.
- Cálculo puro de líneas con subtotal, descuento, base gravable, impuesto y total sin floats.
- Snapshots de líneas y totales congelados en memoria, con identidad comercial y valores monetarios capturados.
- Estados de cotización versionada con edición exclusiva de borradores y aceptación bloqueada hasta existir evidencia de aceptación.
- Permisos RBAC separados para lectura/administración de catálogo y lectura/administración de precios.

### En desarrollo

- Fase 4 — Tarea 2: schema relacional de catálogo, listas de precios, cotizaciones y snapshots persistidos.

### Prototipo o incompletos para el producto comercial

- Contacto directo por correo/WhatsApp: canal informativo, todavía fuera del expediente persistido.

### Pendientes

- Arquitectura de aplicación comercial por dominios de negocio.
- Catálogo, precios y plantillas.
- Migración relacional de catálogo, listas, cotizaciones y snapshots.
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
13. Mantener las transiciones dependientes de cotización cerradas en el inbox hasta que exista el módulo de cotizaciones.
14. Representar dinero con `BigInt` en unidad mínima y cantidades con escala fija de milésimas; porcentajes como basis points enteros.
15. Aplicar redondeo half-up explícito por línea para cantidad, descuento e impuesto; sumar los resultados de línea para los totales.
16. Permitir sólo códigos de moneda de tres letras normalizados en el dominio; la lista comercial definitiva de monedas queda pendiente de confirmación.
17. Congelar snapshots de dominio y persistirlos como datos históricos en la siguiente tarea; ninguna versión distinta de `BORRADOR` será editable.

## Pruebas realizadas

Gate final ejecutado después de instalación limpia de dependencias:

- `npm ci --no-audit --fund=false --foreground-scripts` — correcto; se recuperó previamente un conflicto Windows `ENOTEMPTY` moviendo sólo directorios generados de `node_modules`, sin tocar código ni datos.
- `npm run db:up` — PostgreSQL y Mailpit activos.
- `npm run db:validate` — schema válido.
- `npm run db:generate` — cliente Prisma 7.10.0 generado.
- `npm run db:migrate:deploy` — sin migraciones pendientes.
- `npm run db:seed` — correcto e idempotente.
- `npm test` — correcto en el estado final: typecheck, 29 unitarias, 9 integraciones PostgreSQL, contrato de contenido, build, 29 E2E públicos con 2 omitidas explícitamente y 1 E2E foundation dedicado.
- Tras Tarea 1 de Fase 3: `npm run test:unit` 34/34, `npm run test:integration` 9/9, `npm run typecheck` y `npm run lint` correctos.
- Tras Tarea 2 de Fase 3: `npm run test:integration` 10/10, `npm run db:validate`, `npm run db:generate`, migración aplicada/inspeccionada, `npm run db:seed`, `npm run typecheck` y `npm run lint` correctos.
- Tras Tarea 3 de Fase 3: prueba dirigida del servicio 2/2 y `npm run test:integration` 12/12; incluye concurrencia de folios, replay idempotente, agregado atómico, historial, auditoría y Outbox.
- Tras Tarea 4 de Fase 3: `npm run test:integration` 14/14, prueba E2E dirigida del formulario 1/1 y `npm run build`, `npm run typecheck` y `npm run lint` correctos; la suite pública valida API, responsive, accesibilidad, consola y folio.
- Gate final de Fase 3: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy` sin pendientes, `npm run db:seed` idempotente, `npm run test:unit` 35/35, `npm run test:integration` 20/20, `npm run test:content`, `npm run build`, E2E pública 31/31 con 2 omitidas explícitamente, foundation E2E 1/1 y auth E2E 1/1.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilidades después de fijar `deepmerge-ts@8.0.2` y `mysql2@3.24.3` mediante overrides compatibles con Prisma 7.10.0.
- `npm run lint` — correcto.
- `npm run test:e2e:auth` — 1 flujo correcto: fixture desechable, login, sesión, rechazo de logout foreign-origin y logout.
- `npm run test:content` — correcto.
- `npx tsc --noEmit` / `npm run typecheck` — correctos, incluyendo los tipos de las pruebas Playwright y Vitest.
- Revisión independiente de seguridad — sin hallazgos Critical/Important bloqueantes después de corregir rate limit sin IP, body chunked, retorno temprano antes de Argon2 y circuit breaker condicionado por IP confiable.
- `git diff --check` — correcto.
- Tarea 1 de Fase 4: prueba roja inicial de contrato, después `npm run test:unit` 41/41, `npm run test:integration` 20/20, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.

La suite E2E completa descubre 31 pruebas: auth y foundation se omiten en el comando normal para no exigir fixtures/infraestructura; ambas ejecuciones opt-in fueron validadas de forma dedicada.

## Pruebas pendientes

- Pruebas unitarias restantes de servicios comerciales y reglas persistidas.
- Pruebas de IDOR sobre clientes, solicitudes, expedientes y futuras cotizaciones.
- E2E cliente y empleado de los flujos comerciales.
- Pruebas de archivos privados y URLs temporales.
- Pruebas de snapshots e inmutabilidad.
- Pruebas de cálculo de cotizaciones.
- E2E cliente y empleado.
- Pruebas de PDF y aceptación.
- Pruebas de notificaciones y reintentos.
- Pruebas de carga y restauración de backups.

## Riesgos abiertos

- Reglas de moneda, IVA, descuentos y redondeos aún no confirmadas.
- Alcance de datos por ejecutivo, sucursal o zona aún no confirmado.
- Proveedor de correo transaccional de producción aún no seleccionado.
- Política de retención y eliminación de datos personales pendiente de revisión formal.
- Requisitos legales de aceptación y evidencia pendientes de revisión jurídica.
- Destino de despliegue de producción aún no definido.
- La protección por IP requiere `TRUST_PROXY_HEADERS=true` sólo detrás de un proxy confiable que sobrescriba la IP. Sin IP confiable, el backend usa límites por identificador y un circuit breaker global separado; el proxy de producción debe aportar rate limiting por origen.
- La infraestructura de identidad ya está expuesta por endpoints y escribe Outbox, pero el worker SMTP que entrega esos eventos pertenece a la siguiente etapa de mensajería.
- Puede existir una diferencia temporal residual entre cuentas existentes e inexistentes en solicitudes de link/recovery; no hay enumeración en respuesta ni payload.

## Deuda técnica conocida

- Todavía no existen catálogo, cotizaciones versionadas, portal de cliente, archivos ni aceptación digital.
- El endpoint de contacto actual no debe considerarse backend comercial.
- El timestamp de la migración foundation es el generado por Prisma en la ejecución local (`20260907231807_foundation`); no se renombró después de aplicarlo para no desalinear el historial de migraciones.
- Las versiones transitorias de Prisma están fijadas en `package.json` para mantener la auditoría limpia; deben revisarse cuando Prisma publique una actualización estable que incorpore esas versiones de forma nativa.

## Dependencias entre módulos

- `src/server/env.ts` es dependencia de Prisma, seed y runtime del servidor.
- Docker Compose debe proporcionar PostgreSQL antes de migraciones, integración y health E2E.
- Prisma schema/migraciones son dependencia de cualquier módulo comercial con persistencia.
- Logger y errores HTTP son dependencias transversales de las futuras APIs.
- La separación Playwright/Vitest protege la regresión de landing mientras crece el backend.
- Fase 2 (identidad/RBAC) debe preceder a expedientes, cotizaciones y portal porque todos requieren autorización backend.
- Las rutas de autenticación dependerán de `sessions.ts`, `tokens.ts`, `mfa.ts`, `rate-limit.ts`, `permissions.ts`, el logger y el envelope de errores.
- Los contratos de `src/server/modules/quotes/domain.ts` son dependencia de schema, servicio de precios, snapshots persistidos y constructor.

## Problemas encontrados y resolución

- Vitest 5 exigía tipos Node 22; se actualizó `@types/node` al rango compatible con Node 22.14.
- Playwright descubría pruebas unitarias `.test.ts`; se limitó el patrón E2E a `*.spec.ts`.
- Vitest no cargaba `.env` en integración; se añadió `tests/setup-env.ts`.
- El guard de migraciones no cargaba `.env`; se añadió `dotenv/config` y una prueba de contrato.
- La primera prueba E2E pública tuvo un timeout intermitente en overflow horizontal; la repetición posterior con la configuración corregida terminó en 29/29.
- El wrapper npm para argumentos Prisma eliminó `--name`; se usó el CLI directo y se conservó el timestamp generado para no renombrar una migración aplicada.
- Next.js no acepta el enum ambient de `@node-rs/argon2` con `isolatedModules`; se usó el valor estable `2` para Argon2id y se verificó con build y pruebas.
- La revisión de seguridad detectó reutilización de la clave MFA, tokens de recovery paralelos y carrera de sesión; se separó `AUTH_DELIVERY_ENCRYPTION_KEY`, se invalidan recovery tokens pendientes y la resolución de sesión usa actualización condicional atómica.
- La revisión posterior detectó y corrigió bloqueo global por `unknown-client`, lectura tardía de bodies chunked, hashing Argon2 antes del rate limit y aplicación excesiva del circuit breaker; cada corrección quedó cubierta por pruebas unitarias o de integración.
- El E2E de producción local inicialmente no reenviaba cookies `Secure` sobre HTTP; se mantuvo `Secure` y la prueba valida atributos y transporta explícitamente el valor opaco para probar la API.
- La primera compuerta final encontró contaminación de buckets sintéticos entre ejecuciones; el test de API ahora limpia únicamente sus hashes de fixture y quedó estable en la repetición completa.
- La prueba del seed asumía que el contador de folios siempre era `1`; se corrigió para verificar que el seed sea idempotente y preserve secuencias ya consumidas.
- El typecheck conservó referencias generadas al endpoint legado después de retirarlo; el build de producción regeneró `.next` y confirmó el árbol de rutas final sin `send-email`.
- La ejecución paralela de integración expuso aserciones frágiles sobre folios y buckets de rate limit; se corrigieron para tolerar concurrencia controlada y limpiar únicamente fixtures identificables.
- El gate de seguridad encontró vulnerabilidades transitorias de Prisma; se resolvieron con overrides verificables y se repitió la suite completa antes de cerrar Fase 3.
- `npx tsc --noEmit` encontró tipos incompletos en pruebas existentes; se corrigieron sin relajar `strict`.

## Criterio de terminado de Fase 1

Se considera terminada porque la base instala desde cero, levanta servicios reproducibles, valida y aplica migraciones, ejecuta seed idempotente, expone un health check seguro, separa pruebas por capa, conserva la landing y pasa el gate documentado. No implica que el producto comercial completo esté terminado.

## Planes vigentes

- `docs/superpowers/plans/2026-09-07-ocpool-foundation.md` — Fase 1, fundamentos técnicos, ejecutado.
- `docs/superpowers/plans/2026-09-07-ocpool-identity-rbac.md` — Fase 2, plan aprobado y ejecutado.
- `docs/superpowers/plans/2026-09-07-ocpool-clients-requests.md` — Fase 3, plan técnico ejecutado; Tareas 1–6 terminadas con gate final.
- `docs/superpowers/plans/2026-09-07-ocpool-catalog-quotes.md` — Fase 4, Tarea 1 ejecutada; Tarea 2 lista para iniciar.

## Próximo paso autorizado

Ejecutar la Tarea 2 de Fase 4: diseñar, migrar y verificar el schema relacional de catálogo, listas, cotizaciones, versiones, líneas snapshot e historial.
