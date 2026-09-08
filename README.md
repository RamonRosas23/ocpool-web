# OCPOOL

OCPOOL es la base de una plataforma comercial para gestionar solicitudes de cotización, expedientes de clientes, cotizaciones versionadas, comunicación y aceptación digital para proyectos de construcción de piscinas.

La aplicación conserva la landing pública editorial existente y evoluciona hacia un monolito modular con tres superficies: web pública, portal de cliente y sistema interno.

## Estado actual

Las fases iniciales de la base técnica y la identidad están implementadas y verificadas:

- Next.js App Router, React y TypeScript en modo ESM.
- PostgreSQL 16 local mediante Docker Compose.
- Mailpit local para correo de desarrollo.
- Prisma ORM 7.10.0 con adaptador PostgreSQL.
- Validación tipada de entorno con Zod.
- Logs estructurados con redacción de campos sensibles.
- Errores HTTP públicos sin stack traces ni secretos.
- Migración foundation, seed idempotente y endpoint `/api/health`.
- Identidad relacional con clientes, usuarios, roles, permisos, sesiones, tokens, eventos y rate limiting PostgreSQL.
- Autenticación API con password Argon2id para empleados, MFA TOTP administrativo, magic link de cliente y recovery de contraseña.
- Cookies de sesión HttpOnly/SameSite=Lax, autorización backend deny-by-default y protección same-origin.
- Rate limit por email/IP confiable, circuit breaker de respaldo sin IP y límites streaming de body.

Los módulos de clientes operativos, solicitudes, catálogo, cotizaciones, portal y aceptación pertenecen a fases posteriores.

## Requisitos

- Node.js 22.14.0 o una versión compatible de Node 22.x.
- npm 11.x.
- Docker Desktop/Engine con Docker Compose v2.
- Puertos locales disponibles: `3000`, `55432`, `11025` y `18025`.

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
```

La suite E2E pública conserva el contrato visual, responsive, de interacción, consola y accesibilidad de la landing. La prueba foundation requiere PostgreSQL activo y se ejecuta de forma opt-in.
La suite de identidad también es opt-in: crea un empleado desechable en PostgreSQL, valida login/sesión/logout/CSRF y elimina el fixture al terminar. Requiere Docker y se ejecuta con `npm run test:e2e:auth`.

## Identidad local

`.env.example` contiene los valores de desarrollo para:

- `MFA_ENCRYPTION_KEY`: clave local para cifrar secretos TOTP; reemplázala mediante un gestor de secretos en producción.
- `AUTH_DELIVERY_ENCRYPTION_KEY`: clave separada para cifrar tokens de entrega en Outbox; debe rotarse independientemente de MFA.
- `TRUST_PROXY_HEADERS`: habilítala sólo cuando un proxy confiable sobrescriba los headers de IP antes de llegar a la aplicación.
- `SESSION_TTL_HOURS`: duración máxima de una sesión persistida.
- `AUTH_TOKEN_TTL_MINUTES`: duración de magic links y recovery.
- `AUTH_RATE_LIMIT_MAX_ATTEMPTS` y `AUTH_RATE_LIMIT_WINDOW_MINUTES`: ventana fija del rate limit PostgreSQL por email/IP confiable.
- `AUTH_GLOBAL_RATE_LIMIT_MAX_ATTEMPTS` y `AUTH_GLOBAL_RATE_LIMIT_WINDOW_MINUTES`: circuit breaker global de respaldo, aplicado sólo cuando no existe una IP confiable; no sustituye el rate limit del proxy.

Endpoints disponibles:

- `POST /api/auth/employee/login` — login de empleado; administradores requieren TOTP.
- `POST /api/auth/customer/request-link` — solicita magic link sin enumerar cuentas.
- `POST /api/auth/customer/consume-link` — consume un link una sola vez.
- `GET|POST /api/auth/session` — consulta o cierra la sesión actual.
- `POST /api/auth/recovery/request` y `POST /api/auth/recovery/consume` — recovery de empleados.

Los tokens se guardan como huellas SHA-256. Los eventos Outbox de correo contienen el token únicamente cifrado para que el worker futuro pueda entregarlo; nunca se incluye el token crudo en payloads, respuestas o logs.

Para validar una variable necesaria antes de un comando:

```powershell
node scripts/require-env.mjs DATABASE_URL
```

## Estructura relevante

- `src/app/` — rutas de Next.js y API.
- `src/components/` — componentes de la landing pública existente.
- `src/server/` — configuración de entorno, base de datos, errores, logging e identidad del servidor.
- `prisma/` — schema, migraciones y seed.
- `tests/unit/` — pruebas unitarias.
- `tests/integration/` — pruebas contra PostgreSQL local.
- `tests/*.spec.ts` — pruebas E2E de Playwright.
- `docs/superpowers/specs/` — diseño aprobado.
- `docs/superpowers/plans/` — planes de implementación ordenados.
- `docs/runbooks/` — procedimientos operativos locales.
- `PROJECT_STATUS.md` — fuente única del avance, decisiones, riesgos y evidencia.

## Alcance de Fase 2 completado

La identidad y RBAC tienen schema, seed, criptografía, sesiones, MFA, rate limiting, servicios, endpoints seguros, pruebas unitarias/integración/E2E y documentación operativa. El siguiente bloque es Fase 3: clientes, solicitudes y expedientes.

La auditoría actual mantiene 4 advisories altos transitorios en la cadena de Prisma (`deepmerge-ts`/`mysql2`); no se aplicó el downgrade automático a Prisma 6.19.3. Este riesgo debe resolverse o aprobarse formalmente antes de producción.

## Alcance de Fase 1

Esta fase establece infraestructura y contratos, no funcionalidades comerciales. Su criterio de terminado incluye instalación reproducible, migración, seed idempotente, health check seguro, pruebas unitarias/integración/E2E y regresión completa de la landing.

La especificación de arquitectura y el orden de fases están en [docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md](docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md).
