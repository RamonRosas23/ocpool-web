# Bandeja de avisos por rol (bloque 1) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que cada persona (Ventas, Gerencia, Administración y cliente) tenga una bandeja de avisos de operación en su idioma, generada en la misma transacción del cambio, con campana, panel y página, y que el correo deje de fallar en los huecos detectados.

**Architecture:**
- Un módulo nuevo `src/server/modules/inbox/` convierte cada evento de dominio en avisos por persona.
  - `recordDomainEvent` escribe el outbox de siempre y, en la misma transacción y protegido con un savepoint, ejecuta las reglas y guarda los avisos.
  - La agrupación usa un índice único parcial y `ON CONFLICT`.
- Cada aviso emite `pg_notify('ocpool_realtime', …)`. Nadie lo escucha todavía; el bloque 2 conecta el hub.
- La interfaz consulta `/api/notifications/summary` al navegar, al volver el foco y cada 30 s.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Prisma 7 con `@prisma/adapter-pg`, PostgreSQL 16, zod 4, vitest, Playwright, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md` (§1, §2, §3, §5.1, §5.2, §5.5 parcial, §8.1).

## Global Constraints

**Entorno y rama**
- Se trabaja en `C:\Desarrollo\WEBS\OCPOOL-WEB` (Windows con Git Bash y PowerShell), rama `feat/notificaciones-tiempo-real`.
- Se hace commit al final de cada tarea, **sin push**.
- No hay `python`. Las ediciones por script se hacen con `node`.
- Los archivos pueden tener CRLF.

**Base de datos**
- Las migraciones son SQL escrito a mano en `prisma/migrations/<timestamp>_<nombre>/migration.sql`. Se aplican con `npx prisma migrate deploy` y después se corre `npx prisma generate`.
- No se usa `prisma db push`.

**Servidor de desarrollo y fixtures**
- No se detiene el `npm run dev` del usuario en :3000. Después de migrar, ese servidor queda con el cliente Prisma viejo, así que hay que avisarle que lo reinicie.
- La QA en navegador corre en :3010 (`NEXT_DIST_DIR=.next-qa`).
- Nunca se usan los fixtures del piloto (`docs/ocpool-commercial-v2/pilot-fixtures.json`). Las pruebas crean y borran sus propios datos.

**Textos**
- Español de México, redacción neutra, sin marcar género.
- Los avisos nunca se mandan a quien hizo la acción.
- El cliente jamás recibe contenido interno: notas internas, aprobaciones, precios pendientes ni archivos internos.

**Calidad**
- Al final de cada tarea deben pasar `npx tsc --noEmit`, `npm run lint` y las pruebas que toca la tarea.
- Las pruebas de integración usan `RUN_DB_TESTS=1` y comparten la base `ocpool_dev`. Por eso se afirma sólo sobre usuarios creados por la propia prueba, nunca sobre conteos globales.

**Arquitectura**
- La landing está congelada: no se toca.
- `outboxEvent.create` directo sólo se permite en `src/server/auth/service.ts`, `src/server/modules/catalog/service.ts`, `src/server/modules/special-concepts/service.ts`, `src/server/modules/quote-documents/service.ts` y `src/server/modules/inbox/domain-events.ts`.

---

## Mapa de archivos

**Servidor: módulo `inbox` y tiempo real**

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` | `enum InboxPriority`, `model InboxNotification` y relaciones en `User` y `QuoteRequest` |
| `prisma/migrations/20260929010000_inbox_notifications/migration.sql` (nuevo) | Tabla, índices (incluido el único parcial) y `CHECK` |
| `src/server/realtime/publish.ts` (nuevo) | `publishRealtime`: `pg_notify` con sólo identificadores |
| `src/server/modules/inbox/kinds.ts` (nuevo) | Catálogo cerrado de tipos, prioridades y campos permitidos |
| `src/server/modules/inbox/text.ts` (nuevo) | Redacción (`renderInboxText`), agrupación (`mergeInboxData`) y ocurrencias |
| `src/server/modules/inbox/format.ts` (nuevo) | Vista previa de mensaje o archivo y total en dinero |
| `src/server/modules/inbox/record.ts` (nuevo) | Guardar avisos con agrupación, resolver grupos y aplicar efectos |
| `src/server/modules/inbox/audience.ts` (nuevo) | Contexto del expediente y grupos de destinatarios por permiso |
| `src/server/modules/inbox/paths.ts` (nuevo) | Enlaces de staff y del portal |
| `src/server/modules/inbox/rules/types.ts` (nuevo) | `DomainEventInput` |
| `src/server/modules/inbox/rules/index.ts` (nuevo) | Despacho de reglas por `eventType` |
| `src/server/modules/inbox/rules/requests.ts`, `messages.ts`, `quotes.ts`, `projects.ts`, `deliveries.ts` (nuevos) | Reglas por dominio |
| `src/server/modules/inbox/domain-events.ts` (nuevo) | `recordDomainEvent`, `notifyInbox` y `withInboxSavepoint` |
| `src/server/modules/inbox/service.ts` (nuevo) | Lista, resumen, contadores y marcar como leído, con el alcance vigente |
| `src/server/auth/session-actor.ts` (nuevo) | `requireSessionActor` (empleado o cliente) |
| `src/app/api/notifications/route.ts`, `summary/route.ts`, `read/route.ts` (nuevos) | API de la bandeja |

**Servidor: módulo `notifications` (correo)**

| Archivo | Responsabilidad |
|---|---|
| `src/server/modules/notifications/paths.ts` (nuevo) | `requestWorkspaceNotificationPath`, sacado de `event-resolver.ts` |
| `src/server/modules/notifications/event-resolver.ts`, `templates.ts`, `dispatcher.ts`, `worker.ts` | Correcciones de correo y dos plantillas nuevas |
| `src/server/modules/notifications/delivery-inbox.ts` (nuevo) | Pasa a la bandeja un correo a cliente fallido o recuperado |

**Emisores que pasan a `recordDomainEvent` o `notifyInbox`**
- Solicitudes, mensajería, archivos, cotizaciones, aprobaciones, aceptación, proyectos, equipo y catálogo (precios).

**Cliente**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/inbox-client.ts` (nuevo) | Tipos, llamadas a la API, agrupación por día, filtros y título con contador |
| `src/components/inbox/InboxProvider.tsx` (nuevo) | Estado compartido, consulta de respaldo, título "(N)" y marcar como leído |
| `src/components/inbox/NotificationBell.tsx`, `NotificationItem.tsx`, `inbox-visuals.ts`, `SinceLastVisitBanner.tsx`, `inbox.css` (nuevos) | Campana, panel, fila, íconos, banner del portal y estilos |
| `src/components/StaffInboxPanel.tsx` (nuevo) | Página `/staff/notifications` |
| `src/components/StaffEmailDeliveriesPanel.tsx` | Antes `StaffNotificationsPanel.tsx`; vive en `/staff/notifications/deliveries` |
| `src/app/staff/layout.tsx`, `src/app/portal/layout.tsx`, `StaffHeader.tsx`, `private/PrivateShellChrome.tsx`, `private/navigation.ts`, `ClientPortalPanel.tsx`, `StaffRequestsPanel.tsx`, `RequestWorkspaceDetailV2.tsx`, `StaffDashboardPanel.tsx`, `src/server/private-shell.ts` | Integración |

**Pruebas nuevas**
- `tests/integration/inbox-*.test.ts`
- `tests/unit/inbox-*.test.ts`
- `tests/inbox.spec.ts`

---

### Task 1: Tabla `inbox_notifications`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260929010000_inbox_notifications/migration.sql`
- Test: `tests/integration/inbox-schema.test.ts`

**Interfaces:**
- Produce el modelo Prisma `InboxNotification` (`prisma.inboxNotification`) y el enum `InboxPriority` (`'URGENT' | 'HIGH' | 'NORMAL' | 'INFO'`).
- El índice único parcial `inbox_notifications_open_group` es la base de la agrupación de la tarea 3.

- [ ] **Step 1: Escribir la prueba de esquema (falla porque la tabla no existe)**

Crear `tests/integration/inbox-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';

describe('inbox notifications schema', () => {
  it('keeps one open notification per recipient and group, validates its shape and cascades with its recipient', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const user = await prisma.user.create({ data: { email: `inbox-schema-${suffix}@example.test`, emailNormalized: `inbox-schema-${suffix}@example.test`, displayName: 'Inbox schema', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const base = { recipientId: user.id, kind: 'customer.activity', priority: 'HIGH' as const, groupKey: `activity:schema-${suffix}`, title: 'Aviso de prueba', actionPath: '/staff/requests' };

    try {
      const first = await prisma.inboxNotification.create({ data: base });
      // Un solo aviso abierto por persona y grupo.
      await expect(prisma.inboxNotification.create({ data: base })).rejects.toThrow();
      // Leído ya no cuenta como abierto: la siguiente actividad abre otro.
      await prisma.inboxNotification.update({ where: { id: first.id }, data: { readAt: new Date() } });
      const second = await prisma.inboxNotification.create({ data: base });
      expect(second.id).not.toBe(first.id);
      // Resuelto tampoco cuenta como abierto.
      await prisma.inboxNotification.update({ where: { id: second.id }, data: { resolvedAt: new Date(), resolvedNote: 'Tomada por QA' } });
      await expect(prisma.inboxNotification.create({ data: base })).resolves.toMatchObject({ occurrences: 1, actionRequired: false });
      // Enlaces sólo internos, tipos con formato de catálogo, nota de resolución sólo si está resuelto.
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, actionPath: 'https://evil.example' } })).rejects.toThrow();
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, actionPath: '//evil.example' } })).rejects.toThrow();
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, kind: 'No Es Un Tipo' } })).rejects.toThrow();
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, resolvedNote: 'Sin fecha' } })).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
    expect(await prisma.inboxNotification.count({ where: { recipientId: user.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-schema.test.ts`
Expected: FAIL. TypeScript o el runtime reporta que `prisma.inboxNotification` no existe.

- [ ] **Step 3: Agregar el modelo a `prisma/schema.prisma`**

Justo después del bloque `enum NotificationDeliveryStatus { … }`:

```prisma
/// Prioridad de un aviso de la bandeja (spec 2026-09-29 §5.3): decide flash, sonido y contador.
enum InboxPriority {
  URGENT
  HIGH
  NORMAL
  INFO
}
```

Justo después del bloque `model NotificationDelivery { … }`:

```prisma
/// Bandeja de avisos por persona (spec 2026-09-29 §1). El texto se guarda ya redactado y `data` sólo
/// lleva los campos permitidos para su `kind` (src/server/modules/inbox/kinds.ts). La agrupación usa el
/// índice único parcial `inbox_notifications_open_group` (migración 20260929010000): un solo aviso
/// abierto (sin leer ni resolver) por persona y `groupKey`. `lastActivityAt` ordena la bandeja; leer o
/// resolver no reordena. `updatedAt` es el cursor de reanudación del canal en vivo (bloque 2).
model InboxNotification {
  id             String        @id @default(uuid()) @db.Uuid
  recipientId    String        @db.Uuid
  kind           String        @db.VarChar(80)
  priority       InboxPriority
  groupKey       String?       @db.VarChar(200)
  quoteRequestId String?       @db.Uuid
  actorId        String?       @db.Uuid
  title          String        @db.VarChar(200)
  body           String?       @db.VarChar(400)
  actionPath     String        @db.VarChar(300)
  data           Json?
  occurrences    Int           @default(1)
  actionRequired Boolean       @default(false)
  createdAt      DateTime      @default(now()) @db.Timestamptz(3)
  lastActivityAt DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime      @updatedAt @db.Timestamptz(3)
  readAt         DateTime?     @db.Timestamptz(3)
  resolvedAt     DateTime?     @db.Timestamptz(3)
  resolvedNote   String?       @db.VarChar(160)
  recipient      User          @relation("InboxRecipient", fields: [recipientId], references: [id], onDelete: Cascade)
  actor          User?         @relation("InboxActor", fields: [actorId], references: [id], onDelete: SetNull)
  quoteRequest   QuoteRequest? @relation(fields: [quoteRequestId], references: [id], onDelete: Cascade)

  @@index([recipientId, lastActivityAt(sort: Desc)])
  @@index([recipientId, updatedAt])
  @@index([quoteRequestId])
  @@index([groupKey])
  @@map("inbox_notifications")
}
```

En `model User`, justo después de `notificationDeliveries          NotificationDelivery[]    @relation("NotificationRecipient")`:

```prisma
  inboxNotifications              InboxNotification[]       @relation("InboxRecipient")
  inboxNotificationsCaused        InboxNotification[]       @relation("InboxActor")
```

En `model QuoteRequest`, justo después de `project            Project?`:

```prisma
  inboxNotifications InboxNotification[]
```

- [ ] **Step 4: Escribir la migración**

Crear `prisma/migrations/20260929010000_inbox_notifications/migration.sql`:

```sql
-- Bandeja de avisos por persona (spec 2026-09-29-notificaciones-tiempo-real-design §1).
CREATE TYPE "InboxPriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'INFO');

CREATE TABLE "inbox_notifications" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "priority" "InboxPriority" NOT NULL,
    "groupKey" VARCHAR(200),
    "quoteRequestId" UUID,
    "actorId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(400),
    "actionPath" VARCHAR(300) NOT NULL,
    "data" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedNote" VARCHAR(160),
    CONSTRAINT "inbox_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_notifications_recipientId_lastActivityAt_idx" ON "inbox_notifications"("recipientId", "lastActivityAt" DESC);
CREATE INDEX "inbox_notifications_recipientId_updatedAt_idx" ON "inbox_notifications"("recipientId", "updatedAt");
CREATE INDEX "inbox_notifications_quoteRequestId_idx" ON "inbox_notifications"("quoteRequestId");
CREATE INDEX "inbox_notifications_groupKey_idx" ON "inbox_notifications"("groupKey");
-- Contador de la campana: sólo lo abierto.
CREATE INDEX "inbox_notifications_open_recipient_idx" ON "inbox_notifications"("recipientId") WHERE "readAt" IS NULL AND "resolvedAt" IS NULL;
-- Agrupación: un solo aviso abierto por persona y grupo. Dos transacciones concurrentes quedan
-- serializadas por este índice (INSERT … ON CONFLICT DO NOTHING en src/server/modules/inbox/record.ts).
CREATE UNIQUE INDEX "inbox_notifications_open_group" ON "inbox_notifications"("recipientId", "groupKey") WHERE "groupKey" IS NOT NULL AND "readAt" IS NULL AND "resolvedAt" IS NULL;

ALTER TABLE "inbox_notifications"
  ADD CONSTRAINT "inbox_notifications_kind_ck" CHECK ("kind" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  ADD CONSTRAINT "inbox_notifications_action_path_ck" CHECK ("actionPath" ~ '^/[^/]'),
  ADD CONSTRAINT "inbox_notifications_occurrences_ck" CHECK ("occurrences" >= 1),
  ADD CONSTRAINT "inbox_notifications_resolution_ck" CHECK ("resolvedNote" IS NULL OR "resolvedAt" IS NOT NULL);

ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Aplicar la migración y regenerar el cliente**

Run: `npx prisma validate && npx prisma migrate deploy && npx prisma generate`
Expected:
- "The schema at prisma/schema.prisma is valid".
- "Applying migration `20260929010000_inbox_notifications`".
- "Generated Prisma Client".

- [ ] **Step 6: Correr la prueba y confirmar que pasa**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-schema.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Typecheck y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add prisma/schema.prisma prisma/migrations/20260929010000_inbox_notifications tests/integration/inbox-schema.test.ts
git commit -m "feat(inbox): tabla de avisos por persona con agrupación por índice único parcial"
```

---

### Task 2: Catálogo de tipos y redacción

**Files:**
- Create: `src/server/modules/inbox/kinds.ts`
- Create: `src/server/modules/inbox/text.ts`
- Create: `src/server/modules/inbox/format.ts`
- Test: `tests/unit/inbox-text.test.ts`

**Interfaces:**
- Produce:
  - `INBOX_KINDS` y `type InboxKind`.
  - `type InboxPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'INFO'`.
  - `type InboxData`.
  - `isInboxKind(value: string): value is InboxKind`.
  - `sanitizeInboxData(kind: InboxKind, data: InboxData): InboxData`.
  - `INBOX_CUSTOMER_SAFE_KEYS`.
  - `renderInboxText(kind: InboxKind, data: InboxData): { title: string; body: string | null }`.
  - `mergeInboxData(kind, previous, next): { data: InboxData; changed: boolean }`.
  - `inboxOccurrences(kind, data, previous: number): number`.
  - `staffActivityTitle(actor, messages, files)` y `teamActivityTitle(messages, files)`.
  - `messagePreview(body: string): string`, `filePreview(fileName: string): string` y `totalLabel(totalMinor: bigint, currencyCode: string): string`.

- [ ] **Step 1: Escribir las pruebas unitarias**

Crear `tests/unit/inbox-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INBOX_CUSTOMER_SAFE_KEYS, INBOX_KINDS, isInboxKind, sanitizeInboxData, type InboxKind } from '@/server/modules/inbox/kinds';
import { inboxOccurrences, mergeInboxData, renderInboxText, staffActivityTitle, teamActivityTitle } from '@/server/modules/inbox/text';
import { filePreview, messagePreview, totalLabel } from '@/server/modules/inbox/format';

describe('inbox catalog', () => {
  it('only lets customer-facing kinds carry customer-safe data', () => {
    for (const [kind, definition] of Object.entries(INBOX_KINDS)) {
      if (definition.audience !== 'CUSTOMER') continue;
      for (const key of definition.dataKeys) expect(INBOX_CUSTOMER_SAFE_KEYS, `${kind}.${key}`).toContain(key);
    }
  });

  it('recognizes only catalog kinds', () => {
    expect(isInboxKind('customer.activity')).toBe(true);
    expect(isInboxKind('toString')).toBe(false);
    expect(isInboxKind('customer.unknown')).toBe(false);
  });

  it('drops fields a kind does not allow, trims text and rejects negative counts', () => {
    const cleaned = sanitizeInboxData('team.activity', { folio: '  OCQ-2026-000001 ', messages: -1, files: 2, reason: 'Nota interna que nunca debe llegar', preview: 'a'.repeat(400) });
    expect(cleaned).toEqual({ folio: 'OCQ-2026-000001', files: 2, preview: `${'a'.repeat(179)}…` });
  });
});

describe('inbox text', () => {
  it('describes grouped customer activity in plain language', () => {
    expect(staffActivityTitle('Laura Méndez', 1, 0)).toBe('Laura Méndez te escribió');
    expect(staffActivityTitle('Laura Méndez', 3, 0)).toBe('Laura Méndez te escribió 3 mensajes');
    expect(staffActivityTitle('Laura Méndez', 0, 1)).toBe('Laura Méndez subió un archivo');
    expect(staffActivityTitle('Laura Méndez', 1, 2)).toBe('Laura Méndez subió 2 archivos y dejó un mensaje');
    expect(staffActivityTitle('Laura Méndez', 2, 1)).toBe('Laura Méndez subió un archivo y dejó 2 mensajes');
    expect(teamActivityTitle(1, 0)).toBe('El equipo OCPOOL te escribió');
    expect(teamActivityTitle(2, 1)).toBe('El equipo OCPOOL te escribió 2 mensajes y compartió un archivo');
    expect(teamActivityTitle(0, 3)).toBe('El equipo OCPOOL compartió 3 archivos');
  });

  it('renders every kind with a bounded title', () => {
    for (const kind of Object.keys(INBOX_KINDS) as InboxKind[]) {
      const text = renderInboxText(kind, { folio: 'OCQ-2026-000123', clientName: 'Juan Pérez', actorName: 'Ana Ruiz', versionNumber: 2, messages: 1, itemName: 'Bomba', priceListName: 'Lista MXN', projectFolio: 'OCP-2026-0001' });
      expect(text.title.length, kind).toBeGreaterThan(5);
      expect(text.title.length, kind).toBeLessThanOrEqual(200);
      expect(text.body === null || text.body.length <= 400, kind).toBe(true);
    }
    expect(renderInboxText('quote.accepted', { actorName: 'Juan Pérez', versionNumber: 2, totalLabel: 'Total aceptado: MXN 485,000.00' })).toEqual({ title: 'Juan Pérez aceptó la propuesta V2', body: 'Total aceptado: MXN 485,000.00' });
    expect(renderInboxText('request.new_unassigned', { projectType: 'Alberca con jacuzzi', location: 'Monterrey', clientName: 'Sofía Garza', folio: 'OCQ-2026-000130' })).toEqual({ title: 'Nueva solicitud: Alberca con jacuzzi en Monterrey', body: 'Sofía Garza · OCQ-2026-000130' });
    expect(renderInboxText('approval.resolved', { actorName: 'Pedro', approvalType: 'DISCOUNT', approvalStatus: 'REJECTED', folio: 'OCQ-1', reason: 'Excede el margen' }).title).toBe('Pedro rechazó tu descuento en OCQ-1');
  });

  it('adds up grouped activity and keeps the latest preview', () => {
    const merged = mergeInboxData('customer.activity', { messages: 1, files: 0, preview: '“Hola”' }, { messages: 0, files: 1, preview: 'Archivo: plano.pdf' });
    expect(merged).toEqual({ changed: true, data: { messages: 1, files: 1, preview: 'Archivo: plano.pdf' } });
    expect(inboxOccurrences('customer.activity', merged.data, 1)).toBe(2);
  });

  it('unions pending-price requests idempotently', () => {
    const first = mergeInboxData('price.pending', { requestIds: ['a'], requestFolios: ['OCQ-A'] }, { requestIds: ['b'], requestFolios: ['OCQ-B'] });
    expect(first).toEqual({ changed: true, data: { requestIds: ['a', 'b'], requestFolios: ['OCQ-A', 'OCQ-B'] } });
    expect(mergeInboxData('price.pending', first.data, { requestIds: ['a'], requestFolios: ['OCQ-A'] }).changed).toBe(false);
    expect(inboxOccurrences('price.pending', first.data, 1)).toBe(2);
    expect(renderInboxText('price.pending', { itemName: 'Bomba', priceListName: 'Lista MXN', requestFolios: ['OCQ-A', 'OCQ-B'] }).body).toBe('Lo esperan 2 propuestas: OCQ-A, OCQ-B');
  });

  it('formats previews and totals', () => {
    expect(messagePreview('  Hola\n\nequipo  ')).toBe('“Hola equipo”');
    expect(messagePreview('x'.repeat(300)).length).toBeLessThanOrEqual(162);
    expect(filePreview('plano.pdf')).toBe('Archivo: plano.pdf');
    expect(totalLabel(48_500_000n, 'MXN')).toBe('MXN 485,000.00');
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run tests/unit/inbox-text.test.ts`
Expected: FAIL. Vitest reporta "Failed to resolve import `@/server/modules/inbox/kinds`".

- [ ] **Step 3: Implementar `kinds.ts`**

Crear `src/server/modules/inbox/kinds.ts`:

```ts
/**
 * Catálogo cerrado de avisos de la bandeja (spec 2026-09-29 §2.2 y §2.3). Cada tipo declara a quién
 * va (equipo o cliente), su ícono y los ÚNICOS campos de `data` que puede guardar: nada fuera de esta
 * lista llega a la base, así que un aviso nunca arrastra contenido interno por accidente.
 */
export const INBOX_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'INFO'] as const;
export type InboxPriority = (typeof INBOX_PRIORITIES)[number];
export type InboxAudience = 'STAFF' | 'CUSTOMER';

export type InboxData = Partial<{
  folio: string;
  clientName: string;
  actorName: string;
  projectType: string;
  location: string;
  messages: number;
  files: number;
  preview: string;
  versionNumber: number;
  totalLabel: string;
  reason: string;
  outcome: string;
  approvalType: string;
  approvalStatus: string;
  itemName: string;
  priceListName: string;
  requestIds: string[];
  requestFolios: string[];
  projectFolio: string;
  ownerName: string;
  fromName: string;
  toName: string;
  requestsCount: number;
  projectsCount: number;
  templateLabel: string;
}>;

export type InboxDataKey = keyof InboxData;

type InboxKindDefinition = Readonly<{ audience: InboxAudience; dataKeys: readonly InboxDataKey[] }>;

export const INBOX_KINDS = {
  'request.new_unassigned': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'projectType', 'location'] },
  'customer.activity': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'messages', 'files', 'preview'] },
  'quote.changes_requested': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'versionNumber', 'messages', 'preview'] },
  'quote.accepted': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'versionNumber', 'totalLabel'] },
  'request.assigned_to_you': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'projectType', 'location'] },
  'request.unassigned_from_you': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'toName'] },
  'approval.requested': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'versionNumber', 'approvalType'] },
  'approval.resolved': { audience: 'STAFF', dataKeys: ['folio', 'actorName', 'versionNumber', 'approvalType', 'approvalStatus', 'reason'] },
  'quote.returned': { audience: 'STAFF', dataKeys: ['folio', 'actorName', 'versionNumber', 'reason', 'outcome'] },
  'price.pending': { audience: 'STAFF', dataKeys: ['itemName', 'priceListName', 'requestIds', 'requestFolios'] },
  'price.assigned': { audience: 'STAFF', dataKeys: ['folio', 'itemName', 'priceListName', 'actorName'] },
  'note.internal': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'messages', 'preview'] },
  'project.assigned': { audience: 'STAFF', dataKeys: ['projectFolio', 'folio', 'clientName', 'actorName'] },
  'project.created': { audience: 'STAFF', dataKeys: ['projectFolio', 'folio', 'clientName', 'actorName', 'ownerName'] },
  'team.work_reassigned': { audience: 'STAFF', dataKeys: ['fromName', 'actorName', 'requestsCount', 'projectsCount'] },
  'email.delivery_failed': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'templateLabel'] },
  'request.closed': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName', 'reason'] },
  'request.reopened': { audience: 'STAFF', dataKeys: ['folio', 'clientName', 'actorName'] },
  'team.activity': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType', 'messages', 'files', 'preview'] },
  'request.information_needed': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType', 'preview'] },
  'quote.ready': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType', 'versionNumber', 'totalLabel'] },
  'project.started': { audience: 'CUSTOMER', dataKeys: ['projectFolio', 'folio', 'ownerName'] },
  'request.received': { audience: 'CUSTOMER', dataKeys: ['folio', 'projectType'] },
} as const satisfies Record<string, InboxKindDefinition>;

export type InboxKind = keyof typeof INBOX_KINDS;

/** Lo único que un aviso para el cliente puede guardar. La prueba del catálogo lo hace cumplir. */
export const INBOX_CUSTOMER_SAFE_KEYS: readonly InboxDataKey[] = ['folio', 'projectType', 'messages', 'files', 'preview', 'versionNumber', 'totalLabel', 'projectFolio', 'ownerName'];

export function isInboxKind(value: string): value is InboxKind {
  return Object.prototype.hasOwnProperty.call(INBOX_KINDS, value);
}

export function inboxAudience(kind: InboxKind): InboxAudience {
  return INBOX_KINDS[kind].audience;
}

const NUMBER_KEYS: ReadonlySet<InboxDataKey> = new Set(['messages', 'files', 'versionNumber', 'requestsCount', 'projectsCount']);
const LIST_KEYS: ReadonlySet<InboxDataKey> = new Set(['requestIds', 'requestFolios']);
const TEXT_LIMITS: Partial<Record<InboxDataKey, number>> = { reason: 300 };
const DEFAULT_TEXT_LIMIT = 180;
const MAX_LIST_ENTRIES = 50;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function cleanText(value: string, limit: number): string | undefined {
  const flat = value.replace(CONTROL_CHARACTERS, '').replace(/\s+/gu, ' ').trim();
  if (!flat) return undefined;
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

/** Deja sólo los campos permitidos del tipo, con textos acotados y números enteros no negativos. */
export function sanitizeInboxData(kind: InboxKind, data: InboxData): InboxData {
  const result: Record<string, unknown> = {};
  const source = data as Record<string, unknown>;
  for (const key of INBOX_KINDS[kind].dataKeys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (NUMBER_KEYS.has(key)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) result[key] = value;
      continue;
    }
    if (LIST_KEYS.has(key)) {
      if (Array.isArray(value)) result[key] = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length <= 64).slice(0, MAX_LIST_ENTRIES);
      continue;
    }
    if (typeof value === 'string') {
      const text = cleanText(value, TEXT_LIMITS[key] ?? DEFAULT_TEXT_LIMIT);
      if (text) result[key] = text;
    }
  }
  return result as InboxData;
}
```

- [ ] **Step 4: Implementar `format.ts`**

Crear `src/server/modules/inbox/format.ts`:

```ts
import { moneyLabel } from '@/lib/money';

const PREVIEW_LIMIT = 160;

/** Vista previa de un mensaje: un renglón, entre comillas tipográficas, sin cortar a media palabra si se puede. */
export function messagePreview(body: string): string {
  const flat = body.replace(/\s+/gu, ' ').trim();
  if (flat.length <= PREVIEW_LIMIT) return `“${flat}”`;
  const cut = flat.slice(0, PREVIEW_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `“${(lastSpace > PREVIEW_LIMIT * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…”`;
}

export function filePreview(fileName: string): string {
  return `Archivo: ${fileName.replace(/\s+/gu, ' ').trim()}`;
}

/** Mismo formato que el portal ("MXN 485,000.00"), para que el aviso y la pantalla digan lo mismo. */
export function totalLabel(totalMinor: bigint, currencyCode: string): string {
  return moneyLabel(totalMinor, currencyCode);
}
```

- [ ] **Step 5: Implementar `text.ts`**

Crear `src/server/modules/inbox/text.ts`:

```ts
import type { InboxData, InboxKind } from './kinds';

export type InboxText = Readonly<{ title: string; body: string | null }>;
export type InboxMergeResult = Readonly<{ data: InboxData; changed: boolean }>;

const TITLE_LIMIT = 200;
const BODY_LIMIT = 400;
const APPROVAL_TYPE_LABELS: Readonly<Record<string, string>> = { DISCOUNT: 'descuento', SPECIAL_CONCEPT: 'concepto especial', PRICE_OVERRIDE: 'ajuste de precio' };

function fit(value: string, limit: number): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function count(value: number | undefined): number {
  return typeof value === 'number' && value > 0 ? value : 0;
}

function quantity(amount: number, one: string, many: string): string {
  return amount === 1 ? one : `${amount} ${many}`;
}

function versionLabel(data: InboxData): string {
  return data.versionNumber ? ` V${data.versionNumber}` : '';
}

function joinParts(parts: ReadonlyArray<string | undefined | null>): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(' · ') : null;
}

function approvalTypeLabel(data: InboxData): string {
  return APPROVAL_TYPE_LABELS[data.approvalType ?? ''] ?? 'ajuste';
}

export function staffActivityTitle(actor: string, messages: number, files: number): string {
  if (files > 0 && messages > 0) return `${actor} subió ${quantity(files, 'un archivo', 'archivos')} y dejó ${quantity(messages, 'un mensaje', 'mensajes')}`;
  if (files > 0) return `${actor} subió ${quantity(files, 'un archivo', 'archivos')}`;
  return messages > 1 ? `${actor} te escribió ${messages} mensajes` : `${actor} te escribió`;
}

export function teamActivityTitle(messages: number, files: number): string {
  const team = 'El equipo OCPOOL';
  if (files > 0 && messages > 0) return `${team} te escribió ${quantity(messages, 'un mensaje', 'mensajes')} y compartió ${quantity(files, 'un archivo', 'archivos')}`;
  if (files > 0) return `${team} compartió ${quantity(files, 'un archivo', 'archivos')}`;
  return messages > 1 ? `${team} te escribió ${messages} mensajes` : `${team} te escribió`;
}

function pendingPriceBody(data: InboxData): string | null {
  const folios = data.requestFolios ?? [];
  if (folios.length === 0) return null;
  if (folios.length === 1) return `Lo espera ${folios[0]}`;
  return `Lo esperan ${folios.length} propuestas: ${folios.slice(0, 3).join(', ')}${folios.length > 3 ? '…' : ''}`;
}

function draft(kind: InboxKind, data: InboxData): { title: string; body: string | null } {
  const actor = data.actorName ?? 'Alguien del equipo';
  const customer = data.actorName ?? data.clientName ?? 'El cliente';
  const folio = data.folio ?? 'el expediente';
  switch (kind) {
    case 'request.new_unassigned':
      return { title: `Nueva solicitud: ${data.projectType ?? 'proyecto'} en ${data.location ?? 'ubicación por confirmar'}`, body: joinParts([data.clientName, data.folio]) };
    case 'customer.activity':
      return { title: staffActivityTitle(customer, count(data.messages), count(data.files)), body: data.preview ?? null };
    case 'quote.changes_requested':
      return { title: `${customer} pidió cambios a la propuesta${versionLabel(data)}`, body: data.preview ?? null };
    case 'quote.accepted':
      return { title: `${customer} aceptó la propuesta${versionLabel(data)}`, body: data.totalLabel ?? null };
    case 'request.assigned_to_you':
      return { title: `${actor} te asignó ${folio}`, body: joinParts([data.projectType && data.location ? `${data.projectType} en ${data.location}` : data.projectType, data.clientName]) };
    case 'request.unassigned_from_you':
      return { title: data.toName ? `${actor} reasignó ${folio} a ${data.toName}` : `${actor} quitó ${folio} de tu cargo`, body: data.clientName ?? null };
    case 'approval.requested':
      return { title: `${actor} pide aprobar un ${approvalTypeLabel(data)} en ${folio}`, body: joinParts([data.versionNumber ? `Propuesta V${data.versionNumber}` : undefined, data.clientName]) };
    case 'approval.resolved':
      return data.approvalStatus === 'APPROVED'
        ? { title: `${actor} aprobó tu ${approvalTypeLabel(data)} en ${folio}`, body: `Ya puedes enviar la propuesta${versionLabel(data)}` }
        : { title: `${actor} rechazó tu ${approvalTypeLabel(data)} en ${folio}`, body: data.reason ? `Motivo: ${data.reason}` : null };
    case 'quote.returned':
      return {
        title: data.outcome === 'REJECTED' ? `${actor} rechazó la propuesta${versionLabel(data)} de ${folio}` : `${actor} devolvió a borrador la propuesta${versionLabel(data)} de ${folio}`,
        body: data.reason ? `Motivo: ${data.reason}` : null,
      };
    case 'price.pending':
      return { title: `${data.itemName ?? 'Un concepto'} necesita precio en ${data.priceListName ?? 'su lista'}`, body: pendingPriceBody(data) };
    case 'price.assigned':
      return { title: `${data.itemName ?? 'Un concepto'} ya tiene precio en ${data.priceListName ?? 'su lista'}`, body: data.folio ? `Tu propuesta ${data.folio} puede continuar` : null };
    case 'note.internal':
      return { title: count(data.messages) > 1 ? `${actor} dejó ${count(data.messages)} notas internas en ${folio}` : `${actor} dejó una nota interna en ${folio}`, body: data.preview ?? null };
    case 'project.assigned':
      return { title: `Te asignaron el proyecto ${data.projectFolio ?? ''}`, body: joinParts([data.clientName, data.folio]) };
    case 'project.created':
      return { title: `${actor} creó el proyecto ${data.projectFolio ?? ''}`, body: joinParts([data.clientName, data.ownerName ? `Responsable: ${data.ownerName}` : 'Sin responsable']) };
    case 'team.work_reassigned': {
      const parts = [
        count(data.requestsCount) ? quantity(count(data.requestsCount), 'un expediente', 'expedientes') : undefined,
        count(data.projectsCount) ? quantity(count(data.projectsCount), 'un proyecto', 'proyectos') : undefined,
      ].filter(Boolean).join(' y ');
      return { title: `Recibiste ${parts || 'trabajo'} de ${data.fromName ?? 'otra persona'}`, body: data.actorName ? `Asignado por ${data.actorName}` : null };
    }
    case 'email.delivery_failed':
      return { title: `No se pudo entregar un correo a ${data.clientName ?? 'un cliente'}`, body: joinParts([data.templateLabel, data.folio, 'Revisa el correo del contacto']) };
    case 'request.closed':
      return { title: `${actor} cerró ${folio}`, body: data.reason ? `Motivo: ${data.reason}` : data.clientName ?? null };
    case 'request.reopened':
      return { title: `${actor} reabrió ${folio}`, body: data.clientName ?? null };
    case 'team.activity':
      return { title: teamActivityTitle(count(data.messages), count(data.files)), body: data.preview ?? null };
    case 'request.information_needed':
      return { title: `Necesitamos unos datos para continuar con ${data.projectType ?? 'tu proyecto'}`, body: data.preview ?? null };
    case 'quote.ready':
      return { title: `Tu propuesta${versionLabel(data)} está lista`, body: joinParts([data.totalLabel, data.folio]) };
    case 'project.started':
      return { title: `Tu proyecto ${data.projectFolio ?? ''} arrancó`, body: data.ownerName ? `Tu responsable es ${data.ownerName}` : 'Te contactaremos para coordinar el arranque' };
    case 'request.received':
      return { title: `Recibimos tu solicitud ${data.folio ?? ''}`, body: data.projectType ?? null };
  }
}

export function renderInboxText(kind: InboxKind, data: InboxData): InboxText {
  const text = draft(kind, data);
  return { title: fit(text.title, TITLE_LIMIT), body: text.body ? fit(text.body, BODY_LIMIT) : null };
}

/** Suma la actividad nueva al aviso abierto del mismo grupo. `changed: false` = no hay nada que escribir. */
export function mergeInboxData(kind: InboxKind, previous: InboxData, next: InboxData): InboxMergeResult {
  switch (kind) {
    case 'customer.activity':
    case 'team.activity':
    case 'note.internal':
    case 'quote.changes_requested':
      return { changed: true, data: { ...previous, ...next, messages: count(previous.messages) + count(next.messages), files: count(previous.files) + count(next.files), preview: next.preview ?? previous.preview } };
    case 'price.pending': {
      const requestIds = [...(previous.requestIds ?? [])];
      const requestFolios = [...(previous.requestFolios ?? [])];
      let changed = false;
      (next.requestIds ?? []).forEach((requestId, index) => {
        if (requestIds.includes(requestId)) return;
        requestIds.push(requestId);
        const folio = next.requestFolios?.[index];
        if (folio) requestFolios.push(folio);
        changed = true;
      });
      return { changed, data: { ...previous, requestIds, requestFolios } };
    }
    default:
      return { changed: true, data: { ...previous, ...next } };
  }
}

export function inboxOccurrences(kind: InboxKind, data: InboxData, previous: number): number {
  if (kind === 'price.pending') return Math.max(1, data.requestIds?.length ?? 1);
  return previous + 1;
}
```

- [ ] **Step 6: Correr las pruebas**

Run: `npx vitest run tests/unit/inbox-text.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

```bash
git add src/server/modules/inbox/kinds.ts src/server/modules/inbox/text.ts src/server/modules/inbox/format.ts tests/unit/inbox-text.test.ts
git commit -m "feat(inbox): catálogo cerrado de avisos y redacción agrupada"
```

---

### Task 3: Guardar avisos con agrupación, resolución y señal en vivo

**Files:**
- Create: `src/server/realtime/publish.ts`
- Create: `src/server/modules/inbox/record.ts`
- Test: `tests/integration/inbox-record.test.ts`

**Interfaces:**
- Consumes (Task 2): `INBOX_KINDS`, `sanitizeInboxData`, `renderInboxText`, `mergeInboxData`, `inboxOccurrences`, `InboxKind`, `InboxPriority` y `InboxData`.
- Produces:
  - `REALTIME_CHANNEL = 'ocpool_realtime'`.
  - `type RealtimeSignal = { t: 'n'; u: string; id: string; m: 'created' | 'updated' | 'resolved' } | { t: 'u'; u: string }`.
  - `publishRealtime(client, signal): Promise<void>`.
  - `type InboxIntent = { recipientId: string; kind: InboxKind; priority: InboxPriority; quoteRequestId: string | null; actorId: string | null; groupKey: string | null; actionPath: string; actionRequired: boolean; data: InboxData }`.
  - `type InboxResolution = { groupKey: string; note: string; actorId?: string | null; actorNote?: string }`.
  - `type InboxEffects = { intents: readonly InboxIntent[]; resolutions: readonly InboxResolution[] }`.
  - `NO_INBOX_EFFECTS`.
  - `dedupeInboxIntents(intents): InboxIntent[]`.
  - `recordInboxIntents(tx, intents, now): Promise<RecordedInboxNotification[]>`.
  - `resolveInboxGroups(tx, resolutions, now)`.
  - `applyInboxEffects(tx, effects, now)`.

- [ ] **Step 1: Escribir la prueba de integración**

Crear `tests/integration/inbox-record.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { applyInboxEffects, recordInboxIntents, resolveInboxGroups, type InboxIntent } from '@/server/modules/inbox/record';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('inbox recording', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const received: string[] = [];
  let listener: pg.Client;
  let recipientId = '';
  let otherRecipientId = '';

  const intent = (overrides: Partial<InboxIntent> = {}): InboxIntent => ({
    recipientId,
    kind: 'customer.activity',
    priority: 'HIGH',
    quoteRequestId: null,
    actorId: null,
    groupKey: `activity:record-${suffix}`,
    actionPath: '/staff/requests',
    actionRequired: false,
    data: { actorName: 'Laura Méndez', folio: 'OCQ-2026-000118', messages: 1, files: 0, preview: '“Hola”' },
    ...overrides,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    listener = new pg.Client({ connectionString: DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => { if (message.payload) received.push(message.payload); });
    const [first, second] = await Promise.all([
      prisma.user.create({ data: { email: `inbox-record-a-${suffix}@example.test`, emailNormalized: `inbox-record-a-${suffix}@example.test`, displayName: 'Record A', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `inbox-record-b-${suffix}@example.test`, emailNormalized: `inbox-record-b-${suffix}@example.test`, displayName: 'Record B', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    recipientId = first.id;
    otherRecipientId = second.id;
  });

  afterAll(async () => {
    await listener?.end();
    await prisma.user.deleteMany({ where: { id: { in: [recipientId, otherRecipientId].filter(Boolean) } } });
  });

  it('writes nothing and signals nothing when the transaction rolls back', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await recordInboxIntents(tx, [intent()], new Date());
      throw new Error('rollback on purpose');
    })).rejects.toThrow('rollback on purpose');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received.filter((payload) => payload.includes(recipientId))).toHaveLength(0);
    expect(await prisma.inboxNotification.count({ where: { recipientId } })).toBe(0);
  });

  it('groups open activity, signals on commit and starts a new notification once read', async () => {
    const now = new Date();
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], now));
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent({ data: { actorName: 'Laura Méndez', folio: 'OCQ-2026-000118', messages: 0, files: 1, preview: 'Archivo: plano.pdf' } })], new Date(now.getTime() + 1000)));
    const [grouped] = await prisma.inboxNotification.findMany({ where: { recipientId } });
    expect(grouped).toMatchObject({ occurrences: 2, title: 'Laura Méndez subió un archivo y dejó un mensaje', body: 'Archivo: plano.pdf' });
    await waitFor(() => received.filter((payload) => payload.includes(grouped.id)).length >= 2);
    expect(received.map((payload) => JSON.parse(payload) as { m?: string }).filter((signal) => signal.m === 'updated').length).toBeGreaterThanOrEqual(1);

    await prisma.inboxNotification.update({ where: { id: grouped.id }, data: { readAt: new Date() } });
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], new Date(now.getTime() + 2000)));
    expect(await prisma.inboxNotification.count({ where: { recipientId } })).toBe(2);
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('serializes two concurrent transactions into one open notification', async () => {
    const now = new Date();
    await Promise.all([
      prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], now)),
      prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], now)),
    ]);
    const rows = await prisma.inboxNotification.findMany({ where: { recipientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrences: 2, title: 'Laura Méndez te escribió 2 mensajes' });
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('keeps the highest priority when a rule targets the same person twice', async () => {
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent({ kind: 'quote.changes_requested', priority: 'NORMAL', groupKey: `changes:${suffix}` }), intent({ kind: 'quote.changes_requested', priority: 'URGENT', groupKey: `changes:${suffix}` })], new Date()));
    const rows = await prisma.inboxNotification.findMany({ where: { recipientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].priority).toBe('URGENT');
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('does not rewrite a pending-price notice when the same draft saves again', async () => {
    const pending = intent({ kind: 'price.pending', priority: 'NORMAL', groupKey: `price:list-${suffix}:item`, actionRequired: true, actionPath: '/staff/catalog?tab=pending-prices', data: { itemName: 'Bomba', priceListName: 'Lista MXN', requestIds: ['req-1'], requestFolios: ['OCQ-1'] } });
    const first = await prisma.$transaction((tx) => recordInboxIntents(tx, [pending], new Date()));
    const second = await prisma.$transaction((tx) => recordInboxIntents(tx, [pending], new Date()));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await prisma.inboxNotification.findFirst({ where: { recipientId } })).toMatchObject({ occurrences: 1 });
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('resolves a group for everyone and speaks to the actor in second person', async () => {
    const pool = (userId: string): InboxIntent => intent({ recipientId: userId, kind: 'request.new_unassigned', groupKey: `pool:${suffix}`, actionRequired: true, data: { folio: 'OCQ-1', projectType: 'Alberca', location: 'Monterrey' } });
    await prisma.$transaction((tx) => recordInboxIntents(tx, [pool(recipientId), pool(otherRecipientId)], new Date()));
    await prisma.$transaction((tx) => resolveInboxGroups(tx, [{ groupKey: `pool:${suffix}`, note: 'Tomada por Record A', actorId: recipientId, actorNote: 'La tomaste' }], new Date()));
    const rows = await prisma.inboxNotification.findMany({ where: { groupKey: `pool:${suffix}` } });
    expect(rows.find((row) => row.recipientId === recipientId)).toMatchObject({ resolvedNote: 'La tomaste' });
    expect(rows.find((row) => row.recipientId === otherRecipientId)).toMatchObject({ resolvedNote: 'Tomada por Record A' });
    expect(rows.every((row) => row.resolvedAt !== null)).toBe(true);
    await prisma.inboxNotification.deleteMany({ where: { groupKey: `pool:${suffix}` } });
  });

  it('applies resolutions before new intents', async () => {
    const now = new Date();
    await prisma.$transaction((tx) => applyInboxEffects(tx, { intents: [intent({ groupKey: `changes:order-${suffix}`, kind: 'quote.changes_requested' })], resolutions: [] }, now));
    await prisma.$transaction((tx) => applyInboxEffects(tx, { intents: [intent({ groupKey: `changes:order-${suffix}`, kind: 'quote.changes_requested' })], resolutions: [{ groupKey: `changes:order-${suffix}`, note: 'Se envió la propuesta V2' }] }, now));
    const rows = await prisma.inboxNotification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.resolvedAt === null)).toHaveLength(1);
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-record.test.ts`
Expected: FAIL. Vitest reporta "Failed to resolve import `@/server/modules/inbox/record`".

- [ ] **Step 3: Implementar `publish.ts`**

Crear `src/server/realtime/publish.ts`:

```ts
import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';

/** Canal único de tiempo real (spec 2026-09-29 §4.1). El payload lleva sólo identificadores, nunca contenido. */
export const REALTIME_CHANNEL = 'ocpool_realtime';

export type RealtimeSignal =
  | Readonly<{ t: 'n'; u: string; id: string; m: 'created' | 'updated' | 'resolved' }>
  | Readonly<{ t: 'u'; u: string }>;

type SqlClient = PrismaClient | Prisma.TransactionClient;

const MAX_PAYLOAD_LENGTH = 7_900;

export function encodeRealtimeSignal(signal: RealtimeSignal): string {
  const payload = JSON.stringify(signal);
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error('Realtime signal is too large.');
  return payload;
}

/**
 * Dentro de una transacción, PostgreSQL entrega el NOTIFY sólo al confirmar: si la transacción se revierte
 * no sale nada, así que nunca se avisa de algo que no pasó. Fuera de una transacción se entrega de inmediato.
 * `$executeRaw` (y no `$queryRaw`) porque `pg_notify` devuelve `void`, que Prisma no deserializa.
 */
export async function publishRealtime(client: SqlClient, signal: RealtimeSignal): Promise<void> {
  await client.$executeRaw(Prisma.sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${encodeRealtimeSignal(signal)})`);
}
```

- [ ] **Step 4: Implementar `record.ts`**

Crear `src/server/modules/inbox/record.ts`:

```ts
import { Prisma } from '@/generated/prisma/client';
import { publishRealtime } from '@/server/realtime/publish';
import { sanitizeInboxData, type InboxData, type InboxKind, type InboxPriority } from './kinds';
import { inboxOccurrences, mergeInboxData, renderInboxText } from './text';

export type InboxIntent = Readonly<{
  recipientId: string;
  kind: InboxKind;
  priority: InboxPriority;
  quoteRequestId: string | null;
  actorId: string | null;
  groupKey: string | null;
  actionPath: string;
  actionRequired: boolean;
  data: InboxData;
}>;

/** Cierra los avisos abiertos de un grupo (p. ej. "Tomada por Ana"). `actorNote` es lo que ve quien lo cerró. */
export type InboxResolution = Readonly<{ groupKey: string; note: string; actorId?: string | null; actorNote?: string }>;

export type InboxEffects = Readonly<{ intents: readonly InboxIntent[]; resolutions: readonly InboxResolution[] }>;

export const NO_INBOX_EFFECTS: InboxEffects = Object.freeze({ intents: [], resolutions: [] });

export type RecordedInboxNotification = Readonly<{ id: string; recipientId: string; mode: 'created' | 'updated' | 'resolved' }>;

const PRIORITY_RANK: Readonly<Record<InboxPriority, number>> = { URGENT: 3, HIGH: 2, NORMAL: 1, INFO: 0 };
const NOTE_LIMIT = 160;

function higher(left: InboxPriority, right: InboxPriority): InboxPriority {
  return PRIORITY_RANK[left] >= PRIORITY_RANK[right] ? left : right;
}

/** Si una regla apunta dos veces a la misma persona y grupo (responsable que además es gestor), gana la prioridad más alta. */
export function dedupeInboxIntents(intents: readonly InboxIntent[]): InboxIntent[] {
  const byKey = new Map<string, InboxIntent>();
  for (const intent of intents) {
    const key = `${intent.recipientId}|${intent.kind}|${intent.groupKey ?? intent.quoteRequestId ?? ''}`;
    const current = byKey.get(key);
    if (!current || PRIORITY_RANK[intent.priority] > PRIORITY_RANK[current.priority]) byKey.set(key, intent);
  }
  return [...byKey.values()];
}

function jsonData(value: Prisma.JsonValue | null): InboxData {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InboxData : {};
}

type OpenRow = { id: string; data: Prisma.JsonValue | null; occurrences: number; priority: InboxPriority };

async function createNotification(tx: Prisma.TransactionClient, intent: InboxIntent, data: InboxData, now: Date): Promise<string | null> {
  const text = renderInboxText(intent.kind, data);
  const row = {
    recipientId: intent.recipientId,
    kind: intent.kind,
    priority: intent.priority,
    groupKey: intent.groupKey,
    quoteRequestId: intent.quoteRequestId,
    actorId: intent.actorId,
    title: text.title,
    body: text.body,
    actionPath: intent.actionPath,
    data: data as Prisma.InputJsonValue,
    occurrences: inboxOccurrences(intent.kind, data, 0),
    actionRequired: intent.actionRequired,
    createdAt: now,
    lastActivityAt: now,
    updatedAt: now,
  };
  if (!intent.groupKey) return (await tx.inboxNotification.create({ data: row, select: { id: true } })).id;
  // ON CONFLICT DO NOTHING sobre el índice único parcial: si ya hay un aviso abierto del grupo, no inserta.
  const inserted = await tx.inboxNotification.createManyAndReturn({ data: [row], skipDuplicates: true, select: { id: true } });
  return inserted[0]?.id ?? null;
}

async function lockOpenGroup(tx: Prisma.TransactionClient, recipientId: string, groupKey: string): Promise<OpenRow | null> {
  const rows = await tx.$queryRaw<OpenRow[]>(Prisma.sql`
    SELECT "id", "data", "occurrences", "priority"::text AS "priority"
    FROM "inbox_notifications"
    WHERE "recipientId" = ${recipientId}::uuid AND "groupKey" = ${groupKey} AND "readAt" IS NULL AND "resolvedAt" IS NULL
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Guarda los avisos dentro de la transacción del cambio. Con `groupKey`, la actividad nueva se suma al aviso
 * abierto del grupo (un solo aviso sin leer por persona y grupo); sin él, cada intención es un aviso nuevo.
 * Cada aviso creado o actualizado emite su señal `n`, que PostgreSQL entrega al confirmar.
 */
export async function recordInboxIntents(tx: Prisma.TransactionClient, intents: readonly InboxIntent[], now: Date): Promise<RecordedInboxNotification[]> {
  const recorded: RecordedInboxNotification[] = [];
  for (const intent of dedupeInboxIntents(intents)) {
    const data = sanitizeInboxData(intent.kind, intent.data);
    const createdId = await createNotification(tx, intent, data, now);
    if (createdId) {
      recorded.push({ id: createdId, recipientId: intent.recipientId, mode: 'created' });
      continue;
    }
    const open = await lockOpenGroup(tx, intent.recipientId, intent.groupKey as string);
    if (!open) {
      // Se leyó o resolvió entre el INSERT y el SELECT: la actividad nueva abre otro aviso.
      const retryId = (await tx.inboxNotification.create({ data: { recipientId: intent.recipientId, kind: intent.kind, priority: intent.priority, groupKey: intent.groupKey, quoteRequestId: intent.quoteRequestId, actorId: intent.actorId, ...renderInboxText(intent.kind, data), actionPath: intent.actionPath, data: data as Prisma.InputJsonValue, occurrences: inboxOccurrences(intent.kind, data, 0), actionRequired: intent.actionRequired, createdAt: now, lastActivityAt: now, updatedAt: now }, select: { id: true } })).id;
      recorded.push({ id: retryId, recipientId: intent.recipientId, mode: 'created' });
      continue;
    }
    const merged = mergeInboxData(intent.kind, jsonData(open.data), data);
    if (!merged.changed) continue;
    const mergedData = sanitizeInboxData(intent.kind, merged.data);
    const text = renderInboxText(intent.kind, mergedData);
    await tx.inboxNotification.update({
      where: { id: open.id },
      data: {
        priority: higher(open.priority, intent.priority),
        actorId: intent.actorId,
        title: text.title,
        body: text.body,
        actionPath: intent.actionPath,
        data: mergedData as Prisma.InputJsonValue,
        occurrences: inboxOccurrences(intent.kind, mergedData, open.occurrences),
        lastActivityAt: now,
        updatedAt: now,
      },
    });
    recorded.push({ id: open.id, recipientId: intent.recipientId, mode: 'updated' });
  }
  for (const entry of recorded) await publishRealtime(tx, { t: 'n', u: entry.recipientId, id: entry.id, m: entry.mode });
  return recorded;
}

export async function resolveInboxGroups(tx: Prisma.TransactionClient, resolutions: readonly InboxResolution[], now: Date): Promise<RecordedInboxNotification[]> {
  const recorded: RecordedInboxNotification[] = [];
  for (const resolution of resolutions) {
    const note = resolution.note.slice(0, NOTE_LIMIT);
    const actorNote = (resolution.actorNote ?? resolution.note).slice(0, NOTE_LIMIT);
    const actorId = resolution.actorId ?? null;
    const rows = await tx.$queryRaw<Array<{ id: string; recipientId: string }>>(Prisma.sql`
      UPDATE "inbox_notifications"
      SET "resolvedAt" = ${now},
          "updatedAt" = ${now},
          "resolvedNote" = CASE WHEN "recipientId" = ${actorId}::uuid THEN ${actorNote} ELSE ${note} END
      WHERE "groupKey" = ${resolution.groupKey} AND "resolvedAt" IS NULL
      RETURNING "id", "recipientId"
    `);
    for (const row of rows) recorded.push({ id: row.id, recipientId: row.recipientId, mode: 'resolved' });
  }
  for (const entry of recorded) await publishRealtime(tx, { t: 'n', u: entry.recipientId, id: entry.id, m: 'resolved' });
  return recorded;
}

/** Primero se cierran los grupos (p. ej. el pool de una solicitud tomada) y luego se crean los avisos nuevos. */
export async function applyInboxEffects(tx: Prisma.TransactionClient, effects: InboxEffects, now: Date): Promise<void> {
  if (effects.resolutions.length > 0) await resolveInboxGroups(tx, effects.resolutions, now);
  if (effects.intents.length > 0) await recordInboxIntents(tx, effects.intents, now);
}
```

- [ ] **Step 5: Correr las pruebas**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-record.test.ts`
Expected: PASS (7 tests).

Si falla solamente "serializes two concurrent transactions", revisa que la migración de la tarea 1 haya creado `inbox_notifications_open_group`. Ejecuta `\d inbox_notifications` en `docker compose exec postgres psql -U ocpool -d ocpool_dev`.

- [ ] **Step 6: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

```bash
git add src/server/realtime/publish.ts src/server/modules/inbox/record.ts tests/integration/inbox-record.test.ts
git commit -m "feat(inbox): guardado agrupado, resolución de grupos y señal pg_notify al confirmar"
```

---

### Task 4: `recordDomainEvent` y reglas de solicitudes

**Files:**
- Create: `src/server/modules/notifications/paths.ts`
- Modify: `src/server/modules/notifications/event-resolver.ts`, que ahora re-exporta `requestWorkspaceNotificationPath`.
- Create: `src/server/modules/inbox/audience.ts`, `src/server/modules/inbox/paths.ts`, `src/server/modules/inbox/rules/types.ts`, `src/server/modules/inbox/rules/index.ts`, `src/server/modules/inbox/rules/requests.ts` y `src/server/modules/inbox/domain-events.ts`.
- Modify: `src/server/modules/quote-requests/service.ts`, `src/server/modules/quote-requests/staff-service.ts` y `src/server/modules/messaging/service.ts`. En mensajería cambian `writeMessage`, `sendStaffMessageInTransaction` y los dos eventos de conversación.
- Test: `tests/integration/inbox-requests.test.ts`

**Interfaces:**
- Consumes (Task 3): `applyInboxEffects`, `NO_INBOX_EFFECTS`, `InboxEffects`, `InboxIntent` y `InboxResolution`.
- Produces:
  - `type InboxActor = { userId: string; type: 'CUSTOMER' | 'EMPLOYEE' }`.
  - `type DomainEventInput = { actor: InboxActor | null; eventType: string; aggregateType: string; aggregateId: string | null; payload: Readonly<Record<string, unknown>> }`.
  - `recordDomainEvent(tx, event: DomainEventInput & { payload: OutboxPayload }, options?: { now?: Date; inbox?: 'default' | 'skip' })`.
  - `notifyInbox(tx, event: DomainEventInput, options?: { now?: Date })`.
  - `withInboxSavepoint(tx, source: string, work: () => Promise<void>)`.
  - `resolveInboxEffects(tx, event, now): Promise<InboxEffects>`.
  - `loadRequestInboxContext(tx, quoteRequestId)`, `activeStaffWithPermissions(tx, keys)`, `activeEmployees(tx, ids)`, `displayNameOf(tx, id)` y `excludeUser(users, id)`.
  - `uuidOf(value)`, `textOf(value)` y `numberOf(value)`.
  - Constantes `POOL_PERMISSIONS`, `MANAGER_PERMISSIONS`, `APPROVER_PERMISSIONS` y `PRICE_MANAGER_PERMISSIONS`.
  - `staffRequestPath(requestId, tab?)`, `customerRequestPath(requestId)`, `staffProjectPath(projectId)`, `STAFF_APPROVALS_PATH` y `STAFF_PENDING_PRICES_PATH`.
  - `sendStaffMessageInTransaction(transaction, actor, request, input, now, options?: { inbox?: 'default' | 'skip' })`.

- [ ] **Step 1: Escribir la prueba de integración de las reglas de solicitudes**

Crear `tests/integration/inbox-requests.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { assignQuoteRequest, closeQuoteRequest, reopenQuoteRequest, requestInformationQuoteRequest, takeQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const actor = (userId: string, permissions: string[]): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(permissions), mfaVerified: true });

describe('inbox rules for requests', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let managerId = '';
  let otherSalesId = '';
  let bystanderId = '';
  let customerId = '';

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function employee(name: string, roleId: string | null): Promise<string> {
    const email = `inbox-req-${name}-${suffix}@example.test`;
    const user = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(user.id);
    return user.id;
  }

  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId, quoteRequestId: requestId } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const poolRole = await role('inbox-pool', ['requests.read', 'requests.claim', 'requests.assign', 'requests.status.update', 'messaging.send', 'messaging.read']);
    const managerRole = await role('inbox-manager', ['requests.read', 'requests.read.global', 'requests.assign', 'requests.reassign', 'requests.status.update']);
    salesId = await employee('sales', poolRole);
    otherSalesId = await employee('other', poolRole);
    managerId = await employee('manager', managerRole);
    bystanderId = await employee('bystander', null);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-requests-${suffix}`, origin: 'PUBLIC_FORM', contact: { displayName: `Cliente ${suffix}`, email: `inbox-req-client-${suffix}@example.test` }, detail: { projectType: 'Alberca con jacuzzi', location: 'Monterrey', description: 'Fixture de reglas de solicitudes', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const customer = await prisma.user.create({ data: { email: `inbox-req-customer-${suffix}@example.test`, emailNormalized: `inbox-req-customer-${suffix}@example.test`, displayName: `Cliente ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId } });
    customerId = customer.id;
    userIds.push(customer.id);
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
  });

  afterAll(async () => {
    if (requestId) {
      await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      await prisma.quoteRequest.delete({ where: { id: requestId } });
    }
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('alerts the whole pool about a web lead and nobody else', async () => {
    for (const recipientId of [salesId, otherSalesId, managerId]) {
      const [notice] = await inboxOf(recipientId);
      expect(notice, recipientId).toMatchObject({ kind: 'request.new_unassigned', priority: 'HIGH', actionRequired: true, groupKey: `pool:${requestId}`, title: 'Nueva solicitud: Alberca con jacuzzi en Monterrey' });
    }
    expect(await inboxOf(bystanderId)).toHaveLength(0);
  });

  it('resolves the pool when someone takes it and never notifies the taker', async () => {
    await takeQuoteRequest(actor(salesId, ['requests.read', 'requests.claim']), requestId, {}, { prisma, now });
    const [mine] = await inboxOf(salesId);
    const [theirs] = await inboxOf(otherSalesId);
    expect(mine).toMatchObject({ kind: 'request.new_unassigned', resolvedNote: 'La tomaste' });
    expect(theirs).toMatchObject({ resolvedNote: `Tomada por sales ${suffix}` });
    expect((await inboxOf(salesId)).some((row) => row.kind === 'request.assigned_to_you')).toBe(false);
  });

  it('tells the new owner and the previous one on a reassignment', async () => {
    await assignQuoteRequest(actor(managerId, ['requests.read', 'requests.read.global', 'requests.assign', 'requests.reassign']), requestId, { assignedToId: otherSalesId, reason: 'Balance de carga' }, { prisma, now });
    expect(await inboxOf(otherSalesId)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'request.assigned_to_you', title: expect.stringContaining(`manager ${suffix} te asignó`) })]));
    // El aviso de "te lo quitaron" no depende del expediente: queda visible aunque ya no lo pueda abrir.
    const lost = await prisma.inboxNotification.findFirst({ where: { recipientId: salesId, kind: 'request.unassigned_from_you' } });
    expect(lost).toMatchObject({ quoteRequestId: null, actionPath: '/staff/requests', title: expect.stringContaining(`a other ${suffix}`) });
  });

  it('tells the owner when someone else closes or reopens the file', async () => {
    const managerActor = actor(managerId, ['requests.read', 'requests.read.global', 'requests.status.update']);
    await closeQuoteRequest(managerActor, requestId, { reason: 'CHOSE_ALTERNATIVE' }, { prisma, now });
    await reopenQuoteRequest(managerActor, requestId, {}, { prisma, now: new Date(now.getTime() + 1000) });
    const kinds = (await inboxOf(otherSalesId)).map((row) => row.kind);
    expect(kinds).toEqual(expect.arrayContaining(['request.closed', 'request.reopened']));
    expect((await inboxOf(otherSalesId)).find((row) => row.kind === 'request.closed')).toMatchObject({ body: 'Motivo: Eligió otra opción' });
  });

  it('asks the customer for information without also sending a team-activity notice', async () => {
    await requestInformationQuoteRequest(actor(otherSalesId, ['requests.read', 'requests.status.update', 'messaging.send']), requestId, { message: 'Necesitamos las medidas del terreno.', missingFields: ['detail.dimensions'], idempotencyKey: `inbox-info-${suffix}` }, { prisma, now: new Date(now.getTime() + 2000) });
    const customerInbox = await inboxOf(customerId);
    expect(customerInbox.map((row) => row.kind)).toEqual(['request.information_needed']);
    expect(customerInbox[0]).toMatchObject({ actionRequired: true, groupKey: `info:${requestId}`, body: '“Necesitamos las medidas del terreno.”', actionPath: `/portal?request=${requestId}` });
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-requests.test.ts`
Expected: FAIL. La primera prueba no encuentra avisos (`notice` es `undefined`).

- [ ] **Step 3: Sacar el enlace de staff a su propio módulo**

Crear `src/server/modules/notifications/paths.ts`:

```ts
import { readCommercialV2Flags, type CommercialV2Flags } from '@/server/flags/commercial-v2';

export type StaffRequestTab = 'summary' | 'quote' | 'conversation' | 'files' | 'activity';

export function requestWorkspaceNotificationPath(requestId: string, tab: StaffRequestTab, flags: CommercialV2Flags = readCommercialV2Flags()): string {
  if (flags.commercialWorkspaceV2 && flags.requestWorkspaceV2) return `/staff/requests/${encodeURIComponent(requestId)}?tab=${tab}`;
  // La vista clásica también abre un expediente por `?request=` (lista + detalle en la misma página;
  // conversación y archivos van en el detalle, así que no hay pestaña). Antes el correo llevaba a la
  // lista a secas y había que buscar el folio a mano.
  return `/staff/requests?request=${encodeURIComponent(requestId)}`;
}
```

En `src/server/modules/notifications/event-resolver.ts`, borra la función `requestWorkspaceNotificationPath` completa, con su comentario. Deja en su lugar un re-export, para que las pruebas y los importadores existentes no cambien, y agrega el import:

```ts
import { requestWorkspaceNotificationPath } from '@/server/modules/notifications/paths';

export { requestWorkspaceNotificationPath } from '@/server/modules/notifications/paths';
```

- [ ] **Step 4: Crear `inbox/audience.ts` y `inbox/paths.ts`**

Crear `src/server/modules/inbox/audience.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';

export type InboxActor = Readonly<{ userId: string; type: 'CUSTOMER' | 'EMPLOYEE' }>;
export type InboxRecipient = Readonly<{ id: string; displayName: string }>;

/** Grupos de destinatarios por permiso (spec §2.2). Siempre empleados ACTIVE. */
export const POOL_PERMISSIONS = ['requests.claim', 'requests.read.global'] as const;
export const MANAGER_PERMISSIONS = ['requests.read.global'] as const;
export const APPROVER_PERMISSIONS = ['quotes.approve_discount'] as const;
export const PRICE_MANAGER_PERMISSIONS = ['prices.manage'] as const;

export type RequestInboxContext = Readonly<{
  id: string;
  folio: string;
  status: string;
  origin: 'PUBLIC_FORM' | 'STAFF_CREATED';
  clientId: string;
  clientName: string;
  /** Sólo si la persona asignada sigue ACTIVE; si no, el expediente cuenta como sin responsable. */
  assigneeId: string | null;
  assigneeName: string | null;
  contactName: string;
  /** Cuenta de portal ACTIVE del contacto (con el cliente ACTIVE); sin ella el cliente sólo recibe correo. */
  customerUserId: string | null;
  projectType: string | null;
  location: string | null;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function uuidOf(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export async function loadRequestInboxContext(tx: Prisma.TransactionClient, quoteRequestId: string): Promise<RequestInboxContext | null> {
  const request = await tx.quoteRequest.findUnique({
    where: { id: quoteRequestId },
    select: {
      id: true,
      folio: true,
      status: true,
      origin: true,
      clientId: true,
      client: { select: { displayName: true, status: true } },
      currentAssignee: { select: { id: true, displayName: true, type: true, status: true } },
      contact: { select: { displayName: true, status: true, user: { select: { id: true, type: true, status: true } } } },
      detail: { select: { projectType: true, location: true } },
    },
  });
  if (!request) return null;
  const assignee = request.currentAssignee?.type === 'EMPLOYEE' && request.currentAssignee.status === 'ACTIVE' ? request.currentAssignee : null;
  const contactUser = request.client.status === 'ACTIVE' && request.contact.status === 'ACTIVE' && request.contact.user?.type === 'CUSTOMER' && request.contact.user.status === 'ACTIVE' ? request.contact.user : null;
  return {
    id: request.id,
    folio: request.folio,
    status: request.status,
    origin: request.origin,
    clientId: request.clientId,
    clientName: request.client.displayName,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.displayName ?? null,
    contactName: request.contact.displayName,
    customerUserId: contactUser?.id ?? null,
    projectType: request.detail?.projectType ?? null,
    location: request.detail?.location ?? null,
  };
}

export async function activeStaffWithPermissions(tx: Prisma.TransactionClient, permissionKeys: readonly string[]): Promise<InboxRecipient[]> {
  return tx.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: { in: [...permissionKeys] } } } } } } } },
    select: { id: true, displayName: true },
    orderBy: { id: 'asc' },
  });
}

export async function activeEmployees(tx: Prisma.TransactionClient, userIds: readonly (string | null | undefined)[]): Promise<InboxRecipient[]> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return [];
  return tx.user.findMany({ where: { id: { in: ids }, type: 'EMPLOYEE', status: 'ACTIVE' }, select: { id: true, displayName: true }, orderBy: { id: 'asc' } });
}

export async function displayNameOf(tx: Prisma.TransactionClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return user?.displayName ?? null;
}

/** Nunca se avisa a quien hizo la acción. */
export function excludeUser<T extends { id: string }>(users: readonly T[], userId: string | null | undefined): T[] {
  return userId ? users.filter((user) => user.id !== userId) : [...users];
}
```

Crear `src/server/modules/inbox/paths.ts`:

```ts
import { requestWorkspaceNotificationPath, type StaffRequestTab } from '@/server/modules/notifications/paths';

export const STAFF_APPROVALS_PATH = '/staff/approvals';
export const STAFF_PENDING_PRICES_PATH = '/staff/catalog?tab=pending-prices';

export function staffRequestPath(requestId: string, tab: StaffRequestTab = 'summary'): string {
  return requestWorkspaceNotificationPath(requestId, tab);
}

export function customerRequestPath(requestId: string): string {
  return `/portal?request=${encodeURIComponent(requestId)}`;
}

export function staffProjectPath(projectId: string): string {
  return `/staff/projects/${encodeURIComponent(projectId)}`;
}
```

- [ ] **Step 5: Crear los tipos, el despacho y las reglas de solicitudes**

Crear `src/server/modules/inbox/rules/types.ts`:

```ts
import type { InboxActor } from '../audience';

/** Un evento de dominio tal como lo escribe el emisor. `actor: null` = el sistema (formulario público, worker). */
export type DomainEventInput = Readonly<{
  actor: InboxActor | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Readonly<Record<string, unknown>>;
}>;
```

Crear `src/server/modules/inbox/rules/requests.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { activeStaffWithPermissions, displayNameOf, excludeUser, loadRequestInboxContext, POOL_PERMISSIONS, textOf, uuidOf } from '../audience';
import { messagePreview } from '../format';
import { customerRequestPath, staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent, type InboxResolution } from '../record';
import type { DomainEventInput } from './types';

const REOPEN_SOURCES: ReadonlySet<string> = new Set(['RECHAZADA', 'VENCIDA']);

export async function requestReceivedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const intents: InboxIntent[] = [];
  // Sólo las solicitudes que llegan del sitio van al pool: una capturada por alguien del equipo ya tiene quién la atienda.
  if (context.origin === 'PUBLIC_FORM' && !context.assigneeId) {
    for (const user of excludeUser(await activeStaffWithPermissions(tx, POOL_PERMISSIONS), actorId)) {
      intents.push({ recipientId: user.id, kind: 'request.new_unassigned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `pool:${context.id}`, actionPath: staffRequestPath(context.id), actionRequired: true, data: { folio: context.folio, clientName: context.clientName, projectType: context.projectType ?? undefined, location: context.location ?? undefined } });
    }
  }
  if (context.customerUserId && context.customerUserId !== actorId) {
    intents.push({ recipientId: context.customerUserId, kind: 'request.received', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined } });
  }
  return { intents, resolutions: [] };
}

export async function requestAssignedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const assignedToId = uuidOf(event.payload.assignedToId);
  if (!requestId || !assignedToId) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const assigneeName = (await displayNameOf(tx, assignedToId)) ?? 'otra persona';
  const previousAssigneeId = uuidOf(event.payload.previousAssigneeId);
  const intents: InboxIntent[] = [];
  if (assignedToId !== actorId) {
    intents.push({ recipientId: assignedToId, kind: 'request.assigned_to_you', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, projectType: context.projectType ?? undefined, location: context.location ?? undefined } });
  }
  if (previousAssigneeId && previousAssigneeId !== assignedToId && previousAssigneeId !== actorId) {
    // Sin expediente a propósito: quien lo perdió ya no puede abrirlo y el aviso no debe ocultarse por alcance.
    intents.push({ recipientId: previousAssigneeId, kind: 'request.unassigned_from_you', priority: 'NORMAL', quoteRequestId: null, actorId, groupKey: null, actionPath: '/staff/requests', actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, toName: assigneeName } });
  }
  const taken = event.payload.mode === 'take';
  return {
    intents,
    resolutions: [{ groupKey: `pool:${context.id}`, note: taken ? `Tomada por ${actorName}` : `Asignada a ${assigneeName}`, actorId, actorNote: taken ? 'La tomaste' : `Asignada a ${assigneeName}` }],
  };
}

export async function requestStatusChangedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const toStatus = textOf(event.payload.toStatus);
  const fromStatus = textOf(event.payload.fromStatus);
  if (!requestId || !toStatus) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const intents: InboxIntent[] = [];
  const resolutions: InboxResolution[] = [];

  if (event.payload.source === 'request_information') {
    if (context.customerUserId) {
      const messageId = uuidOf(event.payload.messageId);
      const message = messageId ? await tx.conversationMessage.findUnique({ where: { id: messageId }, select: { body: true, visibility: true } }) : null;
      intents.push({ recipientId: context.customerUserId, kind: 'request.information_needed', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `info:${context.id}`, actionPath: customerRequestPath(context.id), actionRequired: true, data: { folio: context.folio, projectType: context.projectType ?? undefined, preview: message?.visibility === 'CUSTOMER' ? messagePreview(message.body) : undefined } });
    }
    return { intents, resolutions };
  }

  if (fromStatus === 'INFORMACION_REQUERIDA' && toStatus !== 'INFORMACION_REQUERIDA') resolutions.push({ groupKey: `info:${context.id}`, note: 'El equipo continuó con tu solicitud' });
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  if (toStatus === 'RECHAZADA') {
    resolutions.push({ groupKey: `pool:${context.id}`, note: 'Se cerró la solicitud' }, { groupKey: `changes:${context.id}`, note: 'Se cerró el expediente' });
    if (context.assigneeId && context.assigneeId !== actorId) intents.push({ recipientId: context.assigneeId, kind: 'request.closed', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, reason: textOf(event.payload.reason) } });
  } else if (fromStatus && REOPEN_SOURCES.has(fromStatus) && context.assigneeId && context.assigneeId !== actorId) {
    intents.push({ recipientId: context.assigneeId, kind: 'request.reopened', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName } });
  }
  return { intents, resolutions };
}

export async function customerResponseReviewedEffects(_tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  return { intents: [], resolutions: [{ groupKey: `info:${requestId}`, note: 'El equipo revisó tu respuesta' }] };
}
```

Crear `src/server/modules/inbox/rules/index.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { NO_INBOX_EFFECTS, type InboxEffects } from '../record';
import { customerResponseReviewedEffects, requestAssignedEffects, requestReceivedEffects, requestStatusChangedEffects } from './requests';
import type { DomainEventInput } from './types';

/** Reglas por evento (spec §2.2 y §2.3). Un evento sin regla sólo queda en el outbox. */
export async function resolveInboxEffects(tx: Prisma.TransactionClient, event: DomainEventInput, _now: Date): Promise<InboxEffects> {
  switch (event.eventType) {
    case 'REQUEST.RECEIVED': return requestReceivedEffects(tx, event);
    case 'REQUEST.ASSIGNED': return requestAssignedEffects(tx, event);
    case 'REQUEST.STATUS_CHANGED': return requestStatusChangedEffects(tx, event);
    case 'REQUEST.CUSTOMER_RESPONSE': return customerResponseReviewedEffects(tx, event);
    default: return NO_INBOX_EFFECTS;
  }
}
```

- [ ] **Step 6: Crear `domain-events.ts`**

Crear `src/server/modules/inbox/domain-events.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/server/logging/logger';
import { applyInboxEffects } from './record';
import { resolveInboxEffects } from './rules';
import type { DomainEventInput } from './rules/types';

export type OutboxPayload = Record<string, string | number | boolean | null>;
export type RecordDomainEventInput = DomainEventInput & Readonly<{ payload: OutboxPayload }>;
export type RecordDomainEventOptions = Readonly<{ now?: Date; inbox?: 'default' | 'skip' }>;

/**
 * Los avisos nunca deben tumbar la operación que los provoca: si una regla falla, un SAVEPOINT deshace sólo
 * su parte y el cambio de dominio se confirma igual (el outbox, y por tanto el correo, ya quedó escrito).
 */
export async function withInboxSavepoint(tx: Prisma.TransactionClient, source: string, work: () => Promise<void>): Promise<void> {
  await tx.$executeRawUnsafe('SAVEPOINT inbox_effects');
  try {
    await work();
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT inbox_effects');
  } catch (error) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT inbox_effects');
    logger.error({ source, error: error instanceof Error ? error.message : String(error) }, 'Inbox effects failed; the domain change was kept');
  }
}

/** Punto único de emisión (spec §2.1): outbox de siempre + avisos por rol en la misma transacción. */
export async function recordDomainEvent(tx: Prisma.TransactionClient, event: RecordDomainEventInput, options: RecordDomainEventOptions = {}): Promise<void> {
  await tx.outboxEvent.create({ data: { eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, payload: event.payload } });
  if (options.inbox === 'skip') return;
  const now = options.now ?? new Date();
  await withInboxSavepoint(tx, event.eventType, async () => applyInboxEffects(tx, await resolveInboxEffects(tx, event, now), now));
}

/** Señales que sólo viven en la aplicación (sin correo ni outbox): proyecto con nuevo dueño, trabajo reasignado, precio asignado… */
export async function notifyInbox(tx: Prisma.TransactionClient, event: DomainEventInput, options: Readonly<{ now?: Date }> = {}): Promise<void> {
  const now = options.now ?? new Date();
  await withInboxSavepoint(tx, event.eventType, async () => applyInboxEffects(tx, await resolveInboxEffects(tx, event, now), now));
}
```

- [ ] **Step 7: Pasar los emisores de solicitudes a `recordDomainEvent`**

En `src/server/modules/quote-requests/service.ts`:
- Agrega `import { recordDomainEvent } from '@/server/modules/inbox/domain-events';`.
- Reemplaza el bloque `await transaction.outboxEvent.create({ data: { eventType: 'REQUEST.RECEIVED', … } });` por:

```ts
      await recordDomainEvent(transaction, {
        actor: input.actorUserId ? { userId: input.actorUserId, type: 'EMPLOYEE' } : null,
        eventType: 'REQUEST.RECEIVED',
        aggregateType: 'QUOTE_REQUEST',
        aggregateId: request.id,
        payload: { quoteRequestId: request.id, folio, origin: input.origin },
      }, { now });
```

En `src/server/modules/quote-requests/staff-service.ts`, agrega `import { recordDomainEvent } from '@/server/modules/inbox/domain-events';` y reemplaza cada `transaction.outboxEvent.create` como se indica abajo. El resto de cada función queda igual.

1. `requestInformationQuoteRequest`:
   - Las dos llamadas `sendStaffMessageInTransaction(transaction, actor, request, { body: normalized.message, idempotencyKey: normalized.idempotencyKey }, now)` reciben un sexto argumento `{ inbox: 'skip' }`: ese mensaje ya avisa como "información requerida".
   - El evento queda así:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.STATUS_CHANGED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus: 'INFORMACION_REQUERIDA', source: 'request_information', messageId: message.id },
    }, { now });
```

2. `assignQuoteRequest`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.ASSIGNED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, assignedToId, assignedById: actor.userId, previousAssigneeId: request.currentAssigneeId },
    }, { now });
```

3. `takeQuoteRequest`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.ASSIGNED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, assignedToId: actor.userId, assignedById: actor.userId, previousAssigneeId: null, mode: 'take' },
    }, { now });
```

4. `markInformationReviewedQuoteRequest`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.CUSTOMER_RESPONSE',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: 'INFORMACION_REQUERIDA', toStatus: 'EN_REVISION' },
    }, { now });
```

5. `closeQuoteRequest`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.STATUS_CHANGED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus: 'RECHAZADA', reason: reasonLabel },
    }, { now });
```

6. `reopenQuoteRequest`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.STATUS_CHANGED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus },
    }, { now });
```

7. `transitionQuoteRequest`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'REQUEST.STATUS_CHANGED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: request.id,
      payload: { quoteRequestId: request.id, folio: request.folio, fromStatus: request.status, toStatus: input.toStatus, reason },
    }, { now });
```

- [ ] **Step 8: Mensajería: opción para omitir la bandeja y eventos por el emisor único**

En `src/server/modules/messaging/service.ts`:
- Agrega `import { recordDomainEvent } from '@/server/modules/inbox/domain-events';`.
- Cambia la firma de `writeMessage` para aceptar opciones:

```ts
async function writeMessage(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  request: LockedRequest,
  visibility: MessageVisibility,
  input: SendMessageInput,
  now: Date,
  options: Readonly<{ inbox?: 'default' | 'skip' }> = {},
) {
```

Dentro de `writeMessage`, reemplaza `await transaction.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', … } });` por:

```ts
  await recordDomainEvent(transaction, {
    actor: { userId: actor.userId, type: actor.type },
    eventType: 'MESSAGE.CREATED',
    aggregateType: 'CONVERSATION',
    aggregateId: conversation.id,
    payload: {
      conversationId: conversation.id,
      quoteRequestId: request.id,
      clientId: request.clientId,
      messageId: message.id,
      visibility,
      folio: request.folio,
    },
  }, { now, inbox: options.inbox });
```

Cambia `sendStaffMessageInTransaction` para recibir y reenviar la opción:

```ts
export async function sendStaffMessageInTransaction(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  request: StaffMessageTransactionRequest,
  input: SendMessageInput,
  now: Date,
  options: Readonly<{ inbox?: 'default' | 'skip' }> = {},
) {
  requireStaffPermission(actor, 'requests.read');
  requirePermission(actor, 'messaging.send');
  requireStaffRequestReadScope(actor, request.currentAssigneeId);
  return writeMessage(transaction, actor, request, 'CUSTOMER', input, now, options);
}
```

En `closeConversation` y `reopenConversation`, reemplaza cada `await transaction.outboxEvent.create({ data: { eventType: 'CONVERSATION.STATUS_CHANGED', … } });` por la forma de abajo, con `toStatus: closed.status` en el cierre y `toStatus: reopened.status` en la reapertura:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'CONVERSATION.STATUS_CHANGED',
      aggregateType: 'CONVERSATION',
      aggregateId: conversation.id,
      payload: { conversationId: conversation.id, quoteRequestId: request.id, folio: request.folio, fromStatus: conversation.status, toStatus: closed.status },
    }, { now });
```

`now` ya existe en ambas funciones (`const now = dependencies.now ?? new Date();`).

- [ ] **Step 9: Correr las pruebas**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-requests.test.ts tests/integration/quote-requests-staff.test.ts tests/integration/quote-request-lifecycle.test.ts tests/integration/messaging-service.test.ts tests/integration/notifications-fanout.test.ts --maxWorkers=1`
Expected:
- `inbox-requests` pasa completo (5 tests).
- Los archivos existentes pasan igual que antes. El outbox no cambió de forma: sólo se agregaron campos a algunos payloads.

- [ ] **Step 10: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit/notification-links.test.ts`
Expected: sin errores; la prueba de enlaces sigue pasando gracias al re-export.

```bash
git add src/server/modules/inbox src/server/modules/notifications/paths.ts src/server/modules/notifications/event-resolver.ts src/server/modules/quote-requests src/server/modules/messaging/service.ts tests/integration/inbox-requests.test.ts
git commit -m "feat(inbox): emisor único de eventos y avisos de solicitudes (pool, asignación, cierre, información)"
```

### Task 5: Reglas de mensajes y archivos

**Files:**
- Modify: `src/lib/change-request.ts`, que agrega `parseAnyChangeRequest`.
- Create: `src/server/modules/inbox/rules/messages.ts`
- Modify: `src/server/modules/inbox/rules/index.ts`
- Modify: `src/server/modules/private-files/service.ts`, que usa el helper `outbox` y sus 4 llamadas.
- Test: `tests/unit/change-request.test.ts`
- Test: `tests/integration/inbox-messages.test.ts`

**Interfaces:**
- Consumes (Task 4): `loadRequestInboxContext`, `activeStaffWithPermissions`, `activeEmployees`, `excludeUser`, `uuidOf`, `POOL_PERMISSIONS`, `MANAGER_PERMISSIONS`, `staffRequestPath`, `customerRequestPath`, `recordDomainEvent` y `notifyInbox`. De la tarea 2 usa `messagePreview` y `filePreview`.
- Produces:
  - `parseAnyChangeRequest(body: string): { versionNumber: number; message: string } | null`. La tarea 9 lo usa para el correo.
  - `messageCreatedEffects(tx, event, now)` y `fileAvailableEffects(tx, event)`.
  - Los tipos `customer.activity`, `team.activity`, `note.internal` y `quote.changes_requested` se generan de verdad.
  - Queda resuelto el grupo `info:{requestId}` cuando el cliente responde.

- [ ] **Step 0: Reconocer una petición de cambios de cualquier versión**

En `tests/unit/change-request.test.ts`:
- Agrega `parseAnyChangeRequest` a la importación de `@/lib/change-request`.
- Agrega esta prueba dentro del `describe`:

```ts
  it('recognizes a change request for any version', () => {
    expect(parseAnyChangeRequest(changeRequestBody(3, '  Otro color.  '))).toEqual({ versionNumber: 3, message: 'Otro color.' });
    expect(parseAnyChangeRequest('¿Cuándo pueden venir?')).toBeNull();
  });
```

Al final de `src/lib/change-request.ts`, agrega:

```ts
const ANY_CHANGE_REQUEST = /^Solicitud de cambios en la propuesta V(\d+):/u;

/** Petición de cambios de cualquier versión (avisos y correo no saben de antemano cuál): versión y texto. */
export function parseAnyChangeRequest(body: string): { versionNumber: number; message: string } | null {
  const match = ANY_CHANGE_REQUEST.exec(body);
  if (!match) return null;
  return { versionNumber: Number(match[1]), message: body.slice(match[0].length).trim() };
}
```

Run: `npx vitest run tests/unit/change-request.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 1: Escribir la prueba**

Crear `tests/integration/inbox-messages.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';
import { changeRequestBody } from '@/lib/change-request';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { createInternalNote, sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { requestInformationQuoteRequest } from '@/server/modules/quote-requests/staff-service';

const staffPermissions = ['requests.read', 'requests.read.global', 'requests.status.update', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write'];
const staffActor = (userId: string): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(staffPermissions), mfaVerified: true });
const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });

describe('inbox rules for messages and files', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let assigneeId = '';
  let colleagueId = '';
  let managerId = '';
  let customerId = '';
  let storageObjectId = '';
  let fileId = '';
  let customerActor: Actor;

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function user(name: string, type: 'EMPLOYEE' | 'CUSTOMER', roleId?: string): Promise<string> {
    const email = `inbox-msg-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type, status: 'ACTIVE', ...(type === 'CUSTOMER' ? { clientId } : {}), ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(created.id);
    return created.id;
  }

  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId, quoteRequestId: requestId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const staffRole = await role('inbox-msg-staff', ['requests.read', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write']);
    const managerRole = await role('inbox-msg-manager', ['requests.read', 'requests.read.global']);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-messages-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Laura ${suffix}`, email: `inbox-msg-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Zapopan', description: 'Fixture de reglas de mensajes', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    assigneeId = await user('assignee', 'EMPLOYEE', staffRole);
    colleagueId = await user('colleague', 'EMPLOYEE', staffRole);
    managerId = await user('manager', 'EMPLOYEE', managerRole);
    customerId = await user('customer', 'CUSTOMER');
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: assigneeId, status: 'EN_REVISION' } });
    customerActor = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
  });

  afterAll(async () => {
    if (fileId) await prisma.fileAttachment.delete({ where: { id: fileId } });
    if (storageObjectId) await prisma.storageObject.delete({ where: { id: storageObjectId } });
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('groups two customer messages into one notice for the assignee only', async () => {
    await sendCustomerMessage(customerActor, requestId, { body: 'Hola, ¿cómo va la propuesta?', idempotencyKey: `inbox-msg-1-${suffix}` }, { prisma, now, rateLimit });
    await sendCustomerMessage(customerActor, requestId, { body: 'Te comparto el plano con las medidas finales.', idempotencyKey: `inbox-msg-2-${suffix}` }, { prisma, now: new Date(now.getTime() + 1000), rateLimit });
    const inbox = await inboxOf(assigneeId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'customer.activity', priority: 'HIGH', occurrences: 2, title: `customer ${suffix} te escribió 2 mensajes`, body: '“Te comparto el plano con las medidas finales.”' });
    expect(await inboxOf(colleagueId)).toHaveLength(0);
    expect(await inboxOf(customerId)).toHaveLength(0);
  });

  it('adds a customer upload to the same open notice', async () => {
    const storage = await prisma.storageObject.create({ data: { storageKey: `private-files/inbox-msg/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 5n, sha256: 'd'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = storage.id;
    const file = await prisma.fileAttachment.create({ data: { quoteRequestId: requestId, clientId, storageObjectId: storage.id, originalFileName: 'plano.pdf', category: 'CLIENT_DOCUMENT', visibility: 'CUSTOMER', status: 'AVAILABLE', uploadedById: customerId } });
    fileId = file.id;
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: customerId, type: 'CUSTOMER' }, eventType: 'FILE.AVAILABLE', aggregateType: 'FILE_ATTACHMENT', aggregateId: file.id, payload: { fileId: file.id, quoteRequestId: requestId, visibility: 'CUSTOMER', category: 'CLIENT_DOCUMENT' } }, { now }));
    const [notice] = await inboxOf(assigneeId);
    expect(notice).toMatchObject({ occurrences: 3, title: `customer ${suffix} subió un archivo y dejó 2 mensajes`, body: 'Archivo: plano.pdf' });
  });

  it('tells the customer about a team reply and never echoes it to its author', async () => {
    await sendStaffMessage(staffActor(assigneeId), requestId, { body: 'Ya revisamos el plano, gracias.', idempotencyKey: `inbox-msg-staff-${suffix}` }, { prisma, now, rateLimit });
    expect(await inboxOf(customerId)).toEqual([expect.objectContaining({ kind: 'team.activity', title: 'El equipo OCPOOL te escribió', actionPath: `/portal?request=${requestId}` })]);
    expect((await inboxOf(assigneeId)).filter((row) => row.kind === 'team.activity')).toHaveLength(0);
  });

  it('flags a change request as urgent for the assignee and informs managers', async () => {
    await sendCustomerMessage(customerActor, requestId, { body: changeRequestBody(1, '¿Pueden incluir calentador solar?'), idempotencyKey: `inbox-msg-change-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(assigneeId)).find((row) => row.kind === 'quote.changes_requested')).toMatchObject({ priority: 'URGENT', actionRequired: true, title: `customer ${suffix} pidió cambios a la propuesta V1`, body: '“¿Pueden incluir calentador solar?”' });
    expect((await inboxOf(managerId)).find((row) => row.kind === 'quote.changes_requested')).toMatchObject({ priority: 'NORMAL', actionRequired: false });
  });

  it('routes internal notes to the assignee and to recent note participants, never to their author', async () => {
    await createInternalNote(staffActor(colleagueId), requestId, { body: 'Ojo con el acceso para maquinaria.', idempotencyKey: `inbox-note-1-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(assigneeId)).find((row) => row.kind === 'note.internal')).toMatchObject({ title: `colleague ${suffix} dejó una nota interna en ${(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio}` });
    await createInternalNote(staffActor(assigneeId), requestId, { body: 'Enterado, lo reviso.', idempotencyKey: `inbox-note-2-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(colleagueId)).find((row) => row.kind === 'note.internal')).toMatchObject({ body: '“Enterado, lo reviso.”' });
    expect((await inboxOf(assigneeId)).filter((row) => row.kind === 'note.internal')).toHaveLength(1);
    expect((await inboxOf(customerId)).some((row) => row.kind === 'note.internal')).toBe(false);
  });

  it('closes the information request when the customer answers', async () => {
    await requestInformationQuoteRequest(staffActor(assigneeId), requestId, { message: 'Necesitamos las medidas del terreno.', missingFields: ['detail.dimensions'], idempotencyKey: `inbox-msg-info-${suffix}` }, { prisma, now });
    await sendCustomerMessage(customerActor, requestId, { body: 'Son 8 por 4 metros.', idempotencyKey: `inbox-msg-answer-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(customerId)).find((row) => row.kind === 'request.information_needed')).toMatchObject({ resolvedNote: 'Respondiste' });
  });

  it('sends customer activity to the pool when nobody owns the file', async () => {
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: null } });
    await sendCustomerMessage(customerActor, requestId, { body: '¿Alguien me puede atender?', idempotencyKey: `inbox-msg-pool-${suffix}` }, { prisma, now, rateLimit });
    expect((await inboxOf(managerId)).find((row) => row.kind === 'customer.activity')).toMatchObject({ body: '“¿Alguien me puede atender?”' });
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-messages.test.ts`
Expected: FAIL en la primera prueba: `inbox` tiene longitud 0.

- [ ] **Step 3: Implementar las reglas**

Crear `src/server/modules/inbox/rules/messages.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { parseAnyChangeRequest } from '@/lib/change-request';
import { activeEmployees, activeStaffWithPermissions, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, POOL_PERMISSIONS, uuidOf, type InboxRecipient, type RequestInboxContext } from '../audience';
import { filePreview, messagePreview } from '../format';
import { customerRequestPath, staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent, type InboxResolution } from '../record';
import type { DomainEventInput } from './types';

const NOTE_PARTICIPANT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Quién del equipo atiende la actividad del cliente: el responsable o, si no hay, el pool. */
async function staffAudienceFor(tx: Prisma.TransactionClient, context: RequestInboxContext, actorId: string | null): Promise<InboxRecipient[]> {
  if (context.assigneeId) return excludeUser([{ id: context.assigneeId, displayName: context.assigneeName ?? '' }], actorId);
  return excludeUser(await activeStaffWithPermissions(tx, POOL_PERMISSIONS), actorId);
}

export async function messageCreatedEffects(tx: Prisma.TransactionClient, event: DomainEventInput, now: Date): Promise<InboxEffects> {
  const messageId = uuidOf(event.payload.messageId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!messageId || !requestId) return NO_INBOX_EFFECTS;
  const message = await tx.conversationMessage.findUnique({ where: { id: messageId }, select: { conversationId: true, body: true, visibility: true, sender: { select: { id: true, displayName: true, type: true } } } });
  if (!message) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = message.sender?.id ?? event.actor?.userId ?? null;
  const actorName = message.sender?.displayName;

  if (message.visibility === 'INTERNAL') {
    const since = new Date(now.getTime() - NOTE_PARTICIPANT_WINDOW_MS);
    const participants = await tx.conversationMessage.findMany({ where: { conversationId: message.conversationId, visibility: 'INTERNAL', createdAt: { gte: since }, senderUserId: { not: null } }, select: { senderUserId: true }, distinct: ['senderUserId'] });
    const recipients = excludeUser(await activeEmployees(tx, [context.assigneeId, ...participants.map((row) => row.senderUserId)]), actorId);
    return {
      intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'note.internal', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: `note:${context.id}:${actorId ?? 'system'}`, actionPath: staffRequestPath(context.id, 'conversation'), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, messages: 1, preview: messagePreview(message.body) } })),
      resolutions: [],
    };
  }

  if (message.sender?.type === 'CUSTOMER') {
    const resolutions: InboxResolution[] = context.status === 'INFORMACION_REQUERIDA' ? [{ groupKey: `info:${context.id}`, note: 'Respondiste' }] : [];
    const staff = await staffAudienceFor(tx, context, actorId);
    const change = parseAnyChangeRequest(message.body);
    if (change) {
      const data = { folio: context.folio, clientName: context.clientName, actorName, versionNumber: change.versionNumber, messages: 1, preview: messagePreview(change.message || message.body) };
      const managers = excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), actorId);
      return {
        intents: [
          ...staff.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.changes_requested', priority: 'URGENT', quoteRequestId: context.id, actorId, groupKey: `changes:${context.id}`, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: true, data })),
          ...managers.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.changes_requested', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: `changes:${context.id}`, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data })),
        ],
        resolutions,
      };
    }
    return {
      intents: staff.map((user): InboxIntent => ({ recipientId: user.id, kind: 'customer.activity', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `activity:${context.id}:${actorId ?? 'customer'}`, actionPath: staffRequestPath(context.id, 'conversation'), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, messages: 1, files: 0, preview: messagePreview(message.body) } })),
      resolutions,
    };
  }

  if (!context.customerUserId || context.customerUserId === actorId) return NO_INBOX_EFFECTS;
  return {
    intents: [{ recipientId: context.customerUserId, kind: 'team.activity', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `team-activity:${context.id}`, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined, messages: 1, files: 0, preview: messagePreview(message.body) } }],
    resolutions: [],
  };
}

export async function fileAvailableEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const fileId = uuidOf(event.payload.fileId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!fileId || !requestId) return NO_INBOX_EFFECTS;
  const file = await tx.fileAttachment.findUnique({ where: { id: fileId }, select: { originalFileName: true, visibility: true, status: true, uploadedBy: { select: { id: true, displayName: true, type: true } } } });
  if (!file || file.status !== 'AVAILABLE') return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const uploaderId = file.uploadedBy.id;
  const preview = filePreview(file.originalFileName);
  if (file.uploadedBy.type === 'CUSTOMER') {
    const staff = await staffAudienceFor(tx, context, uploaderId);
    return {
      intents: staff.map((user): InboxIntent => ({ recipientId: user.id, kind: 'customer.activity', priority: 'HIGH', quoteRequestId: context.id, actorId: uploaderId, groupKey: `activity:${context.id}:${uploaderId}`, actionPath: staffRequestPath(context.id, 'files'), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName: file.uploadedBy.displayName, messages: 0, files: 1, preview } })),
      resolutions: [],
    };
  }
  // Archivos internos: nunca llegan al cliente, y entre el equipo no generan aviso.
  if (file.visibility !== 'CUSTOMER' || !context.customerUserId) return NO_INBOX_EFFECTS;
  return {
    intents: [{ recipientId: context.customerUserId, kind: 'team.activity', priority: 'HIGH', quoteRequestId: context.id, actorId: uploaderId, groupKey: `team-activity:${context.id}`, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined, messages: 0, files: 1, preview } }],
    resolutions: [],
  };
}
```

En `src/server/modules/inbox/rules/index.ts`:
- Agrega `import { fileAvailableEffects, messageCreatedEffects } from './messages';`.
- Renombra el parámetro `_now` a `now`.
- Agrega estos casos al `switch`:

```ts
    case 'MESSAGE.CREATED': return messageCreatedEffects(tx, event, now);
    case 'FILE.AVAILABLE': return fileAvailableEffects(tx, event);
```

- [ ] **Step 4: Archivos por el emisor único**

En `src/server/modules/private-files/service.ts`:
- Agrega `import { recordDomainEvent } from '@/server/modules/inbox/domain-events';`.
- Reemplaza la función `outbox` completa por:

```ts
async function outbox(transaction: Prisma.TransactionClient, eventType: string, attachment: { id: string; quoteRequestId: string; visibility: FileVisibility; category: FileCategory }, actor: Actor | null, now: Date): Promise<void> {
  await recordDomainEvent(transaction, {
    actor: actor ? { userId: actor.userId, type: actor.type } : null,
    eventType,
    aggregateType: 'FILE_ATTACHMENT',
    aggregateId: attachment.id,
    payload: { fileId: attachment.id, quoteRequestId: attachment.quoteRequestId, visibility: attachment.visibility, category: attachment.category },
  }, { now });
}
```

Actualiza las cuatro llamadas:

```ts
    await outbox(transaction, 'FILE.UPLOAD_RESERVED', created, actor, now);
```
```ts
    if (scanResult.status === 'PASSED') await outbox(transaction, 'FILE.AVAILABLE', updated, actor, now);
```
```ts
    await outbox(transaction, 'FILE.DELETED', updated, actor, now);
```
```ts
      await outbox(transaction, 'FILE.RESERVATION_EXPIRED', updated, null, now);
```

- [ ] **Step 5: Correr las pruebas**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-messages.test.ts tests/integration/messaging-service.test.ts tests/integration/private-files-service.test.ts tests/integration/messaging-api.test.ts --maxWorkers=1`
Expected: todo en PASS; `inbox-messages` con 7 tests.

- [ ] **Step 6: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/lib/change-request.ts src/server/modules/inbox/rules src/server/modules/private-files/service.ts tests/unit/change-request.test.ts tests/integration/inbox-messages.test.ts
git commit -m "feat(inbox): actividad agrupada del cliente, respuestas del equipo, notas internas y cambios pedidos"
```

---

### Task 6: Reglas de cotizaciones y aprobaciones

**Files:**
- Create: `src/server/modules/inbox/rules/quotes.ts`
- Modify: `src/server/modules/inbox/rules/index.ts`
- Modify: `src/server/modules/quotes/service.ts`, que tiene 4 emisores.
- Modify: `src/server/modules/quotes/approval-service.ts`, que tiene 2 emisores.
- Modify: `src/server/modules/quote-documents/acceptance-service.ts`, que tiene 1 emisor.
- Test: `tests/integration/inbox-quotes.test.ts`

**Interfaces:**
- Consumes (Task 4): `APPROVER_PERMISSIONS`, `MANAGER_PERMISSIONS`, `PRICE_MANAGER_PERMISSIONS`, `STAFF_APPROVALS_PATH`, `STAFF_PENDING_PRICES_PATH` y `textOf`. De la tarea 2 usa `totalLabel`.
- Produces:
  - `quotePublishedEffects`, `quoteReturnedEffects`, `quoteDraftSavedEffects`, `approvalRequestedEffects`, `approvalResolvedEffects` y `quoteAcceptedEffects`.
  - El payload de las transiciones de versión (`performQuoteVersionTransition`) incluye `reason`.

- [ ] **Step 1: Escribir la prueba**

Crear `tests/integration/inbox-quotes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { applyInboxEffects } from '@/server/modules/inbox/record';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('inbox rules for quotes and approvals', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let authorId = '';
  let approverId = '';
  let managerId = '';
  let pricingId = '';
  let customerId = '';
  let quoteId = '';
  let sentVersionId = '';
  let draftVersionId = '';
  let priceListId = '';
  let catalogItemId = '';

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function user(name: string, type: 'EMPLOYEE' | 'CUSTOMER', roleId?: string): Promise<string> {
    const email = `inbox-quote-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type, status: 'ACTIVE', ...(type === 'CUSTOMER' ? { clientId } : {}), ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(created.id);
    return created.id;
  }

  const approval = (status: 'REQUESTED' | 'SUPERSEDED' | 'APPROVED', digestChar: string) => prisma.quoteApproval.create({ data: { quoteId, quoteVersionId: sentVersionId, type: 'DISCOUNT', status, policyVersion: 'policy-test', digest: digestChar.repeat(64), requestedById: authorId } });
  const event = (eventType: string, actor: { userId: string; type: 'EMPLOYEE' | 'CUSTOMER' } | null, payload: Record<string, unknown>) => prisma.$transaction((tx) => notifyInbox(tx, { actor, eventType, aggregateType: 'QUOTE', aggregateId: quoteId, payload: { quoteId, quoteRequestId: requestId, folio, ...payload } }, { now }));
  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-quotes-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Juan ${suffix}`, email: `inbox-quote-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Culiacán', description: 'Fixture de reglas de cotizaciones', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId }, select: { folio: true } })).folio;
    authorId = await user('author', 'EMPLOYEE', await role('inbox-quote-sales', ['quotes.create']));
    approverId = await user('approver', 'EMPLOYEE', await role('inbox-quote-approver', ['quotes.approve_discount']));
    managerId = await user('manager', 'EMPLOYEE', await role('inbox-quote-manager', ['requests.read.global']));
    pricingId = await user('pricing', 'EMPLOYEE', await role('inbox-quote-pricing', ['prices.manage']));
    customerId = await user('customer', 'CUSTOMER');
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: authorId } });
    const quote = await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } });
    quoteId = quote.id;
    sentVersionId = (await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 1, status: 'ENVIADA', currencyCode: 'MXN', subtotalMinor: 48_500_000n, taxableTotalMinor: 48_500_000n, totalMinor: 48_500_000n, createdById: authorId } })).id;
    priceListId = (await prisma.priceList.create({ data: { code: `INBOX-${suffix}`, name: `Lista ${suffix}`, currencyCode: 'MXN' } })).id;
    catalogItemId = (await prisma.catalogItem.create({ data: { code: `INBOX-ITEM-${suffix}`, name: `Bomba ${suffix}`, unit: 'pieza' } })).id;
    draftVersionId = (await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 2, status: 'BORRADOR', currencyCode: 'MXN', createdById: authorId, sourcePriceListId: priceListId } })).id;
    await prisma.quoteLineSnapshot.create({ data: { quoteVersionId: draftVersionId, position: 0, catalogItemId, catalogItemCode: `INBOX-ITEM-${suffix}`, name: `Bomba ${suffix}`, unit: 'pieza', quantityMilliunits: 1000n, currencyCode: 'MXN', unitPriceMinor: 0n, pricePending: true } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.catalogItem.deleteMany({ where: { id: catalogItemId } });
    await prisma.priceList.deleteMany({ where: { id: priceListId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('tells the customer a proposal is ready and closes pending change requests', async () => {
    await prisma.$transaction((tx) => applyInboxEffects(tx, { intents: [{ recipientId: authorId, kind: 'quote.changes_requested', priority: 'URGENT', quoteRequestId: requestId, actorId: customerId, groupKey: `changes:${requestId}`, actionPath: '/staff/requests', actionRequired: true, data: { versionNumber: 1 } }], resolutions: [] }, now));
    await event('QUOTE.PUBLISHED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, fromStatus: 'EN_REVISION', toStatus: 'ENVIADA' });
    expect(await inboxOf(customerId)).toEqual([expect.objectContaining({ kind: 'quote.ready', title: 'Tu propuesta V1 está lista', body: `Total: MXN 485,000.00 · ${folio}` })]);
    expect((await inboxOf(authorId)).find((row) => row.kind === 'quote.changes_requested')).toMatchObject({ resolvedNote: 'Se envió la propuesta V1' });
  });

  it('asks approvers to decide, drops superseded requests and tells the requester the outcome', async () => {
    const first = await approval('REQUESTED', 'a');
    await event('QUOTE.APPROVAL_REQUESTED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, versionNumber: 1, approvalId: first.id, type: 'DISCOUNT' });
    expect((await inboxOf(approverId)).find((row) => row.groupKey === `approval:${first.id}`)).toMatchObject({ kind: 'approval.requested', actionRequired: true, title: `author ${suffix} pide aprobar un descuento en ${folio}` });
    expect((await inboxOf(authorId)).some((row) => row.kind === 'approval.requested')).toBe(false);

    await prisma.quoteApproval.update({ where: { id: first.id }, data: { status: 'SUPERSEDED' } });
    const second = await approval('REQUESTED', 'b');
    await event('QUOTE.APPROVAL_REQUESTED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, versionNumber: 1, approvalId: second.id, type: 'DISCOUNT' });
    expect((await inboxOf(approverId)).find((row) => row.groupKey === `approval:${first.id}`)).toMatchObject({ resolvedNote: 'Ya no aplica: la cotización cambió' });

    await prisma.quoteApproval.update({ where: { id: second.id }, data: { status: 'APPROVED', decidedById: approverId, decidedAt: now } });
    await event('QUOTE.APPROVAL_RESOLVED', { userId: approverId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, versionNumber: 1, approvalId: second.id, status: 'APPROVED', type: 'DISCOUNT' });
    expect((await inboxOf(authorId)).find((row) => row.kind === 'approval.resolved')).toMatchObject({ title: `approver ${suffix} aprobó tu descuento en ${folio}`, body: 'Ya puedes enviar la propuesta V1' });
    expect((await inboxOf(approverId)).find((row) => row.groupKey === `approval:${second.id}`)).toMatchObject({ resolvedNote: 'La aprobaste' });
  });

  it('tells the author when a version is sent back with its reason', async () => {
    await event('QUOTE.VERSION_REOPENED', { userId: approverId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, fromStatus: 'EN_REVISION', toStatus: 'BORRADOR', reason: 'Falta el calentador' });
    expect((await inboxOf(authorId)).find((row) => row.kind === 'quote.returned')).toMatchObject({ title: `approver ${suffix} devolvió a borrador la propuesta V1 de ${folio}`, body: 'Motivo: Falta el calentador' });
  });

  it('asks price managers for a missing price once, however often the draft autosaves', async () => {
    for (let save = 0; save < 2; save += 1) await event('QUOTE.VERSION_UPDATED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: draftVersionId, versionNumber: 2 });
    const pending = (await inboxOf(pricingId)).filter((row) => row.kind === 'price.pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ occurrences: 1, actionRequired: true, groupKey: `price:${priceListId}:${catalogItemId}`, title: `Bomba ${suffix} necesita precio en Lista ${suffix}`, body: `Lo espera ${folio}` });
  });

  it('celebrates an acceptance with the assignee and managers', async () => {
    await event('QUOTE.ACCEPTED', { userId: customerId, type: 'CUSTOMER' }, { quoteVersionId: sentVersionId, versionNumber: 1 });
    for (const recipientId of [authorId, managerId]) {
      expect((await inboxOf(recipientId)).find((row) => row.kind === 'quote.accepted'), recipientId).toMatchObject({ priority: 'URGENT', title: `customer ${suffix} aceptó la propuesta V1`, body: 'Total aceptado: MXN 485,000.00' });
    }
    expect((await inboxOf(customerId)).some((row) => row.kind === 'quote.accepted')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-quotes.test.ts`
Expected: FAIL. `inboxOf(customerId)` está vacío en la primera prueba.

- [ ] **Step 3: Implementar las reglas**

Crear `src/server/modules/inbox/rules/quotes.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { activeEmployees, activeStaffWithPermissions, APPROVER_PERMISSIONS, displayNameOf, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, PRICE_MANAGER_PERMISSIONS, textOf, uuidOf } from '../audience';
import { totalLabel } from '../format';
import { customerRequestPath, STAFF_APPROVALS_PATH, STAFF_PENDING_PRICES_PATH, staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent, type InboxResolution } from '../record';
import type { DomainEventInput } from './types';

async function loadVersion(tx: Prisma.TransactionClient, versionId: string | null) {
  if (!versionId) return null;
  return tx.quoteVersion.findUnique({ where: { id: versionId }, select: { id: true, versionNumber: true, totalMinor: true, currencyCode: true, createdById: true } });
}

/** Aprobaciones que dejaron de aplicar porque la versión cambió: su aviso a quienes aprueban se cierra. */
async function staleApprovalResolutions(tx: Prisma.TransactionClient, quoteVersionId: string, keepApprovalId?: string): Promise<InboxResolution[]> {
  const stale = await tx.quoteApproval.findMany({ where: { quoteVersionId, status: { in: ['SUPERSEDED', 'CANCELLED'] }, ...(keepApprovalId ? { id: { not: keepApprovalId } } : {}) }, select: { id: true } });
  return stale.map((approval) => ({ groupKey: `approval:${approval.id}`, note: 'Ya no aplica: la cotización cambió' }));
}

export async function quotePublishedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const intents: InboxIntent[] = context.customerUserId && context.customerUserId !== actorId
    ? [{ recipientId: context.customerUserId, kind: 'quote.ready', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: customerRequestPath(context.id), actionRequired: false, data: { folio: context.folio, projectType: context.projectType ?? undefined, versionNumber: version.versionNumber, totalLabel: `Total: ${totalLabel(version.totalMinor, version.currencyCode)}` } }]
    : [];
  return { intents, resolutions: [{ groupKey: `changes:${context.id}`, note: `Se envió la propuesta V${version.versionNumber}` }] };
}

export async function quoteReturnedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const recipients = excludeUser(await activeEmployees(tx, [version.createdById, context.assigneeId]), actorId);
  const outcome = event.eventType === 'QUOTE.VERSION_REJECTED' ? 'REJECTED' : 'REOPENED';
  return {
    intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.returned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data: { folio: context.folio, actorName, versionNumber: version.versionNumber, reason: textOf(event.payload.reason), outcome } })),
    resolutions: await staleApprovalResolutions(tx, version.id),
  };
}

/** Cada guardado del borrador (incluido el autoguardado): conceptos "por cotizar" y aprobaciones que dejaron de aplicar. */
export async function quoteDraftSavedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const versionId = uuidOf(event.payload.quoteVersionId);
  const folio = textOf(event.payload.folio);
  if (!requestId || !versionId || !folio) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const lines = await tx.quoteLineSnapshot.findMany({
    where: { quoteVersionId: versionId, pricePending: true, catalogItemId: { not: null }, quoteVersion: { status: 'BORRADOR' } },
    select: { catalogItem: { select: { id: true, name: true } }, quoteVersion: { select: { sourcePriceList: { select: { id: true, name: true, status: true } } } } },
  });
  const pairs = new Map<string, { listId: string; listName: string; itemId: string; itemName: string }>();
  for (const line of lines) {
    const list = line.quoteVersion.sourcePriceList;
    if (!line.catalogItem || !list || list.status !== 'ACTIVE') continue;
    pairs.set(`${list.id}:${line.catalogItem.id}`, { listId: list.id, listName: list.name, itemId: line.catalogItem.id, itemName: line.catalogItem.name });
  }
  const managers = pairs.size > 0 ? excludeUser(await activeStaffWithPermissions(tx, PRICE_MANAGER_PERMISSIONS), actorId) : [];
  const intents = [...pairs.values()].flatMap((pair) => managers.map((user): InboxIntent => ({ recipientId: user.id, kind: 'price.pending', priority: 'NORMAL', quoteRequestId: null, actorId, groupKey: `price:${pair.listId}:${pair.itemId}`, actionPath: STAFF_PENDING_PRICES_PATH, actionRequired: true, data: { itemName: pair.itemName, priceListName: pair.listName, requestIds: [requestId], requestFolios: [folio] } })));
  return { intents, resolutions: await staleApprovalResolutions(tx, versionId) };
}

export async function approvalRequestedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const approvalId = uuidOf(event.payload.approvalId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!approvalId || !requestId) return NO_INBOX_EFFECTS;
  const approval = await tx.quoteApproval.findUnique({ where: { id: approvalId }, select: { id: true, status: true, type: true, requestedById: true, quoteVersionId: true, quoteVersion: { select: { versionNumber: true } } } });
  if (!approval || approval.status !== 'REQUESTED') return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? approval.requestedById;
  const actorName = (await displayNameOf(tx, approval.requestedById)) ?? 'Alguien del equipo';
  const approvers = excludeUser(excludeUser(await activeStaffWithPermissions(tx, APPROVER_PERMISSIONS), approval.requestedById), actorId);
  return {
    intents: approvers.map((user): InboxIntent => ({ recipientId: user.id, kind: 'approval.requested', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: `approval:${approval.id}`, actionPath: STAFF_APPROVALS_PATH, actionRequired: true, data: { folio: context.folio, clientName: context.clientName, actorName, versionNumber: approval.quoteVersion.versionNumber, approvalType: approval.type } })),
    resolutions: await staleApprovalResolutions(tx, approval.quoteVersionId, approval.id),
  };
}

export async function approvalResolvedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const approvalId = uuidOf(event.payload.approvalId);
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!approvalId || !requestId) return NO_INBOX_EFFECTS;
  const approval = await tx.quoteApproval.findUnique({ where: { id: approvalId }, select: { id: true, status: true, type: true, reason: true, requestedById: true, quoteVersion: { select: { versionNumber: true } } } });
  if (!approval || (approval.status !== 'APPROVED' && approval.status !== 'REJECTED')) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Gerencia';
  const approved = approval.status === 'APPROVED';
  const requester = excludeUser(await activeEmployees(tx, [approval.requestedById]), actorId);
  return {
    intents: requester.map((user): InboxIntent => ({ recipientId: user.id, kind: 'approval.resolved', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id, 'quote'), actionRequired: false, data: { folio: context.folio, actorName, versionNumber: approval.quoteVersion.versionNumber, approvalType: approval.type, approvalStatus: approval.status, reason: approved ? undefined : approval.reason ?? undefined } })),
    resolutions: [{ groupKey: `approval:${approval.id}`, note: approved ? `Aprobada por ${actorName}` : `Rechazada por ${actorName}`, actorId, actorNote: approved ? 'La aprobaste' : 'La rechazaste' }],
  };
}

export async function quoteAcceptedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  const version = await loadVersion(tx, uuidOf(event.payload.quoteVersionId));
  if (!requestId || !version) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? context.contactName;
  const recipients = excludeUser([...(await activeEmployees(tx, [context.assigneeId])), ...(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS))], actorId);
  return {
    intents: recipients.map((user): InboxIntent => ({ recipientId: user.id, kind: 'quote.accepted', priority: 'URGENT', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffRequestPath(context.id), actionRequired: false, data: { folio: context.folio, clientName: context.clientName, actorName, versionNumber: version.versionNumber, totalLabel: `Total aceptado: ${totalLabel(version.totalMinor, version.currencyCode)}` } })),
    resolutions: [{ groupKey: `changes:${context.id}`, note: 'El cliente aceptó la propuesta' }],
  };
}
```

En `src/server/modules/inbox/rules/index.ts`, agrega el import y los casos:

```ts
import { approvalRequestedEffects, approvalResolvedEffects, quoteAcceptedEffects, quoteDraftSavedEffects, quotePublishedEffects, quoteReturnedEffects } from './quotes';
```
```ts
    case 'QUOTE.PUBLISHED': return quotePublishedEffects(tx, event);
    case 'QUOTE.VERSION_REOPENED':
    case 'QUOTE.VERSION_REJECTED': return quoteReturnedEffects(tx, event);
    case 'QUOTE.VERSION_CREATED':
    case 'QUOTE.VERSION_UPDATED': return quoteDraftSavedEffects(tx, event);
    case 'QUOTE.APPROVAL_REQUESTED': return approvalRequestedEffects(tx, event);
    case 'QUOTE.APPROVAL_RESOLVED': return approvalResolvedEffects(tx, event);
    case 'QUOTE.ACCEPTED': return quoteAcceptedEffects(tx, event);
```

- [ ] **Step 4: Pasar los emisores al emisor único**

En `src/server/modules/quotes/service.ts`, agrega `import { recordDomainEvent } from '@/server/modules/inbox/domain-events';` y reemplaza estos cuatro emisores.

1. `createQuoteVersion`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'QUOTE.VERSION_CREATED',
      aggregateType: 'QUOTE',
      aggregateId: quote.id,
      payload: { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId, folio: request.folio, versionNumber },
    }, { now });
```

2. `replaceQuoteDraft`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'QUOTE.VERSION_UPDATED',
      aggregateType: 'QUOTE',
      aggregateId: version.quoteId,
      payload: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: version.quoteRequestId, folio: version.folio, versionNumber: version.versionNumber },
    }, { now });
```

3. `performQuoteVersionTransition`. Este payload agrega `reason`:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: outboxEventType,
      aggregateType: 'QUOTE',
      aggregateId: version.quoteId,
      payload: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: version.quoteRequestId, folio: version.folio, fromStatus: version.status, toStatus, reason: options.reason ?? null },
    }, { now });
```

4. En la misma función, reemplaza el cambio de estado del expediente al enviar (`REQUEST.STATUS_CHANGED` a `COTIZACION_DISPONIBLE`):

```ts
      await recordDomainEvent(transaction, { actor: { userId: actor.userId, type: 'EMPLOYEE' }, eventType: 'REQUEST.STATUS_CHANGED', aggregateType: 'QUOTE_REQUEST', aggregateId: version.quoteRequestId, payload: { quoteRequestId: version.quoteRequestId, folio: version.folio, fromStatus: version.requestStatus, toStatus: 'COTIZACION_DISPONIBLE' } }, { now });
```

En `src/server/modules/quotes/approval-service.ts`, agrega el mismo import y reemplaza:

```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'QUOTE.APPROVAL_REQUESTED',
      aggregateType: 'QUOTE',
      aggregateId: version.quoteId,
      payload: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: row.quoteRequestId, folio: row.folio, versionNumber: version.versionNumber, approvalId: approval.id, type: normalized.type },
    }, { now });
```
```ts
    await recordDomainEvent(transaction, {
      actor: { userId: actor.userId, type: 'EMPLOYEE' },
      eventType: 'QUOTE.APPROVAL_RESOLVED',
      aggregateType: 'QUOTE',
      aggregateId: row.quoteId,
      payload: { quoteId: row.quoteId, quoteVersionId: row.quoteVersionId, quoteRequestId: quoteContext.quoteRequestId, folio: quoteContext.quoteRequest.folio, versionNumber: versionContext.versionNumber, approvalId: approval.id, status: input.decision, type: row.type },
    }, { now });
```

En `src/server/modules/quote-documents/acceptance-service.ts`, dentro de `writeAcceptanceEvents`:
- Agrega el import de `recordDomainEvent`.
- Reemplaza el `outboxEvent.create` de `QUOTE.ACCEPTED`.
- Borra la línea `void now;`: ahora `now` se usa.

```ts
  await recordDomainEvent(transaction, {
    actor: { userId: actor.userId, type: actor.type },
    eventType: 'QUOTE.ACCEPTED',
    aggregateType: 'QUOTE',
    aggregateId: quote.id,
    payload: { quoteId: quote.id, quoteVersionId, quoteRequestId: quote.quoteRequestId, folio: quote.folio, versionNumber, acceptanceId: acceptance.id, generatedDocumentId: acceptance.generatedDocumentId, termsVersion: acceptance.termsVersion },
  }, { now });
```

- [ ] **Step 5: Correr las pruebas**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-quotes.test.ts tests/integration/quotes-service.test.ts tests/integration/quote-acceptance-service.test.ts tests/integration/project-auto-conversion.test.ts tests/integration/notifications-fanout.test.ts --maxWorkers=1`
Expected: todo en PASS; `inbox-quotes` con 5 tests.

- [ ] **Step 6: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/server/modules/inbox/rules src/server/modules/quotes/service.ts src/server/modules/quotes/approval-service.ts src/server/modules/quote-documents/acceptance-service.ts tests/integration/inbox-quotes.test.ts
git commit -m "feat(inbox): propuesta lista, aprobaciones que se cierran solas, devoluciones, precios por asignar y aceptación"
```

---

### Task 7: Proyectos, reasignación de trabajo, precios asignados y contrato del emisor

**Files:**
- Create: `src/server/modules/inbox/rules/projects.ts`
- Create: `src/server/modules/inbox/rules/prices.ts`
- Modify: `src/server/modules/inbox/rules/index.ts`
- Modify: `src/server/modules/projects/service.ts`, `src/server/modules/team/service.ts` y `src/server/modules/catalog/service.ts`
- Test: `tests/integration/inbox-projects-team-prices.test.ts`
- Test: `tests/unit/inbox-emission-contract.test.ts`

**Interfaces:**
- Consumes (Task 4): `notifyInbox`, `recordDomainEvent`, `staffProjectPath` y `numberOf`.
- Produces:
  - `projectCreatedEffects`, `projectOwnerChangedEffects`, `workReassignedEffects` y `pendingPriceResolvedEffects`.
  - Eventos solo de bandeja: `PROJECT.OWNER_CHANGED` `{ projectId, ownerId }`, `TEAM.WORK_REASSIGNED` `{ heirId, fromName, requestsCount, projectsCount }` y `PRICES.PENDING_RESOLVED` `{ priceListId, catalogItemId }`.
  - El payload de `PROJECT.CREATED` agrega `source` y `ownerId`.

- [ ] **Step 1: Escribir la prueba de integración**

Crear `tests/integration/inbox-projects-team-prices.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('inbox rules for projects, reassigned work and prices', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let ownerId = '';
  let managerId = '';
  let otherManagerId = '';
  let heirId = '';
  let pricingId = '';
  let customerId = '';
  let quoteId = '';
  let storageObjectId = '';
  let projectId = '';
  let priceListId = '';
  let catalogItemId = '';

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function user(name: string, type: 'EMPLOYEE' | 'CUSTOMER', roleId?: string): Promise<string> {
    const email = `inbox-ptp-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type, status: 'ACTIVE', ...(type === 'CUSTOMER' ? { clientId } : {}), ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(created.id);
    return created.id;
  }

  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
  const signal = (eventType: string, actor: { userId: string; type: 'EMPLOYEE' } | null, payload: Record<string, unknown>) => prisma.$transaction((tx) => notifyInbox(tx, { actor, eventType, aggregateType: 'TEST', aggregateId: null, payload }, { now }));

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-ptp-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Cliente ${suffix}`, email: `inbox-ptp-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Mazatlán', description: 'Fixture de proyectos', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const managerRole = await role('inbox-ptp-manager', ['requests.read.global']);
    ownerId = await user('owner', 'EMPLOYEE');
    managerId = await user('manager', 'EMPLOYEE', managerRole);
    otherManagerId = await user('othermanager', 'EMPLOYEE', managerRole);
    heirId = await user('heir', 'EMPLOYEE');
    pricingId = await user('pricing', 'EMPLOYEE', await role('inbox-ptp-pricing', ['prices.manage']));
    customerId = await user('customer', 'CUSTOMER');
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: ownerId } });
    const quote = await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } });
    quoteId = quote.id;
    const version = await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 1, status: 'ACEPTADA', currencyCode: 'MXN', totalMinor: 100_000n, createdById: ownerId } });
    const storage = await prisma.storageObject.create({ data: { storageKey: `private-files/inbox-ptp/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 10n, sha256: 'e'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = storage.id;
    const document = await prisma.generatedDocument.create({ data: { quoteId, quoteVersionId: version.id, storageObjectId: storage.id, templateVersion: 'quote-pdf-test', status: 'READY', byteSize: 10n, sha256: 'e'.repeat(64), generatedAt: now, readyAt: now } });
    const acceptance = await prisma.quoteAcceptance.create({ data: { quoteId, quoteVersionId: version.id, generatedDocumentId: document.id, acceptedById: customerId, documentSha256: 'e'.repeat(64), signerName: 'Cliente', termsVersion: 'terms-test', idempotencyKeyHash: 'f'.repeat(64) } });
    projectId = (await prisma.project.create({ data: { folio: `OCP-${suffix}`, quoteAcceptanceId: acceptance.id, quoteRequestId: requestId, clientId, contactId, ownerId, createdById: managerId } })).id;
    priceListId = (await prisma.priceList.create({ data: { code: `INBOX-PTP-${suffix}`, name: `Lista ${suffix}`, currencyCode: 'MXN' } })).id;
    catalogItemId = (await prisma.catalogItem.create({ data: { code: `INBOX-PTP-ITEM-${suffix}`, name: `Filtro ${suffix}`, unit: 'pieza' } })).id;
    const draft = await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 2, status: 'BORRADOR', currencyCode: 'MXN', createdById: ownerId, sourcePriceListId: priceListId } });
    await prisma.quoteLineSnapshot.create({ data: { quoteVersionId: draft.id, position: 0, catalogItemId, name: `Filtro ${suffix}`, unit: 'pieza', quantityMilliunits: 1000n, currencyCode: 'MXN', unitPriceMinor: 0n, pricePending: true } });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.quoteAcceptance.deleteMany({ where: { quoteId } });
    await prisma.generatedDocument.deleteMany({ where: { quoteId } });
    await prisma.storageObject.deleteMany({ where: { id: storageObjectId } });
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.catalogItem.deleteMany({ where: { id: catalogItemId } });
    await prisma.priceList.deleteMany({ where: { id: priceListId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('announces a manually created project to its owner, other managers and the customer', async () => {
    await signal('PROJECT.CREATED', { userId: managerId, type: 'EMPLOYEE' }, { projectId, folio: `OCP-${suffix}`, quoteRequestId: requestId, source: 'staff', ownerId });
    expect((await inboxOf(ownerId)).map((row) => row.kind)).toEqual(['project.assigned']);
    expect((await inboxOf(otherManagerId)).find((row) => row.kind === 'project.created')).toMatchObject({ title: `manager ${suffix} creó el proyecto OCP-${suffix}` });
    expect(await inboxOf(managerId)).toHaveLength(0);
    expect((await inboxOf(customerId)).find((row) => row.kind === 'project.started')).toMatchObject({ title: `Tu proyecto OCP-${suffix} arrancó`, body: `Tu responsable es owner ${suffix}` });
  });

  it('does not repeat the acceptance for the owner when the customer accepted', async () => {
    await prisma.inboxNotification.deleteMany({ where: { recipientId: { in: [ownerId, otherManagerId, customerId] } } });
    await signal('PROJECT.CREATED', null, { projectId, folio: `OCP-${suffix}`, quoteRequestId: requestId, source: 'customer_acceptance', ownerId });
    expect(await inboxOf(ownerId)).toHaveLength(0);
    expect(await inboxOf(otherManagerId)).toHaveLength(0);
    expect((await inboxOf(customerId)).map((row) => row.kind)).toEqual(['project.started']);
  });

  it('tells a new project owner and whoever inherits a suspended colleague\'s work', async () => {
    await signal('PROJECT.OWNER_CHANGED', { userId: managerId, type: 'EMPLOYEE' }, { projectId, ownerId: heirId });
    await signal('TEAM.WORK_REASSIGNED', { userId: managerId, type: 'EMPLOYEE' }, { heirId, fromName: `owner ${suffix}`, requestsCount: 3, projectsCount: 1 });
    const kinds = await inboxOf(heirId);
    expect(kinds.find((row) => row.kind === 'project.assigned')).toMatchObject({ title: `Te asignaron el proyecto OCP-${suffix}` });
    expect(kinds.find((row) => row.kind === 'team.work_reassigned')).toMatchObject({ quoteRequestId: null, title: `Recibiste 3 expedientes y un proyecto de owner ${suffix}` });
  });

  it('closes the pending-price request and tells the draft author it can continue', async () => {
    const draft = await prisma.quoteVersion.findFirstOrThrow({ where: { quoteId, versionNumber: 2 } });
    const folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: ownerId, type: 'EMPLOYEE' }, eventType: 'QUOTE.VERSION_UPDATED', aggregateType: 'QUOTE', aggregateId: quoteId, payload: { quoteId, quoteVersionId: draft.id, quoteRequestId: requestId, folio, versionNumber: 2 } }, { now }));
    await signal('PRICES.PENDING_RESOLVED', { userId: pricingId, type: 'EMPLOYEE' }, { priceListId, catalogItemId });
    expect((await inboxOf(pricingId)).find((row) => row.kind === 'price.pending')).toMatchObject({ resolvedNote: 'Le asignaste precio' });
    expect((await inboxOf(ownerId)).find((row) => row.kind === 'price.assigned')).toMatchObject({ title: `Filtro ${suffix} ya tiene precio en Lista ${suffix}`, body: `Tu propuesta ${folio} puede continuar` });
  });
});
```

- [ ] **Step 2: Escribir la prueba de contrato del emisor**

Crear `tests/unit/inbox-emission-contract.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve('src/server');
// Los únicos lugares donde se escribe el outbox a mano: autenticación (tokens cifrados), catálogo y
// conceptos especiales (sin avisos por persona), el PDF listo (interno) y el propio emisor único.
const ALLOWED = new Set([
  'auth/service.ts',
  'modules/catalog/service.ts',
  'modules/special-concepts/service.ts',
  'modules/quote-documents/service.ts',
  'modules/inbox/domain-events.ts',
].map((file) => path.join(ROOT, file)));

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('domain event emission contract', () => {
  it('routes every operational outbox event through recordDomainEvent', () => {
    const offenders = walk(ROOT)
      .filter((file) => file.endsWith('.ts') && !ALLOWED.has(file))
      .filter((file) => /outboxEvent\.create(Many)?\(/u.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).replaceAll('\\', '/'));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Correr ambas y confirmar que fallan**

Run: `npx vitest run tests/unit/inbox-emission-contract.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-projects-team-prices.test.ts`
Expected:
- El contrato falla con `['modules/projects/service.ts']`. Los demás emisores ya se migraron en las tareas 4 a 6.
- La integración falla porque no hay avisos de proyecto.

- [ ] **Step 4: Implementar las reglas**

Crear `src/server/modules/inbox/rules/projects.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { activeEmployees, activeStaffWithPermissions, displayNameOf, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, numberOf, textOf, uuidOf } from '../audience';
import { customerRequestPath, staffProjectPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent } from '../record';
import type { DomainEventInput } from './types';

export async function projectCreatedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const projectId = uuidOf(event.payload.projectId);
  if (!projectId) return NO_INBOX_EFFECTS;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, folio: true, ownerId: true, quoteRequestId: true, owner: { select: { displayName: true } } } });
  if (!project) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, project.quoteRequestId);
  if (!context) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const fromAcceptance = event.payload.source === 'customer_acceptance';
  const owner = (await activeEmployees(tx, [project.ownerId]))[0];
  const intents: InboxIntent[] = [];
  // Si nació de la aceptación del cliente y el dueño es el mismo responsable, `quote.accepted` ya le avisó.
  if (owner && owner.id !== actorId && !(fromAcceptance && owner.id === context.assigneeId)) {
    intents.push({ recipientId: owner.id, kind: 'project.assigned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffProjectPath(project.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, clientName: context.clientName, actorName } });
  }
  if (!fromAcceptance) {
    for (const manager of excludeUser(excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), actorId), owner?.id)) {
      intents.push({ recipientId: manager.id, kind: 'project.created', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffProjectPath(project.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, clientName: context.clientName, actorName, ownerName: project.owner?.displayName } });
    }
  }
  if (context.customerUserId && context.customerUserId !== actorId) {
    intents.push({ recipientId: context.customerUserId, kind: 'project.started', priority: 'NORMAL', quoteRequestId: context.id, actorId, groupKey: null, actionPath: customerRequestPath(context.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, ownerName: project.owner?.displayName } });
  }
  return { intents, resolutions: [] };
}

export async function projectOwnerChangedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const projectId = uuidOf(event.payload.projectId);
  const ownerId = uuidOf(event.payload.ownerId);
  const actorId = event.actor?.userId ?? null;
  if (!projectId || !ownerId || ownerId === actorId) return NO_INBOX_EFFECTS;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, folio: true, quoteRequestId: true } });
  if (!project) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, project.quoteRequestId);
  const owner = (await activeEmployees(tx, [ownerId]))[0];
  if (!context || !owner) return NO_INBOX_EFFECTS;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  return {
    intents: [{ recipientId: owner.id, kind: 'project.assigned', priority: 'HIGH', quoteRequestId: context.id, actorId, groupKey: null, actionPath: staffProjectPath(project.id), actionRequired: false, data: { projectFolio: project.folio, folio: context.folio, clientName: context.clientName, actorName } }],
    resolutions: [],
  };
}

export async function workReassignedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const heirId = uuidOf(event.payload.heirId);
  const requestsCount = numberOf(event.payload.requestsCount) ?? 0;
  const projectsCount = numberOf(event.payload.projectsCount) ?? 0;
  const actorId = event.actor?.userId ?? null;
  if (!heirId || heirId === actorId || requestsCount + projectsCount === 0) return NO_INBOX_EFFECTS;
  const heir = (await activeEmployees(tx, [heirId]))[0];
  if (!heir) return NO_INBOX_EFFECTS;
  return {
    intents: [{ recipientId: heir.id, kind: 'team.work_reassigned', priority: 'HIGH', quoteRequestId: null, actorId, groupKey: null, actionPath: '/staff/requests', actionRequired: false, data: { fromName: textOf(event.payload.fromName), actorName: (await displayNameOf(tx, actorId)) ?? undefined, requestsCount, projectsCount } }],
    resolutions: [],
  };
}
```

Crear `src/server/modules/inbox/rules/prices.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { activeEmployees, displayNameOf, uuidOf } from '../audience';
import { staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent } from '../record';
import type { DomainEventInput } from './types';

/** Un precio entró en vigor: cierra el pedido a quienes administran precios y avisa a cada borrador que lo esperaba. */
export async function pendingPriceResolvedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const priceListId = uuidOf(event.payload.priceListId);
  const catalogItemId = uuidOf(event.payload.catalogItemId);
  if (!priceListId || !catalogItemId) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const lines = await tx.quoteLineSnapshot.findMany({
    where: { pricePending: true, catalogItemId, quoteVersion: { status: 'BORRADOR', sourcePriceListId: priceListId } },
    select: { catalogItem: { select: { name: true } }, quoteVersion: { select: { createdById: true, sourcePriceList: { select: { name: true } }, quote: { select: { quoteRequest: { select: { id: true, folio: true, currentAssigneeId: true } } } } } } },
  });
  const intents: InboxIntent[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const request = line.quoteVersion.quote.quoteRequest;
    for (const user of await activeEmployees(tx, [line.quoteVersion.createdById, request.currentAssigneeId])) {
      const key = `${user.id}:${request.id}`;
      if (user.id === actorId || seen.has(key)) continue;
      seen.add(key);
      intents.push({ recipientId: user.id, kind: 'price.assigned', priority: 'NORMAL', quoteRequestId: request.id, actorId, groupKey: null, actionPath: staffRequestPath(request.id, 'quote'), actionRequired: false, data: { folio: request.folio, itemName: line.catalogItem?.name, priceListName: line.quoteVersion.sourcePriceList?.name, actorName } });
    }
  }
  return { intents, resolutions: [{ groupKey: `price:${priceListId}:${catalogItemId}`, note: `Precio asignado por ${actorName}`, actorId, actorNote: 'Le asignaste precio' }] };
}
```

En `src/server/modules/inbox/rules/index.ts`, agrega:

```ts
import { pendingPriceResolvedEffects } from './prices';
import { projectCreatedEffects, projectOwnerChangedEffects, workReassignedEffects } from './projects';
```
```ts
    case 'PROJECT.CREATED': return projectCreatedEffects(tx, event);
    case 'PROJECT.OWNER_CHANGED': return projectOwnerChangedEffects(tx, event);
    case 'TEAM.WORK_REASSIGNED': return workReassignedEffects(tx, event);
    case 'PRICES.PENDING_RESOLVED': return pendingPriceResolvedEffects(tx, event);
```

- [ ] **Step 5: Emisores de proyectos, equipo y precios**

En `src/server/modules/projects/service.ts`, agrega `import { notifyInbox, recordDomainEvent } from '@/server/modules/inbox/domain-events';`. Dentro de `createProjectFromAcceptance`, reemplaza los dos `outboxEvent.create` por lo de abajo. El proyecto que nace de la aceptación lo crea el sistema, así que su actor es `null`: el cliente sí recibe "Tu proyecto arrancó".

```ts
      const eventActor = input.source === 'customer_acceptance' ? null : { userId: input.createdById, type: 'EMPLOYEE' as const };
      await recordDomainEvent(transaction, {
        actor: eventActor,
        eventType: 'PROJECT.CREATED',
        aggregateType: 'PROJECT',
        aggregateId: project.id,
        payload: { projectId: project.id, folio: project.folio, quoteRequestId: acceptance.quote.quoteRequestId, source: input.source, ownerId },
      }, { now: input.now });
```
```ts
        await recordDomainEvent(transaction, { actor: eventActor, eventType: 'REQUEST.STATUS_CHANGED', aggregateType: 'QUOTE_REQUEST', aggregateId: acceptance.quote.quoteRequestId, payload: { quoteRequestId: acceptance.quote.quoteRequestId, folio: request.folio, fromStatus: 'ACEPTADA', toStatus: 'CONVERTIDA_EN_PROYECTO' } }, { now: input.now });
```

En `setProjectOwner`, justo después del `auditLog.create` de `project.owner_changed`:

```ts
    if (ownerId) await notifyInbox(transaction, { actor: { userId: actor.userId, type: 'EMPLOYEE' }, eventType: 'PROJECT.OWNER_CHANGED', aggregateType: 'PROJECT', aggregateId: projectId, payload: { projectId, ownerId } });
```

En `src/server/modules/team/service.ts`:
- Agrega `import { notifyInbox } from '@/server/modules/inbox/domain-events';`.
- En `suspendTeamMember`, justo antes de `await audit(transaction, actor, 'team.member_suspended', …)`, agrega:

```ts
    if (heir && requests.length + projects.length > 0) {
      await notifyInbox(transaction, { actor: { userId: actor.userId, type: 'EMPLOYEE' }, eventType: 'TEAM.WORK_REASSIGNED', aggregateType: 'USER', aggregateId: member.id, payload: { heirId: heir.id, fromName: member.displayName, requestsCount: requests.length, projectsCount: projects.length } }, { now });
    }
```

En `src/server/modules/catalog/service.ts`, agrega `import { notifyInbox } from '@/server/modules/inbox/domain-events';`.

En `upsertPriceListItem`:
- Agrega `const now = dependencies.now ?? new Date();` justo después de `const prisma = …`.
- Justo después de `await outbox(transaction, existing ? 'PRICES.ITEM_UPDATED' : 'PRICES.ITEM_CREATED', …);`, agrega:

```ts
      if (validFrom <= now && (!validUntil || validUntil > now)) {
        await notifyInbox(transaction, { actor: { userId: actor.userId, type: 'EMPLOYEE' }, eventType: 'PRICES.PENDING_RESOLVED', aggregateType: 'PRICE_LIST', aggregateId: listId, payload: { priceListId: listId, catalogItemId } }, { now });
      }
```

En `schedulePrice`:
- Agrega `const now = dependencies.now ?? new Date();` justo después de `const prisma = …`.
- Justo después de `await outbox(transaction, 'PRICES.ITEM_SCHEDULED', …);`, agrega:

```ts
      if (effectiveFrom <= now) {
        await notifyInbox(transaction, { actor: { userId: actor.userId, type: 'EMPLOYEE' }, eventType: 'PRICES.PENDING_RESOLVED', aggregateType: 'PRICE_LIST', aggregateId: listId, payload: { priceListId: listId, catalogItemId } }, { now });
      }
```

- [ ] **Step 6: Correr las pruebas**

Run: `npx vitest run tests/unit/inbox-emission-contract.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-projects-team-prices.test.ts tests/integration/projects-service.test.ts tests/integration/project-auto-conversion.test.ts tests/integration/team-service.test.ts tests/integration/catalog-service.test.ts tests/integration/catalog-schedule-price.test.ts --maxWorkers=1`
Expected: todo en PASS; el contrato devuelve `[]`.

- [ ] **Step 7: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/server/modules/inbox/rules src/server/modules/projects/service.ts src/server/modules/team/service.ts src/server/modules/catalog/service.ts tests/integration/inbox-projects-team-prices.test.ts tests/unit/inbox-emission-contract.test.ts
git commit -m "feat(inbox): proyectos, trabajo heredado y precios asignados; contrato del emisor único"
```

---

### Task 8: Servicio y API de la bandeja

**Files:**
- Create: `src/server/auth/session-actor.ts`
- Create: `src/server/modules/inbox/service.ts`
- Create: `src/app/api/notifications/route.ts`, `src/app/api/notifications/summary/route.ts` y `src/app/api/notifications/read/route.ts`
- Test: `tests/integration/inbox-api.test.ts`

**Interfaces:**
- Consumes (Task 3): `publishRealtime`. Usa `staffRequestReadScopeWhere` y `isInboxKind`.
- Produces:
  - `requireSessionActor(request): Promise<Actor>`.
  - `INBOX_FILTERS = ['all', 'unread', 'action']`.
  - `type InboxNotificationDto` y `type InboxSummary = { unread; actionRequired; latest: InboxNotificationDto[]; unreadByRequest: Record<string, number> }`.
  - `listInbox(actor, { filter?, cursor?, limit? })`, `getInboxSummary(actor)`, `getInboxCounts(actor)` y `markInboxRead(actor, input)`.
  - `inboxScopeWhere(actor)`.
  - Rutas:
    - `GET /api/notifications?filter=&cursor=&limit=` → `{ items, nextCursor }`.
    - `GET /api/notifications/summary` → `InboxSummary`.
    - `POST /api/notifications/read` → `{ updated, unread, actionRequired }`.

- [ ] **Step 1: Escribir la prueba de la API**

Crear `tests/integration/inbox-api.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { GET as listGet } from '@/app/api/notifications/route';
import { GET as summaryGet } from '@/app/api/notifications/summary/route';
import { POST as readPost } from '@/app/api/notifications/read/route';

describe('inbox API', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const userIds: string[] = [];
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  let salesId = '';
  let otherId = '';
  let customerId = '';
  let ownRequestId = '';
  let foreignRequestId = '';
  let salesToken = '';
  let customerToken = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: { ...(token ? { cookie: `ocpool_session=${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const notice = (recipientId: string, overrides: Record<string, unknown> = {}) => prisma.inboxNotification.create({ data: { recipientId, kind: 'customer.activity', priority: 'HIGH', title: 'Aviso', actionPath: '/staff/requests', data: { folio: 'OCQ-2026-000001', clientName: 'Cliente' }, ...overrides } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }), prisma.role.findUniqueOrThrow({ where: { key: 'customer' } })]);
    for (const [index, owner] of ['own', 'foreign'].entries()) {
      const request = await createQuoteRequest({ idempotencyKey: `inbox-api-${owner}-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `API ${owner}`, email: `inbox-api-${owner}-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Chihuahua', description: 'Fixture de la API de avisos', consentAt: now } }, { prisma, now: new Date(now.getTime() + index) });
      requestIds.push(request.quoteRequestId);
      clientIds.push(request.clientId);
      contactIds.push(request.contactId);
    }
    [ownRequestId, foreignRequestId] = requestIds;
    const sales = await prisma.user.create({ data: { email: `inbox-api-sales-${suffix}@example.test`, emailNormalized: `inbox-api-sales-${suffix}@example.test`, displayName: 'API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } });
    const other = await prisma.user.create({ data: { email: `inbox-api-other-${suffix}@example.test`, emailNormalized: `inbox-api-other-${suffix}@example.test`, displayName: 'API Other', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const customer = await prisma.user.create({ data: { email: `inbox-api-customer-${suffix}@example.test`, emailNormalized: `inbox-api-customer-${suffix}@example.test`, displayName: 'API Customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientIds[0], roles: { create: { roleId: customerRole.id } } } });
    salesId = sales.id;
    otherId = other.id;
    customerId = customer.id;
    userIds.push(salesId, otherId, customerId);
    await prisma.quoteRequest.update({ where: { id: ownRequestId }, data: { currentAssigneeId: salesId } });
    await prisma.quoteRequest.update({ where: { id: foreignRequestId }, data: { currentAssigneeId: otherId } });
    salesToken = `inbox-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    customerToken = `inbox-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'inbox-api-test' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'inbox-api-test' }, { prisma, tokenGenerator: () => customerToken });
    await notice(salesId, { quoteRequestId: ownRequestId, lastActivityAt: new Date(now.getTime() - 3000) });
    await notice(salesId, { quoteRequestId: foreignRequestId, title: 'Fuera de alcance' });
    await notice(salesId, { quoteRequestId: null, kind: 'request.unassigned_from_you', priority: 'NORMAL', title: 'Te quitaron un expediente', lastActivityAt: new Date(now.getTime() - 2000) });
    await notice(salesId, { quoteRequestId: ownRequestId, kind: 'approval.requested', priority: 'HIGH', actionRequired: true, groupKey: `approval:api-${suffix}`, title: 'Aprobación', lastActivityAt: new Date(now.getTime() - 1000) });
    await notice(salesId, { quoteRequestId: ownRequestId, kind: 'request.received', priority: 'INFO', title: 'Informativo', lastActivityAt: now });
    await notice(customerId, { quoteRequestId: ownRequestId, kind: 'team.activity', title: 'El equipo OCPOOL te escribió' });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  it('requires a session and never caches', async () => {
    expect((await summaryGet(endpoint('/api/notifications/summary'))).status).toBe(401);
    const response = await summaryGet(endpoint('/api/notifications/summary', salesToken));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('counts and lists only what the person can still see', async () => {
    const summary = await (await summaryGet(endpoint('/api/notifications/summary', salesToken))).json() as { unread: number; actionRequired: number; latest: Array<{ title: string }>; unreadByRequest: Record<string, number> };
    // El informativo no cuenta en la campana; el del expediente ajeno no se ve.
    expect(summary.unread).toBe(3);
    expect(summary.actionRequired).toBe(1);
    expect(summary.latest.map((item) => item.title)).not.toContain('Fuera de alcance');
    expect(summary.unreadByRequest[ownRequestId]).toBe(2);
    const customer = await (await summaryGet(endpoint('/api/notifications/summary', customerToken))).json() as { unread: number; latest: Array<{ title: string }> };
    expect(customer).toMatchObject({ unread: 1, latest: [{ title: 'El equipo OCPOOL te escribió' }] });
  });

  it('paginates by cursor and filters', async () => {
    const first = await (await listGet(endpoint('/api/notifications?limit=2', salesToken))).json() as { items: Array<{ title: string }>; nextCursor: string | null };
    expect(first.items.map((item) => item.title)).toEqual(['Informativo', 'Aprobación']);
    const second = await (await listGet(endpoint(`/api/notifications?limit=2&cursor=${first.nextCursor}`, salesToken))).json() as { items: Array<{ title: string }>; nextCursor: string | null };
    expect(second.items.map((item) => item.title)).toEqual(['Te quitaron un expediente', 'Aviso']);
    expect(second.nextCursor).toBeNull();
    const action = await (await listGet(endpoint('/api/notifications?filter=action', salesToken))).json() as { items: Array<{ title: string }> };
    expect(action.items.map((item) => item.title)).toEqual(['Aprobación']);
    expect((await listGet(endpoint('/api/notifications?filter=nope', salesToken))).status).toBe(400);
  });

  it('marks as read only from the same origin, per file or everything', async () => {
    expect((await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { all: true }, 'https://attacker.example'))).status).toBe(403);
    const byRequest = await (await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { quoteRequestId: ownRequestId, scope: 'activity' }))).json() as { updated: number; unread: number; actionRequired: number };
    // La aprobación pendiente sigue sin leer: abrir el expediente no la da por atendida.
    expect(byRequest).toMatchObject({ unread: 2, actionRequired: 1 });
    const all = await (await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { all: true }))).json() as { unread: number; actionRequired: number };
    expect(all).toMatchObject({ unread: 0, actionRequired: 1 });
    expect((await readPost(endpoint('/api/notifications/read', salesToken, 'POST', { ids: [] }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-api.test.ts`
Expected: FAIL. Vitest reporta "Failed to resolve import `@/app/api/notifications/route`".

- [ ] **Step 3: `requireSessionActor`**

Crear `src/server/auth/session-actor.ts`:

```ts
import type { NextRequest } from 'next/server';
import { sessionToken } from '@/server/auth/http';
import { getActorFromSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { AppError } from '@/server/http/errors';

/** Cualquier sesión válida (equipo o cliente). Los permisos de cada operación los exige el servicio. */
export async function requireSessionActor(request: NextRequest): Promise<Actor> {
  const token = sessionToken(request);
  if (!token) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  const actor = await getActorFromSession(token);
  if (!actor) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  return actor;
}
```

- [ ] **Step 4: Servicio de la bandeja**

Crear `src/server/modules/inbox/service.ts`:

```ts
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import { staffRequestReadScopeWhere } from '@/server/auth/request-scope';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { publishRealtime } from '@/server/realtime/publish';
import { isInboxKind, type InboxKind, type InboxPriority } from './kinds';

export const INBOX_FILTERS = ['all', 'unread', 'action'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export type InboxNotificationDto = Readonly<{
  id: string;
  kind: InboxKind;
  priority: InboxPriority;
  title: string;
  body: string | null;
  actionPath: string;
  quoteRequestId: string | null;
  folio: string | null;
  clientName: string | null;
  occurrences: number;
  actionRequired: boolean;
  createdAt: string;
  lastActivityAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
}>;

export type InboxCounts = Readonly<{ unread: number; actionRequired: number }>;
export type InboxSummary = InboxCounts & Readonly<{ latest: InboxNotificationDto[]; unreadByRequest: Record<string, number> }>;
export type InboxPage = Readonly<{ items: InboxNotificationDto[]; nextCursor: string | null }>;
export type MarkInboxReadInput =
  | Readonly<{ ids: readonly string[]; read?: boolean }>
  | Readonly<{ all: true }>
  | Readonly<{ quoteRequestId: string; scope: 'activity' | 'all' }>;

type Dependencies = Readonly<{ prisma?: PrismaClient; now?: Date }>;

const SUMMARY_LATEST = 20;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_IDS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Lo que cuenta la campana: sin leer, sin resolver y no informativo. */
const BADGE_WHERE: Prisma.InboxNotificationWhereInput = { readAt: null, resolvedAt: null, priority: { not: 'INFO' } };
/** "Sin leer" en la lista sí muestra lo informativo. */
const UNREAD_LIST_WHERE: Prisma.InboxNotificationWhereInput = { readAt: null, resolvedAt: null };
/** "Requieren acción": sin resolver, aunque ya se haya leído. */
const ACTION_WHERE: Prisma.InboxNotificationWhereInput = { actionRequired: true, resolvedAt: null };

const DTO_SELECT = {
  id: true, kind: true, priority: true, title: true, body: true, actionPath: true, quoteRequestId: true, data: true,
  occurrences: true, actionRequired: true, createdAt: true, lastActivityAt: true, readAt: true, resolvedAt: true, resolvedNote: true,
} as const;

type DtoRow = Prisma.InboxNotificationGetPayload<{ select: typeof DTO_SELECT }>;

function requireInboxActor(actor: Actor): void {
  if (actor.type !== 'CUSTOMER') return;
  if (!actor.clientId) throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'portal.self.read');
}

/** Cada quien ve lo suyo; el equipo, además, sólo mientras siga pudiendo abrir el expediente (spec §2.5). */
export function inboxScopeWhere(actor: Actor): Prisma.InboxNotificationWhereInput {
  if (actor.type !== 'EMPLOYEE') return { recipientId: actor.userId };
  return { recipientId: actor.userId, OR: [{ quoteRequestId: null }, { quoteRequest: { is: staffRequestReadScopeWhere(actor) } }] };
}

function toDto(row: DtoRow): InboxNotificationDto | null {
  if (!isInboxKind(row.kind)) return null;
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {};
  return {
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    body: row.body,
    actionPath: row.actionPath,
    quoteRequestId: row.quoteRequestId,
    folio: typeof data.folio === 'string' ? data.folio : null,
    clientName: typeof data.clientName === 'string' ? data.clientName : null,
    occurrences: row.occurrences,
    actionRequired: row.actionRequired,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedNote: row.resolvedNote,
  };
}

function encodeCursor(row: { lastActivityAt: Date; id: string }): string {
  return Buffer.from(`${row.lastActivityAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): { at: Date; id: string } | null {
  if (!value) return null;
  const [iso, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !id || !UUID_PATTERN.test(id)) throw new AppError('VALIDATION_ERROR', 'El cursor no es válido.', 400);
  return { at, id };
}

export async function getInboxCounts(actor: Actor, dependencies: Dependencies = {}): Promise<InboxCounts> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const scope = inboxScopeWhere(actor);
  const [unread, actionRequired] = await Promise.all([
    prisma.inboxNotification.count({ where: { AND: [scope, BADGE_WHERE] } }),
    prisma.inboxNotification.count({ where: { AND: [scope, ACTION_WHERE] } }),
  ]);
  return { unread, actionRequired };
}

export async function getInboxSummary(actor: Actor, dependencies: Dependencies = {}): Promise<InboxSummary> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const scope = inboxScopeWhere(actor);
  const [counts, latest, byRequest] = await Promise.all([
    getInboxCounts(actor, { prisma }),
    prisma.inboxNotification.findMany({ where: scope, orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }], take: SUMMARY_LATEST, select: DTO_SELECT }),
    prisma.inboxNotification.groupBy({ by: ['quoteRequestId'], where: { AND: [scope, BADGE_WHERE, { quoteRequestId: { not: null } }] }, _count: { _all: true } }),
  ]);
  const unreadByRequest: Record<string, number> = {};
  for (const group of byRequest) if (group.quoteRequestId) unreadByRequest[group.quoteRequestId] = group._count._all;
  return { ...counts, latest: latest.flatMap((row) => toDto(row) ?? []), unreadByRequest };
}

export async function listInbox(actor: Actor, input: Readonly<{ filter?: InboxFilter; cursor?: string; limit?: number }> = {}, dependencies: Dependencies = {}): Promise<InboxPage> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = decodeCursor(input.cursor);
  const filterWhere = input.filter === 'unread' ? UNREAD_LIST_WHERE : input.filter === 'action' ? ACTION_WHERE : {};
  const rows = await prisma.inboxNotification.findMany({
    where: { AND: [inboxScopeWhere(actor), filterWhere, ...(cursor ? [{ OR: [{ lastActivityAt: { lt: cursor.at } }, { lastActivityAt: cursor.at, id: { lt: cursor.id } }] }] : [])] },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: DTO_SELECT,
  });
  const page = rows.slice(0, limit);
  return { items: page.flatMap((row) => toDto(row) ?? []), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

export async function markInboxRead(actor: Actor, input: MarkInboxReadInput, dependencies: Dependencies = {}): Promise<InboxCounts & Readonly<{ updated: number }>> {
  requireInboxActor(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  let where: Prisma.InboxNotificationWhereInput;
  let readAt: Date | null = now;
  if ('ids' in input) {
    const ids = [...new Set(input.ids)].filter((id) => UUID_PATTERN.test(id)).slice(0, MAX_IDS);
    if (ids.length === 0) throw new AppError('VALIDATION_ERROR', 'Indica qué avisos marcar.', 400);
    const read = input.read !== false;
    readAt = read ? now : null;
    where = { recipientId: actor.userId, id: { in: ids }, readAt: read ? null : { not: null } };
  } else if ('all' in input) {
    where = { recipientId: actor.userId, readAt: null };
  } else {
    if (!UUID_PATTERN.test(input.quoteRequestId)) throw new AppError('VALIDATION_ERROR', 'El expediente no es válido.', 400);
    // Abrir el expediente no da por atendido lo que pide una acción (aprobar, tomar, responder cambios).
    where = { recipientId: actor.userId, readAt: null, quoteRequestId: input.quoteRequestId, ...(input.scope === 'activity' ? { actionRequired: false } : {}) };
  }
  const result = await prisma.inboxNotification.updateMany({ where, data: { readAt, updatedAt: now } });
  // Otros dispositivos de la misma persona recalculan su contador (lo escucha el bloque 2).
  if (result.count > 0) await publishRealtime(prisma, { t: 'u', u: actor.userId });
  return { updated: result.count, ...(await getInboxCounts(actor, { prisma })) };
}
```

- [ ] **Step 5: Rutas**

Crear `src/app/api/notifications/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { AppError, toErrorResponse } from '@/server/http/errors';
import { INBOX_FILTERS, listInbox } from '@/server/modules/inbox/service';

const querySchema = z.object({
  filter: z.enum(INBOX_FILTERS).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireSessionActor(request);
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Los filtros no son válidos.', 400);
    return NextResponse.json(await listInbox(actor, parsed.data), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
```

Crear `src/app/api/notifications/summary/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { toErrorResponse } from '@/server/http/errors';
import { getInboxSummary } from '@/server/modules/inbox/service';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireSessionActor(request);
    return NextResponse.json(await getInboxSummary(actor), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
```

Crear `src/app/api/notifications/read/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { parseBody, requestId } from '@/server/auth/http';
import { requireSessionActor } from '@/server/auth/session-actor';
import { readServerEnv } from '@/server/env';
import { toErrorResponse } from '@/server/http/errors';
import { markInboxRead } from '@/server/modules/inbox/service';

const bodySchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).max(100), read: z.boolean().optional() }).strict(),
  z.object({ all: z.literal(true) }).strict(),
  z.object({ quoteRequestId: z.string().uuid(), scope: z.enum(['activity', 'all']) }).strict(),
]);

export async function POST(request: NextRequest) {
  const id = requestId();
  try {
    assertSameOrigin(request, readServerEnv().APP_URL);
    const actor = await requireSessionActor(request);
    const body = await parseBody(request, bodySchema);
    return NextResponse.json(await markInboxRead(actor, body), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
```

- [ ] **Step 6: Correr las pruebas**

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration/inbox-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/server/auth/session-actor.ts src/server/modules/inbox/service.ts src/app/api/notifications tests/integration/inbox-api.test.ts
git commit -m "feat(inbox): API de la bandeja con alcance vigente, cursor y lectura por expediente"
```

### Task 9: Correo: correcciones, dos plantillas y correo rebotado a la bandeja

**Files:**
- Create: `prisma/migrations/20260929020000_notification_cancel_reason_self_action/migration.sql`
- Modify: `src/server/modules/notifications/dispatcher.ts` (motivo `SELF_ACTION`), `event-resolver.ts`, `templates.ts` y `worker.ts`
- Create: `src/server/modules/notifications/delivery-inbox.ts`
- Create: `src/server/modules/inbox/rules/deliveries.ts`
- Modify: `src/server/modules/inbox/rules/index.ts`
- Modify: `src/lib/notification-labels.ts` y `src/components/StaffNotificationsPanel.tsx` (solo la etiqueta del motivo)
- Modify: `tests/integration/notifications-fanout.test.ts`, cuyos conteos dependen ahora de cuántos gestores hay en la base compartida
- Test: `tests/integration/notifications-routing.test.ts`, `tests/integration/notifications-delivery-inbox.test.ts` y `tests/unit/notifications-team-templates.test.ts`

**Interfaces:**
- Consumes (Task 5): `parseAnyChangeRequest(body)` de `src/lib/change-request.ts`. Usa también `notifyInbox`.
- Produces:
  - Motivo de cancelación `SELF_ACTION`.
  - Plantillas `request.new_for_team` y `quote.changes_requested`.
  - `NotificationMappingContext.versionNumber?: number`.
  - `customerFacingRequestId(delivery)`, `reportDeliveryFailure(prisma, delivery, now)` y `reportDeliveryRecovered(prisma, delivery, now)`.
  - Eventos de bandeja `EMAIL.DELIVERY_FAILED` y `EMAIL.DELIVERY_RECOVERED`, ambos con `{ quoteRequestId, templateKey? }`.

- [ ] **Step 1: Pruebas de las plantillas nuevas**

Crear `tests/unit/notifications-team-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderNotificationTemplate } from '@/server/modules/notifications/templates';

const base = { appUrl: 'http://localhost:3000', recipientName: 'Ana', actionUrl: 'http://localhost:3000/staff/requests?request=abc', folio: 'OCQ-2026-000130' };

describe('team notification templates', () => {
  it('announces a new web request to managers', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'request.new_for_team', templateVersion: 'v1', data: { ...base, senderName: 'Sofía Garza', preview: 'Alberca con jacuzzi en Monterrey' } });
    expect(rendered.subject).toBe('Nueva solicitud OCQ-2026-000130');
    expect(rendered.text).toContain('Sofía Garza envió la solicitud OCQ-2026-000130');
    expect(rendered.html).toContain('Alberca con jacuzzi en Monterrey');
    expect(rendered.text).toContain('Aviso automático del espacio interno');
  });

  it('quotes a change request safely', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'quote.changes_requested', templateVersion: 'v1', data: { ...base, versionNumber: 2, senderName: 'Juan <b>', preview: '<script>alert(1)</script>' } });
    expect(rendered.subject).toBe('Juan <b> pidió cambios en OCQ-2026-000130');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.text).toContain('pidió cambios a la propuesta versión 2');
  });
});
```

- [ ] **Step 2: Prueba de enrutamiento del correo**

Crear `tests/integration/notifications-routing.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { changeRequestBody } from '@/lib/change-request';
import { resolveNotificationEvent } from '@/server/modules/notifications/event-resolver';
import { mapNotificationEvent, type NotificationEventInput } from '@/server/modules/notifications/templates';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('email routing corrections', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const userIds: string[] = [];
  let roleId = '';
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let managerId = '';
  let customerId = '';
  let conversationId = '';
  let storageObjectId = '';
  let fileId = '';

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'requests.read.global' } });
    roleId = (await prisma.role.create({ data: { key: `routing-manager-${suffix}`, name: 'Routing manager', description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: { permissionId: permission.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `routing-${suffix}`, origin: 'PUBLIC_FORM', contact: { displayName: `Sofía ${suffix}`, email: `routing-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca con jacuzzi', location: 'Monterrey', description: 'Fixture de enrutamiento', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    managerId = (await prisma.user.create({ data: { email: `routing-manager-${suffix}@example.test`, emailNormalized: `routing-manager-${suffix}@example.test`, displayName: 'Routing manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId } } } })).id;
    customerId = (await prisma.user.create({ data: { email: `routing-customer-${suffix}@example.test`, emailNormalized: `routing-customer-${suffix}@example.test`, displayName: 'Routing customer', type: 'CUSTOMER', status: 'ACTIVE', clientId } })).id;
    userIds.push(managerId, customerId);
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    conversationId = (await prisma.conversation.create({ data: { quoteRequestId: requestId, clientId } })).id;
  });

  afterAll(async () => {
    if (fileId) await prisma.fileAttachment.delete({ where: { id: fileId } });
    if (storageObjectId) await prisma.storageObject.delete({ where: { id: storageObjectId } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.delete({ where: { id: roleId } });
  });

  const staffContextFor = async (event: NotificationEventInput, userId: string) => {
    const resolution = await resolveNotificationEvent(prisma, event);
    if (resolution.kind !== 'RECIPIENTS') throw new Error(`Expected recipients, got ${resolution.reason}`);
    const context = resolution.contexts.find((candidate) => candidate.recipient.userId === userId);
    if (!context) throw new Error('The manager did not receive the event.');
    return context;
  };

  it('tells managers about a new web request', async () => {
    const event = { eventType: 'REQUEST.RECEIVED', aggregateType: 'QUOTE_REQUEST', aggregateId: requestId, payload: { quoteRequestId: requestId, folio, origin: 'PUBLIC_FORM' } };
    const context = await staffContextFor(event, managerId);
    expect(context).toMatchObject({ senderName: `Sofía ${suffix}`, messagePreview: 'Alberca con jacuzzi en Monterrey' });
    expect(mapNotificationEvent(event, context)).toMatchObject({ kind: 'INTENT', templateKey: 'request.new_for_team' });
  });

  it('never emails someone about a request they took themselves', async () => {
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: managerId } });
    const resolution = await resolveNotificationEvent(prisma, { eventType: 'REQUEST.ASSIGNED', aggregateType: 'QUOTE_REQUEST', aggregateId: requestId, payload: { quoteRequestId: requestId, folio, assignedToId: managerId, assignedById: managerId, mode: 'take' } });
    expect(resolution).toEqual({ kind: 'CANCELLED', reason: 'SELF_ACTION' });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: null } });
  });

  it('sends an unassigned customer message to managers and a change request with its own template', async () => {
    const plain = await prisma.conversationMessage.create({ data: { conversationId, senderUserId: customerId, visibility: 'CUSTOMER', body: '¿Alguien me atiende?' } });
    const plainEvent = { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', aggregateId: conversationId, payload: { conversationId, quoteRequestId: requestId, clientId, messageId: plain.id, visibility: 'CUSTOMER', folio } };
    expect(mapNotificationEvent(plainEvent, await staffContextFor(plainEvent, managerId))).toMatchObject({ templateKey: 'message.created' });

    const change = await prisma.conversationMessage.create({ data: { conversationId, senderUserId: customerId, visibility: 'CUSTOMER', body: changeRequestBody(2, 'Agreguen calentador solar.') } });
    const changeEvent = { ...plainEvent, payload: { ...plainEvent.payload, messageId: change.id } };
    const context = await staffContextFor(changeEvent, managerId);
    expect(context).toMatchObject({ versionNumber: 2, messagePreview: 'Agreguen calentador solar.' });
    expect(mapNotificationEvent(changeEvent, context)).toMatchObject({ templateKey: 'quote.changes_requested', safePayload: expect.objectContaining({ versionNumber: 2 }) });
  });

  it('does not email customers about files they uploaded', async () => {
    const storage = await prisma.storageObject.create({ data: { storageKey: `private-files/routing/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 5n, sha256: 'c'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = storage.id;
    fileId = (await prisma.fileAttachment.create({ data: { quoteRequestId: requestId, clientId, storageObjectId: storage.id, originalFileName: 'plano.pdf', category: 'CLIENT_DOCUMENT', visibility: 'CUSTOMER', status: 'AVAILABLE', uploadedById: customerId } })).id;
    const resolution = await resolveNotificationEvent(prisma, { eventType: 'FILE.AVAILABLE', aggregateType: 'FILE_ATTACHMENT', aggregateId: fileId, payload: { fileId, quoteRequestId: requestId, visibility: 'CUSTOMER', category: 'CLIENT_DOCUMENT' } });
    expect(resolution).toEqual({ kind: 'CANCELLED', reason: 'SELF_ACTION' });
  });
});
```

- [ ] **Step 3: Prueba del correo rebotado a la bandeja**

Crear `tests/integration/notifications-delivery-inbox.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { reportDeliveryFailure, reportDeliveryRecovered } from '@/server/modules/notifications/delivery-inbox';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('failed customer email reaches the inbox', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const userIds: string[] = [];
  let roleId = '';
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let assigneeId = '';
  let managerId = '';

  const delivery = (actionPath: string) => ({ id: randomUUID(), templateKey: 'quote.version_sent' as const, payload: { actionPath }, outboxEvent: { eventType: 'QUOTE.PUBLISHED', aggregateType: 'QUOTE', aggregateId: null, payload: { quoteRequestId: requestId } } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'requests.read.global' } });
    roleId = (await prisma.role.create({ data: { key: `bounce-manager-${suffix}`, name: 'Bounce manager', description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: { permissionId: permission.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `bounce-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Cliente ${suffix}`, email: `bounce-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Chihuahua', description: 'Fixture de rebotes', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    assigneeId = (await prisma.user.create({ data: { email: `bounce-assignee-${suffix}@example.test`, emailNormalized: `bounce-assignee-${suffix}@example.test`, displayName: 'Bounce assignee', type: 'EMPLOYEE', status: 'ACTIVE' } })).id;
    managerId = (await prisma.user.create({ data: { email: `bounce-manager-${suffix}@example.test`, emailNormalized: `bounce-manager-${suffix}@example.test`, displayName: 'Bounce manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId } } } })).id;
    userIds.push(assigneeId, managerId);
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: assigneeId } });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.delete({ where: { id: roleId } });
  });

  it('warns the assignee urgently and managers quietly, then closes the warning once a retry succeeds', async () => {
    const folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    await reportDeliveryFailure(prisma, delivery(`/portal?request=${requestId}`), now);
    await reportDeliveryFailure(prisma, delivery(`/staff/requests?request=${requestId}`), now);
    const [assigneeNotice] = await prisma.inboxNotification.findMany({ where: { recipientId: assigneeId } });
    expect(assigneeNotice).toMatchObject({ kind: 'email.delivery_failed', priority: 'URGENT', title: `No se pudo entregar un correo a Cliente ${suffix}`, body: `Cotización enviada al cliente · ${folio} · Revisa el correo del contacto` });
    expect(await prisma.inboxNotification.findFirst({ where: { recipientId: managerId } })).toMatchObject({ priority: 'NORMAL' });
    await reportDeliveryRecovered(prisma, delivery(`/portal?request=${requestId}`), now);
    expect(await prisma.inboxNotification.findMany({ where: { recipientId: { in: [assigneeId, managerId] } } })).toEqual(expect.arrayContaining([expect.objectContaining({ resolvedNote: 'El correo se entregó al reintentar' })]));
    expect(await prisma.inboxNotification.count({ where: { recipientId: { in: [assigneeId, managerId] }, resolvedAt: null } })).toBe(0);
  });
});
```

- [ ] **Step 4: Correr las tres pruebas y confirmar que fallan**

Run: `npx vitest run tests/unit/notifications-team-templates.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/notifications-routing.test.ts tests/integration/notifications-delivery-inbox.test.ts --maxWorkers=1`
Expected: FAIL. Las plantillas no existen, el gestor no recibe el correo de la solicitud nueva y `delivery-inbox` no existe.

- [ ] **Step 5: Migración del motivo `SELF_ACTION`**

Crear `prisma/migrations/20260929020000_notification_cancel_reason_self_action/migration.sql`:

```sql
-- Acción propia: quien toma una solicitud o el archivo que el propio cliente subió ya no generan correo
-- para sí mismos (spec 2026-09-29-notificaciones-tiempo-real-design §8.1).
ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_cancel_reason_ck";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_cancel_reason_ck"
    CHECK (
      ("status" = 'CANCELLED' AND "cancelReason" IN ('UNSUPPORTED_EVENT', 'INVALID_PAYLOAD', 'INVALID_RECIPIENT', 'INVALID_RECIPIENT_SCOPE', 'INTERNAL_VISIBILITY', 'NO_RECIPIENT', 'CONTACT_EMAIL_CHANGED', 'SELF_ACTION'))
      OR ("status" <> 'CANCELLED' AND "cancelReason" IS NULL)
    );
```

Run: `npx prisma migrate deploy`
Expected: "Applying migration `20260929020000_notification_cancel_reason_self_action`".

En `src/server/modules/notifications/dispatcher.ts`, agrega `'SELF_ACTION'` a la unión:

```ts
export type NotificationCancellationReason = 'UNSUPPORTED_EVENT' | 'INVALID_PAYLOAD' | 'INVALID_RECIPIENT' | 'INVALID_RECIPIENT_SCOPE' | 'INTERNAL_VISIBILITY' | 'NO_RECIPIENT' | 'SELF_ACTION';
```

- [ ] **Step 6: Plantillas nuevas**

En `src/server/modules/notifications/templates.ts`:

a) Agrega `'request.new_for_team'` y `'quote.changes_requested'` al final de `NOTIFICATION_TEMPLATE_KEYS`.

b) En `NotificationMappingContext`, agrega `versionNumber?: number;` después de `fileName?: string;`.

c) Reemplaza el `case 'REQUEST.RECEIVED'` de `mapNotificationEvent` por:

```ts
      case 'REQUEST.RECEIVED': {
        const parsed = requestReceivedPayload.safeParse(event.payload);
        if (!parsed.success) return { kind: 'REJECTED', reason: 'INVALID_PAYLOAD' };
        // Gerencia recibe la solicitud nueva del sitio; el cliente, su acuse.
        if (context.recipient.audience === 'STAFF') {
          return makeIntent(context, 'request.new_for_team', { recipientName: context.recipient.displayName, folio: parsed.data.folio, senderName: boundedText(context.senderName ?? 'Un cliente', 180, 'client name'), preview: boundedText(context.messagePreview ?? 'Proyecto por definir', 300, 'project summary') });
        }
        const scope = rejectScope(context, 'CUSTOMER');
        if (scope) return scope;
        return makeIntent(context, 'request.received', { recipientName: context.recipient.displayName, folio: parsed.data.folio });
      }
```

d) En el `case 'MESSAGE.CREATED'` de `mapNotificationEvent`, justo antes del `return makeIntent(context, 'message.created', …)`, agrega:

```ts
        if (context.recipient.audience === 'STAFF' && context.versionNumber) {
          return makeIntent(context, 'quote.changes_requested', { recipientName: context.recipient.displayName, folio: parsed.data.folio, versionNumber: context.versionNumber, senderName: boundedText(context.senderName ?? 'El cliente', 180, 'sender name'), preview: boundedText(context.messagePreview ?? 'Revisa la conversación del expediente.', 500, 'message preview') });
        }
```

e) En `renderNotificationTemplate`, agrega estos dos casos antes del `case 'file.available'`:

```ts
    case 'request.new_for_team': {
      const client = data.senderName ?? 'Un cliente';
      const project = data.preview ?? 'Proyecto por definir';
      return compose({
        audience: 'staff',
        subject: safeHeader(`Nueva solicitud ${folio}`),
        preheader: `${client}: ${project}. Todavía no tiene responsable.`,
        eyebrow: 'Solicitud nueva',
        title: 'Llegó una solicitud nueva',
        blocks: [
          paragraph(html`${client} envió la solicitud ${folio} desde el sitio. Todavía no tiene responsable.`),
          details([...folioRows, { label: 'Cliente', value: client }, { label: 'Proyecto', value: project }]),
        ],
        actionLabel: 'Abrir solicitud',
        text: `Hola ${data.recipientName},\n\n${client} envió la solicitud ${folio} desde el sitio: ${project}. Todavía no tiene responsable.\n\nAbrir solicitud: ${actionUrl}`,
      });
    }
    case 'quote.changes_requested': {
      const sender = data.senderName ?? 'El cliente';
      const senderForHeader = sender.replace(/[\u0000-\u001F\u007F]+/gu, ' ').trim() || 'El cliente';
      return compose({
        audience: 'staff',
        subject: safeHeader(`${senderForHeader} pidió cambios en ${folio}`.slice(0, 240)),
        preheader: `${senderForHeader}: ${preview}`,
        eyebrow: 'Cambios pedidos',
        title: data.versionNumber ? `Cambios a la propuesta V${data.versionNumber}` : 'Cambios a la propuesta',
        blocks: [paragraph(html`${sender} pidió cambios a la propuesta${version} del expediente ${folio}:`), quote(preview)],
        actionLabel: data.actionLabel ?? 'Revisar propuesta',
        text: `Hola ${data.recipientName},\n\n${sender} pidió cambios a la propuesta${version} de ${folio}:\n\n${preview}\n\nRevisar: ${actionUrl}`,
      });
    }
```

En `src/lib/notification-labels.ts`, agrega a `TEMPLATE_LABELS`:

```ts
  'request.new_for_team': 'Aviso de solicitud nueva al equipo',
  'quote.changes_requested': 'Aviso de cambios pedidos',
```

En `src/components/StaffNotificationsPanel.tsx`, agrega a `CANCEL_REASON_LABELS`:

```ts
  SELF_ACTION: 'Acción propia, sin aviso',
```

- [ ] **Step 7: Enrutamiento del correo**

En `src/server/modules/notifications/event-resolver.ts`:
- Agrega `import { parseAnyChangeRequest } from '@/lib/change-request';`.
- Agrega `import type { StaffRequestTab } from '@/server/modules/notifications/paths';`.
- Agrega, junto a `staffContext`, esta función:

```ts
/** Gerencia y Administración (`requests.read.global`): reciben lo que no tiene responsable y los cierres de venta. */
async function managerContexts(prisma: DbClient, quoteRequestId: string, tab: StaffRequestTab, flags: CommercialV2Flags, exclude: ReadonlySet<string> = new Set()): Promise<NotificationMappingContext[]> {
  const users = await prisma.user.findMany({
    where: { type: 'EMPLOYEE', status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: 'requests.read.global' } } } } } } },
    select: { id: true, email: true, displayName: true, type: true, status: true },
    orderBy: { id: 'asc' },
  });
  return users
    .filter((user) => !exclude.has(user.id))
    .map(activeStaff)
    .filter((recipient): recipient is NotificationRecipientContext => Boolean(recipient))
    .map((recipient) => staffContext(recipient, quoteRequestId, tab, flags));
}
```

Reemplaza el `case 'REQUEST.RECEIVED'` de `resolveNotificationEvent` por:

```ts
    case 'REQUEST.RECEIVED': {
      if (event.aggregateType !== 'QUOTE_REQUEST' || !isUuid(event.aggregateId)) return cancellation('INVALID_PAYLOAD');
      const request = await prisma.quoteRequest.findUnique({ where: { id: event.aggregateId }, include: { client: true, contact: { include: { user: true } }, detail: { select: { projectType: true, location: true } } } });
      if (!request || stringValue(payload, 'quoteRequestId') !== request.id || stringValue(payload, 'folio') !== request.folio) return cancellation('INVALID_PAYLOAD');
      const customer = request.client.status === 'ACTIVE' ? contactRecipient(request.contact) : null;
      const contexts: NotificationMappingContext[] = customer ? [customerContext(customer, request.id)] : [];
      if (request.origin === 'PUBLIC_FORM') {
        const project = request.detail ? `${request.detail.projectType} en ${request.detail.location}` : undefined;
        for (const context of await managerContexts(prisma, request.id, 'summary', flags)) contexts.push({ ...context, senderName: request.client.displayName, ...(project ? { messagePreview: project } : {}) });
      }
      return contexts.length > 0 ? { kind: 'RECIPIENTS', contexts } : cancellation('NO_RECIPIENT');
    }
```

En el `case 'REQUEST.ASSIGNED'`, justo después de la validación que termina en `return cancellation('INVALID_PAYLOAD');`, agrega:

```ts
      if (stringValue(payload, 'assignedById') === assignedToId) return cancellation('SELF_ACTION');
```

En el `case 'MESSAGE.CREATED'`, reemplaza el bloque `if (message.sender?.type === 'CUSTOMER') { … }` por:

```ts
      if (message.sender?.type === 'CUSTOMER') {
        const change = parseAnyChangeRequest(message.body);
        const tab = change ? 'quote' : 'conversation';
        const assignee = activeStaff(conversation.quoteRequest.currentAssignee);
        // Sin responsable, la respuesta del cliente llega a Gerencia en vez de perderse (antes: NO_RECIPIENT).
        const contexts = assignee ? [staffContext(assignee, conversation.quoteRequestId, tab, flags)] : await managerContexts(prisma, conversation.quoteRequestId, tab, flags);
        if (contexts.length === 0) return cancellation('NO_RECIPIENT');
        const sender = message.sender.displayName;
        return { kind: 'RECIPIENTS', contexts: contexts.map((context) => ({ ...context, senderName: sender, messagePreview: change ? change.message || message.body : message.body, ...(change ? { versionNumber: change.versionNumber } : {}) })) };
      }
```

En el `case 'FILE.AVAILABLE'`:
- Cambia el `include` de `fileAttachment.findUnique` a `include: { uploadedBy: { select: { type: true } }, quoteRequest: { include: { client: true, contact: { include: { user: true } } } } }`.
- Justo después de la validación que termina en `return cancellation(attachment?.visibility === 'INTERNAL' ? 'INTERNAL_VISIBILITY' : 'INVALID_PAYLOAD');`, agrega:

```ts
      // El archivo que el propio cliente subió no le genera correo a él; el equipo lo ve en su bandeja.
      if (attachment.uploadedBy.type === 'CUSTOMER') return cancellation('SELF_ACTION');
```

En el `case 'QUOTE.ACCEPTED'`, reemplaza la construcción de `contexts` por:

```ts
      const managerNotices = (await managerContexts(prisma, quote.quoteRequestId, 'summary', flags, new Set(staffRecipient?.userId ? [staffRecipient.userId] : []))).map((context) => ({ ...context, totalLabel: total }));
      const contexts: NotificationMappingContext[] = [
        ...(staffRecipient ? [{ recipient: staffRecipient, actionPath: requestWorkspaceNotificationPath(quote.quoteRequestId, 'summary', flags), totalLabel: total }] : []),
        ...managerNotices,
        ...(customerRecipient ? [{ ...customerContext(customerRecipient, quote.quoteRequestId), totalLabel: total }] : []),
      ];
```

- [ ] **Step 8: Correo rebotado a la bandeja**

Crear `src/server/modules/inbox/rules/deliveries.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client';
import { templateLabel } from '@/lib/notification-labels';
import { activeEmployees, activeStaffWithPermissions, excludeUser, loadRequestInboxContext, MANAGER_PERMISSIONS, textOf, uuidOf } from '../audience';
import { staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent } from '../record';
import type { DomainEventInput } from './types';

export async function deliveryFailedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  const context = await loadRequestInboxContext(tx, requestId);
  if (!context) return NO_INBOX_EFFECTS;
  const templateKey = textOf(event.payload.templateKey);
  const data = { folio: context.folio, clientName: context.clientName, templateLabel: templateKey ? templateLabel(templateKey) : undefined };
  const notice = (recipientId: string, priority: 'URGENT' | 'NORMAL'): InboxIntent => ({ recipientId, kind: 'email.delivery_failed', priority, quoteRequestId: context.id, actorId: null, groupKey: `email-failed:${context.id}`, actionPath: staffRequestPath(context.id), actionRequired: false, data });
  const assignee = await activeEmployees(tx, [context.assigneeId]);
  const managers = excludeUser(await activeStaffWithPermissions(tx, MANAGER_PERMISSIONS), context.assigneeId);
  return { intents: [...assignee.map((user) => notice(user.id, 'URGENT')), ...managers.map((user) => notice(user.id, 'NORMAL'))], resolutions: [] };
}

export async function deliveryRecoveredEffects(_tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const requestId = uuidOf(event.payload.quoteRequestId);
  if (!requestId) return NO_INBOX_EFFECTS;
  return { intents: [], resolutions: [{ groupKey: `email-failed:${requestId}`, note: 'El correo se entregó al reintentar' }] };
}
```

En `src/server/modules/inbox/rules/index.ts`, agrega:

```ts
import { deliveryFailedEffects, deliveryRecoveredEffects } from './deliveries';
```
```ts
    case 'EMAIL.DELIVERY_FAILED': return deliveryFailedEffects(tx, event);
    case 'EMAIL.DELIVERY_RECOVERED': return deliveryRecoveredEffects(tx, event);
```

Crear `src/server/modules/notifications/delivery-inbox.ts`:

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { logger } from '@/server/logging/logger';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import type { ClaimedNotificationDelivery } from '@/server/modules/notifications/dispatcher';

type DeliveryRef = Pick<ClaimedNotificationDelivery, 'id' | 'templateKey' | 'payload' | 'outboxEvent'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Sólo los correos a clientes (su enlace va al portal) de un expediente conocido generan aviso interno. */
export function customerFacingRequestId(delivery: DeliveryRef): string | null {
  const actionPath = typeof delivery.payload?.actionPath === 'string' ? delivery.payload.actionPath : '';
  if (!actionPath.startsWith('/portal')) return null;
  const requestId = delivery.outboxEvent.payload.quoteRequestId;
  return typeof requestId === 'string' && UUID_PATTERN.test(requestId) ? requestId : null;
}

/** Una entrega quedó FAILED definitiva: el responsable se entera de que su cliente no recibió el correo. */
export async function reportDeliveryFailure(prisma: PrismaClient, delivery: DeliveryRef, now: Date): Promise<void> {
  const requestId = customerFacingRequestId(delivery);
  if (!requestId) return;
  try {
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: null, eventType: 'EMAIL.DELIVERY_FAILED', aggregateType: 'NOTIFICATION_DELIVERY', aggregateId: delivery.id, payload: { quoteRequestId: requestId, templateKey: delivery.templateKey } }, { now }));
  } catch (error) {
    logger.warn({ deliveryId: delivery.id, error: error instanceof Error ? error.message : String(error) }, 'Could not report a failed delivery to the inbox');
  }
}

/** Un correo a cliente se entregó: si había un aviso de rebote abierto para ese expediente, se cierra. */
export async function reportDeliveryRecovered(prisma: PrismaClient, delivery: DeliveryRef, now: Date): Promise<void> {
  const requestId = customerFacingRequestId(delivery);
  if (!requestId) return;
  const open = await prisma.inboxNotification.count({ where: { groupKey: `email-failed:${requestId}`, resolvedAt: null } });
  if (open === 0) return;
  try {
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: null, eventType: 'EMAIL.DELIVERY_RECOVERED', aggregateType: 'NOTIFICATION_DELIVERY', aggregateId: delivery.id, payload: { quoteRequestId: requestId } }, { now }));
  } catch (error) {
    logger.warn({ deliveryId: delivery.id, error: error instanceof Error ? error.message : String(error) }, 'Could not close a delivery warning in the inbox');
  }
}
```

En `src/server/modules/notifications/worker.ts`:
- Agrega `import { reportDeliveryFailure, reportDeliveryRecovered } from '@/server/modules/notifications/delivery-inbox';`.
- En el bucle de `processNotificationBatch`, reemplaza `if (marked) result.sent += 1;` por:

```ts
      if (marked) {
        result.sent += 1;
        await reportDeliveryRecovered(input.prisma, delivery, now);
      }
```

Reemplaza `if (outcome === 'FAILED') result.failed += 1;` por:

```ts
      if (outcome === 'FAILED') {
        result.failed += 1;
        await reportDeliveryFailure(input.prisma, delivery, now);
      }
```

- [ ] **Step 9: Ajustar la prueba de fan-out a la base compartida**

En `tests/integration/notifications-fanout.test.ts`, la solicitud del sitio y la aceptación ahora también le llegan a cada gestor activo de la base. Por eso los conteos dependen del entorno.

Reemplaza:

```ts
      expect(result).toMatchObject({ claimed: 7, materialized: 7, cancelled: 1 });
```

por:

```ts
      // Gerencia también recibe la solicitud del sitio y la aceptación: cuántos gestores hay depende de la base.
      expect(result).toMatchObject({ claimed: 7, cancelled: 1 });
      expect(result.materialized).toBeGreaterThanOrEqual(7);
```

Reemplaza:

```ts
      expect(deliveries.filter((delivery) => delivery.status === 'PENDING')).toHaveLength(7);
```

por:

```ts
      expect(deliveries.filter((delivery) => delivery.status === 'PENDING').length).toBeGreaterThanOrEqual(7);
```

Reemplaza:

```ts
      expect(acceptedDeliveries).toHaveLength(2);
```

por:

```ts
      expect(acceptedDeliveries.length).toBeGreaterThanOrEqual(2);
```

- [ ] **Step 10: Correr las pruebas**

Run: `npx vitest run tests/unit/notifications-team-templates.test.ts tests/unit/notifications-templates.test.ts tests/unit/notifications-worker.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/notifications-routing.test.ts tests/integration/notifications-delivery-inbox.test.ts tests/integration/notifications-fanout.test.ts tests/integration/notifications-worker.test.ts tests/integration/notifications-schema.test.ts --maxWorkers=1`
Expected: todo en PASS.

- [ ] **Step 11: Typecheck, lint y commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add prisma/migrations/20260929020000_notification_cancel_reason_self_action src/server/modules/notifications src/server/modules/inbox/rules src/lib/notification-labels.ts src/components/StaffNotificationsPanel.tsx tests/unit/notifications-team-templates.test.ts tests/integration/notifications-routing.test.ts tests/integration/notifications-delivery-inbox.test.ts tests/integration/notifications-fanout.test.ts
git commit -m "fix(correos): cada aviso a quien corresponde (solicitud nueva a gerencia, sin autoenvíos, cambios pedidos) y rebotes a la bandeja"
```

---

### Task 10: Campana y panel (equipo y portal)

**Files:**
- Create: `src/lib/inbox-client.ts`
- Create: `src/components/inbox/InboxProvider.tsx`, `src/components/inbox/NotificationBell.tsx`, `src/components/inbox/NotificationItem.tsx`, `src/components/inbox/inbox-visuals.ts` y `src/components/inbox/inbox.css`
- Modify: `src/app/staff/layout.tsx`, `src/app/portal/layout.tsx`, `src/components/StaffHeader.tsx`, `src/components/private/PrivateShellChrome.tsx` y `src/components/ClientPortalPanel.tsx` (encabezado)
- Modify: `src/components/private/navigation.ts` y `src/server/private-shell.ts` (capacidad `requestsClaim`)
- Test: `tests/unit/inbox-client.test.ts`

**Interfaces:**
- Consumes (Task 8): `GET /api/notifications/summary`, `GET /api/notifications` y `POST /api/notifications/read`.
- Produces:
  - `useInbox(): InboxContextValue | null`. Expone `surface`, `available`, `loaded`, `unread`, `actionRequired`, `latest`, `unreadByRequest`, `refresh()` y `markRead(input)`.
  - `<InboxProvider surface="staff" | "portal">`.
  - `<NotificationBell />`.
  - `<NotificationItem item onOpen actions? />`.
  - `fetchInboxPage(filter, cursor?, signal?)`.
  - `groupInboxByDay(items, now?)`, `filterInbox(items, filter)`, `titleWithBadge(title, unread)`, `badgeCount(n)`, `isUnread(item)` y `needsAction(item)`.
  - `type InboxNotification`, `type InboxFilter` y `type MarkReadInput`.

- [ ] **Step 1: Pruebas de las utilidades del cliente**

Crear `tests/unit/inbox-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { badgeCount, filterInbox, groupInboxByDay, titleWithBadge, type InboxNotification } from '@/lib/inbox-client';

const item = (overrides: Partial<InboxNotification>): InboxNotification => ({
  id: 'n1', kind: 'customer.activity', priority: 'HIGH', title: 'Aviso', body: null, actionPath: '/staff/requests', quoteRequestId: null, folio: null, clientName: null,
  occurrences: 1, actionRequired: false, createdAt: '2026-09-29T10:00:00', lastActivityAt: '2026-09-29T10:00:00', readAt: null, resolvedAt: null, resolvedNote: null,
  ...overrides,
});

describe('inbox client helpers', () => {
  it('prefixes the tab title with the unread count and removes it at zero', () => {
    expect(titleWithBadge('Solicitudes | OCPOOL Operaciones', 3)).toBe('(3) Solicitudes | OCPOOL Operaciones');
    expect(titleWithBadge('(3) Solicitudes | OCPOOL Operaciones', 120)).toBe('(99+) Solicitudes | OCPOOL Operaciones');
    expect(titleWithBadge('(99+) Solicitudes | OCPOOL Operaciones', 0)).toBe('Solicitudes | OCPOOL Operaciones');
    expect(badgeCount(7)).toBe('7');
  });

  it('filters unread and action-required notices', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', readAt: '2026-09-29T11:00:00' }), item({ id: 'c', actionRequired: true, readAt: '2026-09-29T11:00:00' }), item({ id: 'd', actionRequired: true, resolvedAt: '2026-09-29T11:00:00' })];
    expect(filterInbox(items, 'all').map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterInbox(items, 'unread').map(({ id }) => id)).toEqual(['a']);
    expect(filterInbox(items, 'action').map(({ id }) => id)).toEqual(['c']);
  });

  it('groups by local day', () => {
    const now = new Date('2026-09-29T15:00:00');
    const groups = groupInboxByDay([
      item({ id: 'today', lastActivityAt: '2026-09-29T09:00:00' }),
      item({ id: 'yesterday', lastActivityAt: '2026-09-28T22:00:00' }),
      item({ id: 'week', lastActivityAt: '2026-09-25T10:00:00' }),
      item({ id: 'older', lastActivityAt: '2026-09-01T10:00:00' }),
    ], now);
    expect(groups.map(({ label, items }) => [label, items.map(({ id }) => id)])).toEqual([['Hoy', ['today']], ['Ayer', ['yesterday']], ['Esta semana', ['week']], ['Antes', ['older']]]);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run tests/unit/inbox-client.test.ts`
Expected: FAIL. Vitest reporta "Failed to resolve import `@/lib/inbox-client`".

- [ ] **Step 3: `src/lib/inbox-client.ts`**

```ts
export type InboxPriorityClient = 'URGENT' | 'HIGH' | 'NORMAL' | 'INFO';

/** Mismo contrato que `InboxNotificationDto` del servidor (src/server/modules/inbox/service.ts). */
export type InboxNotification = {
  id: string;
  kind: string;
  priority: InboxPriorityClient;
  title: string;
  body: string | null;
  actionPath: string;
  quoteRequestId: string | null;
  folio: string | null;
  clientName: string | null;
  occurrences: number;
  actionRequired: boolean;
  createdAt: string;
  lastActivityAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
};

export type InboxSummary = { unread: number; actionRequired: number; latest: InboxNotification[]; unreadByRequest: Record<string, number> };
export type InboxPage = { items: InboxNotification[]; nextCursor: string | null };
export type InboxFilter = 'all' | 'unread' | 'action';
export type MarkReadInput = { ids: string[]; read?: boolean } | { all: true } | { quoteRequestId: string; scope: 'activity' | 'all' };
export type InboxDayGroup = { key: 'today' | 'yesterday' | 'week' | 'older'; label: string; items: InboxNotification[] };

export class InboxRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'InboxRequestError';
  }
}

export function isUnread(item: InboxNotification): boolean {
  return !item.readAt && !item.resolvedAt;
}

export function needsAction(item: InboxNotification): boolean {
  return item.actionRequired && !item.resolvedAt;
}

export function filterInbox(items: readonly InboxNotification[], filter: InboxFilter): InboxNotification[] {
  if (filter === 'unread') return items.filter(isUnread);
  if (filter === 'action') return items.filter(needsAction);
  return [...items];
}

const DAY_LABELS: Record<InboxDayGroup['key'], string> = { today: 'Hoy', yesterday: 'Ayer', week: 'Esta semana', older: 'Antes' };

export function groupInboxByDay(items: readonly InboxNotification[], now: Date = new Date()): InboxDayGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const buckets = new Map<InboxDayGroup['key'], InboxNotification[]>();
  for (const item of items) {
    const at = new Date(item.lastActivityAt);
    const key: InboxDayGroup['key'] = at >= startOfToday ? 'today' : at >= startOfYesterday ? 'yesterday' : at >= startOfWeek ? 'week' : 'older';
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return (['today', 'yesterday', 'week', 'older'] as const).flatMap((key) => {
    const bucket = buckets.get(key);
    return bucket ? [{ key, label: DAY_LABELS[key], items: bucket }] : [];
  });
}

const BADGE_PREFIX = /^\(\d+\+?\)\s/u;

export function badgeCount(value: number): string {
  return value > 99 ? '99+' : String(value);
}

/** "(3) Solicitudes | OCPOOL Operaciones": el pendiente se ve aunque la pestaña esté en segundo plano. */
export function titleWithBadge(title: string, unread: number): string {
  const base = title.replace(BADGE_PREFIX, '');
  return unread > 0 ? `(${badgeCount(unread)}) ${base}` : base;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new InboxRequestError(data.error?.message ?? fallback, response.status);
  return data;
}

export async function fetchInboxSummary(signal?: AbortSignal): Promise<InboxSummary> {
  const response = await fetch('/api/notifications/summary', { credentials: 'include', cache: 'no-store', signal });
  return readJson<InboxSummary>(response, 'No fue posible consultar tus avisos.');
}

export async function fetchInboxPage(filter: InboxFilter, cursor?: string | null, signal?: AbortSignal): Promise<InboxPage> {
  const params = new URLSearchParams({ filter });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/notifications?${params.toString()}`, { credentials: 'include', cache: 'no-store', signal });
  return readJson<InboxPage>(response, 'No fue posible consultar tus avisos.');
}

export async function postInboxRead(input: MarkReadInput): Promise<{ updated: number; unread: number; actionRequired: number }> {
  const response = await fetch('/api/notifications/read', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return readJson(response, 'No fue posible marcar tus avisos.');
}
```

- [ ] **Step 4: Correr las pruebas del cliente**

Run: `npx vitest run tests/unit/inbox-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Proveedor**

Crear `src/components/inbox/InboxProvider.tsx`:

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchInboxSummary, InboxRequestError, postInboxRead, titleWithBadge, type InboxNotification, type InboxSummary, type MarkReadInput } from '@/lib/inbox-client';

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
};

const InboxContext = createContext<InboxContextValue | null>(null);
// Respaldo mientras no hay canal en vivo (bloque 2): al navegar, al volver a la pestaña y cada 30 s.
const POLL_INTERVAL_MS = 30_000;
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
  const [summary, setSummary] = useState<InboxSummary>(EMPTY);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const next = await fetchInboxSummary(controller.signal);
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
    if (!available) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(onVisible, POLL_INTERVAL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [available, refresh]);

  useEffect(() => () => inFlight.current?.abort(), []);

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

  const markRead = useCallback(async (input: MarkReadInput) => {
    setSummary((current) => applyReadLocally(current, input, new Date().toISOString()));
    try {
      const counts = await postInboxRead(input);
      setSummary((current) => ({ ...current, unread: counts.unread, actionRequired: counts.actionRequired }));
    } catch {
      void refresh();
    }
  }, [refresh]);

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
  }), [surface, available, loaded, unread, summary, refresh, markRead]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue | null {
  return useContext(InboxContext);
}
```

- [ ] **Step 6: Íconos, fila y campana**

Crear `src/components/inbox/inbox-visuals.ts`:

```ts
import { BadgeCheck, CircleCheck, CircleHelp, CircleX, FilePen, FileText, HardHat, Inbox, MailWarning, MessageSquare, RotateCcw, StickyNote, Tag, Undo2, UserRoundCheck, UserRoundMinus, Users, type LucideIcon } from 'lucide-react';

export type InboxTone = 'accent' | 'success' | 'copper' | 'danger' | 'muted';

const VISUALS: Record<string, { icon: LucideIcon; tone: InboxTone }> = {
  'request.new_unassigned': { icon: Inbox, tone: 'copper' },
  'customer.activity': { icon: MessageSquare, tone: 'accent' },
  'team.activity': { icon: MessageSquare, tone: 'accent' },
  'quote.changes_requested': { icon: FilePen, tone: 'copper' },
  'quote.accepted': { icon: CircleCheck, tone: 'success' },
  'request.assigned_to_you': { icon: UserRoundCheck, tone: 'accent' },
  'request.unassigned_from_you': { icon: UserRoundMinus, tone: 'muted' },
  'approval.requested': { icon: BadgeCheck, tone: 'copper' },
  'approval.resolved': { icon: BadgeCheck, tone: 'accent' },
  'quote.returned': { icon: Undo2, tone: 'copper' },
  'price.pending': { icon: Tag, tone: 'copper' },
  'price.assigned': { icon: Tag, tone: 'success' },
  'note.internal': { icon: StickyNote, tone: 'muted' },
  'project.assigned': { icon: HardHat, tone: 'accent' },
  'project.created': { icon: HardHat, tone: 'muted' },
  'team.work_reassigned': { icon: Users, tone: 'accent' },
  'email.delivery_failed': { icon: MailWarning, tone: 'danger' },
  'request.closed': { icon: CircleX, tone: 'muted' },
  'request.reopened': { icon: RotateCcw, tone: 'accent' },
  'request.information_needed': { icon: CircleHelp, tone: 'copper' },
  'quote.ready': { icon: FileText, tone: 'success' },
  'project.started': { icon: HardHat, tone: 'success' },
  'request.received': { icon: Inbox, tone: 'muted' },
};

export function inboxKindVisual(kind: string): { icon: LucideIcon; tone: InboxTone } {
  return VISUALS[kind] ?? { icon: Inbox, tone: 'muted' };
}
```

Crear `src/components/inbox/NotificationItem.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { formatDateTime } from '@/lib/format-date';
import { isUnread, type InboxNotification } from '@/lib/inbox-client';
import { relativeTimeLabel } from '@/lib/relative-time';
import { inboxKindVisual } from './inbox-visuals';

type Props = Readonly<{
  item: InboxNotification;
  onOpen: (item: InboxNotification, event: MouseEvent<HTMLAnchorElement>) => void;
  actions?: ReactNode;
}>;

export default function NotificationItem({ item, onOpen, actions }: Props) {
  const visual = inboxKindVisual(item.kind);
  const Icon = visual.icon;
  const unread = isUnread(item);
  const meta = [item.folio, item.clientName].filter(Boolean).join(' · ');
  const className = ['inbox-item', unread ? 'is-unread' : '', item.resolvedAt ? 'is-resolved' : '', item.priority === 'URGENT' ? 'is-urgent' : ''].filter(Boolean).join(' ');
  return (
    <li className={className}>
      <span className={`inbox-item__icon inbox-item__icon--${visual.tone}`} aria-hidden="true"><Icon size={16} /></span>
      <div className="inbox-item__main">
        <Link className="inbox-item__link" href={item.actionPath} onClick={(event) => onOpen(item, event)}>
          <strong>{item.title}</strong>
          {item.body && <span className="inbox-item__body">{item.body}</span>}
        </Link>
        <span className="inbox-item__meta">
          {meta && <span>{meta}</span>}
          <time dateTime={item.lastActivityAt} title={formatDateTime(item.lastActivityAt)}>{relativeTimeLabel(item.lastActivityAt)}</time>
        </span>
        {item.resolvedNote && <span className="inbox-item__resolved">{item.resolvedNote}</span>}
        {actions && !item.resolvedAt && <div className="inbox-item__actions">{actions}</div>}
      </div>
      {unread && <span className="inbox-item__dot"><span className="sr-only">Sin leer</span></span>}
    </li>
  );
}
```

Crear `src/components/inbox/NotificationBell.tsx`:

```tsx
'use client';

import { Bell, CheckCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { usePrivateToast } from '@/components/private/ui/PrivateToast';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import { badgeCount, filterInbox, groupInboxByDay, type InboxFilter, type InboxNotification } from '@/lib/inbox-client';
import { useInbox } from './InboxProvider';
import NotificationItem from './NotificationItem';

const STAFF_FILTERS: ReadonlyArray<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Sin leer' },
  { key: 'action', label: 'Requieren acción' },
];

export default function NotificationBell({ className }: Readonly<{ className?: string }>) {
  const inbox = useInbox();
  const session = useStaffSession();
  const { showToast } = usePrivateToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [takingId, setTakingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const refresh = inbox?.refresh;

  useEffect(() => {
    if (!open) return undefined;
    void refresh?.();
    window.requestAnimationFrame(() => panelRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, refresh]);

  if (!inbox || !inbox.available) return null;
  const staff = inbox.surface === 'staff';
  const label = staff ? 'Notificaciones' : 'Novedades';
  const groups = groupInboxByDay(filterInbox(inbox.latest, staff ? filter : 'all'));

  const openItem = (item: InboxNotification) => {
    if (!item.readAt) void inbox.markRead({ ids: [item.id] });
    setOpen(false);
  };

  const take = async (item: InboxNotification) => {
    if (!item.quoteRequestId) return;
    setTakingId(item.id);
    try {
      const response = await fetch(`/api/staff/quote-requests/${item.quoteRequestId}/take`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      await readApiResponseOrThrow(response, 'No fue posible tomar la solicitud.');
      showToast(`Tomaste ${item.folio ?? 'la solicitud'}.`);
      await inbox.refresh();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'No fue posible tomar la solicitud.', { tone: 'error' });
    } finally {
      setTakingId(null);
    }
  };

  const actionsFor = (item: InboxNotification) => {
    if (item.kind === 'request.new_unassigned' && session?.capabilities.requestsClaim) {
      return <button type="button" className="inbox-action" disabled={takingId === item.id} onClick={() => void take(item)}>{takingId === item.id ? 'Tomando…' : 'Tomar'}</button>;
    }
    if (item.kind === 'approval.requested') return <Link className="inbox-action" href="/staff/approvals" onClick={() => openItem(item)}>Decidir</Link>;
    if (item.kind === 'customer.activity' || item.kind === 'quote.changes_requested') return <Link className="inbox-action" href={item.actionPath} onClick={() => openItem(item)}>Responder</Link>;
    return null;
  };

  return (
    <div className={['inbox-bell', staff ? 'inbox-bell--staff' : 'inbox-bell--portal', className].filter(Boolean).join(' ')} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="inbox-bell__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={inbox.unread > 0 ? `${label}, ${inbox.unread} sin leer` : label}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={18} aria-hidden="true" />
        {!staff && <span className="inbox-bell__label">{label}</span>}
        {inbox.unread > 0 && <span className="inbox-bell__badge" aria-hidden="true">{badgeCount(inbox.unread)}</span>}
      </button>
      {open && (
        <div id={panelId} ref={panelRef} className="inbox-panel" role="dialog" aria-label={label} tabIndex={-1}>
          <div className="inbox-panel__head">
            <strong>{label}</strong>
            <div className="inbox-panel__head-actions">
              {inbox.unread > 0 && <button type="button" className="inbox-panel__text-button" onClick={() => void inbox.markRead({ all: true })}><CheckCheck size={15} aria-hidden="true" />Marcar todo como leído</button>}
              <button type="button" className="inbox-panel__close" aria-label={`Cerrar ${label.toLowerCase()}`} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={16} aria-hidden="true" /></button>
            </div>
          </div>
          {staff && (
            <div className="inbox-filters" role="group" aria-label="Filtrar notificaciones">
              {STAFF_FILTERS.map((option) => (
                <button key={option.key} type="button" className="inbox-filter" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>
                  {option.label}{option.key === 'action' && inbox.actionRequired > 0 ? ` · ${inbox.actionRequired}` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="inbox-panel__body">
            {!inbox.loaded && <p className="inbox-empty">Consultando…</p>}
            {inbox.loaded && groups.length === 0 && (
              <div className="inbox-empty">
                <strong>{filter === 'action' ? 'Nada pendiente de tu parte.' : 'Todo al día.'}</strong>
                <span>{staff ? 'Te avisaremos aquí cuando pase algo en tus expedientes.' : 'Aquí verás las novedades de tus proyectos.'}</span>
              </div>
            )}
            {groups.map((group) => (
              <section key={group.key} className="inbox-group" aria-label={group.label}>
                <h3>{group.label}</h3>
                <ul>{group.items.map((item) => <NotificationItem key={item.id} item={item} onOpen={openItem} actions={staff ? actionsFor(item) : null} />)}</ul>
              </section>
            ))}
          </div>
          {staff && <div className="inbox-panel__foot"><Link href="/staff/notifications" onClick={() => setOpen(false)}>Ver todas</Link></div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Estilos**

Crear `src/components/inbox/inbox.css`:

```css
/* ───────────────────────── Bandeja de avisos (campana, panel, página y portal) ───────────────────────── */

.inbox-bell { position: relative; flex: 0 0 auto; }
.inbox-bell__trigger { position: relative; display: inline-flex; min-width: 44px; min-height: 44px; align-items: center; justify-content: center; gap: 8px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 999px; padding: 0 14px; background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 600; transition: background var(--private-motion-standard), border-color var(--private-motion-standard); }
.inbox-bell--staff .inbox-bell__trigger { width: 44px; padding: 0; }
.inbox-bell__trigger:hover, .inbox-bell__trigger[aria-expanded="true"] { border-color: color-mix(in srgb, currentColor 32%, transparent); background: color-mix(in srgb, currentColor 12%, transparent); }
.inbox-bell__trigger:focus-visible { outline: 2px solid #d7ad68; outline-offset: 2px; }
.inbox-bell__badge { position: absolute; top: -4px; right: -4px; display: inline-grid; min-width: 20px; height: 20px; place-items: center; border-radius: 999px; padding: 0 5px; background: var(--private-color-danger); color: #fff; font-size: 11px; font-weight: 800; line-height: 1; box-shadow: 0 0 0 2px #0a2a3a; }

.inbox-panel { position: absolute; z-index: var(--private-z-popover); top: calc(100% + 10px); right: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; width: min(400px, calc(100vw - 24px)); max-height: min(72vh, 620px); border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); background: var(--private-color-surface); color: var(--private-color-ink); box-shadow: var(--private-shadow-popover); text-align: left; animation: private-ui-pop 140ms cubic-bezier(.2, .7, .2, 1); }
.inbox-panel:focus { outline: 0; }
.inbox-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--private-color-border); padding: 12px 12px 10px 16px; }
.inbox-panel__head strong { color: var(--private-color-brand); font-size: 15px; }
.inbox-panel__head-actions { display: flex; align-items: center; gap: 4px; }
.inbox-panel__text-button { display: inline-flex; min-height: 34px; align-items: center; gap: 6px; border: 0; border-radius: var(--private-radius-sm); padding: 0 8px; background: transparent; color: var(--private-color-accent); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; }
.inbox-panel__text-button:hover, .inbox-panel__text-button:focus-visible { background: var(--private-tint-accent); outline: 0; }
.inbox-panel__close { display: inline-grid; width: 34px; height: 34px; place-items: center; border: 0; border-radius: var(--private-radius-sm); background: transparent; color: var(--private-color-ink-muted); cursor: pointer; }
.inbox-panel__close:hover, .inbox-panel__close:focus-visible { background: var(--private-color-surface-muted); outline: 0; }
.inbox-filters { display: flex; gap: 6px; overflow-x: auto; padding: 10px 16px 6px; }
.inbox-filter { flex: 0 0 auto; min-height: 32px; border: 1px solid var(--private-color-border-control); border-radius: 999px; padding: 0 12px; background: transparent; color: var(--private-color-ink-muted); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; }
.inbox-filter[aria-pressed="true"] { border-color: var(--private-color-accent); background: var(--private-tint-accent); color: var(--private-color-accent); }
.inbox-filter:focus-visible { outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
.inbox-panel__body { overflow-y: auto; overscroll-behavior: contain; padding: 4px 0 8px; }
.inbox-panel__foot { display: flex; justify-content: center; border-top: 1px solid var(--private-color-border); padding: 10px; }
.inbox-panel__foot a { color: var(--private-color-accent); font-size: 13px; font-weight: 700; text-decoration: none; }
.inbox-panel__foot a:hover { text-decoration: underline; }

.inbox-group h3 { margin: 10px 16px 4px; color: var(--private-color-ink-muted); font-size: 11.5px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.inbox-group ul { margin: 0; padding: 0; list-style: none; }
.inbox-item { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) 10px; align-items: start; gap: 10px; padding: 10px 16px; transition: background var(--private-motion-standard); }
.inbox-item:hover { background: var(--private-color-surface-muted); }
.inbox-item.is-unread { background: color-mix(in srgb, var(--private-color-accent) 5%, transparent); }
.inbox-item.is-resolved { opacity: .8; }
.inbox-item__icon { display: inline-grid; width: 32px; height: 32px; place-items: center; border-radius: 50%; }
.inbox-item__icon--accent { background: var(--private-tint-accent); color: var(--private-color-accent); }
.inbox-item__icon--success { background: var(--private-tint-success); color: var(--private-color-success); }
.inbox-item__icon--copper { background: var(--private-tint-copper); color: var(--private-color-copper); }
.inbox-item__icon--danger { background: var(--private-tint-danger); color: var(--private-color-danger); }
.inbox-item__icon--muted { background: var(--private-color-surface-muted); color: var(--private-color-ink-muted); }
.inbox-item__main { display: grid; min-width: 0; gap: 3px; }
.inbox-item__link { display: grid; gap: 2px; color: inherit; text-decoration: none; }
/* Toda la fila abre el aviso; las acciones quedan por encima para seguir siendo clicables. */
.inbox-item__link::after { position: absolute; inset: 0; content: ''; }
.inbox-item__link strong { color: var(--private-color-ink); font-size: 13.5px; font-weight: 650; line-height: 1.35; }
.inbox-item.is-unread .inbox-item__link strong { font-weight: 750; }
.inbox-item__link:focus-visible { border-radius: 4px; outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
.inbox-item__body { display: -webkit-box; overflow: hidden; color: var(--private-color-ink-muted); font-size: 12.5px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.inbox-item__meta { display: flex; flex-wrap: wrap; gap: 4px 8px; color: var(--private-color-ink-muted); font-size: 11.5px; }
.inbox-item__resolved { justify-self: start; border-radius: 999px; padding: 2px 8px; background: var(--private-color-surface-sunken); color: var(--private-color-ink-muted); font-size: 11.5px; font-weight: 650; }
.inbox-item__actions { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.inbox-item__dot { width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; background: var(--private-color-accent); }
.inbox-action { display: inline-flex; min-height: 32px; align-items: center; border: 1px solid var(--private-color-border-control); border-radius: var(--private-radius-control); padding: 0 12px; background: var(--private-color-surface); color: var(--private-color-brand); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 700; text-decoration: none; }
.inbox-action:hover { border-color: var(--private-color-accent); color: var(--private-color-accent); }
.inbox-action:disabled { cursor: wait; opacity: .6; }
.inbox-action:focus-visible { outline: 2px solid var(--private-color-focus); outline-offset: 2px; }
.inbox-empty { display: grid; gap: 4px; margin: 0; padding: 28px 20px; color: var(--private-color-ink-muted); font-size: 13px; text-align: center; }
.inbox-empty strong { color: var(--private-color-ink); font-size: 14px; }

/* Página de notificaciones */
.staff-inbox { display: grid; gap: 16px; }
.staff-inbox__toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.staff-inbox__list { overflow: hidden; border: 1px solid var(--private-color-border); border-radius: var(--private-radius-panel); background: var(--private-color-surface); box-shadow: var(--private-shadow-card); }
.staff-inbox__more { display: flex; justify-content: center; padding: 12px; }

/* Portal: novedades por expediente y banner "Desde tu última visita" */
.client-request-row.is-unread strong { color: var(--private-color-brand); }
.client-request-row__news { justify-self: start; border-radius: 999px; padding: 2px 8px; background: var(--private-tint-accent); color: var(--private-color-accent); font-size: 11.5px; font-style: normal; font-weight: 750; }
.client-since { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; border: 1px solid color-mix(in srgb, var(--private-color-accent) 30%, transparent); border-radius: var(--private-radius-panel); padding: 14px 16px; background: var(--private-tint-accent); }
.client-since ul { display: grid; gap: 4px; margin: 6px 0 0; padding-left: 18px; color: var(--private-color-ink); font-size: 14px; }
.client-since__dismiss { display: inline-grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border: 0; border-radius: var(--private-radius-sm); background: transparent; color: var(--private-color-ink-muted); cursor: pointer; }
.client-since__dismiss:focus-visible { outline: 2px solid var(--private-color-focus); outline-offset: 2px; }

@media (max-width: 768px) {
  .inbox-panel { position: fixed; top: 72px; right: 12px; bottom: 12px; left: 12px; width: auto; max-height: none; }
  .inbox-bell__label { display: none; }
  .inbox-bell--portal .inbox-bell__trigger { width: 44px; padding: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .inbox-panel { animation: none; }
  .inbox-item, .inbox-bell__trigger { transition: none; }
}
```

- [ ] **Step 8: Conectar el proveedor y la campana**

En `src/components/private/navigation.ts`, agrega a `PrivateStaffCapabilities`, después de `requestsRead?: boolean;`:

```ts
  /** requests.claim: puede tomar solicitudes sin responsable (acción "Tomar" de la campana). */
  requestsClaim?: boolean;
```

En `src/server/private-shell.ts`, dentro de `staffCapabilities`, agrega después de `requestsRead: …`:

```ts
    requestsClaim: hasPermission(subject, 'requests.claim'),
```

Reemplaza `src/app/staff/layout.tsx` completo:

```tsx
import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { visibleStaffNavigation } from '@/components/private/navigation';
import { InboxProvider } from '@/components/inbox/InboxProvider';
import { StaffSessionProvider } from '@/components/staff/StaffSessionContext';
import { getPrivateShellContext, getStaffHeaderContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';
import '@/components/inbox/inbox.css';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  if (!readCommercialV2Flags().commercialWorkspaceV2) {
    // Identidad y permisos para el header compartido de staff (menú de cuenta, "Cerrar sesión",
    // navegación filtrada). Es un dato de presentación: una sola lectura sin transacción, y si
    // falla (p. ej. el pool de conexiones saturado) la página no debe caerse -- cada panel sigue
    // validando la sesión contra su propia API y el header se muestra sin menú de cuenta.
    const session = await getStaffHeaderContext().catch(() => null);
    return <div className="private-ui-scope"><PrivateToastProvider><InboxProvider surface="staff"><StaffSessionProvider session={session}>{children}</StaffSessionProvider></InboxProvider></PrivateToastProvider></div>;
  }
  const context = await getPrivateShellContext('staff');
  const content = <StaffSessionProvider session={context}>{children}</StaffSessionProvider>;
  if (!context) return <div className="private-ui-scope"><PrivateToastProvider><InboxProvider surface="staff">{content}</InboxProvider></PrivateToastProvider></div>;
  return <div className="private-ui-scope"><PrivateToastProvider><InboxProvider surface="staff"><PrivateShell surface="staff" context={context} navigation={visibleStaffNavigation(context.capabilities)}>{content}</PrivateShell></InboxProvider></PrivateToastProvider></div>;
}
```

Reemplaza `src/app/portal/layout.tsx` completo:

```tsx
import type { ReactNode } from 'react';
import PrivateShell from '@/components/private/PrivateShell';
import { PrivateToastProvider } from '@/components/private/ui/PrivateToast';
import { InboxProvider } from '@/components/inbox/InboxProvider';
import { getPrivateShellContext } from '@/server/private-shell';
import { readCommercialV2Flags } from '@/server/flags/commercial-v2';
import '@/components/private/ui/private-ui.css';
import '@/components/private/ui/private-surfaces.css';
import '@/components/inbox/inbox.css';

const PORTAL_NAVIGATION = [{ key: 'portal', href: '/portal', label: 'Mis expedientes', capability: 'requestsRead' }] as const;

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const wrap = (content: ReactNode) => <div className="private-ui-scope"><PrivateToastProvider><InboxProvider surface="portal">{content}</InboxProvider></PrivateToastProvider></div>;
  if (!readCommercialV2Flags().commercialWorkspaceV2) return wrap(children);
  const context = await getPrivateShellContext('portal');
  if (!context) return wrap(children);
  return wrap(<PrivateShell surface="portal" context={context} navigation={PORTAL_NAVIGATION}>{children}</PrivateShell>);
}
```

En `src/components/StaffHeader.tsx`:
- Agrega `import NotificationBell from '@/components/inbox/NotificationBell';`.
- Dentro de `<div className="staff-header__tools">`, justo después de `<StaffQuickFind sections={quickFindSections} onNavigate={onNavigate} />`, agrega:

```tsx
            {session && <NotificationBell />}
```

En `src/components/private/PrivateShellChrome.tsx`:
- Agrega `import NotificationBell from '@/components/inbox/NotificationBell';`.
- Dentro de `<div className="private-shell__topline">`, justo antes del `<button className="private-shell__menu-toggle" …>`, agrega:

```tsx
        <NotificationBell />
```

En `src/components/ClientPortalPanel.tsx`:
- Agrega `import NotificationBell from '@/components/inbox/NotificationBell';`.
- En el encabezado, reemplaza `<button type="button" className="client-header__logout" onClick={() => void logout()}>Cerrar sesión</button>` por:

```tsx
<NotificationBell /><button type="button" className="client-header__logout" onClick={() => void logout()}>Cerrar sesión</button>
```

- [ ] **Step 9: Verificación**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Expected: sin errores; todas las unitarias pasan.

Levanta el servidor de QA para no tocar el del usuario en :3000.
1. Agrega una configuración temporal en `.claude/launch.json` con el nombre `qa-3010` y el comando `npx cross-env NEXT_DIST_DIR=.next-qa APP_URL=http://localhost:3010 next dev -p 3010`.
2. Arráncala con `preview_start`.
3. Entra con una sesión de QA creada por la prueba E2E de la tarea 13, o con un token de `createSession` desde un script temporal en `scripts/` que se borra al terminar.

Comprueba:
- En `/staff`, la campana aparece junto al buscador y el panel se abre con Esc y clic afuera.
- En `/portal`, el botón "Novedades" aparece junto a "Cerrar sesión".
- A 390 px el panel ocupa la pantalla y no provoca desborde horizontal.

Al terminar, detén el preview, corre `git checkout -- tsconfig.json`, borra `.next-qa/` y quita la entrada de `launch.json`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/inbox-client.ts src/components/inbox src/app/staff/layout.tsx src/app/portal/layout.tsx src/components/StaffHeader.tsx src/components/private/PrivateShellChrome.tsx src/components/private/navigation.ts src/server/private-shell.ts src/components/ClientPortalPanel.tsx tests/unit/inbox-client.test.ts
git commit -m "feat(inbox): campana con panel agrupado por día, filtros, acción Tomar y contador en el título"
```

---

### Task 11: Página de notificaciones, "Entregas de correo" y permisos

**Files:**
- Create: `src/components/StaffInboxPanel.tsx`
- Rename: `src/components/StaffNotificationsPanel.tsx` pasa a `src/components/StaffEmailDeliveriesPanel.tsx`
- Modify: `src/app/staff/notifications/page.tsx`
- Create: `src/app/staff/notifications/deliveries/page.tsx`
- Create: `prisma/migrations/20260929030000_sales_without_delivery_monitor/migration.sql`
- Modify: `src/server/auth/constants.ts`, `src/server/modules/notifications/staff-service.ts`, `src/components/StaffHeader.tsx`, `src/components/private/navigation.ts` y `src/components/StaffDashboardPanel.tsx`
- Modify tests: `tests/integration/notifications-staff-api.test.ts`, `tests/unit/private-navigation-contract.test.ts`, `tests/unit/auth-permissions.test.ts`, `tests/unit/notifications-domain.test.ts` y `tests/staff-notifications.spec.ts`

**Interfaces:**
- Consumes (Task 10): `useInbox`, `NotificationItem`, `fetchInboxPage` y `groupInboxByDay`.
- Produces:
  - `/staff/notifications` es la bandeja completa de todo el equipo.
  - `/staff/notifications/deliveries` es el monitor técnico, visible sólo con `notifications.read`, que tienen Gerencia y Admin.

- [ ] **Step 1: Ajustar las pruebas existentes a la nueva forma (fallan hasta implementar)**

En `tests/integration/notifications-staff-api.test.ts`, reemplaza:

```ts
    expect((await notificationsGet(endpoint('/api/staff/notifications', salesToken))).status).toBe(200);
```

por:

```ts
    // Ventas ya no ve el monitor técnico: sus avisos de correo no entregado llegan a su bandeja.
    expect((await notificationsGet(endpoint('/api/staff/notifications', salesToken))).status).toBe(403);
```

En `tests/unit/private-navigation-contract.test.ts`, reemplaza la lista esperada:

```ts
      'catalog',
      'notifications',
    ]);
```

por:

```ts
      'catalog',
    ]);
```

En `tests/staff-notifications.spec.ts`, reemplaza:

```ts
    await page.goto('/staff/notifications');
    await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
```

por:

```ts
    await page.goto('/staff/notifications/deliveries');
    await expect(page.getByRole('heading', { name: 'Entregas de correo' })).toBeVisible();
```

En `tests/unit/auth-permissions.test.ts`, borra la línea `'notifications.read',` del conjunto esperado de `permissionKeysForRoles(['sales'])`.

En `tests/unit/notifications-domain.test.ts`, reemplaza:

```ts
    expect(sales.permissionKeys.has('notifications.read')).toBe(true);
```

por:

```ts
    // El monitor técnico de correos es de Gerencia y Administración; Ventas recibe sus fallos en la bandeja.
    expect(sales.permissionKeys.has('notifications.read')).toBe(false);
```

Run: `npx vitest run tests/unit/private-navigation-contract.test.ts tests/unit/auth-permissions.test.ts tests/unit/notifications-domain.test.ts && RUN_DB_TESTS=1 npx vitest run tests/integration/notifications-staff-api.test.ts`
Expected: FAIL. La navegación todavía incluye `notifications`, Ventas todavía tiene el permiso y recibe 200.

- [ ] **Step 2: Permiso de Ventas**

En `src/server/auth/constants.ts`, dentro de `sales.permissions`, borra la línea `'notifications.read',`, la que está entre `'quotes.pdf.generate',` y `'metrics.read',`.

Crear `prisma/migrations/20260929030000_sales_without_delivery_monitor/migration.sql`:

```sql
-- Ventas deja de ver el monitor técnico de correos (spec 2026-09-29 §5.2): sus avisos de correo no
-- entregado llegan a su bandeja. El seed sólo agrega permisos, así que el retiro va aquí.
DELETE FROM "role_permissions"
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "key" = 'sales')
  AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "key" = 'notifications.read');
```

Run: `npx prisma migrate deploy`
Expected: "Applying migration `20260929030000_sales_without_delivery_monitor`".

- [ ] **Step 3: El monitor pasa a "Entregas de correo"**

Run: `git mv src/components/StaffNotificationsPanel.tsx src/components/StaffEmailDeliveriesPanel.tsx`

En `src/components/StaffEmailDeliveriesPanel.tsx`:

1. Renombra `export default function StaffNotificationsPanel()` a `export default function StaffEmailDeliveriesPanel()`.
2. El filtro recordado usa una llave nueva y por defecto muestra sólo lo que falló:

```ts
  const [statusFilter, setStatusFilter, statusFilterHydrated] = usePersistentState<NotificationStatus>('ocpool.staff.deliveries.statusFilter', 'FAILED');
```

3. En `statusLabel`, reemplaza `'Todos los estados'` por `'Todas menos canceladas'`. Haz lo mismo en el `placeholder` del `PrivateSelect`.
4. En el estado de acceso restringido, reemplaza el texto `Necesitas una cuenta de empleado con permiso de notificaciones para consultar esta operación.` por:

```tsx
Esta vista es para Gerencia y Administración. Tus avisos están en Notificaciones.
```

Y en sus acciones reemplaza `<PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton>` por:

```tsx
<PrivateLinkButton href="/staff/notifications">Ver mis notificaciones</PrivateLinkButton>
```

5. Reemplaza el bloque de introducción:

```tsx
        <div className="staff-intro">
          <div><p className="staff-kicker">Entrega transaccional</p><h1>Notificaciones</h1><p className="staff-intro__copy">Diagnóstico seguro de la cola de correo, sin exponer destinatarios ni contenido privado.</p></div>
        </div>
```

por:

```tsx
        <div className="staff-intro">
          <div><p className="staff-kicker">Operación de correo</p><h1>Entregas de correo</h1><p className="staff-intro__copy">Diagnóstico seguro de la cola de correo, sin exponer destinatarios ni contenido privado.</p></div>
          <PrivateLinkButton href="/staff/notifications" variant="quiet">Ver mis notificaciones</PrivateLinkButton>
        </div>
```

En `src/server/modules/notifications/staff-service.ts`, dentro de `listStaffNotificationDeliveries`, "Todas" deja fuera las canceladas por el sistema. Reemplaza:

```ts
  const where = { status: normalized.status };
```

por:

```ts
  // "Todas" es todo lo que merece atención: las canceladas por el sistema sólo con su propio filtro.
  const where = normalized.status ? { status: normalized.status } : { status: { not: 'CANCELLED' as const } };
```

Crear `src/app/staff/notifications/deliveries/page.tsx`:

```tsx
import type { Metadata } from 'next';
import StaffEmailDeliveriesPanel from '@/components/StaffEmailDeliveriesPanel';

export const metadata: Metadata = {
  title: 'Entregas de correo | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffEmailDeliveriesPage() {
  return <StaffEmailDeliveriesPanel />;
}
```

- [ ] **Step 4: Página de la bandeja**

Crear `src/components/StaffInboxPanel.tsx`:

```tsx
'use client';

import { CheckCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import NotificationItem from '@/components/inbox/NotificationItem';
import { useInbox } from '@/components/inbox/InboxProvider';
import PrivateSurfaceRoot from '@/components/private/PrivateSurfaceRoot';
import { PrivateBlockingState, PrivateButton, PrivateLinkButton } from '@/components/private/ui';
import { useStaffSession } from '@/components/staff/StaffSessionContext';
import StaffHeader from '@/components/StaffHeader';
import WorkspaceBrand from '@/components/WorkspaceBrand';
import { fetchInboxPage, groupInboxByDay, InboxRequestError, type InboxFilter, type InboxNotification } from '@/lib/inbox-client';

const FILTERS: ReadonlyArray<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Sin leer' },
  { key: 'action', label: 'Requieren acción' },
];

export default function StaffInboxPanel() {
  const inbox = useInbox();
  const session = useStaffSession();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);

  const load = useCallback(async (nextFilter: InboxFilter, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchInboxPage(nextFilter, null, signal);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setRestricted(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (caught instanceof InboxRequestError && (caught.status === 401 || caught.status === 403)) setRestricted(true);
      setError(caught instanceof Error ? caught.message : 'No fue posible consultar tus avisos.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(filter, controller.signal);
    return () => controller.abort();
  }, [filter, load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchInboxPage(filter, nextCursor);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar más avisos.');
    } finally {
      setLoadingMore(false);
    }
  };

  const markAll = async () => {
    await inbox?.markRead({ all: true });
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
  };

  const openItem = (item: InboxNotification) => {
    if (item.readAt) return;
    void inbox?.markRead({ ids: [item.id] });
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)));
  };

  if (restricted) {
    return <PrivateSurfaceRoot className="staff-shell staff-shell--restricted"><WorkspaceBrand className="staff-brand" subtitle="Operaciones comerciales" /><PrivateBlockingState title="Acceso restringido." action={<div className="private-blocking__actions"><PrivateLinkButton href="/login">Iniciar sesión</PrivateLinkButton></div>}>Inicia sesión con tu cuenta del equipo para ver tus avisos.</PrivateBlockingState></PrivateSurfaceRoot>;
  }

  const groups = groupInboxByDay(items);

  return (
    <PrivateSurfaceRoot className="staff-shell">
      <StaffHeader />
      <div className="staff-content staff-inbox">
        <div className="staff-intro">
          <div><p className="staff-kicker">Tu actividad</p><h1>Notificaciones</h1><p className="staff-intro__copy">Lo que pasa en tus expedientes, en cuanto pasa.</p></div>
          {session?.capabilities.notificationsManage && <PrivateLinkButton href="/staff/notifications/deliveries" variant="quiet">Entregas de correo</PrivateLinkButton>}
        </div>
        <div className="staff-inbox__toolbar">
          <div className="inbox-filters" role="group" aria-label="Filtrar notificaciones">
            {FILTERS.map((option) => (
              <button key={option.key} type="button" className="inbox-filter" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>
                {option.label}{option.key === 'action' && inbox && inbox.actionRequired > 0 ? ` · ${inbox.actionRequired}` : ''}
              </button>
            ))}
          </div>
          {inbox && inbox.unread > 0 && <PrivateButton type="button" variant="quiet" onClick={() => void markAll()}><CheckCheck size={15} aria-hidden="true" /> Marcar todo como leído</PrivateButton>}
        </div>
        {error && <p className="staff-error" role="alert">{error}</p>}
        <section className="staff-inbox__list" aria-live="polite" aria-busy={loading}>
          {loading && items.length === 0 && <p className="inbox-empty">Consultando…</p>}
          {!loading && items.length === 0 && <div className="inbox-empty"><strong>{filter === 'action' ? 'Nada pendiente de tu parte.' : 'Todo al día.'}</strong><span>Te avisaremos aquí cuando pase algo en tus expedientes.</span></div>}
          {groups.map((group) => (
            <section key={group.key} className="inbox-group" aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>{group.items.map((item) => <NotificationItem key={item.id} item={item} onOpen={openItem} />)}</ul>
            </section>
          ))}
          {nextCursor && <div className="staff-inbox__more"><PrivateButton type="button" variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>Ver más</PrivateButton></div>}
        </section>
      </div>
    </PrivateSurfaceRoot>
  );
}
```

Reemplaza `src/app/staff/notifications/page.tsx` completo:

```tsx
import type { Metadata } from 'next';
import StaffInboxPanel from '@/components/StaffInboxPanel';

export const metadata: Metadata = {
  title: 'Notificaciones | OCPOOL Operaciones',
  robots: { index: false, follow: false },
};

export default function StaffNotificationsPage() {
  return <StaffInboxPanel />;
}
```

- [ ] **Step 5: Navegación, buscador rápido y dashboard**

En `src/components/StaffHeader.tsx`:
- Borra la línea `{ href: '/staff/notifications', label: 'Notificaciones', icon: Bell, capability: 'notificationsRead' },` de `SECTIONS`: la campana la reemplaza.
- Agrega `MailWarning` a la importación de `lucide-react`.
- Reemplaza la construcción de `quickFindSections` por:

```tsx
  const quickFindSections = session ? [
    ...sections,
    { href: '/staff/notifications', label: 'Notificaciones', icon: Bell },
    ...(session.capabilities.notificationsManage ? [{ href: '/staff/notifications/deliveries', label: 'Entregas de correo', icon: MailWarning }] : []),
    { href: '/staff/account', label: 'Mi cuenta', icon: UserRound },
  ] : sections;
```

En `src/components/private/navigation.ts`, borra la línea `{ key: 'notifications', href: '/staff/notifications', label: 'Notificaciones', capability: 'notificationsRead' },` de `STAFF_NAVIGATION`.

En `src/components/StaffDashboardPanel.tsx`:
- Justo después de `const session = useStaffSession();`, agrega:

```tsx
  // Ventas ya no tiene el monitor de correos: su tarjeta de fallos y sus enlaces sólo aparecen para quien sí.
  const canSeeDeliveries = session?.capabilities.notificationsRead !== false;
```

- En `loadQueues`, reemplaza `fetch('/api/staff/notifications?status=FAILED&pageSize=5', { credentials: 'include', cache: 'no-store', signal: controller.signal }),` por:

```tsx
          canSeeDeliveries
            ? fetch('/api/staff/notifications?status=FAILED&pageSize=5', { credentials: 'include', cache: 'no-store', signal: controller.signal })
            : Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })),
```

- Cambia la lista de dependencias de ese `useEffect` de `[]` a `[canSeeDeliveries]`.
- Reemplaza `...(dashboard.notifications.failedInPeriod > 0 ? [{ label:` por `...(canSeeDeliveries && dashboard.notifications.failedInPeriod > 0 ? [{ label:`.
- Reemplaza las tres apariciones de `'/staff/notifications?status=FAILED'` y `"/staff/notifications?status=FAILED"` por `/staff/notifications/deliveries?status=FAILED`, conservando el tipo de comillas de cada una.
- Reemplaza `'Revisar en Notificaciones →'` por `'Revisar en Entregas de correo →'`.
- Reemplaza `<Link className="analytics-panel__link" href="/staff/notifications">Abrir operación</Link>` por:

```tsx
{canSeeDeliveries && <Link className="analytics-panel__link" href="/staff/notifications/deliveries">Abrir operación</Link>}
```

- [ ] **Step 6: Correr las pruebas**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit && RUN_DB_TESTS=1 npx vitest run tests/integration/notifications-staff-api.test.ts tests/integration/notifications-staff.test.ts tests/integration/identity-rbac.test.ts --maxWorkers=1`
Expected: todo en PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/StaffEmailDeliveriesPanel.tsx src/components/StaffNotificationsPanel.tsx src/components/StaffInboxPanel.tsx src/app/staff/notifications prisma/migrations/20260929030000_sales_without_delivery_monitor src/server/auth/constants.ts src/server/modules/notifications/staff-service.ts src/components/StaffHeader.tsx src/components/private/navigation.ts src/components/StaffDashboardPanel.tsx tests/integration/notifications-staff-api.test.ts tests/unit/private-navigation-contract.test.ts tests/unit/auth-permissions.test.ts tests/unit/notifications-domain.test.ts tests/staff-notifications.spec.ts
git commit -m "feat(inbox): página de notificaciones para todo el equipo; el monitor técnico pasa a Entregas de correo (Gerencia y Admin)"
```

---

### Task 12: Leer al abrir el expediente y novedades en el portal

**Files:**
- Create: `src/components/inbox/SinceLastVisitBanner.tsx`
- Modify: `src/components/StaffRequestsPanel.tsx`, `src/components/RequestWorkspaceDetailV2.tsx` y `src/components/ClientPortalPanel.tsx`

**Interfaces:**
- Consumes (Task 10): `useInbox().markRead` y `useInbox().unreadByRequest`.
- Produces:
  - Al abrir un expediente en staff se leen sus avisos que no requieren acción.
  - Al abrir un expediente en el portal se leen todos sus avisos, y antes aparece el banner "Desde tu última visita".
  - El riel del portal muestra "N nuevas" por expediente.

- [ ] **Step 1: Banner del portal**

Crear `src/components/inbox/SinceLastVisitBanner.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import type { InboxNotification } from '@/lib/inbox-client';

export default function SinceLastVisitBanner({ items, onDismiss }: Readonly<{ items: readonly InboxNotification[]; onDismiss: () => void }>) {
  if (items.length === 0) return null;
  return (
    <section className="client-since" aria-label="Novedades desde tu última visita">
      <div>
        <p className="client-eyebrow">Desde tu última visita</p>
        <ul>{items.slice(0, 4).map((item) => <li key={item.id}>{item.title}</li>)}</ul>
      </div>
      <button type="button" className="client-since__dismiss" aria-label="Ocultar novedades" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </section>
  );
}
```

- [ ] **Step 2: Portal — riel, banner y lectura**

En `src/components/ClientPortalPanel.tsx`:

1. Agrega los imports:

```tsx
import SinceLastVisitBanner from '@/components/inbox/SinceLastVisitBanner';
import { useInbox } from '@/components/inbox/InboxProvider';
import type { InboxNotification } from '@/lib/inbox-client';
```

2. Al inicio de `ClientPortalPanel()`, después de los `useState` existentes, agrega:

```tsx
  const inbox = useInbox();
  const [sinceLastVisit, setSinceLastVisit] = useState<InboxNotification[]>([]);
  const acknowledgedRequestRef = useRef<string | null>(null);
```

3. Justo antes del `return` principal (el que empieza con `return <PrivateSurfaceRoot className="client-portal">`) y **antes** de cualquier `return` temprano, agrega el efecto de abajo.
   - Es reactivo a propósito: el expediente y el resumen de avisos cargan por separado y en cualquier orden, así que sólo actúa cuando ambos ya están.
   - Si el componente tiene un `return` temprano (por ejemplo `if (restricted) return …`), colócalo antes de ese `return` para no romper el orden de los hooks.

```tsx
  // Lo nuevo del expediente abierto se muestra una vez ("Desde tu última visita") y queda leído.
  const openRequestId = workspace?.request.id ?? null;
  const openUnread = openRequestId ? inbox?.unreadByRequest[openRequestId] ?? 0 : 0;
  useEffect(() => {
    if (!inbox?.loaded || !openRequestId) return;
    if (acknowledgedRequestRef.current !== openRequestId) {
      acknowledgedRequestRef.current = openRequestId;
      setSinceLastVisit(inbox.latest.filter((item) => item.quoteRequestId === openRequestId && !item.readAt && !item.resolvedAt));
    }
    if (openUnread > 0) void inbox.markRead({ quoteRequestId: openRequestId, scope: 'all' });
  }, [inbox, openRequestId, openUnread]);
```

4. En el riel, reemplaza el botón de cada expediente:

```tsx
<button type="button" className={`client-request-row${selectedId === item.id ? ' is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="client-request-row__mark" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.detail?.projectType ?? 'Proyecto OCPOOL'}</b><small>{item.detail?.location ?? 'Ubicación por confirmar'}</small></span><em>{statusLabel(item.status)}</em></button>
```

por:

```tsx
<button type="button" className={`client-request-row${selectedId === item.id ? ' is-selected' : ''}${inbox?.unreadByRequest[item.id] ? ' is-unread' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="client-request-row__mark" aria-hidden="true" /><span><strong>{item.folio}</strong><b>{item.detail?.projectType ?? 'Proyecto OCPOOL'}</b><small>{item.detail?.location ?? 'Ubicación por confirmar'}</small>{inbox?.unreadByRequest[item.id] ? <span className="client-request-row__news">{inbox.unreadByRequest[item.id] === 1 ? '1 nueva' : `${inbox.unreadByRequest[item.id]} nuevas`}</span> : null}</span><em>{statusLabel(item.status)}</em></button>
```

5. En el detalle, reemplaza `{!loadingDetail && workspace && <><div className="client-detail__intro">` por:

```tsx
{!loadingDetail && workspace && <><SinceLastVisitBanner items={sinceLastVisit} onDismiss={() => setSinceLastVisit([])} /><div className="client-detail__intro">
```

- [ ] **Step 3: Staff — leer la actividad al abrir el expediente**

En `src/components/StaffRequestsPanel.tsx`:
- Agrega `import { useInbox } from '@/components/inbox/InboxProvider';`.
- Justo después de `const [selected, setSelected] = useState<RequestDetail | null>(null);`, agrega lo de abajo.
  - Es reactivo: el expediente y el resumen de avisos cargan en cualquier orden.
  - Si llega actividad nueva mientras el expediente sigue abierto, el contador cambia y se vuelve a leer.

```tsx
  // Abrir el expediente da por vista su actividad; lo que pide una acción (aprobar, tomar) sigue pendiente.
  const inbox = useInbox();
  const openRequestId = selected?.id ?? null;
  const openUnread = openRequestId ? inbox?.unreadByRequest[openRequestId] ?? 0 : 0;
  const markInboxRead = inbox?.markRead;
  useEffect(() => {
    if (!openRequestId || openUnread === 0 || !markInboxRead) return;
    void markInboxRead({ quoteRequestId: openRequestId, scope: 'activity' });
  }, [openRequestId, openUnread, markInboxRead]);
```

En `src/components/RequestWorkspaceDetailV2.tsx`:
- Agrega `import { useInbox } from '@/components/inbox/InboxProvider';`.
- Dentro del componente, justo después de la declaración del estado `detail` (`const [detail, setDetail] = …`), agrega el mismo bloque, tomando el expediente de `detail`:

```tsx
  // Abrir el expediente da por vista su actividad; lo que pide una acción (aprobar, tomar) sigue pendiente.
  const inbox = useInbox();
  const openRequestId = detail?.id ?? null;
  const openUnread = openRequestId ? inbox?.unreadByRequest[openRequestId] ?? 0 : 0;
  const markInboxRead = inbox?.markRead;
  useEffect(() => {
    if (!openRequestId || openUnread === 0 || !markInboxRead) return;
    void markInboxRead({ quoteRequestId: openRequestId, scope: 'activity' });
  }, [openRequestId, openUnread, markInboxRead]);
```

- [ ] **Step 4: Verificación**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/SinceLastVisitBanner.tsx src/components/ClientPortalPanel.tsx src/components/StaffRequestsPanel.tsx src/components/RequestWorkspaceDetailV2.tsx
git commit -m "feat(inbox): abrir el expediente lee su actividad; el portal muestra novedades por expediente y desde tu última visita"
```

---

### Task 13: Prueba de punta a punta, documentación y verificación completa

**Files:**
- Create: `tests/inbox.spec.ts`
- Create: `docs/ocpool-commercial-v2/specs/2026-09-29-bandeja-de-avisos.md`
- Modify: `PROJECT_STATUS.md` (entrada nueva al inicio de la bitácora) y `README.md` (líneas de `/staff/notifications`)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Escribir la prueba E2E (opt-in `INBOX_E2E=1`)**

Crear `tests/inbox.spec.ts`:

```ts
import 'dotenv/config';
import { expect, test, type Page } from '@playwright/test';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { sendCustomerMessage, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { seedIdentityCatalog } from '../prisma/seed';
import { expectNoSeriousA11yViolations } from './a11y';

test.describe('bandeja de avisos por rol', () => {
  test.skip(process.env.INBOX_E2E !== '1', 'Inbox E2E requires INBOX_E2E=1 and a disposable local database.');
  test.describe.configure({ mode: 'serial' });

  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const origin = process.env.APP_URL ?? 'http://127.0.0.1:3100';
  const now = new Date();
  const salesName = `Ventas QA ${suffix}`;
  const salesToken = `inbox-e2e-sales-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const managerToken = `inbox-e2e-manager-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const customerToken = `inbox-e2e-customer-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`;
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let salesId = '';
  let managerId = '';
  let customerId = '';

  test.beforeAll(async () => {
    if (process.env.INBOX_E2E !== '1') return;
    await seedIdentityCatalog(prisma);
    const [salesRole, managerRole, customerRole] = await Promise.all(['sales', 'manager', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    salesId = (await prisma.user.create({ data: { email: `inbox-e2e-sales-${suffix}@example.test`, emailNormalized: `inbox-e2e-sales-${suffix}@example.test`, displayName: salesName, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    managerId = (await prisma.user.create({ data: { email: `inbox-e2e-manager-${suffix}@example.test`, emailNormalized: `inbox-e2e-manager-${suffix}@example.test`, displayName: `Gerencia QA ${suffix}`, type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `inbox-e2e-${suffix}`, origin: 'PUBLIC_FORM', contact: { displayName: `Cliente QA ${suffix}`, email: `inbox-e2e-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca con jacuzzi', location: 'Monterrey', description: 'Fixture de la bandeja de avisos', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    customerId = (await prisma.user.create({ data: { email: `inbox-e2e-customer-${suffix}@example.test`, emailNormalized: `inbox-e2e-customer-${suffix}@example.test`, displayName: `Cliente QA ${suffix}`, type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await createSession({ userId: salesId, ipAddress: null, userAgent: 'inbox-e2e' }, { prisma, tokenGenerator: () => salesToken });
    await createSession({ userId: managerId, ipAddress: null, userAgent: 'inbox-e2e' }, { prisma, tokenGenerator: () => managerToken });
    await createSession({ userId: customerId, ipAddress: null, userAgent: 'inbox-e2e' }, { prisma, tokenGenerator: () => customerToken });
  });

  test.afterAll(async () => {
    if (process.env.INBOX_E2E !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [salesId, managerId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.session.deleteMany({ where: { userId: { in: [salesId, managerId, customerId] } } });
    for (const userId of [salesId, customerId]) await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${userId}:${requestId}`) } });
    await prisma.user.deleteMany({ where: { id: { in: [salesId, managerId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  async function signIn(page: Page, token: string) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'ocpool_session', value: token, url: origin }]);
  }

  async function openBell(page: Page, name: RegExp) {
    await page.getByRole('button', { name }).click();
    return page.getByRole('dialog', { name: name.source.startsWith('Novedades') ? 'Novedades' : 'Notificaciones' });
  }

  test('Ventas ve la solicitud nueva del sitio y la toma desde la campana', async ({ page }) => {
    await signIn(page, salesToken);
    await page.goto('/staff/requests');
    const panel = await openBell(page, /Notificaciones/);
    const notice = panel.getByRole('listitem').filter({ hasText: 'Nueva solicitud: Alberca con jacuzzi en Monterrey' });
    await expect(notice).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await notice.getByRole('button', { name: 'Tomar' }).click();
    await expect(page.getByText(`Tomaste ${folio}.`)).toBeVisible();
    await expect.poll(async () => (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).currentAssigneeId).toBe(salesId);
  });

  test('Gerencia ve quién la tomó y tiene Entregas de correo; Ventas no', async ({ page }) => {
    await signIn(page, managerToken);
    await page.goto('/staff/notifications');
    await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
    await expect(page.getByText(`Tomada por ${salesName}`).first()).toBeVisible();
    await page.getByRole('link', { name: 'Entregas de correo' }).click();
    await expect(page.getByRole('heading', { name: 'Entregas de correo' })).toBeVisible();

    await signIn(page, salesToken);
    await page.goto('/staff/notifications');
    await expect(page.getByRole('link', { name: 'Entregas de correo' })).toHaveCount(0);
    await page.goto('/staff/notifications/deliveries');
    await expect(page.getByText('Acceso restringido.')).toBeVisible();
  });

  test('dos mensajes del cliente llegan como un solo aviso y se leen al abrir el expediente', async ({ page }) => {
    const customer: Actor = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await sendCustomerMessage(customer, requestId, { body: 'Hola, ¿cómo va la propuesta?', idempotencyKey: `inbox-e2e-1-${suffix}` }, { prisma, rateLimit });
    await sendCustomerMessage(customer, requestId, { body: 'Te comparto las medidas: 8 por 4 metros.', idempotencyKey: `inbox-e2e-2-${suffix}` }, { prisma, rateLimit });
    await signIn(page, salesToken);
    await page.goto('/staff');
    const panel = await openBell(page, /Notificaciones, \d+ sin leer/);
    const notice = panel.getByRole('listitem').filter({ hasText: `Cliente QA ${suffix} te escribió 2 mensajes` });
    await expect(notice).toContainText('Te comparto las medidas: 8 por 4 metros.');
    await notice.getByRole('link', { name: new RegExp(`te escribió 2 mensajes`) }).click();
    await expect(page).toHaveURL(new RegExp(`request=${requestId}`));
    await expect.poll(async () => prisma.inboxNotification.count({ where: { recipientId: salesId, kind: 'customer.activity', readAt: null } })).toBe(0);
  });

  test('el cliente ve la respuesta del equipo en Novedades y en "Desde tu última visita"', async ({ page }) => {
    const sales: Actor = { userId: salesId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'messaging.read', 'messaging.send']), mfaVerified: true };
    await sendStaffMessage(sales, requestId, { body: 'Gracias, preparamos la propuesta con esas medidas.', idempotencyKey: `inbox-e2e-staff-${suffix}` }, { prisma, rateLimit });
    await signIn(page, customerToken);
    await page.goto(`/portal?request=${requestId}`);
    await expect(page.getByRole('region', { name: 'Novedades desde tu última visita' })).toContainText('El equipo OCPOOL te escribió');
    await expect.poll(async () => prisma.inboxNotification.count({ where: { recipientId: customerId, readAt: null } })).toBe(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Novedades', exact: true })).toBeVisible();
  });

  test('el panel no desborda en móvil', async ({ page }) => {
    await signIn(page, salesToken);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/staff');
    await openBell(page, /Notificaciones/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Correr la E2E contra un servidor de desarrollo aislado**

1. Arranca `npm run dev -- --hostname 127.0.0.1 --port 3100` con `NEXT_DIST_DIR=.next-e2e`, en segundo plano.
2. Corre:

Run: `APP_URL=http://127.0.0.1:3100 INBOX_E2E=1 REUSE_E2E_SERVER=1 npx playwright test tests/inbox.spec.ts --reporter=list`
Expected: 5 passed.

La primera corrida después de generar Prisma puede fallar por compilación en frío. Repítela antes de depurar. Al terminar, detén ese servidor.

- [ ] **Step 3: Documentación**

Crear `docs/ocpool-commercial-v2/specs/2026-09-29-bandeja-de-avisos.md`, con el resumen del bloque 1 en el formato de las specs de esa carpeta:
- Qué cambió para cada rol (Ventas, Gerencia, Admin y cliente).
- Las correcciones de correo.
- "Entregas de correo".
- Cómo se verificó: comandos y resultados reales.
- Qué queda para los bloques 2 a 5, con referencia a `docs/superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md`.

En `PROJECT_STATUS.md`, agrega al inicio de la bitácora de sesiones una entrada con el mismo estilo que las demás: título en negritas con la fecha, qué se hizo, hallazgos y verificación. Titúlala **"Bandeja de avisos por rol (bloque 1 de notificaciones en tiempo real) 2026-09-29"**.

En `README.md`:
- Reemplaza la línea `- Operación staff de notificaciones en `/staff/notifications`, con diagnóstico seguro y reintentos RBAC sin exponer PII ni payloads.` por:

```markdown
- Bandeja de avisos por rol en `/staff/notifications` (y "Novedades" en el portal) generada en la misma transacción de cada cambio; el monitor técnico de correos vive en `/staff/notifications/deliveries` para Gerencia y Administración.
```

- Agrega, después de la línea de `POST /api/staff/notifications/:id/retry`:

```markdown
- `GET /api/notifications`, `GET /api/notifications/summary` y `POST /api/notifications/read` — bandeja de avisos de la persona autenticada (equipo o cliente), con el alcance vigente, cursor, contadores y lectura por aviso, por expediente o total.
```

- [ ] **Step 4: Verificación completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Expected: sin errores; todas las unitarias pasan.

Run: `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1`
Expected: todas pasan. Esto incluye las 9 suites nuevas de avisos y correo: `inbox-schema`, `inbox-record`, `inbox-requests`, `inbox-messages`, `inbox-quotes`, `inbox-projects-team-prices`, `inbox-api`, `notifications-routing` y `notifications-delivery-inbox`.

Corre la E2E completa en producción, en segundo plano, y no edites archivos mientras corre:

Run: `APP_URL=http://127.0.0.1:3100 QUOTES_E2E=1 AUDIT_E2E=1 AUTH_E2E=1 AUTH_SURFACES_E2E=1 CATALOG_E2E=1 CUSTOMER_ONBOARDING_E2E=1 DASHBOARD_E2E=1 FOUNDATION_E2E=1 PORTAL_E2E=1 PROJECTS_E2E=1 REQUESTS_E2E=1 STAFF_MESSAGING_E2E=1 INBOX_E2E=1 npx playwright test --reporter=list`
Expected: sólo falla la línea base aceptada (`quality.spec.ts`: "does not emit browser console errors"); todo lo demás pasa, incluidos los 5 tests de `inbox.spec.ts`.

Revisa los restos en la base compartida con un script temporal en `scripts/`, que se borra al terminar:
- `inbox_notifications`, `users` y `quote_requests` con los sufijos de prueba (`inbox-`, `routing-`, `bounce-`).
- El resultado esperado es 0.

- [ ] **Step 5: Commit**

```bash
git add tests/inbox.spec.ts docs/ocpool-commercial-v2/specs/2026-09-29-bandeja-de-avisos.md PROJECT_STATUS.md README.md
git commit -m "test(inbox): recorrido de punta a punta por rol y documentación del bloque 1"
```

---

## Cobertura de la spec en este bloque

| Spec | Tarea |
|---|---|
| §1 Modelo (`InboxNotification`, índices, `CHECK`) | 1 |
| §1 Cambio de `cancelReason` (`SELF_ACTION`) y permiso de Ventas | 9 y 11 |
| §2.1 `recordDomainEvent`, `notifyInbox`, contrato y actor excluido | 4 y 7 |
| §2.2 Tipos del equipo (excepto `quote.declined`, `quote.viewed`, `customer.portal_activated` y `reminder.*`, que van en los bloques 4 y 5) | 4 a 7 y 9 |
| §2.3 Tipos del cliente (excepto `reminder.quote_expiring`; la confirmación de aceptación sólo es correo porque quien acepta es el propio cliente) | 4 a 7 |
| §2.4 Redacción | 2 |
| §2.5 Agrupación, resolución, contadores y alcance | 3 y 8 |
| §3 API | 8 |
| §4.1 Señales `n` y `u` (el hub y las señales `r` y `s` van en los bloques 2 y 3) | 3 y 8 |
| §5.1 Campana y panel (equipo y portal) | 10 |
| §5.2 Páginas | 11 |
| §5.5 Portal: "N nuevas", banner y lectura | 12 |
| §8.1 Correcciones de correo (régimen intermedio de los bloques 1 a 4) | 9 |

Fuera de este bloque, según la spec §14:
- Bloque 2: SSE, flash, sonido y escritorio.
- Bloque 3: pantallas en vivo y "Visto".
- Bloque 4: declinar, "abrió la propuesta" y "entró a su portal".
- Bloque 5: resumen por correo, recordatorios y preferencias.

