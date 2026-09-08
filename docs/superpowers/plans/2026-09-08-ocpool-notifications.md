# Fase 9 — Plan ordenado de implementación de notificaciones y entrega

> Plan posterior al cierre de Fase 8. Cada tarea tendrá pruebas y commit lógico. El correo comunica eventos confirmados; nunca será la fuente de verdad ni una vía alternativa de autorización.

## Tarea 1 — Contratos, persistencia y seguridad de destinatarios

- [ ] Escribir pruebas rojas de estados, deduplicación, allowlist, backoff, clasificación de errores y no exposición de secretos.
- [ ] Agregar permisos mínimos `notifications.read` y `notifications.manage`, separados de permisos comerciales y de identidad.
- [ ] Crear `NotificationDelivery` con FK a Outbox, canal, template version, destinatario cifrado/hash, estado, lease, intentos, timestamps y constraints.
- [ ] Implementar normalización/hash/cifrado de destinatario y retention-safe projections.
- [ ] Crear migración y seed idempotente; verificar índices, FK, unicidad y cleanup de fixtures.
- [ ] Verificar schema, typecheck y pruebas de persistencia.
- [ ] Commit `feat: add notification delivery contracts`.

### Criterio de terminado

Los estados y constraints impiden duplicar la misma intención, `PROCESSING` puede recuperarse por lease, el destinatario no aparece crudo en logs/proyecciones y la migración se aplica desde cero y sobre una base existente.

## Tarea 2 — Mappers, templates y proveedor local

- [ ] Implementar allowlist de eventos y mappers por evento con recipient scope y payload mínimo.
- [ ] Crear templates HTML/texto versionados para auth, cotización enviada, aceptación, mensajes compartidos y archivo disponible.
- [ ] Escapar dinámicos, bloquear header injection y construir URLs desde origen configurado/allowlisted.
- [ ] Implementar contrato `EmailProvider` y adaptador SMTP Mailpit con configuración validada.
- [ ] Probar unitariamente render, subject/from/reply-to, no secretos, visibilidad `INTERNAL` y payloads grandes/ilícitos.
- [ ] Commit `feat: add notification templates and email provider`.

### Criterio de terminado

Cada evento soportado produce una plantilla versionada determinista y segura, los eventos desconocidos se cancelan como unsupported sin inferencia, y Mailpit recibe un email válido HTML + texto desde un adaptador reemplazable.

## Tarea 3 — Dispatcher, worker y reintentos

- [ ] Implementar claim concurrente con `SKIP LOCKED`, lease, transición condicional y bounded batch.
- [ ] Crear fan-out idempotente desde Outbox a `NotificationDelivery` sin alterar el agregado comercial.
- [ ] Implementar envío, timeout, backoff exponencial con jitter acotado, máximo de intentos y clasificación temporal/permanente.
- [ ] Implementar comando one-shot y worker continuo con shutdown limpio, logs redacted y métricas agregadas.
- [ ] Agregar health/diagnóstico no sensible para edad del evento más antiguo, pendientes, enviados y fallidos.
- [ ] Probar carrera entre workers, reinicio durante PROCESSING, replay, proveedor caído, rate limit y error permanente.
- [ ] Commit `feat: add notification dispatcher and worker`.

### Criterio de terminado

Un worker reiniciado retoma sin perder la intención; dos workers no crean duplicados lógicos; los temporales reintentan y los permanentes terminan operables; ningún cambio de negocio depende del proveedor.

## Tarea 4 — Integración de eventos comerciales y auth

- [ ] Conectar los eventos existentes sin duplicar Outbox: auth, solicitudes, cotizaciones, aceptación, mensajes y archivos según la allowlist.
- [ ] Verificar que `QUOTE.VERSION_STATUS_CHANGED` sólo notifique al pasar a `ENVIADA`, y que aceptación respete snapshot/versión.
- [ ] Mantener auth tokens cifrados y de un solo uso; nunca persistir el token descifrado en delivery.
- [ ] Añadir pruebas de integración por evento, destinatario, visibilidad, cliente cruzado y ausencia de datos internos.
- [ ] Verificar envío real a Mailpit y cleanup exacto por fixture.
- [ ] Commit `feat: connect transactional notification events`.

### Criterio de terminado

Todos los eventos de la allowlist producen exactamente las entregas esperadas, los eventos no soportados no se envían, y el sistema conserva trazabilidad de Outbox → delivery → provider sin alterar el estado comercial.

## Tarea 5 — Operación staff de entregas

- [ ] Crear API staff de lectura con proyección mínima: estado, template, intento, fecha, categoría de error y edad; nunca dirección completa, ciphertext, token ni error crudo.
- [ ] Crear acción staff de reintento sólo para `FAILED` recuperable, con RBAC, same-origin, idempotencia y auditoría.
- [ ] Integrar una superficie interna clara y responsive para pendientes/fallidos, estado vacío, carga, error y confirmación de reintento.
- [ ] Añadir Axe, teclado, reduced motion, consola limpia, no overflow y payload assertions.
- [ ] Commit `feat: add staff notification operations`.

### Criterio de terminado

El personal autorizado puede diagnosticar y reintentar una entrega sin ver secretos ni cambiar el expediente; un rol sin capacidad no enumera ni muta notificaciones.

## Tarea 6 — Gate Fase 9

- [ ] Ejecutar migración/seed, unitarias, integración serial, Mailpit, E2E, typecheck, lint, build, audit y diff check.
- [ ] Verificar métricas, logs redacted, retención, cleanup, reinicio del worker y comportamiento con proveedor no disponible.
- [ ] Revisar riesgos legales, dominio de correo, SPF/DKIM/DMARC, backups y decisión de broker con evidencia.
- [ ] Actualizar `README.md`, `PROJECT_STATUS.md`, runbook y variables de entorno.
- [ ] Commit `docs: close phase nine notifications`.

### Criterio de terminado

La entrega local es reproducible, los eventos son idempotentes y auditables, los fallos son operables, la seguridad de tokens/PII está probada y no existe claim de entrega/lectura que el proveedor no confirme.
