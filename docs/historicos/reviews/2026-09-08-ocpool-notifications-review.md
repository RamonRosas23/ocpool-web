# Autorrevisión — Fase 9: Notificaciones y entrega

## Documento revisado

`docs/historicos/specs/2026-09-08-ocpool-notifications.md`

## Preguntas de revisión

### ¿La fase conoce su frontera?

Sí. La primera entrega se limita a notificaciones transaccionales por email, Mailpit local, worker PostgreSQL y operación mínima. WhatsApp, campañas, editor de plantillas, Redis y firma jurídica quedan fuera. Esto evita convertir notificaciones en un CRM o introducir un broker antes de tener evidencia de volumen.

### ¿El diseño puede duplicar correos?

Puede existir una repetición residual si el proveedor confirma el mensaje y el proceso muere antes de persistir `SENT`; el diseño no promete exactly-once imposible. La intención sí queda deduplicada por evento/canal/destinatario/plantilla y los reintentos de la misma fila son explícitos. La implementación debe documentar idempotency key del proveedor cuando exista y tratar el timeout como incertidumbre operativa, no como permiso para crear otra fila.

### ¿Se puede perder una notificación?

El evento de negocio se escribe transaccionalmente. Si el mapper no puede resolver destinatario o template, la entrega queda en estado operable con causa controlada y auditoría. El gate debe probar que un fallo de email no revierte ni elimina la solicitud, cotización o aceptación.

### ¿El worker puede procesar dos veces la misma fila?

Sí, dos procesos pueden competir, pero sólo uno debe ganar el claim por fila y lease. La revisión de implementación exige `UPDATE ... WHERE status = PENDING ... RETURNING` o equivalente transaccional con `SKIP LOCKED`, lease vencible y transición condicional. No debe bastar un `findMany` seguido de updates independientes.

### ¿Hay filtraciones de privacidad?

Los riesgos principales son token de auth, mensaje interno, dirección de destinatario, cuerpo dinámico y error SMTP. La especificación los trata explícitamente: ciphertext sólo en Outbox, token descifrado en memoria, scope por visibilidad, escape HTML, address hash/encryption y códigos de error controlados. La implementación necesita pruebas que inspeccionen DB, logs, HTML, headers y Mailpit.

### ¿El email es la fuente de verdad?

No. El portal y el expediente siguen siendo la fuente de verdad; el correo sólo comunica un evento confirmado y enlace a la superficie autorizada. La aceptación no se ejecutará desde un botón que evite autenticación o scope del portal.

### ¿El modelo de datos está equilibrado?

`NotificationDelivery` separada de `OutboxEvent` es necesaria porque un evento puede fan-out a varios destinatarios y cada proveedor responde de forma distinta. No se agregan tablas de campañas, preferencias complejas ni proveedores múltiples. Antes de implementar se debe confirmar el límite de retención de payload/subject y si el ciphertext de destinatario requiere rotación separada.

### ¿La operación es reproducible localmente?

Sí: Docker ya contiene PostgreSQL y Mailpit; el worker puede usar el mismo `.env` validado y un comando one-shot para pruebas. Falta agregar el contrato de proceso al Compose sólo cuando la implementación tenga healthcheck, shutdown limpio y no genere workers duplicados en desarrollo.

## Hallazgos y decisiones resultantes

1. No se añadirá Redis en esta fase. Se medirá edad del evento más antiguo, throughput y contención de claims; Redis sólo se reconsiderará con evidencia.
2. Los eventos no soportados no se envían ni se marcan como una categoría inexistente; se cancelan como intención de notificación con causa segura y quedan trazables.
3. El payload de template será una proyección allowlisted. No se pasará el JSON completo de Outbox a una plantilla.
4. La primera implementación no expondrá una consola administrativa amplia; sólo servicios, logs redacted, health operativo y pruebas. La UI de métricas se planificará después de estabilizar entregas.
5. La semántica de `SENT` será “aceptado por el adaptador/proveedor”, no “leído por la persona”.
6. No se cerrará Fase 9 mientras el worker funcione sólo en pruebas unitarias: debe demostrarse con Mailpit real, reinicio, retry y ausencia de duplicados.

## Riesgos que siguen abiertos

- proveedor SMTP/API productivo, reputación de dominio, SPF/DKIM/DMARC y webhooks;
- retención y cifrado de destinatarios/payloads en cumplimiento de privacidad;
- límites de volumen y decisión futura de broker;
- política jurídica de emails de cotización, aceptación y recuperación;
- observabilidad productiva y alertas fuera del entorno local.

## Veredicto

La especificación es apta para convertirse en plan de implementación. No se autoriza código hasta conservar esta autorrevisión junto con el plan ordenado y hasta que los contratos de migración, worker y templates incluyan pruebas negativas de secretos, scope, concurrencia y reintentos.
