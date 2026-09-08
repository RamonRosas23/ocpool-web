# Fase 11 — Dashboard y métricas operativas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un dashboard staff de métricas operativas seguro, acotado y accionable sobre los datos transaccionales existentes, sin introducir una fuente analítica paralela.

**Architecture:** Crear un módulo `analytics` con dominio puro, servicio con autorización, repositorio de agregados parametrizados y una API privada de sólo lectura. La UI `/staff` consumirá esa API y renderizará KPIs, pipeline, carga y salud de notificaciones con CSS existente, sin dependencia de gráficas ni cache global. PostgreSQL seguirá siendo la fuente de verdad; no se añadirá tabla de rollups en esta fase.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, Prisma 7/PostgreSQL 16, Vitest, Playwright, CSS existente y `Intl` nativo para fechas/moneda.

**Spec:** `docs/superpowers/specs/2026-09-08-ocpool-analytics-dashboard.md`

## Global Constraints

- Persistir y consultar fechas en UTC; exponer la zona de negocio explícita en el payload.
- Interpretar rangos como `[from, to)` y limitar el máximo a 93 días.
- Usar `America/Chihuahua` como zona inicial configurable; no permitir que el navegador altere el alcance del servidor.
- Aplicar scope y RBAC en backend antes de agregar; la UI no es frontera de autorización.
- No devolver PII, IDs de cliente, emails, teléfonos, mensajes, archivos, destinatarios, storage keys, SQL, secretos ni stack traces.
- No convertir ni sumar monedas diferentes; serializar importes `BigInt` como strings y tasas como basis points.
- Suprimir métricas temporales y filas de responsable con menos de 5 observaciones identificables.
- No añadir dependencias, Redis, BI, rollups o materialized views sin evidencia y decisión posterior.
- Todas las lecturas serán parametrizadas, acotadas, `no-store` y sin mutaciones comerciales.
- Cada tarea termina con prueba dirigida, typecheck/lint cuando corresponda, `git diff --check` y commit lógico.

---

## Task 1: Contratos puros de métricas y zona horaria

**Files:**
- Create: `src/server/modules/analytics/domain.ts`
- Modify: `src/server/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/analytics-domain.test.ts`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: `Actor` de `src/server/auth/types.ts`, `readServerEnv()` y timestamps UTC.
- Produces: `DashboardQuery`, `DashboardScope`, `MetricSummary`, `WorkloadRow`, `normalizeDashboardQuery()`, `calculateAcceptanceRateBps()`, `calculatePercentileSeconds()` y `agingBucketForSeconds()` para servicio, repositorio y UI.

- [x] **Step 1: Escribir pruebas rojas para rango y zona.**

  Añadir casos que exijan:

  ```ts
  expect(normalizeDashboardQuery({ from: '2026-09-01', to: '2026-09-08', now })).toMatchObject({
    from: expect.any(Date),
    to: expect.any(Date),
    timezone: 'America/Chihuahua',
  });
  expect(() => normalizeDashboardQuery({ from: '2026-09-08', to: '2026-09-01', now })).toThrow();
  expect(() => normalizeDashboardQuery({ from: '2026-01-01', to: '2026-05-01', now })).toThrow();
  ```

  Cubrir también fecha ausente (últimos 30 días completos), timestamp inválido, rango inclusivo/exclusivo y zona inválida.

- [x] **Step 2: Ejecutar las pruebas para confirmar el rojo.**

  Run: `npx vitest run tests/unit/analytics-domain.test.ts tests/unit/env.test.ts`

  Expected: FAIL porque el módulo y el campo de zona todavía no existen.

- [x] **Step 3: Implementar los contratos mínimos.**

  Definir `APP_TIMEZONE` validado por `Intl.DateTimeFormat`, con default `America/Chihuahua`, y exportar:

  ```ts
  export type DashboardScope = 'self' | 'global';
  export type DashboardQueryInput = { from?: string; to?: string; now?: Date; timezone?: string };
  export type DashboardQuery = { from: Date; to: Date; timezone: string; scope: DashboardScope };
  export function normalizeDashboardQuery(input: DashboardQueryInput): DashboardQuery;
  export function calculateAcceptanceRateBps(sent: number, accepted: number): number | null;
  export function calculatePercentileSeconds(values: readonly number[], percentile: 0.5 | 0.9): number | null;
  export function agingBucketForSeconds(seconds: number): '0–1' | '2–3' | '4–7' | '8–14' | '15–30' | '31+';
  ```

  El parser debe usar `[from, to)`, rechazar rangos mayores a 93 días, ordenar y redondear percentiles determinísticamente, devolver `null` sin denominador o muestra y no aceptar `NaN`/fechas futuras fuera de la política.

- [x] **Step 4: Añadir pruebas de cálculos y entorno.**

  Verificar tasa `0/0 -> null`, tasa acotada a `0..10000`, percentiles con valores ordenados/desordenados, muestra insuficiente, buckets en sus límites y `readServerEnv({ ...base, APP_TIMEZONE: 'Invalid/Zone' })` rechazado.

- [x] **Step 5: Ejecutar verificación dirigida.**

  Run: `npx vitest run tests/unit/analytics-domain.test.ts tests/unit/env.test.ts`, `npx tsc --noEmit`, `npx eslint src/server/modules/analytics/domain.ts tests/unit/analytics-domain.test.ts tests/unit/env.test.ts` y `git diff --check`

  Expected: PASS.

- [x] **Step 6: Commit.**

  ```powershell
  git add src/server/modules/analytics/domain.ts src/server/env.ts .env.example tests/unit/analytics-domain.test.ts tests/unit/env.test.ts
  git commit -m "feat: add analytics metric contracts"
  ```

## Task 2: Scope RBAC, repositorio y servicio de agregados

**Files:**
- Modify: `src/server/auth/constants.ts`
- Modify: `tests/unit/auth-permissions.test.ts`
- Create: `src/server/modules/analytics/repository.ts`
- Create: `src/server/modules/analytics/service.ts`
- Test: `tests/integration/analytics-service.test.ts`

**Interfaces:**
- Consumes: contratos de Task 1, `Actor`, `requirePermission`, `getPrisma()`, `getNotificationOperationalHealth()` y modelos existentes de solicitudes/cotizaciones/aceptaciones/notificaciones.
- Produces: `getStaffDashboard(actor: Actor, input: DashboardQueryInput, dependencies?: AnalyticsServiceDependencies): Promise<DashboardResponse>` y un repositorio `readDashboardAggregates(prisma, query: DashboardRepositoryQuery): Promise<DashboardAggregates>` sin datos de contacto ni payloads. `DashboardResponse` y `DashboardAggregates` serán tipos exportados del módulo y seguirán exactamente el contrato de datos de la especificación.

- [x] **Step 1: Escribir pruebas rojas de permiso y alcance.**

  Extender la matriz de permisos para que `sales` tenga `metrics.read`, mientras `manager/admin` tengan además `metrics.read.global` y `customer` no tenga ninguno; crear fixtures de dos empleados, dos clientes, solicitudes asignadas/cruzadas, cotizaciones en distintas monedas, historiales de estado, aceptaciones y notificaciones. Las aserciones deben exigir que sales sólo agregue su `currentAssigneeId` y que manager/admin vean el agregado global.

- [x] **Step 2: Ejecutar integración para confirmar el rojo.**

  Run: `$env:RUN_DB_TESTS='1'; npx vitest run tests/integration/analytics-service.test.ts --maxWorkers=1`

  Result: FAIL inicial por servicio/repositorio ausentes y catálogo RBAC incompleto.

- [x] **Step 3: Implementar scope y proyecciones.**

  Crear funciones internas explícitas:

  ```ts
  function scopeForActor(actor: Actor): DashboardScope;
  function whereForActor(actor: Actor): Prisma.QuoteRequestWhereInput;
  function requireDashboardAccess(actor: Actor): DashboardScope;
  ```

  `sales` filtrará solicitudes y relaciones de cotización por `currentAssigneeId = actor.userId`; sólo `metrics.read.global` habilitará scope global. Un actor no empleado o sin `metrics.read` recibirá `FORBIDDEN` con el envelope existente.

- [x] **Step 4: Implementar agregados parametrizados.**

  El repositorio realizará un número fijo de lecturas agregadas para solicitudes, status history, cotizaciones, quote status history, aceptaciones, usuarios responsables y notificaciones. Usará Prisma agregations o `Prisma.sql` con parámetros, nunca interpolación de fechas/IDs. Las proyecciones incluirán sólo conteos, estados, origen, timestamps agregados, moneda y totales snapshot como `bigint`.

  Reutilizar `getNotificationOperationalHealth()` para la cola actual y añadir una lectura acotada del periodo para fallos; no duplicar su lógica de estado. No consultar `contact`, `email`, mensajes, archivos, `payload`, ciphertext ni `providerMessageId`.

- [x] **Step 5: Implementar el servicio y reglas de supresión.**

  `getStaffDashboard()` validará fechas, scope, dependencia Prisma y `now`; combinará agregados con métricas puras de Task 1; calculará P50/P90, tasa en basis points, buckets y `freshness`; devolverá `suppressed` con valores numéricos `null` cuando la muestra sea menor a 5.

- [x] **Step 6: Ejecutar integración y revisión de consulta.**

  Run: `npm run test:integration`, `npx tsc --noEmit`, `npx eslint src/server/modules/analytics tests/integration/analytics-service.test.ts src/server/auth/constants.ts tests/unit/auth-permissions.test.ts` y `git diff --check`.

  Result: PASS; `npm run test:integration` completó 36 archivos y 68 pruebas. La integración del dashboard verifica aislamiento de empleado, monedas separadas, aceptación, totales snapshot, notificaciones, supresión y ausencia de PII; la revisión del repositorio confirma agregaciones por lote y una única consulta batch de responsables, sin consultas dentro de iteraciones por fila.

- [x] **Step 7: Commit.**

  ```powershell
  git add src/server/auth/constants.ts tests/unit/auth-permissions.test.ts src/server/modules/analytics/repository.ts src/server/modules/analytics/service.ts tests/integration/analytics-service.test.ts
  git commit -m "feat: add scoped analytics service"
  ```

## Task 3: API privada de dashboard

**Files:**
- Create: `src/app/api/staff/dashboard/route.ts`
- Test: `tests/integration/analytics-api.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `getStaffDashboard()`, `requireStaffActor()`, `requestId()`, `toErrorResponse()` y `readServerEnv().APP_TIMEZONE`.
- Produces: `GET /api/staff/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` con `DashboardResponse`, `cache-control: no-store`, alcance y zona visibles.

- [x] **Step 1: Escribir pruebas rojas del contrato HTTP.**

  Probar 401 sin cookie, 403 de customer, 200 para sales/manager, 400 para fechas inválidas/excedidas, `no-store`, `requestId` en errores y respuesta sin PII/SQL/secretos/IDs de cliente.

- [x] **Step 2: Ejecutar la prueba API para confirmar el rojo.**

  Run: `cross-env RUN_DB_TESTS=1 npx vitest run tests/integration/analytics-api.test.ts --maxWorkers=1`

  Expected: FAIL porque la ruta no existe.

- [x] **Step 3: Implementar parser Zod y handler GET.**

  El schema será `.strict()`, aceptará sólo `from` y `to`, normalizará fechas calendario mediante `normalizeDashboardQuery()` y mapeará errores a `toErrorResponse()`. No se aceptará `scope`, `userId`, `clientId`, `timezone`, SQL ni filtros arbitrarios desde el navegador.

- [x] **Step 4: Ejecutar pruebas de seguridad API.**

  Run: `cross-env RUN_DB_TESTS=1 npx vitest run tests/integration/analytics-api.test.ts --maxWorkers=1`, `npx tsc --noEmit`, `npx eslint src/app/api/staff/dashboard/route.ts tests/integration/analytics-api.test.ts` y `git diff --check`.

  Result: PASS con 2 pruebas de integración, payload seguro, autorización backend, fechas acotadas, query estricta y errores públicos con `requestId`; el gate global quedó en 37 archivos y 70 pruebas, con build, lint y typecheck verdes.

- [x] **Step 5: Documentar el endpoint.**

  Añadir a README el endpoint, rango máximo, scope por rol, `no-store` y la advertencia de que las métricas no son contabilidad ni autorización comercial.

- [x] **Step 6: Commit.**

  ```powershell
  git add src/app/api/staff/dashboard/route.ts src/server/modules/analytics/service.ts tests/integration/analytics-api.test.ts README.md docs/superpowers/plans/2026-09-08-ocpool-analytics-dashboard.md
  git commit -m "feat: expose staff analytics dashboard API"
  ```

## Task 4: Dashboard staff responsive

**Files:**
- Create: `src/app/staff/page.tsx`
- Create: `src/components/StaffDashboardPanel.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/dashboard.spec.ts`

**Interfaces:**
- Consumes: `GET /api/staff/dashboard`, `DashboardResponse` serializado, `Link` y patrones visuales de `StaffRequestsPanel`/`StaffNotificationsPanel`.
- Produces: `/staff` como superficie de lectura operativa con KPI strip, alertas, pipeline, timing, workload y salud de notificaciones.

- [x] **Step 1: Escribir la E2E roja de navegación y estados.**

  Crear casos para página sin sesión, dashboard de sales con datos propios, manager con vista global, loading/error/empty, cambio de preset, navegación a solicitudes/notificaciones, 390/768/1440 px y Axe.

- [x] **Step 2: Ejecutar E2E para confirmar el rojo.**

  Run: `npx playwright test tests/dashboard.spec.ts`

  Result: FAIL esperado porque `/staff` y el componente todavía no existían; la prueba dejó fijados sesión restringida, sesión staff, estado vacío, accesibilidad, responsive, reduced motion y consola.

- [x] **Step 3: Crear la página y panel sin gráficas externas.**

  La página sólo declarará metadata privada y renderizará `StaffDashboardPanel`. El panel gestionará `AbortController`, carga, error recuperable, acceso restringido, rango, reintento y response typing; no realizará consultas directas a Prisma ni decidirá permisos.

- [x] **Step 4: Implementar la jerarquía visual.**

  Añadir encabezado staff, periodo/zona/frescura, cuatro KPIs, alertas accionables, barras CSS con texto accesible, tabla de responsables sólo cuando venga `scope: global`, salud de notificaciones y enlaces contextuales. Los importes usarán `Intl.NumberFormat` por moneda; nunca `Number()` sobre importes menores.

- [x] **Step 5: Completar estados responsive y accesibilidad.**

  Cubrir skeleton estable, `role=status`, `role=alert`, estado vacío, datos parciales, foco visible, etiquetas de gráficos, contraste AA, reduced motion, no overflow y targets táctiles. Las animaciones serán discretas y no bloquearán lectura.

- [x] **Step 6: Ejecutar E2E y lint visual.**

  Run: `npx playwright test tests/dashboard.spec.ts`, `npx tsc --noEmit`, `npx eslint src/app/staff/page.tsx src/components/StaffDashboardPanel.tsx tests/dashboard.spec.ts`, `npm run build` y `git diff --check`.

  Result: PASS; `DASHBOARD_E2E=1 npm run test:e2e -- tests/dashboard.spec.ts` pasó 1/1. La E2E verificó 401 visual, sesión manager, periodo histórico vacío, Axe sin violaciones serious/critical, 390/768/1440 sin overflow, reduced motion, navegación contextual y ausencia de errores de consola autenticados. `npm run typecheck`, `npm run lint`, `npm run build` y `git diff --check` también pasaron. La primera corrida encontró una condición de carrera de rango y contrastes WCAG insuficientes; ambos fueron corregidos y verificados.

- [ ] **Step 7: Commit.**

  ```powershell
  git add src/app/staff/page.tsx src/components/StaffDashboardPanel.tsx src/app/globals.css tests/dashboard.spec.ts
  git commit -m "feat: add staff analytics dashboard"
  ```

## Task 5: Rendimiento, documentación operativa y revisión de seguridad

**Files:**
- Create: `docs/runbooks/analytics-dashboard.md`
- Create: `tests/unit/analytics-serialization.test.ts`
- Create: `src/server/modules/analytics/serialization.ts`
- Modify: `README.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `docs/superpowers/specs/2026-09-08-ocpool-analytics-dashboard.md` only if the implementation reveals a verified contract correction.

**Interfaces:**
- Consumes: API, servicio, consultas y E2E de Tasks 1–4.
- Produces: runbook de definiciones/frescura/zonas/performance, evidencia de serialization segura y registro de riesgos/decisiones.

- [x] **Step 1: Escribir pruebas rojas de serialización y contenido.**

  Exigir que `BigInt` viaje como string, tasas como enteros, monedas permanezcan separadas, `suppressed` oculte valores, JSON no contenga PII/secretos y documentación enumere las métricas con fuente y límites.

- [x] **Step 2: Implementar serialización y runbook.**

  Centralizar el mapper de respuesta para no repetir conversiones; documentar definiciones, `[from,to)`, `APP_TIMEZONE`, scope, supresión `<5`, frescura, objetivo P95, ausencia de cache global y procedimiento para revisar `EXPLAIN` sin incluir datos sensibles.

  Result: la prueba roja confirmó el import faltante; `serializeDashboardResponse()` ahora concentra `BigInt`→string, basis points, supresión, actor key opaca y fechas. `docs/runbooks/analytics-dashboard.md` documenta definiciones, scope, zona, seguridad, diagnóstico y comandos reproducibles.

- [x] **Step 3: Ejecutar rendimiento y seguridad.**

  Run: `npm run db:validate`, `npx prisma migrate status`, `npm run db:seed`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm audit --omit=dev --audit-level=high` y `git diff --check`.

  Result: `npm run db:validate`, `npx prisma migrate status`, `npm run db:seed`, `npm run test:unit` (99/99), `npm run test:integration` (37 archivos/70 pruebas), `npm run test:content`, typecheck, lint, `npm run build`, `npm audit --omit=dev --audit-level=high` (0 vulnerabilidades) y diff check pasaron. Se ejecutaron cuatro `EXPLAIN (ANALYZE, BUFFERS)` sobre el volumen local (44 solicitudes/80 entregas); los scans secuenciales tardaron 0.043–0.173 ms por el tamaño actual, por lo que no se agregó un índice especulativo. La revisión de volumen representativo queda en el gate antes de introducir rollups.

- [x] **Step 4: Actualizar seguimiento.**

  Registrar en `PROJECT_STATUS.md` fase, módulos, dependencias, pruebas, riesgos, decisión de no usar rollups, estado del gate y siguiente fase. Mantener explícito que dashboard no es BI ni readiness de producción.

  Result: `PROJECT_STATUS.md` actualizado con fase actual, commits, módulos, decisiones 106–111, pruebas, riesgos de P95/zona, dependencias, problemas resueltos y próximo gate.

- [ ] **Step 5: Commit.**

  ```powershell
  git add docs/runbooks/analytics-dashboard.md tests/unit/analytics-serialization.test.ts README.md PROJECT_STATUS.md
  git commit -m "docs: document analytics operations"
  ```

## Task 6: Gate completo de Fase 11

**Files:**
- Modify: `docs/superpowers/plans/2026-09-08-ocpool-analytics-dashboard.md`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**
- Consumes: todos los módulos, pruebas y runbooks de Tasks 1–5.
- Produces: evidencia final y árbol limpio; no produce funcionalidades nuevas.

- [ ] **Step 1: Ejecutar el gate técnico completo.**

  Run: `npm run db:validate`, `npx prisma migrate status`, `npm run db:seed`, `npm run test:unit`, `npm run test:integration`, `npm run test:content`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`, `npm run test:e2e:foundation`, `npm audit --omit=dev --audit-level=high` y `git diff --check`.

  Expected: PASS; los tests opt-in deben ejecutarse o quedar documentados con su razón exacta y evidencia dedicada.

- [ ] **Step 2: Revisar regresiones de seguridad.**

  Confirmar 401/403/IDOR, scope sales/global, rango máximo, supresión, no-store, no PII, no secretos, no SQL, no N+1 observable y respuesta segura ante error de base de datos.

- [ ] **Step 3: Actualizar plan y estado.**

  Marcar sólo pasos con evidencia; registrar pruebas ejecutadas/faltantes, problemas/resoluciones, riesgos abiertos y criterios de terminado. El árbol no se marca limpio hasta confirmar `git status --short` vacío.

- [ ] **Step 4: Commit de cierre.**

  ```powershell
  git add docs/superpowers/plans/2026-09-08-ocpool-analytics-dashboard.md PROJECT_STATUS.md
  git commit -m "docs: close analytics dashboard phase"
  ```

### Gate final

- [ ] El dashboard staff funciona en `/staff` con estados completos y metadata `noindex`.
- [ ] Sales sólo ve su alcance; manager/admin ven scope global; customer no accede.
- [ ] Todas las métricas tienen definición, fuente, zona, periodo y muestra.
- [ ] No existe PII, secreto, SQL, IDOR o mutación desde dashboard.
- [ ] Consultas parametrizadas, acotadas, sin N+1 y con evidencia de rendimiento.
- [ ] Unitarias, integración, E2E, typecheck, lint, build, auditoría y diff check pasan.
- [ ] README, runbook, PROJECT_STATUS y plan están actualizados; el árbol está limpio.
