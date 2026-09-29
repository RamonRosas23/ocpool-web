# Avisos de operación y tiempo real — diseño

Fecha: 2026-09-29 · Estado: aprobado por el responsable (reporte y plan de la misma fecha).

## Objetivo

Que cada persona se entere al momento de lo que pasa en la operación, dicho en su idioma:

- "Laura Méndez subió 2 archivos y dejó un mensaje en OCQ-2026-000118".
- "Juan Pérez aceptó la propuesta V2".
- "Carlos Ruiz pidió cambios a la propuesta V1".

Esto aplica al equipo (Ventas, Gerencia, Administración) y al cliente.

Además:

- Los mensajes y las pantallas se actualizan solos, sin recargar.
- Un aviso flash aparece en pantalla cuando algo importa.
- El correo deja de duplicar lo que ya se vio en la aplicación.

## Decisiones aprobadas

| Tema | Decisión |
|---|---|
| Rechazo del cliente | Se agrega **"Declinar propuesta" con motivo** en el portal (§6). |
| Correos de mensajes y archivos | **Inteligentes.** Se envían sólo si el aviso sigue sin leer: 10 min para el equipo y 15 min para el cliente. Si hay varios, salen en un solo correo (§8.2). |
| Solicitud nueva sin responsable | **Ventas y Gerencia** reciben un flash con "Tomar". El primero que la toma se la queda. Gerencia además recibe correo (§2.2). |
| Alcance | **Los 5 bloques** (§14), en la rama `feat/notificaciones-tiempo-real`. |
| Monitor técnico de correos | Queda **sólo para Gerencia y Administración** como "Entregas de correo" (§5.2). |
| Sonido | Encendido por defecto para el equipo y apagado para clientes. |
| Notificaciones de escritorio | Sólo si la persona las activa. |
| Retención | Los avisos no se purgan automáticamente, igual que la política vigente. |

## Diagnóstico (punto de partida)

**"Notificaciones" (`/staff/notifications`) es el monitor de la cola de correo, no una bandeja.**
- Lista todas las entregas, también las canceladas. Cada nota interna crea una fila "Cancelada por el sistema" (`cancelNotificationDelivery`).
- En la base local, 2,705 de 2,796 filas son canceladas.
- Ventas también ve esta pantalla.

**No existe tiempo real.** No hay WebSocket, SSE ni consulta periódica en hilos, archivos, estados ni listas.

**Huecos del correo actual** (`notifications/event-resolver.ts`):

| Evento | Qué pasa hoy |
|---|---|
| `FILE.AVAILABLE` | Siempre avisa al contacto del cliente. Cuando el cliente sube un archivo, recibe un correo sobre su propio archivo y el equipo no recibe nada. |
| `REQUEST.RECEIVED` | Sólo manda el acuse al cliente. |
| `MESSAGE.CREATED` de un cliente en un expediente sin responsable | Se cancela con `NO_RECIPIENT`. |
| Cambios pedidos por el cliente | Llegan como un mensaje genérico. |
| `QUOTE.ACCEPTED` | Sólo avisa al responsable. |
| `REQUEST.ASSIGNED` al tomar una solicitud (`mode: 'take'`) | Le manda correo a quien la tomó. |
| Cambios de estado, cierre y reapertura, proyecto, cotización devuelta, precios por asignar, correo rebotado | No generan ningún aviso. |

**En el portal falta:**
- Registro de lectura del cliente.
- Contador de novedades.
- La opción de declinar una propuesta.

**Base que se reutiliza:**
- Outbox transaccional y worker con leases y reintentos.
- `ConversationReadState` con avance monótono.
- Las colas "Cliente respondió" y "Esperando al cliente".
- El alcance por rol (`staffRequestReadScopeWhere`).
- `PrivateToastProvider`.
- El layout persistente de `/staff` y `/portal`.

**Despliegue previsto** (runbook `production-readiness.md`): Next.js con `next start` y PM2 detrás de un proxy, con PostgreSQL 16. No hay serverless.

## Arquitectura

```
Acción (cliente o equipo)
  └─ una transacción: dato + outbox + avisos por rol + pg_notify
        ├─ al confirmar → PostgreSQL NOTIFY 'ocpool_realtime' → Hub (1 conexión LISTEN en el proceso Next)
        │                                                   → SSE por navegador → campana, flash y vistas en vivo
        └─ outbox → worker (ya existe) → correo inmediato, o resumen diferido si el aviso sigue sin leer
worker → recordatorios programados (mismos avisos + pg_notify)
```

**Principios:**
1. **El aviso se genera en la misma transacción que el cambio.** Si la transacción falla, no queda aviso ni evento.
2. **`NOTIFY` sólo se entrega al confirmar.** Nunca hay un aviso fantasma.
3. **El canal de tiempo real lleva identificadores, nunca contenido.**
   - El contenido de un aviso llega sólo a su destinatario.
   - El resto se relee con las API de siempre, con sus permisos.
4. **Nunca se avisa a quien hizo la acción.**
5. **La bandeja respeta el alcance vigente.** Si alguien pierde un expediente, sus avisos se ocultan.

## 1. Modelo de datos

Una migración nueva (`inbox_realtime`) agrega lo siguiente.

**`enum InboxPriority`** — `URGENT`, `HIGH`, `NORMAL`, `INFO`.

**`model InboxNotification`** (tabla `inbox_notifications`):

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `recipientId` | uuid → `User` (cascade) | empleado o cliente |
| `kind` | varchar(80) | catálogo cerrado (§2.2 y §2.3), con `CHECK` de formato |
| `priority` | `InboxPriority` | |
| `groupKey` | varchar(200)? | agrupación (§2.5) |
| `quoteRequestId` | uuid? → `QuoteRequest` (cascade) | enlace, filtro de alcance y contador por expediente |
| `actorId` | uuid? → `User` (set null) | quién lo provocó; `null` = sistema |
| `title` | varchar(200) | texto ya redactado |
| `body` | varchar(400)? | vista previa (mensaje, motivo, archivo) |
| `actionPath` | varchar(300) | ruta interna relativa (empieza con `/`) |
| `data` | jsonb? | sólo los campos permitidos para ese `kind` (conteos, versión, total, motivo) |
| `occurrences` | int, default 1 | |
| `actionRequired` | boolean, default false | |
| `createdAt` | timestamptz | |
| `lastActivityAt` | timestamptz | Se mueve sólo al crear o agrupar; ordena la bandeja. Leer o resolver no reordena. |
| `updatedAt` | timestamptz | Cambia con cualquier modificación; es el cursor de reanudación del SSE (§4.3) |
| `readAt` | timestamptz? | |
| `resolvedAt` | timestamptz? | |
| `resolvedNote` | varchar(160)? | p. ej. "Tomada por Ana" |

**Índices:**
- `(recipientId, lastActivityAt DESC)`.
- `(recipientId, updatedAt)`.
- `(recipientId) WHERE readAt IS NULL AND resolvedAt IS NULL`, parcial.
- `(quoteRequestId)`.
- `(groupKey)`.
- **Único parcial** `inbox_notifications_open_group` sobre `(recipientId, groupKey) WHERE groupKey IS NOT NULL AND readAt IS NULL AND resolvedAt IS NULL`. Se escribe en SQL crudo, siguiendo el precedente de `quote_approvals_active_version_type_key`.

**`model InboxReminder`** (tabla `inbox_reminders`) — bitácora de recordatorios. Tiene `key varchar(200) PK` y `createdAt`. Evita repetir un recordatorio (§9).

**`model QuoteVersionView`** (tabla `quote_version_views`):
- Campos: `quoteVersionId` → `QuoteVersion` (cascade), `userId` → `User` (cascade), `firstViewedAt`, `lastViewedAt`.
- PK compuesta. Alimenta "abrió la propuesta" (§7).

**`model InboxPreference`** (tabla `inbox_preferences`):
- Campos: `userId` PK → `User` (cascade), `soundEnabled boolean?`, `desktopEnabled boolean default false`, `activityEmail` (`DIGEST` | `OFF`, default `DIGEST`) y `updatedAt`.
- Si `soundEnabled` es `null`, aplica el valor por defecto según el tipo de usuario.

**Datos existentes que cambian:**
- El `CHECK` de `notification_deliveries.cancelReason` suma `ALREADY_READ` e `INBOX_DIGEST`, con el mismo patrón que `CONTACT_EMAIL_CHANGED`.
- Una migración de datos quita `notifications.read` del rol `sales`. `ROLE_DEFINITIONS` se actualiza igual; el seed sólo agrega permisos, nunca los quita.

No se crean avisos retroactivos: la bandeja empieza vacía al desplegar.

## 2. Eventos de dominio y motor de reglas

Módulo nuevo `src/server/modules/inbox/`. El existente `notifications/` sigue siendo el de correo.

### 2.1 Punto único de emisión

Se crea `recordDomainEvent(tx, { actor, eventType, aggregateType, aggregateId, payload })`. Hace tres cosas:

1. Escribe el `OutboxEvent` exactamente como hoy. El contrato del correo no cambia.
2. Ejecuta `resolveInboxIntents(tx, event, actor)` y guarda los avisos con `recordInboxIntents(tx, intents)`. Esto incluye la agrupación, la resolución y un `pg_notify` por destinatario.
3. Publica la señal de expediente (§4.1).

Qué emisores lo usan:
- Reemplaza los `transaction.outboxEvent.create` de los emisores operativos: solicitudes, mensajería, archivos, cotizaciones, aprobaciones, aceptación y proyectos.
- Catálogo y listas de precios siguen como están, salvo los eventos de precio que resuelven "por cotizar".
- Las señales nuevas que sólo viven en la aplicación usan `notifyInbox(tx, …)`, sin outbox:
  - propuesta vista;
  - portal activado;
  - cambio de dueño del proyecto;
  - trabajo reasignado al suspender;
  - precio asignado.

Una prueba de contrato impide que vuelvan los `outboxEvent.create` directos fuera de la lista permitida.

**Nunca se avisa al actor.** Se excluye de los destinatarios siempre, incluido quien toma o se autoasigna una solicitud.

### 2.2 Tipos para el equipo

**Grupos de destinatarios** (se calculan por permiso; sólo empleados `ACTIVE`):
- **Pool:** quienes tienen `requests.claim` o `requests.read.global`.
- **Gestores:** quienes tienen `requests.read.global` (Gerencia y Admin).
- **Aprobadores:** quienes tienen `quotes.approve_discount`.
- **Precios:** quienes tienen `prices.manage`.

| `kind` | Disparador | Destinatarios | Prioridad | Requiere acción | Se resuelve | Correo |
|---|---|---|---|---|---|---|
| `request.new_unassigned` | `REQUEST.RECEIVED` con origen `PUBLIC_FORM` | Pool | HIGH | sí ("Tomar") | al tomarla o asignarla: "Tomada por X" o "Asignada a X" | Gestores: `request.new_for_team` inmediato |
| `customer.activity` | Mensaje o archivo del cliente | Responsable; sin responsable, el pool | HIGH | no | — | Resumen si sigue sin leer a los 10 min (§8.2) |
| `quote.changes_requested` | Mensaje con prefijo de cambios (`lib/change-request.ts`) | Responsable (o pool) y, en bandeja, Gestores | URGENT (Gestores: NORMAL) | sí | al publicar la siguiente versión | `quote.changes_requested` inmediato al responsable |
| `quote.accepted` | `QUOTE.ACCEPTED` | Responsable y Gestores | URGENT | no | — | Existente, más Gestores |
| `quote.declined` | `QUOTE.DECLINED` (§6) | Responsable y, en bandeja, Gestores | URGENT (Gestores: NORMAL) | no | — | `quote.declined` inmediato al responsable |
| `request.assigned_to_you` | Asignación o reasignación hecha por otra persona | Nuevo responsable | HIGH | no | — | Existente (sin autoenvío) |
| `request.unassigned_from_you` | Reasignación | Responsable anterior | NORMAL | no | — | — |
| `approval.requested` | `QUOTE.APPROVAL_REQUESTED` | Aprobadores, excepto quien la pidió | HIGH | sí ("Decidir") | al decidir, reemplazar o cancelar: "Aprobada por X", "Rechazada por X" o "Ya no aplica: la cotización cambió" | Existente |
| `approval.resolved` | `QUOTE.APPROVAL_RESOLVED` | Quien la pidió | HIGH | no | — | Existente |
| `quote.returned` | `QUOTE.VERSION_REOPENED` o `QUOTE.VERSION_REJECTED` | Autor de la versión y responsable | HIGH | no | — | — |
| `price.pending` | Borrador guardado con líneas "por cotizar" nuevas | Precios | NORMAL | sí | al asignar el precio: "Precio asignado por X" | — |
| `price.assigned` | Precio asignado a un concepto pendiente | Autores de los borradores que lo esperaban | NORMAL | no | — | — |
| `note.internal` | Nota interna | Responsable y quienes escribieron notas en los últimos 14 días (ver reglas especiales) | NORMAL | no | — | — |
| `project.assigned` | Proyecto creado con dueño, o cambio de dueño | Dueño nuevo | HIGH | no | — | `project.assigned` |
| `project.created` | Conversión manual de una aceptación en proyecto | Gestores | NORMAL | no | — | — |
| `team.work_reassigned` | Suspensión con reasignación | Quien recibe el trabajo | HIGH | no | — | — |
| `email.delivery_failed` | Una entrega a cliente queda `FAILED` definitiva (§8.1) | Responsable (URGENT) y Gestores (NORMAL) | ver columna anterior | no | al reintentar con éxito | — |
| `request.closed` / `request.reopened` | Cierre o reapertura hecho por otra persona | Responsable | NORMAL | no | — | — |
| `quote.viewed` | Primera vista del cliente a una versión (§7) | Responsable | INFO | no | — | — |
| `customer.portal_activated` | Primer acceso `INVITED → ACTIVE` (§7) | Responsable | INFO | no | — | — |
| `reminder.*` | Recordatorios (§9) | Según el recordatorio | según §9 | según §9 | — | — |

**Reglas especiales:**
- **Proyecto nacido de la aceptación del cliente.** No se emite `project.created`, porque `quote.accepted` ya avisó a los Gestores. Tampoco se emite `project.assigned` si el dueño es el mismo responsable.
- **Destinatarios de `note.internal`** (decisión de diseño):
  - El responsable.
  - Quien haya escrito otra nota interna en ese expediente en los últimos 14 días. Así, quien deja una nota para un compañero se entera de la respuesta.
  - Nunca quien la escribió.
  - Si el expediente no tiene responsable, sólo quienes participaron en notas recientes. Nunca todo el pool.
- **`note.internal` no aplica a los mensajes al cliente.** Esos avisan al cliente (§2.3), no al equipo.
- **`price.pending` es idempotente.**
  - `data` guarda el conjunto de expedientes que esperan ese concepto, y la agrupación hace la unión.
  - `occurrences` es el número de expedientes distintos.
  - Guardar otra vez el mismo borrador (autoguardado) no cambia el aviso ni emite señal.
- **`price.assigned`** sólo se emite cuando el precio entra en vigor en ese momento. Un precio programado a futuro no resuelve nada hasta su fecha, y queda fuera del alcance de los recordatorios.

### 2.3 Tipos para el cliente

**Destinatario:** el usuario `CUSTOMER` `ACTIVE` vinculado al contacto del expediente. Un contacto sin cuenta sólo recibe correo, como hoy.

| `kind` | Disparador | Prioridad | Se resuelve | Correo |
|---|---|---|---|---|
| `team.activity` | Mensaje, o archivo visible para el cliente, del equipo | HIGH | — | Resumen si sigue sin leer a los 15 min |
| `request.information_needed` | Solicitud de información (el mensaje en la misma transacción) | HIGH, destacado | cuando el cliente responde o el equipo marca revisado | `request.information_needed` inmediato |
| `quote.ready` | `QUOTE.PUBLISHED` | HIGH | — | Existente (`quote.version_sent`) |
| (sólo correo) confirmación de aceptación | `QUOTE.ACCEPTED` | — | — | Existente. En la bandeja no hay aviso porque quien acepta es el propio cliente, y a quien hizo la acción nunca se le avisa. |
| `project.started` | Proyecto creado | NORMAL | — | `project.started` |
| `request.received` | `REQUEST.RECEIVED`, si el contacto ya tiene cuenta | NORMAL | — | Acuse existente |
| `reminder.quote_expiring` | §9 | NORMAL | — | `quote.expiring` |

**Lo que el cliente nunca recibe** (lo cubren pruebas):
- notas internas;
- aprobaciones;
- precios pendientes;
- archivos internos;
- asignaciones;
- borradores;
- recordatorios internos;
- cualquier `kind` que no esté en esta tabla.

Si el mensaje de solicitud de información o el de "declinó" viajan como `MESSAGE.CREATED`, no generan además `team.activity` ni `customer.activity`. Así no hay avisos duplicados.

### 2.4 Redacción

`renderInboxText(kind, data, audience)` es una función pura, con pruebas. Devuelve `{ title, body }` en es-MX, con redacción neutra y sin marcar género. Ejemplos:

- **`customer.activity`** (el texto sale de los conteos):
  - "Laura Méndez te escribió"
  - "Laura Méndez te escribió 3 mensajes"
  - "Laura Méndez subió 2 archivos y dejó un mensaje"
  - El `body` es la vista previa del último mensaje, a 160 caracteres, o el nombre del último archivo.
- **`team.activity`:** "El equipo OCPOOL te escribió" o "El equipo OCPOOL te escribió 2 mensajes y compartió 1 archivo".
- **`request.new_unassigned`:** "Nueva solicitud: Alberca con jacuzzi en Monterrey", con `body` "Sofía Garza · OCQ-2026-000130".
- **`quote.declined`:** "Juan Pérez declinó la propuesta V2", con `body` "Motivo: el precio. «Nos pareció alto el calentador»".

**Enlaces:**
- Equipo: `requestWorkspaceNotificationPath(id, tab)`, con pestaña `conversation`, `quote` o `files` según el tipo.
- Cliente: `/portal?request=<id>`.
- Aprobaciones: `/staff/approvals`.
- Precios: `/staff/catalog?tab=pending-prices`.

### 2.5 Agrupación, resolución y alcance

**Agrupación:**
- `groupKey` por tipo:
  - `activity:{requestId}:{actorId}`;
  - `team-activity:{requestId}`;
  - `pool:{requestId}`;
  - `approval:{approvalId}`;
  - `price:{priceListId}:{catalogItemId}`;
  - `note:{requestId}:{actorId}`;
  - `changes:{requestId}`.
- El guardado corre en la misma transacción:
  1. `INSERT … ON CONFLICT (recipientId, groupKey) WHERE <predicado del índice> DO NOTHING RETURNING id`.
  2. Si hubo conflicto, `SELECT … FOR UPDATE` de la fila abierta.
  3. `mergeInboxData` suma los conteos y guarda la vista previa más reciente.
  4. Se vuelven a redactar `title` y `body`.
  5. Sube `occurrences` y se mueven `lastActivityAt` y `updatedAt`.
  6. Si nada cambió (caso de `price.pending`), no se escribe ni se emite señal.
- No hay carrera: el índice único parcial serializa a dos transacciones concurrentes.
- Mientras el aviso siga abierto (sin leer ni resolver), la actividad nueva se suma a él. Una vez leído, la siguiente actividad crea un aviso nuevo.

**Resolución:** `resolveInboxGroup(tx, groupKey, note)`:
- Marca `resolvedAt` y `resolvedNote` en todas las filas no resueltas de esa clave.
- Hace `pg_notify` a cada destinatario.
- Un aviso resuelto deja de contar como pendiente y de "requerir acción".

**Contadores:**
- `unread`: sin leer, sin resolver y con prioridad distinta de `INFO`. Es el contador de la campana.
- `actionRequired`: sin resolver y con `actionRequired`, aunque ya se haya leído.

**Alcance:**
- La lista y los contadores del equipo filtran con `staffRequestReadScopeWhere(actor)` a través de `quoteRequestId`. Los avisos sin expediente siempre son visibles.
- Los del cliente se filtran por `recipientId`. El expediente pertenece a su `clientId` por construcción.

## 3. API de la bandeja

Hay una sola familia de rutas, válida para empleados y clientes. El tipo de actor decide el alcance. Todas responden con `cache-control: no-store`.

| Método y ruta | Uso |
|---|---|
| `GET /api/notifications?filter=all\|unread\|action&cursor=&limit=` | Lista paginada por cursor `(lastActivityAt, id)`, con límite de 50 |
| `GET /api/notifications/summary` | `{ unread, actionRequired, latest: [20] }`; la usan la campana y el modo de respaldo |
| `POST /api/notifications/read` | Cuerpo `{ ids?: uuid[] } \| { all: true } \| { quoteRequestId: uuid, scope: 'activity' \| 'all' }`; `same-origin`; publica `u` (§4.1) para sincronizar otros dispositivos |

**Reglas de lectura automática:**
- Al hacer clic en un aviso, se marca como leído.
- Si el equipo abre un expediente, se leen sus avisos que no requieren acción.
- Si el cliente abre un expediente en el portal, se leen todos los avisos de ese expediente.
- Si el hilo de conversación está a la vista, los avisos de actividad de ese expediente se leen al llegar (§5.3, supresión por contexto).

Las acciones rápidas reutilizan los endpoints existentes, por ejemplo `POST /api/staff/quote-requests/:id/take` para "Tomar".

## 4. Tiempo real

### 4.1 Canal en PostgreSQL

**Canal:** `ocpool_realtime`.
- `publishRealtime(tx, signal)` ejecuta `SELECT pg_notify('ocpool_realtime', $json)` dentro de la transacción; la entrega ocurre al confirmar.
- El payload es JSON corto, sólo con identificadores, y muy por debajo de los 8 KB.

| `t` | Campos | Significado |
|---|---|---|
| `n` | `u` (destinatario), `id`, `m` (`created` \| `updated` \| `resolved`) | Aviso nuevo, agrupado o resuelto |
| `r` | `r` (expediente), `c` (clientId), `a` (responsable), `pa` (responsable anterior)?, `p` (partes), `v` (`C` visible al cliente \| `I` interno) | Cambió algo del expediente |
| `u` | `u` | Contadores del usuario cambiaron (lectura en otro dispositivo) |
| `s` | `u`, `sid`? | Cerrar conexiones. Sin `sid`, todas las del usuario (suspensión). Con `sid`, sólo las de esa sesión (cierre de sesión, o revocación de una sesión desde "Mi cuenta" o Equipo). |

**Partes de `r`:** `created`, `messages`, `files`, `status`, `assignment`, `quote`, `approvals`, `read`, `project`. Las notas internas, los archivos internos, las aprobaciones, los borradores, las asignaciones y la lectura del cliente viajan como `v: 'I'`.

`recordDomainEvent` deriva `p` y `v` del tipo de evento. Una tabla en `inbox/realtime-signals.ts` tiene pruebas de exhaustividad.

### 4.2 Hub (`src/server/realtime/hub.ts`)

**Instancia y conexión a la base:**
- Es un singleton en `globalThis`; así sobrevive a HMR en desarrollo.
- Arranca de forma diferida con la primera conexión SSE.
- Usa un `pg.Client` dedicado, fuera del pool de Prisma, con `LISTEN ocpool_realtime`.

**Registro de conexiones:**
- Es un `Map<userId, Set<Connection>>`.
- Cada conexión guarda `{ userId, sessionId, type, clientId, global }`, donde `global` es `requests.read.global`.
- Tope por usuario: `REALTIME_MAX_CONNECTIONS_PER_USER` (10). Si se rebasa, cierra la más vieja.

**Reparto:**

| Señal | Qué hace el hub |
|---|---|
| `n` | Lee la fila una vez y la envía, con el conteo `unread` recalculado, a las conexiones de `u` |
| `r` | La reenvía a cada conexión en alcance (detalle abajo) |
| `u` | Envía los contadores al usuario |
| `s` | Envía `bye` y cierra: todas las conexiones del usuario, o sólo las de `sid` |

Alcance de `r`:
- Empleados globales: siempre.
- Empleados no globales: si `a` es null, o si `a` o `pa` es el propio usuario.
- Clientes: sólo si `c` es su `clientId` y `v` es `C`.

**Resiliencia:**
- Si la conexión LISTEN cae, se reconecta con espera exponencial.
- Al reconectar, envía `resync` a todas las conexiones, porque pudieron perderse señales.

**Sesión:**
- Cada conexión revalida su sesión cada `REALTIME_SESSION_RECHECK_SECONDS` (60) con `getSessionContext`.
- Si falla, recibe `bye` y se cierra.
- La suspensión y la revocación de sesiones además publican `s`, así que el cierre es inmediato.

**Logs:** sólo conteos y cambios de estado del hub, sin datos personales.

### 4.3 Endpoint SSE

**Ruta:** `GET /api/realtime`.
- Declara `runtime = 'nodejs'` y `dynamic = 'force-dynamic'`.
- Acepta cualquier sesión activa, sea de empleado o de cliente.
- Si no hay sesión, responde 401.
- Si `REALTIME_ENABLED=false`, responde 503 con `{ mode: 'polling' }`.

**Encabezados:**
- `content-type: text/event-stream; charset=utf-8`.
- `cache-control: no-cache, no-transform`. Evita que la compresión de `next start` retenga los eventos.
- `connection: keep-alive`.
- `x-accel-buffering: no`, para nginx.

**Eventos:**

| Evento | Datos |
|---|---|
| `hello` | `{ unread, actionRequired, serverTime }` |
| `notification` | `{ mode, notification: DTO, unread, actionRequired }`; `id:` = cursor `updatedAtMs-id` |
| `request` | `{ requestId, parts, at }` |
| `counts` | `{ unread, actionRequired }` |
| `resync` | `{}`: el cliente relee contadores y vistas abiertas |
| `bye` | `{ reason }`: el cliente deja de reconectar y, si la sesión expiró, lleva al acceso |

**Operación de la conexión:**
- Envía un comentario `: ping` cada `REALTIME_HEARTBEAT_SECONDS` (25) y `retry: 5000`.
- **Reanudación:** si llega `Last-Event-ID`, se reenvían los avisos del usuario con `updatedAt` posterior al cursor, hasta 50. Si hay más, se envía `resync`.
- **Presión:** si el flujo no drena (`desiredSize < 0` sostenido), se cierra la conexión.
- **Limpieza:** `request.signal` (abort) y `cancel()` del `ReadableStream` retiran la conexión del hub.

### 4.4 Cliente

Todo el lado del navegador vive en `RealtimeProvider`, un componente cliente montado en los layouts de `/staff` y `/portal`. Persiste entre navegaciones.

**Una conexión por navegador:**
- Con `navigator.locks.request('ocpool-realtime')`, la pestaña líder abre el `EventSource`.
- `BroadcastChannel('ocpool-realtime')` reparte los eventos a las demás pestañas.
- Al cerrar la líder, otra toma el candado.
- Sin Web Locks o sin BroadcastChannel, cada pestaña abre su propia conexión.

**Estado compartido:**
- Contadores, los últimos 20 avisos y las suscripciones `useRealtimeRequest(requestId, parts, callback)`.
- Las lecturas en una pestaña se propagan a las demás por BroadcastChannel y a otros dispositivos por la señal `u`.

**Respaldo:**
- Pasa a consultar `summary` cada 30 s si ocurre cualquiera de estas condiciones:
  - tres errores seguidos;
  - no llega un `ping` en 60 s;
  - el servidor responde 503.
- Cada 5 minutos reintenta SSE.
- En este modo, las vistas en vivo se refrescan al volver el foco a la pestaña.

**Visibilidad:**
- El flash se muestra sólo en la pestaña visible.
- Si ninguna pestaña está visible, la líder muestra la notificación de escritorio, si está habilitada.

**Título de la pestaña:** lleva el prefijo `(N) ` cuando `unread > 0`.

## 5. Interfaz

### 5.1 Campana y panel

**Dónde aparece la campana:**
- En staff: en `StaffHeader` (vista clásica) y en `PrivateShellChrome` (V2), visible también en móvil junto a "Menú".
- En el portal: "Novedades" en el encabezado de `ClientPortalPanel` y en `PrivateShellChrome` del portal.

**Insignia:**
- Muestra `unread`, con tope "99+".
- `aria-label`: "Notificaciones, N sin leer".
- Al llegar un aviso hace un pulso breve, salvo con `prefers-reduced-motion`.

**Formato del panel:**
- Es un popover en escritorio y una hoja de pantalla completa por debajo de 768 px.

**Filtros:**
- "Todas", "Sin leer" y "Requieren acción · N".
- Las fechas se agrupan en Hoy, Ayer, Esta semana y Antes.

**Cada elemento muestra:**
- icono del tipo, título, vista previa y folio · cliente · tiempo relativo;
- un punto si no se ha leído;
- la nota de resolución ("Tomada por Ana"), cuando aplica;
- acciones rápidas según el tipo y los permisos: "Tomar" (con `requests.claim`), "Responder", "Decidir" o "Abrir".

**Pie del panel:**
- "Marcar todo como leído" y "Ver todas".
- Conmutador de sonido.
- "Activar alertas de escritorio", visible sólo si el permiso del navegador está en `default`.

Para el portal hay una versión simplificada, sin filtros.

**Cambios en la navegación de staff:**
- Se retira "Notificaciones" de la barra: la campana lo reemplaza y así baja la densidad de la barra.
- Quick Find (Ctrl + K) incluye "Notificaciones" y, para Gerencia y Admin, "Entregas de correo".

### 5.2 Páginas

**`/staff/notifications` (bandeja completa, para todo el equipo):**
- Filtros "Sin leer", "Requieren acción", tipo y búsqueda por folio.
- Paginación por cursor.
- Marcar como leído o no leído, y "Marcar todo".
- A Gerencia y Admin le muestra el enlace "Entregas de correo".

**`/staff/notifications/deliveries` ("Entregas de correo"):**
- Es la pantalla actual, movida; su API conserva la ruta `/api/staff/notifications`.
- La navegación la muestra sólo con `notifications.manage`.
- El filtro por defecto es "Fallidas".
- Las canceladas por el sistema sólo aparecen con el filtro "Canceladas".
- El dashboard deja de pedir entregas fallidas para quien no tiene `notifications.read`.

### 5.3 Aviso flash

Es el componente `FlashAlertStack`, distinto de `PrivateToast`; los toasts siguen confirmando acciones.

**Posición y capa:**
- En escritorio aparece arriba a la derecha, bajo el encabezado.
- En móvil aparece arriba, a lo ancho, con márgenes de 16 px.
- Muestra máximo 3 en escritorio y 2 en móvil. Si hay más, aparece "y N más", que abre el panel.
- Su `z-index` queda por encima del de los toasts.

**Comportamiento por prioridad:**

| Prioridad | Flash | Sonido | Escritorio (pestaña oculta) | `aria-live` |
|---|---|---|---|---|
| URGENT | fijo hasta cerrarlo | sí | sí | `assertive` |
| HIGH | 8 s; se pausa con hover o foco; barra de progreso | sí | sí | `polite` |
| NORMAL | no (campana y contador) | no | no | — |
| INFO | no (sólo bandeja) | no | no | — |

**Actualización de un aviso agrupado:**
- Reemplaza la tarjeta del mismo `id`; nunca la duplica.
- Vuelve a destellar y reinicia el tiempo.
- No sube el contador.

**Supresión por contexto:** las vistas registran `setActiveContext({ quoteRequestId, section })`.
- Si llega `customer.activity` o `team.activity` del expediente activo, no hay flash: el hilo muestra el mensaje con la marca "Nuevo" y el aviso se lee solo.
- Los URGENT del mismo expediente sí se muestran.

**Sonido:**
- Un tono sintetizado con Web Audio, sin archivos.
- Como máximo uno cada 3 s.
- Respeta la preferencia (§10).

**Escritorio:**
- Usa la Notification API.
- El `tag` es el id del aviso, así que un aviso agrupado reemplaza al anterior.
- El clic enfoca la pestaña y navega al enlace.

**Accesibilidad:**
- Esc cierra el flash con foco.
- Los botones tienen nombre accesible.
- No se roba el foco.
- Con movimiento reducido no hay deslizamiento.
- Contraste AA.

### 5.4 Pantallas en vivo

| Vista | Partes | Comportamiento |
|---|---|---|
| Hilo de mensajes de staff (`StaffMessagingPanel`) y del portal (`ClientMessagingThread`) | `messages`, `read` | Pide lo posterior al último mensaje conocido (el cursor ya es ascendente) y lo agrega con el separador "Nuevo". Si el usuario no está al final, aparece la píldora "N mensajes nuevos ↓". |
| Archivos (`StaffFilesPanel` y `ClientFilesPanel`) | `files` | Relee la lista |
| Detalle del expediente (clásico y V2) | `status`, `assignment`, `quote`, `project` | Relectura silenciosa y aviso discreto "Actualizado hace un momento" |
| Constructor de cotizaciones (`StaffQuotesPanel`) | `quote`, `approvals` | Sin cambios pendientes: relectura silenciosa. Con cambios sin guardar: nunca recarga; muestra "Hay cambios nuevos en esta cotización; guarda para verlos". |
| Bandeja de solicitudes | `created`, `status`, `assignment` | Arriba y sin interacción: refresca. Si no: píldora "Hay N novedades · Actualizar". |
| Colas del dashboard y aprobaciones | según la cola | Refresco con espera de 2 s |
| Portal: riel y expediente | `status`, `quote`, `files`, `messages` | Relectura silenciosa |

**"Visto por el cliente":**
- `listConversationMessages` también marca como leído para clientes, con la misma función monótona `markConversationRead`, y publica `r` con la parte `read` y `v: 'I'`.
- La API de mensajes de staff agrega `customerReadAt`, que es la lectura del usuario del contacto.
- Bajo el último mensaje del equipo se muestra "Visto · hace 3 min".

### 5.5 Portal

- El riel muestra "N nuevas" por expediente, contando los avisos sin leer de ese expediente. Los expedientes con novedades aparecen en negrita.
- Al entrar a un expediente con avisos sin leer aparece el banner "Desde tu última visita: nueva propuesta V2 y 2 mensajes del equipo", con enlaces a cada sección. Después, esos avisos se marcan como leídos.
- `request.information_needed` se muestra destacado arriba del expediente hasta que se resuelve.

## 6. Declinar propuesta (portal)

**Endpoint:** `POST /api/portal/quotes/:id/decline`.
- Cuerpo: `{ versionId, reason, comment?, idempotencyKey }`.
- Protegido con `same-origin` y `requireCustomerActor`.

**Motivos:**

| Código | Etiqueta |
|---|---|
| `PRICE` | El precio |
| `SCOPE` | Lo que incluye |
| `TIMING` | Los tiempos |
| `CHOSE_OTHER` | Elegí otra opción |
| `POSTPONED` | Lo voy a posponer |
| `OTHER` | Otro motivo (con comentario obligatorio) |

El comentario acepta hasta 1000 caracteres.

**Transacción:**
1. Bloquea la cotización con el mismo patrón que la aceptación.
2. Valida la versión vigente publicada en `ENVIADA` o `EN_NEGOCIACION`, con el PDF listo y la vigencia sin vencer, y el expediente en `COTIZACION_DISPONIBLE` o `EN_NEGOCIACION`.
   - `PENDIENTE_DE_APROBACION` queda fuera: sólo existe dentro de la transacción de aceptación.
3. Pasa la versión a `RECHAZADA`, con `QuoteStatusHistory.reason` = "Declinada por el cliente · {motivo}: {comentario}".
4. Pasa el expediente a `EN_NEGOCIACION`, o lo deja ahí si ya estaba. Desde ahí Ventas puede preparar otra versión (`QUOTE_BUILDABLE_REQUEST_STATUSES`) o cerrar el expediente con el flujo de cierre existente.
5. Registra un mensaje del cliente visible para ambos, con el prefijo fijo `lib/decline-request.ts`: "Propuesta V{n} declinada: {motivo}. {comentario}". Es el mismo patrón que la petición de cambios.
6. Escribe auditoría `quote.declined_by_customer` con el código del motivo.
7. Emite `recordDomainEvent('QUOTE.DECLINED')`.

**Idempotencia:** la misma llave con el mismo contenido devuelve el resultado; con otro contenido, 409.

**Interfaz del portal:**
- En `ClientQuoteActions`, junto a "Pedir cambios", aparece el enlace secundario "No me interesa esta propuesta".
- Abre un diálogo con los motivos, el comentario y la nota "Tu asesor recibirá tu respuesta y podrá prepararte otra versión".
- El botón de confirmación dice "Declinar propuesta".
- Después, la tarjeta de la propuesta dice "Declinaste esta propuesta el {fecha}" y ofrece "Pedir una nueva versión", que lleva a la conversación.
- `portalNextStep` gana ese estado, con dueño `team`.

**Staff:**
- El detalle y el constructor muestran "El cliente declinó la V{n} · {motivo}" de la misma forma que hoy muestran la petición de cambios (`findLatestChangeRequest`).

## 7. Señales nuevas del cliente

**"Abrió la propuesta":**
- Cuando el cliente abre el expediente y la versión vigente es visible para él, se hace un upsert en `QuoteVersionView`.
- Sólo la primera inserción emite `quote.viewed` (INFO) al responsable.

**"Entró a su portal":**
- Al activarse la cuenta `INVITED → ACTIVE` por enlace mágico, se emite `customer.portal_activated` (INFO) a los responsables de sus expedientes abiertos.

## 8. Correo

### 8.1 Correcciones

Primero se describe el comportamiento final (desde el bloque 5), y al final lo que rige mientras tanto.

- **`FILE.AVAILABLE`** avisa sólo a la otra parte:
  - Archivo del cliente: pasa al resumen del equipo.
  - Archivo visible del equipo: resumen del cliente, o correo inmediato si el contacto no tiene cuenta, como hoy.
  - Nunca avisa a quien subió el archivo.
- **`REQUEST.RECEIVED` desde `PUBLIC_FORM`** manda además `request.new_for_team` a los Gestores.
- **`MESSAGE.CREATED`:**
  - Si el destinatario tiene bandeja, se cancela con `INBOX_DIGEST`; el resumen lo cubre.
  - Sólo se mantiene el correo inmediato para contactos sin cuenta.
  - Los mensajes con prefijo de cambios o de declinación usan su propia plantilla.
- **Mientras llega el bloque 5 (bloques 1 a 4):**
  - Los mensajes siguen mandando un correo por mensaje al responsable, como hoy.
  - Si el expediente no tiene responsable, el correo va a los Gestores en lugar de cancelarse.
  - El archivo del cliente deja de mandarle correo a él mismo. El equipo lo ve en la bandeja y recibe el correo con el resumen del bloque 5.
  - Así no hay plantillas temporales.
- **`REQUEST.ASSIGNED`** no manda correo cuando la persona asignada es la misma que hizo la acción.
- **`QUOTE.ACCEPTED`** agrega a los Gestores.
- **Entrega fallida:**
  - Cuando una entrega pasa a `FAILED` definitiva (sin reintento, o se acabaron los intentos) con una plantilla dirigida al cliente, el worker emite `email.delivery_failed` para el expediente con `notifyInbox`.
  - El aviso se resuelve si un reintento manual llega a `SENT`.

### 8.2 Correo inteligente (resumen)

**Cuándo se programa:**
- Aplica cuando se crea (no cuando se agrupa) un aviso `customer.activity` o `team.activity` cuyo destinatario tiene `activityEmail = DIGEST`.
- Del lado del equipo, sólo se programa para el responsable. Si el expediente no tiene responsable, sólo para los Gestores. El resto del pool lo ve en la bandeja sin correo.
- Se escribe un `OutboxEvent` `INBOX.DIGEST_DUE` con `availableAt` = ahora + retraso y payload `{ notificationId }`.
- El retraso es `INBOX_DIGEST_DELAY_STAFF_MINUTES` (10) para el equipo y `INBOX_DIGEST_DELAY_CUSTOMER_MINUTES` (15) para el cliente.

**Qué hace el worker cuando vence** (la cola del outbox ya respeta `availableAt`):
- Si el aviso ya se leyó o se resolvió, cancela con `ALREADY_READ`.
- Si no, crea una sola entrega con la plantilla `activity.digest` (variante `staff` o `customer`), redactada con los conteos del aviso y su última vista previa.

**Límite:** se manda un resumen por aviso. Si el aviso sigue sin leer, la siguiente actividad no manda otro correo. Para eso están los recordatorios (§9).

### 8.3 Plantillas nuevas (v1)

- `request.new_for_team`
- `activity.digest` (dos audiencias)
- `quote.changes_requested`
- `quote.declined`
- `request.information_needed`
- `project.started`
- `project.assigned`
- `quote.expiring`

Todas usan `email-layout.ts` y el mismo escapado, y tienen pruebas de contenido e inyección como las existentes.

## 9. Recordatorios (worker)

**Funcionamiento:**
- `runInboxReminderSweep` corre dentro del bucle del worker cada 5 minutos, protegido con `pg_try_advisory_lock`.
- Sólo crea recordatorios de lunes a sábado, de 08:00 a 19:00 `APP_TIMEZONE`.
- Cada recordatorio pasa primero por `INSERT INTO inbox_reminders(key) … ON CONFLICT DO NOTHING`, así que nunca se repite.
- Se desactiva con `INBOX_REMINDERS_ENABLED`.

| Recordatorio | Condición | Destinatarios | Prioridad | Clave |
|---|---|---|---|---|
| `reminder.customer_waiting` | El último mensaje compartido es del cliente y lleva más de 4 h sin respuesta | Responsable (o pool) | HIGH | `waiting:{req}:{msgId}:4h` |
| `reminder.customer_waiting_escalated` | Lo mismo, más de 24 h | Gestores | HIGH | `waiting:{req}:{msgId}:24h` |
| `reminder.unassigned` | Solicitud de `PUBLIC_FORM` más de 2 h sin responsable | Gestores | HIGH | `unassigned:{req}:2h` |
| `reminder.approval_pending` | Aprobación `REQUESTED` por más de 4 h | Aprobadores | NORMAL | `approval:{id}:4h` |
| `reminder.quote_expiring` | Versión `ENVIADA` o `EN_NEGOCIACION` que vence en 72 h o en 24 h | Cliente (y correo `quote.expiring`) y responsable | NORMAL | `expiring:{ver}:72h` / `…:24h` |
| `reminder.quote_expired` | Venció la vigencia | Responsable | NORMAL | `expired:{ver}` |
| `reminder.follow_up` | Esperando al cliente `WAITING_ON_CUSTOMER_DAYS` días | Responsable | INFO | `followup:{req}:{lastActivityDate}` |

## 10. Preferencias

Están en "Mi cuenta" → "Avisos" para el equipo, y en el menú de "Novedades" para el cliente. Cada persona puede elegir:

- **Sonido:** encendido o apagado.
- **Alertas de escritorio:** encendidas o apagadas. Al encenderlas se pide el permiso del navegador en ese gesto.
- **Correo de mensajes y archivos:** "Resumen si no lo leo" o "No enviar".

Hay correos que no se pueden apagar:
- acceso;
- propuesta lista;
- información requerida;
- aceptación;
- declinación;
- asignación.

Mientras exista sólo el bloque 2, las preferencias de sonido y escritorio viven en `localStorage`. En el bloque 5 pasan al servidor.

## 11. Seguridad y privacidad

**Bandeja:**
- Cada aviso sólo lo lee su destinatario.
- Las listas se filtran por `recipientId` y, para el equipo, además por el alcance vigente.
- Los textos guardados tienen la misma sensibilidad que la conversación y React los escapa al mostrarlos.
- La notificación de escritorio usa texto plano.

**Clientes:**
- Existe una lista explícita de tipos para cliente.
- Hay pruebas que recorren todos los eventos internos y comprueban que ninguno genera un aviso para el cliente.
- El hub nunca reenvía `v: 'I'` a clientes.

**Canal:**
- `pg_notify` lleva sólo identificadores.
- El contenido que no es un aviso propio se relee por las API con sus permisos.

**Conexiones:**
- Hay un tope por usuario y la sesión se revalida.
- Una suspensión o revocación cierra el canal de inmediato.

**Resto:**
- Las rutas `POST` usan `same-origin`, igual que el resto de la API.
- Los logs del hub no incluyen identificadores de personas, sólo conteos.

## 12. Configuración y despliegue

**Variables nuevas** (en `env.ts` con validación y en `.env.example`):

| Variable | Valor por defecto |
|---|---|
| `REALTIME_ENABLED` | `true` |
| `REALTIME_HEARTBEAT_SECONDS` | 25 |
| `REALTIME_SESSION_RECHECK_SECONDS` | 60 |
| `REALTIME_MAX_CONNECTIONS_PER_USER` | 10 |
| `INBOX_DIGEST_DELAY_STAFF_MINUTES` | 10 |
| `INBOX_DIGEST_DELAY_CUSTOMER_MINUTES` | 15 |
| `INBOX_REMINDERS_ENABLED` | `true` |

**Runbook:** se actualiza `production-readiness.md`.
- El proxy no debe almacenar en búfer `/api/realtime` (`proxy_buffering off`, o el encabezado ya enviado).
- `proxy_read_timeout` debe ser de 60 s o más.
- Se recomienda HTTP/2.
- PM2 funciona en una o varias instancias, porque cada una tiene su LISTEN.
- El interruptor `REALTIME_ENABLED=false` deja a todos en consulta cada 30 s sin desplegar.

**Datos:**
- La bandeja arranca vacía.
- El backlog local del outbox no genera avisos, porque la bandeja se llena en la transacción y no desde el outbox.

## 13. Pruebas

**Unitarias:**
- Catálogo completo: cada `kind` tiene prioridad, audiencia, icono, campos permitidos y redacción.
- `renderInboxText` con todas las combinaciones de conteos.
- `mergeInboxData`.
- La tabla de señales (`p` y `v`) por evento.
- El filtro de alcance del hub con conexiones simuladas.
- El codificador SSE.
- El reductor del cliente (upsert por id y contadores).
- La elección de pestaña líder, con sustitutos de `locks` y `BroadcastChannel`.
- El formato del título "(N)".

**Integración** (`RUN_DB_TESTS=1`):
- `recordDomainEvent`:
  - Con commit crea las filas y un cliente LISTEN de prueba recibe la señal.
  - Con rollback no crea nada ni emite señal.
- Carrera de agrupación: dos transacciones concurrentes dejan una sola fila con `occurrences = 2`.
- Resolución del pool al tomar la solicitud.
- Aprobación resuelta o reemplazada.
- Alcance: una reasignación oculta los avisos de la persona anterior.
- Rutas de la bandeja: permisos, `same-origin` y `no-store`.
- `/api/realtime`: 401, encabezados, `hello`, reanudación con `Last-Event-ID` y cierre con `s`.
- Flujo de declinar: estados, mensaje, idempotencia y conflicto.
- Correcciones de correo: archivo, solicitud nueva y autoasignación.
- Resumen:
  - enviado si el aviso sigue sin leer;
  - cancelado con `ALREADY_READ` si ya se leyó;
  - uno por aviso.
- Idempotencia de la bitácora de recordatorios.

**E2E** (`tests/realtime-notifications.spec.ts`, opcional con `REALTIME_E2E=1`, con un escenario QA aislado y nunca con los fixtures del piloto):
- Contexto cliente y contexto equipo:
  - El cliente escribe y sube un archivo; en menos de 5 s, sin recargar, el equipo ve el contador en 1 y el flash "subió 1 archivo y dejó un mensaje".
  - Cuando el equipo responde, el hilo del portal se actualiza solo.
- El cliente declina con motivo y el equipo ve el flash urgente.
- Dos pestañas del equipo:
  - hay una sola conexión SSE;
  - leer en una pestaña limpia el contador de la otra.
- Con el interruptor apagado, el modo de consulta sigue funcionando.
- Axe en el panel y en el flash, sin hallazgos serios.
- 390 px sin desbordes.

## 14. Bloques de entrega

Cada bloque tiene su propio plan de implementación en `docs/superpowers/plans/`. El plan se escribe al empezar el bloque, sobre el código que dejó el anterior.

**En cada bloque:**
- tsc, lint, pruebas unitarias e integración de lo tocado;
- la suite E2E completa con los flags acostumbrados;
- la spec del bloque en `docs/ocpool-commercial-v2/specs/` y su entrada en `PROJECT_STATUS.md`;
- un commit en la rama, sin push.

1. **Motor de avisos y bandejas.**
   - Modelo y migraciones, `recordDomainEvent` y `notifyInbox`.
   - Catálogo y reglas de §2 para los eventos existentes.
   - API de §3.
   - Campana, panel y bandeja en staff; "Novedades" en el portal.
   - "Entregas de correo" y la migración del permiso de Ventas.
   - Las correcciones de correo de §8.1, salvo el resumen.
   - En este bloque la campana se actualiza al navegar y con la consulta de respaldo cada 30 s.
2. **Tiempo real y flash.** Canal, hub, `/api/realtime`, `RealtimeProvider` (pestaña líder, respaldo e interruptor), flash, sonido, título y escritorio.
3. **Pantallas en vivo.** Toda la tabla de §5.4, más "Visto por el cliente".
4. **Nuevas señales del cliente.** Declinar propuesta (§6), "abrió la propuesta" y "entró a su portal" (§7).
5. **Correo inteligente, recordatorios y preferencias.** §8.2, plantillas de §8.3 pendientes, §9 y §10.

## 15. Fuera de alcance

- Indicador de "escribiendo…".
- Presencia en línea.
- WhatsApp o SMS.
- Push web con el navegador cerrado (requiere service worker y VAPID).
- Resumen diario por correo.
- @menciones en notas.
- Purga o retención de avisos.
- Limpieza del backlog del outbox: eventos de catálogo y precios que nadie consume. Es un problema preexistente y queda anotado.
