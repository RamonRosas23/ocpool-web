# Fase 12 — Auditoría operativa y seguridad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer una superficie interna segura para investigar la actividad operativa y, únicamente para administradores, eventos de seguridad, sin filtrar PII, secretos, identificadores internos ni metadata cruda.

**Architecture:** Se reutilizarán `AuditLog` y `AuthEvent` como fuentes de verdad. El dominio normalizará filtros y cursor; el repositorio hará lecturas acotadas con una selección mínima y un batch de actores; el servicio aplicará RBAC, rate limit y redacción por acción; la API y la UI consumirán exclusivamente el contrato proyectado. No se añadirá una tabla paralela ni una dependencia nueva en esta fase.

**Tech Stack:** Next.js App Router, React, TypeScript estricto, Zod, Prisma/PostgreSQL, `node:crypto` para HMAC, Vitest, Playwright, axe y CSS existente de staff.

**Spec:** `docs/historicos/specs/2026-09-08-ocpool-audit-observability.md`

## Global Constraints

- El intervalo de consulta será `[from,to)` y tendrá un máximo de 93 días.
- El orden será `createdAt DESC, id DESC` y la paginación será cursor-based, estable y opaca.
- `audit.read` sólo habilitará actividad operativa para `manager` y `admin`; `audit.security.read` habilitará `AuthEvent` sólo para `admin`.
- Nunca se devolverán `metadata` cruda, `entityId`, `actorUserId`, `identifierHash`, IP, user-agent, correo, teléfono, payload, storage key, hash de documento ni ciphertext.
- La API será `no-store`, tendrá rate limit por actor y validación `.strict()`.
- No se implementarán exportación, purga, retención automática, SIEM, alertas en tiempo real ni modificación de eventos.
- No se instalarán dependencias nuevas salvo que una prueba de compatibilidad demuestre que las existentes no cubren el contrato.
- Cada tarea termina con pruebas y un commit lógico; `PROJECT_STATUS.md` sólo marcará una tarea/módulo como terminado con evidencia verificable.

## Mapa de archivos y responsabilidades

- Crear `src/server/modules/audit/domain.ts`: tipos públicos internos, categorías, acciones allowlisted, parser de filtros, cursor HMAC, límites y proyección segura.
- Crear `src/server/modules/audit/repository.ts`: lecturas Prisma de `AuditLog`/`AuthEvent`, joins/selects mínimos y batch de actores sin consultas por fila.
- Crear `src/server/modules/audit/service.ts`: permiso, selección de fuente, rate limit, consulta, proyección y envelope de respuesta.
- Crear `src/app/api/staff/audit/route.ts`: query string estricta, actor de sesión, errores públicos y `cache-control: no-store`.
- Crear `src/components/StaffAuditPanel.tsx`: filtros, lista, estados de carga/vacío/error/restringido y paginación accesible.
- Crear `src/app/staff/audit/page.tsx`: shell staff y composición del panel.
- Modificar `src/server/auth/constants.ts`: catálogo y asignación de `audit.read`/`audit.security.read`.
- Modificar `src/server/env.ts` y `.env.example`: `AUDIT_CURSOR_SECRET` y límites de lectura de auditoría.
- Modificar navegación/estilos staff existentes sólo donde sea necesario para el acceso visible y la composición responsive.
- Crear `tests/unit/audit-domain.test.ts`, `tests/unit/audit-serialization.test.ts`, `tests/integration/audit-service.test.ts`, `tests/integration/audit-api.test.ts` y `tests/audit.spec.ts`.
- Crear `docs/runbooks/audit-observability.md` y actualizar `README.md`/`PROJECT_STATUS.md` al cerrar la fase.

### Task 1: Contratos de dominio, redacción y cursor

**Files:**
- Create: `src/server/modules/audit/domain.ts`
- Create: `tests/unit/audit-domain.test.ts`
- Create: `tests/unit/audit-serialization.test.ts`
- Modify: `src/server/env.ts`
- Modify: `.env.example`

**Interfaces:**
- `AuditCategory = 'commercial' | 'communication' | 'documents' | 'notifications' | 'security'`.
- `AuditQueryInput = { from?: string; to?: string; category?: AuditCategory; outcome?: AuditOutcome; cursor?: string; limit?: number }`.
- `AuditQuery = { from: Date; to: Date; timezone: string; category: AuditCategory | null; outcome: AuditOutcome | null; limit: number; cursor: AuditCursor | null }`.
- `AuditCursor = { version: 1; source: 'operational' | 'security'; from: string; to: string; category: AuditCategory | null; outcome: AuditOutcome | null; limit: number; createdAt: string; id: string }`.
- `AuditEntry = { eventKey: string; occurredAt: string; category: AuditCategory; action: string; outcome: AuditOutcome; actorLabel: string; actorKey: string | null; entityLabel: string; details: Array<{ label: string; value: string }> }`.
- `normalizeAuditQuery(input, options): AuditQuery`, `encodeAuditCursor(cursor, secret): string`, `decodeAuditCursor(raw, secret, expected): AuditCursor` y `projectAuditMetadata(action, metadata): details`.

- [ ] **Step 1: Escribir pruebas de dominio que fallen.** Cubrir fecha ausente por default, intervalo `[from,to)`, límite 1–50, máximo 93 días, futuro, outcome/categoría inválidos, cursor alterado, cursor de otro rango/categoría, cursor con firma incorrecta, cursor de versión desconocida y metadata sensible descartada. Incluir una metadata con `email`, `phone`, `ipAddress`, `userAgent`, `tokenId`, `sessionId`, `storageKey`, `ciphertext`, UUID y una clave desconocida.

```ts
it('rejects a cursor signed for a different filter set', () => {
  const cursor = encodeAuditCursor({ ...baseCursor, category: 'commercial' }, secret);
  expect(() => decodeAuditCursor(cursor, secret, { ...baseQuery, category: 'documents' })).toThrow();
});

it('projects only allowlisted fields for the action', () => {
  expect(projectAuditMetadata('quote.sent', {
    folio: 'OC-0001', toStatus: 'ENVIADA', email: 'private@example.test', tokenId: 'secret',
  })).toEqual([
    { label: 'Folio', value: 'OC-0001' },
    { label: 'Estado', value: 'ENVIADA' },
  ]);
});
```

- [ ] **Step 2: Ejecutar sólo las unitarias nuevas y confirmar FAIL.**

Run: `npm run test:unit -- --run tests/unit/audit-domain.test.ts tests/unit/audit-serialization.test.ts`

Expected: FAIL porque aún no existe `src/server/modules/audit/domain.ts` ni el contrato de secreto.

- [ ] **Step 3: Implementar el contrato mínimo.** Usar `APP_TIMEZONE` como zona de presentación, UTC para consultas, una ventana default de 30 días y máximo de 93 días. Usar `node:crypto` HMAC-SHA-256 con `AUDIT_CURSOR_SECRET`; codificar payload en base64url y comparar firma con `timingSafeEqual`. El fingerprint opaco de `eventKey`/`actorKey` será HMAC del secreto con prefijos distintos; nunca será el UUID en claro. Registrar únicamente transformadores allowlisted por acción; una acción desconocida produce `details: []` y no copia claves desconocidas.

- [ ] **Step 4: Agregar configuración validada.** Añadir `AUDIT_CURSOR_SECRET` como clave base64 canónica de 32 bytes independiente de las claves de cifrado y añadir `AUDIT_RATE_LIMIT_MAX_ATTEMPTS`/`AUDIT_RATE_LIMIT_WINDOW_MINUTES` con rangos 10–10.000 y 1–60. Reflejar valores de desarrollo en `.env.example` sin usar secretos de producción.

- [ ] **Step 5: Repetir unitarias y revisar serialización.**

Run: `npm run test:unit -- --run tests/unit/audit-domain.test.ts tests/unit/audit-serialization.test.ts`

Expected: PASS; `JSON.stringify` de cualquier `AuditEntry` no debe contener UUIDs internos, emails, teléfonos, IP, user-agent, token, ciphertext, hashes ni metadata desconocida.

- [ ] **Step 6: Commit.**

```bash
git add src/server/modules/audit/domain.ts src/server/env.ts .env.example tests/unit/audit-domain.test.ts tests/unit/audit-serialization.test.ts
git commit -m "feat: define audit contracts and redaction"
```

### Task 2: Permisos, seed y política de acceso

**Files:**
- Modify: `src/server/auth/constants.ts`
- Modify: `tests/unit/auth-permissions.test.ts`
- Modify: `tests/integration/identity-rbac.test.ts`

**Interfaces:**
- `audit.read` describe lectura operativa; `audit.security.read` describe eventos de identidad/security.
- `ROLE_DEFINITIONS.manager.permissions` contiene `audit.read`, nunca `audit.security.read`.
- `ROLE_DEFINITIONS.admin.permissions` se deriva del catálogo e incluye ambas capacidades.

- [ ] **Step 1: Escribir pruebas RBAC que fallen.** Verificar que `PERMISSION_CATALOG` contiene exactamente las dos capacidades, que manager tiene sólo `audit.read`, que admin tiene ambas y que sales/customer no tiene ninguna.

```ts
expect(permissionKeysForRoles(['manager'])).toContain('audit.read');
expect(permissionKeysForRoles(['manager'])).not.toContain('audit.security.read');
expect(permissionKeysForRoles(['sales', 'customer'])).not.toContain('audit.read');
```

- [ ] **Step 2: Ejecutar pruebas RBAC y confirmar FAIL.**

Run: `npm run test:unit -- --run tests/unit/auth-permissions.test.ts && npm run test:integration -- tests/integration/identity-rbac.test.ts`

Expected: FAIL porque las capacidades aún no están catalogadas/asignadas.

- [ ] **Step 3: Añadir catálogo y asignaciones.** Agregar las dos entradas a `PERMISSION_CATALOG`, asignar `audit.read` a manager y dejar que admin reciba el catálogo completo. No modificar permisos de sales/customer ni agregar bypass por tipo de actor.

- [ ] **Step 4: Ejecutar unitarias e integración de identidad.**

Run: `npm run test:unit -- --run tests/unit/auth-permissions.test.ts && npm run test:integration -- tests/integration/identity-rbac.test.ts`

Expected: PASS; el seed existente debe crear/upsert las nuevas capacidades y asignaciones sin migración de datos manual.

- [ ] **Step 5: Commit.**

```bash
git add src/server/auth/constants.ts tests/unit/auth-permissions.test.ts tests/integration/identity-rbac.test.ts
git commit -m "feat: add audit permissions"
```

### Task 3: Repositorio Prisma y servicio seguro

**Files:**
- Create: `src/server/modules/audit/repository.ts`
- Create: `src/server/modules/audit/service.ts`
- Create: `tests/integration/audit-service.test.ts`

**Interfaces:**
- `AuditRepositoryQuery = AuditQuery & { source: 'operational' | 'security' }`.
- `readAuditPage(prisma: PrismaClient, query: AuditRepositoryQuery): Promise<{ rows: AuditRow[]; actorIds: string[] }>`.
- `getStaffAudit(actor: Actor, input: AuditQueryInput, dependencies?: AuditServiceDependencies): Promise<AuditResponse>`.
- `AuditServiceDependencies = { prisma?: PrismaClient; now?: Date; timezone?: string; cursorSecret?: string; rateLimit?: RateLimitFn }`.

- [ ] **Step 1: Preparar fixtures y pruebas de integración que fallen.** Crear usuarios manager, admin, sales y customer, eventos `AuditLog` de varias categorías/outcomes y `AuthEvent` con IP, user-agent, identifierHash y metadata privada. Verificar permisos, filtros, intervalo, orden, límite, cursor estable, actor eliminado/sistema, rate limit antes de leer y ausencia de datos prohibidos en `JSON.stringify(result)`.

```ts
it('returns a redacted operational page without N+1 actor queries', async () => {
  const result = await getStaffAudit(managerActor, { category: 'commercial', limit: 2 }, { prisma, cursorSecret: secret });
  expect(result.items).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(/@example|192\.0\.2|user-agent|ciphertext|tokenId|[0-9a-f]{8}-[0-9a-f]{4}/i);
});
```

- [ ] **Step 2: Ejecutar la prueba y confirmar FAIL.**

Run: `npm run test:integration -- tests/integration/audit-service.test.ts`

Expected: FAIL porque repositorio/servicio todavía no existen.

- [ ] **Step 3: Implementar lecturas parametrizadas.** Para `AuditLog`, filtrar `createdAt`, `outcome`, categoría traducida desde el registro allowlisted y cursor `(createdAt,id)`, ordenar descendente y leer `limit + 1`. Seleccionar sólo `id`, `actorUserId`, `action`, `entityType`, `outcome`, `metadata`, `createdAt`. Para `AuthEvent`, seleccionar sólo `id`, `userId`, `eventType`, `outcome`, `createdAt`; jamás seleccionar red, hash, metadata ni token details para la respuesta. Resolver actores con un único `findMany` por conjunto de IDs y mapear a display name interno; no resolver clientes ni entidades por `entityId`.

- [ ] **Step 4: Implementar servicio y source separation.** Rechazar `CUSTOMER`, `EMPLOYEE` sin capability y manager solicitando security con `AppError('FORBIDDEN', ...)`. Aplicar rate limit antes del repositorio con scope `audit-read` y la clave `actor.userId`. El scope operativo usa `audit.read`; security requiere además `audit.security.read`. Generar `nextCursor` sólo si hay fila extra y ligar su payload a todos los filtros normalizados.

- [ ] **Step 5: Ejecutar integración y revisar consultas.**

Run: `npm run test:integration -- tests/integration/audit-service.test.ts`

Expected: PASS; `AuthEvent` no devuelve IP/user-agent/identifierHash/metadata, la lectura de manager no incluye security, el rate limit evita la lectura y no hay `findUnique` dentro de un loop.

- [ ] **Step 6: Commit.**

```bash
git add src/server/modules/audit/repository.ts src/server/modules/audit/service.ts tests/integration/audit-service.test.ts
git commit -m "feat: add secure audit read service"
```

### Task 4: API privada y contrato HTTP

**Files:**
- Create: `src/app/api/staff/audit/route.ts`
- Create: `tests/integration/audit-api.test.ts`

**Interfaces:**
- `GET /api/staff/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&category=...&outcome=...&limit=...&cursor=...`.
- Respuesta 200: `AuditResponse` con `meta.scope` `operational` o `security`.
- Errores: envelope existente con `401`, `403`, `400`, `429`, `500`; nunca stack/SQL/secretos.

- [ ] **Step 1: Escribir pruebas HTTP que fallen.** Cubrir sin sesión, customer/sales, manager operativo, manager security, admin security, query desconocida, fechas inválidas, cursor manipulado, `cache-control`, `requestId` en errores y rate limit.

- [ ] **Step 2: Ejecutar prueba API y confirmar FAIL.**

Run: `npm run test:integration -- tests/integration/audit-api.test.ts`

Expected: FAIL porque la ruta no existe.

- [ ] **Step 3: Implementar parser y route handler.** Usar Zod `.strict()` sobre `Object.fromEntries(request.nextUrl.searchParams.entries())`, pasar sólo campos normalizados al servicio, crear `requestId()` antes del `try`, usar `requireStaffActor(request)` y `toErrorResponse(error, id)`. Responder JSON `200` con `cache-control: no-store` y sin headers que permitan cache compartido.

- [ ] **Step 4: Ejecutar pruebas HTTP.**

Run: `npm run test:integration -- tests/integration/audit-api.test.ts`

Expected: PASS; una query no soportada no se ignora, un cursor de otro filtro no amplía resultados y el endpoint no es accesible desde customer/sales.

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/staff/audit/route.ts tests/integration/audit-api.test.ts
git commit -m "feat: expose staff audit api"
```

### Task 5: Panel staff, navegación y experiencia responsive

**Files:**
- Create: `src/components/StaffAuditPanel.tsx`
- Create: `src/app/staff/audit/page.tsx`
- Create: `tests/audit.spec.ts`
- Modify: componente/layout de navegación staff existente y `src/app/globals.css` o hoja staff existente

**Interfaces:**
- El panel usa `fetch('/api/staff/audit?...')` con `AbortController`, no incluye IDs en atributos HTML ni genera links profundos.
- Estados explícitos: `loading`, `ready`, `empty`, `error`, `forbidden`.
- Los controles de periodo/categoría/outcome actualizan el primer cursor; “Cargar anteriores” conserva filtros y agrega sin duplicar.

- [x] **Step 1: Escribir E2E opt-in que falle.** Cubrir manager operativo, admin security, customer/sales restringidos, vacío, error recuperable, filtro y cursor. Añadir `checkA11y`, viewport 390/768/1440, teclado, focus visible, reduced motion, no overflow horizontal y consola sin errores inesperados.

- [x] **Step 2: Ejecutar E2E de auditoría y confirmar FAIL.** La primera corrida devolvió 404 porque la página todavía no existía, como esperaba el ciclo TDD.

Run: `cross-env AUDIT_E2E=1 npm run test:e2e -- tests/audit.spec.ts`

Expected: FAIL porque la página y los selectores accesibles todavía no existen.

- [x] **Step 3: Implementar la página y el panel.** Mantener el shell staff existente; incluir encabezado con propósito, periodo, zona y scope; filtros con labels; lista/tablet con acción, actor, entidad y detalles; badges de resultado con texto y no sólo color; botón “Cargar anteriores” con `aria-live` para feedback; skeleton estable; estado vacío útil; error con reintento; forbidden sin datos. No mostrar correo, UUID, cliente, payload ni metadata no proyectada.

- [x] **Step 4: Integrar navegación y CSS.** Añadir entrada visible sólo donde el usuario tenga capability; mantener la ruta protegida en backend. Usar tokens staff existentes, contraste AA, focus ring, targets táctiles, `@media (prefers-reduced-motion: reduce)` y layouts sin overflow en 390 px. No introducir una librería visual nueva.

- [x] **Step 5: Ejecutar E2E, Axe y revisión visual.** `AUDIT_E2E=1 npm run test:e2e -- tests/audit.spec.ts` pasó 1/1 después de corregir el fixture de outcome, el título semántico, responsive y ruido esperado de consola.

Run: `cross-env AUDIT_E2E=1 npm run test:e2e -- tests/audit.spec.ts`

Expected: PASS en los tres viewports, sin violaciones Axe conocidas, sin PII en HTML y con paginación estable.

- [x] **Step 6: Commit.** `c341c66 feat: add staff audit workspace`.

```bash
git add src/components/StaffAuditPanel.tsx src/app/staff/audit/page.tsx src/app/globals.css tests/audit.spec.ts
git commit -m "feat: add staff audit workspace"
```

### Task 6: Hardening, observabilidad y evidencia de rendimiento

**Files:**
- Create: `docs/runbooks/audit-observability.md`
- Modify: `tests/unit/runbook-contract.test.ts`
- Modify: `README.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `tests/integration/production-readiness.test.ts` sólo para documentar el nuevo secreto/límite

**Interfaces:**
- Runbook: acceso/RBAC, filtros, fechas, redacción, rate limit, diagnóstico, backup/retención pendiente y rollback sin purga.
- `PROJECT_STATUS.md`: fase, módulos, dependencias, decisiones, pruebas realizadas/pendientes, riesgos, deuda y próximos pasos.

- [x] **Step 1: Agregar pruebas de contrato documental.** Extender `tests/unit/runbook-contract.test.ts` para verificar que el runbook menciona `audit.read`, `audit.security.read`, `[from,to)`, 93 días, `no-store`, redacción y que no existe una instrucción destructiva de purga.

- [x] **Step 2: Ejecutar `EXPLAIN` representativo antes de migrar.** PostgreSQL 16 local con 960 `AuditLog` y 2,203 `AuthEvent`: la consulta operacional leyó 960 filas en `Seq Scan` y terminó en 0.550 ms; la consulta security leyó 2,203 filas y terminó en 0.483 ms. El planner eligió `Seq Scan` para ambas consultas con el volumen y predicados representativos actuales; `AuthEvent` conserva `auth_events_eventType_createdAt_idx` disponible para otros predicados, pero la evidencia no justifica un índice adicional para `AuditLog`.

- [x] **Step 3: Ejecutar hardening completo.** `npm run test:unit` 31 archivos/110 pruebas, `npm run test:integration` 39 archivos/79 pruebas, `npm run test:content`, typecheck, lint, build limpio, `npm audit --omit=dev --audit-level=high` 0 vulnerabilidades, E2E audit 1/1 y E2E normal 34 passed/11 skipped opt-in. La revisión de respuestas/UI/logs confirmó que las señales internas permanecen en repositorio/proyección controlada y no se serializan.

- [x] **Step 4: Documentar límites y pendientes.** El runbook registra que retención/purga requiere decisión legal, que no hay exportación/SIEM/alertas, que el endpoint es local/staff y que los controles productivos externos continúan bloqueados. La fase local no se presenta como autorización de producción.

- [x] **Step 5: Actualizar seguimiento y cerrar sólo con evidencia.** Dominio, permisos, servicio, API, UI, seguridad, responsive, pruebas, `EXPLAIN`, runbook y documentación quedaron comprobados; los bloqueos externos permanecen separados y explícitos.

- [x] **Step 6: Commit de cierre.** La documentación, el runbook, los contratos de seguimiento y las correcciones de verificación se cierran mediante commits lógicos después de actualizar `PROJECT_STATUS.md` con la evidencia final.

```bash
git add docs/runbooks/audit-observability.md README.md PROJECT_STATUS.md tests
git commit -m "docs: close audit observability phase"
```

## Gate final de Fase 12

Ejecutar en este orden y conservar resultados en `PROJECT_STATUS.md`:

```powershell
npm run test:unit
npm run test:integration
npm run test:content
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
cross-env AUDIT_E2E=1 npm run test:e2e -- tests/audit.spec.ts
npm run test:e2e
```

La fase no se cierra si falla una prueba, si el payload contiene una señal prohibida, si manager puede consultar `AuthEvent`, si un cursor cruza filtros, si aparece N+1, si la UI carece de estados accesibles o si el plan de PostgreSQL exige un índice no justificado y aún no documentado.

## Revisión de cobertura de la especificación

- Contratos, fechas, cursor, metadata y serialización: Task 1.
- Permisos y separación operational/security: Task 2 y Task 3.
- PostgreSQL, paginación, batch y rate limit: Task 3 y Task 6.
- API, errores públicos y `no-store`: Task 4.
- UI, responsive, estados, keyboard, Axe y reduced motion: Task 5.
- Retención, runbook, rendimiento, auditoría de cambios y seguimiento: Task 6.
- Fuera de alcance: explicitado en la spec y preservado en Tasks 3–6.
