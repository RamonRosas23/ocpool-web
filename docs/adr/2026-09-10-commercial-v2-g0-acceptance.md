# Aceptación de Gate G0 — Experiencia Comercial V2

**Estado:** `PARTIAL_PRODUCT_SIGNOFF`
**Fecha de apertura:** 2026-09-10  
**Owner técnico:** Codex/arquitectura  
**Aprobador de producto:** autorización explícita recibida en la tarea del 2026-09-11
**Regla:** una casilla no aprobada no se interpreta como aprobada por silencio.

Este artefacto registra el gate del [plan maestro V2](../ocpool-commercial-v2/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md). Las decisiones de negocio, fiscalidad y legalidad sólo las puede cerrar el responsable correspondiente.

## G0-01 — Contrato canónico

| Control | Resultado técnico | Evidencia | Aprobación producto |
| --- | --- | --- | --- |
| ADR de ownership/estados/eventos | `VERIFIED_LOCAL` | [ADR](2026-09-10-commercial-lifecycle-v2.md) | `APPROVED` — autorización explícita 2026-09-11 |
| Inventario actual y legacy | `VERIFIED_LOCAL` | [fixture](../../tests/fixtures/commercial-workflow-v2.ts) | `APPROVED` — autorización explícita 2026-09-11 |
| Tabla de verdad validable | `VERIFIED_LOCAL` | [prueba de contrato](../../tests/unit/commercial-workflow-contract.test.ts) | `APPROVED` — autorización explícita 2026-09-11 |
| Pruebas del contrato | `PASS` — 7 pruebas | `npx vitest run tests/unit/commercial-workflow-contract.test.ts` | `APPROVED` — autorización explícita 2026-09-11 |

## G0-02 — Política comercial, fiscal, scope y legal

| Control | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Decisiones de producto | `APPROVED_PRODUCT` — BIZ-01, BIZ-02, BIZ-05…BIZ-08, BIZ-11…BIZ-14 | [ADR de política](2026-09-10-commercial-policy-v1.md), acta 2026-09-11 | `APPROVED` para slices locales |
| Política fiscal | `BLOCKED_FISCAL` — BIZ-03 y BIZ-04 no inventan perfiles, tasas ni tratamiento | [ADR de política](2026-09-10-commercial-policy-v1.md) | `BLOCKED` hasta fiscalía |
| Firmante y términos | `BLOCKED_LEGAL` — BIZ-09 y BIZ-10 no inventan autorización ni copy jurídico | [ADR de política](2026-09-10-commercial-policy-v1.md) | `BLOCKED` hasta jurídico |

## G0-03 — Baseline de tareas y datos

| Control | Resultado técnico | Evidencia | Aprobación producto |
| --- | --- | --- | --- |
| Superficies, viewports y observaciones actuales | `VERIFIED_LOCAL_PARTIAL` — baseline público + privado 24/24 y superficies clasificadas | [ADR de baseline](2026-09-10-commercial-g0-baseline.md) | `PENDING` |
| Escenarios y perfiles de volumen | `PASS` — 10 escenarios / 4 perfiles | [fixture](../../tests/fixtures/commercial-baseline-v2.ts) | `PENDING` |
| Diccionario de métricas y reglas de privacidad | `PASS` — 13 métricas, una por escenario y transversales, con campos prohibidos explícitos | [prueba de contrato](../../tests/unit/commercial-baseline-contract.test.ts) | `PENDING` |
| Medición autenticada y objetivos numéricos | `VERIFIED_LOCAL_PARTIAL` — 65 registros PII-safe (`13 métricas × n=5`) en corridas independientes: pública, solicitudes, cotizador, portal y notificaciones; objetivos de §29 aprobados sólo para evidencia local; piloto real y aceptación estadística siguen pendientes | [ADR de baseline](2026-09-10-commercial-g0-baseline.md) / [ADR de objetivos](2026-09-11-commercial-g0-03-objectives.md) | `APPROVED_LOCAL_PARTIAL` |
| Recorrido de navegador anónimo | `PASS` — 24/24 combinaciones, sin overflow ni errores inesperados; 401/403 esperados clasificados | [evidencia](../ocpool-commercial-v2/g0-03-browser-baseline.md) / [script](../../scripts/commercial-baseline-browser.mjs) | `PENDING` |
| Baseline HTTP complementario | `PASS` — 10/10 rutas, sin 5xx ni `X-Powered-By`; health/readiness `no-store` | [script](../../scripts/commercial-baseline-http.mjs) / `npm run baseline:v2:http` | `PENDING` |
| E2E autenticada desechable | `PASS` — 5/5 con fixtures creados/limpiados | `AUTH_SURFACES_E2E=1 E2E_PORT=3110 APP_URL=http://127.0.0.1:3110 npm run test:e2e -- tests/auth-surfaces.spec.ts` | `PENDING` |
| Flujos comerciales autenticados críticos | `PASS` — 3/3 en corrida conjunta: portal completo, recuperación móvil y cotizador hasta PDF; expansión adicional PASS: onboarding 2/2, dashboard 1/1, catálogo/precios 1/1, notificaciones 1/1, auditoría 1/1, mensajería staff 2/2 e identidad API 1/1; matriz cruzada completa `17/17` | `PORTAL_E2E=1 QUOTES_E2E=1 E2E_PORT=3120 APP_URL=http://127.0.0.1:3120 npx playwright test tests/client-portal.spec.ts tests/quotes.spec.ts`; suites ampliadas por separado y corrida cruzada `AUTH_SURFACES_E2E=1 PORTAL_E2E=1 QUOTES_E2E=1 CUSTOMER_ONBOARDING_E2E=1 DASHBOARD_E2E=1 STAFF_MESSAGING_E2E=1 AUDIT_E2E=1 AUTH_E2E=1 CATALOG_E2E=1 E2E_PORT=3149 APP_URL=http://127.0.0.1:3149 npx playwright test tests/auth-surfaces.spec.ts tests/client-portal.spec.ts tests/quotes.spec.ts tests/customer-onboarding.spec.ts tests/dashboard.spec.ts tests/staff-notifications.spec.ts tests/client-messaging-staff.spec.ts tests/audit.spec.ts tests/auth.spec.ts tests/catalog.spec.ts` | `PENDING` |

## G0-04 — Arquitectura visual y primitives

| Control | Resultado técnico | Evidencia | Aprobación producto/frontend |
| --- | --- | --- | --- |
| Inventario de primitives privadas | `VERIFIED_LOCAL` — Select, DatePicker, Dialog y Tabs inventariados; ComboBox permanece aislado y no es necesario en rutas actuales | [ADR de primitives](2026-09-10-private-ui-primitives.md) | `APPROVED` — autorización explícita 2026-09-11 |
| Spike comparativo y mediciones | `VERIFIED_LOCAL` — prototipo pasó 3 viewports, teclado, focus restore, relaciones semánticas, overflow, Axe, SSR/hidratación aislados y formato MXN es-MX; Next.js anónimo pasó 12/12 con `lang="es-MX"` y sin warnings inesperados | [ADR de primitives](2026-09-10-private-ui-primitives.md) / [ADR de locale](2026-09-10-private-locale.md) / [`spike`](../../spikes/private-primitives-react-aria/README.md) | `APPROVED` — autorización explícita 2026-09-11 |

## G0-05 — Flags, gate local y landing congelada

| Control | Resultado técnico | Evidencia | Aprobación ingeniería/producto |
| --- | --- | --- | --- |
| Flags server-side fail-closed | `PASS` — aprobación global + flags individuales explícitas | [módulo](../../src/server/flags/commercial-v2.ts) / [pruebas](../../tests/unit/commercial-v2-flags.test.ts) | `APPROVED` — autorización explícita 2026-09-11 |
| Gate técnico reproducible | `PASS_WITH_BLOCKED_EXIT` — typecheck, lint, 139 unitarias, contenido y baseline HTTP 10/10 verdes; bloquea cierre si faltan gates de producto | [script](../../scripts/quality-gate-v2.mjs) / `APP_URL=http://127.0.0.1:3188 npm run test:v2:gate` | `APPROVED_LOCAL` |
| Browser baseline, hash y kill switch de landing | `VERIFIED_LOCAL` — browser baseline 24/24, manifiesto de hashes en tres breakpoints y rollback fail-closed documentado; la landing conserva `lang="es"` | [manifiesto](../ocpool-commercial-v2/landing-freeze.json) / [procedimiento](../ocpool-commercial-v2/landing-freeze.md) | `APPROVED` — autorización explícita 2026-09-11 |

## Excepción S0-01 — Contención de visibilidad legacy

| Control | Resultado técnico | Evidencia | Aprobación ingeniería/producto |
| --- | --- | --- | --- |
| No exponer working interna al customer | `VERIFIED_LOCAL` — portal/PDF/aceptación seleccionan estados públicos | [ADR S0-01](2026-09-10-s0-01-legacy-portal-visibility.md) | `PENDING` |
| Regresión cross-surface | `PASS` — 4 integraciones dirigidas | portal, aceptación y PDF | `PENDING` |

Esta excepción no cierra G0 ni autoriza S0-02…S0-04.

## Verificación local de verticales S0 permitidos por integridad

| Vertical | Resultado técnico | Evidencia | Estado de gate/negocio |
| --- | --- | --- | --- |
| S0-02 snapshot financiero | `IMPLEMENTED_LOCAL` — precio aplicado se rehidrata desde la línea persistida y no se repricia por cambio de catálogo; E2E 1/1 | [constructor](../../src/components/StaffQuotesPanel.tsx) / [prueba](../../tests/quotes.spec.ts) | `PENDING`; falta comparación staff/portal/PDF y aprobación de objetivos |
| S0-03 acciones server-owned | `IMPLEMENTED_LOCAL` — backend proyecta transiciones/acciones y la UI consume esa proyección; integración 7/7 y E2E 1/1 | [servicio](../../src/server/modules/quote-requests/staff-service.ts) / [panel](../../src/components/StaffRequestsPanel.tsx) / [pruebas](../../tests/integration/quote-requests-staff.test.ts) | `PENDING`; falta matriz completa y cierre de Gate G0 |
| S0-04 PDF/términos | `IMPLEMENTED_LOCAL_PARTIAL` — preflight, términos server-owned y P0-08 del renderer v2 contenidos; alcance completo paginado y logo oficial | [ADR PDF](2026-09-11-quote-publication-preflight.md) / [ADR términos](2026-09-11-quote-terms-server-owned.md) / [renderer](../../src/server/modules/quote-documents/pdf-renderer.ts) | `BLOCKED` por BIZ-10, plantilla comercial completa y recuperación operativa |

Estos resultados son evidencia local y no autorizan flags, rollout ni publicación.

## Validación local registrada

- `npm run typecheck` — `PASS`.
- `npm run lint` — `PASS`.
- `npm run test:unit` — `PASS`, 34 archivos / 139 pruebas.
- `npm run test:content` — `PASS`.
- `npm run spike:private-primitives` — `PASS`, baseline estático reproducible de Radix/react-day-picker y wrappers privados; React Aria/Lucide sólo se evalúan en el prototipo aislado y permanecen sin adoptar.
- `npm run --prefix spikes/private-primitives-react-aria build` — `PASS`, bundle aislado 569.93 kB JavaScript/175.31 kB gzip y 4.10 kB CSS/1.36 kB gzip.
- `PLAYWRIGHT_EXECUTABLE_PATH=... SPIKE_URL=http://127.0.0.1:4174 npm run --prefix spikes/private-primitives-react-aria check` — `PASS`, 3/3 viewports (360/768/1440), sin overflow, errores de consola/página, peticiones fallidas ni Axe serio/crítico.
- `PLAYWRIGHT_EXECUTABLE_PATH=... npm run --prefix spikes/private-primitives-react-aria check:ssr` — `PASS`, HTML SSR de 9,862 bytes e hidratación en Chromium con `renderMode: "hydration"`, formato MXN `es-MX`, sin warnings/errors ni peticiones fallidas; aún es un smoke aislado, no una ruta Next.js.
- `APP_URL=http://127.0.0.1:3008 PLAYWRIGHT_EXECUTABLE_PATH=... npm run --prefix spikes/private-primitives-react-aria check:next` — `PASS`, 12/12 rutas Next.js anónimas en 390/1440 px, HTML 200, sin overflow, errores de página, peticiones fallidas ni warnings inesperados; `401` privados esperados; registra `lang="es"` como gap de locale pendiente.
- `APP_URL=http://127.0.0.1:3008 npm run test:v2:gate` — `BLOCKED` intencional (exit 2); typecheck, lint, 34 archivos/137 unitarias, contenido y baseline HTTP 10/10 pasan antes del bloqueo de signoffs, revisión final de primitives/locale y gates de diseño.
- `npx vitest run tests/unit/commercial-baseline-contract.test.ts tests/unit/commercial-workflow-contract.test.ts` — `PASS`, 2 archivos / 13 pruebas.
- `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000 --reporter=dot` — `PASS`, 42 archivos / 88 pruebas serializadas; los logs 401/403/404/409/429 son negativos esperados y los avisos de Node 20/AWS SDK y pg no son fallos.
- `npx vitest run tests/unit/client-portal-service.test.ts tests/unit/quote-documents-domain.test.ts` — `PASS`, 2 archivos / 6 pruebas.
- `npx vitest run tests/integration/quote-documents-api.test.ts tests/integration/quote-acceptance-service.test.ts tests/integration/client-portal-service.test.ts --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000` — `PASS`, 3 archivos / 4 pruebas.
- `git diff --check` — `PASS` antes del commit de esta tarea.
- `PLAYWRIGHT_EXECUTABLE_PATH=/var/tmp/ocpool-playwright/chromium-1234/chrome-linux64/chrome PLAYWRIGHT_VIDEO=off REQUESTS_E2E=1 ... npx playwright test tests/requests.spec.ts` — `PASS`, 1/1; responsive 390/768/1440, sin overflow, Axe serio ni errores de consola.
- `PLAYWRIGHT_EXECUTABLE_PATH=/var/tmp/ocpool-playwright/chromium-1234/chrome-linux64/chrome PLAYWRIGHT_VIDEO=off QUOTES_E2E=1 ... npx playwright test tests/quotes.spec.ts` — `PASS`, 1/1; el precio histórico permanece en `150.00` aunque cambie el catálogo.
- `npx vitest run tests/unit/quote-pdf-renderer.test.ts --maxWorkers=1` — `PASS`, 4/4; logo oficial, metadata determinista, paginación de líneas y alcance extenso sin truncamiento.
- `RUN_DB_TESTS=1 npx vitest run tests/integration/quote-pdf-service.test.ts tests/integration/quote-documents-api.test.ts --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000` — `PASS`, 2 archivos / 3 pruebas; generación, descarga y publicación con PDF listo.
- `NEXT_DIST_DIR=.next-verify-v2 npm run build` — `PASS` (baseline previo); `NEXT_DIST_DIR=.next-verify-s0c npm run build` — `PASS` con permisos, `pdfReady`, acciones customer y notificación de aceptación de S0-01; los directorios aislados fueron eliminados después de verificar y el build activo no se tocó.
- `NEXT_DIST_DIR=.next-verify-catalog npm run build`, `NEXT_DIST_DIR=.next-verify-tabs npm run build` y `NEXT_DIST_DIR=.next-verify-final-tabs npm run build` — `PASS`; los builds compilaron las correcciones de catálogo/pestañas en directorios aislados, que fueron eliminados después, sin tocar `.next` activo.
- `npm audit --omit=dev --audit-level=high` — `PASS`, 0 vulnerabilidades altas.
- `npm run db:validate` y `npx prisma migrate status` — `PASS`, schema válido y 20 migraciones aplicadas.
- S0-01 no modifica schema, migraciones, permisos ni landing; sí endurece la proyección customer de portal/PDF/aceptación para no exponer working versions internas. S0-02, S0-03 y el contenedor P0-08 de S0-04 sí tienen cambios locales de integridad ya verificados, pero permanecen fuera de activación hasta el cierre del gate.

## Decisión requerida

El responsable de producto debe registrar una de estas decisiones en este mismo archivo, con nombre/rol y fecha UTC:

- `APPROVED`: el contrato canónico pasa a ser la base de D1/D2;
- `REJECTED`: indicar la decisión concreta que debe corregirse y mantener G0-01 bloqueado;
- `BLOCKED`: indicar autoridad o información externa faltante.

Hasta entonces, G0-01 permanece `VERIFICADO_LOCAL`, no `CERRADO`, y el Gate G0 no puede superarse.
