# OCPOOL — Especificación de Fase 6: mensajería y notas internas

> Estado: propuesta técnica lista para implementación incremental después del cierre verificable de Fase 5.

## Objetivo

Construir una conversación segura y trazable por expediente para que el cliente y el equipo OCPOOL intercambien mensajes de seguimiento, mientras el personal conserva notas internas que nunca puedan filtrarse al portal. La fase debe preservar el aislamiento por cliente, la autorización por capacidades y la consistencia transaccional con auditoría y Outbox.

La conversación será una superficie de coordinación comercial. No será un chat genérico, no sustituirá el expediente, no permitirá editar históricos y no incluirá archivos, aceptación digital ni envío productivo de notificaciones en esta fase.

## Alcance funcional

### Incluido

- una conversación única asociada a cada solicitud de cotización;
- mensajes de texto append-only entre cliente y equipo OCPOOL;
- notas internas separadas por visibilidad y nunca proyectadas al cliente;
- listado paginado por cursor o ventana estable, con orden cronológico determinista;
- envío de mensajes con validación, límite de longitud, same-origin, rate limiting e idempotencia opcional del cliente;
- lectura de mensajes propios por cliente sólo cuando el `clientId` de la sesión coincide con el expediente;
- lectura/escritura de mensajes de equipo mediante permisos explícitos y scope de solicitudes autorizado;
- estado abierto/cerrado de conversación, con regla clara para impedir mensajes después del cierre;
- auditoría de creación, lectura sensible, nota interna y cierre sin guardar cuerpos completos en logs;
- Outbox transaccional para eventos de mensaje, con payload mínimo y sin cuerpo/secretos;
- UI del portal para conversación visible al cliente;
- UI interna para conversación visible y notas internas, diferenciadas visualmente;
- estados de carga, vacío, error, sesión expirada, sin permiso, cerrado y límite de envío;
- pruebas unitarias, integración, seguridad negativa, accesibilidad, responsive y E2E opt-in.

### Fuera de alcance de esta fase

- adjuntos, almacenamiento privado, antivirus y URLs temporales;
- edición o borrado de mensajes históricos;
- aceptación, firma, PDF, pagos o facturación;
- notificaciones SMTP productivas, push, WhatsApp o tiempo real por WebSocket;
- reacciones, menciones, respuestas anidadas y búsqueda full-text avanzada;
- métricas administrativas de conversación;
- retención/eliminación definitiva sin política legal aprobada.

## Actores y autorización

### Cliente

- Se deriva de la sesión persistida; nunca del body, query, folio o `conversationId` recibido.
- Puede leer y enviar sólo mensajes de visibilidad `CUSTOMER` de conversaciones cuyo `clientId` coincida con `actor.clientId`.
- No puede enumerar conversaciones ajenas; UUID ajeno, folio ajeno o conversación inexistente devuelven el mismo `NOT_FOUND` público.
- No puede crear notas internas ni cambiar estado de conversación.
- Sesión ausente, revocada, expirada, archivada o sin cliente activo no obtiene mensajes.

### Empleado

- Requiere sesión de empleado y scope de solicitud ya autorizado por `requests.read`.
- `messaging.read` permite consultar mensajes visibles y notas internas de solicitudes autorizadas.
- `messaging.send` permite enviar mensajes visibles al cliente.
- `messaging.internal_notes.read` permite leer notas internas.
- `messaging.internal_notes.write` permite crear notas internas.
- `messaging.manage` permite cerrar/reabrir conversaciones; sólo gerencia/admin en la primera versión.
- Un empleado sin permiso nunca obtiene la nota ni puede inferirla desde conteos, paginación o errores.

Los permisos nuevos se agregan al catálogo seed idempotente y no sustituyen `requests.read`: la capacidad de mensajería no amplía por sí sola el alcance del expediente.

## Modelo de datos propuesto

### `Conversation`

- `id` UUID.
- `quoteRequestId` UUID único, FK restrict/cascade según integridad definida en migración; una conversación por expediente.
- `clientId` UUID redundante controlado, con FK compuesto conceptual a `quoteRequestId + clientId` para impedir cruces.
- `status`: `OPEN` o `CLOSED`.
- `createdAt`, `updatedAt`, `closedAt`, `closedById` nullable.
- índices por `clientId`, `status`, `updatedAt`.

### `ConversationMessage`

- `id` UUID.
- `conversationId` UUID.
- `senderUserId` UUID; relación `SetNull` sólo si la política futura permite conservar histórico de usuario eliminado.
- `visibility`: `CUSTOMER` o `INTERNAL`.
- `body` texto plano normalizado, máximo 10,000 caracteres por mensaje y máximo de body HTTP menor que el límite global existente.
- `idempotencyKeyHash` nullable y único por conversación/emisor para reintentos seguros, con longitud y formato controlados.
- `createdAt` timestamptz y sin `updatedAt` para reforzar append-only.
- índices `(conversationId, createdAt, id)` y `(conversationId, visibility, createdAt, id)`.

### `ConversationReadState` (si el primer slice requiere unread)

- `conversationId`, `userId` únicos.
- `lastReadMessageId` nullable, `readAt`.
- Sólo se actualiza hacia adelante y nunca altera el contenido histórico.

La primera implementación puede dejar unread para una tarea posterior si no es necesario para la UI inicial; no se debe inventar un contador derivado inconsistente.

## Contratos de servicio y API

El módulo `src/server/modules/messaging/` expondrá contratos explícitos:

- `getOrCreateConversationForRequest` sólo dentro de transacción y con `quoteRequestId + clientId` coherentes;
- `listConversationMessages(actor, conversationId, filters)` con proyección distinta para cliente y empleado;
- `sendCustomerMessage(actor, requestId, input)`;
- `sendStaffMessage(actor, requestId, input)`;
- `createInternalNote(actor, requestId, input)`;
- `closeConversation` y `reopenConversation` detrás de `messaging.manage`;
- `markConversationRead` sólo si el read state queda dentro del slice aprobado.

Rutas previstas:

- `GET /api/portal/requests/:id/messages`;
- `POST /api/portal/requests/:id/messages`;
- `GET /api/staff/quote-requests/:id/messages`;
- `POST /api/staff/quote-requests/:id/messages`;
- `POST /api/staff/quote-requests/:id/notes`;
- `POST /api/staff/quote-requests/:id/conversation-status`.

Las respuestas deben usar `requestId`, envelope público de errores, `cache-control: no-store` y no devolver tokens, hashes, secretos, cuerpos de notas al cliente, IDs cruzados ni stack traces.

## Consistencia, auditoría y Outbox

Cada envío o cambio de estado debe ejecutarse en una transacción que:

1. bloquee o cree la conversación de forma segura;
2. valide que la solicitud, cliente y conversación coinciden;
3. valide estado, permisos, rate limit e idempotencia;
4. persista el mensaje o estado;
5. registre auditoría mínima sin cuerpo completo;
6. cree un Outbox `MESSAGE.CREATED` o `CONVERSATION.STATUS_CHANGED` con IDs, visibilidad, folio y versión de evento, pero sin body;
7. confirme todo junto.

El worker de entrega y las notificaciones de usuario quedan fuera de esta fase; el Outbox debe quedar listo para que la siguiente fase lo consuma sin reprocesar cuerpos sensibles desde payloads.

## Seguridad y privacidad

- autorización backend por `clientId`, permisos y solicitud en la misma operación;
- cliente nunca puede escoger `visibility: INTERNAL` ni sobreescribir `senderUserId`;
- personal sin `messaging.internal_notes.read` no recibe notas internas aunque tenga `requests.read`;
- mensajes son texto plano; React escapa salida y no se acepta HTML, Markdown ejecutable ni URLs enriquecidas en la primera versión;
- rate limit por actor/conversación y límite de body para prevenir abuso;
- idempotencia para reintentos de red sin duplicar mensajes;
- errores ajenos/inexistentes no enumeran existencia;
- logger redacta body, token, cookie, email sensible y metadata de cliente;
- auditoría conserva actor, acción, resultado, entidad y request ID, no el contenido completo;
- pruebas de cliente cruzado, empleado sin permisos, nota filtrada, doble envío, conversación cerrada, UUID inválido y sesión revocada.

## Experiencia visual

- Portal cliente: hilo sereno integrado al expediente, mensajes de equipo destacados sin convertirlo en una app de chat genérica, composer claro y estado de conversación visible.
- Sistema interno: panel productivo junto al expediente, pestañas o zonas separadas para mensajes compartidos y notas internas, etiquetas de visibilidad inequívocas.
- Mensajes sin burbujas excesivas ni densidad móvil incómoda; lectura cronológica y timestamps accesibles.
- Composer con contador, error inline, bloqueo mientras envía e idempotencia transparente.
- Mobile 360–430 px con input y botón usables; desktop con panel estable; teclado, foco y reduced motion.

## Dependencias y riesgos

- Depende de sesiones/RBAC de Fase 2, solicitudes/scope de Fase 3, Outbox y auditoría de Fase 1, portal cliente de Fase 5.
- La migración debe respetar FKs y cleanup de fixtures para no romper datos comerciales.
- La política de cierre debe definirse antes de permitir mensajes posteriores a una solicitud aceptada/rechazada.
- La retención de cuerpos de mensajes requiere revisión legal pendiente; no se implementará borrado destructivo en esta fase.
- El envío SMTP queda desacoplado; no se debe fingir que crear Outbox equivale a notificar al cliente.

## Criterios de aceptación

- Cliente A no puede leer, escribir ni contar mensajes de cliente B.
- Una nota interna nunca aparece en portal, payload cliente, HTML, logs ni Outbox.
- Cliente no puede forzar visibilidad interna, sender distinto ni request ajeno.
- Empleado sin permiso de notas no puede leer/escribir notas; empleado sin `messaging.read` no ve conversación.
- Reintento con misma clave no duplica mensaje; claves distintas no colisionan.
- Mensajes y cambios de estado tienen auditoría y Outbox atómicos.
- Conversación cerrada rechaza nuevos mensajes con error público claro.
- UI cubre carga, vacío, error, cerrado, límite, móvil, teclado, Axe y reduced motion.
- No se agregan dependencias nuevas salvo justificación explícita y auditoría limpia.

## Autorrevisión de la especificación

- **Scope:** cliente, empleado, notas y Outbox están separados; no se mezclan archivos/notificaciones productivas.
- **Seguridad:** la visibilidad es una regla backend y no un filtro de frontend; IDs cruzados y folios no autorizan.
- **Histórico:** append-only evita alterar evidencia comercial; edición/borrado se deja para una política posterior.
- **Complejidad:** se reutilizan PostgreSQL, Prisma, RBAC, sesiones, rate limit y Outbox existentes; no se introduce WebSocket/Redis.
- **Riesgo pendiente aceptado:** unread, cierre jurídico y retención se mantienen como decisiones explícitas, no como defaults ocultos.
- **Resultado:** la especificación es implementable por slices verticales y deja el gate de fase verificable.
