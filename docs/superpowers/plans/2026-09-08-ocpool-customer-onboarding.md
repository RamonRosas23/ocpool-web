# Customer Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar de forma segura el acceso del cliente al portal desde un expediente existente, con invitación única, activación por magic link y aislamiento por cliente.

**Architecture:** Reutilizar `User`, `ClientContact`, `AuthToken`, Outbox y sesión existentes. El servicio de onboarding será una frontera transaccional de dominio; la ruta staff sólo validará HTTP/same-origin y la UI reflejará capabilities. `INVITED` se convierte en `ACTIVE` únicamente al consumir un token válido.

**Tech Stack:** Next.js App Router, TypeScript estricto, Prisma 7/PostgreSQL 16, Zod, Vitest, Playwright, Mailpit y worker de notificaciones existente.

**Spec:** `docs/superpowers/specs/2026-09-08-ocpool-customer-onboarding-design.md`

## Global Constraints

- No crear credenciales fijas ni usar el folio como autenticación.
- No guardar tokens crudos en PostgreSQL, Outbox, logs, payloads seguros, HTML persistido o respuestas.
- Toda acción staff requiere sesión EMPLOYEE, `identity.users.manage`, same-origin y lock transaccional.
- Nunca reasignar un usuario CUSTOMER existente de un cliente a otro.
- Una invitación vigente se deduplica; una reemisión invalida tokens anteriores dentro de la misma transacción.
- Mantener respuestas públicas genéricas y no enumerar cuentas o clientes.
- Toda conducta nueva debe tener prueba roja antes de implementación.

---

### Task 1: RBAC y contratos de ciclo de vida

**Files:**
- Modify: `src/server/auth/constants.ts`
- Modify: `src/app/api/staff/capabilities/route.ts`
- Test: `tests/unit/auth-permissions.test.ts`
- Test: `tests/integration/auth-service.test.ts`

**Interfaces:**
- Produce el permiso `identity.users.manage` para `manager` y `admin`, no para `sales` ni `customer`.
- Expone `identityUsersManage` en capabilities staff.

- [ ] **Step 1: Add failing permission assertions**

  Assert that manager/admin have `identity.users.manage`, sales/customer do not, and the capabilities response exposes only the boolean derived from the actor permission set.

- [ ] **Step 2: Run the permission tests and verify failure**

  Run: `npx vitest run tests/unit/auth-permissions.test.ts tests/integration/auth-service.test.ts --maxWorkers=1`

  Expected: FAIL because the permission and capability do not exist.

- [ ] **Step 3: Add the permission and capability projection**

  Add the catalog entry, add it to manager/admin definitions, and return `identityUsersManage: hasPermission(actor, 'identity.users.manage')` from the existing capability route. Do not add a second capability endpoint.

- [ ] **Step 4: Run typecheck and focused tests**

  Run: `npm run typecheck` and the focused Vitest command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the RBAC contract**

  Run: `git add src/server/auth/constants.ts src/app/api/staff/capabilities/route.ts tests && git commit -m "feat: add customer access management permission"`

### Task 2: Magic-link invitation lifecycle

**Files:**
- Modify: `src/server/auth/service.ts`
- Modify: `src/server/modules/notifications/event-resolver.ts`
- Test: `tests/integration/auth-service.test.ts`

**Interfaces:**
- Produce an internal transaction helper `issueCustomerMagicLinkInTransaction(transaction, input)` that creates the hashed token and encrypted Outbox event.
- `consumeCustomerMagicLink` accepts `INVITED`, atomically updates it to `ACTIVE`, and still rejects replay/expiry/wrong type.

- [ ] **Step 1: Add failing lifecycle tests**

  Create an invited customer fixture and assert: the helper creates one `AuthToken`/Outbox pair without raw token in payload; consume creates a session and changes status to ACTIVE; a second consume returns false; expired and employee tokens return false.

- [ ] **Step 2: Run the focused auth integration suite and verify failure**

  Run: `npx cross-env RUN_DB_TESTS=1 npx vitest run tests/integration/auth-service.test.ts --maxWorkers=1`

  Expected: FAIL because no invitation helper exists and the consumer rejects `INVITED`.

- [ ] **Step 3: Implement the transaction helper and activation transition**

  Extract the existing customer magic-link delivery path without changing token hashing/encryption. Make the recipient resolver accept an invited customer only for the auth invitation event; do not broaden customer portal read scope before session activation. Update the consumer transaction with `updateMany({ where: { id, status: 'INVITED' }, data: { status: 'ACTIVE' } })` before session creation and reject if the conditional update loses a race.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `npx cross-env RUN_DB_TESTS=1 npx vitest run tests/integration/auth-service.test.ts --maxWorkers=1` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit the auth lifecycle**

  Run: `git add src/server/auth/service.ts src/server/modules/notifications/event-resolver.ts tests/integration/auth-service.test.ts && git commit -m "feat: activate invited customers through magic link"`

### Task 3: Transactional customer access service and API

**Files:**
- Create: `src/server/modules/customer-onboarding/service.ts`
- Create: `src/app/api/staff/quote-requests/[id]/customer-access/route.ts`
- Modify: `src/server/modules/quote-requests/staff-service.ts`
- Test: `tests/integration/customer-onboarding-service.test.ts`
- Test: `tests/integration/customer-onboarding-api.test.ts`

**Interfaces:**
- `inviteCustomerPortalAccess(actor, quoteRequestId, dependencies)` returns `{ quoteRequestId, folio, status, email }`, where status is `INVITED`, `ALREADY_ACTIVE`, or `ALREADY_PENDING`.
- The service requires `identity.users.manage`, locks the quote request, validates active same-client contact, resolves/creates `CUSTOMER` in `INVITED`, links `ClientContact.userId`, deduplicates pending tokens, invalidates previous tokens on reissue, and writes audit evidence.
- `POST /api/staff/quote-requests/:id/customer-access` accepts `{}` only, requires same-origin/session/RBAC, and returns no token or internal hash.

- [ ] **Step 1: Add failing service and API tests**

  Cover first invite, repeated invite while pending, activation reuse, manager/admin allowed, sales/customer denied, malformed UUID, cross-client existing user conflict, archived contact rejection, same-origin rejection, strict body rejection, and secret-free response.

- [ ] **Step 2: Run the focused tests and verify failure**

  Run: `npx cross-env RUN_DB_TESTS=1 npx vitest run tests/integration/customer-onboarding-service.test.ts tests/integration/customer-onboarding-api.test.ts --maxWorkers=1`

  Expected: FAIL because the service and route do not exist.

- [ ] **Step 3: Implement the locked service**

  Use a PostgreSQL row lock on `quote_requests`, verify `client.status` and `contact.status`, resolve by `emailNormalized`, reject a user belonging to another client or employee account, create/link `CUSTOMER` in `INVITED`, and call the Task 2 helper inside the same transaction. Store only safe audit metadata `{ folio, outcome }`.

- [ ] **Step 4: Implement the strict staff route**

  Reuse existing `requireStaffActor`, `assertSameOrigin`, `parseBody` and `toErrorResponse`; parse `z.object({}).strict()` and return `{ accepted: true, ...result }` with `cache-control: no-store`.

- [ ] **Step 5: Run focused tests, typecheck and lint**

  Run: the focused integration command, `npm run typecheck`, `npm run lint`, and `git diff --check`. Expected: PASS.

- [ ] **Step 6: Commit the service/API**

  Run: `git add src/server/modules/customer-onboarding src/app/api/staff/quote-requests tests src/server/modules/quote-requests/staff-service.ts && git commit -m "feat: add transactional customer portal onboarding"`

### Task 4: Safe notification fallback for contacts without accounts

**Files:**
- Modify: `src/server/modules/notifications/templates.ts`
- Modify: `src/server/modules/notifications/event-resolver.ts`
- Modify: `src/server/modules/notifications/worker.ts`
- Test: `tests/unit/notifications-templates.test.ts`
- Test: `tests/integration/notifications-fanout.test.ts`

**Interfaces:**
- Customer notification contexts use `/portal` and `Ver expediente` only for an active linked user; otherwise use `/portal/access` and `Solicitar acceso`.
- Existing templates, safe payload allowlists, URL allowlist and auth token secrecy remain intact.

- [ ] **Step 1: Add failing notification tests**

  Assert that a contact without user produces a safe access-request URL/label, an active linked customer produces `/portal`, and internal recipients/events remain rejected.

- [ ] **Step 2: Run focused notification tests and verify failure**

  Run: `npx vitest run tests/unit/notifications-templates.test.ts tests/integration/notifications-fanout.test.ts --maxWorkers=1`. Expected: FAIL because the current resolver always uses `/portal` for fallback contacts.

- [ ] **Step 3: Implement action-path and action-label payloads**

  Add a bounded `actionLabel` to notification context/template data, map it through the worker, and use controlled labels per template. Do not copy user input into the label or URL.

- [ ] **Step 4: Run focused tests and full typecheck**

  Run the focused tests and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit notification safety**

  Run: `git add src/server/modules/notifications tests && git commit -m "fix: route customer notifications safely before onboarding"`

### Task 5: Staff projection and onboarding UI

**Files:**
- Modify: `src/server/modules/quote-requests/staff-service.ts`
- Modify: `src/components/StaffRequestsPanel.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/quality.spec.ts`
- Optional E2E fixture extension: `tests/auth-surfaces.spec.ts` or a focused onboarding spec

**Interfaces:**
- Staff detail exposes `contact.user` status/type without raw auth material.
- The UI renders the action only when `identityUsersManage` is true and shows pending/active/conflict feedback without exposing internal IDs.

- [ ] **Step 1: Add failing E2E/UI tests**

  Cover restricted staff, manager action visibility, successful invite feedback, no duplicate invite while pending, responsive 390/768/1440, no serious Axe issues, no console errors, and portal access after consuming the Mailpit token in the opt-in fixture.

- [ ] **Step 2: Run the focused E2E test and verify failure**

  Run: `npx cross-env CUSTOMER_ONBOARDING_E2E=1 npx playwright test tests/customer-onboarding.spec.ts`. Expected: FAIL because the action and projection do not exist.

- [ ] **Step 3: Extend the protected projection and component**

  Select only `contact.user.id/status/type` for staff, add the capability flag, add a confirmation action with busy/error/success states, and refresh the selected detail after completion. Keep the action out of customer/public HTML.

- [ ] **Step 4: Run E2E, lint and responsive checks**

  Run the opt-in E2E, `npm run lint`, and `git diff --check`. Expected: PASS.

- [ ] **Step 5: Commit the staff onboarding UI**

  Run: `git add src/components/StaffRequestsPanel.tsx src/server/modules/quote-requests/staff-service.ts src/app/globals.css tests && git commit -m "feat: expose customer portal onboarding in staff"`

### Task 6: Documentation, full regression and phase close

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/auth-surfaces.md`
- Modify: `docs/runbooks/local-development.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `docs/superpowers/plans/2026-09-08-ocpool-customer-onboarding.md`

- [ ] **Step 1: Update documentation in order**

  Document the permission, staff action, pending/active states, Mailpit flow, no-credential policy, conflict behavior and recovery instructions. Add the spec/review/plan to `PROJECT_STATUS.md`.

- [ ] **Step 2: Run the full gate in order**

  Run: `npm run db:validate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:content`, `npm run build`, `npm run test:e2e`, `npm audit --omit=dev --audit-level=high`, `git diff --check`.

- [ ] **Step 3: Record evidence and remaining external risks**

  Update `PROJECT_STATUS.md` with exact test counts, opt-in suites, commit IDs, no-go items and Fase 16 as the next authorized phase.

- [ ] **Step 4: Commit the phase close**

  Run: `git add README.md docs/runbooks PROJECT_STATUS.md docs/superpowers/plans/2026-09-08-ocpool-customer-onboarding.md && git commit -m "docs: close customer onboarding phase"`
