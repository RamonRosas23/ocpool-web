# Fase 9 — Notificaciones y entrega

## Objetivo

Construir una capa de notificaciones transaccionales que convierta eventos Outbox ya confirmados en entregas de correo confiables, idempotentes, auditables y recuperables. La entrega debe ser desacoplada del resultado de la operación comercial: un correo fallido nunca revierte ni bloquea la creación de una solicitud, el envío de una cotización, un mensaje o una aceptación.

## Alcance de la primera entrega

- Dispatcher de Outbox para notificaciones, con reclamación concurrente segura en PostgreSQL.
- Tabla de entregas por evento/canal/destinatario/plantilla, con deduplicación y estado operativo.
- Canal email mediante un adaptador local Mailpit y un contrato sustituible para proveedor productivo.
- Plantillas versionadas HTML y texto plano, con escape de contenido dinámico y enlaces absolutos configurables.
- Eventos iniciales: `AUTH.CUSTOMER_MAGIC_LINK`, `AUTH.EMPLOYEE_PASSWORD_RESET`, `REQUEST.RECEIVED`, `REQUEST.ASSIGNED`, `QUOTE.VERSION_STATUS_CHANGED` cuando pasa a `ENVIADA`, `QUOTE.ACCEPTED`, `MESSAGE.CREATED` compartido y `FILE.AVAILABLE` cuando el archivo es visible para el destinatario.
- Reintentos con backoff, límite de intentos, clasificación de error, recuperación manual y métricas operativas mínimas.
- Worker local ejecutable de forma reproducible; no se agregará Redis mientras PostgreSQL satisfaga las garantías de esta fase.
- Pruebas de dominio, persistencia, APIs existentes, seguridad, templates, reintentos, idempotencia y E2E de un flujo de entrega local.

## Fuera de alcance

- WhatsApp, SMS, push móvil o proveedor multicanal.
- Editor de plantillas para usuarios finales.
- Campañas, marketing, newsletters o segmentación comercial.
- Envío de secretos crudos por logs, Outbox, UI o URLs persistentes.
- Confirmar entrega al buzón como si fuera lectura; sólo se registrará aceptación del proveedor SMTP/API.
- Redis, RabbitMQ o un servicio administrado antes de demostrar que PostgreSQL no cubre el volumen y la operación local.
- Sustituir la revisión jurídica de términos, firma avanzada, consentimiento o retención de datos.

## Decisiones arquitectónicas

1. El Outbox seguirá siendo creado en la misma transacción que el cambio de negocio. El worker sólo procesa eventos persistidos y nunca escribe directamente el resultado comercial.
2. La entrega se modelará separada de `OutboxEvent`, porque un evento puede producir varios destinatarios/canales y cada intento necesita estado, proveedor y auditoría propios.
3. La reclamación usará transacciones PostgreSQL, `FOR UPDATE SKIP LOCKED`, `availableAt`, timeout de lease y condición de actualización por estado. No se asumirá ejecución exactly-once: se diseñará idempotencia y se documentará la posibilidad residual de reenvío alrededor de un timeout del proveedor.
4. La unicidad lógica incluirá `outboxEventId`, canal, destinatario normalizado y versión de plantilla. Un reintento no crea otra intención de envío.
5. Los destinatarios se resolverán desde relaciones autorizadas del expediente/usuario. Cuando deba persistirse una dirección para reintento, se almacenará cifrada con la clave de entrega y se conservará un hash para deduplicación; nunca se escribirá la dirección completa en logs.
6. El evento conservará un snapshot mínimo suficiente para renderizar el mensaje. El template no consultará datos internos no incluidos en el contrato ni dependerá de un catálogo mutable para reescribir históricos.
7. Cada plantilla tendrá clave y versión (`quote-sent/v1`, `quote-accepted/v1`, etc.). Cambiar copy o estructura crea una versión nueva y no muta entregas históricas.
8. El proveedor local será Mailpit a través de un adaptador SMTP. Producción exigirá un adaptador real, dominio autenticado, SPF/DKIM/DMARC, límites, webhooks y política de rebotes antes del lanzamiento.
9. La UI staff de operación mostrará estado, último error público, próxima tentativa y acciones permitidas sin exponer tokens, cuerpos de error del proveedor, claves o direcciones no autorizadas. La UI de métricas detallada queda para la fase de observabilidad.

## Modelo de datos propuesto

### `NotificationDelivery`

- `id` UUID.
- `outboxEventId` FK a `OutboxEvent` con índice.
- `channel` (`EMAIL` en esta fase).
- `recipientUserId` opcional y `recipientAddressCiphertext` opcional.
- `recipientAddressHash` para deduplicación, nunca como dirección visible.
- `templateKey`, `templateVersion`, `subjectSnapshot` y payload renderizable mínimo.
- `status`: `PENDING`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED`.
- `attempts`, `availableAt`, `processingStartedAt`, `processedAt`, `lastErrorCode`, `providerMessageId`, `createdAt`, `updatedAt`.
- Unique compuesto de intención, índices por `status/availableAt` y por evento.

El `lastErrorCode` será una categoría controlada (`TEMPORARY_PROVIDER`, `RATE_LIMIT`, `INVALID_RECIPIENT`, `TEMPLATE_ERROR`, `CONFIGURATION`) y nunca el mensaje crudo del proveedor.

## Contrato de eventos

El dispatcher aceptará sólo una allowlist explícita. Eventos desconocidos no se enviarán por inferencia: la intención de notificación quedará `CANCELLED` con causa controlada `UNSUPPORTED_EVENT`, y el evento Outbox conservará su trazabilidad. Cada mapper definirá destinatario, plantilla, datos permitidos y condición de visibilidad.

- Auth: el worker recupera el token cifrado del payload, lo descifra sólo durante el render y no lo persiste en `NotificationDelivery`; el enlace expira y es de un solo uso.
- Cotización enviada: notifica al contacto del cliente con folio, versión, vigencia y enlace al portal; no incluye notas internas, precios no publicados ni IDs internos.
- Cotización aceptada: notifica al personal autorizado correspondiente con folio, versión, total snapshot y enlace interno; no incluye hash, fingerprints ni datos de sesión.
- Mensaje compartido: notifica sólo al lado opuesto autorizado; el cuerpo se escapa en HTML y el usuario puede recibir la información también desde el portal.
- Archivo disponible: sólo para destinatarios con scope del expediente y visibilidad `CUSTOMER`; nunca notifica archivos `INTERNAL` a clientes.

## Worker y operación

- Comandos locales separados para ejecutar una iteración (`worker:notifications:once`) y un proceso continuo (`worker:notifications`).
- Límite de lote configurable y bounded; no se cargarán todos los eventos en memoria.
- Un lease vencido puede volver a `PENDING` con backoff; un `PROCESSING` no se considera enviado.
- Los errores temporales reintentan; los permanentes pasan a `FAILED` sin bucle infinito.
- Se registrarán métricas agregadas: pendientes, procesando, enviados, fallidos, edad del más antiguo y último error por categoría.
- Cada transición relevante genera auditoría operativa sin destinatario completo, token, contenido sensible ni respuesta cruda del proveedor.
- La operación manual de reintento será explícita, limitada por permisos y nunca alterará el evento comercial original.

## Seguridad y privacidad

- El worker no será una ruta pública y no aceptará payloads arbitrarios desde el navegador.
- Las claves de cifrado de entrega serán independientes de MFA y de sesiones; se validarán al iniciar el proceso.
- Se aplicará SSRF-safe configuration: host, puerto, TLS y remitente provendrán de configuración validada, no del evento.
- Se fijará `From`, `Reply-To`, dominio y límites por entorno; nunca se permitirá header injection desde datos del cliente.
- HTML dinámico se escapará; URLs sólo podrán usar el origen configurado y rutas allowlisted.
- Los logs redacted no incluirán tokens, ciphertext, direcciones completas, bodies de mensajes ni errores SMTP crudos.
- El sistema no enviará automáticamente notificaciones de información `INTERNAL` a destinatarios cliente.

## UX y operación interna

- El cliente recibe mensajes claros y orientados a la acción, pero el portal sigue siendo la fuente de verdad.
- El personal verá salud del dispatcher y entregas fallidas sin administrar credenciales del proveedor desde la UI.
- Estados vacíos, cargando, reintento y error estarán definidos antes de integrar una pantalla de operación.
- El copy de aceptación conservará la distinción entre evidencia comercial y firma jurídica.

## Testing

- Unitarias: allowlist, mappers, escape HTML, versionado, backoff, clasificación, normalización/hash de destinatarios y no inclusión de secretos.
- Integración: migración, constraints, claim concurrente, lease expirado, retry, deduplicación, estado final, auditoría y limpieza.
- Contrato SMTP: adaptador Mailpit, TLS/configuración, subject/from/reply-to y payload HTML/texto.
- Seguridad: auth token de un solo uso, cross-client, visibilidad INTERNAL, header injection, SSRF de configuración, replay y errores sin secretos.
- E2E: solicitud/cotización/aceptación que produce Outbox, worker local que entrega a Mailpit, reintento temporal y no duplicación.
- Gate: typecheck, lint, unitarias, integración serial, build, E2E, auditoría de dependencias, diff check y documentación reproducible.

## Criterios de terminado

1. Todo evento entregable tiene mapper explícito, plantilla versionada, recipient scope y prueba.
2. Un evento se procesa sin duplicar intención aunque el worker se reinicie o dos workers compitan.
3. Un correo temporalmente fallido reintenta con backoff y uno permanente termina en estado visible/operable sin loop.
4. Los tokens de autenticación sólo existen descifrados en memoria durante el envío y nunca aparecen en DB de entregas, logs o UI.
5. Los mensajes internos nunca llegan a clientes y los datos dinámicos se escapan.
6. Mailpit funciona localmente desde Docker Compose y el proveedor está abstraído para producción.
7. Las pruebas y la documentación prueban el flujo de entrega sin afirmar entrega al buzón o lectura.
8. El gate queda registrado en `PROJECT_STATUS.md` y el commit de fase es lógico y separado.
