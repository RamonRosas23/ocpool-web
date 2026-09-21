# Runbook de recuperación operativa comercial (H1-07)

Este runbook describe qué hacer cuando algo real se atora, falla o se envía mal en el flujo comercial: solicitud → cotización → publicación → aceptación → proyecto. Cubre los mecanismos que **ya existen y funcionan hoy** en el código, con la consulta o comando exacto que un operador ejecutaría. Donde el mecanismo es parcial o no existe, se dice explícitamente — este documento no inventa herramientas que todavía no se construyeron.

No sustituye monitoreo en tiempo real ni alertas automáticas: esa infraestructura (dashboards, PagerDuty/Slack, SIEM) permanece fuera de alcance local, igual que en [auditoría operativa](audit-observability.md) y el [checklist de lanzamiento](launch-readiness-checklist.md). Lo que sí existe hoy es la capacidad de **detectar y corregir manualmente** cada incidente descrito aquí, con datos reales ya persistidos.

## Kill switch: apagar todo V2 de inmediato

`OCPOOL_V2_FLAGS_APPROVED` es la compuerta maestra (`src/server/flags/commercial-v2.ts`). Si no es exactamente `'true'`, **todas** las superficies V2 (`commercialWorkspaceV2`, `requestWorkspaceV2`, `quoteBuilderV2`, `quoteApprovalV1`, `quotePublicationV2`, `portalTimelineV2`, `projectHandoffV1`, `commercialTelemetry`) regresan a `false` sin importar el valor de sus variables individuales (`OCPOOL_V2_FLAG_*`). Un typo o un valor viejo en una variable de flag individual nunca activa nada por sí solo — sólo la aprobación explícita lo permite.

- **Apagar todo:** quitar o cambiar `OCPOOL_V2_FLAGS_APPROVED` en el entorno y reiniciar el proceso. No requiere migración ni despliegue de código.
- **Apagar una sola superficie** manteniendo las demás: dejar `OCPOOL_V2_FLAGS_APPROVED=true` y poner la variable individual correspondiente (ej. `OCPOOL_V2_FLAG_REQUEST_WORKSPACE_V2`) en cualquier valor distinto de `'true'`.
- **Límite real:** esto es un selector de superficie de UI (y, en un solo lugar, de destino de enlace en notificaciones — ver "Rollback a nivel API" abajo), no una bandera de autorización. Ningún endpoint bajo `src/app/api` cambia su lógica de negocio o permisos según estas variables — apagar el flag no revoca nada ya escrito en base de datos, sólo deja de ofrecer la superficie nueva.

## Reintentos seguros (retry)

No hay un mecanismo único: cada comando tiene su propia llave de idempotencia. Antes de reintentar cualquier operación desde soporte, confirmar cuál aplica:

| Operación | Mecanismo | Qué ve el operador si el reintento es un conflicto real |
| --- | --- | --- |
| Publicar cotización (`publishQuoteVersion`) | `expectedContentDigest` enviado por el caller; si la versión ya está `ENVIADA` con el mismo digest, regresa el mismo recibo | `409 CONFLICT` con mensaje distinto según el caso: "ya fue enviada con un contenido distinto" o "el contenido cambió" |
| Generar PDF (`generateQuotePdf`) | `READY` regresa igual; `PENDING` reciente bloquea; único índice `(quoteVersionId, documentType)` | `409 CONFLICT` "está en preparación" o "ya está siendo preparado" (carrera real) |
| Aceptación de cliente (`acceptCustomerQuote`) | `Idempotency-Key` del cliente, hash único por `(acceptedById, idempotencyKeyHash)` | `409 CONFLICT` "La llave de idempotencia ya fue utilizada con datos distintos" si el payload no coincide |
| Solicitud pública (`createQuoteRequest`) | Header `Idempotency-Key`, columna única `idempotencyKeyHash` | `409 CONFLICT` si el detalle no coincide (ver bitácora H1-02) |
| Reintento de notificación (`retryStaffNotificationDelivery`, `POST /api/staff/notifications/[id]/retry`) | Sólo permitido desde `FAILED` con código recuperable; ya-`PENDING` regresa `ALREADY_PENDING` sin error | `409 CONFLICT` si el estado no es reintentable |
| Conversión de aceptación a proyecto (`convertQuoteAcceptanceToProject`) | `@unique` en `Project.quoteAcceptanceId` | Reintento silencioso regresa el mismo proyecto (ver J1) |

**No existe** un comando de "reintentar" para la conversión legado de solicitud a proyecto vía `QuoteRequestStatus`: `CONVERTIDA_EN_PROYECTO` es sólo un valor terminal del enum sin transición de entrada — la conversión real vive exclusivamente en el modelo `Project` de J1 (arriba).

## Corrección de destinatario

Si una notificación o invitación de portal quedó dirigida a un correo equivocado:

1. Corregir el contacto: `updateStaffQuoteRequest` permite editar `ClientContact.email`/`phone` (`src/server/modules/quote-requests/staff-service.ts`). Cambiar el correo exige un `reason` no vacío; un correo duplicado contra otro contacto activo se rechaza con `409 CONFLICT`.
2. **D2-06 — limpieza automática de envíos en vuelo:** si el correo realmente cambió, el mismo comando cancela (`status: 'CANCELLED'`, `cancelReason: 'CONTACT_EMAIL_CHANGED'`) cualquier `notificationDelivery` `PENDING`/`PROCESSING` de ese expediente que **no** tenga `recipientUserId` (es decir, sólo destinatarios por contacto, nunca la cuenta de un cliente con portal ya vinculado) — evita que un envío ya encolado salga a la dirección vieja. No requiere acción manual adicional.
3. Reinvitar acceso de portal: `provisionCustomerPortalAccess`/`inviteCustomerPortalAccess` (`src/server/modules/customer-onboarding/service.ts`) revoca cualquier magic link vivo antes de emitir uno nuevo — es el mecanismo real de "revocar y reemitir". Si ya hay una invitación pendiente, regresa `ALREADY_PENDING` en vez de duplicar el token.

**No existe** un endpoint de "revocar acceso" independiente de reinvitar — invitar de nuevo es la forma real de revocar+reemitir.

## Recuperación de PDF atorado

`generateQuotePdf` (`src/server/modules/quote-documents/service.ts`) ya reclama documentos abandonados: un `PENDING` más viejo que `PDF_PENDING_STALE_MS` (3 minutos) se trata como un worker caído y se reutiliza la misma fila para un render nuevo, en vez de bloquear para siempre o duplicar.

Consulta de diagnóstico (no existe endpoint dedicado, es SQL directo):

```sql
SELECT id, status, "updatedAt", now() - "updatedAt" AS age
FROM generated_documents
WHERE status IN ('PENDING', 'FAILED')
ORDER BY "updatedAt" ASC;
```

- `READY`: llamar `generateQuotePdf` de nuevo regresa el mismo documento, no hace nada.
- `FAILED`: llamar de nuevo inicia un render limpio.
- `PENDING` más viejo que el umbral: llamar de nuevo lo reclama y completa.
- `PENDING` más joven que el umbral: no hay forma de forzar el reclamo desde este flujo — hay que esperar la ventana completa antes de reintentar.

Cuando una versión enviada regresa a borrador, `invalidateQuoteVersionDocument` borra la fila (y el objeto de storage, best-effort) para que el siguiente `generateQuotePdf` no reutilice un PDF viejo.

## Reconciliar los punteros working/published

`Quote.workingVersionId`/`Quote.publishedVersionId` (ver [ADR de punteros](../adr/2026-09-11-quote-working-published-pointers.md)) están protegidos a nivel de FK compuesta (`quotes_working_version_same_quote_fk`/`quotes_published_version_same_quote_fk`) sólo para garantizar que el puntero apunte a una versión de la **misma cotización** — no garantizan que el estado de esa versión sea el correcto para el rol que ocupa.

**No existe** un script o endpoint de reconciliación automática. El único detector hoy es incidental: `resolveQuoteWorkspaceProjection` (`src/server/modules/quotes/workspace-projection.ts`) lanza un error 500 genérico ("Unclassified quote workspace projection combination...") si encuentra una combinación de estados que no reconoce — es una guarda de proyección, no una herramienta de reconciliación.

Consulta manual para detectar el caso conocido más probable (`publishedVersionId` apuntando a una versión que ya no debería ser la publicada):

```sql
SELECT q.id, q."publishedVersionId", qv.status
FROM quotes q
JOIN quote_versions qv ON qv.id = q."publishedVersionId"
WHERE qv.status NOT IN ('ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA');
```

Cualquier fila que regrese esta consulta es un estado imposible y requiere intervención manual directa en base de datos (nunca automatizada sin revisión humana) hasta que exista una herramienta dedicada.

## Aprobaciones huérfanas

Sí existe un mecanismo real de invalidación, aunque sin limpieza en segundo plano:

- **Al re-solicitar:** `requestQuoteApproval` marca `SUPERSEDED` cualquier aprobación previa `REQUESTED`/`APPROVED` del mismo tipo y versión antes de crear una nueva — pero sólo si el contenido (digest) cambió; una solicitud idéntica todavía pendiente se reutiliza tal cual.
- **Al volver a borrador:** `performQuoteVersionTransition` marca `SUPERSEDED` todas las aprobaciones `REQUESTED`/`APPROVED` de esa versión.
- **Expiración (`expiresAt`, tope de 30 días):** se filtra en cada lectura (`decideQuoteApproval`, colas de pendientes, verificación de aprobación vigente) — pero **no hay estado `EXPIRED` ni job que limpie la fila**. Una aprobación vencida sigue viva en la tabla como `REQUESTED` para siempre; sólo deja de ser *utilizable*. Un query directo sobre `quote_approvals` seguirá mostrándola.
- **Al clonar una versión:** las aprobaciones de la versión original no se tocan — quedan atadas a esa versión (que ya no es la vigente), no "huérfanas" en sentido estricto de base de datos, simplemente irrelevantes.

## Worker de notificaciones

- **Comandos:** `npm run worker:notifications:once` corre un lote y termina; `npm run worker:notifications` corre en bucle continuo y responde a `SIGINT`/`SIGTERM` para apagarse limpio.
- **Reclamo tras una caída:** `claimNotificationDeliveries` usa `FOR UPDATE SKIP LOCKED` y reclama tanto `PENDING` vencido como `PROCESSING` cuyo `processingStartedAt` ya pasó el lease (`NOTIFICATION_LEASE_SECONDS`, 300s por defecto) — un worker que se cayó a medias se autocorrige en la siguiente corrida, sin acción manual.
- **Variables:** `NOTIFICATION_BATCH_SIZE` (25), `NOTIFICATION_LEASE_SECONDS` (300), `NOTIFICATION_MAX_ATTEMPTS` (5), `NOTIFICATION_POLL_INTERVAL_MS` (2000).
- **Diagnóstico de atasco:** `GET /api/staff/notifications` ya incluye `health` (`getNotificationOperationalHealth`) con conteos por estado y la antigüedad del `PENDING`/`PROCESSING`/`FAILED` más viejo. Un `oldestProcessingAt` más viejo que el lease sin que el worker esté corriendo indica que el proceso murió; un `pending` creciente con el worker corriendo indica que el worker no está activo o está atorado en otra cosa.
- **Clasificación de fallos:** `SMTP_PROVIDER_ERROR`/`RATE_LIMIT` reintentan con backoff (`calculateNotificationRetryAt`); `INVALID_RECIPIENT`/`TEMPLATE_ERROR`/`CONFIGURATION` van directo a `FAILED` sin más intentos. Nota de H1-03: hoy **todo** error real de SMTP llega como `SMTP_PROVIDER_ERROR` (siempre reintentable), incluso un rechazo permanente — el daño está acotado por `NOTIFICATION_MAX_ATTEMPTS`, pero la clasificación fina de SMTP quedó señalada como pieza aparte, no resuelta todavía.

## Rollback a nivel de UI/API

Más allá del kill switch de flags (arriba), **no hay nada más que "revertir" a nivel de API**: ninguna ruta bajo `src/app/api` cambia su autorización o lógica de negocio según estas variables. El único consumidor no-UI es `event-resolver.ts`, que elige qué URL incrustar en un correo de notificación (`/staff/requests/{id}?tab=...` vs `/staff/quotes?request=...`) según el flag — es una elección de destino de enlace, no una diferencia de comportamiento o permisos. No inventar aquí un "rollback de API" que no existe: revertir siempre significa apagar el flag de UI.

## Forward-fix de base de datos

Convención ya establecida y usada varias veces en este proyecto — **nunca revertir una migración ya aplicada, siempre corregir hacia adelante**:

1. **Bug de aplicación descubierto al verificar una migración expand/backfill:** ejemplo real, D1 (2026-09-19) — el índice único nuevo `(quoteVersionId, position)` rompía la creación de líneas porque ningún sitio de escritura asignaba `position` todavía. La corrección fue código (asignar `position` desde el índice del arreglo en los dos sitios reales de escritura), no un rollback de esquema, verificado con la suite completa antes de cerrar la pieza.
2. **El "diffing espurio" de Prisma sobre FKs compuestas sin representación declarativa:** `quotes_working_version_same_quote_fk`/`quotes_published_version_same_quote_fk` no existen en `schema.prisma` (se crearon por SQL directo), así que cada `prisma migrate diff` posterior propone `DROP CONSTRAINT` sobre ellas por error. La corrección establecida es una migración compensatoria que las vuelve a crear explícitamente — ya ocurrió dos veces (`20260915192000_restore_quote_pointer_integrity_constraints` y `20260917193800_restore_quote_pointer_integrity_constraints_2`). Si un futuro `migrate dev`/`diff` vuelve a proponer `DROP CONSTRAINT` sobre estas dos FKs específicas, es ese mismo patrón conocido, no una regresión real — hay que quitar esas líneas del script generado antes de aplicarlo, o restaurar con una migración nueva si ya se aplicó por error.

## Soporte con `requestId`

Cada ruta genera un `requestId()` (UUID) al inicio y lo pasa a `toErrorResponse(error, id)` — el mismo id aparece en el cuerpo de la respuesta de error (`{error:{code, message, requestId}}`) **y** en el log estructurado del servidor (`logger.warn`/`logger.error` con `requestId`), incluyendo el `stack` completo para errores no controlados. Esto es universal, no opt-in por ruta: todo handler sigue la forma `const id = requestId(); try {...} catch (error) { return toErrorResponse(error, id); }`.

Para soporte: pedir al usuario el `requestId` que aparece en el mensaje de error, buscarlo en los logs del proceso y encontrar la línea exacta con código, status y (si aplica) el stack trace real — sin necesidad de reproducir el error ni adivinar la causa.

## Anomalías de autenticación (detección, sin dashboard todavía)

Los datos ya existen y ya se escriben — lo que falta es agregación/alertas automáticas, explícitamente fuera de alcance local:

- `AuthEvent` (tipos: `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `MAGIC_LINK_REQUEST`, `MAGIC_LINK_CONSUMED`, `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET_CONSUMED`, `MFA_ENROLLED`, `MFA_CHALLENGE`, `MFA_FAILURE`, `SESSION_CREATED`, `SESSION_REVOKED`) ya se escribe desde `src/server/auth/service.ts` en cada intento real.
- `AuthRateLimit` (scope + `keyHash` + ventana + intentos + `blockedUntil`) respalda los bloqueos de `employee-login-email`, `quote-request-email`/`quote-request-ip`, `audit-read`, etc.
- Ya expuesto de sólo lectura a `admin` vía `/staff/audit?category=security` — ver [runbook de auditoría](audit-observability.md). No hay todavía ninguna regla de "N fallos en M minutos dispara alerta" — eso requeriría un consumidor de estos eventos que no existe hoy.

## Pruebas y regresión

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

Los mecanismos de reintento, PDF y worker ya tienen cobertura de integración dedicada (`tests/integration/quote-requests-service.test.ts`, `quote-documents-api.test.ts`, `quote-acceptance-service.test.ts`, `quote-pdf-service.test.ts`, `notifications-dispatcher.test.ts`, `quotes-service.test.ts` — ver bitácora H1-02/H1-03). Este runbook no agrega pruebas nuevas: documenta procedimientos sobre mecanismos ya probados.

## Explícitamente fuera de alcance de esta pieza

- Dashboards y alertas en tiempo real para cualquiera de los diez puntos anteriores — requieren proveedor de observabilidad (Grafana/Datadog/similar) y decisión operativa de destino, ambos externos a este repositorio.
- Reconciliación automática de punteros working/published — hoy es SQL manual, no una herramienta.
- Limpieza automática de aprobaciones expiradas — hoy es filtrado en lectura, no un job.
- Clasificación fina de errores SMTP temporales vs permanentes — señalado aparte en H1-03, no resuelto aquí.
- Conversión legado de solicitud a proyecto vía `QuoteRequestStatus.CONVERTIDA_EN_PROYECTO` — no implementada; J1 (`Project`) es el mecanismo real vigente.
