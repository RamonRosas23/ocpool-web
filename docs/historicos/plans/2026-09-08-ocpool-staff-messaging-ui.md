# UI de mensajería interna y notas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar mensajes compartidos, notas internas y cierre/reapertura en el detalle del inbox staff sin mezclar visibilidades ni debilitar RBAC.

**Architecture:** Se mantiene una conversación por expediente y se agrega un componente cliente enfocado (`StaffMessagingPanel`) que consume las APIs de mensajería existentes. `StaffRequestsPanel` conserva la selección/carga del expediente y sólo le entrega el `requestId`; las capacidades llegan desde el endpoint existente y se extienden con booleanos derivados del actor. El backend sigue validando cada operación.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript ES2023, Prisma/PostgreSQL ya existente, Zod, Vitest, Playwright y CSS OCPOOL. No se agregan dependencias.

**Spec:** `docs/historicos/specs/2026-09-08-ocpool-staff-messaging-ui.md`

## Global Constraints

- No aceptar `clientId`, `senderUserId`, `visibility` ni permisos desde el navegador como autoridad.
- Las notas sólo se escriben en `/notes`; los mensajes compartidos sólo en `/messages`.
- La UI oculta acciones no autorizadas, pero los endpoints siguen siendo deny-by-default.
- Todo fetch privado usa `credentials: 'include'`, `cache: 'no-store'` y cancela respuestas obsoletas al cambiar de expediente.
- Todo envío genera una clave de idempotencia opaca por intento y conserva el texto ante error.
- No renderizar cuerpos internos en la vista compartida ni confiar en CSS para privacidad.
- Mantener responsive 360/390/768/1440 px, foco visible, Axe, consola limpia, reduced motion y cero overflow.
- Cada tarea termina con pruebas, `git diff --check`, actualización documental y commit lógico.

## Mapa de archivos

- Modify: `src/app/api/staff/capabilities/route.ts` — exponer las cinco capacidades de mensajería.
- Create: `src/components/StaffMessagingPanel.tsx` — fetch, tabs, feed, compositores y estado de conversación.
- Modify: `src/components/StaffRequestsPanel.tsx` — cargar capacidades y montar el módulo dentro del expediente.
- Modify: `src/app/globals.css` — superficie visual staff, estados, responsive y reduced motion.
- Modify: `tests/integration/messaging-api.test.ts` — verificar contrato de capacidades si se cubre desde el mismo slice.
- Create: `tests/client-messaging-staff.spec.ts` — E2E opt-in con dos perfiles, privacidad y UX.
- Modify: `PROJECT_STATUS.md` y este plan — evidencia, riesgos y siguiente tarea.

---

### Task 1: Contrato de capacidades y prueba roja staff

**Files:**
- Modify: `src/app/api/staff/capabilities/route.ts`
- Modify: `tests/integration/messaging-api.test.ts`
- Create: `tests/client-messaging-staff.spec.ts`

**Interfaces:**
- Produces `{ messagingRead, messagingSend, messagingInternalNotesRead, messagingInternalNotesWrite, messagingManage }` como booleanos públicos derivados del actor.
- E2E opt-in usará los endpoints actuales y una sesión de ventas/gerencia creada por fixture; no agregará bypass a la UI.

- [x] **Step 1: Escribir la prueba de contrato de capacidades**

  Añadir al test de integración una llamada a `GET /api/staff/capabilities` para un manager y verificar los cinco booleanos en `true`; crear un rol staff limitado con `messaging.read` y comprobar que sólo `messagingRead` es `true`.

- [x] **Step 2: Ejecutar la prueba roja**

  Run: `npx cross-env RUN_DB_TESTS=1 vitest run tests/integration/messaging-api.test.ts --maxWorkers=1`

  Expected: FAIL porque el JSON actual no contiene capacidades de mensajería.

- [x] **Step 3: Implementar el contrato mínimo**

  Agregar al objeto de `src/app/api/staff/capabilities/route.ts`:

  ```ts
  messagingRead: hasPermission(actor, 'messaging.read'),
  messagingSend: hasPermission(actor, 'messaging.send'),
  messagingInternalNotesRead: hasPermission(actor, 'messaging.internal_notes.read'),
  messagingInternalNotesWrite: hasPermission(actor, 'messaging.internal_notes.write'),
  messagingManage: hasPermission(actor, 'messaging.manage'),
  ```

- [x] **Step 4: Ejecutar la prueba verde y typecheck**

  Run: `npx cross-env RUN_DB_TESTS=1 vitest run tests/integration/messaging-api.test.ts --maxWorkers=1`, `npm run typecheck`

  Expected: contrato verde y tipos correctos.

- [x] **Step 5: Añadir la prueba E2E roja del flujo staff**

  Crear fixture opt-in que use una sesión de manager, cree un expediente con `createQuoteRequest`, inserte un mensaje compartido y una nota interna mediante el servicio, visite `/staff/requests`, seleccione el folio y verifique que los tabs “Compartidos” y “Notas internas” aparecen sin cuerpos en el tab equivocado. Añadir después envío compartido, envío de nota, cierre y reapertura; un perfil limitado debe conservar sólo lectura.

- [x] **Step 6: Ejecutar la E2E roja**

  Run: `npx cross-env STAFF_MESSAGING_E2E=1 playwright test tests/client-messaging-staff.spec.ts`

  Expected: FAIL porque el inbox aún no renderiza el módulo.

- [x] **Step 7: Commit del contrato**

  ```bash
  git add src/app/api/staff/capabilities/route.ts tests/integration/messaging-api.test.ts tests/client-messaging-staff.spec.ts
  git commit -m "test: define staff messaging capability contract"
  ```

Evidencia: prueba roja del contrato, después `messaging-api.test.ts` 4/4; E2E staff roja antes de la UI; commit `09d979f`.

### Task 2: Modelo de estado y componente StaffMessagingPanel

**Files:**
- Create: `src/components/StaffMessagingPanel.tsx`
- Test: `tests/client-messaging-staff.spec.ts`

**Interfaces:**
- Props: `{ requestId: string; capabilities: StaffMessagingCapabilities }`.
- Read endpoint: `GET /api/staff/quote-requests/:requestId/messages?limit=30`.
- Shared write: `POST /api/staff/quote-requests/:requestId/messages`.
- Internal write: `POST /api/staff/quote-requests/:requestId/notes`.
- Status write: `POST /api/staff/quote-requests/:requestId/conversation-status`.

- [x] **Step 1: Definir tipos internos sin datos inventados**

  Modelar `StaffMessage`, `StaffConversation`, `StaffConversationResponse` y `StaffMessagingCapabilities` dentro del componente o en un módulo compartido pequeño. Conservar `visibility` como unión literal y no permitir que el composer lo reciba desde un `<select>` libre.

- [x] **Step 2: Implementar lectura cancelable**

  Cargar al cambiar `requestId` con `AbortController`, resetear estado de sección, usar `no-store`, distinguir carga/error y deduplicar mensajes por `id` al cargar `nextCursor`. El botón “Reintentar” debe repetir sólo la lectura.

- [x] **Step 3: Implementar tabs por visibilidad**

  El tab Compartidos muestra `visibility === 'CUSTOMER'`; el tab Notas internas sólo se renderiza cuando `messagingInternalNotesRead` y muestra `visibility === 'INTERNAL'`. Usar botones con `aria-selected`, panel etiquetado y contadores calculados del payload ya autorizado.

- [x] **Step 4: Implementar composer compartido y nota privada**

  Mantener un `draft` por modo o limpiar al cambiar de tab, contador de 10,000 caracteres, `aria-busy`, bloqueo durante request, clave `staff-${requestId}-${crypto.randomUUID()}` y recuperación con texto intacto. Enviar cada modo a su endpoint; sólo insertar el mensaje confirmado por servidor.

- [x] **Step 5: Implementar cierre/reapertura**

  Si `messagingManage` está activo, mostrar botón según estado y una confirmación inline (“Confirmar cierre” / “Cancelar”), no `window.confirm`. Tras respuesta exitosa refrescar lectura; ante error mantener estado anterior y anunciarlo.

- [x] **Step 6: Ejecutar E2E dirigida**

  Run: `npx cross-env STAFF_MESSAGING_E2E=1 playwright test tests/client-messaging-staff.spec.ts`

  Expected: flujo manager verde; notas ausentes del tab compartido, composer limitado por capacidades y estado cerrado sin composer.

- [x] **Step 7: Commit del componente aislado**

  ```bash
  git add src/components/StaffMessagingPanel.tsx tests/client-messaging-staff.spec.ts
  git commit -m "feat: add staff messaging workspace"
  ```

Evidencia: componente `StaffMessagingPanel` con fetch cancelable, cursor, dos compositores, idempotencia, confirmación inline y estado cerrado; commit `f2b0e4b`.

### Task 3: Integración con inbox y superficie visual

**Files:**
- Modify: `src/components/StaffRequestsPanel.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/client-messaging-staff.spec.ts`

**Interfaces:**
- `StaffRequestsPanel` carga capacidades en paralelo con responsables y entrega el objeto al componente sólo cuando el expediente está seleccionado.
- El módulo se monta después de `staff-actions-grid` y antes de `staff-history`.

- [x] **Step 1: Añadir estado de capacidades en el panel**

  Crear el tipo local completo, cargar `/api/staff/capabilities` con `readResponse`, conservar un objeto seguro con todos los flags en `false` mientras carga y no bloquear la lista de expedientes si el endpoint falla.

- [x] **Step 2: Montar `StaffMessagingPanel` en el detalle**

  Renderizar `<StaffMessagingPanel requestId={selected.id} capabilities={capabilities} />` dentro del detalle y asegurar que cambia de expediente sin conservar mensajes del anterior.

- [x] **Step 3: Añadir CSS editorial de staff**

  Añadir clases con prefijo `staff-messaging`, reglas laterales para compartido/nota, tabs de 44 px, composer y confirmación inline, skeleton/error/empty/closed, breakpoints 768/430 y `@media (prefers-reduced-motion: reduce)`. Reutilizar variables/colores existentes y evitar sombras o radios genéricos.

- [x] **Step 4: Ejecutar typecheck, lint y E2E responsive**

  Run: `npm run typecheck`, `npm run lint`, `npx cross-env STAFF_MESSAGING_E2E=1 playwright test tests/client-messaging-staff.spec.ts`

  Expected: tipos/lint correctos; E2E verifica Axe, consola limpia, no overflow a 390 px y foco visible.

- [x] **Step 5: Commit de integración visual**

  ```bash
  git add src/components/StaffRequestsPanel.tsx src/app/globals.css tests/client-messaging-staff.spec.ts
  git commit -m "feat: integrate staff conversation into request inbox"
  ```

Evidencia: integración en detalle después de acciones y antes del historial; corrección de contraste staff, nombres accesibles de selects y timeout de arranque E2E; commit `9eb9a04`.

### Task 4: QA de seguridad, regresión y cierre documental

**Files:**
- Modify: `tests/integration/messaging-api.test.ts` si falta una matriz negativa.
- Modify: `tests/client-messaging-staff.spec.ts` para assertions finales.
- Modify: `PROJECT_STATUS.md` y este plan.

**Interfaces:**
- No se cambian contratos de backend salvo la extensión de capacidades ya cubierta.
- La evidencia final debe conservar conteos exactos y señalar omisiones opt-in.

- [x] **Step 1: Completar matriz negativa**

  Verificar con dos actores que una cuenta limitada no puede escribir nota ni cerrar/reabrir, que un actor sin scope recibe 404/403 seguro, que un origen extraño recibe 403, que una conversación cerrada rechaza mutaciones y que los mensajes internos no aparecen en el tab compartido ni en su HTML.

- [x] **Step 2: Ejecutar integración serializada y auditoría**

  Run: `npm run test:unit`, `npm run test:integration`, `npm run test:content`, `npm audit --omit=dev --audit-level=high`, `git diff --check`

  Expected: todas verdes, 0 vulnerabilidades altas y sin whitespace inválido.

- [x] **Step 3: Ejecutar regresión completa**

  Run: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`, `npx cross-env STAFF_MESSAGING_E2E=1 playwright test tests/client-messaging-staff.spec.ts`

  Expected: build y regresión verde; las pruebas opt-in no quedan incluidas por accidente en la suite pública.

- [x] **Step 4: Revisar visualmente y actualizar documentación**

  Comprobar que el panel no desborda el detalle en 360/390/768/1440 px, que el copy distingue “Visible para cliente” de “Sólo equipo” y que `PROJECT_STATUS.md` registra módulo, dependencias, pruebas, problema/resolución y siguiente tarea.

- [x] **Step 5: Commit de cierre de la tarea**

  ```bash
  git add PROJECT_STATUS.md docs/historicos/plans/2026-09-08-ocpool-staff-messaging-ui.md docs/historicos/specs/2026-09-08-ocpool-staff-messaging-ui.md tests/client-messaging-staff.spec.ts
  git commit -m "docs: close staff messaging UI task"
  ```

Evidencia: `STAFF_MESSAGING_E2E=1` pasó 2/2 con manager y rol limitado; `npm run test:unit` 45/45; `npm run test:integration` 38/38; `npm run test:content`; `npm run typecheck`; `npm run lint`; `npm run build`; `npm run test:e2e` 34/34 ejecutadas con 7 omitidas explícitamente; `npm audit --omit=dev --audit-level=high` 0 vulnerabilidades; migraciones/seed sin pendientes y `git diff --check` correcto.

## Criterio de cierre

La Tarea 5 sólo se marca terminada cuando el equipo puede operar ambos tipos de comunicación dentro del expediente, las capacidades limitan la UI sin sustituir backend, la conversación cerrada es coherente, las notas son inequívocas y el gate de pruebas/documentación queda verde.
