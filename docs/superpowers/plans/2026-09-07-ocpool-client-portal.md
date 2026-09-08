# Portal autenticado del cliente — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el primer portal privado de OCPOOL para que un cliente autenticado consulte sólo sus expedientes y cotizaciones versionadas con una experiencia premium, segura y responsive.

**Architecture:** Mantener Next.js App Router y el monolito modular. El módulo `client-portal` derivará el actor desde la sesión existente, exigirá `clientId` en cada consulta y devolverá proyecciones de lectura seguras; las cotizaciones seguirán leyendo snapshots históricos, nunca el catálogo vigente. La UI será una superficie propia de cliente, no una copia del inbox interno.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript ES2023, Prisma 7.10.0/PostgreSQL 16, sesiones persistidas con cookie HttpOnly, Zod, Vitest, Playwright y CSS existente de OCPOOL. No se agrega una dependencia nueva en esta fase.

**Spec:** `docs/superpowers/specs/2026-09-07-ocpool-client-portal.md`

## Global Constraints

- Toda autorización crítica se valida en backend y el actor cliente se deriva de la sesión, nunca del body, query string o folio.
- Un cliente sólo puede leer filas cuyo `clientId` coincida con `actor.clientId`; UUID y folio no son credenciales.
- Las proyecciones no incluyen tokens, hashes, notas internas, logs, secretos ni IDs de otros clientes.
- Las cotizaciones históricas se presentan desde `QuoteLineSnapshot` y sus totales persistidos; no se recalculan desde catálogo.
- Los importes monetarios viajan como cadenas de unidades mínimas y no se convierten a `number` para decisiones.
- Las páginas privadas llevan `noindex`, no se prerenderizan con datos de cliente y manejan sesión expirada sin stack trace.
- Cada tarea termina con pruebas, `git diff --check`, documentación de estado y un commit lógico.

---

## Mapa de archivos y responsabilidades

- `src/server/modules/client-portal/service.ts`: proyecciones de lectura con scope por cliente, serialización y errores públicos.
- `src/app/api/portal/requests/route.ts`: listado autenticado de solicitudes propias.
- `src/app/api/portal/requests/[id]/route.ts`: detalle autenticado de una solicitud propia.
- `src/app/api/portal/quotes/[id]/route.ts`: lectura de cotización propia y sus versiones snapshot.
- `src/app/portal/page.tsx`: metadata privada y entrada visual del portal.
- `src/components/ClientPortalPanel.tsx`: dashboard cliente, navegación, estados y recuperación de sesión.
- `src/app/globals.css`: tokens y layout visual del portal, separado del workspace de staff.
- `tests/unit/client-portal-service.test.ts`: contratos puros de proyecciones y serialización.
- `tests/integration/client-portal-service.test.ts`: aislamiento por cliente, snapshots, sesión y datos privados.
- `tests/integration/client-portal-api.test.ts`: autenticación, autorización, IDOR, errores y no enumeración.
- `tests/client-portal.spec.ts`: E2E opt-in autenticado y estados principales del portal.
- `tests/quality.spec.ts`: regresión pública y protección del portal sin sesión.
- `PROJECT_STATUS.md`: fase, decisiones, pruebas, riesgos y próximo paso.

## Tareas ordenadas

### Tarea 1 — Contrato de alcance y servicio de lectura

**Files:**

- Create: `src/server/modules/client-portal/service.ts`
- Create: `tests/unit/client-portal-service.test.ts`
- Create: `tests/integration/client-portal-service.test.ts`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**

- Consume: `Actor`, `getPrisma`, modelos `QuoteRequest`, `Quote`, `QuoteVersion`, `QuoteLineSnapshot`, dominio monetario de cotizaciones.
- Produce: `listCustomerQuoteRequests(actor, filters, dependencies)` y `getCustomerQuoteRequest(actor, requestId, dependencies)`; ambas sólo aceptan `CUSTOMER` con `clientId` activo.

- [x] Escribir pruebas rojas para actor empleado, actor cliente sin `clientId`, cliente de otro expediente, UUID inválido y serialización de `BigInt`.
- [x] Ejecutar `npx vitest run tests/unit/client-portal-service.test.ts tests/integration/client-portal-service.test.ts` y confirmar que falla por módulo ausente o contrato no implementado.
- [x] Implementar `requireCustomerScope(actor)` que exija `actor.type === 'CUSTOMER'`, `actor.clientId` válido y derive el cliente exclusivamente desde el actor.
- [x] Implementar el listado paginado con estados públicos, folio, proyecto, última actividad y resumen de la versión actual; usar `where: { clientId: actor.clientId }` en la misma consulta.
- [x] Implementar el detalle con request, contact mínimo, detail compartido, quote actual, versiones y líneas snapshot; excluir `createdBy`, asignaciones, notas internas, logs y datos de otros clientes.
- [x] Serializar `budgetCents`, totales, cantidades y precios con `.toString()` y devolver `NOT_FOUND` genérico cuando el UUID no pertenece al cliente.
- [x] Ejecutar las pruebas dirigidas y `npm run typecheck`; verificar que el test de cliente cruzado no revela existencia.
- [x] Registrar la decisión de scope por `clientId`, agregar evidencia a `PROJECT_STATUS.md` y hacer commit `feat: add scoped client portal read service`.

Evidencia de cierre:

- Commit `17a50e9` (`feat: add scoped client portal read service`).
- `listCustomerQuoteRequests` y `getCustomerQuoteRequest` exigen actor `CUSTOMER` con `clientId`, aplican el alcance en backend y devuelven `NOT_FOUND` seguro para expedientes ajenos.
- Las versiones `BORRADOR` y los actores internos no se proyectan al cliente; las líneas snapshot y totales se serializan sin BigInt crudo.
- Verificación dirigida: unit test 1/1, integración 1/1, `npm run typecheck` y `git diff --check` correctos.

### Tarea 2 — API privada y contrato de sesión

**Files:**

- Create: `src/app/api/portal/requests/route.ts`
- Create: `src/app/api/portal/requests/[id]/route.ts`
- Create: `src/app/api/portal/quotes/[id]/route.ts`
- Create: `tests/integration/client-portal-api.test.ts`
- Modify: `src/server/auth/permissions.ts` only if a permission contract is necessary; prefer actor type + scope for self-service.

**Interfaces:**

- Consume: `requireCustomerActor` to be added only if the existing `requireStaffActor` cannot express customer scope; service functions from Tarea 1; `toErrorResponse` and `requestId`.
- Produce: `GET /api/portal/requests`, `GET /api/portal/requests/:id` y `GET /api/portal/quotes/:id`, todos con `cache-control: no-store`.

- [x] Escribir pruebas rojas para 401 sin cookie, 403 con sesión de empleado, 404 genérico para UUID ajeno, folio ajeno, sesión revocada y respuesta sin secretos.
- [x] Ejecutar `npx vitest run tests/integration/client-portal-api.test.ts` y confirmar el fallo esperado antes de crear rutas.
- [x] Crear un guard de actor cliente que use `sessionToken` + `getActorFromSession`, rechace empleados y no acepte `clientId` externo.
- [x] Crear esquemas de query estrictos para `page`, `pageSize` y búsqueda; rechazar parámetros desconocidos, rangos inválidos y cuerpos innecesarios.
- [x] Implementar las tres rutas con `requestId`, `toErrorResponse`, `no-store` y mensajes que no distingan entre recurso ajeno e inexistente.
- [x] Probar que el portal no responde datos aunque se conozca un UUID de otro cliente y que ninguna respuesta contenga token, hash, asignación o actor interno.
- [x] Ejecutar integración, typecheck, lint y `git diff --check`; documentar el contrato API y hacer commit `feat: expose scoped client portal APIs`.

Evidencia de cierre:

- Commit `76214bd` (`feat: expose scoped client portal APIs`).
- `requireCustomerActor` deriva sesión persistida, rechaza sesiones ausentes y empleados, y nunca recibe `clientId` desde el request.
- Las rutas de `/api/portal/requests` y `/api/portal/quotes` son sólo lectura, `no-store`, validan query estricta y usan el envelope público de errores.
- Verificación dirigida: integración API 1/1, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.

### Tarea 3 — Shell visual, autenticación y dashboard

**Files:**

- Create: `src/app/portal/page.tsx`
- Create: `src/components/ClientPortalPanel.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/quality.spec.ts`

**Interfaces:**

- Consume: APIs de portal, cookie de sesión existente, contrato de proyección de Tarea 1 y dirección visual OCPOOL.
- Produce: dashboard `/portal` con header privado, estado de sesión, lista de solicitudes propias y navegación a detalle.

- [x] Escribir la prueba E2E negativa para `/portal` sin sesión y pruebas de accesibilidad/responsive del shell antes de completar la UI.
- [x] Ejecutar la prueba E2E dirigida y confirmar que el acceso sin sesión muestra el estado restringido sin datos.
- [x] Construir un layout de cliente con jerarquía editorial, navegación clara, indicador de sesión y CTA de volver al sitio; no reutilizar `.staff-workspace` como estructura principal.
- [x] Implementar estados de carga con skeleton discreto, vacío explicativo, error recuperable, sesión expirada y lista cargada con folio/estado/proyecto/fecha.
- [x] Añadir `robots: { index: false, follow: false }` y evitar renderizado de datos privados en metadata o HTML estático.
- [x] Verificar teclado, foco visible, hit areas de al menos 44 px, contraste, 360/390/768/1440 px, reduced motion y ausencia de overflow.
- [x] Ejecutar `npm run typecheck`, `npm run lint`, E2E de protección y tests de calidad; hacer commit `feat: add customer portal dashboard`.

Evidencia de cierre:

- El dashboard `/portal` consume exclusivamente las APIs privadas, no contiene datos de cliente en metadata ni renderizado estático y ofrece acceso restringido, carga, vacío, error recuperable, sesión privada, logout y navegación de expedientes.
- La superficie visual usa una estructura propia de cliente, responsive en 360/390/768/1440 px, foco visible, hit areas táctiles, reduced motion y no reutiliza `.staff-workspace` como layout principal.
- La prueba de calidad `protects the customer portal when no customer session exists` pasó 1/1, incluyendo Axe sin violaciones serias y ausencia de overflow horizontal a 390 px.
- `npm run typecheck`, `npm run lint` y `git diff --check` correctos.

### Tarea 4 — Detalle de expediente y cotización versionada

**Files:**

- Modify: `src/components/ClientPortalPanel.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/integration/client-portal-quotes.test.ts` only if the read contract needs a focused snapshot suite.

**Interfaces:**

- Consume: `GET /api/portal/requests/:id`, `GET /api/portal/quotes/:id`, snapshots/totales de Fase 4.
- Produce: vista de expediente propio con alcance compartido, estado, resumen de cotización y versiones históricas de sólo lectura.

- [x] Escribir prueba de regresión para versión enviada con precio de catálogo cambiado después; la vista debe seguir mostrando `QuoteLineSnapshot` histórico.
- [x] Implementar selección de expediente sin confiar en el folio para autorización; cargar detalle sólo por endpoint scopeado.
- [x] Renderizar versión actual y versiones anteriores con moneda, vigencia, líneas, cantidades, descuentos, impuestos, subtotal y total; formatear strings monetarios sin `Number`.
- [x] Mostrar estado vacío cuando aún no hay cotización, historial completo cuando existen varias versiones y mensaje claro cuando la vigencia expiró.
- [x] No mostrar botones de aceptar, firmar, descargar PDF, editar, enviar mensajes ni cambiar estado en esta fase.
- [x] Verificar responsive móvil con líneas apiladas, desktop con resumen lateral, accesibilidad con Axe y navegación por teclado.
- [x] Ejecutar integración/API/E2E dirigida, lint, typecheck y `git diff --check`; hacer commit `feat: show customer quote snapshots`.

Evidencia de cierre:

- La vista de expediente carga por UUID desde el endpoint scopeado; el folio sólo se presenta como dato comercial y no participa en autorización.
- La cotización muestra versión, vigencia, estado, líneas, cantidades, descuentos, impuestos, subtotal y total con unidades monetarias serializadas y formateadas con `BigInt`.
- La vigencia expirada se comunica explícitamente y recibe una señal visual de atención; no se agregaron acciones de aceptación, firma, edición, descarga, mensajería ni cambio de estado.
- La integración `client-portal-service.test.ts` actualiza el concepto de catálogo después de enviar la cotización y confirma que la proyección conserva el nombre y valores históricos de `QuoteLineSnapshot`.
- `npx cross-env RUN_DB_TESTS=1 vitest run tests/integration/client-portal-service.test.ts`, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.

### Tarea 5 — Seguridad negativa y E2E autenticado

**Files:**

- Modify: `tests/integration/client-portal-api.test.ts`
- Modify: `tests/integration/client-portal-service.test.ts`
- Create: `tests/client-portal.spec.ts`
- Create: `tests/a11y.ts`
- Modify: `tests/quality.spec.ts`
- Modify: `src/server/auth/sessions.ts`
- Modify: `src/server/http/errors.ts`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**

- Consume: sesiones reales de cliente, dos clientes fixture, request/quote/versiones, UI de Tareas 1–4.
- Produce: evidencia reproducible de aislamiento, flujo feliz y estados de fallo.

- [x] Crear fixtures desechables de dos clientes con solicitudes aisladas y una cotización para el cliente A; registrar IDs para limpieza exacta.
- [x] Probar 401 sin sesión, 403 empleado, 404/403 seguro para cliente ajeno, sesión revocada, cliente archivado y UUID malformado.
- [x] Probar que el catálogo actualizado no cambia el snapshot mostrado y que un folio ajeno no sirve como acceso.
- [x] Añadir E2E opt-in `PORTAL_E2E=1` con sesión cliente, dashboard, detalle, cotización, refresh y logout; dejarlo omitido en la regresión normal cuando no existan fixtures.
- [x] Añadir E2E de navegación móvil, estado vacío, error de API y no overflow; ejecutar Axe sobre dashboard y detalle.
- [x] Auditar payloads, logs de error y HTML para confirmar ausencia de tokens, hashes, IDs cruzados y stack traces.
- [x] Ejecutar todas las suites dirigidas, limpiar fixtures y hacer commit `test: harden customer portal isolation`.

Evidencia de cierre:

- Commit pendiente de cierre documental: el backend invalida sesiones de clientes con cliente archivado, conserva el 403 de autorización para actores sin scope y mantiene el aislamiento por `clientId`.
- Integración API: 1/1 dirigida y la regresión completa 32/32; se cubrieron 401, 403, 404 no enumerables, UUID malformado, sesión revocada, cliente archivado y respuestas sin secretos.
- Unitarias: 42/42. E2E opt-in: `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2; se verificaron dashboard con snapshot, logout, estado sin cotización, error recuperable, Axe, consola limpia, móvil y ausencia de overflow.
- Los payloads privados y el HTML no contienen `tokenHash`, el token opaco de sesión, stack traces ni el nombre actualizado de catálogo; los fixtures no dejaron usuarios, expedientes, categorías ni conceptos `PORTAL-E2E-*`.
- Se corrigió compatibilidad ESM del import runtime `next/server.js`, contraste WCAG AA de la superficie clara y fechas comerciales en UTC para evitar desplazamientos de vigencia por timezone.

### Tarea 6 — Gate de Fase 5

**Files:**

- Modify: `PROJECT_STATUS.md`
- Modify: `docs/superpowers/plans/2026-09-07-ocpool-client-portal.md`

- [x] Ejecutar `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npm run db:seed` y `npx prisma migrate status`.
- [x] Ejecutar `npm run test:unit`, `npm run test:integration`, `npm run test:content`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` y `npm run test:e2e:foundation`.
- [x] Ejecutar `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` y registrar el resultado separado.
- [x] Ejecutar `npm audit --omit=dev --audit-level=high` y `git diff --check`.
- [x] Revisar que no se hayan agregado dependencias innecesarias, que la regresión pública no se rompa y que el árbol quede limpio tras el commit.
- [x] Actualizar módulos terminados, pruebas, riesgos, deuda y dependencias; cerrar la fase sólo si los criterios de la especificación tienen evidencia.
- [x] Hacer commit `docs: close phase five client portal`.

Evidencia de cierre:

- Migraciones, seed y estado Prisma correctos; no hubo migraciones pendientes.
- `npm test` correcto: 42 unitarias, 32 integraciones, contrato de contenido, build, 34 E2E públicas con 5 omitidas explícitamente y foundation 1/1.
- E2E autenticada separada correcta: `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2.
- `npm audit --omit=dev --audit-level=high` reportó 0 vulnerabilidades; `git diff --check` y árbol limpio.
- No se agregaron dependencias nuevas en Fase 5. Los criterios de alcance, scope, snapshots, privacidad, estados de UI, responsive, accesibilidad y no enumeración tienen evidencia en pruebas y documentación.

## Criterios de terminado de Fase 5

- El cliente autenticado ve sólo solicitudes y cotizaciones de su `clientId`.
- Todas las consultas privadas aplican scope en backend y tienen prueba negativa contra otro cliente.
- Las versiones históricas se presentan desde snapshots persistidos, sin recalcular desde catálogo.
- La UI cubre carga, vacío, error, sesión expirada, restringido, desktop, móvil, teclado y reduced motion.
- Las respuestas no contienen secretos, notas internas, actores internos ni información de otros clientes.
- El portal queda documentado, probado, construido y auditado antes de iniciar mensajería, archivos, PDF o aceptación.
