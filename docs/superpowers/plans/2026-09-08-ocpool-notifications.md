# Fase 9 — Plan ordenado de implementación de notificaciones y entrega

> Plan posterior al cierre de Fase 8. Cada tarea tendrá pruebas y commit lógico. El correo comunica eventos confirmados; nunca será la fuente de verdad ni una vía alternativa de autorización.

## Tarea 1 — Contratos, persistencia y seguridad de destinatarios

- [x] Escribir pruebas rojas y verdes de estados, deduplicación, backoff, normalización/hash/cifrado y separación de permisos; allowlist y clasificación se mantienen para Tareas 2–3.
- [x] Agregar permisos mínimos `notifications.read` y `notifications.manage`, separados de permisos comerciales y de identidad.
- [x] Crear `NotificationDelivery` con FK a Outbox, canal, template version, destinatario cifrado/hash, estado, lease, intentos, timestamps y constraints.
- [x] Implementar normalización/hash/cifrado de destinatario y retention-safe persistence fields.
- [x] Crear migraciones y seed idempotente; verificar índices, FK, unicidad y cleanup de fixtures.
- [x] Verificar schema, typecheck y pruebas de persistencia.
- [x] Commit `feat: add notification delivery contracts`.

### Criterio de terminado

Los estados y constraints impiden duplicar la misma intención, `PROCESSING` puede recuperarse por lease, el destinatario no aparece crudo en logs/proyecciones y la migración se aplica desde cero y sobre una base existente.

## Tarea 2 — Mappers, templates y proveedor local

- [x] Implementar allowlist de eventos y mappers por evento con recipient scope, aggregate validation y payload mínimo.
- [x] Crear templates HTML/texto versionados para auth, solicitud, cotización enviada, aceptación, mensajes compartidos y archivo disponible.
- [x] Escapar dinámicos, bloquear header injection y construir URLs desde origen configurado/allowlisted.
- [x] Implementar contrato `EmailProvider` y adaptador SMTP Mailpit con configuración validada.
- [x] Probar unitariamente render, subject/from/reply-to, no secretos, visibilidad `INTERNAL` y payloads grandes/ilícitos.
- [x] Commit `feat: add notification templates and email provider`.

### Criterio de terminado

Cada evento soportado produce una plantilla versionada determinista y segura, los eventos desconocidos se cancelan como unsupported sin inferencia, y Mailpit recibe un email válido HTML + texto desde un adaptador reemplazable.

## Tarea 3 — Dispatcher, worker y reintentos

- [x] Implementar claim concurrente con `SKIP LOCKED`, lease, transición condicional y bounded batch.
- [x] Crear fan-out idempotente a nivel de intención desde Outbox a `NotificationDelivery` sin alterar el agregado comercial; la resolución de destinatarios comerciales queda en Tarea 4.
- [x] Implementar envío, timeout/proveedor, backoff exponencial con jitter acotado, máximo de intentos y clasificación temporal/permanente.
- [x] Implementar comando one-shot y worker continuo con shutdown limpio, logs redacted y métricas agregadas.
- [x] Agregar health/diagnóstico no sensible para edad del evento más antiguo, pendientes, enviados y fallidos.
- [x] Probar carrera entre workers, recuperación de `PROCESSING`, replay, proveedor caído, rate limit y error permanente.
- [x] Commit `feat: add notification dispatcher and worker`.

### Criterio de terminado

Un worker reiniciado retoma sin perder la intención; dos workers no crean duplicados lógicos; los temporales reintentan y los permanentes terminan operables; ningún cambio de negocio depende del proveedor.

## Tarea 4 — Integración de eventos comerciales y auth

- [x] Añadir cancelación trazable para eventos no soportados, sin fabricar un destinatario ni permitir que una intención cancelada entre al worker de correo.
- [x] Resolver destinatarios desde `User`, `ClientContact`, `QuoteRequest`, `Quote`, `ConversationMessage` y `FileAttachment`; cada resolver aplica estado activo, visibilidad y scope compuesto.
- [x] Crear claim/fan-out de Outbox separado del claim de entregas; el worker materializa sólo eventos de la allowlist y marca la materialización sin mutar el agregado comercial.
- [x] Conectar los eventos existentes sin duplicar Outbox: auth, solicitudes, cotizaciones, aceptación, mensajes y archivos según la allowlist.
- [x] Verificar que `QUOTE.VERSION_STATUS_CHANGED` sólo notifique al pasar a `ENVIADA`, y que aceptación use el total snapshot de la versión aceptada.
- [x] Mantener auth tokens cifrados y de un solo uso; nunca persistir el token descifrado en delivery ni en el payload seguro.
- [x] Añadir pruebas de integración por evento, destinatario, visibilidad, cliente cruzado, cancelación, replay y ausencia de datos internos.
- [x] Verificar envío real a Mailpit y cleanup exacto por fixture.
- [x] Commit `feat: connect transactional notification events`.

### Criterio de terminado

Todos los eventos de la allowlist producen exactamente las entregas esperadas, los eventos no soportados no se envían, y el sistema conserva trazabilidad de Outbox → delivery → provider sin alterar el estado comercial.

## Tarea 5 — Operación staff de entregas

- Alcance técnico fijado: `staff-service.ts` será la única capa que proyecte entregas operativas; la API sólo orquestará sesión, same-origin, validación y serialización HTTP.
- La proyección devolverá únicamente identificador, canal, estado, template/version, intentos, fechas operativas, código/categoría de error controlado, motivo de cancelación y metadatos del evento; no seleccionará ni serializará destinatario, ciphertext, payload, token, usuario receptor ni `providerMessageId`.
- El reintento manual será una transición condicional `FAILED → PENDING`, sólo para `TEMPORARY_PROVIDER` y `RATE_LIMIT`, con reinicio explícito de lease/estado procesado, auditoría de éxito y respuesta idempotente para carreras/repetición.
- La superficie `/staff/notifications` será una vista de operación, no un visor de contenido: filtros de estado, salud agregada, edad, errores categorizados y acción de reintento cuando corresponda.

- [x] Crear API staff de lectura con proyección mínima: estado, template, intento, fecha, categoría de error y edad; nunca dirección completa, ciphertext, token ni error crudo.
- [x] Crear acción staff de reintento sólo para `FAILED` recuperable, con RBAC, same-origin, idempotencia y auditoría.
- [x] Integrar una superficie interna clara y responsive para pendientes/fallidos, estado vacío, carga, error y confirmación de reintento.
- [x] Añadir Axe, teclado, reduced motion, consola limpia, no overflow y payload assertions.
- [x] Commit `feat: add staff notification operations`.

### Criterio de terminado

El personal autorizado puede diagnosticar y reintentar una entrega sin ver secretos ni cambiar el expediente; un rol sin capacidad no enumera ni muta notificaciones.

## Tarea 6 — Gate Fase 9

- [x] Ejecutar migración/seed, unitarias, integración serial, entrega real a Mailpit, E2E, typecheck, lint, build, audit y diff check.
- [x] Verificar métricas agregadas, logs redacted, cleanup exacto, one-shot, reintentos y proveedor no disponible mediante las pruebas dirigidas y el worker local.
- [ ] Completar para producción la política de retención, observabilidad/alertas, reinicio prolongado del worker y proveedor productivo; quedan como hardening posterior al gate local.
- [ ] Completar revisión legal, dominio de correo, SPF/DKIM/DMARC, backups/restauración y decisión de broker con evidencia de la infraestructura destino.
- [x] Actualizar `README.md`, `PROJECT_STATUS.md`, runbook y variables de entorno.
- [x] Commit `docs: close phase nine notifications`.

### Criterio de terminado

La entrega local es reproducible, los eventos son idempotentes y auditables, los fallos son operables, la seguridad de tokens/PII está probada y no existe claim de entrega/lectura que el proveedor no confirme. El cierre no autoriza lanzamiento: los controles de producción que permanecen sin marcar deben cerrarse antes de publicar.
