# OCPOOL — Plan Fase 3: Clientes, solicitudes y expedientes

> Estado: ejecución activa. Tareas 1–5 terminadas con evidencia; Tarea 6 en desarrollo. Cada tarea requiere pruebas y evidencia antes de pasar a la siguiente.

## Objetivo

Convertir el contacto público en una solicitud comercial persistida y trazable, con cliente/contacto, folio, estado, historial y asignación interna. Esta fase debe producir el primer expediente real sobre el que dependerán catálogo, cotizaciones, portal y mensajería.

## Alcance

Incluye:

- cliente comercial y contactos relacionados;
- solicitud de cotización persistida;
- detalles estructurados de la solicitud y texto libre acotado;
- folio comercial independiente del UUID interno;
- estados y transiciones explícitas;
- historial inmutable de estados;
- asignación de responsables con historial;
- endpoint público de creación y confirmación segura;
- endpoints internos de listado, detalle, asignación y cambio de estado;
- autorización backend por permiso y alcance del registro;
- Outbox transaccional para `REQUEST.RECEIVED`, sin worker de correo todavía;
- UI pública de envío, estados de carga/error/éxito y presentación del folio;
- pruebas unitarias, integración, API y E2E del vertical slice.

Fuera de esta fase:

- catálogo y precios;
- constructor de cotizaciones;
- portal autenticado del cliente;
- mensajería y archivos;
- PDF, aceptación y notificaciones entregadas por worker;
- dashboards y métricas comerciales.

## Dependencias

- Fase 1: Prisma, PostgreSQL, errores, logs, Outbox y documentación.
- Fase 2: usuarios, clientes base, sesiones, RBAC y permisos.
- Landing actual: formulario y contrato visual que no debe romperse.
- Mailpit/worker: sólo se registra el evento Outbox; la entrega queda para la fase de notificaciones.

## Modelo de datos propuesto

Se extenderá el schema relacional con:

- `ClientContact`: persona de contacto, email normalizado, teléfono, cargo, contacto primario y estado; puede enlazar opcionalmente a `User` cuando exista acceso de cliente.
- `QuoteRequest`: expediente raíz con `clientId`, `contactId`, folio único, origen, estado, timestamps y responsable actual opcional.
- `QuoteRequestDetail`: atributos estructurados de la solicitud —tipo de proyecto, ubicación, presupuesto orientativo opcional, dimensiones opcionales y descripción— separados de la entidad raíz.
- `RequestAssignment`: historial de asignaciones con actor que asigna, responsable, fechas y motivo.
- `RequestStatusHistory`: historial inmutable de transición con actor, estado anterior/nuevo, motivo y timestamp.
- `FolioSequence`: secuencia relacional con bloqueo transaccional para generar folios sin colisiones; nunca se usará el folio como autenticación.

Reglas:

- `ClientContact.emailNormalized` será único dentro del cliente, no global, para permitir un contacto con distintos clientes sin mezclar expedientes.
- La solicitud conservará `clientId` y `contactId` históricos; no se eliminarán físicamente registros referenciados.
- Toda creación de solicitud generará cliente/contacto, folio, detalle, estado inicial, historial inicial y Outbox dentro de una única transacción.
- Los cambios de estado sólo pasarán por una tabla de transiciones permitidas en el servicio; la UI no decide la transición.
- La asignación actual será una proyección consultable; `RequestAssignment` será la fuente histórica.
- Se usarán índices para inbox por estado/fecha, responsable/estado, cliente/fecha y folio.
- No se usará JSON para campos que requieran filtros, unicidad, relaciones o integridad.

## Estados iniciales

```text
RECIBIDA
→ EN_REVISION
→ INFORMACION_REQUERIDA
→ EN_ELABORACION
→ COTIZACION_DISPONIBLE
→ EN_NEGOCIACION
→ PENDIENTE_DE_APROBACION
→ ACEPTADA | RECHAZADA | VENCIDA
→ CONVERTIDA_EN_PROYECTO
```

La primera entrega implementará las transiciones necesarias para recepción, revisión, información requerida, elaboración, rechazo y cierre; las transiciones dependientes de cotización quedarán explícitamente bloqueadas hasta que exista ese módulo.

## Contratos API previstos

Público:

- `POST /api/quote-requests` — crea una solicitud, responde con aceptación genérica y folio no autenticador.

Interno:

- `GET /api/staff/quote-requests` — listado paginado con filtros por estado, responsable, fecha y búsqueda segura.
- `GET /api/staff/quote-requests/:id` — detalle autorizado del expediente.
- `POST /api/staff/quote-requests/:id/assign` — asignación con permiso `requests.assign`.
- `POST /api/staff/quote-requests/:id/status` — transición con permiso y validación de estado.

Los Route Handlers sólo adaptarán HTTP; la lógica de dominio vivirá en `src/server/modules/quote-requests/` y reutilizará errores, logs, sesión y auditoría existentes.

## Seguridad y autorización

- El endpoint público no permitirá fijar `clientId`, responsable, estado, permisos ni folio.
- El servidor normalizará email, limitará body, validará consentimiento y acotará strings antes de persistir.
- La respuesta pública no enumerará clientes existentes ni revelará detalles internos.
- Lectura interna requerirá sesión de empleado y permiso explícito; el cliente no podrá consultar este endpoint interno.
- La asignación y las transiciones comprobarán actor, permiso, estado actual y existencia del expediente dentro de una transacción.
- IDs internos no aparecerán como sustituto del folio en la comunicación pública.
- Logs y Outbox no contendrán contraseñas, tokens ni texto sensible innecesario.
- Se conservará auditoría de creación, asignación y cambios de estado.

## Tareas ordenadas

## Seguimiento de ejecución

- [x] Tarea 1 — contratos de dominio, transiciones, folio provisional, normalización y permisos RBAC. Commit: `bad4317`.
- [x] Tarea 2 — schema y migración relacional. Commit: `22c73ba`.
- [x] Tarea 3 — servicio transaccional de creación, folio concurrente e idempotencia. Commit: `9a8af1c`.
- [x] Tarea 4 — API pública y UI de captación. Commit: `cadc616`.
- [x] Tarea 5 — inbox interno y operaciones protegidas. Commit: `493d9ff`.
- [ ] Tarea 6 — gate de fase.

### Tarea 1 — Contratos de dominio y pruebas rojas

- Definir enums, DTOs, transiciones válidas y permisos requeridos.
- Escribir pruebas unitarias para transiciones, normalización, folios y autorización.
- Documentar invariantes y casos negativos.

### Tarea 2 — Schema y migración relacional

- Implementar los modelos e índices.
- Crear migración SQL inspeccionada.
- Actualizar seed sólo para permisos y secuencia necesaria.
- Verificar constraints, cascadas, `Restrict` y soft-delete lógico por estado.

### Tarea 3 — Servicio transaccional de creación

- Generar folio con bloqueo seguro.
- Upsert controlado de cliente/contacto sin mezclar clientes.
- Crear solicitud, detalle, historial, auditoría y Outbox atómicamente.
- Añadir idempotencia de solicitud pública mediante clave de reintento limitada y hasheada, si el contrato del formulario la requiere.

Evidencia de cierre: `tests/integration/quote-requests-service.test.ts` valida creación atómica, folio bajo concurrencia e idempotencia. La verificación de integración completa pasó 12/12 pruebas. La migración `20260908030200_quote_request_idempotency` añade la huella única de reintento sin almacenar la clave original.

### Tarea 4 — API pública y UI de captación

- Reemplazar la preparación `mailto` por persistencia real sin romper la landing.
- Mostrar éxito con folio, error seguro, carga y recuperación.
- Validar responsive, accesibilidad, consentimiento y no exposición de datos.

Evidencia de cierre: `POST /api/quote-requests` valida el contrato con Zod, same-origin, body limitado, consentimiento explícito, rate limiting por email/IP confiable e idempotencia por `Idempotency-Key`. El formulario ya no prepara `mailto`: crea el expediente, conserva la clave durante reintentos, muestra estados de carga/error/éxito y presenta el folio. La prueba de integración de API y el flujo Playwright del formulario pasaron; el endpoint legado fue retirado.

### Tarea 5 — Inbox interno y operaciones protegidas

Evidencia de cierre: se implementaron `GET /api/staff/quote-requests`, detalle, assignees, asignación y transición, junto con `/staff/requests`. El backend exige sesión de empleado y permisos explícitos, usa `FOR UPDATE` para mutaciones concurrentes, mantiene historial/auditoría/Outbox y serializa presupuestos sin exponer huellas de idempotencia. El inbox tiene filtros, paginación, estados vacíos/carga/error, responsive y protección visible para acceso no autenticado. Pasaron 6 pruebas específicas de servicio/API, 20 integraciones totales, build y E2E dirigido/completo.

### Tarea 5 — Inbox interno y operaciones protegidas

- Listado paginado y detalle con filtros seguros.
- Asignación y transiciones con permisos backend.
- Historial visible y auditoría técnica separadas.

### Tarea 6 — Gate de fase

- Migración/seed desde entorno local limpio.
- Unitarias, integración PostgreSQL, API negativa, E2E público e interno.
- Lint, typecheck, build, contrato de contenido, auditoría de dependencias y `git diff --check`.
- Actualizar `PROJECT_STATUS.md`, README y runbook sólo con evidencia.

## Criterios de terminado

La fase sólo se marca terminada cuando:

- una solicitud pública crea un expediente persistido y un folio único bajo concurrencia;
- cliente, contacto, detalle, estado inicial, historial y Outbox quedan en una transacción;
- la UI conserva la identidad actual y cubre carga, éxito, vacío y errores;
- un empleado autorizado puede listar, consultar, asignar y transicionar;
- un actor sin permiso, un cliente o un ID inexistente no puede acceder ni mutar expedientes ajenos;
- las transiciones inválidas, duplicados y reintentos tienen pruebas negativas;
- el historial no se edita ni se elimina por una operación normal;
- no se exponen IDs sensibles, secretos, SQL ni stack traces;
- la documentación identifica módulos terminados, pendientes, dependencias y riesgos;
- todos los checks del gate final pasan.

## Riesgos y decisiones abiertas

- Confirmar formato comercial definitivo del folio antes de publicar el contrato externo.
- Confirmar si un email puede representar a más de un cliente y cómo se seleccionará el contexto de acceso.
- Confirmar campos obligatorios del formulario comercial y política de retención de datos.
- No introducir almacenamiento de archivos ni worker de correo hasta que el dominio de solicitudes esté estable.
- Revisar el advisory de Prisma antes de cualquier preparación de producción.
