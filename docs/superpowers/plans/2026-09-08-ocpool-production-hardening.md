# Fase 10 — Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Añadir controles técnicos de runtime, seguridad HTTP, readiness, continuidad y preparación de producción sin convertir decisiones legales o de proveedor en supuestos de código.

**Architecture:** Mantener el monolito Next.js y PostgreSQL como fuente de verdad. Separar validación de configuración de producción del build local, agregar readiness como contrato HTTP independiente y mantener el worker como proceso supervisado externamente. Documentar backups, ciclo de vida y bloqueos de lanzamiento sin añadir servicios que no tengan evidencia de necesidad.

**Tech Stack:** Next.js App Router, TypeScript, Zod, PostgreSQL 16, Prisma 7, Docker Compose, Vitest, Playwright y scripts PowerShell/Node existentes.

**Spec:** `docs/superpowers/specs/2026-09-08-ocpool-production-hardening.md`

## Global Constraints

- No modificar el stack principal ni agregar dependencias sin una necesidad verificable.
- No ejecutar validación de producción contra `.env.example` durante `npm run build` local.
- Nunca incluir secretos, SQL, payloads, tokens, destinatarios, storage keys o stack traces en respuestas, métricas o logs.
- No fijar plazos legales de retención ni ejecutar purgas destructivas por inferencia.
- Todas las mutaciones críticas seguirán autorizadas en backend y protegidas por same-origin cuando corresponda.
- Las pruebas contra PostgreSQL usarán el comando serial oficial `npm run test:integration`.
- Cada tarea termina con pruebas dirigidas, `git diff --check` y un commit lógico.

---

## Task 1: Runtime production policy

**Files:**
- Create: `src/server/security/production-policy.ts`
- Create: `scripts/validate-production-env.mjs`
- Modify: `src/server/env.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/unit/production-policy.test.ts`

**Interfaces:**
- Consumes: `ServerEnv`, `NODE_ENV` y valores de configuración del proceso.
- Produces: `assertProductionPolicy(env: NodeJS.ProcessEnv): ProductionPolicyResult`, con estados `PASS`/`BLOCKED` y códigos públicos de diagnóstico; el script devolverá exit code `0` sólo si no existe bloqueo.

- [ ] Escribir primero las pruebas de producción insegura: `APP_URL` HTTP, claves de ejemplo, SMTP local, storage MinIO, proxy incoherente y configuración válida.
- [ ] Ejecutar `npx vitest run tests/unit/production-policy.test.ts` y confirmar fallos por contrato ausente.
- [ ] Implementar `production-policy.ts` con reglas deterministas, comparación contra valores conocidos de desarrollo y mensajes sin valores originales.
- [ ] Implementar el script Node que cargue `.env`, ejecute la política y emita JSON compacto con `status`, `blockingCodes` y `warnings` sin secretos.
- [ ] Agregar `npm run validate:production` sin reemplazar `npm run build` ni el flujo local.
- [ ] Actualizar `.env.example` con comentarios que separen valores locales de requisitos de producción.
- [ ] Ejecutar las pruebas dirigidas, `npm run typecheck`, `npm run lint` y `git diff --check`.
- [ ] Commit: `feat: add production runtime policy`.

### Criterio de terminado

La política detecta configuraciones de desarrollo con códigos estables, acepta únicamente un conjunto de producción explícitamente seguro y nunca imprime secretos.

## Task 2: HTTP security headers and readiness

**Files:**
- Create: `src/server/security/http-headers.ts`
- Create: `src/app/api/ready/route.ts`
- Modify: `next.config.ts`
- Modify: `src/server/db/health.ts`
- Test: `tests/unit/http-headers.test.ts`
- Test: `tests/unit/readiness.test.ts`
- Test: `tests/integration/readiness-api.test.ts`
- Test: `tests/foundation-health.spec.ts`

**Interfaces:**
- Consumes: `readServerEnv()`, `checkDatabase()` y el entorno de ejecución.
- Produces: `getSecurityHeaders({ production, https })` y `GET /api/ready` con respuesta pública `{ status, requestId, services }`.

- [ ] Escribir pruebas unitarias para headers en local y producción HTTPS; HSTS sólo puede aparecer en el segundo caso y ningún header debe contener secretos.
- [ ] Escribir pruebas de readiness para base disponible, base no disponible, `503`, `requestId` y `cache-control: no-store`.
- [ ] Ejecutar las pruebas dirigidas y confirmar fallos rojos.
- [ ] Implementar el helper de headers con `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva y protección de framing compatible con las superficies actuales.
- [ ] Integrar headers mediante `next.config.ts` sin aplicar cache global a APIs privadas.
- [ ] Implementar `/api/ready` sin cambiar el contrato existente de `/api/health`.
- [ ] Ejecutar integración PostgreSQL serial, E2E foundation, typecheck, lint y `git diff --check`.
- [ ] Commit: `feat: add secure headers and readiness`.

### Criterio de terminado

Un balanceador puede distinguir liveness de readiness, las respuestas son seguras y las cabeceras se aplican de forma consistente sin romper portal, staff, archivos ni PDF.

## Task 3: Continuity runbooks and safe backup verification

**Files:**
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/production-readiness.md`
- Create: `scripts/db-backup.ps1`
- Create: `scripts/db-restore-verify.ps1`
- Modify: `README.md`
- Modify: `docs/runbooks/local-development.md`
- Test: `tests/unit/runbook-contract.test.ts`

**Interfaces:**
- Consumes: Compose PostgreSQL/MinIO, `DATABASE_URL`, migraciones Prisma y el contrato privado de storage.
- Produces: comandos documentados para backup, restauración en destino desechable, verificación de schema/seed y checklist `PASS`/`BLOCKED`/`WARN`.

- [ ] Escribir prueba de contrato que exija secciones de target explícito, confirmación, no producción, verificación de hash/restore, objetos privados y cleanup exacto.
- [ ] Implementar backup PostgreSQL con archivo de salida explícito, creación segura de directorio y nombre timestamped sin incluir credenciales en logs.
- [ ] Implementar restore verify bloqueado por defecto: exige parámetro de archivo, nombre de base local desechable y confirmación literal antes de eliminar/recrear datos.
- [ ] Documentar estrategia de backup de objetos MinIO/S3 sin prometer snapshot productivo que el proveedor no haya confirmado.
- [ ] Documentar retención por clase de dato como matriz de decisiones pendientes, sin plazos inventados ni comando de purga automática.
- [ ] Documentar supervisor externo para el worker, shutdown, recuperación, alertas mínimas y significado de `SENT`.
- [ ] Ejecutar prueba de contrato, revisar comandos en PowerShell y `git diff --check`.
- [ ] Commit: `docs: add continuity and backup runbooks`.

### Criterio de terminado

Un desarrollador puede generar un backup local y verificar una restauración en un destino explícito sin riesgo de borrar una base ambigua; producción queda marcada `BLOCKED` cuando falta proveedor, secreto, retención o destino.

## Task 4: Production gate and phase close

**Files:**
- Create: `scripts/production-readiness.mjs`
- Modify: `package.json`
- Modify: `PROJECT_STATUS.md`
- Modify: `README.md`
- Modify: `docs/runbooks/production-readiness.md`
- Test: `tests/unit/production-readiness.test.ts`
- Test: `tests/integration/production-readiness.test.ts`

**Interfaces:**
- Consumes: `assertProductionPolicy`, migration status, dependency audit output and documented provider/backup decisions.
- Produces: JSON/text report with `PASS`, `BLOCKED`, `WARN`, stable check IDs and safe summaries.

- [ ] Escribir pruebas de reportes PASS/BLOCKED/WARN y de ausencia de secretos, rutas internas o valores completos de conexión.
- [ ] Implementar el gate como agregador de checks, no como bypass de políticas: un bloqueo de configuración siempre produce exit code distinto de cero.
- [ ] Integrar checks técnicos disponibles localmente: env policy, migrations, seed, typecheck, lint, tests, audit, build y documentación.
- [ ] Mantener como `BLOCKED` los checks que requieren decisión externa: legal, proveedor SMTP, DNS autenticado, antivirus, backup externo, retención y destino de despliegue.
- [ ] Ejecutar el gate local, confirmar que el resultado es reproducible y que el output no revela secretos.
- [ ] Ejecutar suite completa proporcional: unitarias, integración serial, E2E dedicadas, typecheck, lint, build, audit y diff check.
- [ ] Actualizar `PROJECT_STATUS.md` con evidencia, pendientes, riesgos, decisiones y siguiente fase.
- [ ] Commit: `docs: add production readiness gate`.

### Criterio de terminado

El gate permite saber exactamente qué está comprobado, qué está bloqueado y qué falta para lanzar; no convierte un entorno local en producción ni elimina los controles legales/operativos pendientes.

## Gate final de Fase 10

- [ ] Todos los commits de Tasks 1–4 existen y el árbol está limpio.
- [ ] `npm run validate:production` bloquea `.env.example` con mensajes seguros.
- [ ] `/api/ready` responde correctamente con PostgreSQL disponible y no disponible.
- [ ] Headers, runbooks, backup verify y gate de readiness tienen cobertura de pruebas.
- [ ] `npm run test:unit`, `npm run test:integration`, `npm run test:content`, E2E seleccionadas, `npm run typecheck`, `npx eslint ...`, `npm run build`, `npm audit --omit=dev --audit-level=high` y `git diff --check` pasan.
- [ ] `PROJECT_STATUS.md` y README distinguen implementación local, bloqueos de producción y próximos pasos.
