# OCPOOL

OCPOOL es la base de una plataforma comercial para gestionar solicitudes de cotización, expedientes de clientes, cotizaciones versionadas, comunicación y aceptación digital para proyectos de construcción de piscinas.

La aplicación conserva la landing pública editorial existente y evoluciona hacia un monolito modular con tres superficies: web pública, portal de cliente y sistema interno.

## Estado actual

La base técnica de Fase 1 está implementada:

- Next.js App Router, React y TypeScript en modo ESM.
- PostgreSQL 16 local mediante Docker Compose.
- Mailpit local para correo de desarrollo.
- Prisma ORM 7.10.0 con adaptador PostgreSQL.
- Validación tipada de entorno con Zod.
- Logs estructurados con redacción de campos sensibles.
- Errores HTTP públicos sin stack traces ni secretos.
- Migración foundation, seed idempotente y endpoint `/api/health`.

Los flujos de identidad, RBAC, clientes, solicitudes, catálogo, cotizaciones, portal y aceptación pertenecen a fases posteriores.

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
npm run test:unit
npm run test:integration
npm run test:content
npm run build
npm run test:e2e
npm run test:e2e:foundation
```

La suite E2E pública conserva el contrato visual, responsive, de interacción, consola y accesibilidad de la landing. La prueba foundation requiere PostgreSQL activo y se ejecuta de forma opt-in.

Para validar una variable necesaria antes de un comando:

```powershell
node scripts/require-env.mjs DATABASE_URL
```

## Estructura relevante

- `src/app/` — rutas de Next.js y API.
- `src/components/` — componentes de la landing pública existente.
- `src/server/` — configuración de entorno, base de datos, errores y logging del servidor.
- `prisma/` — schema, migraciones y seed.
- `tests/unit/` — pruebas unitarias.
- `tests/integration/` — pruebas contra PostgreSQL local.
- `tests/*.spec.ts` — pruebas E2E de Playwright.
- `docs/superpowers/specs/` — diseño aprobado.
- `docs/superpowers/plans/` — planes de implementación ordenados.
- `docs/runbooks/` — procedimientos operativos locales.
- `PROJECT_STATUS.md` — fuente única del avance, decisiones, riesgos y evidencia.

## Alcance de Fase 1

Esta fase establece infraestructura y contratos, no funcionalidades comerciales. Su criterio de terminado incluye instalación reproducible, migración, seed idempotente, health check seguro, pruebas unitarias/integración/E2E y regresión completa de la landing.

La especificación de arquitectura y el orden de fases están en [docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md](docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md).
