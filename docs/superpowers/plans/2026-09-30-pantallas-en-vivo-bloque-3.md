# Pantallas en vivo y "Visto por el cliente" (bloque 3) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que las pantallas abiertas se pongan al día solas cuando algo cambia en un expediente (mensajes, archivos, estado, responsable, cotización, aprobaciones, proyecto) y que el equipo vea "Visto" cuando el cliente leyó su último mensaje.

**Architecture:**
- **Servidor.** Cada evento de dominio que toca un expediente publica, en la misma transacción, la señal `r`: identificadores, las partes que cambiaron, si el cliente puede verlo (`C`/`I`) y quién lo hizo. La tabla evento → partes vive en un solo módulo y una prueba la mantiene exhaustiva.
- **Hub.** Reenvía `r` como evento SSE `request` sólo a quien puede ver el expediente, y le dice a cada conexión si el cambio fue suyo (`self`).
- **Navegador.** El proveedor de la bandeja reparte los eventos a las vistas suscritas por expediente y parte (`useRealtimeRequest`). Cada vista relee en silencio, o avisa sin recargar cuando la persona está a media tarea.

**Tech Stack:** Next.js 15, React 19, PostgreSQL `pg_notify`, SSE y vitest/Playwright (lo mismo que el bloque 2).

**Spec:** `docs/superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md`: §4.1 (señal `r`), §4.2 (alcance de `r`), §4.3 (evento `request`), §4.4 (suscripciones; sin canal, relectura al volver a la pestaña), §5.3 (supresión por contexto), §5.4 (pantallas en vivo y "Visto") y §13 (pruebas).

## Global Constraints

**Entorno y rama**
- Se trabaja en `C:\Desarrollo\WEBS\OCPOOL-WEB`, rama `feat/notificaciones-tiempo-real`, con commit por tarea y **sin push**.
- Las ediciones por script se hacen con `node` y respetan CRLF; los scripts se escriben con la herramienta Write.
- No se detiene el `npm run dev` del usuario. La QA en navegador corre en :3010 (`NEXT_DIST_DIR=.next-qa`) y al terminar se restaura `tsconfig.json`, se borra `.next-qa/` y se quita la entrada de `.claude/launch.json`.
- Nunca se usan los fixtures del piloto. Mientras la E2E completa construye o corre, no se tocan `src/`, `tests/`, `scripts/` ni `.claude/`.

**Protocolo**
- La señal lleva sólo identificadores: `{ t: 'r', r, c, a, pa?, b?, p, v }`, con `p` ⊆ `created | messages | files | status | assignment | quote | approvals | read | project`.
- Viajan como `v: 'I'`: notas internas, archivos internos, aprobaciones, borradores, asignaciones y la lectura del cliente.
- Alcance (spec §4.2):
  - equipo con `requests.read.global`: siempre;
  - resto del equipo: si `a` es null o si `a`/`pa` es la propia persona;
  - cliente: sólo si `c` es su cliente y `v` es `C`.
- El evento SSE es `request` con `{ requestId, parts, self, at }` y no lleva `id:`: no se reanuda. Tras reconectar, las vistas releen.

**Comportamiento de las vistas (spec §5.4)**
- Una relectura en vivo nunca muestra esqueleto ni borra lo que la persona está escribiendo o eligiendo.
- Un cambio hecho por la propia persona (`self`) no se trata como novedad, porque su propia acción ya actualizó la vista.
- Si una vista no puede recargarse sin estorbar (cotización con cambios sin guardar o un diálogo abierto, lista desplazada), avisa y deja que la persona actualice.

**Calidad**
- Al final de cada tarea: `npx tsc --noEmit`, lint de lo tocado y las pruebas de la tarea. La integración usa `RUN_DB_TESTS=1`.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/server/realtime/publish.ts` | Señal `r`, `REQUEST_PARTS` y decodificador |
| `src/server/modules/inbox/realtime-signals.ts` (nuevo) | Tabla evento → partes y visibilidad; `requestSignalFor` y `publishRequestChange` |
| `src/server/modules/inbox/domain-events.ts` | `signalRequestChange` dentro de un SAVEPOINT; la emiten `recordDomainEvent` y `notifyInbox` |
| `src/server/modules/quote-requests/staff-service.ts`, `src/server/modules/team/service.ts` | Señal al editar datos del expediente y al reasignar por suspensión |
| `src/server/modules/messaging/service.ts` | Lectura del cliente (marca y señal `read`), `customerRead` y `latestCursor` |
| `src/server/realtime/hub.ts` | Evento `request` con alcance y `self` |
| `src/lib/realtime-client.ts` | Evento `request` en el cliente |
| `src/lib/realtime-subscriptions.ts` (nuevo) | Registro de suscripciones por expediente y parte |
| `src/lib/live-thread.ts` (nuevo) | Unir mensajes nuevos y "Visto" |
| `src/lib/load-latest-messages.ts` | Conserva los campos de la última página |
| `src/components/inbox/InboxProvider.tsx`, `useRealtimeRequest.ts` (nuevo) | Reparto a las vistas, contexto activo y relectura al volver sin canal |
| `src/components/StaffMessagingPanel.tsx`, `ClientMessagingThread.tsx` | Hilos en vivo, "Nuevo", píldora y "Visto" |
| `src/components/StaffFilesPanel.tsx`, `ClientFilesPanel.tsx` | Archivos en vivo |
| `src/components/StaffRequestsPanel.tsx`, `RequestWorkspaceDetailV2.tsx`, `RequestWorkspaceV2Panel.tsx` | Detalle y bandeja en vivo |
| `src/components/ClientPortalPanel.tsx` | Riel y expediente del portal en vivo |
| `src/components/StaffDashboardPanel.tsx`, `StaffApprovalsPanel.tsx`, `StaffQuotesPanel.tsx` | Colas, aprobaciones y cotizador en vivo |
| `src/components/private/ui/private-surfaces.css` | "Nuevo", píldora, "Visto" y "Actualizado hace un momento" |

**Pruebas nuevas**
- Unitarias: `realtime-request-signals`, `realtime-subscriptions` y `live-thread`, más casos nuevos en `realtime-hub`, `realtime-client` y `load-latest-messages`.
- Integración: `realtime-request-signals` y `messaging-customer-read`, más un caso en `realtime-api`.
- E2E: `tests/realtime-screens.spec.ts` (`REALTIME_E2E=1`).

---

### Task 1: Señal `r`: protocolo, tabla por evento y emisión al confirmar

**Files:**
- Modify: `src/server/realtime/publish.ts` y `src/server/modules/inbox/domain-events.ts`
- Create: `src/server/modules/inbox/realtime-signals.ts`
- Modify: `src/server/modules/quote-requests/staff-service.ts` (`updateStaffQuoteRequest`) y `src/server/modules/team/service.ts` (`suspendTeamMember`)
- Test: `tests/unit/realtime-request-signals.test.ts` y `tests/integration/realtime-request-signals.test.ts`

**Interfaces:**
- Produces:
  - `REQUEST_PARTS`, `type RequestPart` y `type RequestVisibility = 'C' | 'I'`.
  - `RealtimeSignal` con la variante `{ t: 'r'; r; c; a: string | null; pa?; b?; p: readonly RequestPart[]; v }`.
  - `REQUEST_SIGNAL_RULES: Readonly<Record<string, RequestSignalRule | null>>`.
  - `requestSignalFor(event): RequestSignalIntent | null`.
  - `publishRequestChange(client, input)` y `signalRequestChange(tx, input)`.

- [ ] **Step 1: Pruebas unitarias**

Crear `tests/unit/realtime-request-signals.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUEST_PARTS as CLIENT_PARTS } from '@/lib/realtime-client';
import { REQUEST_SIGNAL_RULES, requestSignalFor } from '@/server/modules/inbox/realtime-signals';
import { decodeRealtimeSignal, encodeRealtimeSignal, REQUEST_PARTS } from '@/server/realtime/publish';

const REQUEST = '8d4e5f60-7182-4d9e-9fa0-2b3c4d5e6f70';
const CLIENT = '9e5f6071-8293-4eaf-a0b1-3c4d5e6f7081';
const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('request signals', () => {
  it('decodes only well-formed request signals', () => {
    const signal = { t: 'r', r: REQUEST, c: CLIENT, a: null, b: USER, p: ['messages', 'files'], v: 'C' } as const;
    expect(decodeRealtimeSignal(encodeRealtimeSignal(signal))).toEqual(signal);
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, a: USER, pa: USER, p: ['messages', 'nope', 'messages'] }))).toEqual({ ...signal, a: USER, pa: USER, p: ['messages'] });
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, p: ['nope'] }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, v: 'X' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, a: 'nope' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, pa: 'nope' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ ...signal, c: undefined }))).toBeNull();
  });

  it('shares the list of parts with the browser', () => {
    expect([...CLIENT_PARTS]).toEqual([...REQUEST_PARTS]);
  });

  it('knows the parts and the visibility of each event', () => {
    const message = (visibility: string) => requestSignalFor({ eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: USER, payload: { quoteRequestId: REQUEST, visibility } });
    expect(message('CUSTOMER')).toEqual({ requestId: REQUEST, parts: ['messages'], visibility: 'C', previousAssigneeId: null });
    expect(message('INTERNAL')).toMatchObject({ visibility: 'I' });
    expect(requestSignalFor({ eventType: 'REQUEST.ASSIGNED', aggregateType: 'QUOTE_REQUEST', aggregateId: REQUEST, payload: { previousAssigneeId: USER } })).toEqual({ requestId: REQUEST, parts: ['assignment'], visibility: 'I', previousAssigneeId: USER });
    expect(requestSignalFor({ eventType: 'QUOTE.VERSION_REJECTED', aggregateType: 'QUOTE', aggregateId: USER, payload: { quoteRequestId: REQUEST, fromStatus: 'ENVIADA' } })).toMatchObject({ visibility: 'C' });
    expect(requestSignalFor({ eventType: 'QUOTE.VERSION_REJECTED', aggregateType: 'QUOTE', aggregateId: USER, payload: { quoteRequestId: REQUEST, fromStatus: 'EN_REVISION' } })).toMatchObject({ visibility: 'I' });
    expect(requestSignalFor({ eventType: 'PRICES.PENDING_RESOLVED', aggregateType: 'PRICE_LIST', aggregateId: USER, payload: {} })).toBeNull();
    expect(requestSignalFor({ eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: USER, payload: {} })).toBeNull();
  });

  it('covers every event type the server emits', () => {
    const emitted = new Set<string>();
    for (const file of sourceFiles(path.resolve('src/server'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/'((?:AUTH|CATALOG|CONVERSATION|EMAIL|FILE|MESSAGE|PRICES|PROJECT|QUOTE|REQUEST|TEAM)\.[A-Z_]+)'/gu)) emitted.add(match[1]);
    }
    const missing = [...emitted].filter((eventType) => !(eventType in REQUEST_SIGNAL_RULES));
    expect(missing).toEqual([]);
  });
});
```

Run: `npx vitest run tests/unit/realtime-request-signals.test.ts`
Expected: FAIL (no existen `REQUEST_PARTS`, `realtime-signals` ni el `REQUEST_PARTS` del cliente).

- [ ] **Step 2: Protocolo**

En `src/server/realtime/publish.ts`:
1. Después de `export const REALTIME_CHANNEL = 'ocpool_realtime';`, agrega:

```ts
/** Partes de un expediente que una pantalla puede estar mostrando (spec §4.1). */
export const REQUEST_PARTS = ['created', 'messages', 'files', 'status', 'assignment', 'quote', 'approvals', 'read', 'project'] as const;
export type RequestPart = (typeof REQUEST_PARTS)[number];
/** `C`: el cliente puede verlo; `I`: sólo el equipo. */
export type RequestVisibility = 'C' | 'I';
```

2. En `RealtimeSignal`, después de la variante `s`, agrega:

```ts
  /** Cambió algo del expediente `r` (cliente `c`, responsable `a`, anterior `pa`, autor `b`). Sin contenido. */
  | Readonly<{ t: 'r'; r: string; c: string; a: string | null; pa?: string; b?: string; p: readonly RequestPart[]; v: RequestVisibility }>;
```

(y quita el `;` que cerraba la variante `s`).

3. Después de `const NOTIFICATION_MODES…`, agrega:

```ts
const PART_SET: ReadonlySet<string> = new Set(REQUEST_PARTS);

/** undefined = ausente; null = presente pero inválido. */
function optionalUuid(value: Readonly<Record<string, unknown>>, key: string): string | null | undefined {
  return value[key] === undefined ? undefined : uuidField(value, key);
}

function decodeRequestSignal(value: Readonly<Record<string, unknown>>): RealtimeSignal | null {
  const requestId = uuidField(value, 'r');
  const clientId = uuidField(value, 'c');
  const assigneeId = value.a === null ? null : uuidField(value, 'a');
  const previousAssigneeId = optionalUuid(value, 'pa');
  const actorId = optionalUuid(value, 'b');
  const parts = Array.isArray(value.p) ? [...new Set(value.p.filter((part): part is RequestPart => typeof part === 'string' && PART_SET.has(part)))] : [];
  if (!requestId || !clientId || (value.a !== null && !assigneeId) || previousAssigneeId === null || actorId === null) return null;
  if (parts.length === 0 || (value.v !== 'C' && value.v !== 'I')) return null;
  return { t: 'r', r: requestId, c: clientId, a: assigneeId, ...(previousAssigneeId ? { pa: previousAssigneeId } : {}), ...(actorId ? { b: actorId } : {}), p: parts, v: value.v };
}
```

4. En `decodeRealtimeSignal`, justo después de `const value = parsed as Record<string, unknown>;`, agrega `if (value.t === 'r') return decodeRequestSignal(value);`.

En `src/lib/realtime-client.ts`, después de `export type RealtimeMode = …;`, agrega:

```ts
/** La misma lista que `REQUEST_PARTS` del servidor (una prueba lo comprueba). */
export const REQUEST_PARTS = ['created', 'messages', 'files', 'status', 'assignment', 'quote', 'approvals', 'read', 'project'] as const;
export type RequestPart = (typeof REQUEST_PARTS)[number];
```

- [ ] **Step 3: Tabla por evento**

Crear `src/server/modules/inbox/realtime-signals.ts`:

```ts
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { publishRealtime, type RequestPart, type RequestVisibility } from '@/server/realtime/publish';
import { uuidOf } from './audience';
import type { DomainEventInput } from './rules/types';

type Payload = Readonly<Record<string, unknown>>;
type RequestSignalRule = Readonly<{ parts: readonly RequestPart[]; visibility: RequestVisibility | ((payload: Payload) => RequestVisibility) }>;

export type RequestSignalIntent = Readonly<{ requestId: string; parts: readonly RequestPart[]; visibility: RequestVisibility; previousAssigneeId: string | null }>;

const byVisibilityField = (payload: Payload): RequestVisibility => (payload.visibility === 'INTERNAL' ? 'I' : 'C');
const SENT_VERSION_STATUSES: ReadonlySet<string> = new Set(['ENVIADA', 'EN_NEGOCIACION']);

/**
 * Qué parte del expediente cambia con cada evento y si el cliente puede verla (spec §4.1). `null` = el evento no
 * cambia nada que una pantalla de expediente muestre. Una prueba recorre el código y exige que cada tipo esté aquí.
 */
export const REQUEST_SIGNAL_RULES: Readonly<Record<string, RequestSignalRule | null>> = {
  'REQUEST.RECEIVED': { parts: ['created'], visibility: 'C' },
  'REQUEST.ASSIGNED': { parts: ['assignment'], visibility: 'I' },
  'REQUEST.STATUS_CHANGED': { parts: ['status'], visibility: 'C' },
  'REQUEST.CUSTOMER_RESPONSE': { parts: ['status'], visibility: 'I' },
  'MESSAGE.CREATED': { parts: ['messages'], visibility: byVisibilityField },
  'CONVERSATION.STATUS_CHANGED': { parts: ['messages'], visibility: 'C' },
  'FILE.AVAILABLE': { parts: ['files'], visibility: byVisibilityField },
  'FILE.DELETED': { parts: ['files'], visibility: byVisibilityField },
  'FILE.UPLOAD_RESERVED': null,
  'FILE.RESERVATION_EXPIRED': null,
  'QUOTE.VERSION_CREATED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_UPDATED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_SUBMITTED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_REOPENED': { parts: ['quote'], visibility: 'I' },
  'QUOTE.VERSION_STATUS_CHANGED': { parts: ['quote'], visibility: 'I' },
  // Rechazar una versión que el cliente ya tenía cambia su propuesta; rechazarla en revisión, no.
  'QUOTE.VERSION_REJECTED': { parts: ['quote'], visibility: (payload) => (SENT_VERSION_STATUSES.has(String(payload.fromStatus)) ? 'C' : 'I') },
  'QUOTE.PUBLISHED': { parts: ['quote'], visibility: 'C' },
  'QUOTE.PDF_READY': { parts: ['quote'], visibility: 'I' },
  'QUOTE.APPROVAL_REQUESTED': { parts: ['approvals'], visibility: 'I' },
  'QUOTE.APPROVAL_RESOLVED': { parts: ['approvals', 'quote'], visibility: 'I' },
  'QUOTE.ACCEPTED': { parts: ['quote', 'status'], visibility: 'C' },
  'PROJECT.CREATED': { parts: ['project'], visibility: 'C' },
  'PROJECT.OWNER_CHANGED': null,
  'TEAM.WORK_REASSIGNED': null,
  'PRICES.PENDING_RESOLVED': null,
  'PRICES.ITEM_CREATED': null,
  'PRICES.ITEM_SCHEDULED': null,
  'PRICES.ITEM_UPDATED': null,
  'PRICES.LIST_CREATED': null,
  'PRICES.LIST_UPDATED': null,
  'CATALOG.CATEGORY_CREATED': null,
  'CATALOG.CATEGORY_UPDATED': null,
  'CATALOG.ITEM_CREATED': null,
  'CATALOG.ITEM_UPDATED': null,
  'CATALOG.SPECIAL_CONCEPT_PROMOTED': null,
  'EMAIL.DELIVERY_FAILED': null,
  'EMAIL.DELIVERY_RECOVERED': null,
  'AUTH.CUSTOMER_MAGIC_LINK': null,
  'AUTH.EMPLOYEE_INVITATION': null,
  'AUTH.EMPLOYEE_PASSWORD_RESET': null,
};

export function requestSignalFor(event: Pick<DomainEventInput, 'eventType' | 'aggregateType' | 'aggregateId' | 'payload'>): RequestSignalIntent | null {
  const rule = REQUEST_SIGNAL_RULES[event.eventType];
  if (!rule) return null;
  const requestId = uuidOf(event.payload.quoteRequestId) ?? (event.aggregateType === 'QUOTE_REQUEST' ? uuidOf(event.aggregateId) : null);
  if (!requestId) return null;
  const visibility = typeof rule.visibility === 'function' ? rule.visibility(event.payload) : rule.visibility;
  return { requestId, parts: rule.parts, visibility, previousAssigneeId: uuidOf(event.payload.previousAssigneeId) };
}

export type RequestChangeInput = Readonly<{
  requestId: string;
  parts: readonly RequestPart[];
  visibility: RequestVisibility;
  actorId?: string | null;
  previousAssigneeId?: string | null;
}>;

/** Publica `r` con el cliente y el responsable vigentes. Dentro de una transacción, sale al confirmar. */
export async function publishRequestChange(client: PrismaClient | Prisma.TransactionClient, input: RequestChangeInput): Promise<void> {
  const request = await client.quoteRequest.findUnique({ where: { id: input.requestId }, select: { clientId: true, currentAssigneeId: true } });
  if (!request) return;
  const previous = input.previousAssigneeId && input.previousAssigneeId !== request.currentAssigneeId ? input.previousAssigneeId : null;
  await publishRealtime(client, {
    t: 'r',
    r: input.requestId,
    c: request.clientId,
    a: request.currentAssigneeId,
    ...(previous ? { pa: previous } : {}),
    ...(input.actorId ? { b: input.actorId } : {}),
    p: input.parts,
    v: input.visibility,
  });
}
```

- [ ] **Step 4: Emisión en `recordDomainEvent`, `notifyInbox` y los dos cambios sin evento**

En `src/server/modules/inbox/domain-events.ts`:
1. Cambia la firma `export async function withInboxSavepoint(tx: Prisma.TransactionClient, source: string, work: () => Promise<void>): Promise<void> {` por `export async function withInboxSavepoint(tx: Prisma.TransactionClient, source: string, work: () => Promise<void>, name = 'inbox_effects'): Promise<void> {`.
2. En su cuerpo, reemplaza `'SAVEPOINT inbox_effects'`, `'RELEASE SAVEPOINT inbox_effects'` y `'ROLLBACK TO SAVEPOINT inbox_effects'` por `` `SAVEPOINT ${name}` ``, `` `RELEASE SAVEPOINT ${name}` `` y `` `ROLLBACK TO SAVEPOINT ${name}` ``.
3. Agrega `import { publishRequestChange, requestSignalFor, type RequestChangeInput } from './realtime-signals';`.
4. Agrega, antes de `recordDomainEvent`:

```ts
/** Las pantallas abiertas del expediente se enteran al confirmar; una falla aquí nunca tumba el cambio. */
export async function signalRequestChange(tx: Prisma.TransactionClient, input: RequestChangeInput): Promise<void> {
  await withInboxSavepoint(tx, 'REQUEST.CHANGED', () => publishRequestChange(tx, input), 'realtime_signal');
}

async function signalFromEvent(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<void> {
  const intent = requestSignalFor(event);
  if (!intent) return;
  await signalRequestChange(tx, { ...intent, actorId: event.actor?.userId ?? null });
}
```

5. En `recordDomainEvent`, justo después de `await tx.outboxEvent.create(…);`, agrega:

```ts
  // Aunque el evento no genere avisos (p. ej. pedir datos al cliente), las pantallas abiertas se enteran.
  await signalFromEvent(tx, event);
```

6. En `notifyInbox`, antes de `await withInboxSavepoint(…)`, agrega `await signalFromEvent(tx, event);`.

En `src/server/modules/quote-requests/staff-service.ts`, en `updateStaffQuoteRequest`:
- Justo antes de `return { quoteRequestId: requestId, folio: existing.folio, changedFields, updatedAt: now };`, agrega `await signalRequestChange(transaction, { requestId, parts: ['status'], visibility: 'C', actorId: actor.userId });`.
- Importa `signalRequestChange` desde `@/server/modules/inbox/domain-events` (ya importa `recordDomainEvent` de ahí).

En `src/server/modules/team/service.ts`, en `suspendTeamMember`, dentro del `for (const request of requests) {`, justo antes de su llave de cierre, agrega:

```ts
      await signalRequestChange(transaction, { requestId: request.id, parts: ['assignment'], visibility: 'I', actorId: actor.userId, previousAssigneeId: member.id });
```

Cambia `import { notifyInbox } from '@/server/modules/inbox/domain-events';` por `import { notifyInbox, signalRequestChange } from '@/server/modules/inbox/domain-events';`.

- [ ] **Step 5: Prueba de integración**

Crear `tests/integration/realtime-request-signals.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { createInternalNote, sendCustomerMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { assignQuoteRequest, updateStaffQuoteRequest } from '@/server/modules/quote-requests/staff-service';

type Signal = { t: string; r?: string; c?: string; a?: string | null; pa?: string; b?: string; p?: string[]; v?: string };

describe('request signals on commit', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const received: Signal[] = [];
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let listener: pg.Client | null = null;
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let managerId = '';
  let salesId = '';
  let customerId = '';

  const forRequest = () => received.filter((signal) => signal.t === 'r' && signal.r === requestId);
  const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the signal.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const actorFor = (userId: string, role: 'manager' | 'sales'): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles([role]), mfaVerified: true });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    listener = new pg.Client({ connectionString: readServerEnv().DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => { if (message.payload) received.push(JSON.parse(message.payload) as Signal); });
    const [managerRole, salesRole, customerRole] = await Promise.all(['manager', 'sales', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    managerId = (await prisma.user.create({ data: { email: `rt-signals-manager-${suffix}@example.test`, emailNormalized: `rt-signals-manager-${suffix}@example.test`, displayName: 'RT Gerencia', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    salesId = (await prisma.user.create({ data: { email: `rt-signals-sales-${suffix}@example.test`, emailNormalized: `rt-signals-sales-${suffix}@example.test`, displayName: 'RT Ventas', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `rt-signals-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'RT Cliente', email: `rt-signals-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Tepic', description: 'Fixture de señales de expediente', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `rt-signals-customer-${suffix}@example.test`, emailNormalized: `rt-signals-customer-${suffix}@example.test`, displayName: 'RT Cliente', type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
  });

  afterAll(async () => {
    await listener?.end();
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [managerId, salesId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: [managerId, salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
  });

  it('announces the new request, then its assignment with the previous owner', async () => {
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('created')));
    expect(forRequest().find((signal) => signal.p?.includes('created'))).toMatchObject({ c: clientId, a: null, v: 'C' });
    await assignQuoteRequest(actorFor(managerId, 'manager'), requestId, { assignedToId: salesId }, { prisma });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('assignment')));
    expect(forRequest().find((signal) => signal.p?.includes('assignment'))).toMatchObject({ a: salesId, b: managerId, v: 'I' });
    await assignQuoteRequest(actorFor(managerId, 'manager'), requestId, { assignedToId: managerId }, { prisma });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('assignment') && signal.pa === salesId));
  });

  it('marks customer messages as visible to the customer and internal notes as internal', async () => {
    const customer: Actor = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await sendCustomerMessage(customer, requestId, { body: 'Hola equipo', idempotencyKey: `rt-signals-c-${suffix}` }, { prisma, rateLimit });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('messages') && signal.v === 'C' && signal.b === customerId));
    await createInternalNote(actorFor(managerId, 'manager'), requestId, { body: 'Nota del equipo', idempotencyKey: `rt-signals-n-${suffix}` }, { prisma, rateLimit });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('messages') && signal.v === 'I'));
  });

  it('announces edits to the request details', async () => {
    await updateStaffQuoteRequest(actorFor(managerId, 'manager'), requestId, { detail: { location: 'Tepic, Nayarit' } }, { prisma });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('status') && signal.b === managerId && signal.v === 'C'));
  });

  it('sends nothing when the transaction rolls back', async () => {
    const before = forRequest().length;
    await expect(prisma.$transaction(async (tx) => {
      const { signalRequestChange } = await import('@/server/modules/inbox/domain-events');
      await signalRequestChange(tx, { requestId, parts: ['files'], visibility: 'C' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(forRequest()).toHaveLength(before);
  });
});
```

Run: `npx vitest run tests/unit/realtime-request-signals.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/realtime-request-signals.test.ts tests/integration/inbox-record.test.ts tests/integration/inbox-requests.test.ts tests/integration/team-service.test.ts --maxWorkers=1 && npx tsc --noEmit`
Expected: todo en PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/realtime/publish.ts src/lib/realtime-client.ts src/server/modules/inbox/realtime-signals.ts src/server/modules/inbox/domain-events.ts src/server/modules/quote-requests/staff-service.ts src/server/modules/team/service.ts tests/unit/realtime-request-signals.test.ts tests/integration/realtime-request-signals.test.ts
git commit -m "feat(realtime): señal de expediente con partes y visibilidad en cada evento, al confirmar"
```

---

### Task 2: "Visto por el cliente" y cursor del último mensaje (servidor)

**Files:**
- Modify: `src/server/modules/messaging/service.ts` (`listConversationMessages`)
- Test: `tests/integration/messaging-customer-read.test.ts`

**Interfaces:**
- Consumes (Task 1): `publishRequestChange`.
- Produces: la respuesta de `listConversationMessages` agrega `latestCursor: string | null` (cursor del último mensaje devuelto, para pedir sólo lo posterior) y, para el equipo, `customerRead: { through: Date; at: Date } | null` (`through` = hasta qué mensaje leyó el cliente; `at` = cuándo). Cuando el cliente abre el hilo y su lectura avanza, se publica `r` con `['read']` y `v: 'I'`.

- [ ] **Step 1: Escribir la prueba**

Crear `tests/integration/messaging-customer-read.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { listConversationMessages, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('customer read receipts', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  const readSignals: Array<{ r: string }> = [];
  let listener: pg.Client | null = null;
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let staffId = '';
  let customerId = '';
  let staff: Actor;
  let customer: Actor;

  const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the signal.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    listener = new pg.Client({ connectionString: readServerEnv().DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => {
      const signal = message.payload ? JSON.parse(message.payload) as { t: string; r: string; p?: string[] } : null;
      if (signal?.t === 'r' && signal.p?.includes('read')) readSignals.push(signal);
    });
    const [managerRole, customerRole] = await Promise.all(['manager', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    staffId = (await prisma.user.create({ data: { email: `rt-read-staff-${suffix}@example.test`, emailNormalized: `rt-read-staff-${suffix}@example.test`, displayName: 'RT Equipo', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `rt-read-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'RT Lectora', email: `rt-read-contact-${suffix}@example.test` }, detail: { projectType: 'Jacuzzi', location: 'Colima', description: 'Fixture de lectura del cliente', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `rt-read-customer-${suffix}@example.test`, emailNormalized: `rt-read-customer-${suffix}@example.test`, displayName: 'RT Lectora', type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    staff = { userId: staffId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['manager']), mfaVerified: true };
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
  });

  afterAll(async () => {
    await listener?.end();
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [staffId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
  });

  it('records when the customer reads the thread and shows it to the team', async () => {
    const first = await sendStaffMessage(staff, requestId, { body: 'Tu propuesta está lista.', idempotencyKey: `rt-read-1-${suffix}` }, { prisma, rateLimit });
    expect(await listConversationMessages(staff, requestId, {}, { prisma })).toMatchObject({ customerRead: null });
    await listConversationMessages(customer, requestId, {}, { prisma });
    await waitFor(() => readSignals.some((signal) => signal.r === requestId));
    const seen = await listConversationMessages(staff, requestId, {}, { prisma });
    expect(seen.customerRead?.through.toISOString()).toBe(new Date(first.createdAt).toISOString());
    // Volver a abrirlo sin mensajes nuevos no avisa de nuevo.
    await listConversationMessages(customer, requestId, {}, { prisma });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readSignals.filter((signal) => signal.r === requestId)).toHaveLength(1);
    // Un mensaje nuevo queda sin ver hasta que el cliente vuelve.
    const second = await sendStaffMessage(staff, requestId, { body: '¿La revisamos el jueves?', idempotencyKey: `rt-read-2-${suffix}` }, { prisma, rateLimit });
    const pending = await listConversationMessages(staff, requestId, {}, { prisma });
    expect(pending.customerRead!.through.getTime()).toBeLessThan(new Date(second.createdAt).getTime());
  });

  it('returns a cursor that brings only what came after', async () => {
    const all = await listConversationMessages(staff, requestId, { limit: 100 }, { prisma });
    expect(all.latestCursor).toEqual(expect.any(String));
    const nothingNew = await listConversationMessages(staff, requestId, { cursor: all.latestCursor!, limit: 100 }, { prisma });
    expect(nothingNew.items).toEqual([]);
    expect(nothingNew.latestCursor).toBe(all.latestCursor);
    await sendStaffMessage(staff, requestId, { body: 'Uno más', idempotencyKey: `rt-read-3-${suffix}` }, { prisma, rateLimit });
    const newer = await listConversationMessages(staff, requestId, { cursor: all.latestCursor!, limit: 100 }, { prisma });
    expect(newer.items.map((item) => item.body)).toEqual(['Uno más']);
  });
});
```

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/messaging-customer-read.test.ts`
Expected: FAIL (`customerRead` y `latestCursor` no existen).

- [ ] **Step 2: Implementar**

En `src/server/modules/messaging/service.ts`:
1. Agrega `import { publishRequestChange } from '@/server/modules/inbox/realtime-signals';`.
2. En `listConversationMessages`, cambia el retorno temprano `if (!conversation) return { conversation: null, items: [] as SerializedMessage[], nextCursor: null };` por:

```ts
  if (!conversation) return { conversation: null, items: [] as SerializedMessage[], nextCursor: null, latestCursor: filters.cursor ?? null, ...(actor.type === 'EMPLOYEE' ? { customerRead: null } : {}) };
```

3. Después de `const items = (hasNext ? messages.slice(0, limit) : messages).map(…);`, agrega:

```ts
  const page = hasNext ? messages.slice(0, limit) : messages;
  // Cursor del último mensaje devuelto: una vista en vivo lo usa para pedir sólo lo que llegó después.
  const latestCursor = page.length > 0 ? encodeCursor(page[page.length - 1]) : filters.cursor ?? null;
```

4. Justo después del bloque `if (actor.type === 'EMPLOYEE') { … markConversationRead … }`, agrega:

```ts
  // "Visto por el cliente" (spec §5.4): abrir el hilo marca su lectura con la misma función monótona, y si avanzó,
  // el equipo con el expediente abierto se entera (sólo el equipo: la señal es interna).
  if (actor.type === 'CUSTOMER') {
    const latestVisible = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversation.id, visibility: 'CUSTOMER' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    });
    if (latestVisible) {
      try {
        const previous = await prisma.conversationReadState.findUnique({ where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } }, select: { lastReadAt: true } });
        await markConversationRead(prisma, conversation.id, actor.userId, latestVisible.id, latestVisible.createdAt);
        if (!previous || latestVisible.createdAt > previous.lastReadAt) {
          await publishRequestChange(prisma, { requestId: request.id, parts: ['read'], visibility: 'I', actorId: actor.userId });
        }
      } catch { /* la lectura es de mejor esfuerzo: nunca bloquea la respuesta ya obtenida. */ }
    }
  }
  const customerRead = actor.type === 'EMPLOYEE'
    ? await prisma.conversationReadState.findFirst({
      where: { conversationId: conversation.id, user: { type: 'CUSTOMER', clientId: request.clientId } },
      orderBy: { lastReadAt: 'desc' },
      select: { lastReadAt: true, updatedAt: true },
    })
    : null;
```

5. Cambia el `return { conversation: …, items, nextCursor: … };` final por:

```ts
  return {
    conversation: serializeConversation(conversation, actor.type === 'EMPLOYEE'),
    items,
    nextCursor: hasNext ? encodeCursor(messages[limit - 1]) : null,
    latestCursor,
    ...(actor.type === 'EMPLOYEE' ? { customerRead: customerRead ? { through: customerRead.lastReadAt, at: customerRead.updatedAt } : null } : {}),
  };
```

- [ ] **Step 3: Correr, typecheck y commit**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/messaging-customer-read.test.ts tests/integration/messaging-service.test.ts tests/integration/messaging-api.test.ts --maxWorkers=1 && npx tsc --noEmit`
Expected: todo en PASS.

```bash
git add src/server/modules/messaging/service.ts tests/integration/messaging-customer-read.test.ts
git commit -m "feat(realtime): el cliente deja constancia de lectura y el equipo la ve; cursor del último mensaje"
```

---

### Task 3: Hub: evento `request` con alcance

**Files:**
- Modify: `src/server/realtime/hub.ts` y `src/lib/realtime-client.ts`
- Test: `tests/unit/realtime-hub.test.ts`, `tests/unit/realtime-client.test.ts` y `tests/integration/realtime-api.test.ts`

**Interfaces:**
- Consumes (Task 1): la variante `r` de `RealtimeSignal`, `RequestPart`.
- Produces:
  - `requestSignalVisibleTo(actor, signal): boolean`.
  - `RealtimeServerEvent` con `{ event: 'request'; data: { requestId; parts; self; at } }`.
  - En el cliente, `RealtimeEvent` con `{ type: 'request'; requestId; parts; self }` y `'request'` en `REALTIME_EVENT_TYPES`.

- [ ] **Step 1: Pruebas**

En `tests/unit/realtime-hub.test.ts`:
- Agrega `requestSignalVisibleTo` a la importación de `@/server/realtime/hub`.
- Agrega al final del `describe`:

```ts
  it('sends request changes only to whoever can open the file', async () => {
    const { hub } = createHub();
    const OWNER = USER;
    const CLIENT = '1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b';
    const manager = { ...connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SESSION_A), actor: { ...actorFor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), permissionKeys: new Set(['requests.read.global']) } };
    const owner = connection(OWNER, SESSION_A);
    const otherSales = connection(OTHER, SESSION_B);
    const customer = { ...connection('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SESSION_A), actor: { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', type: 'CUSTOMER' as const, clientId: CLIENT, permissionKeys: new Set<string>(), mfaVerified: false } };
    for (const each of [manager, owner, otherSales, customer]) hub.register(each);
    await hub.dispatch({ t: 'r', r: REQUEST, c: CLIENT, a: OWNER, b: OWNER, p: ['messages'], v: 'C' });
    expect(manager.events).toEqual([{ event: 'request', data: { requestId: REQUEST, parts: ['messages'], self: false, at: expect.any(String) } }]);
    expect(owner.events).toEqual([{ event: 'request', data: expect.objectContaining({ self: true }) }]);
    expect(otherSales.events).toEqual([]);
    expect(customer.events).toHaveLength(1);
    await hub.dispatch({ t: 'r', r: REQUEST, c: CLIENT, a: OWNER, p: ['approvals'], v: 'I' });
    expect(customer.events).toHaveLength(1);
  });

  it('decides the scope of a request change like the request read scope', () => {
    const signal = { t: 'r' as const, r: REQUEST, c: 'client', a: USER, p: ['status' as const], v: 'I' as const };
    expect(requestSignalVisibleTo(actorFor(USER), signal)).toBe(true);
    expect(requestSignalVisibleTo(actorFor(OTHER), signal)).toBe(false);
    expect(requestSignalVisibleTo(actorFor(OTHER), { ...signal, pa: OTHER })).toBe(true);
    expect(requestSignalVisibleTo(actorFor(OTHER), { ...signal, a: null })).toBe(true);
    expect(requestSignalVisibleTo({ userId: OTHER, type: 'CUSTOMER', clientId: 'client', permissionKeys: new Set(), mfaVerified: false }, signal)).toBe(false);
    expect(requestSignalVisibleTo({ userId: OTHER, type: 'CUSTOMER', clientId: 'client', permissionKeys: new Set(), mfaVerified: false }, { ...signal, v: 'C' })).toBe(true);
    expect(requestSignalVisibleTo({ userId: OTHER, type: 'CUSTOMER', clientId: 'another', permissionKeys: new Set(), mfaVerified: false }, { ...signal, v: 'C' })).toBe(false);
  });
```

En `tests/unit/realtime-client.test.ts`, dentro de `it('parses only well-formed events', …)`, agrega:

```ts
    expect(parseRealtimeEvent('request', JSON.stringify({ requestId: REQUEST, parts: ['messages', 'bogus'], self: true, at: 'x' }))).toEqual({ type: 'request', requestId: REQUEST, parts: ['messages'], self: true });
    expect(parseRealtimeEvent('request', JSON.stringify({ requestId: REQUEST, parts: ['bogus'] }))).toBeNull();
```

En `tests/integration/realtime-api.test.ts`, agrega antes del último `it` (el de `bye`):

```ts
  it('streams request changes to whoever can open the file', async () => {
    const events = sseReader(await open());
    await events.next('hello');
    // Solicitud propia, creada por el equipo y sin responsable: no avisa al pool y se borra al terminar.
    const { createQuoteRequest } = await import('@/server/modules/quote-requests/service');
    const request = await createQuoteRequest({ idempotencyKey: `rt-api-request-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'RT Api Cliente', email: `rt-api-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Durango', description: 'Fixture del evento request', consentAt: new Date() } }, { prisma });
    try {
      expect((await events.next('request', (event) => event.data.requestId === request.quoteRequestId)).data).toMatchObject({ parts: ['created'], self: false });
    } finally {
      await events.cancel();
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.quoteRequest.deleteMany({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.deleteMany({ where: { id: request.contactId } });
      await prisma.client.deleteMany({ where: { id: request.clientId } });
    }
  });
```

(El usuario de la prueba es de Ventas sin alcance global: recibe las solicitudes sin responsable. `REQUEST.RECEIVED` publica `created` al confirmar la solicitud.)

Run: `npx vitest run tests/unit/realtime-hub.test.ts tests/unit/realtime-client.test.ts`
Expected: FAIL (`requestSignalVisibleTo` no existe; `request` no se entiende).

- [ ] **Step 2: Implementar**

En `src/server/realtime/hub.ts`:
1. Cambia `import type { RealtimeSignal } from './publish';` por `import type { RealtimeSignal, RequestPart } from './publish';`.
2. En `RealtimeServerEvent`, agrega la variante:

```ts
  | Readonly<{ event: 'request'; data: Readonly<{ requestId: string; parts: readonly RequestPart[]; self: boolean; at: string }> }>
```

3. Antes de `export class RealtimeHub`, agrega:

```ts
/** Alcance de `r` (spec §4.2): igual que el de lectura de expedientes; el cliente sólo lo suyo y visible. */
export function requestSignalVisibleTo(actor: Actor, signal: Extract<RealtimeSignal, { t: 'r' }>): boolean {
  if (actor.type === 'CUSTOMER') return signal.v === 'C' && actor.clientId === signal.c;
  if (actor.type !== 'EMPLOYEE') return false;
  if (actor.permissionKeys.has('requests.read.global')) return true;
  return signal.a === null || signal.a === actor.userId || signal.pa === actor.userId;
}
```

4. En `dispatch`, al inicio, antes de `if (!this.byUser.has(signal.u)) return;`, agrega:

```ts
    if (signal.t === 'r') {
      this.deliverRequest(signal);
      return;
    }
```

5. Agrega el método privado:

```ts
  private deliverRequest(signal: Extract<RealtimeSignal, { t: 'r' }>): void {
    const at = new Date().toISOString();
    for (const connections of this.byUser.values()) {
      for (const connection of connections) {
        if (!requestSignalVisibleTo(connection.actor, signal)) continue;
        connection.send({ event: 'request', data: { requestId: signal.r, parts: signal.p, self: signal.b === connection.userId, at } });
      }
    }
  }
```

6. Cambia la firma `private async deliver(signal: Exclude<RealtimeSignal, { t: 's' }>)` por `private async deliver(signal: Extract<RealtimeSignal, { t: 'n' | 'u' }>)`.

En `src/lib/realtime-client.ts`:
1. En `RealtimeEvent`, agrega `| Readonly<{ type: 'request'; requestId: string; parts: RequestPart[]; self: boolean }>`.
2. Cambia `REALTIME_EVENT_TYPES` por `['hello', 'notification', 'counts', 'request', 'resync', 'bye', 'ping'] as const`.
3. Después de `const EVENT_SOURCE_CLOSED = 2;`, agrega `const PART_SET: ReadonlySet<string> = new Set(REQUEST_PARTS);`.
4. En `parseRealtimeEvent`, antes de `case 'resync':`, agrega:

```ts
    case 'request': {
      const parts = Array.isArray(data.parts) ? data.parts.filter((part): part is RequestPart => typeof part === 'string' && PART_SET.has(part)) : [];
      return typeof data.requestId === 'string' && parts.length > 0 ? { type: 'request', requestId: data.requestId, parts, self: data.self === true } : null;
    }
```

- [ ] **Step 3: Correr, typecheck y commit**

Run: `npx vitest run tests/unit/realtime-hub.test.ts tests/unit/realtime-client.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/realtime-api.test.ts && npx tsc --noEmit`
Expected: todo en PASS.

```bash
git add src/server/realtime/hub.ts src/lib/realtime-client.ts tests/unit/realtime-hub.test.ts tests/unit/realtime-client.test.ts tests/integration/realtime-api.test.ts
git commit -m "feat(realtime): el canal avisa qué cambió en cada expediente, sólo a quien puede abrirlo"
```

---

### Task 4: Suscripciones del navegador y supresión por contexto

**Files:**
- Create: `src/lib/realtime-subscriptions.ts` y `src/components/inbox/useRealtimeRequest.ts`
- Modify: `src/components/inbox/InboxProvider.tsx`
- Test: `tests/unit/realtime-subscriptions.test.ts`

**Interfaces:**
- Consumes (Task 3): el evento `request` del cliente.
- Produces:
  - `type RequestChange = { requestId: string | null; parts; self: boolean; reason: 'signal' | 'resync' }`.
  - `ANY_REQUEST = '*'` y `createRequestSubscriptions()`.
  - `useRealtimeRequest(requestId | '*' | null, parts, onChange)` y `useCoalesced(run, ms)`.
  - `InboxContextValue.subscribeRequest` y `setActiveRequest`, más `useInboxActiveContext(quoteRequestId)`.

- [ ] **Step 1: Prueba**

Crear `tests/unit/realtime-subscriptions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ANY_REQUEST, createRequestSubscriptions } from '@/lib/realtime-subscriptions';

describe('request subscriptions', () => {
  it('notifies only the matching file and parts', () => {
    const registry = createRequestSubscriptions();
    const thread = vi.fn();
    const inbox = vi.fn();
    const unsubscribe = registry.subscribe('req-1', ['messages', 'read'], thread);
    registry.subscribe(ANY_REQUEST, ['created', 'status'], inbox);
    registry.dispatch('req-1', ['messages', 'files'], false);
    registry.dispatch('req-2', ['status'], true);
    registry.dispatch('req-3', ['files'], false);
    expect(thread).toHaveBeenCalledTimes(1);
    expect(thread).toHaveBeenCalledWith({ requestId: 'req-1', parts: ['messages'], self: false, reason: 'signal' });
    expect(inbox).toHaveBeenCalledWith({ requestId: 'req-2', parts: ['status'], self: true, reason: 'signal' });
    unsubscribe();
    registry.dispatch('req-1', ['messages'], false);
    expect(thread).toHaveBeenCalledTimes(1);
  });

  it('asks every view to re-read after a reconnection', () => {
    const registry = createRequestSubscriptions();
    const view = vi.fn();
    registry.subscribe('req-1', ['files'], view);
    registry.refreshAll();
    expect(view).toHaveBeenCalledWith({ requestId: null, parts: ['files'], self: false, reason: 'resync' });
  });
});
```

Run: `npx vitest run tests/unit/realtime-subscriptions.test.ts`
Expected: FAIL (el módulo no existe).

- [ ] **Step 2: Registro y hooks**

Crear `src/lib/realtime-subscriptions.ts`:

```ts
import type { RequestPart } from '@/lib/realtime-client';

export const ANY_REQUEST = '*';

export type RequestChange = Readonly<{
  /** null en una relectura general: reconexión del canal o volver a la pestaña sin canal. */
  requestId: string | null;
  parts: readonly RequestPart[];
  /** El cambio lo hizo esta misma persona (desde esta u otra pestaña): su vista ya lo refleja. */
  self: boolean;
  reason: 'signal' | 'resync';
}>;

export type RequestSubscriptions = Readonly<{
  subscribe: (requestId: string, parts: readonly RequestPart[], callback: (change: RequestChange) => void) => () => void;
  dispatch: (requestId: string, parts: readonly RequestPart[], self: boolean) => void;
  refreshAll: () => void;
}>;

/** Qué vistas escuchan qué expediente (o cualquiera, con `*`) y qué partes. */
export function createRequestSubscriptions(): RequestSubscriptions {
  const subscribers = new Set<Readonly<{ requestId: string; parts: ReadonlySet<RequestPart>; callback: (change: RequestChange) => void }>>();
  return {
    subscribe(requestId, parts, callback) {
      const entry = { requestId, parts: new Set(parts), callback };
      subscribers.add(entry);
      return () => { subscribers.delete(entry); };
    },
    dispatch(requestId, parts, self) {
      for (const entry of [...subscribers]) {
        if (entry.requestId !== ANY_REQUEST && entry.requestId !== requestId) continue;
        const matched = parts.filter((part) => entry.parts.has(part));
        if (matched.length > 0) entry.callback({ requestId, parts: matched, self, reason: 'signal' });
      }
    },
    refreshAll() {
      for (const entry of [...subscribers]) entry.callback({ requestId: null, parts: [...entry.parts], self: false, reason: 'resync' });
    },
  };
}
```

Crear `src/components/inbox/useRealtimeRequest.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RequestPart } from '@/lib/realtime-client';
import type { RequestChange } from '@/lib/realtime-subscriptions';
import { useInbox } from './InboxProvider';

/** Una vista se entera cuando cambia una parte de un expediente (o de cualquiera, con `*`). Sin id, no escucha. */
export function useRealtimeRequest(requestId: string | null | undefined, parts: readonly RequestPart[], onChange: (change: RequestChange) => void): void {
  const subscribe = useInbox()?.subscribeRequest;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const partsKey = parts.join(',');
  useEffect(() => {
    if (!subscribe || !requestId) return undefined;
    return subscribe(requestId, partsKey.split(',') as RequestPart[], (change) => onChangeRef.current(change));
  }, [subscribe, requestId, partsKey]);
}

/** Agrupa ráfagas: `run` corre una vez, `ms` después del último aviso. */
export function useCoalesced(run: () => void, ms: number): () => void {
  const runRef = useRef(run);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      runRef.current();
    }, ms);
  }, [ms]);
}
```

- [ ] **Step 3: Proveedor**

En `src/components/inbox/InboxProvider.tsx`:
1. Importa `import { createRequestSubscriptions, type RequestChange } from '@/lib/realtime-subscriptions';` y `type RequestPart` junto a `applyNotificationEvent` (`import { applyNotificationEvent, shouldFlash, type RealtimeEvent, type RequestPart } from '@/lib/realtime-client';`).
2. En `InboxContextValue`, agrega:

```ts
  /** Suscribe una vista a los cambios de un expediente (o de cualquiera, con '*'); devuelve cómo dejar de escuchar. */
  subscribeRequest: (requestId: string, parts: readonly RequestPart[], callback: (change: RequestChange) => void) => () => void;
  setActiveRequest: (quoteRequestId: string | null) => void;
```

3. Dentro de `InboxProvider`, después de `const listRefreshTimer = useRef<number | null>(null);`, agrega:

```ts
  const [subscriptions] = useState(createRequestSubscriptions);
  const connectedOnce = useRef(false);
  const activeRequest = useRef<string | null>(null);
  const lastReturn = useRef(0);
```

4. Reemplaza el efecto de consulta de respaldo (`if (!available || live) return undefined; …`) por:

```ts
  useEffect(() => {
    if (!available || live) return undefined;
    const refreshCounts = () => { if (document.visibilityState === 'visible') void refresh(); };
    // Sin canal, las vistas abiertas se ponen al día al volver a la pestaña (spec §4.4); `focus` y
    // `visibilitychange` llegan juntos, así que se cuenta una sola vuelta.
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn.current < 1_000) return;
      lastReturn.current = Date.now();
      void refresh();
      subscriptions.refreshAll();
    };
    const timer = window.setInterval(refreshCounts, POLL_INTERVAL_MS);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [available, live, refresh, subscriptions]);
```

5. En `handleRealtime`, reemplaza los casos `'hello'` y `'resync'` por:

```ts
      case 'hello':
        // Al reconectar pudieron perderse cambios: se relee la bandeja y, si no es la primera vez, cada vista abierta.
        void refresh();
        if (connectedOnce.current) subscriptions.refreshAll();
        connectedOnce.current = true;
        return;
      case 'resync':
        void refresh();
        subscriptions.refreshAll();
        return;
      case 'request':
        subscriptions.dispatch(event.requestId, event.parts, event.self);
        return;
```

6. En el caso `'notification'`, cambia `if (!shouldFlash(event, null)) return;` por `if (!shouldFlash(event, activeRequest.current)) return;`.
7. Agrega `subscriptions` a las dependencias de `handleRealtime`.
8. Antes de `const value = useMemo…`, agrega:

```ts
  const setActiveRequest = useCallback((quoteRequestId: string | null) => {
    activeRequest.current = quoteRequestId;
  }, []);
```

9. En el objeto de `value`, agrega `subscribeRequest: subscriptions.subscribe,` y `setActiveRequest,`. En sus dependencias, agrega `subscriptions` y `setActiveRequest`.
10. Al final del archivo, agrega:

```ts
/** Una vista con un expediente abierto lo registra: su actividad no destella, porque ya se ve en pantalla (spec §5.3). */
export function useInboxActiveContext(quoteRequestId: string | null): void {
  const setActiveRequest = useInbox()?.setActiveRequest;
  useEffect(() => {
    if (!setActiveRequest) return undefined;
    setActiveRequest(quoteRequestId);
    return () => setActiveRequest(null);
  }, [setActiveRequest, quoteRequestId]);
}
```

- [ ] **Step 4: Correr, typecheck, lint y commit**

Run: `npx vitest run tests/unit/realtime-subscriptions.test.ts tests/unit/realtime-client.test.ts && npx tsc --noEmit && npx eslint src/lib/realtime-subscriptions.ts src/components/inbox`
Expected: PASS y sin errores.

```bash
git add src/lib/realtime-subscriptions.ts src/components/inbox/useRealtimeRequest.ts src/components/inbox/InboxProvider.tsx tests/unit/realtime-subscriptions.test.ts
git commit -m "feat(realtime): las vistas se suscriben a los cambios de un expediente; sin canal, releen al volver"
```

---

### Task 5: Hilos de mensajes en vivo, "Nuevo" y "Visto"

**Files:**
- Create: `src/lib/live-thread.ts`
- Modify: `src/lib/load-latest-messages.ts` y `tests/unit/load-latest-messages.test.ts`
- Modify: `src/components/StaffMessagingPanel.tsx`, `src/components/ClientMessagingThread.tsx` y `src/components/private/ui/private-surfaces.css`
- Test: `tests/unit/live-thread.test.ts`

**Interfaces:**
- Consumes (Tasks 2 y 4): `latestCursor`, `customerRead` y `useRealtimeRequest`.
- Produces:
  - `mergeThread(current, incoming): { items; added }` y `seenAt(messages, customerRead, isTeam)`.
  - `loadThroughLatest` devuelve también los campos extra de la última página.

- [ ] **Step 1: Pruebas**

Crear `tests/unit/live-thread.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeThread, seenAt } from '@/lib/live-thread';

const message = (id: string, createdAt: string, team = true) => ({ id, createdAt, team });

describe('live thread', () => {
  it('adds only unknown messages, in order, and says which ones', () => {
    const current = [message('a', '2026-09-30T10:00:00.000Z'), message('b', '2026-09-30T10:01:00.000Z')];
    const result = mergeThread(current, [message('b', '2026-09-30T10:01:00.000Z'), message('c', '2026-09-30T10:02:00.000Z')]);
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.added).toEqual(['c']);
  });

  it('shows "Visto" only under a last message from the team that the customer already read', () => {
    const thread = [message('a', '2026-09-30T10:00:00.000Z', false), message('b', '2026-09-30T10:05:00.000Z')];
    const isTeam = (item: { team: boolean }) => item.team;
    expect(seenAt(thread, { through: '2026-09-30T10:05:00.000Z', at: '2026-09-30T10:07:00.000Z' }, isTeam)).toBe('2026-09-30T10:07:00.000Z');
    expect(seenAt(thread, { through: '2026-09-30T10:04:00.000Z', at: '2026-09-30T10:07:00.000Z' }, isTeam)).toBeNull();
    expect(seenAt([...thread, message('c', '2026-09-30T10:06:00.000Z', false)], { through: '2026-09-30T10:06:00.000Z', at: '2026-09-30T10:07:00.000Z' }, isTeam)).toBeNull();
    expect(seenAt(thread, null, isTeam)).toBeNull();
  });
});
```

En `tests/unit/load-latest-messages.test.ts`, agrega al final del `describe`:

```ts
  it('keeps the extra fields of the last page', async () => {
    const pages = [
      { conversation: null, items: [{ id: 'a' }], nextCursor: '1', latestCursor: 'cursor-a' },
      { conversation: null, items: [{ id: 'b' }], nextCursor: null, latestCursor: 'cursor-b' },
    ];
    const result = await loadThroughLatest(async (cursor?: string) => pages[cursor ? 1 : 0]);
    expect(result).toEqual({ conversation: null, items: [{ id: 'a' }, { id: 'b' }], nextCursor: null, latestCursor: 'cursor-b' });
  });
```

Run: `npx vitest run tests/unit/live-thread.test.ts tests/unit/load-latest-messages.test.ts`
Expected: FAIL.

- [ ] **Step 2: Utilidades**

Crear `src/lib/live-thread.ts`:

```ts
type ThreadItem = Readonly<{ id: string; createdAt: string }>;
export type CustomerRead = Readonly<{ through: string; at: string }>;

/** Une lo que llegó sin duplicar, en orden cronológico, y dice qué ids no se conocían. */
export function mergeThread<M extends ThreadItem>(current: readonly M[], incoming: readonly M[]): Readonly<{ items: M[]; added: string[] }> {
  const known = new Set(current.map((item) => item.id));
  const added = incoming.filter((item) => !known.has(item.id));
  if (added.length === 0) return { items: [...current], added: [] };
  const items = [...current, ...added].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
  return { items, added: added.map((item) => item.id) };
}

/** "Visto · hace 3 min" (spec §5.4): sólo si el último mensaje es del equipo y el cliente leyó hasta él. */
export function seenAt<M extends ThreadItem>(messages: readonly M[], customerRead: CustomerRead | null, isTeam: (message: M) => boolean): string | null {
  const last = messages[messages.length - 1];
  if (!last || !customerRead || !isTeam(last)) return null;
  return Date.parse(customerRead.through) >= Date.parse(last.createdAt) ? customerRead.at : null;
}
```

Reemplaza `src/lib/load-latest-messages.ts` completo:

```ts
export type MessagePage<M extends { id: string }, C> = { conversation: C; items: M[]; nextCursor: string | null };

/**
 * La API de mensajes pagina en orden cronológico ascendente y su cursor avanza hacia los más
 * NUEVOS. Pedir sólo la primera página mostraba los mensajes más viejos y escondía los recientes
 * (lo que importa) detrás de un botón. Esto sigue el cursor hasta el final (con tope de páginas)
 * para que el hilo abra siempre en su estado actual; si aún quedara más, `nextCursor` lo indica.
 * Los demás campos (`latestCursor`, `customerRead`) son los de la última página.
 */
export async function loadThroughLatest<M extends { id: string }, P extends MessagePage<M, unknown>>(
  loadPage: (cursor?: string) => Promise<P>,
  maxPages = 10,
): Promise<P> {
  let last = await loadPage();
  let items = last.items;
  for (let page = 1; last.nextCursor && page < maxPages; page += 1) {
    const next = await loadPage(last.nextCursor);
    const known = new Set(items.map((item) => item.id));
    items = [...items, ...next.items.filter((item) => !known.has(item.id))];
    last = next;
  }
  return { ...last, items };
}
```

- [ ] **Step 3: Hilo del equipo**

En `src/components/StaffMessagingPanel.tsx`:
1. Cambia la importación de React por `import { FormEvent, Fragment, KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';` y agrega:

```ts
import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';
import { mergeThread, seenAt, type CustomerRead } from '@/lib/live-thread';
```

2. En `StaffConversationResponse`, agrega `latestCursor?: string | null;` y `customerRead?: CustomerRead | null;`.
3. Después de `const MAX_MESSAGE_LENGTH = 10_000;`, agrega:

```ts
/** El final de la lista está a la vista: lo nuevo se ve sin avisar. */
function listBottomVisible(list: HTMLElement | null): boolean {
  return !list || list.getBoundingClientRect().bottom <= window.innerHeight + 24;
}
```

4. Después de `const [sendIdempotencyKey, setSendIdempotencyKey] = useState<string | null>(null);`, agrega:

```ts
  const [customerRead, setCustomerRead] = useState<CustomerRead | null>(null);
  // Primer mensaje que llegó en vivo (separador "Nuevo") y cuántos quedaron fuera de la vista (píldora).
  const [newFromId, setNewFromId] = useState<string | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const latestCursorRef = useRef<string | null>(null);
  const messagesRef = useRef<StaffMessage[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
```

5. Reemplaza `applyResponse` por:

```ts
  const applyResponse = (data: StaffConversationResponse) => {
    setConversation(data.conversation);
    setMessages(data.items);
    setNextCursor(data.nextCursor);
    setCustomerRead(data.customerRead ?? null);
    latestCursorRef.current = data.latestCursor ?? null;
  };
```

6. En el efecto de carga (el que llama a `setLoading(true)` al cambiar `loadMessages`), después de `setNextCursor(null);`, agrega `setCustomerRead(null); setNewFromId(null); setUnseenCount(0); latestCursorRef.current = null;`.
7. Después de `loadMore`, agrega:

```ts
  // En vivo (spec §5.4): pide sólo lo posterior al último mensaje conocido. Lo propio no es "Nuevo".
  const fetchNewer = (markNew: boolean) => {
    const bottomVisible = listBottomVisible(listRef.current);
    void loadThroughLatest((cursor) => loadMessages(cursor ?? latestCursorRef.current ?? undefined)).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      setCustomerRead(data.customerRead ?? null);
      latestCursorRef.current = data.latestCursor ?? latestCursorRef.current;
      const { items, added } = mergeThread(messagesRef.current, data.items);
      if (added.length === 0) return;
      setMessages(items);
      if (!markNew) return;
      setNewFromId((current) => current ?? added[0]);
      if (!bottomVisible) setUnseenCount((count) => count + added.length);
    }).catch(() => undefined);
  };
  useRealtimeRequest(canRead ? requestId : null, ['messages', 'read'], (change) => fetchNewer(!change.self));

  // La píldora se va sola cuando la persona baja hasta el final.
  useEffect(() => {
    if (unseenCount === 0) return undefined;
    const onScroll = () => { if (listBottomVisible(listRef.current)) setUnseenCount(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [unseenCount]);

  const revealNew = () => {
    document.getElementById(`staff-message-${newFromId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setUnseenCount(0);
  };
```

8. En `sendMessage`, dentro del `.then((data) => {`, después de `setMessages((current) => mergeMessages(current, [data]));`, agrega `setNewFromId(null);` (al responder, lo nuevo ya se atendió).
9. Después de `const visibleMessages = useMemo(…);`, agrega:

```ts
  const seenLabelAt = mode === 'CUSTOMER' ? seenAt(visibleMessages, customerRead, (message) => message.sender?.type !== 'CUSTOMER') : null;
```

10. Reemplaza la lista `{visibleMessages.length > 0 && <ol className="staff-messaging__list" aria-live="polite">…</ol>}` por:

```tsx
        {visibleMessages.length > 0 && <ol ref={listRef} className="staff-messaging__list" aria-live="polite">
          {visibleMessages.map((message) => <Fragment key={message.id}>
            {message.id === newFromId && <li className="thread-divider" aria-hidden="true"><span>Nuevo</span></li>}
            <li id={`staff-message-${message.id}`} className={`staff-message${message.visibility === 'INTERNAL' ? ' staff-message--internal' : ''}`}>
              <div className="staff-message__meta"><strong>{message.sender?.type === 'CUSTOMER' ? 'Cliente' : message.sender?.displayName ?? 'Equipo OCPOOL'}</strong><time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{relativeTimeLabel(message.createdAt)}</time><span>{message.visibility === 'CUSTOMER' ? 'Visible para cliente' : 'Sólo equipo'}</span></div>
              <p>{message.body}</p>
            </li>
          </Fragment>)}
        </ol>}
        {seenLabelAt && <p className="thread-seen" title={formatDateTime(seenLabelAt)}>Visto · {relativeTimeLabel(seenLabelAt)}</p>}
        {unseenCount > 0 && <button type="button" className="thread-new-pill" onClick={revealNew}>{unseenCount === 1 ? '1 mensaje nuevo' : `${unseenCount} mensajes nuevos`} ↓</button>}
```

- [ ] **Step 4: Hilo del portal**

En `src/components/ClientMessagingThread.tsx`:
1. Cambia la importación de React por `import { FormEvent, Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';` y agrega `import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';` y `import { mergeThread } from '@/lib/live-thread';`.
2. En `PortalConversationResponse`, agrega `latestCursor?: string | null;`.
3. Después de `const MAX_MESSAGE_LENGTH = 10_000;`, agrega la misma función `listBottomVisible` que en el hilo del equipo.
4. Después de `const [sendIdempotencyKey, setSendIdempotencyKey] = useState<string | null>(null);`, agrega:

```ts
  const [newFromId, setNewFromId] = useState<string | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const latestCursorRef = useRef<string | null>(null);
  const messagesRef = useRef<PortalMessage[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
```

5. En el efecto de montaje y en `retry`, junto a `setNextCursor(data.nextCursor);`, agrega `latestCursorRef.current = data.latestCursor ?? null;`. En el efecto de montaje, junto a `setNextCursor(null);`, agrega `setNewFromId(null); setUnseenCount(0); latestCursorRef.current = null;`.
6. Después de `loadMore`, agrega (idéntico al del equipo, sin `customerRead`):

```ts
  const fetchNewer = (markNew: boolean) => {
    const bottomVisible = listBottomVisible(listRef.current);
    void loadThroughLatest((cursor) => loadMessages(cursor ?? latestCursorRef.current ?? undefined)).then((data) => {
      if (isStale()) return;
      setConversation(data.conversation);
      latestCursorRef.current = data.latestCursor ?? latestCursorRef.current;
      const { items, added } = mergeThread(messagesRef.current, data.items);
      if (added.length === 0) return;
      setMessages(items);
      if (!markNew) return;
      setNewFromId((current) => current ?? added[0]);
      if (!bottomVisible) setUnseenCount((count) => count + added.length);
    }).catch(() => undefined);
  };
  useRealtimeRequest(requestId, ['messages'], (change) => fetchNewer(!change.self));

  useEffect(() => {
    if (unseenCount === 0) return undefined;
    const onScroll = () => { if (listBottomVisible(listRef.current)) setUnseenCount(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [unseenCount]);

  const revealNew = () => {
    document.getElementById(`client-message-${newFromId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setUnseenCount(0);
  };
```

7. En `sendMessage`, después de `setMessages((current) => current.some(…) ? current : [...current, data]);`, agrega `setNewFromId(null);`.
8. Reemplaza la lista `{messages.length > 0 && <ol className="client-messaging__list" aria-live="polite">…</ol>}` por:

```tsx
      {messages.length > 0 && <ol ref={listRef} className="client-messaging__list" aria-live="polite">
        {messages.map((message) => <Fragment key={message.id}>
          {message.id === newFromId && <li className="thread-divider" aria-hidden="true"><span>Nuevo</span></li>}
          <li id={`client-message-${message.id}`} className={`client-message client-message--${message.sender?.type === 'EMPLOYEE' ? 'team' : 'client'}`}>
            <div className="client-message__meta"><strong>{authorLabel(message)}</strong><time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{relativeTimeLabel(message.createdAt)}</time></div>
            <p>{message.body}</p>
          </li>
        </Fragment>)}
      </ol>}
      {unseenCount > 0 && <button type="button" className="thread-new-pill" onClick={revealNew}>{unseenCount === 1 ? '1 mensaje nuevo' : `${unseenCount} mensajes nuevos`} ↓</button>}
```

- [ ] **Step 5: Estilos**

En `src/components/private/ui/private-surfaces.css`, justo después de la regla `.staff-messaging__list { … }`, agrega:

```css
/* Hilo en vivo (spec §5.4): separador "Nuevo", píldora de mensajes fuera de la vista y "Visto". */
.thread-divider { display: flex; align-items: center; gap: 10px; color: var(--private-color-accent); font-size: 11.5px; font-weight: 750; letter-spacing: .06em; list-style: none; text-transform: uppercase; }
.thread-divider::before, .thread-divider::after { flex: 1; height: 1px; background: color-mix(in srgb, var(--private-color-accent) 40%, transparent); content: ''; }
.thread-new-pill { position: sticky; z-index: 2; bottom: 16px; display: flex; width: max-content; min-height: 36px; align-items: center; margin: 12px auto 0; border: 0; border-radius: 999px; padding: 0 16px; background: var(--private-color-brand); color: #fff; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; box-shadow: var(--private-shadow-popover); }
.thread-new-pill:focus-visible { outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
.thread-seen { margin: 6px 0 0; color: var(--private-color-ink-muted); font-size: 12px; text-align: right; }
```

- [ ] **Step 6: Correr, typecheck, lint y commit**

Run: `npx vitest run tests/unit/live-thread.test.ts tests/unit/load-latest-messages.test.ts && npx tsc --noEmit && npx eslint src/lib/live-thread.ts src/lib/load-latest-messages.ts src/components/StaffMessagingPanel.tsx src/components/ClientMessagingThread.tsx`
Expected: PASS y sin errores.

```bash
git add src/lib/live-thread.ts src/lib/load-latest-messages.ts tests/unit/live-thread.test.ts tests/unit/load-latest-messages.test.ts src/components/StaffMessagingPanel.tsx src/components/ClientMessagingThread.tsx src/components/private/ui/private-surfaces.css
git commit -m "feat(realtime): hilos en vivo con separador Nuevo, píldora de mensajes nuevos y Visto por el cliente"
```

---

### Task 6: Archivos, detalle del expediente y portal en vivo

**Files:**
- Modify: `src/components/StaffFilesPanel.tsx`, `ClientFilesPanel.tsx`, `StaffRequestsPanel.tsx` (detalle), `RequestWorkspaceDetailV2.tsx`, `ClientPortalPanel.tsx` y `private-surfaces.css`

**Interfaces:**
- Consumes (Task 4): `useRealtimeRequest`, `useCoalesced`, `useInboxActiveContext` y `ANY_REQUEST`.

- [ ] **Step 1: Archivos**

En `src/components/StaffFilesPanel.tsx` y en `src/components/ClientFilesPanel.tsx`:
1. Cambia `const loadFiles = useCallback(async (cursor?: string) => {` por `const loadFiles = useCallback(async (cursor?: string, options: { silent?: boolean } = {}) => {`.
2. Cambia `if (cursor) setLoadingMore(true);\n    else setLoading(true);` por `if (cursor) setLoadingMore(true);\n    else if (!options.silent) setLoading(true);` (en el del equipo, el bloque está después del `if (!capabilities.filesRead)`).
3. En el `catch`, después de `if (loadRequestIdRef.current !== requestGeneration) return;`, agrega `if (options.silent) return;` (una relectura en vivo fallida conserva lo que se veía).
4. En el `finally`, cambia `else setLoading(false);` por `else if (!options.silent) setLoading(false);`.
5. Después de `useEffect(() => { void loadFiles(); }, [loadFiles]);`, agrega (equipo):

```ts
  useRealtimeRequest(capabilities.filesRead ? requestId : null, ['files'], () => { void loadFiles(undefined, { silent: true }); });
```

   o (portal):

```ts
  useRealtimeRequest(requestId, ['files'], () => { void loadFiles(undefined, { silent: true }); });
```

6. Importa `import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';`.

- [ ] **Step 2: Detalle clásico**

En `src/components/StaffRequestsPanel.tsx`:
1. Cambia `import { useInbox } from '@/components/inbox/InboxProvider';` por `import { useInbox, useInboxActiveContext } from '@/components/inbox/InboxProvider';` y agrega `import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';`.
2. Después de `const openUnread = …;`, agrega `useInboxActiveContext(openRequestId);`.
3. Después de `const loadDetailGenerationRef = useRef(0);`, agrega:

```ts
  const selectedDataRef = useRef<RequestDetail | null>(null);
  const loadingDetailRef = useRef(false);
  useEffect(() => { selectedDataRef.current = selected; }, [selected]);
  useEffect(() => { loadingDetailRef.current = loadingDetail; }, [loadingDetail]);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (liveUpdatedAt === null) return undefined;
    const timer = window.setTimeout(() => setLiveUpdatedAt(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [liveUpdatedAt]);
```

4. Cambia `const loadDetail = useCallback(async (id: string) => {` por `const loadDetail = useCallback(async (id: string, options: { silent?: boolean } = {}) => {`, y justo al inicio del cuerpo agrega:

```ts
    // Una relectura en vivo no compite con una carga normal en curso (ésa ya trae lo último).
    if (options.silent && loadingDetailRef.current) return;
```

5. Cambia `setLoadingDetail(true);\n    setError(null);` (al inicio de `loadDetail`) por `if (!options.silent) {\n      setLoadingDetail(true);\n      setError(null);\n    }`.
6. Después de `if (loadDetailGenerationRef.current !== generation) return;` (en el `try`), agrega:

```ts
      if (options.silent) {
        // Otra persona cambió el expediente: se actualiza lo que se ve sin tocar lo que se está escribiendo.
        const previousAssignee = selectedDataRef.current?.currentAssignee?.id ?? '';
        setSelected(data);
        setAssignmentId((value) => (value === previousAssignee ? data.currentAssignee?.id ?? '' : value));
        setLiveUpdatedAt(Date.now());
        return;
      }
```

7. En el `catch`, cambia `if (loadDetailGenerationRef.current !== generation) return;` por `if (loadDetailGenerationRef.current !== generation || options.silent) return;`.
8. En el `finally`, cambia `setLoadingDetail(false);` por `if (!options.silent) setLoadingDetail(false);`.
9. Después del efecto `useEffect(() => { selectedIdRef.current = selectedId; … }, [loadDetail, selectedId]);`, agrega:

```ts
  useRealtimeRequest(selected?.id ?? null, ['status', 'assignment', 'quote', 'project'], (change) => {
    if (change.self && change.reason === 'signal') return;
    const id = selectedIdRef.current;
    if (id) void loadDetail(id, { silent: true });
  });
```

10. En el JSX del detalle, justo antes de la sección de historial (`<section className="staff-history">`), agrega `{liveUpdatedAt !== null && <p className="live-updated" role="status">Actualizado hace un momento</p>}`.

- [ ] **Step 3: Detalle V2**

En `src/components/RequestWorkspaceDetailV2.tsx`:
1. Cambia `import { useInbox } from '@/components/inbox/InboxProvider';` por `import { useInbox, useInboxActiveContext } from '@/components/inbox/InboxProvider';` y agrega `import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';`.
2. Después de `const openUnread = …;`, agrega `useInboxActiveContext(openRequestId);`.
3. Después de `const refreshDetail = useCallback(…);`, agrega:

```ts
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (liveUpdatedAt === null) return undefined;
    const timer = window.setTimeout(() => setLiveUpdatedAt(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [liveUpdatedAt]);
  useRealtimeRequest(requestId, ['status', 'assignment', 'quote', 'project'], (change) => {
    if (change.self && change.reason === 'signal') return;
    void refreshDetail().then(() => setLiveUpdatedAt(Date.now()));
  });
```

4. En el JSX, justo después del encabezado del expediente (`<RequestWorkspaceHeaderV2 … />`), agrega `{liveUpdatedAt !== null && <p className="live-updated" role="status">Actualizado hace un momento</p>}`.

- [ ] **Step 4: Portal**

En `src/components/ClientPortalPanel.tsx`:
1. Cambia `import { useInbox } from '@/components/inbox/InboxProvider';` por `import { useInbox, useInboxActiveContext } from '@/components/inbox/InboxProvider';` y agrega `import { useCoalesced, useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';` y `import { ANY_REQUEST } from '@/lib/realtime-subscriptions';`.
2. Cambia `const loadRequests = useCallback(async () => {\n    setLoading(true);\n    setError(null);` por `const loadRequests = useCallback(async (options: { silent?: boolean } = {}) => {\n    if (!options.silent) {\n      setLoading(true);\n      setError(null);\n    }`.
3. En su `catch`, al inicio, agrega `if (options.silent) return;`, y en su `finally` cambia `setLoading(false);` por `if (!options.silent) setLoading(false);`.
4. Después de `const openUnread = …;`, agrega `useInboxActiveContext(openRequestId);`.
5. Después del efecto que marca como leído, agrega:

```ts
  // El riel y el expediente abierto se ponen al día solos (spec §5.4); archivos e hilo tienen su propia escucha.
  const pendingDetailRef = useRef(false);
  const refreshPortal = useCoalesced(() => {
    void loadRequests({ silent: true });
    if (pendingDetailRef.current && openRequestId) void loadDetail(openRequestId, { silent: true });
    pendingDetailRef.current = false;
  }, 600);
  useRealtimeRequest(ANY_REQUEST, ['created', 'status', 'quote', 'project'], (change) => {
    if (change.self && change.reason === 'signal') return;
    if (change.requestId === null || change.requestId === openRequestId) pendingDetailRef.current = true;
    refreshPortal();
  });
```

- [ ] **Step 5: Estilo**

En `src/components/private/ui/private-surfaces.css`, al final de las reglas del hilo agregadas en la Task 5, agrega:

```css
.live-updated { margin: 0 0 12px; color: var(--private-color-ink-muted); font-size: 12px; font-weight: 650; }
```

- [ ] **Step 6: Verificación y commit**

Run: `npx tsc --noEmit && npx eslint src/components/StaffFilesPanel.tsx src/components/ClientFilesPanel.tsx src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceDetailV2.tsx src/components/ClientPortalPanel.tsx && npx vitest run tests/unit`
Expected: sin errores.

```bash
git add src/components/StaffFilesPanel.tsx src/components/ClientFilesPanel.tsx src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceDetailV2.tsx src/components/ClientPortalPanel.tsx src/components/private/ui/private-surfaces.css
git commit -m "feat(realtime): archivos, detalle del expediente y portal se actualizan solos; la actividad abierta no destella"
```

---

### Task 7: Bandeja de solicitudes, colas, aprobaciones y cotizador

**Files:**
- Modify: `src/components/StaffRequestsPanel.tsx` (lista), `RequestWorkspaceV2Panel.tsx`, `StaffDashboardPanel.tsx`, `StaffApprovalsPanel.tsx`, `StaffQuotesPanel.tsx` y `private-surfaces.css`

**Interfaces:**
- Consumes (Task 4): `useRealtimeRequest`, `useCoalesced` y `ANY_REQUEST`.

- [ ] **Step 1: Bandeja clásica**

En `src/components/StaffRequestsPanel.tsx`:
1. Agrega `useCoalesced` a la importación de `useRealtimeRequest` y agrega `import { ANY_REQUEST } from '@/lib/realtime-subscriptions';`.
2. Cambia `const loadList = useCallback(async (currentPage: number, currentStatus: string, query: string, currentView: InboxView, keepSelection = false) => {` por `const loadList = useCallback(async (currentPage: number, currentStatus: string, query: string, currentView: InboxView, keepSelection = false, options: { silent?: boolean } = {}) => {`.
3. En su cuerpo, cambia `setLoadingList(true);\n    setError(null);` por `if (!options.silent) {\n      setLoadingList(true);\n      setError(null);\n    }`.
4. Después de `const data = result.data;`, agrega `setListNews(0);`.
5. En el `catch`, al inicio, agrega `if (options.silent) return;` después de la guarda de generación. En el `finally`, cambia `setLoadingList(false);` por `if (!options.silent) setLoadingList(false);`.
6. Antes de `const loadList`, agrega:

```ts
  // Novedades en la bandeja (spec §5.4): arriba y sin desplazarse se refresca sola; si no, se avisa.
  const [listNews, setListNews] = useState(0);
  const requestListRef = useRef<HTMLDivElement>(null);
```

7. Después del efecto que llama a `loadList(page, statusFilter, appliedSearch, view)`, agrega:

```ts
  const onListChange = useCoalesced(() => {
    if (page === 1 && (requestListRef.current?.scrollTop ?? 0) < 8) void loadList(page, statusFilter, appliedSearch, view, true, { silent: true });
    else setListNews((count) => count + 1);
  }, 800);
  useRealtimeRequest(ANY_REQUEST, ['created', 'status', 'assignment'], (change) => {
    if (change.self && change.reason === 'signal') return;
    onListChange();
  });
```

8. En el JSX, agrega `ref={requestListRef}` a `<div className="staff-request-list" aria-live="polite">`, y dentro de `<div className="staff-inbox__head">`, antes de `{filtersActive && …}`, agrega:

```tsx
{listNews > 0 && <button type="button" className="staff-inbox__news" onClick={() => { setListNews(0); void loadList(page, statusFilter, appliedSearch, view, true); }}>{listNews === 1 ? 'Hay 1 novedad' : `Hay ${listNews} novedades`} · Actualizar</button>}
```

- [ ] **Step 2: Bandeja V2**

En `src/components/RequestWorkspaceV2Panel.tsx`, localiza el efecto que pide la lista (el que termina en `setItems(result.data.items)`):
1. Agrega `const [liveToken, setLiveToken] = useState(0);` junto a los demás estados, y `liveToken` a las dependencias de ese efecto.
2. Importa `import { useCoalesced, useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';` y `import { ANY_REQUEST } from '@/lib/realtime-subscriptions';`, y agrega después del efecto:

```ts
  const refreshList = useCoalesced(() => setLiveToken((token) => token + 1), 800);
  useRealtimeRequest(ANY_REQUEST, ['created', 'status', 'assignment'], (change) => {
    if (!(change.self && change.reason === 'signal')) refreshList();
  });
```

- [ ] **Step 3: Colas del dashboard**

En `src/components/StaffDashboardPanel.tsx`:
1. Importa `useCoalesced`, `useRealtimeRequest` y `ANY_REQUEST` como arriba.
2. Antes de los efectos de colas, agrega:

```ts
  // Colas en vivo (spec §5.4): cualquier cambio de un expediente las relee, agrupado cada 2 s y sin esqueleto.
  const [queuesToken, setQueuesToken] = useState(0);
  const queuesLoadedRef = useRef(false);
  const refreshQueues = useCoalesced(() => setQueuesToken((token) => token + 1), 2_000);
  useRealtimeRequest(ANY_REQUEST, ['created', 'status', 'assignment', 'messages', 'quote', 'approvals', 'project'], refreshQueues);
```

3. Agrega `queuesToken` a las dependencias de los efectos de "Proyectos en arranque", "Sin respuesta del cliente", "Aceptadas sin proyecto" y "Qué atender ahora" (el de `loadQueues`).
4. En `loadQueues`, cambia `setQueuesLoading(true);` por `if (!queuesLoadedRef.current) setQueuesLoading(true);`, y después de `if (mineResult.ok) setMineQueue(mineResult.data);` agrega `queuesLoadedRef.current = true;`.

- [ ] **Step 4: Aprobaciones**

En `src/components/StaffApprovalsPanel.tsx`:
1. Importa `useCoalesced`, `useRealtimeRequest` y `ANY_REQUEST`.
2. Después de `const [rejectReason, setRejectReason] = useState('');`, agrega:

```ts
  const loadedRef = useRef(false);
  const refreshApprovals = useCoalesced(() => setReloadKey((key) => key + 1), 2_000);
  useRealtimeRequest(ANY_REQUEST, ['approvals'], (change) => { if (!(change.self && change.reason === 'signal')) refreshApprovals(); });
```

3. En `load`, cambia `setLoading(true);` por `if (!loadedRef.current) setLoading(true);`, y después de `setData(result.data);` agrega `loadedRef.current = true;`.
4. Agrega `useRef` a la importación de React si falta.

- [ ] **Step 5: Cotizador**

En `src/components/StaffQuotesPanel.tsx`:
1. Importa `import { useRealtimeRequest } from '@/components/inbox/useRealtimeRequest';`.
2. Cambia `const loadWorkspace = useCallback(async (requestId: string) => {` por `const loadWorkspace = useCallback(async (requestId: string, options: { silent?: boolean } = {}) => {`, `setLoadingWorkspace(true);` (al inicio) por `if (!options.silent) setLoadingWorkspace(true);` y, en su `finally`, `setLoadingWorkspace(false);` por `if (!options.silent) setLoadingWorkspace(false);`. Después de `setWorkspace(data);`, agrega `setRemoteChange(false);`.
3. Después de la declaración de `approvalRequestDialog`, agrega:

```ts
  // Cambios de otra persona (spec §5.4): sin cambios propios pendientes ni diálogos abiertos, se releen en silencio;
  // si no, nunca se recarga: se avisa y la persona decide.
  const [remoteChange, setRemoteChange] = useState(false);
  useRealtimeRequest(selectedId, ['quote', 'approvals'], (change) => {
    if (change.self && change.reason === 'signal') return;
    const busy = repriceDialogOpen || returnToDraftDialogOpen || rejectVersionDialogOpen || rejectApprovalDialog !== null || approvalRequestDialog !== null || publishPreflight !== null;
    if (autosaveState === 'saved' && !busy && selectedId) void loadWorkspace(selectedId, { silent: true });
    else setRemoteChange(true);
  });
```

4. En el JSX, justo antes de `<div className="quotes-actions" id="quotes-actions" tabIndex={-1}>`, agrega:

```tsx
{remoteChange && <div className="quotes-remote-note" role="status"><span>Hay cambios nuevos en esta cotización; guarda para verlos.</span>{autosaveState === 'saved' && selectedId ? <button type="button" className="staff-button staff-button--outline" onClick={() => void loadWorkspace(selectedId)}>Actualizar</button> : null}</div>}
```

5. En el efecto `useEffect(() => { if (selectedId) void loadWorkspace(selectedId); else setWorkspace(null); }, [loadWorkspace, selectedId]);`, agrega `setRemoteChange(false);` al inicio del cuerpo.

- [ ] **Step 6: Estilos**

En `src/components/private/ui/private-surfaces.css`, agrega:

```css
.staff-inbox__news { border: 0; border-radius: 999px; padding: 4px 10px; background: var(--private-tint-accent); color: var(--private-color-accent); cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
.staff-inbox__news:focus-visible { outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
.quotes-remote-note { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 12px; border: 1px solid color-mix(in srgb, var(--private-color-accent) 30%, transparent); border-radius: var(--private-radius-panel); padding: 10px 14px; background: var(--private-tint-accent); color: var(--private-color-ink); font-size: 13px; }
```

- [ ] **Step 7: Verificación y commit**

Run: `npx tsc --noEmit && npx eslint src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceV2Panel.tsx src/components/StaffDashboardPanel.tsx src/components/StaffApprovalsPanel.tsx src/components/StaffQuotesPanel.tsx && npx vitest run tests/unit`
Expected: sin errores.

QA en navegador en :3010 (escenario aislado con `scripts/qa-realtime-scenario.ts`, temporal):
- Con el expediente abierto en la bandeja, un mensaje del cliente aparece en el hilo con "Nuevo", sin flash y sin recargar.
- Al abrir el cliente su hilo, aparece "Visto · hace un momento".
- Un archivo del cliente aparece en Archivos.
- Una reasignación desde otra sesión actualiza el detalle y muestra "Actualizado hace un momento".
- La bandeja con la lista desplazada muestra "Hay 1 novedad · Actualizar".
- El cotizador con cambios sin guardar muestra el aviso en vez de recargar.
- El portal ve el mensaje del equipo y el cambio de estado sin recargar.

```bash
git add src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceV2Panel.tsx src/components/StaffDashboardPanel.tsx src/components/StaffApprovalsPanel.tsx src/components/StaffQuotesPanel.tsx src/components/private/ui/private-surfaces.css
git commit -m "feat(realtime): bandeja, colas del dashboard, aprobaciones y cotizador se actualizan solos sin estorbar"
```

---

### Task 8: E2E, documentación y verificación completa

**Files:**
- Create: `tests/realtime-screens.spec.ts` y `docs/ocpool-commercial-v2/specs/2026-09-30-pantallas-en-vivo.md`
- Modify: `PROJECT_STATUS.md`

- [ ] **Step 1: E2E (`REALTIME_E2E=1`)**

Crear `tests/realtime-screens.spec.ts` (escenario aislado, como `tests/realtime-notifications.spec.ts`, con su limpieza):

```ts
import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { listConversationMessages, sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';

test.describe('pantallas en vivo', () => {
  test.skip(process.env.REALTIME_E2E !== '1', 'Realtime E2E requires REALTIME_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'serial' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const customerName = `Cliente Pantallas ${suffix}`;
  const salesToken = `screens-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const customerToken = `screens-e2e-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let customerId = '';
  let sales: Actor;
  let customer: Actor;
  let sent = 0;

  test.beforeAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all(['sales', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    salesId = (await prisma.user.create({ data: { email: `screens-e2e-sales-${suffix}@example.test`, emailNormalized: `screens-e2e-sales-${suffix}@example.test`, displayName: `Ventas Pantallas ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `screens-e2e-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: customerName, email: `screens-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca con cascada', location: 'Querétaro', description: 'Fixture de pantallas en vivo', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `screens-e2e-customer-${suffix}@example.test`, emailNormalized: `screens-e2e-customer-${suffix}@example.test`, displayName: customerName, type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: salesId, status: 'EN_REVISION' } });
    sales = { userId: salesId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send']), mfaVerified: true };
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'screens-e2e' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'screens-e2e' }, { prisma, tokenGenerator: () => customerToken });
  });

  test.afterAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    const files = await prisma.fileAttachment.findMany({ where: { quoteRequestId: requestId }, select: { id: true, storageObjectId: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id), ...files.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [salesId, customerId] } }] } });
    await prisma.fileAttachment.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.storageObject.deleteMany({ where: { id: { in: files.map(({ storageObjectId }) => storageObjectId) } } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, customerId] } } });
    for (const userId of [salesId, customerId]) await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${userId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  const next = () => { sent += 1; return `screens-e2e-${sent}-${suffix}`; };
  const liveOn = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname === '/api/realtime' && response.status() === 200);
  const signIn = (page: Page, token: string) => page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);

  test('el hilo del portal se actualiza solo cuando el equipo responde', async ({ page }) => {
    await signIn(page, customerToken);
    const live = liveOn(page);
    await page.goto(`/portal?request=${requestId}`);
    await live;
    await expect(page.getByRole('heading', { name: 'Conversación del expediente' })).toBeVisible();
    await sendStaffMessage(sales, requestId, { body: 'Ya quedó tu propuesta.', idempotencyKey: next() }, { prisma, rateLimit });
    await expect(page.locator('.client-messaging__list')).toContainText('Ya quedó tu propuesta.', { timeout: 5_000 });
    await expect(page.locator('.thread-divider')).toHaveText('Nuevo');
  });

  test('el equipo ve el mensaje del cliente sin flash y el Visto cuando el cliente lo lee', async ({ page }) => {
    await signIn(page, salesToken);
    const live = liveOn(page);
    await page.goto(`/staff/requests?request=${requestId}`);
    await live;
    await expect(page.getByRole('heading', { name: 'Correspondencia' })).toBeVisible();
    await sendCustomerMessage(customer, requestId, { body: 'Perfecto, gracias.', idempotencyKey: next() }, { prisma, rateLimit });
    await expect(page.locator('.staff-messaging__list')).toContainText('Perfecto, gracias.', { timeout: 5_000 });
    // El expediente está abierto: su actividad no destella.
    await expect(page.getByRole('region', { name: 'Avisos al momento' }).getByRole('status')).toHaveCount(0);
    await sendStaffMessage(sales, requestId, { body: '¿Agendamos visita?', idempotencyKey: next() }, { prisma, rateLimit });
    await expect(page.locator('.staff-messaging__list')).toContainText('¿Agendamos visita?', { timeout: 5_000 });
    await listConversationMessages(customer, requestId, {}, { prisma });
    await expect(page.locator('.thread-seen')).toContainText('Visto', { timeout: 5_000 });
  });

  test('un archivo que sube el cliente aparece solo en el expediente del equipo', async ({ browser }) => {
    const staffContext = await browser.newContext();
    const customerContext = await browser.newContext();
    try {
      const staffPage = await staffContext.newPage();
      await staffContext.addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
      const live = liveOn(staffPage);
      await staffPage.goto(`/staff/requests?request=${requestId}`);
      await live;
      const customerPage = await customerContext.newPage();
      await customerContext.addCookies([{ name: 'ocpool_session', value: customerToken, url: origin }]);
      await customerPage.goto(`/portal?request=${requestId}`);
      await expect(customerPage.getByRole('heading', { name: 'Archivos del expediente' })).toBeVisible();
      await customerPage.locator('input[type="file"]').setInputFiles({ name: 'planos-en-vivo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') });
      await expect(customerPage.locator('.client-file').filter({ hasText: 'planos-en-vivo.pdf' }).getByText('Disponible', { exact: true })).toBeVisible();
      await expect(staffPage.getByText('planos-en-vivo.pdf').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await staffContext.close();
      await customerContext.close();
    }
  });
});
```

Si la sección de Archivos del detalle clásico no está a la vista al abrir el expediente, la tercera prueba abre primero esa sección con su control (se revisa el nombre accesible en la ejecución) antes de esperar el archivo.

Run (servidor de desarrollo aislado en :3100 con `NEXT_DIST_DIR=.next-e2e`, rutas calentadas): `APP_URL=http://127.0.0.1:3100 REALTIME_E2E=1 REUSE_E2E_SERVER=1 npx playwright test tests/realtime-screens.spec.ts tests/realtime-notifications.spec.ts --reporter=list`
Expected: todas pasan (repite una vez si falla por compilación en frío).

- [ ] **Step 2: Documentación**

Crear `docs/ocpool-commercial-v2/specs/2026-09-30-pantallas-en-vivo.md` con: problema, decisión (señal `r`, tabla, alcance, `self`, suscripciones), qué se actualiza solo en cada pantalla, "Visto", supresión por contexto, desviaciones, hallazgos, verificación con comandos y resultados reales, y qué queda para los bloques 4 y 5.

En `PROJECT_STATUS.md`, agrega una entrada después de la del bloque 2: **"Pantallas en vivo y Visto por el cliente (bloque 3 de notificaciones en tiempo real) 2026-09-30"**.

- [ ] **Step 3: Verificación completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Run: `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1` (en segundo plano)
Run (en segundo plano, sin editar archivos mientras corre): la E2E completa con los flags de siempre más `INBOX_E2E=1 REALTIME_E2E=1`.
Expected: sólo falla la línea base aceptada.

Revisa los restos (`inbox_notifications`, usuarios y contactos con prefijo `rt-`, `realtime-e2e-`, `screens-` o `qa-realtime-`).

- [ ] **Step 4: Commit**

```bash
git add tests/realtime-screens.spec.ts docs/ocpool-commercial-v2/specs/2026-09-30-pantallas-en-vivo.md PROJECT_STATUS.md
git commit -m "test(realtime): pantallas en vivo de punta a punta y documentación del bloque 3"
```

---

## Cobertura de la spec en este bloque

| Spec | Tarea |
|---|---|
| §4.1 Señal `r` con partes y visibilidad; tabla por evento con prueba de exhaustividad | 1 |
| §4.2 Alcance de `r` (equipo global, responsable, anterior, pool sin responsable; cliente sólo `C`) | 3 |
| §4.3 Evento `request` | 3 |
| §4.4 Suscripciones `useRealtimeRequest`; sin canal, las vistas se refrescan al volver a la pestaña | 4 |
| §5.3 Supresión por contexto (`setActiveContext`) | 4 y 6 |
| §5.4 Hilos (posterior al último conocido, "Nuevo", píldora) | 5 |
| §5.4 Archivos | 6 |
| §5.4 Detalle (clásico y V2) con "Actualizado hace un momento" | 6 |
| §5.4 Constructor de cotizaciones (sin cambios: relectura; con cambios: aviso) | 7 |
| §5.4 Bandeja de solicitudes ("Hay N novedades · Actualizar") | 7 |
| §5.4 Colas del dashboard y aprobaciones (espera de 2 s) | 7 |
| §5.4 Portal: riel y expediente | 6 |
| §5.4 "Visto por el cliente" | 2 y 5 |
| §13 Pruebas del bloque 3 | todas |

**Fuera de este bloque**
- `PROJECT.OWNER_CHANGED` no lleva expediente: las páginas de proyectos no son parte de §5.4.
- Los eventos de catálogo y precios no tocan pantallas de expediente.
