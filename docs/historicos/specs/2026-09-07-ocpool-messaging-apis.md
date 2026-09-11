# Especificación de APIs privadas de mensajería — OCPOOL

**Fecha:** 2026-09-07  
**Fase:** 6 — Mensajería y notas internas  
**Slice:** Tarea 3 — APIs privadas de portal y staff  
**Estado:** aprobada para implementación incremental

## Objetivo

Publicar la conversación persistida mediante endpoints privados, previsibles y seguros para el portal del cliente y el espacio interno. Las rutas deben delegar toda autorización y scope al servicio transaccional; no deben confiar en `clientId`, `senderUserId` o `visibility` enviados por el navegador.

## Contratos HTTP

### Cliente

- `GET /api/portal/requests/:quoteRequestId/messages`
  - Sesión: cliente autenticado con `messaging.read`.
  - Query estricta: `cursor` opcional y `limit` entero `1..100`.
  - Devuelve sólo mensajes `CUSTOMER` de la solicitud propia.
- `POST /api/portal/requests/:quoteRequestId/messages`
  - Sesión: cliente autenticado con `messaging.send`.
  - Same-origin obligatorio.
  - Body estricto: `{ body, idempotencyKey }`.
  - `body`: texto plano de 1..10,000 caracteres; la normalización definitiva pertenece al dominio.
  - `idempotencyKey`: 8..128 caracteres alfanuméricos y `._:-`.
  - Deriva visibilidad `CUSTOMER` y `senderUserId` desde la sesión.
  - Responde `201` con la proyección segura del mensaje y `cache-control: no-store`.

### Staff

- `GET /api/staff/quote-requests/:quoteRequestId/messages`
  - Sesión: empleado con `requests.read` y `messaging.read`.
  - Sin `messaging.internal_notes.read`, sólo devuelve mensajes `CUSTOMER`.
  - Con ese permiso, devuelve mensajes `CUSTOMER` e `INTERNAL`.
- `POST /api/staff/quote-requests/:quoteRequestId/messages`
  - Same-origin obligatorio.
  - Requiere `requests.read` y `messaging.send`.
  - Body estricto `{ body, idempotencyKey }`; la visibilidad siempre es `CUSTOMER`.
- `POST /api/staff/quote-requests/:quoteRequestId/notes`
  - Same-origin obligatorio.
  - Requiere `requests.read` y `messaging.internal_notes.write`.
  - Body estricto `{ body, idempotencyKey }`; la visibilidad siempre es `INTERNAL`.
- `POST /api/staff/quote-requests/:quoteRequestId/conversation-status`
  - Same-origin obligatorio.
  - Requiere `requests.read` y `messaging.manage`.
  - Body estricto `{ status: "OPEN" | "CLOSED" }`.
  - Reapertura y cierre son idempotentes y conservan auditoría sólo cuando cambia el estado.

## Seguridad de respuesta

- `401` sin sesión válida; `403` por actor o capacidad insuficiente; `404` genérico para solicitud ajena o inexistente; `409` para conversación cerrada; `429` para límite de envío.
- Todas las respuestas privadas usan `cache-control: no-store`.
- Toda mutación usa `assertSameOrigin`, `parseBody` con límite streaming y esquema Zod estricto.
- No se envían tokens, hashes, stack traces, SQL, `clientId` del cliente, `senderUserId` interno, payload Outbox ni cuerpos de notas internas a proyecciones de cliente.
- La respuesta de cliente identifica al autor sólo como cliente/equipo y muestra el nombre operativo permitido; la respuesta de staff puede incluir el UUID del autor para operación interna.
- Las rutas no hacen consultas directas de autorización: llaman a los servicios que ya bloquean y filtran por `QuoteRequest`.

## Errores y observabilidad

Cada handler obtiene un `requestId` antes de ejecutar, usa el envelope común de `toErrorResponse` y no registra cuerpos de mensajes. El servicio registra auditoría y Outbox; el handler no duplica esos efectos.

## Criterios de terminado

- Las cuatro superficies HTTP están implementadas y cubiertas por pruebas de integración.
- Se prueban sesión, permisos, same-origin, scope entre dos clientes, esquema estricto, paginación, `no-store`, rate limit y ausencia de datos sensibles.
- Typecheck, lint, integración completa y `git diff --check` están verdes.
