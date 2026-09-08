# OCPOOL

OCPOOL es la base de una plataforma comercial para gestionar solicitudes de cotización, expedientes de clientes, cotizaciones versionadas, comunicación y aceptación digital para proyectos de construcción de piscinas.

La aplicación conserva la landing pública editorial existente y evoluciona hacia un monolito modular con tres superficies: web pública, portal de cliente y sistema interno.

## Estado actual

Las fases iniciales de la base técnica y la identidad están implementadas y verificadas:

- Next.js App Router, React y TypeScript en modo ESM.
- PostgreSQL 16 local mediante Docker Compose.
- Mailpit local para correo de desarrollo.
- MinIO local privado para probar el contrato S3 de archivos.
- Prisma ORM 7.10.0 con adaptador PostgreSQL.
- Validación tipada de entorno con Zod.
- Logs estructurados con redacción de campos sensibles.
- Errores HTTP públicos sin stack traces ni secretos.
- Migración foundation, seed idempotente y endpoint `/api/health`.
- Identidad relacional con clientes, usuarios, roles, permisos, sesiones, tokens, eventos y rate limiting PostgreSQL.
- Autenticación API con password Argon2id para empleados, MFA TOTP administrativo, magic link de cliente y recovery de contraseña.
- Cookies de sesión HttpOnly/SameSite=Lax, autorización backend deny-by-default y protección same-origin.
- Rate limit por email/IP confiable, circuit breaker de respaldo sin IP y límites streaming de body.
- Captación pública persistente mediante `POST /api/quote-requests`, folio comercial, idempotencia, Outbox y formulario con feedback accesible.
- Inbox interno protegido en `/staff/requests`, con filtros, detalle, historial, asignación y transición de estados.
- Catálogo, listas de precios y constructor versionado en `/staff/quotes`, con snapshots, permisos comerciales y flujo de revisión/envío.
- Portal privado `/portal` con cotizaciones históricas, mensajería, archivos privados, descarga de PDF comercial y aceptación explícita con evidencia.
- Operación staff de documentos PDF con estados, descarga efímera, generación condicionada y evidencia de aceptación.
- Notificaciones transaccionales por email con Outbox, plantillas versionadas, leases, reintentos y entrega local verificable en Mailpit.
- Operación staff de notificaciones en `/staff/notifications`, con diagnóstico seguro y reintentos RBAC sin exponer PII ni payloads.

Las Fases 1–9 están cerradas con gates técnicos verdes para el alcance local. La entrega de notificaciones es reproducible y operable; la revisión jurídica, los proveedores productivos, la retención, los backups, la observabilidad y la preparación de producción permanecen como controles previos al lanzamiento.

## Requisitos

- Node.js 22.14.0 o una versión compatible de Node 22.x.
- npm 11.x.
- Docker Desktop/Engine con Docker Compose v2.
- Puertos locales disponibles: `3000`, `55432`, `11025`, `18025`, `19000` y `19001`.

## Instalación local

Desde la raíz del proyecto:

```powershell
npm ci
Copy-Item .env.example .env
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Direcciones locales:

- Aplicación: [http://localhost:3000](http://localhost:3000)
- Salud de la aplicación: [http://localhost:3000/api/health](http://localhost:3000/api/health)
- Mailpit: [http://localhost:18025](http://localhost:18025)
- MinIO API privada: `http://localhost:19000`
- MinIO Console local: [http://localhost:19001](http://localhost:19001)
- PostgreSQL: `localhost:55432`

El archivo `.env` es local y nunca debe confirmarse en Git. `.env.example` contiene únicamente valores de desarrollo no secretos.

## Base de datos y correo

```powershell
npm run db:up
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:down
```

Usa migraciones Prisma para cambiar el schema. No uses `prisma db push` como flujo del proyecto. Las migraciones confirmadas en Git son la fuente de evolución del schema; `db:migrate:deploy` es el comando para aplicar únicamente migraciones existentes.

Mailpit captura el correo SMTP de desarrollo y permite inspeccionarlo en su interfaz web. No envía mensajes a destinatarios reales.

Los procedimientos operativos están separados de la guía de instalación:

- [Runbook de desarrollo local](docs/runbooks/local-development.md) — recuperación segura de servicios, pruebas y datos desechables.
- [Runbook de backup y restauración](docs/runbooks/backup-restore.md) — backup local PostgreSQL y restauración sólo en un destino de verificación explícito.
- [Runbook de preparación para producción](docs/runbooks/production-readiness.md) — evidencia `PASS`, bloqueos `BLOCKED` y advertencias `WARN` sin convertir decisiones externas en supuestos.

El worker de notificaciones se ejecuta separado de Next.js:

```powershell
npm run worker:notifications:once
npm run worker:notifications
```

El primer comando procesa el lote disponible y termina; el segundo mantiene el worker activo hasta recibir una señal de apagado. PostgreSQL coordina claims, leases, reintentos y recuperación de trabajos abandonados. Un estado `SENT` confirma aceptación del mensaje por el proveedor configurado; no confirma apertura ni lectura. El permiso `notifications.read` permite consultar la operación y `notifications.manage` permite reintentar entregas recuperables.

## Pruebas y calidad

```powershell
npm test
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:content
npm run build
npm run test:e2e
npm run test:e2e:foundation
npm run test:e2e:auth
npx cross-env PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts
npx cross-env QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts
npx cross-env AUTH_E2E=1 REUSE_E2E_SERVER=1 APP_URL=http://127.0.0.1:3100 playwright test tests/staff-notifications.spec.ts
```

La suite E2E pública conserva el contrato visual, responsive, de interacción, consola y accesibilidad de la landing. La prueba foundation requiere PostgreSQL activo y se ejecuta de forma opt-in.
La suite de identidad también es opt-in: crea un empleado desechable en PostgreSQL, valida login/sesión/logout/CSRF y elimina el fixture al terminar. Requiere Docker y se ejecuta con `npm run test:e2e:auth`.

## Identidad local

`.env.example` contiene los valores de desarrollo para:

- `MFA_ENCRYPTION_KEY`: clave local para cifrar secretos TOTP; reemplázala mediante un gestor de secretos en producción.
- `AUTH_DELIVERY_ENCRYPTION_KEY`: clave separada para cifrar tokens de entrega en Outbox; debe rotarse independientemente de MFA.
- `NOTIFICATION_RECIPIENT_ENCRYPTION_KEY`: clave separada para cifrar destinatarios de notificaciones; no debe reutilizarse para MFA ni tokens de autenticación.
- `SMTP_*`: host, puerto, TLS, remitente y respuesta del proveedor; en local apuntan a Mailpit y las credenciales son opcionales.
- `NOTIFICATION_*`: tamaño bounded de lote, lease, máximo de intentos y pausa del worker; los valores locales evitan loops infinitos y crecimiento sin control.
- `TRUST_PROXY_HEADERS`: habilítala sólo cuando un proxy confiable sobrescriba los headers de IP antes de llegar a la aplicación.
- `SESSION_TTL_HOURS`: duración máxima de una sesión persistida.
- `AUTH_TOKEN_TTL_MINUTES`: duración de magic links y recovery.
- `AUTH_RATE_LIMIT_MAX_ATTEMPTS` y `AUTH_RATE_LIMIT_WINDOW_MINUTES`: ventana fija del rate limit PostgreSQL por email/IP confiable.
- `AUTH_GLOBAL_RATE_LIMIT_MAX_ATTEMPTS` y `AUTH_GLOBAL_RATE_LIMIT_WINDOW_MINUTES`: circuit breaker global de respaldo, aplicado sólo cuando no existe una IP confiable; no sustituye el rate limit del proxy.
- `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY` y `STORAGE_S3_SECRET_KEY`: conexión local al bucket privado S3-compatible; usa un gestor de secretos en producción.
- `STORAGE_S3_FORCE_PATH_STYLE`: necesario para MinIO local; en producción se decide según el proveedor.
- `STORAGE_MAX_FILE_BYTES`: límite de aplicación, alineado con el constraint de 25 MiB de la migración inicial.

Endpoints disponibles:

- `POST /api/auth/employee/login` — login de empleado; administradores requieren TOTP.
- `POST /api/auth/customer/request-link` — solicita magic link sin enumerar cuentas.
- `POST /api/auth/customer/consume-link` — consume un link una sola vez.
- `GET|POST /api/auth/session` — consulta o cierra la sesión actual.
- `POST /api/auth/recovery/request` y `POST /api/auth/recovery/consume` — recovery de empleados.
- `POST /api/quote-requests` — crea un expediente público con consentimiento, folio y respuesta idempotente mediante el header `Idempotency-Key`.
- `GET /api/staff/quote-requests` y `GET /api/staff/quote-requests/:id` — inbox y detalle para empleados autorizados.
- `GET /api/staff/quote-requests/assignees`, `POST .../:id/assign` y `POST .../:id/status` — operaciones internas RBAC con auditoría e historial.
- `GET|POST /api/portal/requests/:id/files` y `POST|GET|DELETE .../:fileId` — archivos privados del cliente con reserva, finalización y descarga efímera.
- `GET|POST /api/staff/quote-requests/:id/files` y `POST|GET|DELETE .../:fileId` — superficie equivalente para staff con visibilidad interna RBAC.
- `GET /api/portal/quotes/:id/pdf` y `POST /api/portal/quotes/:id/accept` — PDF privado y aceptación de la versión vigente dentro del alcance del cliente.
- `GET|POST /api/staff/quotes/versions/:versionId/pdf` — estado READY/descarga efímera y generación staff protegida por RBAC.
- `GET /api/staff/quotes/versions/:versionId/document` — estado operativo seguro del documento y evidencia de aceptación para staff.
- `GET /api/staff/notifications` — operación de entregas con proyección segura, filtros y salud agregada para staff autorizado.
- `POST /api/staff/notifications/:id/retry` — reencola una entrega fallida recuperable con RBAC, same-origin, auditoría e idempotencia.

Los tokens se guardan como huellas SHA-256. Los eventos Outbox de correo contienen el token únicamente cifrado para que el worker pueda entregarlo; nunca se incluye el token crudo en payloads, respuestas o logs. La interfaz staff sólo expone códigos de error controlados, no destinatarios, ciphertext, payloads ni respuestas crudas del proveedor.

Las cargas de archivos usan una reserva de metadata y una URL presigned de vida corta. El bucket MinIO/S3 es privado; el backend valida tamaño, tipo declarado, firma mágica, hash y estado `AVAILABLE` antes de generar una URL de descarga. Las keys físicas, hashes de idempotencia y credenciales no forman parte de las proyecciones públicas.

Para validar una variable necesaria antes de un comando:

```powershell
node scripts/require-env.mjs DATABASE_URL
```

La política de runtime productivo se valida de forma explícita y permanece separada del build local:

```powershell
npm run validate:production
```

Con `.env.example` el resultado esperado es `BLOCKED`; no se deben reutilizar secretos ni endpoints locales para publicar el sistema. `/api/health` indica liveness y `/api/ready` indica disponibilidad de PostgreSQL para un supervisor o balanceador.

## Estructura relevante

- `src/app/` — rutas de Next.js y API.
- `src/components/` — componentes de la landing pública, portal cliente y superficies internas.
- `src/server/` — configuración de entorno, base de datos, errores, logging, identidad y dominios comerciales del servidor.
- `prisma/` — schema, migraciones y seed.
- `tests/unit/` — pruebas unitarias.
- `tests/integration/` — pruebas contra PostgreSQL local.
- `tests/*.spec.ts` — pruebas E2E de Playwright.
- `docs/superpowers/specs/` — diseño aprobado.
- `docs/superpowers/plans/` — planes de implementación ordenados.
- `docs/runbooks/` — procedimientos operativos locales.
- `PROJECT_STATUS.md` — fuente única del avance, decisiones, riesgos y evidencia.

## Estado de implementación

La identidad, captación, expedientes, cotizaciones, portal, mensajería, archivos privados, PDF/aceptación y notificaciones tienen schema, servicios, endpoints protegidos, UI, pruebas y documentación operativa dentro del alcance local. El siguiente bloque ordenado será el hardening de producción; dashboards/métricas se desarrollarán después, sin presentar el sistema como listo para lanzamiento mientras existan riesgos abiertos.

La auditoría de producción local termina en 0 vulnerabilidades: `deepmerge-ts@8.0.2` y `mysql2@3.24.3` están fijados mediante overrides compatibles con Prisma 7.10.0. Estas versiones deben revisarse cuando Prisma las incorpore de forma nativa.

## Base técnica inicial

La base técnica incluye instalación reproducible, migraciones, seed idempotente, health check seguro, pruebas por capa y regresión completa de la landing. El detalle de criterios, riesgos y evidencia de cada fase se mantiene en `PROJECT_STATUS.md`.

La especificación de arquitectura y el orden de fases están en [docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md](docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md).
