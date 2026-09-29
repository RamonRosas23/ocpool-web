# Tiempo real y aviso flash (bloque 2) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la campana, el contador y un aviso flash reaccionen al instante, sin recargar, en todas las pestañas de cada persona, con sonido y alertas de escritorio opcionales, y que el canal se cierre en cuanto una sesión se revoca.

**Architecture:**
- El bloque 1 ya emite `pg_notify('ocpool_realtime', …)` con cada aviso (`n`) y cada lectura (`u`). Aquí se agrega la señal `s` (cerrar sesiones) y se conecta todo al navegador.
- En el proceso Next, un hub con una conexión `pg.Client` dedicada escucha el canal y reparte a las conexiones SSE de `GET /api/realtime`. Cada conexión revalida su sesión, manda `ping` y se reanuda con `Last-Event-ID`.
- En el navegador, la pestaña que obtiene el Web Lock abre el `EventSource` y reparte los eventos a las demás por `BroadcastChannel`. Sin conexión en vivo, todas vuelven a consultar cada 30 s; el interruptor `REALTIME_ENABLED=false` deja a todos en consulta sin desplegar.

**Tech Stack:** Next.js 15 (route handler en Node con `ReadableStream`), `pg` 8 (LISTEN), React 19, Web Locks, BroadcastChannel, EventSource, Web Audio y Notification API, vitest y Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md` (§4, §5.1 pie del panel, §5.3, §10 en `localStorage`, §11 canal, §12 y §13 del bloque 2).

## Global Constraints

**Entorno y rama**
- Se trabaja en `C:\Desarrollo\WEBS\OCPOOL-WEB` (Windows con Git Bash y PowerShell), rama `feat/notificaciones-tiempo-real`.
- Commit al final de cada tarea, **sin push**. Las ediciones por script se hacen con `node` y respetan CRLF; los scripts con barras invertidas se escriben con la herramienta Write, nunca en un heredoc.

**Servidor de desarrollo y datos**
- No se detiene el `npm run dev` del usuario en :3000. La QA en navegador corre en :3010 (`NEXT_DIST_DIR=.next-qa`) y al terminar se restaura `tsconfig.json`, se borra `.next-qa/` y se quita la entrada de `.claude/launch.json`.
- Nunca se usan los fixtures del piloto. Las pruebas crean y borran sus propios datos; una solicitud del sitio avisa a todo el pool, así que se borra siempre.
- En desarrollo, un cambio en `src/server/realtime/*` puede quedar oculto por el singleton en `globalThis`: reinicia el servidor de QA antes de probarlo.

**Protocolo (spec §4)**
- El canal lleva sólo identificadores. Señales: `n` `{u, id, m}`, `u` `{u}` y `s` `{u, sid?, keep?}` (con `sid`, sólo esa sesión; con `keep`, todas menos esa; sin ninguno, todas).
- Eventos SSE: `hello`, `notification` (con `id:` = `updatedAtMs-id`), `counts`, `resync`, `bye` y `ping`. Encabezados `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive` y `x-accel-buffering: no`.
- Variables: `REALTIME_ENABLED` (true), `REALTIME_HEARTBEAT_SECONDS` (25), `REALTIME_SESSION_RECHECK_SECONDS` (60) y `REALTIME_MAX_CONNECTIONS_PER_USER` (10).

**Interfaz (spec §5.3 y §10)**
- Flash sólo para URGENT (fijo, `role="alert"`) y HIGH (8 s, pausa con puntero o foco, barra de progreso, `role="status"`). NORMAL e INFO no destellan.
- Máximo 3 en escritorio y 2 en móvil; el resto es "y N más", que abre el panel. `z-index` por encima de los toasts.
- Un aviso agrupado reemplaza su tarjeta, vuelve a destellar y reinicia el tiempo. La actividad del expediente abierto no destella, salvo lo URGENT.
- Sonido: tono de Web Audio, uno cada 3 s como máximo; encendido por defecto para el equipo y apagado para clientes. Escritorio: sólo si la persona lo activa; el permiso se pide en ese gesto; `tag` = id del aviso; lo muestra la pestaña líder cuando ninguna pestaña está visible.
- Las preferencias viven en `localStorage` hasta el bloque 5. Esc cierra el flash con foco, no se roba el foco y con movimiento reducido no hay deslizamiento.

**Calidad**
- Al final de cada tarea: `npx tsc --noEmit`, lint de los archivos tocados y las pruebas de la tarea. La integración usa `RUN_DB_TESTS=1` y afirma sólo sobre datos propios.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/server/realtime/publish.ts` | Señal `s`, `decodeRealtimeSignal` y `publishSessionsClosed` |
| `src/server/realtime/sse.ts` (nuevo) | Encabezados, codificación de eventos y cursor de reanudación |
| `src/server/realtime/hub.ts` (nuevo) | Registro de conexiones y reparto de `n`, `u` y `s` |
| `src/server/realtime/listener.ts` (nuevo) | Conexión `LISTEN` dedicada con reconexión exponencial |
| `src/server/realtime/runtime.ts` (nuevo) | Singleton en `globalThis` que une hub, listener y consultas |
| `src/server/realtime/stream.ts` (nuevo) | Vida de una conexión SSE: `hello`, `ping`, revalidación, reanudación, presión y limpieza |
| `src/app/api/realtime/route.ts` (nuevo) | `GET /api/realtime` |
| `src/server/modules/inbox/service.ts` | `updatedAt` en el DTO, `requireInboxAccess`, `getInboxNotificationForActor`, `getRequestUnreadCount` y `listInboxUpdatedSince` |
| `src/server/env.ts`, `.env.example` | Variables `REALTIME_*` |
| `src/server/auth/service.ts`, `src/server/auth/sessions.ts`, `src/server/modules/account/service.ts`, `src/server/modules/team/service.ts` | Publican `s` al revocar sesiones |
| `src/lib/realtime-client.ts` (nuevo) | Eventos, reductor, `shouldFlash`, pestaña líder, candados de visibilidad y `RealtimeController` |
| `src/lib/inbox-flash.ts`, `inbox-preferences.ts`, `inbox-sound.ts`, `inbox-desktop.ts` (nuevos) | Cola de flashes, preferencias, tono y notificación de escritorio |
| `src/components/inbox/useInboxRealtime.ts` (nuevo) | Líder, relevo entre pestañas y vigencia del canal |
| `src/components/inbox/InboxProvider.tsx` | Estado en vivo, flashes, preferencias y contexto activo |
| `src/components/inbox/FlashAlertStack.tsx` (nuevo) | Pila de flashes |
| `src/components/inbox/NotificationBell.tsx`, `inbox.css` | Pie con sonido y escritorio, apertura por "y N más" y estilos del flash |
| `src/app/staff/layout.tsx`, `src/app/portal/layout.tsx` | Sesión por fuera de la bandeja y pila de flashes montada |
| `src/components/StaffRequestsPanel.tsx`, `RequestWorkspaceDetailV2.tsx`, `ClientPortalPanel.tsx` | Registran el expediente abierto como contexto activo |

**Pruebas nuevas**
- Unitarias: `realtime-protocol`, `realtime-hub`, `realtime-listener`, `realtime-stream`, `realtime-client` e `inbox-flash`.
- Integración: `realtime-session-signals`, `inbox-realtime-queries` y `realtime-api`.
- E2E: `tests/realtime-notifications.spec.ts` (`REALTIME_E2E=1`).

---

### Task 1: Protocolo: señal `s`, decodificador, SSE y configuración

**Files:**
- Modify: `src/server/realtime/publish.ts`
- Create: `src/server/realtime/sse.ts`
- Modify: `src/server/env.ts` y `.env.example`
- Test: `tests/unit/realtime-protocol.test.ts`

**Interfaces:**
- Produces:
  - `type RealtimeSignal` con la variante `{ t: 's'; u; sid?; keep? }`.
  - `decodeRealtimeSignal(payload: string): RealtimeSignal | null`.
  - `publishSessionsClosed(client, { userId, sessionId?, keepSessionId? }): Promise<void>`.
  - `SSE_HEADERS`, `SSE_RETRY_MS`, `encodeSseEvent(event, data, id?)`, `encodeSseRetry(ms)`, `formatEventCursor(updatedAt, id)` y `parseEventCursor(value)`.
  - `ServerEnv.REALTIME_ENABLED: boolean`, `REALTIME_HEARTBEAT_SECONDS`, `REALTIME_SESSION_RECHECK_SECONDS` y `REALTIME_MAX_CONNECTIONS_PER_USER`.

- [ ] **Step 1: Escribir la prueba**

Crear `tests/unit/realtime-protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeRealtimeSignal, encodeRealtimeSignal } from '@/server/realtime/publish';
import { encodeSseEvent, encodeSseRetry, formatEventCursor, parseEventCursor, SSE_HEADERS } from '@/server/realtime/sse';
import { readServerEnv } from '@/server/env';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '6b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';

describe('realtime protocol', () => {
  it('decodes only well-formed signals', () => {
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 'n', u: USER, id: OTHER, m: 'created' }))).toEqual({ t: 'n', u: USER, id: OTHER, m: 'created' });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 'u', u: USER }))).toEqual({ t: 'u', u: USER });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 's', u: USER, keep: OTHER }))).toEqual({ t: 's', u: USER, keep: OTHER });
    expect(decodeRealtimeSignal(encodeRealtimeSignal({ t: 's', u: USER }))).toEqual({ t: 's', u: USER });
    expect(decodeRealtimeSignal(JSON.stringify({ t: 'n', u: USER, id: OTHER, m: 'deleted' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ t: 's', u: USER, sid: 'nope' }))).toBeNull();
    expect(decodeRealtimeSignal(JSON.stringify({ t: 'x', u: USER }))).toBeNull();
    expect(decodeRealtimeSignal('{"t":"u","u":"not-a-uuid"}')).toBeNull();
    expect(decodeRealtimeSignal('not json')).toBeNull();
  });

  it('writes one event per block with its data on a single line', () => {
    expect(encodeSseEvent('counts', { unread: 2, actionRequired: 1 })).toBe('event: counts\ndata: {"unread":2,"actionRequired":1}\n\n');
    expect(encodeSseEvent('notification', { title: 'Línea 1\nLínea 2' }, `1790000000000-${OTHER}`)).toBe(`id: 1790000000000-${OTHER}\nevent: notification\ndata: {"title":"Línea 1\\nLínea 2"}\n\n`);
    expect(encodeSseRetry(5000)).toBe('retry: 5000\n\n');
    expect(() => encodeSseEvent('bad name', {})).toThrow();
    expect(SSE_HEADERS['cache-control']).toBe('no-cache, no-transform');
    expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
  });

  it('round-trips the resume cursor and rejects anything else', () => {
    const at = new Date('2026-09-29T20:00:00.123Z');
    expect(parseEventCursor(formatEventCursor(at, OTHER))).toEqual({ at, id: OTHER });
    expect(parseEventCursor('garbage')).toBeNull();
    expect(parseEventCursor(null)).toBeNull();
  });

  it('reads the realtime switches with their defaults', () => {
    const base = { DATABASE_URL: 'postgresql://ocpool:ocpool@localhost:5432/ocpool', AUTH_DELIVERY_ENCRYPTION_KEY: process.env.AUTH_DELIVERY_ENCRYPTION_KEY, NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: process.env.NOTIFICATION_RECIPIENT_ENCRYPTION_KEY, MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY, AUDIT_CURSOR_SECRET: process.env.AUDIT_CURSOR_SECRET };
    expect(readServerEnv({ ...process.env, ...base })).toMatchObject({ REALTIME_ENABLED: true, REALTIME_HEARTBEAT_SECONDS: 25, REALTIME_SESSION_RECHECK_SECONDS: 60, REALTIME_MAX_CONNECTIONS_PER_USER: 10 });
    expect(readServerEnv({ ...process.env, ...base, REALTIME_ENABLED: 'false' }).REALTIME_ENABLED).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/realtime-protocol.test.ts`
Expected: FAIL (`decodeRealtimeSignal` y `@/server/realtime/sse` no existen).

- [ ] **Step 2: Señal `s` y decodificador**

Reemplaza `src/server/realtime/publish.ts` completo:

```ts
import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

/** Canal único de tiempo real (spec 2026-09-29 §4.1). El payload lleva sólo identificadores, nunca contenido. */
export const REALTIME_CHANNEL = 'ocpool_realtime';

export type RealtimeSignal =
  | Readonly<{ t: 'n'; u: string; id: string; m: 'created' | 'updated' | 'resolved' }>
  | Readonly<{ t: 'u'; u: string }>
  /** Cerrar conexiones: con `sid`, sólo las de esa sesión; con `keep`, todas menos esa; sin ninguno, todas. */
  | Readonly<{ t: 's'; u: string; sid?: string; keep?: string }>;

type SqlClient = PrismaClient | Prisma.TransactionClient;

const MAX_PAYLOAD_LENGTH = 7_900;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NOTIFICATION_MODES: ReadonlySet<string> = new Set(['created', 'updated', 'resolved']);

export function encodeRealtimeSignal(signal: RealtimeSignal): string {
  const payload = JSON.stringify(signal);
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error('Realtime signal is too large.');
  return payload;
}

function uuidField(value: Readonly<Record<string, unknown>>, key: string): string | null {
  const field = value[key];
  return typeof field === 'string' && UUID_PATTERN.test(field) ? field : null;
}

/** El hub sólo actúa sobre señales bien formadas: un payload ajeno o dañado se ignora. */
export function decodeRealtimeSignal(payload: string): RealtimeSignal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const userId = uuidField(value, 'u');
  if (!userId) return null;
  if (value.t === 'n') {
    const id = uuidField(value, 'id');
    return id && typeof value.m === 'string' && NOTIFICATION_MODES.has(value.m) ? { t: 'n', u: userId, id, m: value.m as 'created' | 'updated' | 'resolved' } : null;
  }
  if (value.t === 'u') return { t: 'u', u: userId };
  if (value.t === 's') {
    const sid = value.sid === undefined ? undefined : uuidField(value, 'sid');
    const keep = value.keep === undefined ? undefined : uuidField(value, 'keep');
    if (sid === null || keep === null) return null;
    return { t: 's', u: userId, ...(sid ? { sid } : {}), ...(keep ? { keep } : {}) };
  }
  return null;
}

/**
 * Dentro de una transacción, PostgreSQL entrega el NOTIFY sólo al confirmar: si la transacción se revierte
 * no sale nada, así que nunca se avisa de algo que no pasó. Fuera de una transacción se entrega de inmediato.
 * `$executeRaw` (y no `$queryRaw`) porque `pg_notify` devuelve `void`, que Prisma no deserializa.
 */
export async function publishRealtime(client: SqlClient, signal: RealtimeSignal): Promise<void> {
  await client.$executeRaw(Prisma.sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${encodeRealtimeSignal(signal)})`);
}

/** Una sesión revocada deja de recibir eventos al momento, sin esperar a la revalidación periódica (spec §4.2). */
export async function publishSessionsClosed(client: SqlClient, input: Readonly<{ userId: string; sessionId?: string; keepSessionId?: string }>): Promise<void> {
  await publishRealtime(client, { t: 's', u: input.userId, ...(input.sessionId ? { sid: input.sessionId } : {}), ...(input.keepSessionId ? { keep: input.keepSessionId } : {}) });
}
```

- [ ] **Step 3: Codificación SSE**

Crear `src/server/realtime/sse.ts`:

```ts
/** Encabezados del canal (spec §4.3). `no-transform` evita que la compresión de `next start` retenga eventos. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

export const SSE_RETRY_MS = 5_000;

const EVENT_NAME = /^[a-z]+$/u;
const CURSOR_PATTERN = /^(\d{1,15})-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export function encodeSseEvent(event: string, data: unknown, id?: string): string {
  if (!EVENT_NAME.test(event)) throw new Error('Invalid SSE event name.');
  if (id !== undefined && /[\r\n]/u.test(id)) throw new Error('Invalid SSE event id.');
  // JSON.stringify escapa los saltos de línea: el dato siempre cabe en una sola línea `data:`.
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function encodeSseRetry(milliseconds: number): string {
  return `retry: ${Math.max(0, Math.trunc(milliseconds))}\n\n`;
}

/** Cursor de reanudación (`id:` y `Last-Event-ID`): milisegundos de `updatedAt` y el id del aviso. */
export function formatEventCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.getTime()}-${id}`;
}

export function parseEventCursor(value: string | null | undefined): Readonly<{ at: Date; id: string }> | null {
  const match = CURSOR_PATTERN.exec(value?.trim() ?? '');
  if (!match) return null;
  const at = new Date(Number(match[1]));
  return Number.isNaN(at.getTime()) ? null : { at, id: match[2].toLowerCase() };
}
```

- [ ] **Step 4: Variables**

En `src/server/env.ts`, dentro de `serverEnvSchema`, justo después de `NOTIFICATION_POLL_INTERVAL_MS: integerEnv(2000, 100, 60_000),`, agrega:

```ts
  // Tiempo real (spec 2026-09-29 §12). Con REALTIME_ENABLED=false todos consultan cada 30 s, sin desplegar.
  REALTIME_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  REALTIME_HEARTBEAT_SECONDS: integerEnv(25, 5, 120),
  REALTIME_SESSION_RECHECK_SECONDS: integerEnv(60, 10, 600),
  REALTIME_MAX_CONNECTIONS_PER_USER: integerEnv(10, 1, 50),
```

En `.env.example`, justo después de la línea `NOTIFICATION_POLL_INTERVAL_MS=2000`, agrega:

```
# Tiempo real: con REALTIME_ENABLED=false todos consultan cada 30 s, sin desplegar.
REALTIME_ENABLED=true
REALTIME_HEARTBEAT_SECONDS=25
REALTIME_SESSION_RECHECK_SECONDS=60
REALTIME_MAX_CONNECTIONS_PER_USER=10
```

- [ ] **Step 5: Correr, typecheck y commit**

Run: `npx vitest run tests/unit/realtime-protocol.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests) y sin errores.

```bash
git add src/server/realtime/publish.ts src/server/realtime/sse.ts src/server/env.ts .env.example tests/unit/realtime-protocol.test.ts
git commit -m "feat(realtime): señal para cerrar sesiones, decodificador del canal, formato SSE y variables"
```

---

### Task 2: Cerrar el canal al revocar sesiones

**Files:**
- Modify: `src/server/auth/service.ts` (`consumePasswordRecovery` y `logout`), `src/server/auth/sessions.ts` (`revokeSession` y `revokeAllUserSessions`), `src/server/modules/account/service.ts` (4 funciones) y `src/server/modules/team/service.ts` (`suspendTeamMember` y `revokeTeamMemberSessions`)
- Test: `tests/integration/realtime-session-signals.test.ts`

**Interfaces:**
- Consumes (Task 1): `publishSessionsClosed`.
- Produces: toda revocación de sesiones publica `s` dentro de su transacción.

- [ ] **Step 1: Escribir la prueba**

Crear `tests/integration/realtime-session-signals.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { logout } from '@/server/auth/service';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { revokeAccountSession, revokeOtherAccountSessions } from '@/server/modules/account/service';
import { revokeTeamMemberSessions, suspendTeamMember } from '@/server/modules/team/service';

type Signal = { t: string; u: string; sid?: string; keep?: string };

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the signal.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('realtime signals when sessions close', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const context = { ipAddress: '127.0.0.1', userAgent: 'realtime-session-signals' };
  const received: Signal[] = [];
  let listener: pg.Client;
  let managerId = '';
  let memberId = '';

  const openSession = async (userId: string, key: string) => {
    const token = `rt-session-${key}-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    const { sessionId } = await createSession({ userId, ipAddress: null, userAgent: 'realtime-session-signals' }, { prisma, tokenGenerator: () => token });
    return { token, sessionId };
  };
  const closing = () => received.filter((signal) => signal.t === 's' && signal.u === memberId);
  const closingAll = () => closing().filter((signal) => !signal.sid && !signal.keep).length;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => { if (message.payload) received.push(JSON.parse(message.payload) as Signal); });
    const [salesRole, managerRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }), prisma.role.findUniqueOrThrow({ where: { key: 'manager' } })]);
    managerId = (await prisma.user.create({ data: { email: `rt-session-manager-${suffix}@example.test`, emailNormalized: `rt-session-manager-${suffix}@example.test`, displayName: 'RT Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    memberId = (await prisma.user.create({ data: { email: `rt-session-member-${suffix}@example.test`, emailNormalized: `rt-session-member-${suffix}@example.test`, displayName: 'RT Member', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
  });

  afterAll(async () => {
    await listener?.end();
    const userIds = [managerId, memberId].filter(Boolean);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it('closes just the revoked session, or every session but the current one', async () => {
    const current = await openSession(memberId, 'current');
    const other = await openSession(memberId, 'other');
    await openSession(memberId, 'third');
    const member: Actor = { userId: memberId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['identity.session.read', 'identity.session.revoke']), mfaVerified: true };
    await revokeAccountSession(member, current.sessionId, other.sessionId, context, { prisma });
    await waitFor(() => closing().some((signal) => signal.sid === other.sessionId && !signal.keep));
    await revokeOtherAccountSessions(member, current.sessionId, context, { prisma });
    await waitFor(() => closing().some((signal) => signal.keep === current.sessionId && !signal.sid));
  });

  it('closes the current session on logout', async () => {
    const session = await openSession(memberId, 'logout');
    await logout(session.token, context, { prisma });
    await waitFor(() => closing().some((signal) => signal.sid === session.sessionId));
  });

  it('closes every session when a manager revokes them or suspends the person', async () => {
    const manager: Actor = { userId: managerId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['identity.users.read', 'identity.users.manage']), mfaVerified: true };
    await openSession(memberId, 'team');
    const before = closingAll();
    await revokeTeamMemberSessions(manager, memberId, { prisma });
    await waitFor(() => closingAll() === before + 1);
    await suspendTeamMember(manager, memberId, {}, { prisma });
    await waitFor(() => closingAll() === before + 2);
  });
});
```

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/realtime-session-signals.test.ts`
Expected: FAIL por tiempo (no llega ninguna señal `s`).

- [ ] **Step 2: Publicar `s` en cada revocación**

Agrega `import { publishSessionsClosed } from '@/server/realtime/publish';` en los cuatro archivos y, en cada sitio, la línea indicada.

En `src/server/auth/service.ts`:
- `consumePasswordRecovery`, justo después de `await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });`:

```ts
    await publishSessionsClosed(transaction, { userId: user.id });
```

- `logout`, justo después de `if (revoked.count !== 1) return;`:

```ts
    await publishSessionsClosed(transaction, { userId: session.actor.userId, sessionId: session.sessionId });
```

En `src/server/auth/sessions.ts`, reemplaza `revokeSession` y `revokeAllUserSessions` por:

```ts
export async function revokeSession(sessionId: string, _reason: string, dependencies: SessionDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  const revoked = await prisma.session.updateManyAndReturn({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: dependencies.now ?? new Date() }, select: { userId: true } });
  for (const { userId } of revoked) await publishSessionsClosed(prisma, { userId, sessionId });
}

export async function revokeAllUserSessions(userId: string, dependencies: SessionDependencies = {}): Promise<void> {
  const prisma = dependencies.prisma ?? getPrisma();
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: dependencies.now ?? new Date() } });
  await publishSessionsClosed(prisma, { userId });
}
```

En `src/server/modules/account/service.ts`:
- `changeAccountPassword`, justo después de `const revoked = await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: now } });`:

```ts
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: user.id, keepSessionId: currentSessionId });
```

- `confirmAccountMfaEnrollment`, justo después de `const revoked = await transaction.session.updateMany({ where: { userId: actor.userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: now } });`:

```ts
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: actor.userId, keepSessionId: currentSessionId });
```

- `revokeAccountSession`, justo después de `if (revoked.count !== 1) throw new AppError('NOT_FOUND', 'Esa sesión ya estaba cerrada.', 404);`:

```ts
    await publishSessionsClosed(transaction, { userId: actor.userId, sessionId });
```

- `revokeOtherAccountSessions`, justo después de `const revoked = await transaction.session.updateMany({ where: { userId: actor.userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: now } });`:

```ts
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: actor.userId, keepSessionId: currentSessionId });
```

En `src/server/modules/team/service.ts`:
- `suspendTeamMember`, justo después de `const revoked = await transaction.session.updateMany({ where: { userId: member.id, revokedAt: null }, data: { revokedAt: now } });`:

```ts
    await publishSessionsClosed(transaction, { userId: member.id });
```

- `revokeTeamMemberSessions`, justo después de `const revoked = await transaction.session.updateMany({ where: { userId: member.id, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });`:

```ts
    if (revoked.count > 0) await publishSessionsClosed(transaction, { userId: member.id });
```

- [ ] **Step 3: Correr las pruebas**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/realtime-session-signals.test.ts tests/integration/account-service.test.ts tests/integration/team-service.test.ts tests/integration/identity-rbac.test.ts --maxWorkers=1 && npx tsc --noEmit`
Expected: todo en PASS; `realtime-session-signals` con 3 tests.

- [ ] **Step 4: Commit**

```bash
git add src/server/auth/service.ts src/server/auth/sessions.ts src/server/modules/account/service.ts src/server/modules/team/service.ts tests/integration/realtime-session-signals.test.ts
git commit -m "feat(realtime): toda revocación de sesiones cierra el canal en vivo al confirmar"
```

---

### Task 3: Consultas de la bandeja para el canal

**Files:**
- Modify: `src/server/modules/inbox/service.ts`, `src/lib/inbox-client.ts` y `tests/unit/inbox-client.test.ts`
- Test: `tests/integration/inbox-realtime-queries.test.ts`

**Interfaces:**
- Produces:
  - `InboxNotificationDto.updatedAt: string` (y `InboxNotification.updatedAt` en el cliente).
  - `requireInboxAccess(actor): void` (antes `requireInboxActor`, ahora exportada).
  - `getInboxNotificationForActor(actor, id, deps?): Promise<InboxNotificationDto | null>`.
  - `getRequestUnreadCount(actor, quoteRequestId, deps?): Promise<number>`.
  - `listInboxUpdatedSince(actor, cursor: { at: Date; id: string }, deps?): Promise<{ items: InboxNotificationDto[]; more: boolean }>` (50 por página).

- [ ] **Step 1: Escribir la prueba**

Crear `tests/integration/inbox-realtime-queries.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { getInboxNotificationForActor, getRequestUnreadCount, listInboxUpdatedSince } from '@/server/modules/inbox/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('inbox queries for the realtime channel', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const userIds: string[] = [];
  let sales: Actor;
  let ownNoticeId = '';
  let foreignNoticeId = '';
  let ownRequestId = '';

  const notice = (recipientId: string, overrides: Record<string, unknown>) => prisma.inboxNotification.create({ data: { recipientId, kind: 'customer.activity', priority: 'HIGH', title: 'Aviso', actionPath: '/staff/requests', data: {}, ...overrides } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    const salesUser = await prisma.user.create({ data: { email: `rt-queries-sales-${suffix}@example.test`, emailNormalized: `rt-queries-sales-${suffix}@example.test`, displayName: 'RT Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } });
    const otherUser = await prisma.user.create({ data: { email: `rt-queries-other-${suffix}@example.test`, emailNormalized: `rt-queries-other-${suffix}@example.test`, displayName: 'RT Other', type: 'EMPLOYEE', status: 'ACTIVE' } });
    userIds.push(salesUser.id, otherUser.id);
    sales = { userId: salesUser.id, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'requests.claim']), mfaVerified: true };
    for (const [index, owner] of ['own', 'foreign'].entries()) {
      const request = await createQuoteRequest({ idempotencyKey: `rt-queries-${owner}-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `RT ${owner}`, email: `rt-queries-${owner}-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'León', description: 'Fixture de consultas en vivo', consentAt: now } }, { prisma, now: new Date(now.getTime() + index) });
      requestIds.push(request.quoteRequestId);
      clientIds.push(request.clientId);
      contactIds.push(request.contactId);
    }
    [ownRequestId] = requestIds;
    await prisma.quoteRequest.update({ where: { id: requestIds[0] }, data: { currentAssigneeId: salesUser.id } });
    await prisma.quoteRequest.update({ where: { id: requestIds[1] }, data: { currentAssigneeId: otherUser.id } });
    ownNoticeId = (await notice(salesUser.id, { quoteRequestId: ownRequestId, title: 'Del expediente propio' })).id;
    await notice(salesUser.id, { quoteRequestId: ownRequestId, kind: 'request.received', priority: 'INFO', title: 'Informativo' });
    foreignNoticeId = (await notice(salesUser.id, { quoteRequestId: requestIds[1], title: 'Fuera de alcance' })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  it('reads one notice only within the current scope', async () => {
    expect(await getInboxNotificationForActor(sales, ownNoticeId, { prisma })).toMatchObject({ id: ownNoticeId, title: 'Del expediente propio', updatedAt: expect.any(String) });
    expect(await getInboxNotificationForActor(sales, foreignNoticeId, { prisma })).toBeNull();
    expect(await getInboxNotificationForActor(sales, randomUUID(), { prisma })).toBeNull();
    expect(await getInboxNotificationForActor(sales, 'not-an-id', { prisma })).toBeNull();
  });

  it('counts unread per file like the bell does', async () => {
    // El informativo no cuenta; el del expediente ajeno está fuera de alcance.
    expect(await getRequestUnreadCount(sales, ownRequestId, { prisma })).toBe(1);
    expect(await getRequestUnreadCount(sales, requestIds[1], { prisma })).toBe(0);
  });

  it('resumes after a cursor in update order, 50 at a time', async () => {
    const base = new Date(Date.now() + 60_000);
    await prisma.inboxNotification.createMany({ data: Array.from({ length: 52 }, (_, index) => ({ recipientId: sales.userId, kind: 'team.work_reassigned', priority: 'HIGH' as const, title: `Resume ${index}`, actionPath: '/staff/requests', data: {}, createdAt: base, lastActivityAt: base, updatedAt: new Date(base.getTime() + index * 1000) })) });
    const resumed = await prisma.inboxNotification.findMany({ where: { recipientId: sales.userId, title: { startsWith: 'Resume ' } }, orderBy: { updatedAt: 'asc' } });
    const first = await listInboxUpdatedSince(sales, { at: resumed[0].updatedAt, id: resumed[0].id }, { prisma });
    expect(first.items.map((item) => item.title)).toEqual(Array.from({ length: 50 }, (_, index) => `Resume ${index + 1}`));
    expect(first.more).toBe(true);
    const second = await listInboxUpdatedSince(sales, { at: resumed[50].updatedAt, id: resumed[50].id }, { prisma });
    expect(second).toMatchObject({ items: [{ title: 'Resume 51' }], more: false });
  });
});
```

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-realtime-queries.test.ts`
Expected: FAIL ("getInboxNotificationForActor is not a function").

- [ ] **Step 2: Implementar las consultas**

En `src/server/modules/inbox/service.ts`:
1. En `InboxNotificationDto`, después de `lastActivityAt: string;`, agrega `updatedAt: string;`.
2. En `DTO_SELECT`, cambia `lastActivityAt: true, readAt: true,` por `lastActivityAt: true, updatedAt: true, readAt: true,`.
3. En `toDto`, después de `lastActivityAt: row.lastActivityAt.toISOString(),`, agrega `updatedAt: row.updatedAt.toISOString(),`.
4. Renombra `function requireInboxActor(actor: Actor): void {` a `export function requireInboxAccess(actor: Actor): void {` y reemplaza sus cuatro llamadas `requireInboxActor(actor);` por `requireInboxAccess(actor);`.
5. Después de `const MAX_SEARCH_LENGTH = 60;`, agrega `const RESUME_LIMIT = 50;`.
6. Al final del archivo, agrega:

```ts
/** Un aviso tal como lo ve su destinatario, con el alcance vigente; null si ya no le corresponde (spec §4.2). */
export async function getInboxNotificationForActor(actor: Actor, id: string, dependencies: Dependencies = {}): Promise<InboxNotificationDto | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const prisma = dependencies.prisma ?? getPrisma();
  const row = await prisma.inboxNotification.findFirst({ where: { AND: [inboxScopeWhere(actor), { id }] }, select: DTO_SELECT });
  return row ? toDto(row) : null;
}

/** Sin leer de un expediente, con el mismo criterio que la campana ("N nuevas" del portal y lectura al abrir). */
export async function getRequestUnreadCount(actor: Actor, quoteRequestId: string, dependencies: Dependencies = {}): Promise<number> {
  if (!UUID_PATTERN.test(quoteRequestId)) return 0;
  const prisma = dependencies.prisma ?? getPrisma();
  return prisma.inboxNotification.count({ where: { AND: [inboxScopeWhere(actor), BADGE_WHERE, { quoteRequestId }] } });
}

/** Reanudación con `Last-Event-ID`: lo que cambió después del cursor, en orden de actualización. */
export async function listInboxUpdatedSince(actor: Actor, cursor: Readonly<{ at: Date; id: string }>, dependencies: Dependencies = {}): Promise<Readonly<{ items: InboxNotificationDto[]; more: boolean }>> {
  const prisma = dependencies.prisma ?? getPrisma();
  const rows = await prisma.inboxNotification.findMany({
    where: { AND: [inboxScopeWhere(actor), { OR: [{ updatedAt: { gt: cursor.at } }, { updatedAt: cursor.at, id: { gt: cursor.id } }] }] },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: RESUME_LIMIT + 1,
    select: DTO_SELECT,
  });
  return { items: rows.slice(0, RESUME_LIMIT).flatMap((row) => toDto(row) ?? []), more: rows.length > RESUME_LIMIT };
}
```

En `src/lib/inbox-client.ts`, en `InboxNotification`, después de `lastActivityAt: string;`, agrega `updatedAt: string;`.

En `tests/unit/inbox-client.test.ts`, en el `item` de la prueba, cambia `lastActivityAt: '2026-09-29T10:00:00', readAt: null,` por `lastActivityAt: '2026-09-29T10:00:00', updatedAt: '2026-09-29T10:00:00', readAt: null,`.

- [ ] **Step 3: Correr, typecheck y commit**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-realtime-queries.test.ts tests/integration/inbox-api.test.ts --maxWorkers=1 && npx vitest run tests/unit/inbox-client.test.ts && npx tsc --noEmit`
Expected: todo en PASS.

```bash
git add src/server/modules/inbox/service.ts src/lib/inbox-client.ts tests/unit/inbox-client.test.ts tests/integration/inbox-realtime-queries.test.ts
git commit -m "feat(realtime): consultas de la bandeja para el canal (aviso con alcance, sin leer por expediente y reanudación)"
```

---

### Task 4: Hub y conexión LISTEN

**Files:**
- Create: `src/server/realtime/hub.ts`, `src/server/realtime/listener.ts` y `src/server/realtime/runtime.ts`
- Test: `tests/unit/realtime-hub.test.ts` y `tests/unit/realtime-listener.test.ts`

**Interfaces:**
- Consumes (Tasks 1 y 3): `decodeRealtimeSignal`, `formatEventCursor`, `getInboxNotificationForActor`, `getInboxCounts` y `getRequestUnreadCount`.
- Produces:
  - `type ByeReason = 'session' | 'replaced'`, `type RealtimeCounts`, `type RealtimeNotificationPayload`, `type RealtimeServerEvent`, `type RealtimeConnection` y `type RealtimeHubDependencies`.
  - `class RealtimeHub { register(connection): () => void; dispatch(signal): Promise<void>; broadcastResync(): void; get size(): number }`.
  - `class RealtimeListener { start(): Promise<void>; stop(): Promise<void> }`.
  - `ensureRealtimeHub(): Promise<RealtimeHub>` y `shutdownRealtimeForTests(): Promise<void>`.

- [ ] **Step 1: Pruebas del hub**

Crear `tests/unit/realtime-hub.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import { RealtimeHub, type ByeReason, type RealtimeConnection, type RealtimeHubDependencies, type RealtimeServerEvent } from '@/server/realtime/hub';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '6b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const NOTICE = '7c3d4e5f-6071-4c8d-8e9f-1a2b3c4d5e6f';
const REQUEST = '8d4e5f60-7182-4d9e-9fa0-2b3c4d5e6f70';
const SESSION_A = '9e5f6071-8293-4eaf-a0b1-3c4d5e6f7081';
const SESSION_B = 'af607182-93a4-4fb0-b1c2-4d5e6f708192';

type FakeConnection = RealtimeConnection & { events: RealtimeServerEvent[]; closedWith: ByeReason | null };

const actorFor = (userId: string): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(), mfaVerified: true });

function connection(userId: string, sessionId: string, openedAt = 1): FakeConnection {
  const fake: FakeConnection = {
    userId,
    sessionId,
    openedAt,
    actor: actorFor(userId),
    events: [],
    closedWith: null,
    send(event) { fake.events.push(event); },
    close(reason) { fake.closedWith = reason; },
  };
  return fake;
}

const notice = (overrides: Partial<InboxNotificationDto> = {}): InboxNotificationDto => ({
  id: NOTICE, kind: 'customer.activity', priority: 'HIGH', title: 'Laura te escribió', body: null, actionPath: '/staff/requests', quoteRequestId: REQUEST, folio: 'OCQ-2026-000001', clientName: 'Laura',
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T20:00:00.000Z', lastActivityAt: '2026-09-29T20:00:00.000Z', updatedAt: '2026-09-29T20:00:00.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
  ...overrides,
});

function createHub(overrides: Partial<RealtimeHubDependencies> = {}) {
  const deps: RealtimeHubDependencies = {
    loadNotification: vi.fn(async () => notice()),
    loadCounts: vi.fn(async () => ({ unread: 3, actionRequired: 1 })),
    loadRequestUnread: vi.fn(async () => 2),
    maxConnectionsPerUser: () => 10,
    ...overrides,
  };
  return { hub: new RealtimeHub(deps), deps };
}

describe('realtime hub', () => {
  it('sends a notice with fresh counts only to its recipient', async () => {
    const { hub } = createHub();
    const mine = connection(USER, SESSION_A);
    const theirs = connection(OTHER, SESSION_B);
    hub.register(mine);
    hub.register(theirs);
    await hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'created' });
    expect(mine.events).toEqual([{ event: 'notification', id: `${Date.parse('2026-09-29T20:00:00.000Z')}-${NOTICE}`, data: { mode: 'created', notification: notice(), unread: 3, actionRequired: 1, requestUnread: 2 } }]);
    expect(theirs.events).toEqual([]);
  });

  it('drops a notice the person can no longer see', async () => {
    const { hub } = createHub({ loadNotification: vi.fn(async () => null) });
    const mine = connection(USER, SESSION_A);
    hub.register(mine);
    await hub.dispatch({ t: 'n', u: USER, id: NOTICE, m: 'updated' });
    expect(mine.events).toEqual([]);
  });

  it('sends the counts after a read elsewhere', async () => {
    const { hub } = createHub();
    const first = connection(USER, SESSION_A);
    const second = connection(USER, SESSION_B);
    hub.register(first);
    hub.register(second);
    await hub.dispatch({ t: 'u', u: USER });
    for (const each of [first, second]) expect(each.events).toEqual([{ event: 'counts', data: { unread: 3, actionRequired: 1 } }]);
  });

  it('closes one session, every other one, or all of them', async () => {
    const { hub } = createHub();
    const a = connection(USER, SESSION_A);
    const b = connection(USER, SESSION_B);
    hub.register(a);
    hub.register(b);
    await hub.dispatch({ t: 's', u: USER, sid: SESSION_B });
    expect([a.closedWith, b.closedWith]).toEqual([null, 'session']);
    const c = connection(USER, SESSION_B);
    hub.register(c);
    await hub.dispatch({ t: 's', u: USER, keep: SESSION_A });
    expect([a.closedWith, c.closedWith]).toEqual([null, 'session']);
    await hub.dispatch({ t: 's', u: USER });
    expect(a.closedWith).toBe('session');
    expect(hub.size).toBe(0);
  });

  it('keeps at most N connections per person, closing the oldest', () => {
    const { hub } = createHub({ maxConnectionsPerUser: () => 2 });
    const oldest = connection(USER, SESSION_A, 1);
    hub.register(oldest);
    hub.register(connection(USER, SESSION_A, 2));
    hub.register(connection(USER, SESSION_A, 3));
    expect(oldest.closedWith).toBe('replaced');
    expect(hub.size).toBe(2);
  });

  it('asks everyone to resync after a reconnection and forgets unregistered connections', async () => {
    const { hub } = createHub();
    const kept = connection(USER, SESSION_A);
    const gone = connection(OTHER, SESSION_B);
    hub.register(kept);
    const unregister = hub.register(gone);
    unregister();
    hub.broadcastResync();
    expect(kept.events).toEqual([{ event: 'resync', data: {} }]);
    expect(gone.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Prueba de la conexión LISTEN**

Crear `tests/unit/realtime-listener.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeListener } from '@/server/realtime/listener';
import type { RealtimeSignal } from '@/server/realtime/publish';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

class FakeClient extends EventEmitter {
  queries: string[] = [];
  ended = false;
  constructor(private readonly failConnect = false) { super(); }
  async connect(): Promise<void> { if (this.failConnect) throw new Error('down'); }
  async query(sql: string): Promise<void> { this.queries.push(sql); }
  async end(): Promise<void> { this.ended = true; }
}

describe('realtime listener', () => {
  afterEach(() => vi.useRealTimers());

  it('listens on the channel and forwards only valid signals', async () => {
    const client = new FakeClient();
    const signals: RealtimeSignal[] = [];
    const listener = new RealtimeListener({ createClient: () => client, onSignal: (signal) => signals.push(signal), onReconnected: () => undefined });
    await listener.start();
    expect(client.queries).toEqual(['LISTEN ocpool_realtime']);
    client.emit('notification', { channel: 'ocpool_realtime', payload: JSON.stringify({ t: 'u', u: USER }) });
    client.emit('notification', { channel: 'ocpool_realtime', payload: 'garbage' });
    expect(signals).toEqual([{ t: 'u', u: USER }]);
    await listener.stop();
    expect(client.ended).toBe(true);
  });

  it('reconnects with backoff when the connection drops and asks for a resync', async () => {
    vi.useFakeTimers();
    const clients = [new FakeClient(), new FakeClient(true), new FakeClient()];
    let index = 0;
    const onReconnected = vi.fn();
    const listener = new RealtimeListener({ createClient: () => clients[index++], onSignal: () => undefined, onReconnected });
    await listener.start();
    clients[0].emit('end');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(index).toBe(2);
    expect(onReconnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(index).toBe(3);
    expect(onReconnected).toHaveBeenCalledTimes(1);
    await listener.stop();
  });
});
```

Run: `npx vitest run tests/unit/realtime-hub.test.ts tests/unit/realtime-listener.test.ts`
Expected: FAIL (los módulos no existen).

- [ ] **Step 3: El hub**

Crear `src/server/realtime/hub.ts`:

```ts
import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import type { RealtimeSignal } from './publish';
import { formatEventCursor } from './sse';

export type ByeReason = 'session' | 'replaced';
export type RealtimeCounts = Readonly<{ unread: number; actionRequired: number }>;
export type RealtimeNotificationPayload = Readonly<{
  mode: 'created' | 'updated' | 'resolved';
  notification: InboxNotificationDto;
  unread: number;
  actionRequired: number;
  /** Sin leer del expediente del aviso, para "N nuevas" y la lectura al abrir (null si no tiene expediente). */
  requestUnread: number | null;
}>;

export type RealtimeServerEvent =
  | Readonly<{ event: 'notification'; id: string; data: RealtimeNotificationPayload }>
  | Readonly<{ event: 'counts'; data: RealtimeCounts }>
  | Readonly<{ event: 'resync'; data: Readonly<Record<string, never>> }>;

export type RealtimeConnection = {
  readonly userId: string;
  readonly sessionId: string;
  readonly openedAt: number;
  /** Se refresca al revalidar la sesión: un cambio de rol cambia el alcance. */
  actor: Actor;
  send(event: RealtimeServerEvent): void;
  close(reason: ByeReason): void;
};

export type RealtimeHubDependencies = Readonly<{
  loadNotification: (actor: Actor, id: string) => Promise<InboxNotificationDto | null>;
  loadCounts: (actor: Actor) => Promise<RealtimeCounts>;
  loadRequestUnread: (actor: Actor, quoteRequestId: string) => Promise<number>;
  maxConnectionsPerUser: () => number;
}>;

/** Registro de conexiones por persona y reparto de señales (spec §4.2). No guarda contenido: relee cada aviso una vez. */
export class RealtimeHub {
  private readonly byUser = new Map<string, Set<RealtimeConnection>>();

  constructor(private readonly deps: RealtimeHubDependencies) {}

  get size(): number {
    let total = 0;
    for (const connections of this.byUser.values()) total += connections.size;
    return total;
  }

  register(connection: RealtimeConnection): () => void {
    const connections = this.byUser.get(connection.userId) ?? new Set<RealtimeConnection>();
    connections.add(connection);
    this.byUser.set(connection.userId, connections);
    const limit = this.deps.maxConnectionsPerUser();
    while (connections.size > limit) {
      const oldest = [...connections].reduce((current, candidate) => (candidate.openedAt < current.openedAt ? candidate : current));
      this.unregister(oldest);
      oldest.close('replaced');
    }
    return () => this.unregister(connection);
  }

  async dispatch(signal: RealtimeSignal): Promise<void> {
    const targets = [...(this.byUser.get(signal.u) ?? [])];
    if (targets.length === 0) return;
    if (signal.t === 's') {
      for (const connection of targets) {
        const closes = signal.sid ? connection.sessionId === signal.sid : connection.sessionId !== signal.keep;
        if (!closes) continue;
        this.unregister(connection);
        connection.close('session');
      }
      return;
    }
    // Todas las conexiones de la misma persona comparten alcance: se consulta una sola vez.
    const actor = targets[0].actor;
    if (signal.t === 'u') {
      const counts = await this.deps.loadCounts(actor);
      for (const connection of targets) connection.send({ event: 'counts', data: counts });
      return;
    }
    const notification = await this.deps.loadNotification(actor, signal.id);
    if (!notification) return;
    const [counts, requestUnread] = await Promise.all([
      this.deps.loadCounts(actor),
      notification.quoteRequestId ? this.deps.loadRequestUnread(actor, notification.quoteRequestId) : Promise.resolve(null),
    ]);
    const event: RealtimeServerEvent = {
      event: 'notification',
      id: formatEventCursor(new Date(notification.updatedAt), notification.id),
      data: { mode: signal.m, notification, ...counts, requestUnread },
    };
    for (const connection of targets) connection.send(event);
  }

  /** Tras reconectar el LISTEN pudieron perderse señales: cada navegador relee contadores y vistas. */
  broadcastResync(): void {
    for (const connections of this.byUser.values()) for (const connection of connections) connection.send({ event: 'resync', data: {} });
  }

  private unregister(connection: RealtimeConnection): void {
    const connections = this.byUser.get(connection.userId);
    if (!connections) return;
    connections.delete(connection);
    if (connections.size === 0) this.byUser.delete(connection.userId);
  }
}
```

- [ ] **Step 4: La conexión LISTEN**

Crear `src/server/realtime/listener.ts`:

```ts
import { logger } from '@/server/logging/logger';
import { decodeRealtimeSignal, REALTIME_CHANNEL, type RealtimeSignal } from './publish';

type Notification = Readonly<{ channel: string; payload?: string }>;

export type ListenerClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: 'notification', listener: (message: Notification) => void): unknown;
  on(event: 'error' | 'end', listener: () => void): unknown;
  removeAllListeners(): unknown;
};

export type RealtimeListenerOptions = Readonly<{
  createClient: () => ListenerClient;
  onSignal: (signal: RealtimeSignal) => void;
  onReconnected: () => void;
}>;

const MAX_BACKOFF_MS = 30_000;

/**
 * Una conexión dedicada con `LISTEN`, fuera del pool de Prisma (spec §4.2). Si se cae, se reconecta con espera
 * exponencial (1 s, 2 s, 4 s… hasta 30 s) y avisa para que los navegadores se resincronicen. `start()` nunca
 * falla: si la base no responde, reintenta en segundo plano.
 */
export class RealtimeListener {
  private client: ListenerClient | null = null;
  private attempts = 0;
  private stopped = false;
  private everConnected = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lost = new WeakSet<ListenerClient>();

  constructor(private readonly options: RealtimeListenerOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    if (client) await this.discard(client);
  }

  private async connect(): Promise<void> {
    const client = this.options.createClient();
    client.on('notification', (message) => {
      const signal = message.payload ? decodeRealtimeSignal(message.payload) : null;
      if (signal) this.options.onSignal(signal);
    });
    client.on('error', () => this.handleLoss(client));
    client.on('end', () => this.handleLoss(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch {
      this.handleLoss(client);
      return;
    }
    if (this.stopped) {
      await this.discard(client);
      return;
    }
    this.client = client;
    this.attempts = 0;
    logger.info({ reconnect: this.everConnected }, 'Realtime listener connected');
    if (this.everConnected) this.options.onReconnected();
    this.everConnected = true;
  }

  private handleLoss(client: ListenerClient): void {
    if (this.lost.has(client)) return;
    void this.discard(client);
    if (this.client === client) this.client = null;
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** this.attempts);
    this.attempts += 1;
    logger.warn({ delayMs: delay }, 'Realtime listener lost; reconnecting');
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) void this.connect();
    }, delay);
  }

  private async discard(client: ListenerClient): Promise<void> {
    this.lost.add(client);
    client.removeAllListeners();
    // Un cliente de pg sin escucha de 'error' tumba el proceso si falla al cerrarse.
    client.on('error', () => undefined);
    await client.end().catch(() => undefined);
  }
}
```

- [ ] **Step 5: El singleton**

Crear `src/server/realtime/runtime.ts`:

```ts
import pg from 'pg';
import { readServerEnv } from '@/server/env';
import { logger } from '@/server/logging/logger';
import { getInboxCounts, getInboxNotificationForActor, getRequestUnreadCount } from '@/server/modules/inbox/service';
import { RealtimeHub } from './hub';
import { RealtimeListener } from './listener';

type RealtimeRuntime = { hub: RealtimeHub; listener: RealtimeListener; ready: Promise<void> | null };

// En `globalThis` para sobrevivir a HMR en desarrollo: una sola conexión LISTEN por proceso (spec §4.2).
const globalForRealtime = globalThis as typeof globalThis & { __ocpoolRealtime?: RealtimeRuntime };

function createRuntime(): RealtimeRuntime {
  const hub = new RealtimeHub({
    loadNotification: (actor, id) => getInboxNotificationForActor(actor, id),
    loadCounts: (actor) => getInboxCounts(actor),
    loadRequestUnread: (actor, quoteRequestId) => getRequestUnreadCount(actor, quoteRequestId),
    maxConnectionsPerUser: () => readServerEnv().REALTIME_MAX_CONNECTIONS_PER_USER,
  });
  const listener = new RealtimeListener({
    createClient: () => new pg.Client({ connectionString: readServerEnv().DATABASE_URL }),
    onSignal: (signal) => {
      // Los logs del hub no llevan identificadores de personas (spec §11).
      void hub.dispatch(signal).catch((error: unknown) => logger.error({ signal: signal.t, error: error instanceof Error ? error.message : String(error) }, 'Realtime dispatch failed'));
    },
    onReconnected: () => hub.broadcastResync(),
  });
  return { hub, listener, ready: null };
}

function runtime(): RealtimeRuntime {
  globalForRealtime.__ocpoolRealtime ??= createRuntime();
  return globalForRealtime.__ocpoolRealtime;
}

/** Arranca el LISTEN con la primera conexión SSE y devuelve el hub. */
export async function ensureRealtimeHub(): Promise<RealtimeHub> {
  const state = runtime();
  state.ready ??= state.listener.start();
  await state.ready;
  return state.hub;
}

/** Sólo para pruebas: cierra el LISTEN y olvida el singleton. */
export async function shutdownRealtimeForTests(): Promise<void> {
  const state = globalForRealtime.__ocpoolRealtime;
  if (!state) return;
  delete globalForRealtime.__ocpoolRealtime;
  await state.listener.stop();
}
```

- [ ] **Step 6: Correr, typecheck y commit**

Run: `npx vitest run tests/unit/realtime-hub.test.ts tests/unit/realtime-listener.test.ts && npx tsc --noEmit`
Expected: PASS (6 + 2 tests) y sin errores.

```bash
git add src/server/realtime/hub.ts src/server/realtime/listener.ts src/server/realtime/runtime.ts tests/unit/realtime-hub.test.ts tests/unit/realtime-listener.test.ts
git commit -m "feat(realtime): hub de conexiones con LISTEN dedicado, reconexión exponencial y cierre por sesión"
```

---

### Task 5: Endpoint `GET /api/realtime`

**Files:**
- Create: `src/server/realtime/stream.ts` y `src/app/api/realtime/route.ts`
- Test: `tests/unit/realtime-stream.test.ts` y `tests/integration/realtime-api.test.ts`

**Interfaces:**
- Consumes (Tasks 1, 3 y 4): `SSE_HEADERS`, `encodeSseEvent`, `encodeSseRetry`, `SSE_RETRY_MS`, `formatEventCursor`, `parseEventCursor`, `RealtimeHub`, `ensureRealtimeHub`, `getInboxCounts`, `listInboxUpdatedSince` y `requireInboxAccess`.
- Produces:
  - `createRealtimeStream(options: RealtimeStreamOptions): ReadableStream<Uint8Array>`.
  - `GET /api/realtime`: 401 sin sesión, 403 sin acceso a la bandeja, 503 `{ mode: 'polling' }` con el interruptor apagado y 200 con el flujo SSE.

- [ ] **Step 1: Prueba unitaria del flujo**

Crear `tests/unit/realtime-stream.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/types';
import type { RealtimeConnection } from '@/server/realtime/hub';
import { createRealtimeStream } from '@/server/realtime/stream';

const USER = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SESSION = '9e5f6071-8293-4eaf-a0b1-3c4d5e6f7081';
const actor: Actor = { userId: USER, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(), mfaVerified: true };

async function readText(stream: ReadableStream<Uint8Array>, until: string): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(until)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  reader.releaseLock();
  return text;
}

describe('realtime stream', () => {
  afterEach(() => vi.useRealTimers());

  it('opens with retry and hello, pings, and says bye when the session stops being valid', async () => {
    vi.useFakeTimers();
    const registered: RealtimeConnection[] = [];
    const unregister = vi.fn();
    let valid = true;
    const stream = createRealtimeStream({
      hub: { register: (connection) => { registered.push(connection); return unregister; } },
      session: { sessionId: SESSION, actor },
      signal: new AbortController().signal,
      lastEventId: null,
      heartbeatMs: 1_000,
      recheckMs: 5_000,
      counts: async () => ({ unread: 4, actionRequired: 2 }),
      revalidate: async () => (valid ? actor : null),
      resume: async () => ({ items: [], more: false }),
      now: () => new Date('2026-09-29T20:00:00.000Z'),
    });
    expect(await readText(stream, 'event: hello')).toBe('retry: 5000\n\nevent: hello\ndata: {"unread":4,"actionRequired":2,"serverTime":"2026-09-29T20:00:00.000Z"}\n\n');
    expect(registered).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await readText(stream, 'event: ping')).toContain('event: ping');
    valid = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await readText(stream, 'event: bye')).toContain('data: {"reason":"session"}');
    expect(unregister).toHaveBeenCalled();
  });

  it('cleans up when the browser goes away', async () => {
    const unregister = vi.fn();
    const abort = new AbortController();
    const stream = createRealtimeStream({
      hub: { register: () => unregister },
      session: { sessionId: SESSION, actor },
      signal: abort.signal,
      lastEventId: null,
      heartbeatMs: 25_000,
      recheckMs: 60_000,
      counts: async () => ({ unread: 0, actionRequired: 0 }),
      revalidate: async () => actor,
      resume: async () => ({ items: [], more: false }),
    });
    await readText(stream, 'event: hello');
    abort.abort();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Prueba de integración del endpoint**

Crear `tests/integration/realtime-api.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { GET as realtimeGet } from '@/app/api/realtime/route';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { recordInboxIntents } from '@/server/modules/inbox/record';
import { markInboxRead } from '@/server/modules/inbox/service';
import { publishSessionsClosed } from '@/server/realtime/publish';
import { shutdownRealtimeForTests } from '@/server/realtime/runtime';

type SseEvent = { event: string; id?: string; data: Record<string, unknown> };

function sseReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const queue: SseEvent[] = [];
  let buffer = '';
  let ended = false;
  let pending: Promise<void> | null = null;
  const pump = () => (pending ??= reader.read().then((chunk) => {
    pending = null;
    if (chunk.done) { ended = true; return; }
    buffer += decoder.decode(chunk.value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event: Partial<SseEvent> = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event.event = line.slice(7);
        else if (line.startsWith('id: ')) event.id = line.slice(4);
        else if (line.startsWith('data: ')) event.data = JSON.parse(line.slice(6)) as Record<string, unknown>;
      }
      if (event.event) queue.push(event as SseEvent);
      index = buffer.indexOf('\n\n');
    }
  }));
  return {
    async next(name: string, timeoutMs = 5000): Promise<SseEvent> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = queue.findIndex((event) => event.event === name);
        if (index >= 0) return queue.splice(index, 1)[0];
        if (ended) throw new Error(`The stream ended before "${name}".`);
        if (Date.now() > deadline) throw new Error(`Timed out waiting for "${name}".`);
        await Promise.race([pump(), new Promise((resolve) => setTimeout(resolve, 100))]);
      }
    },
    async ended(timeoutMs = 3000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (!ended && Date.now() < deadline) await Promise.race([pump(), new Promise((resolve) => setTimeout(resolve, 100))]);
      return ended;
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

describe('realtime API', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const appUrl = readServerEnv().APP_URL;
  const aborts: AbortController[] = [];
  let userId = '';
  let token = '';
  let sessionId = '';
  let actor: Actor;

  const open = (headers: Record<string, string> = {}) => {
    const abort = new AbortController();
    aborts.push(abort);
    return realtimeGet(new NextRequest(`${appUrl}/api/realtime`, { headers: { cookie: `ocpool_session=${token}`, ...headers }, signal: abort.signal }));
  };
  const notice = (fromName: string) => prisma.$transaction((tx) => recordInboxIntents(tx, [{ recipientId: userId, kind: 'team.work_reassigned', priority: 'HIGH', quoteRequestId: null, actorId: null, groupKey: null, actionPath: '/staff/requests', actionRequired: false, data: { fromName, requestsCount: 1 } }], new Date()));

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    userId = (await prisma.user.create({ data: { email: `rt-api-${suffix}@example.test`, emailNormalized: `rt-api-${suffix}@example.test`, displayName: 'RT Api', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    actor = { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read']), mfaVerified: true };
    token = `rt-api-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    ({ sessionId } = await createSession({ userId, ipAddress: null, userAgent: 'realtime-api' }, { prisma, tokenGenerator: () => token }));
  });

  afterAll(async () => {
    for (const abort of aborts) abort.abort();
    await shutdownRealtimeForTests();
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rejects anonymous connections and honours the kill switch', async () => {
    expect((await realtimeGet(new NextRequest(`${appUrl}/api/realtime`))).status).toBe(401);
    const previous = process.env.REALTIME_ENABLED;
    process.env.REALTIME_ENABLED = 'false';
    try {
      const response = await open();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ mode: 'polling' });
    } finally {
      if (previous === undefined) delete process.env.REALTIME_ENABLED;
      else process.env.REALTIME_ENABLED = previous;
    }
  });

  it('streams hello, then each notice and the counts as soon as they commit', async () => {
    const response = await open();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    const events = sseReader(response);
    expect((await events.next('hello')).data).toMatchObject({ unread: 0, actionRequired: 0 });
    const [recorded] = await notice(`Carlos ${suffix}`);
    const arrived = await events.next('notification');
    expect(arrived.id).toMatch(new RegExp(`^\\d+-${recorded.id}$`));
    expect(arrived.data).toMatchObject({ mode: 'created', unread: 1, actionRequired: 0, requestUnread: null, notification: { id: recorded.id, title: expect.stringContaining(`Carlos ${suffix}`) } });
    await markInboxRead(actor, { all: true }, { prisma });
    expect((await events.next('counts')).data).toEqual({ unread: 0, actionRequired: 0 });
    await events.cancel();
  });

  it('replays what changed while disconnected after Last-Event-ID', async () => {
    const [before] = await notice(`Antes ${suffix}`);
    const row = await prisma.inboxNotification.findUniqueOrThrow({ where: { id: before.id } });
    const [missed] = await notice(`Mientras ${suffix}`);
    const events = sseReader(await open({ 'last-event-id': `${row.updatedAt.getTime()}-${row.id}` }));
    await events.next('hello');
    expect((await events.next('notification')).data).toMatchObject({ mode: 'updated', notification: { id: missed.id } });
    await events.cancel();
  });

  it('says bye and ends the stream when the session is revoked', async () => {
    const events = sseReader(await open());
    await events.next('hello');
    await publishSessionsClosed(prisma, { userId, sessionId });
    expect((await events.next('bye')).data).toEqual({ reason: 'session' });
    expect(await events.ended()).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/realtime-stream.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/realtime-api.test.ts`
Expected: FAIL (los módulos no existen).

- [ ] **Step 3: El flujo de una conexión**

Crear `src/server/realtime/stream.ts`:

```ts
import type { Actor } from '@/server/auth/types';
import type { InboxNotificationDto } from '@/server/modules/inbox/service';
import type { ByeReason, RealtimeConnection, RealtimeCounts, RealtimeHub, RealtimeServerEvent } from './hub';
import { encodeSseEvent, encodeSseRetry, formatEventCursor, parseEventCursor, SSE_RETRY_MS } from './sse';

/** Si el navegador deja de leer y se acumulan más eventos que esto, se cierra la conexión (spec §4.3, presión). */
const QUEUE_LIMIT = 64;

export type RealtimeStreamOptions = Readonly<{
  hub: Pick<RealtimeHub, 'register'>;
  session: Readonly<{ sessionId: string; actor: Actor }>;
  signal: AbortSignal;
  lastEventId: string | null;
  heartbeatMs: number;
  recheckMs: number;
  counts: () => Promise<RealtimeCounts>;
  revalidate: () => Promise<Actor | null>;
  resume: (cursor: Readonly<{ at: Date; id: string }>) => Promise<Readonly<{ items: InboxNotificationDto[]; more: boolean }>>;
  now?: () => Date;
}>;

/**
 * Una conexión SSE (spec §4.3): `retry`, `hello` con los contadores, reanudación con `Last-Event-ID`, `ping` para
 * que el navegador sepa que sigue viva, revalidación periódica de la sesión y limpieza al cerrar.
 */
export function createRealtimeStream(options: RealtimeStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const now = options.now ?? (() => new Date());
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let cleanup: () => void = () => undefined;

  const finish = () => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controllerRef?.close();
    } catch {
      // El navegador ya cerró el flujo.
    }
  };

  const write = (chunk: string) => {
    if (closed || !controllerRef) return;
    if (controllerRef.desiredSize !== null && controllerRef.desiredSize <= 0) {
      finish();
      return;
    }
    controllerRef.enqueue(encoder.encode(chunk));
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const connection: RealtimeConnection = {
        userId: options.session.actor.userId,
        sessionId: options.session.sessionId,
        openedAt: Date.now(),
        actor: options.session.actor,
        send: (event: RealtimeServerEvent) => write(encodeSseEvent(event.event, event.data, event.event === 'notification' ? event.id : undefined)),
        close: (reason: ByeReason) => {
          write(encodeSseEvent('bye', { reason }));
          finish();
        },
      };
      write(encodeSseRetry(SSE_RETRY_MS));
      const counts = await options.counts();
      write(encodeSseEvent('hello', { ...counts, serverTime: now().toISOString() }));
      const unregister = options.hub.register(connection);
      const heartbeat = setInterval(() => write(encodeSseEvent('ping', { at: now().toISOString() })), options.heartbeatMs);
      const recheck = setInterval(() => {
        void options.revalidate().catch(() => null).then((actor) => {
          if (actor) connection.actor = actor;
          else connection.close('session');
        });
      }, options.recheckMs);
      const onAbort = () => finish();
      options.signal.addEventListener('abort', onAbort, { once: true });
      cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(recheck);
        unregister();
        options.signal.removeEventListener('abort', onAbort);
      };
      if (options.signal.aborted) {
        finish();
        return;
      }
      const cursor = parseEventCursor(options.lastEventId);
      if (!cursor) return;
      const page = await options.resume(cursor);
      for (const notification of page.items) {
        connection.send({ event: 'notification', id: formatEventCursor(new Date(notification.updatedAt), notification.id), data: { mode: 'updated', notification, ...counts, requestUnread: null } });
      }
      if (page.more) connection.send({ event: 'resync', data: {} });
    },
    cancel() {
      finish();
    },
  }, new CountQueuingStrategy({ highWaterMark: QUEUE_LIMIT }));
}
```

- [ ] **Step 4: La ruta**

Crear `src/app/api/realtime/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requestId, sessionToken } from '@/server/auth/http';
import { getSessionContext } from '@/server/auth/sessions';
import { readServerEnv } from '@/server/env';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { getInboxCounts, listInboxUpdatedSince, requireInboxAccess } from '@/server/modules/inbox/service';
import { ensureRealtimeHub } from '@/server/realtime/runtime';
import { SSE_HEADERS } from '@/server/realtime/sse';
import { createRealtimeStream } from '@/server/realtime/stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const env = readServerEnv();
    // Interruptor sin despliegue (spec §12): todos quedan en consulta cada 30 s.
    if (!env.REALTIME_ENABLED) return NextResponse.json({ mode: 'polling' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    const token = sessionToken(request);
    const session = token ? await getSessionContext(token) : null;
    if (!token || !session) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
    requireInboxAccess(session.actor);
    const hub = await ensureRealtimeHub();
    const stream = createRealtimeStream({
      hub,
      session,
      signal: request.signal,
      lastEventId: request.headers.get('last-event-id'),
      heartbeatMs: env.REALTIME_HEARTBEAT_SECONDS * 1000,
      recheckMs: env.REALTIME_SESSION_RECHECK_SECONDS * 1000,
      counts: () => getInboxCounts(session.actor),
      revalidate: async () => (await getSessionContext(token))?.actor ?? null,
      resume: (cursor) => listInboxUpdatedSince(session.actor, cursor),
    });
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
```

- [ ] **Step 5: Correr, typecheck, lint y commit**

Run: `npx vitest run tests/unit/realtime-stream.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/realtime-api.test.ts --maxWorkers=1 && npx tsc --noEmit && npx eslint src/app/api/realtime tests/integration/realtime-api.test.ts tests/unit/realtime-stream.test.ts`
Expected: PASS (2 + 4 tests) y sin errores.

```bash
git add src/server/realtime/stream.ts src/app/api/realtime tests/unit/realtime-stream.test.ts tests/integration/realtime-api.test.ts
git commit -m "feat(realtime): canal SSE /api/realtime con hello, ping, reanudación, revalidación y cierre por sesión"
```

---

### Task 6: Cliente: eventos, reductor, pestaña líder y conexión con respaldo

**Files:**
- Create: `src/lib/realtime-client.ts`
- Test: `tests/unit/realtime-client.test.ts`

**Interfaces:**
- Consumes: `InboxNotification` e `InboxSummary` de `src/lib/inbox-client.ts`.
- Produces:
  - `type RealtimeNotificationEvent`, `type RealtimeEvent`, `type RealtimeMode`, `type EventSourceLike`, `type RealtimeTimers` y `type LockManagerLike`.
  - `REALTIME_URL`, `REALTIME_EVENT_TYPES`, `LATEST_LIMIT`, `REALTIME_MAX_ERRORS`, `REALTIME_SILENCE_MS` y `REALTIME_RETRY_MS`.
  - `parseRealtimeEvent(type, raw)`, `applyNotificationEvent(summary, event)`, `shouldFlash(event, activeRequestId)`, `electLeader(locks, lead)`, `holdVisibleLock(locks, tabId)`, `anyTabVisible(locks, selfVisible)` y `class RealtimeController`.

- [ ] **Step 1: Escribir la prueba**

Crear `tests/unit/realtime-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InboxNotification, InboxSummary } from '@/lib/inbox-client';
import { applyNotificationEvent, electLeader, parseRealtimeEvent, RealtimeController, shouldFlash, type EventSourceLike, type LockManagerLike, type RealtimeEvent, type RealtimeMode, type RealtimeNotificationEvent } from '@/lib/realtime-client';

const REQUEST = '8d4e5f60-7182-4d9e-9fa0-2b3c4d5e6f70';

const notice = (overrides: Partial<InboxNotification> = {}): InboxNotification => ({
  id: 'n1', kind: 'customer.activity', priority: 'HIGH', title: 'Laura te escribió', body: null, actionPath: '/staff/requests', quoteRequestId: REQUEST, folio: 'OCQ-1', clientName: 'Laura',
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T10:00:00.000Z', lastActivityAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
  ...overrides,
});
const event = (overrides: Partial<RealtimeNotificationEvent> = {}): RealtimeNotificationEvent => ({ type: 'notification', mode: 'created', notification: notice(), unread: 5, actionRequired: 1, requestUnread: 2, ...overrides });

class FakeSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void { this.listeners.set(type, listener); }
  close(): void { this.closed = true; this.readyState = 2; }
  emit(type: string, data: unknown): void { this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>); }
  fail(closedByServer = false): void { if (closedByServer) this.readyState = 2; this.onerror?.(new Event('error')); }
}

function fakeTimers() {
  let now = 0;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    timers: { set: (callback: () => void, ms: number) => { sequence += 1; pending.set(sequence, { at: now + ms, callback }); return sequence; }, clear: (handle: unknown) => { pending.delete(handle as number); } },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now || !pending.has(id)) continue;
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

function controller() {
  const sources: FakeSource[] = [];
  const events: RealtimeEvent[] = [];
  const modes: RealtimeMode[] = [];
  const clock = fakeTimers();
  const instance = new RealtimeController({ open: () => { const source = new FakeSource(); sources.push(source); return source; }, onEvent: (received) => events.push(received), onMode: (mode) => modes.push(mode), timers: clock.timers });
  return { instance, sources, events, modes, clock };
}

describe('realtime client', () => {
  it('parses only well-formed events', () => {
    expect(parseRealtimeEvent('hello', '{"unread":2,"actionRequired":1,"serverTime":"x"}')).toEqual({ type: 'hello', unread: 2, actionRequired: 1 });
    expect(parseRealtimeEvent('notification', JSON.stringify({ mode: 'created', notification: notice(), unread: 1, actionRequired: 0, requestUnread: null }))).toMatchObject({ type: 'notification', requestUnread: null });
    expect(parseRealtimeEvent('notification', JSON.stringify({ mode: 'created', notification: { id: 'x' }, unread: 1, actionRequired: 0 }))).toBeNull();
    expect(parseRealtimeEvent('bye', '{"reason":"session"}')).toEqual({ type: 'bye', reason: 'session' });
    expect(parseRealtimeEvent('ping', '{"at":"x"}')).toBeNull();
    expect(parseRealtimeEvent('counts', 'not json')).toBeNull();
  });

  it('upserts a notice without duplicates and keeps the per-file count', () => {
    const summary: InboxSummary = { unread: 1, actionRequired: 0, latest: [notice({ id: 'old', lastActivityAt: '2026-09-29T09:00:00.000Z' }), notice({ id: 'n1', title: 'Antes' })], unreadByRequest: { [REQUEST]: 1 } };
    const next = applyNotificationEvent(summary, event({ notification: notice({ title: 'Después', lastActivityAt: '2026-09-29T11:00:00.000Z' }) }));
    expect(next.latest.map((item) => [item.id, item.title])).toEqual([['n1', 'Después'], ['old', 'Laura te escribió']]);
    expect(next).toMatchObject({ unread: 5, actionRequired: 1, unreadByRequest: { [REQUEST]: 2 } });
    expect(applyNotificationEvent(next, event({ requestUnread: 0 })).unreadByRequest).toEqual({});
  });

  it('flashes only what deserves it', () => {
    expect(shouldFlash(event(), null)).toBe(true);
    expect(shouldFlash(event({ mode: 'resolved' }), null)).toBe(false);
    expect(shouldFlash(event({ notification: notice({ priority: 'NORMAL' }) }), null)).toBe(false);
    // La actividad del expediente abierto no destella, salvo lo urgente.
    expect(shouldFlash(event(), REQUEST)).toBe(false);
    expect(shouldFlash(event({ notification: notice({ kind: 'quote.changes_requested', priority: 'URGENT' }) }), REQUEST)).toBe(true);
  });

  it('elects a single leader and hands over when it leaves', async () => {
    let held = false;
    const queue: Array<{ callback: () => Promise<void>; resolve: () => void; signal?: AbortSignal }> = [];
    const grant = () => {
      if (held) return;
      const next = queue.shift();
      if (!next) return;
      held = true;
      void next.callback().then(() => { held = false; next.resolve(); grant(); });
    };
    const locks: LockManagerLike = {
      request: (_name, options, callback) => new Promise<void>((resolve, reject) => {
        const entry = { callback, resolve, signal: options.signal };
        options.signal?.addEventListener('abort', () => { const index = queue.indexOf(entry); if (index >= 0) { queue.splice(index, 1); reject(new DOMException('Aborted', 'AbortError')); } });
        queue.push(entry);
        grant();
      }),
    };
    const leaders: string[] = [];
    const stopFirst = electLeader(locks, () => { leaders.push('first'); return () => leaders.push('first stops'); });
    electLeader(locks, () => { leaders.push('second'); return () => undefined; });
    await Promise.resolve();
    expect(leaders).toEqual(['first']);
    stopFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(leaders).toEqual(['first', 'first stops', 'second']);
  });

  it('goes live on the first event and forwards it', () => {
    const { instance, sources, events, modes } = controller();
    instance.start();
    sources[0].emit('hello', { unread: 1, actionRequired: 0 });
    expect(modes).toEqual(['connecting', 'live']);
    expect(events).toEqual([{ type: 'hello', unread: 1, actionRequired: 0 }]);
  });

  it('falls back to polling after three errors or a server close, and retries in five minutes', () => {
    const { instance, sources, modes, clock } = controller();
    instance.start();
    sources[0].fail();
    sources[0].fail();
    expect(modes.at(-1)).toBe('connecting');
    sources[0].fail();
    expect(modes.at(-1)).toBe('polling');
    clock.advance(5 * 60_000);
    expect(sources).toHaveLength(2);
    sources[1].fail(true);
    expect(modes.at(-1)).toBe('polling');
  });

  it('falls back after sixty seconds of silence and stops for good on bye', () => {
    const { instance, sources, modes, clock } = controller();
    instance.start();
    clock.advance(60_000);
    expect(modes.at(-1)).toBe('polling');
    clock.advance(5 * 60_000);
    sources[1].emit('bye', { reason: 'session' });
    expect(modes.at(-1)).toBe('closed');
    clock.advance(10 * 60_000);
    expect(sources).toHaveLength(2);
  });
});
```

Run: `npx vitest run tests/unit/realtime-client.test.ts`
Expected: FAIL (el módulo no existe).

- [ ] **Step 2: Implementar el cliente**

Crear `src/lib/realtime-client.ts`:

```ts
import type { InboxNotification, InboxSummary } from '@/lib/inbox-client';

export type RealtimeNotificationEvent = Readonly<{
  type: 'notification';
  mode: 'created' | 'updated' | 'resolved';
  notification: InboxNotification;
  unread: number;
  actionRequired: number;
  /** Sin leer del expediente del aviso; null si no tiene expediente o no se sabe. */
  requestUnread: number | null;
}>;

export type RealtimeEvent =
  | Readonly<{ type: 'hello'; unread: number; actionRequired: number }>
  | RealtimeNotificationEvent
  | Readonly<{ type: 'counts'; unread: number; actionRequired: number }>
  | Readonly<{ type: 'resync' }>
  | Readonly<{ type: 'bye'; reason: string }>;

export type RealtimeMode = 'connecting' | 'live' | 'polling' | 'closed';

export const REALTIME_URL = '/api/realtime';
export const REALTIME_EVENT_TYPES = ['hello', 'notification', 'counts', 'resync', 'bye', 'ping'] as const;
export const LATEST_LIMIT = 20;
export const REALTIME_MAX_ERRORS = 3;
export const REALTIME_SILENCE_MS = 60_000;
export const REALTIME_RETRY_MS = 5 * 60_000;

const PRIORITIES: ReadonlySet<string> = new Set(['URGENT', 'HIGH', 'NORMAL', 'INFO']);
const MODES: ReadonlySet<string> = new Set(['created', 'updated', 'resolved']);
const ACTIVITY_KINDS: ReadonlySet<string> = new Set(['customer.activity', 'team.activity']);
const EVENT_SOURCE_CLOSED = 2;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isNotification(value: unknown): value is InboxNotification {
  const item = asRecord(value);
  return Boolean(item
    && typeof item.id === 'string'
    && typeof item.kind === 'string'
    && typeof item.title === 'string'
    && typeof item.actionPath === 'string' && item.actionPath.startsWith('/')
    && typeof item.priority === 'string' && PRIORITIES.has(item.priority)
    && typeof item.lastActivityAt === 'string');
}

/** Un evento SSE ya validado; lo desconocido o mal formado se descarta (el `ping` sólo mantiene viva la conexión). */
export function parseRealtimeEvent(type: string, raw: string): RealtimeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = asRecord(parsed);
  if (!data) return null;
  const unread = asCount(data.unread);
  const actionRequired = asCount(data.actionRequired);
  switch (type) {
    case 'hello':
      return unread !== null && actionRequired !== null ? { type: 'hello', unread, actionRequired } : null;
    case 'counts':
      return unread !== null && actionRequired !== null ? { type: 'counts', unread, actionRequired } : null;
    case 'notification':
      if (unread === null || actionRequired === null || !isNotification(data.notification) || typeof data.mode !== 'string' || !MODES.has(data.mode)) return null;
      return { type: 'notification', mode: data.mode as RealtimeNotificationEvent['mode'], notification: data.notification, unread, actionRequired, requestUnread: asCount(data.requestUnread) };
    case 'resync':
      return { type: 'resync' };
    case 'bye':
      return { type: 'bye', reason: typeof data.reason === 'string' ? data.reason : 'closed' };
    default:
      return null;
  }
}

function byActivityDesc(a: InboxNotification, b: InboxNotification): number {
  return b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id);
}

/** Un aviso nuevo, agrupado o resuelto entra al resumen sin duplicarse, con los contadores del servidor. */
export function applyNotificationEvent(summary: InboxSummary, event: RealtimeNotificationEvent): InboxSummary {
  const latest = [event.notification, ...summary.latest.filter((item) => item.id !== event.notification.id)].sort(byActivityDesc).slice(0, LATEST_LIMIT);
  const unreadByRequest = { ...summary.unreadByRequest };
  const requestId = event.notification.quoteRequestId;
  if (requestId && event.requestUnread !== null) {
    if (event.requestUnread > 0) unreadByRequest[requestId] = event.requestUnread;
    else delete unreadByRequest[requestId];
  }
  return { unread: event.unread, actionRequired: event.actionRequired, latest, unreadByRequest };
}

/** Spec §5.3: sólo URGENT y HIGH destellan; la actividad del expediente que ya está abierto no, salvo lo urgente. */
export function shouldFlash(event: RealtimeNotificationEvent, activeRequestId: string | null): boolean {
  const notice = event.notification;
  if (event.mode === 'resolved' || notice.readAt || notice.resolvedAt) return false;
  if (notice.priority !== 'URGENT' && notice.priority !== 'HIGH') return false;
  if (notice.priority === 'HIGH' && notice.quoteRequestId !== null && notice.quoteRequestId === activeRequestId && ACTIVITY_KINDS.has(notice.kind)) return false;
  return true;
}

export type LockManagerLike = Readonly<{
  request(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
  query?(): Promise<{ held?: ReadonlyArray<{ name?: string }> }>;
}>;

const LEADER_LOCK = 'ocpool-realtime';
const VISIBLE_LOCK_PREFIX = 'ocpool-visible:';

/**
 * Una conexión por navegador (spec §4.4): la pestaña que obtiene el candado abre la conexión y la suelta al
 * cerrarse; otra pestaña lo toma. Sin Web Locks, cada pestaña es su propia líder.
 */
export function electLeader(locks: LockManagerLike | undefined, lead: () => () => void): () => void {
  if (!locks) return lead();
  const abort = new AbortController();
  let release: (() => void) | null = null;
  let stopLeading: (() => void) | null = null;
  locks.request(LEADER_LOCK, { mode: 'exclusive', signal: abort.signal }, () => new Promise<void>((resolve) => {
    stopLeading = lead();
    release = resolve;
  })).catch(() => undefined);
  return () => {
    abort.abort();
    stopLeading?.();
    release?.();
  };
}

/** Mientras la pestaña está a la vista sostiene un candado propio: así la líder sabe si alguien está mirando. */
export function holdVisibleLock(locks: LockManagerLike | undefined, tabId: string): () => void {
  if (!locks) return () => undefined;
  const abort = new AbortController();
  let release: (() => void) | null = null;
  locks.request(`${VISIBLE_LOCK_PREFIX}${tabId}`, { mode: 'exclusive', signal: abort.signal }, () => new Promise<void>((resolve) => { release = resolve; })).catch(() => undefined);
  return () => {
    abort.abort();
    release?.();
  };
}

export async function anyTabVisible(locks: LockManagerLike | undefined, selfVisible: boolean): Promise<boolean> {
  if (selfVisible) return true;
  if (!locks?.query) return false;
  try {
    const state = await locks.query();
    return (state.held ?? []).some((lock) => lock.name?.startsWith(VISIBLE_LOCK_PREFIX) ?? false);
  } catch {
    return false;
  }
}

export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};

export type RealtimeTimers = Readonly<{ set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void }>;

const browserTimers: RealtimeTimers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/**
 * Conexión en vivo con respaldo (spec §4.4): tres errores seguidos, 60 s sin ningún evento o un cierre del
 * servidor (503 con el interruptor apagado, 401) pasan a consulta cada 30 s, y cada 5 min se reintenta.
 * `bye` cierra sin reintentar.
 */
export class RealtimeController {
  private source: EventSourceLike | null = null;
  private errors = 0;
  private mode: RealtimeMode = 'closed';
  private silence: unknown = null;
  private retry: unknown = null;
  private stopped = true;

  constructor(private readonly options: Readonly<{
    url?: string;
    open: (url: string) => EventSourceLike;
    onEvent: (event: RealtimeEvent) => void;
    onMode: (mode: RealtimeMode) => void;
    timers?: RealtimeTimers;
  }>) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.setMode('closed');
  }

  private get timers(): RealtimeTimers {
    return this.options.timers ?? browserTimers;
  }

  private connect(): void {
    this.teardown();
    this.errors = 0;
    this.setMode('connecting');
    const source = this.options.open(this.options.url ?? REALTIME_URL);
    this.source = source;
    source.onopen = () => {
      if (this.source === source) this.errors = 0;
    };
    source.onerror = () => {
      if (this.source !== source) return;
      this.errors += 1;
      if (source.readyState === EVENT_SOURCE_CLOSED || this.errors >= REALTIME_MAX_ERRORS) this.fallBack();
    };
    for (const type of REALTIME_EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        if (this.source === source) this.receive(type, message.data);
      });
    }
    this.watchSilence();
  }

  private receive(type: string, raw: string): void {
    this.errors = 0;
    this.watchSilence();
    if (this.mode !== 'live') this.setMode('live');
    const event = parseRealtimeEvent(type, raw);
    if (!event) return;
    if (event.type === 'bye') {
      this.stopped = true;
      this.teardown();
      this.setMode('closed');
    }
    this.options.onEvent(event);
  }

  private watchSilence(): void {
    if (this.silence !== null) this.timers.clear(this.silence);
    this.silence = this.timers.set(() => {
      this.silence = null;
      this.fallBack();
    }, REALTIME_SILENCE_MS);
  }

  private fallBack(): void {
    if (this.stopped) return;
    this.teardown();
    this.setMode('polling');
    this.retry = this.timers.set(() => {
      this.retry = null;
      if (!this.stopped) this.connect();
    }, REALTIME_RETRY_MS);
  }

  private teardown(): void {
    this.source?.close();
    this.source = null;
    if (this.silence !== null) {
      this.timers.clear(this.silence);
      this.silence = null;
    }
    if (this.retry !== null) {
      this.timers.clear(this.retry);
      this.retry = null;
    }
  }

  private setMode(mode: RealtimeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.options.onMode(mode);
  }
}
```

- [ ] **Step 3: Correr, typecheck, lint y commit**

Run: `npx vitest run tests/unit/realtime-client.test.ts && npx tsc --noEmit && npx eslint src/lib/realtime-client.ts tests/unit/realtime-client.test.ts`
Expected: PASS (7 tests) y sin errores.

```bash
git add src/lib/realtime-client.ts tests/unit/realtime-client.test.ts
git commit -m "feat(realtime): cliente con reductor de avisos, pestaña líder y conexión con respaldo a consulta"
```

---

### Task 7: Aviso flash, sonido, escritorio y preferencias (piezas puras)

**Files:**
- Create: `src/lib/inbox-flash.ts`, `src/lib/inbox-preferences.ts`, `src/lib/inbox-sound.ts` y `src/lib/inbox-desktop.ts`
- Test: `tests/unit/inbox-flash.test.ts`

**Interfaces:**
- Consumes: `InboxNotification`.
- Produces:
  - `FLASH_HIGH_MS`, `type FlashItem`, `type FlashAction`, `flashReducer(state, action)` y `visibleFlashes(state, mobile)`.
  - `type InboxPreferences`, `defaultPreferences(surface)`, `readPreferences(surface, storage?)` y `writePreference(surface, name, value, storage?)`.
  - `createSoundGate(now?)` y `createChime()` con `unlock()` y `play(priority)`.
  - `type DesktopPermission`, `desktopPermission()`, `requestDesktopPermission()` y `showDesktopNotification(notice, { silent, onOpen })`.

- [ ] **Step 1: Escribir la prueba**

Crear `tests/unit/inbox-flash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InboxNotification } from '@/lib/inbox-client';
import { FLASH_HIGH_MS, flashReducer, visibleFlashes, type FlashItem } from '@/lib/inbox-flash';
import { defaultPreferences, readPreferences, writePreference } from '@/lib/inbox-preferences';
import { createSoundGate } from '@/lib/inbox-sound';

const notice = (id: string, priority: InboxNotification['priority'] = 'HIGH'): InboxNotification => ({
  id, kind: 'customer.activity', priority, title: `Aviso ${id}`, body: null, actionPath: '/staff/requests', quoteRequestId: null, folio: null, clientName: null,
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T10:00:00.000Z', lastActivityAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z', readAt: null, resolvedAt: null, resolvedNote: null,
});

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('flash queue, preferences and sound', () => {
  it('shows the newest first and replaces a grouped notice instead of duplicating it', () => {
    let state: FlashItem[] = [];
    state = flashReducer(state, { type: 'show', notification: notice('a') });
    state = flashReducer(state, { type: 'show', notification: notice('b', 'URGENT') });
    state = flashReducer(state, { type: 'show', notification: notice('a') });
    expect(state.map((item) => [item.notification.id, item.revision, item.remainingMs])).toEqual([['a', 2, FLASH_HIGH_MS], ['b', 1, null]]);
    state = flashReducer(state, { type: 'pause', id: 'a', paused: true, remainingMs: 3000 });
    expect(state[0]).toMatchObject({ paused: true, remainingMs: 3000 });
    state = flashReducer(state, { type: 'dismiss', id: 'a' });
    expect(state.map((item) => item.notification.id)).toEqual(['b']);
  });

  it('shows three on desktop and two on mobile, counting the rest', () => {
    const state = ['a', 'b', 'c', 'd'].reduce<FlashItem[]>((current, id) => flashReducer(current, { type: 'show', notification: notice(id) }), []);
    expect(visibleFlashes(state, false)).toMatchObject({ overflow: 1 });
    expect(visibleFlashes(state, false).shown).toHaveLength(3);
    expect(visibleFlashes(state, true)).toMatchObject({ overflow: 2 });
  });

  it('keeps sound on for the team and off for customers until each person changes it', () => {
    expect(defaultPreferences('staff')).toEqual({ sound: true, desktop: false });
    expect(defaultPreferences('portal')).toEqual({ sound: false, desktop: false });
    const storage = new MemoryStorage();
    writePreference('portal', 'sound', true, storage);
    writePreference('portal', 'desktop', true, storage);
    expect(readPreferences('portal', storage)).toEqual({ sound: true, desktop: true });
    expect(readPreferences('staff', storage)).toEqual({ sound: true, desktop: false });
    expect(readPreferences('staff', null)).toEqual({ sound: true, desktop: false });
  });

  it('plays at most one sound every three seconds', () => {
    let now = 0;
    const gate = createSoundGate(() => now);
    expect(gate()).toBe(true);
    now = 2_999;
    expect(gate()).toBe(false);
    now = 3_000;
    expect(gate()).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/inbox-flash.test.ts`
Expected: FAIL (los módulos no existen).

- [ ] **Step 2: Cola de flashes**

Crear `src/lib/inbox-flash.ts`:

```ts
import type { InboxNotification } from '@/lib/inbox-client';

export const FLASH_HIGH_MS = 8_000;
const FLASH_MAX_DESKTOP = 3;
const FLASH_MAX_MOBILE = 2;

export type FlashItem = Readonly<{
  notification: InboxNotification;
  /** Sube con cada llegada del mismo aviso: la tarjeta vuelve a destellar y su tiempo se reinicia. */
  revision: number;
  /** Milisegundos que le quedan (HIGH); null = fijo hasta cerrarlo (URGENT). */
  remainingMs: number | null;
  paused: boolean;
}>;

export type FlashAction =
  | Readonly<{ type: 'show'; notification: InboxNotification }>
  | Readonly<{ type: 'dismiss'; id: string }>
  | Readonly<{ type: 'pause'; id: string; paused: boolean; remainingMs?: number }>;

export function flashReducer(state: readonly FlashItem[], action: FlashAction): FlashItem[] {
  switch (action.type) {
    case 'show': {
      const previous = state.find((item) => item.notification.id === action.notification.id);
      const next: FlashItem = { notification: action.notification, revision: (previous?.revision ?? 0) + 1, remainingMs: action.notification.priority === 'URGENT' ? null : FLASH_HIGH_MS, paused: false };
      // Lo más reciente arriba; un aviso agrupado reemplaza su tarjeta, nunca la duplica.
      return [next, ...state.filter((item) => item.notification.id !== action.notification.id)];
    }
    case 'dismiss':
      return state.filter((item) => item.notification.id !== action.id);
    case 'pause':
      return state.map((item) => (item.notification.id === action.id ? { ...item, paused: action.paused, remainingMs: action.remainingMs ?? item.remainingMs } : item));
  }
}

/** Spec §5.3: 3 en escritorio y 2 en móvil; el resto se cuenta como "y N más". */
export function visibleFlashes(state: readonly FlashItem[], mobile: boolean): Readonly<{ shown: FlashItem[]; overflow: number }> {
  const limit = mobile ? FLASH_MAX_MOBILE : FLASH_MAX_DESKTOP;
  return { shown: state.slice(0, limit), overflow: Math.max(0, state.length - limit) };
}
```

- [ ] **Step 3: Preferencias, sonido y escritorio**

Crear `src/lib/inbox-preferences.ts`:

```ts
export type InboxPreferenceSurface = 'staff' | 'portal';
export type InboxPreferences = Readonly<{ sound: boolean; desktop: boolean }>;
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Spec: sonido encendido por defecto para el equipo y apagado para clientes; escritorio sólo si la persona lo activa. */
export function defaultPreferences(surface: InboxPreferenceSurface): InboxPreferences {
  return { sound: surface === 'staff', desktop: false };
}

function keyOf(surface: InboxPreferenceSurface, name: keyof InboxPreferences): string {
  return `ocpool.inbox.${surface}.${name}`;
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Hasta el bloque 5 viven en el navegador (spec §10); si el almacenamiento falla, rigen los valores por defecto. */
export function readPreferences(surface: InboxPreferenceSurface, storage: PreferenceStorage | null = browserStorage()): InboxPreferences {
  const defaults = defaultPreferences(surface);
  const read = (name: keyof InboxPreferences): boolean => {
    try {
      const value = storage?.getItem(keyOf(surface, name));
      return value === 'on' ? true : value === 'off' ? false : defaults[name];
    } catch {
      return defaults[name];
    }
  };
  return { sound: read('sound'), desktop: read('desktop') };
}

export function writePreference(surface: InboxPreferenceSurface, name: keyof InboxPreferences, value: boolean, storage: PreferenceStorage | null = browserStorage()): void {
  try {
    storage?.setItem(keyOf(surface, name), value ? 'on' : 'off');
  } catch {
    // Sin almacenamiento, la preferencia dura sólo esta visita.
  }
}
```

Crear `src/lib/inbox-sound.ts`:

```ts
export const SOUND_MIN_INTERVAL_MS = 3_000;

/** Como máximo un sonido cada 3 s (spec §5.3). */
export function createSoundGate(now: () => number = () => Date.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < SOUND_MIN_INTERVAL_MS) return false;
    last = at;
    return true;
  };
}

type AudioContextConstructor = new () => AudioContext;

/** Un tono corto sintetizado con Web Audio, sin archivos. El navegador exige un gesto antes: `unlock()` lo aprovecha. */
export function createChime(): Readonly<{ unlock: () => void; play: (priority: 'URGENT' | 'HIGH') => void }> {
  let context: AudioContext | null = null;
  const gate = createSoundGate();
  const ensure = (): AudioContext | null => {
    if (context) return context;
    const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Constructor) return null;
    try {
      context = new Constructor();
    } catch {
      context = null;
    }
    return context;
  };
  return {
    unlock() {
      const audio = ensure();
      if (audio?.state === 'suspended') void audio.resume().catch(() => undefined);
    },
    play(priority) {
      const audio = ensure();
      if (!audio || audio.state !== 'running' || !gate()) return;
      const notes = priority === 'URGENT' ? [880, 660] : [660];
      notes.forEach((frequency, index) => {
        const at = audio.currentTime + index * 0.16;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.3);
      });
    },
  };
}
```

Crear `src/lib/inbox-desktop.ts`:

```ts
import type { InboxNotification } from '@/lib/inbox-client';

export type DesktopPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function desktopPermission(): DesktopPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

/** Se pide en el gesto de la persona (spec §10), nunca por iniciativa propia. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() === 'unsupported') return 'unsupported';
  try {
    return await window.Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}

/** Texto plano (spec §11). El `tag` es el id: un aviso agrupado reemplaza al anterior. */
export function showDesktopNotification(notice: InboxNotification, options: Readonly<{ silent: boolean; onOpen: (path: string) => void }>): void {
  if (desktopPermission() !== 'granted') return;
  try {
    const notification = new window.Notification(notice.title, { body: notice.body ?? undefined, tag: notice.id, silent: options.silent });
    notification.onclick = () => {
      window.focus();
      options.onOpen(notice.actionPath);
      notification.close();
    };
  } catch {
    // Algunos navegadores sólo permiten notificaciones desde un service worker.
  }
}
```

- [ ] **Step 4: Correr, typecheck, lint y commit**

Run: `npx vitest run tests/unit/inbox-flash.test.ts && npx tsc --noEmit && npx eslint src/lib/inbox-flash.ts src/lib/inbox-preferences.ts src/lib/inbox-sound.ts src/lib/inbox-desktop.ts tests/unit/inbox-flash.test.ts`
Expected: PASS (4 tests) y sin errores.

```bash
git add src/lib/inbox-flash.ts src/lib/inbox-preferences.ts src/lib/inbox-sound.ts src/lib/inbox-desktop.ts tests/unit/inbox-flash.test.ts
git commit -m "feat(realtime): cola de flashes, preferencias locales, tono sintetizado y notificación de escritorio"
```

---

### Task 8: Proveedor en vivo, pila de flashes y contexto activo

**Files:**
- Create: `src/components/inbox/useInboxRealtime.ts` y `src/components/inbox/FlashAlertStack.tsx`
- Modify: `src/components/inbox/InboxProvider.tsx`, `src/components/inbox/NotificationBell.tsx` e `inbox.css`
- Modify: `src/app/staff/layout.tsx` y `src/app/portal/layout.tsx`
- Modify: `src/components/StaffRequestsPanel.tsx`, `src/components/RequestWorkspaceDetailV2.tsx` y `src/components/ClientPortalPanel.tsx`

**Interfaces:**
- Consumes (Tasks 6 y 7): todo `src/lib/realtime-client.ts`, `inbox-flash.ts`, `inbox-preferences.ts`, `inbox-sound.ts` e `inbox-desktop.ts`.
- Produces:
  - `useInboxRealtime(enabled, handlers): { isLeader(): boolean; anyTabVisible(): Promise<boolean> }`.
  - `InboxContextValue` agrega `live`, `flashes`, `dismissFlash(id)`, `pauseFlash(id, paused, remainingMs?)`, `panelRequest`, `requestPanel()`, `preferences`, `setSound(on)`, `desktop`, `setDesktop(on)` y `setActiveRequest(id)`.
  - `useInboxActiveContext(quoteRequestId: string | null): void`.
  - `<FlashAlertStack />`.

- [ ] **Step 1: El relevo entre pestañas**

Crear `src/components/inbox/useInboxRealtime.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { anyTabVisible, electLeader, holdVisibleLock, RealtimeController, type LockManagerLike, type RealtimeEvent } from '@/lib/realtime-client';

const CHANNEL = 'ocpool-realtime';
const LIVE_BEAT_MS = 20_000;
const LIVE_STALE_MS = 45_000;

type RelayMessage = Readonly<{ kind: 'event'; event: RealtimeEvent }> | Readonly<{ kind: 'live'; live: boolean }>;

export type RealtimeHandlers = Readonly<{
  onEvent: (event: RealtimeEvent, origin: Readonly<{ leader: boolean }>) => void;
  onLive: (live: boolean) => void;
}>;

function browserLocks(): LockManagerLike | undefined {
  return (navigator as Navigator & { locks?: LockManagerLike }).locks;
}

/**
 * Una conexión por navegador (spec §4.4): la pestaña líder la abre y reparte cada evento por BroadcastChannel; las
 * demás sólo escuchan. Sin noticias de una líder en vivo durante 45 s, cada pestaña vuelve a la consulta de respaldo.
 * Sin Web Locks o sin BroadcastChannel, cada pestaña abre su propia conexión.
 */
export function useInboxRealtime(enabled: boolean, handlers: RealtimeHandlers): Readonly<{ isLeader: () => boolean; anyTabVisible: () => Promise<boolean> }> {
  const handlersRef = useRef(handlers);
  const leaderRef = useRef(false);
  const locksRef = useRef<LockManagerLike | undefined>(undefined);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const locks = browserLocks();
    locksRef.current = locks;
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    const tabId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
    let lastBeat = 0;
    let followerLive = false;

    const setFollowerLive = (live: boolean) => {
      if (followerLive === live) return;
      followerLive = live;
      handlersRef.current.onLive(live);
    };
    const onMessage = (message: MessageEvent<RelayMessage>) => {
      if (leaderRef.current || !message.data) return;
      if (message.data.kind === 'live') {
        lastBeat = message.data.live ? Date.now() : 0;
        setFollowerLive(message.data.live);
        return;
      }
      lastBeat = Date.now();
      setFollowerLive(true);
      handlersRef.current.onEvent(message.data.event, { leader: false });
    };
    channel?.addEventListener('message', onMessage);
    const staleCheck = window.setInterval(() => {
      if (!leaderRef.current && followerLive && Date.now() - lastBeat > LIVE_STALE_MS) setFollowerLive(false);
    }, 5_000);

    let releaseVisible: (() => void) | null = null;
    const syncVisible = () => {
      if (document.visibilityState === 'visible') releaseVisible ??= holdVisibleLock(locks, tabId);
      else {
        releaseVisible?.();
        releaseVisible = null;
      }
    };
    syncVisible();
    document.addEventListener('visibilitychange', syncVisible);

    const stopElection = electLeader(channel ? locks : undefined, () => {
      leaderRef.current = true;
      let live = false;
      const post = (message: RelayMessage) => channel?.postMessage(message);
      const controller = new RealtimeController({
        open: (url) => new EventSource(url, { withCredentials: true }),
        onEvent: (event) => {
          handlersRef.current.onEvent(event, { leader: true });
          post({ kind: 'event', event });
        },
        onMode: (mode) => {
          live = mode === 'live';
          handlersRef.current.onLive(live);
          post({ kind: 'live', live });
        },
      });
      controller.start();
      const beat = window.setInterval(() => post({ kind: 'live', live }), LIVE_BEAT_MS);
      return () => {
        window.clearInterval(beat);
        controller.stop();
        leaderRef.current = false;
        post({ kind: 'live', live: false });
      };
    });

    return () => {
      stopElection();
      window.clearInterval(staleCheck);
      document.removeEventListener('visibilitychange', syncVisible);
      releaseVisible?.();
      channel?.removeEventListener('message', onMessage);
      channel?.close();
    };
  }, [enabled]);

  const isLeader = useCallback(() => leaderRef.current, []);
  const someoneLooking = useCallback(() => anyTabVisible(locksRef.current, document.visibilityState === 'visible'), []);
  return { isLeader, anyTabVisible: someoneLooking };
}
```

- [ ] **Step 2: El proveedor en vivo**

Reemplaza `src/components/inbox/InboxProvider.tsx` completo:

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { fetchInboxSummary, InboxRequestError, postInboxRead, titleWithBadge, type InboxNotification, type InboxSummary, type MarkReadInput } from '@/lib/inbox-client';
import { desktopPermission, requestDesktopPermission, showDesktopNotification, type DesktopPermission } from '@/lib/inbox-desktop';
import { flashReducer, type FlashItem } from '@/lib/inbox-flash';
import { defaultPreferences, readPreferences, writePreference, type InboxPreferences } from '@/lib/inbox-preferences';
import { createChime } from '@/lib/inbox-sound';
import { applyNotificationEvent, shouldFlash, type RealtimeEvent } from '@/lib/realtime-client';
import { useInboxRealtime } from './useInboxRealtime';

export type InboxSurface = 'staff' | 'portal';

export type InboxContextValue = {
  surface: InboxSurface;
  /** `false` sin sesión (401/403): la campana no se muestra. */
  available: boolean;
  loaded: boolean;
  unread: number;
  actionRequired: number;
  latest: InboxNotification[];
  unreadByRequest: Record<string, number>;
  refresh: () => Promise<void>;
  markRead: (input: MarkReadInput) => Promise<void>;
  /** En vivo por el canal SSE; si no, consulta de respaldo cada 30 s. */
  live: boolean;
  flashes: FlashItem[];
  dismissFlash: (id: string) => void;
  pauseFlash: (id: string, paused: boolean, remainingMs?: number) => void;
  /** Sube cada vez que algo pide abrir el panel (el "y N más" del flash). */
  panelRequest: number;
  requestPanel: () => void;
  preferences: InboxPreferences;
  setSound: (on: boolean) => void;
  desktop: DesktopPermission;
  setDesktop: (on: boolean) => Promise<void>;
  setActiveRequest: (quoteRequestId: string | null) => void;
};

const InboxContext = createContext<InboxContextValue | null>(null);
// Respaldo cuando no hay canal en vivo: al navegar, al volver a la pestaña y cada 30 s.
const POLL_INTERVAL_MS = 30_000;
const COUNTS_REFRESH_DELAY_MS = 600;
const EMPTY: InboxSummary = { unread: 0, actionRequired: 0, latest: [], unreadByRequest: {} };

function applyReadLocally(summary: InboxSummary, input: MarkReadInput, now: string): InboxSummary {
  const read = !('ids' in input) || input.read !== false;
  const matches = (item: InboxNotification) => {
    if ('ids' in input) return input.ids.includes(item.id);
    if ('all' in input) return true;
    return item.quoteRequestId === input.quoteRequestId && (input.scope === 'all' || !item.actionRequired);
  };
  const latest = summary.latest.map((item) => (matches(item) ? { ...item, readAt: read ? item.readAt ?? now : null } : item));
  const unreadByRequest = { ...summary.unreadByRequest };
  if ('all' in input) for (const key of Object.keys(unreadByRequest)) delete unreadByRequest[key];
  if ('quoteRequestId' in input && input.scope === 'all') delete unreadByRequest[input.quoteRequestId];
  return { ...summary, latest, unreadByRequest };
}

export function InboxProvider({ surface, children }: { surface: InboxSurface; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [summary, setSummary] = useState<InboxSummary>(EMPTY);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);
  const [flashes, dispatchFlash] = useReducer(flashReducer, []);
  const [panelRequest, setPanelRequest] = useState(0);
  // La campana no se pinta en el servidor con el panel abierto: leer el navegador de entrada no desincroniza la hidratación.
  const [preferences, setPreferences] = useState<InboxPreferences>(() => (typeof window === 'undefined' ? defaultPreferences(surface) : readPreferences(surface)));
  const [desktop, setDesktopState] = useState<DesktopPermission>(() => desktopPermission());
  const inFlight = useRef<AbortController | null>(null);
  // Cada escritura (marcar leído) cambia la generación: un resumen pedido antes o durante la escritura
  // llega con el contador viejo y no debe pisar el que acaba de devolver el servidor.
  const writeGeneration = useRef(0);
  const latestWrite = useRef(0);
  const activeRequest = useRef<string | null>(null);
  const preferencesRef = useRef(preferences);
  const chime = useRef<ReturnType<typeof createChime> | null>(null);
  const countsRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const generation = writeGeneration.current;
    try {
      const next = await fetchInboxSummary(controller.signal);
      if (controller.signal.aborted || generation !== writeGeneration.current) return;
      setSummary(next);
      setAvailable(true);
      setLoaded(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof InboxRequestError && (error.status === 401 || error.status === 403)) {
        setAvailable(false);
        setSummary(EMPTY);
      }
      // Cualquier otro error: se conserva lo último que se vio y la siguiente consulta lo reintenta.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, pathname]);

  useEffect(() => {
    if (!available || live) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(onVisible, POLL_INTERVAL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [available, live, refresh]);

  useEffect(() => () => {
    inFlight.current?.abort();
    if (countsRefreshTimer.current !== null) window.clearTimeout(countsRefreshTimer.current);
  }, []);

  // El navegador sólo deja sonar audio después de un gesto: el primero lo desbloquea.
  useEffect(() => {
    chime.current = createChime();
    const unlock = () => chime.current?.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const unread = available ? summary.unread : 0;

  // Next reescribe <title> en cada navegación: se vuelve a poner el "(N)" cada vez que cambia.
  useEffect(() => {
    const apply = () => {
      const next = titleWithBadge(document.title, unread);
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = titleWithBadge(document.title, 0);
    };
  }, [unread]);

  const scheduleCountsRefresh = useCallback(() => {
    if (countsRefreshTimer.current !== null) window.clearTimeout(countsRefreshTimer.current);
    countsRefreshTimer.current = window.setTimeout(() => {
      countsRefreshTimer.current = null;
      void refresh();
    }, COUNTS_REFRESH_DELAY_MS);
  }, [refresh]);

  const realtimeRef = useRef<ReturnType<typeof useInboxRealtime> | null>(null);

  const handleRealtime = useCallback((event: RealtimeEvent, origin: Readonly<{ leader: boolean }>) => {
    switch (event.type) {
      case 'hello':
      case 'resync':
        // Al (re)conectar la lista pudo cambiar sin que llegaran sus eventos.
        void refresh();
        return;
      case 'counts':
        setSummary((current) => ({ ...current, unread: event.unread, actionRequired: event.actionRequired }));
        // Una lectura en otra pestaña o dispositivo: la lista se pone al día.
        scheduleCountsRefresh();
        return;
      case 'bye':
        if (event.reason === 'session') window.location.assign(surface === 'staff' ? '/login' : '/portal/access');
        return;
      case 'notification': {
        setSummary((current) => applyNotificationEvent(current, event));
        if (!shouldFlash(event, activeRequest.current)) return;
        if (document.visibilityState === 'visible') {
          dispatchFlash({ type: 'show', notification: event.notification });
          if (preferencesRef.current.sound) chime.current?.play(event.notification.priority === 'URGENT' ? 'URGENT' : 'HIGH');
          return;
        }
        // Nadie mira esta pestaña: la líder avisa por escritorio si ninguna otra está a la vista.
        if (!origin.leader || !preferencesRef.current.desktop) return;
        void realtimeRef.current?.anyTabVisible().then((someoneLooking) => {
          if (!someoneLooking) showDesktopNotification(event.notification, { silent: !preferencesRef.current.sound, onOpen: (path) => router.push(path) });
        });
        return;
      }
    }
  }, [refresh, router, scheduleCountsRefresh, surface]);

  const realtime = useInboxRealtime(available && loaded, { onEvent: handleRealtime, onLive: setLive });
  useEffect(() => {
    realtimeRef.current = realtime;
  }, [realtime]);

  const markRead = useCallback(async (input: MarkReadInput) => {
    writeGeneration.current += 1;
    latestWrite.current += 1;
    const write = latestWrite.current;
    setSummary((current) => applyReadLocally(current, input, new Date().toISOString()));
    try {
      const counts = await postInboxRead(input);
      writeGeneration.current += 1;
      // Con dos escrituras seguidas, sólo cuentan los contadores de la última.
      if (write === latestWrite.current) setSummary((current) => ({ ...current, unread: counts.unread, actionRequired: counts.actionRequired }));
    } catch {
      writeGeneration.current += 1;
      void refresh();
    }
  }, [refresh]);

  const dismissFlash = useCallback((id: string) => dispatchFlash({ type: 'dismiss', id }), []);
  const pauseFlash = useCallback((id: string, paused: boolean, remainingMs?: number) => dispatchFlash({ type: 'pause', id, paused, remainingMs }), []);
  const requestPanel = useCallback(() => setPanelRequest((current) => current + 1), []);
  const setActiveRequest = useCallback((quoteRequestId: string | null) => {
    activeRequest.current = quoteRequestId;
  }, []);

  const setSound = useCallback((on: boolean) => {
    writePreference(surface, 'sound', on);
    setPreferences((current) => ({ ...current, sound: on }));
    if (on) chime.current?.unlock();
  }, [surface]);

  const setDesktop = useCallback(async (on: boolean) => {
    if (on && desktopPermission() !== 'granted') {
      const permission = await requestDesktopPermission();
      setDesktopState(permission);
      if (permission !== 'granted') return;
    }
    writePreference(surface, 'desktop', on);
    setPreferences((current) => ({ ...current, desktop: on }));
    setDesktopState(desktopPermission());
  }, [surface]);

  const value = useMemo<InboxContextValue>(() => ({
    surface,
    available,
    loaded,
    unread,
    actionRequired: available ? summary.actionRequired : 0,
    latest: summary.latest,
    unreadByRequest: summary.unreadByRequest,
    refresh,
    markRead,
    live,
    flashes,
    dismissFlash,
    pauseFlash,
    panelRequest,
    requestPanel,
    preferences,
    setSound,
    desktop,
    setDesktop,
    setActiveRequest,
  }), [surface, available, loaded, unread, summary, refresh, markRead, live, flashes, dismissFlash, pauseFlash, panelRequest, requestPanel, preferences, setSound, desktop, setDesktop, setActiveRequest]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue | null {
  return useContext(InboxContext);
}

/** Una vista con un expediente abierto lo registra: su actividad no destella (spec §5.3). */
export function useInboxActiveContext(quoteRequestId: string | null): void {
  const setActiveRequest = useInbox()?.setActiveRequest;
  useEffect(() => {
    if (!setActiveRequest) return undefined;
    setActiveRequest(quoteRequestId);
    return () => setActiveRequest(null);
  }, [setActiveRequest, quoteRequestId]);
}
```

- [ ] **Step 3: La pila de flashes**

Crear `src/components/inbox/FlashAlertStack.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { InboxNotification } from '@/lib/inbox-client';
import { FLASH_HIGH_MS, visibleFlashes, type FlashItem } from '@/lib/inbox-flash';
import { inboxKindVisual } from './inbox-visuals';
import { useInbox } from './InboxProvider';
import { useInboxActions } from './useInboxActions';

const MOBILE_QUERY = '(max-width: 768px)';

function subscribeToViewport(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

type CardProps = Readonly<{
  item: FlashItem;
  onDismiss: (id: string) => void;
  onPause: (id: string, paused: boolean, remainingMs?: number) => void;
  onOpen: (notice: InboxNotification) => void;
  actions: ReactNode;
}>;

function FlashCard({ item, onDismiss, onPause, onOpen, actions }: CardProps) {
  const notice = item.notification;
  const visual = inboxKindVisual(notice.kind);
  const Icon = visual.icon;
  const urgent = notice.priority === 'URGENT';
  const startedAt = useRef(0);

  // HIGH se va sola a los 8 s, salvo con el puntero encima o el foco dentro (spec §5.3).
  useEffect(() => {
    if (item.remainingMs === null || item.paused) return undefined;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(notice.id), item.remainingMs);
    return () => window.clearTimeout(timer);
  }, [item.remainingMs, item.paused, item.revision, notice.id, onDismiss]);

  const pause = (paused: boolean) => {
    if (item.remainingMs === null || item.paused === paused) return;
    onPause(notice.id, paused, paused ? Math.max(0, item.remainingMs - (Date.now() - startedAt.current)) : item.remainingMs);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pause(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss(notice.id);
  };

  return (
    <article className={`inbox-flash${urgent ? ' is-urgent' : ''}`} role={urgent ? 'alert' : 'status'} aria-label={notice.title} onMouseEnter={() => pause(true)} onMouseLeave={() => pause(false)} onFocus={() => pause(true)} onBlur={onBlur} onKeyDown={onKeyDown}>
      <span className={`inbox-item__icon inbox-item__icon--${visual.tone}`} aria-hidden="true"><Icon size={16} /></span>
      <div className="inbox-flash__main">
        <Link className="inbox-flash__link" href={notice.actionPath} onClick={() => onOpen(notice)}>
          <strong>{notice.title}</strong>
          {notice.body && <span>{notice.body}</span>}
        </Link>
        {actions && <div className="inbox-flash__actions">{actions}</div>}
      </div>
      <button type="button" className="inbox-flash__close" aria-label={`Cerrar aviso: ${notice.title}`} onClick={() => onDismiss(notice.id)}><X size={15} aria-hidden="true" /></button>
      {!urgent && <span className="inbox-flash__progress" style={{ animationDuration: `${FLASH_HIGH_MS}ms`, animationPlayState: item.paused ? 'paused' : 'running' }} aria-hidden="true" />}
    </article>
  );
}

/** Avisos al momento (spec §5.3). Distintos de los toasts, que siguen confirmando acciones. */
export default function FlashAlertStack() {
  const inbox = useInbox();
  const mobile = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
  const markRead = inbox?.markRead;
  const dismiss = inbox?.dismissFlash;
  const openItem = (notice: InboxNotification) => {
    if (!notice.readAt) void markRead?.({ ids: [notice.id] });
    dismiss?.(notice.id);
  };
  const actionsFor = useInboxActions({ onOpen: openItem });
  if (!inbox || inbox.flashes.length === 0) return null;
  const { shown, overflow } = visibleFlashes(inbox.flashes, mobile);
  return (
    <section className="inbox-flash-stack" aria-label="Avisos al momento">
      {shown.map((item) => <FlashCard key={`${item.notification.id}:${item.revision}`} item={item} onDismiss={inbox.dismissFlash} onPause={inbox.pauseFlash} onOpen={openItem} actions={inbox.surface === 'staff' ? actionsFor(item.notification) : null} />)}
      {overflow > 0 && <button type="button" className="inbox-flash-stack__more" onClick={inbox.requestPanel}>y {overflow} más</button>}
    </section>
  );
}
```

- [ ] **Step 4: Pie del panel y apertura por "y N más"**

En `src/components/inbox/NotificationBell.tsx`:
1. Cambia la importación de íconos por `import { Bell, CheckCheck, Monitor, MonitorUp, Volume2, VolumeX, X } from 'lucide-react';`.
2. Justo antes de `if (!inbox || !inbox.available) return null;`, agrega:

```tsx
  // "y N más" del flash abre el panel.
  const panelRequest = inbox?.panelRequest ?? 0;
  useEffect(() => {
    if (panelRequest === 0) return;
    setPanelTop(Math.round((triggerRef.current?.getBoundingClientRect().bottom ?? 64) + 8));
    setOpen(true);
  }, [panelRequest]);
```

3. Reemplaza la línea `{staff && <div className="inbox-panel__foot"><Link href="/staff/notifications" onClick={() => setOpen(false)}>Ver todas</Link></div>}` por:

```tsx
          <div className="inbox-panel__foot">
            {staff && <Link href="/staff/notifications" onClick={() => setOpen(false)}>Ver todas</Link>}
            <div className="inbox-panel__prefs">
              <button type="button" className="inbox-pref" aria-pressed={inbox.preferences.sound} onClick={() => inbox.setSound(!inbox.preferences.sound)}>
                {inbox.preferences.sound ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}Sonido
              </button>
              {inbox.desktop === 'default' && <button type="button" className="inbox-pref" onClick={() => void inbox.setDesktop(true)}><MonitorUp size={15} aria-hidden="true" />Activar alertas de escritorio</button>}
              {inbox.desktop === 'granted' && <button type="button" className="inbox-pref" aria-pressed={inbox.preferences.desktop} onClick={() => void inbox.setDesktop(!inbox.preferences.desktop)}><Monitor size={15} aria-hidden="true" />Alertas de escritorio</button>}
            </div>
          </div>
```

En `src/components/inbox/inbox.css`:
1. Reemplaza la regla `.inbox-panel__foot { display: flex; justify-content: center; border-top: 1px solid var(--private-color-border); padding: 10px; }` por:

```css
.inbox-panel__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; border-top: 1px solid var(--private-color-border); padding: 8px 12px; }
.inbox-panel__prefs { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.inbox-pref { display: inline-flex; min-height: 32px; align-items: center; gap: 6px; border: 0; border-radius: var(--private-radius-sm); padding: 0 8px; background: transparent; color: var(--private-color-ink-muted); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; }
.inbox-pref[aria-pressed="true"] { color: var(--private-color-accent); }
.inbox-pref:hover, .inbox-pref:focus-visible { background: var(--private-color-surface-muted); outline: 0; }
```

2. Antes de `@media (max-width: 768px) {`, agrega:

```css
/* Aviso flash (spec §5.3): arriba a la derecha bajo el encabezado, por encima de los toasts. */
.inbox-flash-stack { position: fixed; z-index: calc(var(--private-z-toast) + 5); top: calc(var(--staff-header-height, 64px) + 12px); right: 16px; display: grid; gap: 10px; width: min(380px, calc(100vw - 32px)); pointer-events: none; }
.inbox-flash-stack > * { pointer-events: auto; }
.inbox-flash { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) 28px; align-items: start; gap: 10px; overflow: hidden; border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); padding: 12px 10px 14px 12px; background: var(--private-color-surface); color: var(--private-color-ink); box-shadow: var(--private-shadow-popover); animation: inbox-flash-in 220ms cubic-bezier(.2, .7, .2, 1); }
.inbox-flash.is-urgent { border-color: color-mix(in srgb, var(--private-color-danger) 45%, var(--private-color-border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--private-color-danger) 16%, transparent), var(--private-shadow-popover); }
.inbox-flash__main { display: grid; min-width: 0; gap: 8px; }
.inbox-flash__link { display: grid; gap: 2px; color: inherit; text-decoration: none; }
.inbox-flash__link strong { font-size: 14px; font-weight: 750; line-height: 1.35; }
.inbox-flash__link span { display: -webkit-box; overflow: hidden; color: var(--private-color-ink-muted); font-size: 12.5px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.inbox-flash__link:focus-visible { border-radius: 4px; outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
.inbox-flash__actions { display: flex; flex-wrap: wrap; gap: 6px; }
.inbox-flash__close { display: inline-grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: var(--private-radius-sm); background: transparent; color: var(--private-color-ink-muted); cursor: pointer; }
.inbox-flash__close:hover, .inbox-flash__close:focus-visible { background: var(--private-color-surface-muted); outline: 0; }
.inbox-flash__progress { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; background: var(--private-color-accent); transform-origin: left; animation: inbox-flash-progress linear forwards; }
.inbox-flash-stack__more { justify-self: end; min-height: 34px; border: 1px solid var(--private-color-border-control); border-radius: 999px; padding: 0 14px; background: var(--private-color-surface); color: var(--private-color-brand); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 700; box-shadow: var(--private-shadow-card); }
.inbox-flash-stack__more:focus-visible { outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
@keyframes inbox-flash-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@keyframes inbox-flash-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
```

3. Dentro de `@media (max-width: 768px) {`, agrega `.inbox-flash-stack { top: 12px; right: 16px; left: 16px; width: auto; }`.
4. Dentro de `@media (prefers-reduced-motion: reduce) {`, agrega `.inbox-flash { animation: none; }` y `.inbox-flash__progress { display: none; }`.

- [ ] **Step 5: Layouts y contexto activo**

Reemplaza la función de `src/app/staff/layout.tsx` (conserva sus imports, agrega `import FlashAlertStack from '@/components/inbox/FlashAlertStack';`). La sesión queda por fuera de la bandeja para que la campana del shell V2 y los flashes conozcan los permisos ("Tomar"):

```tsx
export default async function StaffLayout({ children }: { children: ReactNode }) {
  if (!readCommercialV2Flags().commercialWorkspaceV2) {
    // Identidad y permisos para el header compartido de staff (menú de cuenta, "Cerrar sesión",
    // navegación filtrada). Es un dato de presentación: una sola lectura sin transacción, y si
    // falla (p. ej. el pool de conexiones saturado) la página no debe caerse -- cada panel sigue
    // validando la sesión contra su propia API y el header se muestra sin menú de cuenta.
    const session = await getStaffHeaderContext().catch(() => null);
    return <div className="private-ui-scope"><PrivateToastProvider><StaffSessionProvider session={session}><InboxProvider surface="staff">{children}<FlashAlertStack /></InboxProvider></StaffSessionProvider></PrivateToastProvider></div>;
  }
  const context = await getPrivateShellContext('staff');
  const content = context ? <PrivateShell surface="staff" context={context} navigation={visibleStaffNavigation(context.capabilities)}>{children}</PrivateShell> : children;
  return <div className="private-ui-scope"><PrivateToastProvider><StaffSessionProvider session={context}><InboxProvider surface="staff">{content}<FlashAlertStack /></InboxProvider></StaffSessionProvider></PrivateToastProvider></div>;
}
```

En `src/app/portal/layout.tsx`, agrega `import FlashAlertStack from '@/components/inbox/FlashAlertStack';` y cambia el `wrap` por:

```tsx
  const wrap = (content: ReactNode) => <div className="private-ui-scope"><PrivateToastProvider><InboxProvider surface="portal">{content}<FlashAlertStack /></InboxProvider></PrivateToastProvider></div>;
```

En `src/components/StaffRequestsPanel.tsx` y `src/components/RequestWorkspaceDetailV2.tsx`:
- Cambia `import { useInbox } from '@/components/inbox/InboxProvider';` por `import { useInbox, useInboxActiveContext } from '@/components/inbox/InboxProvider';`.
- Justo después de `const openUnread = openRequestId ? inbox?.unreadByRequest[openRequestId] ?? 0 : 0;`, agrega `useInboxActiveContext(openRequestId);`.

En `src/components/ClientPortalPanel.tsx`:
- Cambia `import { useInbox } from '@/components/inbox/InboxProvider';` por `import { useInbox, useInboxActiveContext } from '@/components/inbox/InboxProvider';`.
- Justo después de `const openUnread = openRequestId ? inbox?.unreadByRequest[openRequestId] ?? 0 : 0;`, agrega `useInboxActiveContext(openRequestId);`.

- [ ] **Step 6: Verificación**

Run: `npx tsc --noEmit && npx eslint src/components/inbox src/app/staff/layout.tsx src/app/portal/layout.tsx src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceDetailV2.tsx src/components/ClientPortalPanel.tsx && npx vitest run tests/unit`
Expected: sin errores; todas las unitarias pasan.

QA en navegador en :3010 (escenario aislado con `scripts/qa-realtime-scenario.ts`, temporal, que crea una persona de Ventas con sesión, un cliente con portal y una solicitud a su cargo, y borra todo con `cleanup`):
- Con la página abierta en `/staff`, un mensaje del cliente creado desde el script llega en menos de 5 s: contador, "(N)" y flash, sin recargar.
- Dos pestañas: una sola petición a `/api/realtime`; marcar todo como leído en una limpia la otra.
- El flash HIGH se va a los 8 s; con el puntero encima no; Esc lo cierra; "y N más" abre el panel.
- El pie del panel cambia el sonido y ofrece las alertas de escritorio.
- A 390 px el flash ocupa el ancho sin desbordar.

- [ ] **Step 7: Commit**

```bash
git add src/components/inbox src/app/staff/layout.tsx src/app/portal/layout.tsx src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceDetailV2.tsx src/components/ClientPortalPanel.tsx
git commit -m "feat(realtime): campana en vivo en todas las pestañas con aviso flash, sonido y alertas de escritorio"
```

---

### Task 9: E2E, runbook, documentación y verificación completa

**Files:**
- Create: `tests/realtime-notifications.spec.ts` y `docs/ocpool-commercial-v2/specs/2026-09-29-tiempo-real-y-flash.md`
- Modify: `docs/runbooks/production-readiness.md`, `PROJECT_STATUS.md` y `README.md`

- [ ] **Step 1: La prueba E2E (`REALTIME_E2E=1`)**

Crear `tests/realtime-notifications.spec.ts`:

```ts
import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { sendCustomerMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('avisos en tiempo real', () => {
  test.skip(process.env.REALTIME_E2E !== '1', 'Realtime E2E requires REALTIME_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'serial' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const salesToken = `realtime-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let customerId = '';
  let customer: Actor;
  let sent = 0;

  test.beforeAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all(['sales', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    salesId = (await prisma.user.create({ data: { email: `realtime-e2e-sales-${suffix}@example.test`, emailNormalized: `realtime-e2e-sales-${suffix}@example.test`, displayName: `Ventas RT ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `realtime-e2e-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Cliente RT ${suffix}`, email: `realtime-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Hermosillo', description: 'Fixture de tiempo real', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `realtime-e2e-customer-${suffix}@example.test`, emailNormalized: `realtime-e2e-customer-${suffix}@example.test`, displayName: `Cliente RT ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: salesId, status: 'EN_REVISION' } });
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'realtime-e2e' }, { prisma, tokenGenerator: () => salesToken });
  });

  test.afterAll(async () => {
    if (process.env.REALTIME_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [salesId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, customerId] } } });
    await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${customerId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  const customerWrites = async (body: string) => {
    sent += 1;
    await sendCustomerMessage(customer, requestId, { body, idempotencyKey: `realtime-e2e-${sent}-${suffix}` }, { prisma, rateLimit });
  };
  const signIn = (page: Page) => page.context().addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
  const liveOn = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname === '/api/realtime' && response.status() === 200);

  test('el equipo ve el contador y el flash en menos de 5 s, sin recargar', async ({ page }) => {
    await signIn(page);
    const live = liveOn(page);
    await page.goto('/staff');
    await live;
    await customerWrites('Te comparto las medidas finales del terreno.');
    const flash = page.getByRole('status').filter({ hasText: `Cliente RT ${suffix} te escribió` });
    await expect(flash).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Notificaciones, 1 sin leer/ })).toBeVisible({ timeout: 5_000 });
    await expectNoSeriousA11yViolations(page);
    await flash.getByRole('button', { name: /Cerrar aviso/ }).click();
    await expect(flash).toHaveCount(0);
  });

  test('dos pestañas comparten una conexión y una lectura limpia ambas', async ({ context }) => {
    await context.addCookies([{ name: 'ocpool_session', value: salesToken, url: origin }]);
    const first = await context.newPage();
    const second = await context.newPage();
    const opened: string[] = [];
    for (const [name, page] of [['first', first], ['second', second]] as const) page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/realtime') opened.push(name); });
    await first.goto('/staff');
    await second.goto('/staff');
    await expect.poll(() => opened.length, { timeout: 10_000 }).toBe(1);
    await second.waitForTimeout(1_500);
    expect(opened).toHaveLength(1);
    await customerWrites('¿Ya tienen la propuesta?');
    for (const page of [first, second]) await expect(page.getByRole('button', { name: /Notificaciones, \d+ sin leer/ })).toBeVisible({ timeout: 5_000 });
    await first.getByRole('button', { name: /Notificaciones, \d+ sin leer/ }).click();
    await first.getByRole('button', { name: 'Marcar todo como leído' }).click();
    await expect(second.getByRole('button', { name: 'Notificaciones', exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('en teléfono el flash ocupa el ancho sin desbordar', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const live = liveOn(page);
    await page.goto('/staff');
    await live;
    await customerWrites('Mensaje desde el teléfono.');
    await expect(page.getByRole('status').filter({ hasText: `Cliente RT ${suffix}` })).toBeVisible({ timeout: 5_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
```

Run (servidor de desarrollo aislado en :3100 con `NEXT_DIST_DIR=.next-e2e`, arrancado con `preview_start` y una entrada temporal en `.claude/launch.json`):
`APP_URL=http://127.0.0.1:3100 REALTIME_E2E=1 REUSE_E2E_SERVER=1 npx playwright test tests/realtime-notifications.spec.ts --reporter=list`
Expected: 3 passed. La primera corrida puede fallar por compilación en frío; repítela antes de depurar.

- [ ] **Step 2: Runbook**

En `docs/runbooks/production-readiness.md`, justo antes de `## Build y reinicio seguro del runtime`, agrega:

```markdown
## Tiempo real (`/api/realtime`)

- El canal SSE necesita que el proxy no almacene la respuesta en búfer: `proxy_buffering off` para `/api/realtime` (la ruta ya envía `X-Accel-Buffering: no`) y `proxy_read_timeout` de 60 s o más; el servidor manda `ping` cada `REALTIME_HEARTBEAT_SECONDS` (25 s).
- Se recomienda HTTP/2: con HTTP/1.1 cada pestaña líder ocupa una de las ~6 conexiones por dominio del navegador.
- PM2 funciona con una o varias instancias: cada proceso abre su propia conexión `LISTEN ocpool_realtime` fuera del pool de Prisma. Cuenta una conexión más a PostgreSQL por instancia.
- Interruptor sin desplegar: `REALTIME_ENABLED=false` y reinicio del proceso. La ruta responde `503` y todos los navegadores consultan cada 30 s; se vuelve a activar igual.
- Límites: `REALTIME_MAX_CONNECTIONS_PER_USER` (10) y revalidación de la sesión cada `REALTIME_SESSION_RECHECK_SECONDS` (60 s). Una suspensión o revocación cierra el canal al momento.
- Logs: el hub registra sólo conexiones de la escucha y fallos de reparto, sin datos de personas.
```

- [ ] **Step 3: Documentación**

Crear `docs/ocpool-commercial-v2/specs/2026-09-29-tiempo-real-y-flash.md` con el formato de las specs de esa carpeta: problema, decisión (canal, hub, pestaña líder, respaldo, interruptor), qué ve cada rol, flash, sonido y escritorio, seguridad, hallazgos, verificación con comandos y resultados reales, y qué queda para los bloques 3 a 5.

En `PROJECT_STATUS.md`, agrega una entrada después de la del bloque 1 titulada **"Tiempo real y aviso flash (bloque 2 de notificaciones en tiempo real) 2026-09-29"**, con el mismo estilo.

En `README.md`, después de la línea de `GET /api/notifications`, agrega:

```markdown
- `GET /api/realtime` — canal SSE de la persona autenticada (equipo o cliente): avisos, contadores y cierre de sesión al momento; con `REALTIME_ENABLED=false` responde 503 y el navegador consulta cada 30 s.
```

- [ ] **Step 4: Verificación completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Run: `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1` (en segundo plano)
Run (en segundo plano, sin editar archivos mientras corre): `APP_URL=http://127.0.0.1:3100 QUOTES_E2E=1 AUDIT_E2E=1 AUTH_E2E=1 AUTH_SURFACES_E2E=1 CATALOG_E2E=1 CUSTOMER_ONBOARDING_E2E=1 DASHBOARD_E2E=1 FOUNDATION_E2E=1 PORTAL_E2E=1 PROJECTS_E2E=1 REQUESTS_E2E=1 STAFF_MESSAGING_E2E=1 INBOX_E2E=1 REALTIME_E2E=1 npx playwright test --reporter=list`
Expected: sólo la línea base aceptada falla.

Revisa los restos: `inbox_notifications` en 0 y ningún usuario, contacto o rol con prefijo `rt-`, `realtime-e2e-` o `qa-realtime-`.

- [ ] **Step 5: Commit**

```bash
git add tests/realtime-notifications.spec.ts docs/runbooks/production-readiness.md docs/ocpool-commercial-v2/specs/2026-09-29-tiempo-real-y-flash.md PROJECT_STATUS.md README.md
git commit -m "test(realtime): recorrido en vivo entre pestañas, runbook del canal y documentación del bloque 2"
```

---

## Cobertura de la spec en este bloque

| Spec | Tarea |
|---|---|
| §4.1 Señales `n`, `u` y `s` (la `r` y sus partes van en el bloque 3) | 1 y 2 |
| §4.2 Hub: singleton, LISTEN dedicado, registro, tope, reparto, reconexión con `resync` y revalidación | 4 y 5 |
| §4.3 Endpoint SSE: encabezados, eventos, `ping`, `retry`, reanudación, presión y limpieza | 5 |
| §4.4 Cliente: pestaña líder, BroadcastChannel, respaldo, reintento cada 5 min y título | 6 y 8 |
| §5.1 Pie del panel: sonido y alertas de escritorio | 8 |
| §5.3 Flash: prioridades, agrupación, supresión por contexto, sonido, escritorio y accesibilidad | 7 y 8 |
| §10 Preferencias de sonido y escritorio en `localStorage` | 7 y 8 |
| §11 Canal: sólo identificadores, alcance, tope, revalidación y cierre inmediato | 1, 2, 4 y 5 |
| §12 Variables, interruptor y runbook | 1 y 9 |
| §13 Pruebas del bloque 2 | todas |

Fuera de este bloque, según la spec §14:
- Bloque 3: la señal `r`, pantallas en vivo y "Visto por el cliente".
- Bloque 4: declinar, "abrió la propuesta" y "entró a su portal".
- Bloque 5: resumen por correo, recordatorios y preferencias en el servidor.
