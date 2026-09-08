# OCPOOL Identity and RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax: - [ ].

**Goal:** Implement the secure identity and authorization foundation required by the customer portal and internal system, with database-backed sessions, RBAC, customer magic links, employee passwords, administrative MFA, recovery tokens, rate limiting and auditable security events.

**Architecture:** Extend the existing modular Next.js monolith with an src/server/auth domain boundary. Prisma remains the source of truth; authorization is evaluated in backend services from the persisted session actor and database permissions, never from client-controlled claims. Authentication endpoints are thin adapters around tested services, and all mutable cookie-authenticated requests pass an origin/CSRF check.

**Tech Stack:** Next.js App Router, TypeScript ESM, Prisma 7.10.0, PostgreSQL 16, Zod, Pino, @node-rs/argon2 2.2.0 for Argon2id password hashes, otpauth 9.5.2 for RFC 6238 TOTP, Node crypto for opaque tokens, AES-256-GCM secret protection and SHA-256 token fingerprints, Vitest, Playwright and Mailpit/outbox events.

**Spec:** docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md, sections 6.1, 8, 9, 13, 14 and 16.

## Global Constraints

- Preserve the public landing page and its existing 29 E2E regression tests.
- Keep PostgreSQL as the only relational target; do not add SQLite fallback logic.
- Keep tokens, password hashes, MFA secrets, cookies and recovery data out of logs and public responses.
- Store only one-way token fingerprints for magic links, recovery tokens and sessions; raw tokens exist only in the issuing response or email event.
- Use Argon2id for employee passwords; do not implement password hashing manually.
- Use HttpOnly, Secure in production, SameSite=Lax cookies with explicit expiry and path.
- Do not put roles, permissions, client ids or authentication state in unsigned client-controlled cookies.
- Customer access is by short-lived, single-use email token; the folio is never an authenticator.
- Administrators must satisfy MFA before receiving an authenticated employee session.
- Every authentication success, denial, failure, token consumption and session revocation creates an auth_events record without secrets.
- Rate limiting must work with PostgreSQL alone; do not add Redis in this phase.
- Mutable cookie-authenticated routes must validate same-origin requests; reject cross-origin Origin values before business work.
- Every task has a red-green test cycle and a logical commit.

## Scope and non-scope

This phase delivers the reusable authentication and authorization boundary. It includes a minimal Client identity owner so customer users can be scoped without an untyped foreign key. It does not implement quote requests, expedients, dashboards, customer case pages, employee work queues, catalog or quote builder screens; later phases consume these identity contracts.

## File map

### Create

- src/server/auth/constants.ts — canonical role keys, permission keys, token types, session policy and cookie names.
- src/server/auth/crypto.ts — Argon2id passwords, opaque token generation/fingerprints and AES-256-GCM helpers.
- src/server/auth/permissions.ts — permission evaluation and backend guards.
- src/server/auth/rate-limit.ts — PostgreSQL-backed authentication rate-limit service.
- src/server/auth/mfa.ts — TOTP enrollment, encryption and verification.
- src/server/auth/sessions.ts — session creation, lookup, rotation, revocation and cookie serialization.
- src/server/auth/tokens.ts — magic-link and recovery token issuance/consumption.
- src/server/auth/service.ts — employee login, customer magic-link request/consume and recovery orchestration.
- src/server/auth/csrf.ts — same-origin validation for cookie-authenticated mutations.
- src/server/auth/types.ts — actor and service result types shared by route adapters.
- src/app/api/auth/employee/login/route.ts — employee login adapter.
- src/app/api/auth/customer/request-link/route.ts — non-enumerating customer link request adapter.
- src/app/api/auth/customer/consume-link/route.ts — single-use customer link consumption adapter.
- src/app/api/auth/session/route.ts — current session and logout adapter.
- src/app/api/auth/recovery/request/route.ts — non-enumerating recovery request adapter.
- src/app/api/auth/recovery/consume/route.ts — password reset token consumption adapter.
- tests/unit/auth-crypto.test.ts — password, token and secret-protection tests.
- tests/unit/auth-permissions.test.ts — role/permission matrix tests.
- tests/unit/auth-mfa.test.ts — TOTP enrollment and verification tests.
- tests/unit/auth-rate-limit.test.ts — rate-limit decision tests with a fake repository.
- tests/unit/auth-csrf.test.ts — origin validation tests.
- tests/integration/identity-rbac.test.ts — Prisma schema, seed, sessions, tokens, events and authorization integration tests.
- tests/auth.spec.ts — opt-in Playwright API flow for employee/customer authentication.
- generated Prisma migration directory for identity and RBAC — reviewed SQL migration created by the CLI.

### Modify

- package.json and package-lock.json — Argon2id/TOTP dependencies and identity test scripts.
- .env.example — MFA encryption key and authentication policy values.
- src/server/env.ts — validated identity environment values.
- prisma/schema.prisma — users, clients, roles, permissions, sessions, tokens, events and rate-limit buckets.
- prisma/seed.ts — idempotent role/permission catalog and schema version.
- README.md — identity environment and local test instructions.
- docs/runbooks/local-development.md — identity troubleshooting and disposable test data notes.
- PROJECT_STATUS.md — phase progress, evidence, risks and next dependencies.

## Domain contracts

### Database models

Add relational models with UUID primary keys and explicit indexes:

~~~prisma
enum UserType { CUSTOMER EMPLOYEE }
enum UserStatus { INVITED ACTIVE SUSPENDED DISABLED }
enum ClientStatus { ACTIVE ARCHIVED }
enum AuthTokenType { MAGIC_LINK PASSWORD_RESET MFA_RECOVERY }
enum AuthEventType { LOGIN_SUCCESS LOGIN_FAILURE LOGOUT MAGIC_LINK_REQUEST MAGIC_LINK_CONSUMED PASSWORD_RESET_REQUEST PASSWORD_RESET_CONSUMED MFA_ENROLLED MFA_CHALLENGE MFA_FAILURE SESSION_CREATED SESSION_REVOKED }
enum AuthEventOutcome { SUCCESS DENIED FAILURE }

model Client {
  id          String       @id @default(uuid()) @db.Uuid
  displayName String       @db.VarChar(180)
  status      ClientStatus @default(ACTIVE)
  createdAt   DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime     @updatedAt @db.Timestamptz(3)
  users       User[]
  @@index([status, createdAt])
  @@map("clients")
}

model User {
  id                  String       @id @default(uuid()) @db.Uuid
  email               String       @db.VarChar(320)
  emailNormalized     String       @unique @db.VarChar(320)
  displayName         String       @db.VarChar(180)
  type                UserType
  status              UserStatus   @default(INVITED)
  passwordHash        String?      @db.VarChar(255)
  mfaRequired         Boolean      @default(false)
  mfaSecretCiphertext String?      @db.VarChar(512)
  mfaEnrolledAt       DateTime?    @db.Timestamptz(3)
  clientId            String?      @db.Uuid
  client              Client?      @relation(fields: [clientId], references: [id], onDelete: Restrict)
  roles               UserRole[]
  sessions            Session[]
  authTokens          AuthToken[]
  authEvents          AuthEvent[]
  createdAt           DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime     @updatedAt @db.Timestamptz(3)
  @@index([clientId, status])
  @@index([type, status])
  @@map("users")
}

model Role {
  id            String           @id @default(uuid()) @db.Uuid
  key           String           @unique @db.VarChar(80)
  name          String           @db.VarChar(120)
  description   String           @db.VarChar(300)
  systemManaged Boolean          @default(true)
  userRoles     UserRole[]
  permissions   RolePermission[]
  createdAt     DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime         @updatedAt @db.Timestamptz(3)
  @@map("roles")
}

model Permission {
  id          String           @id @default(uuid()) @db.Uuid
  key         String           @unique @db.VarChar(120)
  description String           @db.VarChar(300)
  roles       RolePermission[]
  createdAt   DateTime         @default(now()) @db.Timestamptz(3)
  @@map("permissions")
}

model UserRole {
  userId     String   @db.Uuid
  roleId     String   @db.Uuid
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  @@id([userId, roleId])
  @@index([roleId, userId])
  @@map("user_roles")
}

model RolePermission {
  roleId       String     @db.Uuid
  permissionId String     @db.Uuid
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now()) @db.Timestamptz(3)
  @@id([roleId, permissionId])
  @@index([permissionId, roleId])
  @@map("role_permissions")
}

model Session {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @db.Uuid
  tokenHash  String    @unique @db.VarChar(64)
  createdAt  DateTime  @default(now()) @db.Timestamptz(3)
  expiresAt  DateTime  @db.Timestamptz(3)
  lastSeenAt DateTime  @default(now()) @db.Timestamptz(3)
  revokedAt  DateTime? @db.Timestamptz(3)
  ipAddress  String?   @db.VarChar(64)
  userAgent  String?   @db.VarChar(512)
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, revokedAt, expiresAt])
  @@index([expiresAt])
  @@map("sessions")
}

model AuthToken {
  id             String         @id @default(uuid()) @db.Uuid
  userId         String         @db.Uuid
  type           AuthTokenType
  tokenHash      String         @unique @db.VarChar(64)
  expiresAt      DateTime       @db.Timestamptz(3)
  consumedAt     DateTime?      @db.Timestamptz(3)
  createdAt      DateTime       @default(now()) @db.Timestamptz(3)
  requestedIp    String?        @db.VarChar(64)
  userAgent      String?        @db.VarChar(512)
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, type, expiresAt])
  @@index([type, consumedAt, expiresAt])
  @@map("auth_tokens")
}

model AuthEvent {
  id             String            @id @default(uuid()) @db.Uuid
  userId         String?           @db.Uuid
  eventType      AuthEventType
  outcome        AuthEventOutcome
  identifierHash String?           @db.VarChar(64)
  ipAddress      String?           @db.VarChar(64)
  userAgent      String?           @db.VarChar(512)
  metadata       Json?
  createdAt      DateTime          @default(now()) @db.Timestamptz(3)
  user           User?             @relation(fields: [userId], references: [id], onDelete: SetNull)
  @@index([userId, createdAt])
  @@index([eventType, createdAt])
  @@index([identifierHash, createdAt])
  @@map("auth_events")
}

model AuthRateLimit {
  id            String   @id @default(uuid()) @db.Uuid
  scope         String   @db.VarChar(80)
  keyHash       String   @db.VarChar(64)
  windowStarted DateTime @db.Timestamptz(3)
  attempts      Int      @default(0)
  blockedUntil  DateTime? @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @db.Timestamptz(3)
  @@unique([scope, keyHash])
  @@index([blockedUntil])
  @@map("auth_rate_limits")
}
~~~

Roles and permissions use composite join keys, not comma-separated role values. Sessions store only a SHA-256 token hash. Auth tokens store type, hash, expiry and consumption timestamp. Auth events store action, outcome, user/email fingerprint, IP/user agent and safe metadata. A unique (scope, keyHash) rate bucket and an index on blockedUntil support local rate limiting.

### Permission catalog

Seed this exact initial catalog idempotently:

~~~text
identity.session.read
identity.session.revoke
identity.users.read
identity.users.manage
identity.roles.manage
portal.self.read
portal.self.authenticate
quotes.read
quotes.create
quotes.edit_prices
quotes.apply_discount
quotes.approve_discount
quotes.send
metrics.read
~~~

Seed roles with least privilege:

- customer: portal.self.read, portal.self.authenticate, identity.session.read.
- sales: session read/revoke, users read, portal self read, quotes read/create/send.
- manager: sales permissions plus quotes.edit_prices, quotes.apply_discount, quotes.approve_discount, metrics.read.
- admin: every permission plus identity.users.manage, identity.roles.manage and mandatory MFA.

The permission catalog is a versioned application constant and a relational seed. A role key is stable; display names may be translated later.

### Environment contract

Extend readServerEnv() with:

~~~ts
MFA_ENCRYPTION_KEY: string;       // base64-encoded 32-byte key
SESSION_TTL_HOURS: number;        // integer, 1..168, default 24
AUTH_TOKEN_TTL_MINUTES: number;   // integer, 5..30, default 15
AUTH_RATE_LIMIT_MAX_ATTEMPTS: number; // integer, 3..20, default 5
AUTH_RATE_LIMIT_WINDOW_MINUTES: number; // integer, 1..60, default 15
~~~

The parser must reject malformed keys and out-of-range values. .env.example contains a clearly marked local-only development key; production must inject a unique secret through the deployment secret manager.

## Service interfaces

Use dependency injection for Prisma, clock, random token generation and rate-limit repository so security behavior can be tested without waiting or network calls.

~~~ts
type Actor = {
  userId: string;
  type: 'CUSTOMER' | 'EMPLOYEE';
  clientId: string | null;
  permissionKeys: ReadonlySet<string>;
  mfaVerified: boolean;
};

function hasPermission(actor: Actor, permission: string): boolean;
function requirePermission(actor: Actor, permission: string): void;

function createSession(input: {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ sessionId: string; rawToken: string; expiresAt: Date }>;

function getActorFromRequest(request: Request): Promise<Actor | null>;
function revokeSession(sessionId: string, reason: string): Promise<void>;

function issueMagicLink(input: {
  emailNormalized: string;
  userId: string;
  ipAddress: string | null;
}): Promise<{ rawToken: string; expiresAt: Date }>;
function consumeSingleUseToken(rawToken: string, type: 'MAGIC_LINK' | 'PASSWORD_RESET'): Promise<{ userId: string }>;
~~~

No service returns password hashes, MFA ciphertext, token hashes or unrestricted Prisma records to route handlers.

## API behavior

All request bodies use Zod schemas with strict field limits. Public errors use the existing safe envelope and always include a request id.

- POST /api/auth/employee/login: accepts email, password and optional mfaCode; returns a generic 401 for unknown, disabled, wrong-password or incomplete-MFA cases; successful login sets the session cookie. Admins cannot receive a session without valid TOTP.
- POST /api/auth/customer/request-link: accepts email; always returns the same 202 response whether the email exists or not; only existing active customer users enqueue an outbox event.
- POST /api/auth/customer/consume-link: accepts the raw token once, validates expiry/type/consumption and sets a customer session.
- GET /api/auth/session: returns a minimal current actor projection or 401; never returns token data.
- POST /api/auth/session: validates same origin, revokes the current session and clears the cookie; repeat logout is idempotent.
- POST /api/auth/recovery/request: always returns the same 202 response; creates a short-lived one-use password-reset event only for eligible employee accounts.
- POST /api/auth/recovery/consume: validates the token, Argon2id-hashes the new password, revokes all existing sessions and consumes the token in one transaction.

Mutable routes use Origin validation against APP_URL and the request host fallback. Missing Origin is accepted only for non-browser server-to-server requests that do not carry the session cookie; cookie-authenticated mutations require an origin.

## Security test matrix

Unit tests must cover:

- Argon2id hash verification and rejection of wrong passwords.
- Opaque token fingerprint non-reversibility and expiry boundaries.
- AES-GCM encrypt/decrypt and authentication-tag tamper rejection.
- Permission matrix and denied default.
- Admin MFA required, valid TOTP accepted, invalid/replayed window rejected.
- Rate-limit thresholds, reset window and blocked state.
- Same-origin accepted, foreign origin rejected, malformed origin rejected.

Integration tests must cover:

- Migration/seed creates exactly one catalog row per role/permission and is idempotent.
- Customer session cannot load an employee user; employee session cannot become a customer by editing a cookie.
- Revoked and expired sessions fail lookup.
- Magic link and password reset tokens are single-use, hashed at rest and expire.
- Recovery revokes prior sessions in the same transaction.
- Auth events contain no raw token, password, MFA secret or SQL.
- Rate-limit rows behave correctly against PostgreSQL.

API/E2E tests must cover:

- Employee success, wrong password, suspended account and admin without/with MFA.
- Customer request-link non-enumeration and successful one-use consumption.
- Logout, session inspection and recovery.
- Foreign origin rejection and cookie security attributes.
- Opt-in Playwright flow through /api/auth/* with a disposable fixture account; default landing E2E remains green and identity E2E is skipped unless AUTH_E2E=1.

## Task sequence

### Task 1: Add identity dependencies, environment contract and schema migration

Files: package.json, package-lock.json, .env.example, src/server/env.ts, prisma/schema.prisma, tests/unit/env.test.ts, tests/integration/identity-rbac.test.ts, generated Prisma migration.

- [ ] Write failing environment tests for the encryption key and numeric policy ranges.
- [ ] Install only @node-rs/argon2@2.2.0 and otpauth@9.5.2.
- [ ] Add the identity enums/models and indexes shown above; preserve all foundation models.
- [ ] Generate, inspect and apply a named migration; do not hand-write SQL or rename an applied migration.
- [ ] Add integration assertions for tables, enum values and uniqueness constraints.
- [ ] Run unit, integration, db:validate, db:generate, git diff --check and the existing landing regression.
- [ ] Commit feat: add identity and rbac schema foundation.

### Task 2: Implement crypto, permission catalog and idempotent seed

Files: src/server/auth/constants.ts, src/server/auth/crypto.ts, src/server/auth/permissions.ts, prisma/seed.ts, tests/unit/auth-crypto.test.ts, tests/unit/auth-permissions.test.ts, tests/integration/identity-rbac.test.ts.

- [ ] Write red tests for password verification, token fingerprinting, secret tamper rejection and permission denial.
- [ ] Implement Argon2id password helpers with fixed parameters documented in the source, SHA-256 opaque token fingerprints using constant-time comparisons, and AES-256-GCM MFA secret encryption with random IVs.
- [ ] Implement permission guards that deny by default and never read authorization from request JSON or cookies.
- [ ] Seed roles and permissions with upsert/join synchronization without deleting custom future records.
- [ ] Run focused unit and integration tests plus npm run db:seed twice.
- [ ] Commit feat: add identity crypto and permission catalog.

### Task 3: Implement sessions, tokens, MFA and rate limiting

Files: src/server/auth/types.ts, src/server/auth/sessions.ts, src/server/auth/tokens.ts, src/server/auth/mfa.ts, src/server/auth/rate-limit.ts, tests/unit/auth-mfa.test.ts, tests/unit/auth-rate-limit.test.ts, tests/integration/identity-rbac.test.ts.

- [ ] Write red tests for session expiry/rotation/revocation, one-use token consumption, TOTP verification and rate-limit boundaries.
- [ ] Implement DB-backed session lookup with token hash, expiry and revocation checks; refresh lastSeenAt without extending expiry beyond the policy.
- [ ] Serialize only the opaque session token into a cookie named ocpool_session with HttpOnly, SameSite=Lax, Secure in production, path / and explicit max age.
- [ ] Implement TOTP enrollment using otpauth, encrypt the secret before persistence, require verification before marking enrollment complete, and enforce MFA for admin sessions.
- [ ] Implement PostgreSQL-backed rate limiting with bounded identifiers (normalized email/IP), a fixed window, safe generic responses and no user enumeration.
- [ ] Run focused unit/integration tests and review logs for secret absence.
- [ ] Commit feat: add sessions tokens mfa and auth rate limiting.

### Task 4: Add auth orchestration and safe API adapters

Files: src/server/auth/service.ts, src/server/auth/csrf.ts, auth route handlers under src/app/api/auth/, tests/unit/auth-csrf.test.ts, tests/integration/identity-rbac.test.ts.

- [ ] Write failing API/integration tests for generic login errors, admin MFA, magic-link consumption, recovery revocation, logout and origin rejection.
- [ ] Implement orchestration transactions that create auth events and outbox events without putting raw tokens in payloads.
- [ ] Add strict Zod request schemas, generic timing-conscious responses, request ids and existing safe error envelopes.
- [ ] Apply same-origin checks before mutating cookie-authenticated work and return 403 without touching protected data.
- [ ] Set/clear cookies only after successful transaction completion; clear them on logout and failed session lookup.
- [ ] Run unit, integration, build and test:e2e:foundation; add opt-in test:e2e:auth script.
- [ ] Commit feat: add identity authentication api.

### Task 5: Hardening, documentation and phase gate

Files: tests/auth.spec.ts, README.md, docs/runbooks/local-development.md, PROJECT_STATUS.md, package.json.

- [ ] Add opt-in Playwright API flows with disposable fixtures and negative assertions for enumeration, IDOR-like cookie tampering, foreign origin, expired token and revoked session.
- [ ] Document local identity fixtures, environment key handling, Mailpit/outbox inspection, session invalidation and safe reset rules; never document a production secret.
- [ ] Run the phase gate from clean dependencies: npm ci, db:up, db:validate, db:generate, db:migrate:deploy, db:seed, npm test, npm run test:e2e:auth, npm run test:content, git diff --check.
- [ ] Run npm audit --omit=dev and record exact output; do not use a forced downgrade to conceal unresolved Prisma advisories.
- [ ] Update PROJECT_STATUS.md only if all identity criteria pass; otherwise record the exact blocker and leave Fase 2 open.
- [ ] Commit docs: close identity and rbac phase only after the gate passes.

## Fase 2 done criteria

Fase 2 is complete only when:

- users, clients, roles, permissions, sessions, tokens, auth events and rate limits are relationally migrated and seeded idempotently;
- customer magic links and employee passwords are usable through tested APIs;
- administrator MFA is enforced before session creation;
- session cookies are secure and the server resolves actors from persisted state;
- recovery consumes one-use tokens and revokes old sessions transactionally;
- permissions deny by default and are enforced by backend services;
- origin/CSRF checks and rate limits have negative tests;
- raw tokens, passwords and MFA secrets never appear in database rows, logs or responses;
- unit, integration, API/E2E and existing landing regression tests pass;
- README, runbook and PROJECT_STATUS.md contain evidence, risks, dependencies and the next authorized phase.
