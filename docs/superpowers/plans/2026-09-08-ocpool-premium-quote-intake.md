# Premium Quote Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the public quote request into a two-step, accessible, production-minded commercial intake while preserving existing submissions, folios and idempotency.

**Architecture:** Extend the existing relational `QuoteRequestDetail` with controlled PostgreSQL enums and nullable fields. Keep the public route as a strict HTTP adapter over the existing transactional service, and make the browser form a progressive client with field-level validation and stable idempotency behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict mode, Zod 4, Prisma 7/PostgreSQL 16, Vitest, Playwright, Axe.

**Spec:** `docs/superpowers/specs/2026-09-08-ocpool-premium-quote-intake-design.md`

## Global Constraints

- Preserve `POST /api/quote-requests` same-origin protection, 16 KiB streaming body limit, public generic errors, rate limits and `Idempotency-Key` replay behavior.
- Do not store new qualification fields in JSON; use relational columns and PostgreSQL enums.
- Do not create public anonymous file uploads in this phase.
- Do not add CAPTCHA or a dependency unless a measured abuse requirement justifies it.
- Never expose internal UUIDs, idempotency hashes, stack traces, SQL, raw tokens or secrets in public responses/logs.
- Preserve historical request rows: new nullable fields must not invalidate existing records.
- Every production behavior change must have a failing test before implementation.

---

### Task 1: Lock domain and schema contracts

**Files:**
- Create: `prisma/migrations/20260908201805_premium_quote_intake/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/server/modules/quote-requests/domain.ts`
- Test: `tests/unit/quote-requests-domain.test.ts`
- Test: `tests/integration/quote-requests-schema.test.ts`

**Interfaces:**
- Produces Prisma enum types and nullable `QuoteRequestDetail` fields consumed by the service and projections.
- Produces canonical option arrays/label maps for the API and UI.

- [ ] **Step 1: Write failing domain tests**

  Add tests proving the five allowed values for each new controlled field, rejecting unsupported values, and preserving existing normalization behavior.

- [ ] **Step 2: Run the focused unit test and verify it fails**

  Run: `npm run test:unit -- tests/unit/quote-requests-domain.test.ts`

  Expected: FAIL because the new domain option contracts do not exist.

- [ ] **Step 3: Write the Prisma schema change**

  Add four enums and nullable fields to `QuoteRequestDetail`; keep `budgetCents` for compatibility with existing staff/portal contracts.

- [ ] **Step 4: Generate and inspect the migration**

  Run: `npx prisma migrate dev --name premium_quote_intake`

  Inspect that the migration adds enums and nullable columns without destructive operations.

- [ ] **Step 5: Implement domain constants and labels**

  Add typed readonly option arrays and normalization helpers used by server and UI code.

- [ ] **Step 6: Run unit and schema tests**

  Run: `npm run test:unit -- tests/unit/quote-requests-domain.test.ts` and `cross-env RUN_DB_TESTS=1 vitest run tests/integration/quote-requests-schema.test.ts --maxWorkers=1`.

  Expected: PASS with existing schema fixtures unchanged and new nullable fields verified.

- [ ] **Step 7: Commit the contract**

  Run: `git add prisma/schema.prisma prisma/migrations src/server/modules/quote-requests/domain.ts tests/unit/quote-requests-domain.test.ts tests/integration/quote-requests-schema.test.ts && git commit -m "feat: add premium quote intake contracts"`

### Task 2: Extend the transactional public request contract

**Files:**
- Modify: `src/server/modules/quote-requests/service.ts`
- Modify: `src/app/api/quote-requests/route.ts`
- Test: `tests/integration/quote-requests-service.test.ts`
- Test: `tests/integration/quote-requests-api.test.ts`

**Interfaces:**
- `CreateQuoteRequestInput.detail` consumes optional `projectStage`, `dimensions`, `timeline` and `budgetRange`.
- `POST /api/quote-requests` accepts the same optional fields plus the honeypot field and continues to return `{ accepted, folio }` only.

- [ ] **Step 1: Add failing service and API tests**

  Add one service assertion that all four fields persist, one API assertion that invalid enum values return `400`, one API assertion that a non-empty honeypot returns a safe `400`, and one replay assertion that the original folio is returned unchanged.

- [ ] **Step 2: Run focused integration tests and verify failure**

  Run: `npm run test:integration -- tests/integration/quote-requests-service.test.ts tests/integration/quote-requests-api.test.ts`

  Expected: FAIL because the input type/schema/persistence do not accept the new fields.

- [ ] **Step 3: Extend the strict Zod body schema**

  Add optional enum fields, bounded optional dimensions, and a bounded `website` honeypot string. Treat a non-empty honeypot as a controlled validation rejection without revealing anti-abuse internals.

- [ ] **Step 4: Extend the service transaction**

  Normalize optional dimensions, pass controlled enum values through unchanged, and persist them inside the existing transaction with request, history, audit and Outbox.

- [ ] **Step 5: Run the focused integration tests**

  Run: `npm run test:integration -- tests/integration/quote-requests-service.test.ts tests/integration/quote-requests-api.test.ts`.

  Expected: PASS with no change to public response shape or replay behavior.

- [ ] **Step 6: Commit the API contract**

  Run: `git add src/server/modules/quote-requests/service.ts src/app/api/quote-requests/route.ts tests/integration/quote-requests-service.test.ts tests/integration/quote-requests-api.test.ts && git commit -m "feat: extend public quote request intake"`

### Task 3: Surface qualification safely in staff projections

**Files:**
- Modify: `src/server/modules/quote-requests/staff-service.ts`
- Modify: `src/server/modules/quotes/staff-service.ts`
- Modify: `src/components/StaffRequestsPanel.tsx`
- Modify: `src/components/StaffQuotesPanel.tsx`
- Test: `tests/integration/quote-requests-staff.test.ts`
- Test: `tests/integration/quotes-staff-service.test.ts`

**Interfaces:**
- Staff projections return nullable controlled values and `dimensions`, serialized without BigInt or internal hashes.
- UI maps controlled values to Spanish labels through a shared domain map and displays absent values as “No indicado”.

- [ ] **Step 1: Add failing projection tests**

  Persist a fixture containing every new field and assert both staff projections return the values while omitting idempotency hashes and internal-only fields.

- [ ] **Step 2: Run focused projection tests and verify failure**

  Run: `npm run test:integration -- tests/integration/quote-requests-staff.test.ts tests/integration/quotes-staff-service.test.ts`

  Expected: FAIL because projections do not select or serialize the fields.

- [ ] **Step 3: Extend select/mapper contracts**

  Add the fields to the existing detail selections and preserve current pagination, scope and error behavior.

- [ ] **Step 4: Render a compact qualification summary**

  Add an accessible staff detail block for stage, dimensions, timeline and budget range; keep the existing dense workspace and mobile stacking.

- [ ] **Step 5: Run focused tests and typecheck**

  Run: `npm run test:integration -- tests/integration/quote-requests-staff.test.ts tests/integration/quotes-staff-service.test.ts` and `npm run typecheck`.

  Expected: PASS.

- [ ] **Step 6: Commit staff projections**

  Run: `git add src/server/modules/quote-requests/staff-service.ts src/server/modules/quotes/staff-service.ts src/components/StaffRequestsPanel.tsx src/components/StaffQuotesPanel.tsx tests/integration/quote-requests-staff.test.ts tests/integration/quotes-staff-service.test.ts && git commit -m "feat: show quote intake qualification in staff"`

### Task 4: Build the two-step premium browser form

**Files:**
- Modify: `src/components/QuoteForm.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/quality.spec.ts`

**Interfaces:**
- Browser payload adds the optional qualification fields and honeypot while retaining the existing `Idempotency-Key` behavior.
- The component exposes stable accessible labels, step announcements, field errors, back/continue actions and success feedback.

- [ ] **Step 1: Add failing Playwright tests**

  Add coverage for step 1 validation, persistence across back/forward, step 2 qualification fields, first-error focus, honeypot non-rendering, success folio and 390/768/1440 responsive no-overflow.

- [ ] **Step 2: Run the focused E2E test and verify failure**

  Run: `npx playwright test tests/quality.spec.ts --grep "public form|quote intake"`.

  Expected: FAIL because the current single-step form has no step navigation or new fields.

- [ ] **Step 3: Implement the minimal two-step state machine**

  Keep all values in one typed state object; use `step` as `1 | 2`; validate step-specific fields before advancing; preserve values when returning; reset only after successful submission.

- [ ] **Step 4: Add field-level accessible feedback**

  Render errors after attempted advance/submit, connect errors with `aria-describedby`, set `aria-invalid`, and focus the first invalid input using a ref map.

- [ ] **Step 5: Add qualification controls and honeypot**

  Use native select/input controls with visible labels, controlled option values, an off-screen honeypot with `tabIndex={-1}`, and no sensitive data in DOM after successful reset.

- [ ] **Step 6: Refine visual system and responsive behavior**

  Increase label/helper contrast, make focus states unmistakable, add a restrained step indicator, preserve the OCPOOL editorial rhythm, and keep the form readable without rounded-card clutter.

- [ ] **Step 7: Run focused E2E and accessibility tests**

  Run: `npx playwright test tests/quality.spec.ts --grep "public form|quote intake"`.

  Expected: PASS at the required viewports with no serious Axe violations and no console errors.

- [ ] **Step 8: Commit the browser form**

  Run: `git add src/components/QuoteForm.tsx src/app/globals.css tests/quality.spec.ts && git commit -m "feat: upgrade public quote intake form"`

### Task 5: Documentation, regression and phase close

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/local-development.md`
- Modify: `docs/runbooks/auth-surfaces.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `docs/superpowers/plans/2026-09-08-ocpool-premium-quote-intake.md`

**Interfaces:**
- Documentation names the public route, fields, data flow, local worker behavior, known onboarding dependency and testing commands.

- [ ] **Step 1: Update the runbook and README**

  Document the two-step intake, optional qualification fields, honeypot/rate-limit behavior, folio semantics, Mailpit notification behavior and the fact that account onboarding remains a separate dependency.

- [ ] **Step 2: Run full verification**

  Run, in order: `npm run db:validate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:content`, `npm run build`, `npm run test:e2e`, `npm audit --omit=dev --audit-level=high`, `git diff --check`.

  Expected: all required checks pass; any opt-in suites remain explicitly documented rather than silently omitted.

- [ ] **Step 3: Review changed files and update the status matrix**

  Record completed tasks, tests, risks, onboarding dependency and the exact next phase in `PROJECT_STATUS.md`.

- [ ] **Step 4: Commit the phase close**

  Run: `git add README.md docs/runbooks/local-development.md docs/runbooks/auth-surfaces.md PROJECT_STATUS.md docs/superpowers/plans/2026-09-08-ocpool-premium-quote-intake.md && git commit -m "docs: close premium quote intake phase"`
