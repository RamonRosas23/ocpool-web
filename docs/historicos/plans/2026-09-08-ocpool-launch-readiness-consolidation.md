# OCPOOL Launch Readiness Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar una base local repetible para lanzamiento, corregir la contaminación de rate limit en la integración de invitaciones y consolidar evidencia técnica y bloqueos externos sin autorizar publicación.

**Architecture:** Mantener el monolito Next.js, PostgreSQL y los scripts existentes. El cambio de comportamiento queda limitado a los fixtures de integración; la preparación comercial se consolida en documentación verificable y no añade servicios ni dependencias.

**Tech Stack:** TypeScript, Vitest, PostgreSQL/Prisma, scripts Node ESM, Markdown y PowerShell existentes.

**Spec:** `docs/historicos/specs/2026-09-08-ocpool-launch-readiness-consolidation.md`

## Global Constraints

- No modificar los límites ni las reglas productivas de rate limit para hacer pasar la suite.
- `PASS` sólo representa evidencia ejecutada; `WARN` representa omisión no bloqueante; `BLOCKED` conserva exit code distinto de cero.
- No registrar secretos, conexiones, rutas internas, tokens ni cuerpos sensibles.
- No seleccionar proveedores productivos, inventar políticas legales ni publicar el sistema.
- No agregar dependencias, servicios, migraciones ni complejidad que no sean necesarias.
- Mantener el orden documental `spec → review → plan → implementación → verificación → status`.

---

### Task 1: Aislar la integración de invitaciones del rate limit persistido

**Files:**
- Modify: `tests/integration/customer-auth-invitation.test.ts`
- Test: `tests/integration/customer-auth-invitation.test.ts`

**Interfaces:**
- Consumes: `consumeCustomerMagicLink`, `issueCustomerMagicLinkInTransaction` y `fingerprintToken` existentes.
- Produces: fixtures de integración repetibles que no comparten el bucket `customer-magic-link-consume-ip` con ejecuciones anteriores.

- [x] **Step 1: Escribir el caso de aislamiento esperado**

  En cada test que consume un magic link, derivar una dirección de prueba exclusiva a partir del suffix ya generado. Usarla en todas las llamadas de consumo y conservar el contrato de negocio sin desactivar rate limiting.

  ```ts
  const testIpAddress = `2001:db8::${suffix}`;
  ```

- [x] **Step 2: Ejecutar el test dirigido antes del cambio y conservar la evidencia del fallo**

  Run: `npx cross-env RUN_DB_TESTS=1 vitest run tests/integration/customer-auth-invitation.test.ts --maxWorkers=1`

  Expected before the change: reproduce el `consumed.ok === false` cuando el bucket persistido para la IP compartida está bloqueado.

- [x] **Step 3: Implementar el aislamiento mínimo del fixture**

  Reemplazar las IPs literales compartidas de los dos casos por `testIpAddress`. En cada `finally`, borrar sólo el bucket con:

  ```ts
  await prisma.authRateLimit.deleteMany({
    where: {
      scope: 'customer-magic-link-consume-ip',
      keyHash: fingerprintToken(testIpAddress),
    },
  });
  ```

  No borrar toda la tabla, no cambiar `src/server/auth/rate-limit.ts` y no relajar el rate limit.

- [x] **Step 4: Ejecutar el test dirigido después del cambio**

  Run: `npx cross-env RUN_DB_TESTS=1 vitest run tests/integration/customer-auth-invitation.test.ts --maxWorkers=1`

  Expected: 2 tests passed y la segunda ejecución consecutiva produce el mismo resultado.

- [x] **Step 5: Commit lógico**

  ```bash
  git add tests/integration/customer-auth-invitation.test.ts
  git commit -m "test: isolate customer invitation rate limits"
  ```

### Task 2: Consolidar el checklist operativo de lanzamiento

**Files:**
- Create: `docs/runbooks/launch-readiness-checklist.md`
- Modify: `docs/runbooks/production-readiness.md`
- Modify: `README.md`
- Test: `tests/unit/runbook-contract.test.ts`

**Interfaces:**
- Consumes: IDs y estados emitidos por `scripts/production-readiness.mjs`, comandos de `package.json` y runbooks de backup/auth/auditoría.
- Produces: checklist único con alcance, evidencia, dependencia, responsable y criterio de cierre, sin secretos ni afirmaciones de publicación.

- [x] **Step 1: Escribir el contrato documental que debe fallar si falta el checklist**

  Extender `tests/unit/runbook-contract.test.ts` para exigir en `docs/runbooks/launch-readiness-checklist.md` los encabezados `Evidencia local`, `Bloqueos externos`, `No publicar`, `PASS`, `WARN`, `BLOCKED`, `RPO`, `RTO`, `SMTP`, `antivirus`, `retención`, `rollback` y `responsable`. Exigir también que el documento declare que un `PASS` local no autoriza publicar.

- [x] **Step 2: Ejecutar el contrato para confirmar el rojo**

  Run: `npx vitest run tests/unit/runbook-contract.test.ts`

  Expected: falla únicamente porque el checklist nuevo aún no existe.

- [x] **Step 3: Crear el checklist sin inventar decisiones**

  El documento debe incluir:

  - fecha y alcance del preflight;
  - comandos `npm run readiness:production:quick` y `npm run readiness:production:full`;
  - tabla de evidencia local: schema/migraciones, seed, typecheck, unitarias, integración, lint, contenido, auditoría, build, documentación, liveness/readiness y backup/restore local;
  - tabla de controles externos: SMTP/dominio, DNS/TLS/WAF, antivirus/cuarentena, backup externo/RPO/RTO, retención/legal, destino/supervisor/observabilidad/rollback;
  - campos `estado`, `evidencia`, `dependencia`, `responsable`, `fecha de revisión` y `criterio de cierre`;
  - procedimiento de lectura del JSON y regla de exit code;
  - declaración explícita de no publicación mientras exista cualquier `BLOCKED`.

  Los valores desconocidos se marcarán como `BLOCKED — pendiente de decisión/evidencia`, nunca como `PASS`.

- [x] **Step 4: Enlazar el checklist desde los runbooks públicos del repositorio**

  Añadir el enlace desde `docs/runbooks/production-readiness.md` y desde la sección operativa de `README.md`, aclarando que el checklist no contiene credenciales ni crea infraestructura.

- [x] **Step 5: Ejecutar el contrato documental**

  Run: `npx vitest run tests/unit/runbook-contract.test.ts`

  Expected: PASS para todos los contratos del runbook.

- [x] **Step 6: Commit lógico**

  ```bash
  git add docs/runbooks/launch-readiness-checklist.md docs/runbooks/production-readiness.md README.md tests/unit/runbook-contract.test.ts
  git commit -m "docs: consolidate launch readiness checklist"
  ```

### Task 3: Verificar la compuerta completa y actualizar el seguimiento

**Files:**
- Modify: `docs/historicos/plans/2026-09-08-ocpool-launch-readiness-consolidation.md`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**
- Consumes: suite corregida, checklist, scripts de readiness y runbooks existentes.
- Produces: evidencia reproducible de fase, conteos exactos, riesgos actualizados y siguiente paso sin mezclar controles externos con locales.

- [x] **Step 1: Ejecutar la integración completa**

  Run: `npm run test:integration`

  Expected: 42 archivos y 87 pruebas aprobadas, sin fallas de fixture ni contaminación de rate limit.

- [x] **Step 2: Ejecutar la compuerta técnica local**

  Run: `npm run db:validate`

  Expected: schema válido.

  Run: `npm run db:migrate:deploy`

  Expected: migraciones al día.

  Run: `npm run db:seed`

  Expected: seed idempotente.

  Run: `npm run typecheck; npm run lint; npm run test:unit; npm run test:content; npm run build; npm audit --omit=dev --audit-level=high; git diff --check`

  Expected: todos los comandos pasan; auditoría sin vulnerabilidades altas; diff check limpio.

- [x] **Step 3: Ejecutar ambos reportes de readiness**

  Run: `npm run readiness:production:quick`

  Expected: `BLOCKED` con `WARN` técnicos omitidos y bloqueos externos explícitos; exit code distinto de cero.

  Run: `npm run readiness:production:full`

  Expected: controles técnicos reproducibles y bloqueos externos explícitos; cualquier fallo técnico debe investigarse antes de cerrar la fase.

- [x] **Step 4: Marcar el plan con resultados reales**

  Completar cada checkbox y añadir una sección `## Evidencia final` con fecha, conteos exactos de cada comando, fallos encontrados, causa raíz, corrección y lo que queda bloqueado externamente.

- [x] **Step 5: Actualizar `PROJECT_STATUS.md` sin borrar historial**

  Mover la fase actual a Fase 16 cerrada para alcance local sólo si todas las pruebas pasan. Añadir decisiones nuevas, módulos, evidencia, deuda, riesgos y pendientes. Mantener explícito que el producto no está autorizado para lanzamiento mientras exista cualquier control externo `BLOCKED`.

- [x] **Step 6: Commit de cierre documental**

  ```bash
  git add docs/historicos/plans/2026-09-08-ocpool-launch-readiness-consolidation.md PROJECT_STATUS.md
  git commit -m "docs: close launch readiness consolidation"
  ```

## Gate final de la fase

- [x] El test de invitación pasa dos veces consecutivas y limpia únicamente su bucket.
- [x] La integración completa pasa sin contaminación de rate limit.
- [x] El checklist está enlazado, cubierto por contrato y separa evidencia local de bloqueos externos.
- [x] Schema, migraciones, seed, typecheck, lint, unitarias, contenido, build, auditoría y diff check pasan.
- [x] Readiness quick/full conserva salida segura, exit code bloqueante y conteos documentados.
- [x] `PROJECT_STATUS.md`, README y runbooks reflejan la misma realidad.
- [x] El árbol queda limpio y no se afirma autorización de lanzamiento.

## Evidencia final

- La causa raíz del primer fallo fue contaminación del bucket persistido `customer-magic-link-consume-ip` para `127.0.0.1`; se corrigió aislando la IP por caso y limpiando el hash exacto en `finally`.
- `npx cross-env RUN_DB_TESTS=1 vitest run tests/integration/customer-auth-invitation.test.ts --maxWorkers=1` — `2/2`, repetido dos veces consecutivas.
- `npx vitest run tests/unit/runbook-contract.test.ts` — `7/7`.
- `npm run test:integration` — `42 archivos / 87 pruebas` aprobadas.
- `npm run db:validate` — schema válido.
- `npm run db:migrate:deploy` — 17 migraciones, sin pendientes.
- `npm run db:seed` — correcto e idempotente.
- `npm run typecheck` — correcto.
- `npm run lint` — correcto.
- `npm run test:unit` — `31 archivos / 115 pruebas` aprobadas.
- `npm run test:content` — correcto.
- `npm run build` — correcto; rutas esperadas, incluido onboarding staff, presentes.
- `npm audit --omit=dev --audit-level=high` — `0 vulnerabilidades`.
- `npm run readiness:production:quick` — `BLOCKED`, `0 PASS / 2 WARN / 7 BLOCKED`; exit code 1 por bloqueos externos.
- `npm run readiness:production:full` — `BLOCKED`, `11 PASS / 0 WARN / 8 BLOCKED`; los 7 bloqueos externos y `TECH_RUNTIME_POLICY` permanecen explícitos.
- `npm run test:e2e` — `35 passed / 18 skipped` opt-in.
- `npm run test:e2e:foundation` — `2 passed`.
- El backup/restore local sigue requiriendo ejecución operativa explícita en target desechable; no se inventó evidencia de recuperación.
