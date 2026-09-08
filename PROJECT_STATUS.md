# OCPOOL — Estado del proyecto

> Fuente única de seguimiento del proyecto de plataforma comercial. Este archivo se actualiza después de cada fase, vertical slice y verificación relevante.

## Estado actual

- **Fase:** Fase 9 — notificaciones y entrega, Tarea 4 en desarrollo.
- **Estado:** Fases 1–8 están terminadas con gates verdes. Fase 9 Tareas 1–3 están cerradas con persistencia, seguridad, templates, SMTP local, dispatcher, leases, reintentos y worker verificados; Tarea 4 integra los eventos transaccionales reales.
- **Última actualización:** 2026-09-08.
- **Rama de implementación:** `codex/ocpool-foundation`.
- **Commits de Fase 4:** `cda7a7a`, `4240d15`, `cea2064`, `78bd3fb`, `4236430`, `861e4d8`, `2909b62`, `89ec64e`.

## Orden documental obligatorio

1. Auditoría y decisiones iniciales.
2. Especificación de diseño en `docs/superpowers/specs/`.
3. Autorrevisión de la especificación en `docs/superpowers/reviews/`.
4. Plan de implementación en `docs/superpowers/plans/`.
5. Implementación por vertical slices.
6. Verificación de fase.
7. Actualización de este archivo y documentación técnica.

No se iniciará una fase posterior si la fase anterior no tiene criterios de terminado verificables.

## Módulos

### Terminados para el alcance actual de la web pública

- Landing pública editorial de OCPOOL.
- Identidad visual y sistema de estilos de la landing.
- Portafolio de proyectos y diálogo accesible.
- Navegación responsive.
- Formulario público básico de contacto.
- Metadata, Open Graph, Twitter card, JSON-LD, robots y sitemap.
- Contrato de contenido de la web.
- Pruebas E2E de calidad visual, interacción, responsive, consola y accesibilidad.
- Formulario público de cotización conectado al expediente persistido, con validación, consentimiento, estados de UI, folio e idempotencia de reintentos.
- Endpoint público `POST /api/quote-requests` con protección same-origin, límite de body, rate limiting por email/IP confiable y respuesta sin IDs internos.
- Inbox interno `/staff/requests` con lista paginada, filtros, detalle, historial, estados vacíos/carga/error y diseño responsive.
- Endpoints internos protegidos por sesión de empleado, RBAC, same-origin en mutaciones, bloqueo transaccional, asignación histórica y transiciones de estado auditadas.

### Fundamentos terminados en esta fase

- Toolchain ESM con TypeScript ES2023, Vitest y scripts reproducibles.
- Separación de descubrimiento E2E (`*.spec.ts`) y pruebas unitarias/integración.
- PostgreSQL 16 y Mailpit versionados en Docker Compose con healthcheck.
- `.env.example`, guard de variables y runbook de desarrollo local.
- Prisma 7.10.0 con adaptador PostgreSQL, schema foundation y migración aplicada.
- Seed idempotente de `system.schema_version`.
- Cliente Prisma lazy y servicio de health de base de datos.
- Logger estructurado con redacción y sanitización de valores sensibles.
- Contrato de errores HTTP públicos sin stack traces, SQL ni secretos.
- Endpoint `GET /api/health` con `requestId` y estado degradado seguro.
- Pruebas unitarias, integración PostgreSQL, E2E foundation y regresión de landing.
- Contrato de entorno para MFA, sesiones, tokens y rate limiting.
- Modelo relacional de clientes, usuarios, roles, permisos, sesiones, tokens, eventos y buckets de intentos.
- Migración adicional de protección contra replay de MFA (`20260908002806_mfa_replay_protection`).
- Argon2id para contraseñas de empleados; huellas SHA-256 para tokens y sesiones; AES-256-GCM para secretos MFA.
- Catálogo RBAC inicial con roles `customer`, `sales`, `manager` y `admin`, seed idempotente y guardias backend deny-by-default.
- Sesiones persistidas con expiración, revocación, actor derivado desde PostgreSQL y cookie `ocpool_session` con política segura.
- Tokens de autenticación de un solo uso y rate limiting de ventana fija con bloqueo de fila PostgreSQL.
- MFA TOTP con ventana controlada y contador persistido para rechazar replays.
- Servicios y rutas API de autenticación: login empleado, magic link, recovery, sesión y logout.
- Eventos de autenticación y Outbox transaccionales; tokens de entrega cifrados con clave separada de MFA.
- Protección same-origin, validación JSON con límite de body, errores públicos genéricos y request IDs.
- Rate limit por email/IP confiable sin bucket global `unknown-client`; circuit breaker global separado sólo para solicitudes sin IP confiable.
- Parser de cuerpos JSON con límite streaming de 16 KiB y cancelación temprana para requests chunked.
- Typecheck explícito (`npm run typecheck`) integrado en `npm test`.
- Contratos puros iniciales de solicitudes: estados, transiciones, folio provisional `OCQ-YYYY-NNNNNN`, normalización y permisos RBAC de solicitudes.
- Schema relacional de clientes/contactos, solicitudes, detalles, asignaciones, historial, folios e índices; migración `20260908025713_clients_requests` aplicada.
- Seed idempotente de `FolioSequence.quote_request` y catálogo RBAC ampliado para solicitudes.
- Servicio transaccional de solicitudes: cliente/contacto, folio bloqueado, detalle, historial inicial, auditoría y Outbox en una transacción.
- Idempotencia pública mediante huella SHA-256 de clave de reintento limitada; migración `20260908030200_quote_request_idempotency` aplicada.
- Captación pública E2E sobre navegador de producción local; el endpoint legado de `mailto` fue retirado para evitar flujos no persistentes.
- Servicio operativo de inbox: listado/detalle con proyección segura, responsables activos, asignación con cierre de asignación previa y eventos Outbox de operación.
- Gate reproducible de Fase 3: migraciones/seed al día, auditoría de producción sin vulnerabilidades conocidas y lockfile con overrides compatibles de dependencias transitorias.
- Contratos de Fase 4 para dinero, cantidades de punto fijo, porcentajes en basis points, redondeo half-up, límites y monedas explícitas.
- Cálculo puro de líneas con subtotal, descuento, base gravable, impuesto y total sin floats.
- Snapshots de líneas y totales congelados en memoria, con identidad comercial y valores monetarios capturados.
- Estados de cotización versionada con edición exclusiva de borradores y aceptación bloqueada hasta existir evidencia de aceptación.
- Permisos RBAC separados para lectura/administración de catálogo y lectura/administración de precios.
- Schema relacional de categorías, conceptos, listas, vigencias de precio, cotización raíz, versiones, líneas snapshot e historial.
- Migración `20260908032000_catalog_quotes` aplicada con extensión `btree_gist`, exclusión de vigencias solapadas y constraints monetarios.
- FK compuesto de `Quote` a solicitud+cliente para impedir cruces de expedientes desde la base de datos.
- Seed local demo (`DEMO-SERVICES`, `DEMO-CONSULTA`, `DEMO-MXN`) idempotente y explícitamente no comercial.
- Servicio transaccional de cotizaciones: resolución de precio vigente, snapshots completos, reemplazo de borrador, versionado concurrente, auditoría y Outbox.
- Envío de versión que actualiza la solicitud a `COTIZACION_DISPONIBLE` sólo dentro de la misma transacción.
- API interna protegida de capacidades, categorías, conceptos, listas y precios con validación same-origin, RBAC y errores públicos seguros.
- Servicio transaccional de catálogo con búsqueda, filtros, paginación, archivado no destructivo, vigencias sin solapamiento y auditoría/Outbox.
- UI interna responsive de catálogo y listas de precios con permisos por capacidad, estados de carga/error/vacío, confirmación de archivado y formato monetario sin floats.
- Servicio de lectura del espacio de trabajo de cotización con alcance de solicitud, cliente, contacto, versiones, líneas, historial y listas vigentes, sin BigInt crudo ni datos innecesarios.
- API interna protegida para listar expedientes cotizables, crear/reemplazar borradores y transicionar versiones con same-origin, RBAC, serialización monetaria y errores seguros.
- Constructor `/staff/quotes` responsive con selección de expediente, lista de precios, líneas, cantidades, descuentos, impuestos, resumen vivo, vigencia, historial y acciones de revisión/envío.
- Política backend que separa editar precios, aplicar descuentos y aprobar descuentos antes del envío; versiones enviadas no son editables.
- Gate reproducible de Fase 4 cerrado: migraciones/seed al día, dependencias sin vulnerabilidades altas, regresión completa y E2E del constructor opt-in verificados.
- Servicio de lectura del portal con scope obligatorio por `clientId`, proyecciones seguras, ocultamiento de borradores y serialización BigInt para cliente.
- Guard y API privada de cliente para listar expedientes, leer detalle y consultar cotizaciones propias con `no-store`, respuestas seguras y errores no enumerables.
- Portal privado `/portal` con shell de cliente propio, metadata `noindex`, estados de sesión/carga/vacío/error, dashboard de expedientes, logout, responsive, foco visible y reduced motion.
- Detalle de expediente y cotización versionada con líneas/totales snapshot, histórico de versiones, descuentos, impuestos y mensaje de vigencia expirada sin acciones fuera de alcance.
- Hardening del portal: sesiones de clientes archivados invalidadas, pruebas IDOR/UUID/sesión revocada, E2E autenticada opt-in, Axe, auditoría de payloads y limpieza exacta de fixtures.
- Gate de Fase 5 cerrado: migraciones/seed al día, regresión completa, E2E autenticada separada, auditoría de dependencias sin vulnerabilidades altas y árbol limpio.
- Contrato de mensajería y notas: permisos RBAC explícitos, conversación única por expediente, mensajes append-only, visibilidad `CUSTOMER`/`INTERNAL`, índices, FKs compuestos y constraints de body/cierre.
- Migraciones `20260908062317_messaging` y `20260908062400_messaging_constraints` aplicadas; seed idempotente con 27 permisos catalogados.
- Servicio transaccional de mensajería con scope por cliente, lock de solicitud, conversación única, cursor estable, reintentos idempotentes, rate limiting, mensajes compartidos, notas internas y cierre/reapertura.
- Auditoría y Outbox atómicos de mensajes y estados de conversación, con payloads sin cuerpo sensible.
- APIs privadas de portal y staff para lectura, mensajes compartidos, notas internas y cierre/reapertura, con Zod estricto, same-origin, no-store, RBAC, rate limit y proyecciones sin datos internos.
- Hilo de mensajería del portal cliente integrado en el detalle del expediente, con feed cronológico, cursor incremental, composer idempotente, estados de carga/vacío/error/cierre, responsive, foco/teclado, Axe y reduced motion.
- Workspace de mensajería staff integrado en `/staff/requests`, con vistas `Compartidos`/`Notas internas`, compositores separados, capacidades derivadas, cierre/reapertura con confirmación y estados de lectura/error/bloqueo.
- Hardening de accesibilidad del inbox staff: contraste AA de la paleta operativa, nombres accesibles para selects, Axe sin hallazgos serios en el flujo staff y no overflow móvil.
- Comando oficial de integración serializado a un worker DB para evitar timeouts de inicio de transacción por saturación local; se conserva la cobertura completa de 38 pruebas.
- Gate de Fase 6 cerrado: aislamiento cliente/staff, RBAC, idempotencia, cierre/reapertura, payloads/logs sin cuerpos sensibles, E2E opt-in, auditoría de dependencias y árbol limpio verificados.
- Especificación de Fase 7 para archivos privados por expediente, con storage S3-compatible privado, metadata relacional, estados de análisis, URLs efímeras, auditoría y pruebas negativas.
- Contrato de dominio de archivos: categorías, visibilidades, estados, nombres seguros, tipos permitidos, límite de 25 MiB y keys opacas.
- RBAC de archivos con seis capacidades explícitas y asignación mínima por rol; no se modificó la autorización de expedientes existente.
- Schema relacional `StorageObject`/`FileAttachment` y migración `20260908083258_private_files` con FK compuesto, soft delete, índices y constraints de tamaño/hash/key/visibilidad.
- Storage S3-compatible privado con MinIO local versionado en Docker, presigned PUT/GET, bucket creado bajo demanda, lectura HEAD/bytes y delete encapsulados en `PrivateStorage`.
- Scanner local `basic-signature-v1` para PDF/JPEG/PNG/WebP, estados de reserva/análisis, hash SHA-256 servidor, expiración y cleanup físico de reservas huérfanas.
- Servicio transaccional de archivos con idempotencia por actor, concurrencia serializada por expediente, aislamiento de visibilidad, descarga sólo `AVAILABLE`, auditoría y Outbox sin bytes/URLs.
- APIs privadas de archivos para portal/staff con reserva, finalización, listado, descarga y borrado; Zod estricto, same-origin, no-store, scope backend, capabilities y rate limit persistido.
- Panel `ClientFilesPanel` integrado en el detalle del portal cliente con upload presigned, finalización validada, descarga efímera, borrado confirmado, reintento, estados de carga/error/vacío y responsive.
- Panel `StaffFilesPanel` integrado en `/staff/requests` con tabs de visibilidad, carga por categoría, descarga, borrado condicionado por capability, estados operativos y responsive.
- Gate de Fase 7 cerrado: aislamiento por cliente/visibilidad/rol, no entrega antes de validación, URLs efímeras, auditoría segura, cleanup exacto, MinIO saludable, regresión completa y riesgos operativos documentados.

- Fase 8 — Tarea 1: dominio de documentos y aceptación con estados monotónicos, elegibilidad de versión vigente, normalización de nombre/terms y permisos separados para lectura, generación y aceptación.
- Fase 8 — Tarea 1: modelos `GeneratedDocument` y `QuoteAcceptance` separados de uploads, FK compuesto versión+cotización, unicidad de documento/aceptación/idempotencia, hashes y constraints de MIME, tamaño, READY, soft delete y evidencia.
- Fase 8 — Tarea 1: migración `20260908090000_quote_documents_acceptance` aplicada; el documento generado reutiliza el almacenamiento privado existente y no se mezcla con `FileAttachment`.
- Fase 8 — Tarea 2: renderer `pdf-lib` versionado, paginado y basado en snapshot; generación de hash/tamaño, verificación HEAD y almacenamiento privado idempotente.
- Fase 8 — Tarea 2: fixture PDF de 2 páginas revisado visualmente en PNG; metadata, folio, resumen, total y ausencia de texto interno comprobados por herramientas de inspección.
- Fase 8 — Tarea 2: dependencia directa `pdf-lib@1.17.1` justificada; no se añadió proveedor externo de PDF ni fuente no portable.
- Fase 8 — Tarea 3: servicios de aceptación y acceso a PDF protegidos por scope `clientId`, RBAC, lock transaccional, validación de objeto privado, evidencia SHA-256, idempotencia y Outbox/auditoría sin datos sensibles.
- Fase 8 — Tarea 3: APIs portal/staff de PDF y aceptación con same-origin, Zod estricto, `no-store`, URL presigned efímera y respuestas sin `storageKey`/hash.
- Fase 8 — Tarea 4: `ClientQuoteActions` integrado en el portal con descarga PDF, aceptación explícita, diálogo accesible, feedback de éxito/error, estado vencido/aceptado y responsive.
- Fase 8 — Tarea 5: endpoint de estado documental staff y `StaffQuoteDocumentPanel` integrados en el constructor; estados MISSING/PENDING/READY/FAILED/DELETED, descarga privada, generación condicionada, evidencia de aceptación y respuestas sin storage key/hash.
- Gate de Fase 8 cerrado: PDF determinista, aceptación transaccional, portal/staff, storage privado, auditoría/Outbox, regresión, accesibilidad, build y auditoría de dependencias verificados.
- Fase 9 — Tarea 1: contratos de canal email y estados `PENDING`/`PROCESSING`/`SENT`/`FAILED`/`CANCELLED`, con transiciones seguras y backoff inicial acotado.
- Fase 9 — Tarea 1: permisos `notifications.read`/`notifications.manage`, separados de identidad y operación comercial; ventas sólo puede leer y gerencia administrar.
- Fase 9 — Tarea 1: `NotificationDelivery` separado de Outbox, con destinatario cifrado, hash de deduplicación, template versionado, payload snapshot, lease/timestamps, proveedor y constraints de integridad.
- Fase 9 — Tarea 1: migraciones `20260908113957_notifications` y `20260908114000_notifications_invariants`, seed de schema versión 3 y clave `NOTIFICATION_RECIPIENT_ENCRYPTION_KEY` independiente de MFA/auth.
- Fase 9 — Tarea 1: pruebas de cifrado/hash/normalización/permisos 8/8 y persistencia PostgreSQL 1/1; typecheck, lint, schema, migraciones, seed y diff check verificados.
- Fase 9 — Tarea 2: allowlist de ocho eventos, validación de agregado/payload/visibilidad y `safePayload` separado de material transitorio de tokens.
- Fase 9 — Tarea 2: ocho templates v1 HTML/texto con escape, subjects seguros, URLs same-origin allowlisted, límites de contenido y copy sin prometer lectura del correo.
- Fase 9 — Tarea 2: proveedor `EmailProvider` SMTP reemplazable sobre Nodemailer 10.0.1, `disableFileAccess`/`disableUrlAccess`, configuración SMTP validada y errores de proveedor redacted.
- Fase 9 — Tarea 2: 13 pruebas unitarias dirigidas, typecheck, lint, auditoría de dependencias 0 y entrega real a Mailpit verificada/limpiada.
- Fase 9 — Tarea 3: claim concurrente PostgreSQL con `FOR UPDATE SKIP LOCKED`, batch acotado, lease recuperable y contador de intentos incrementado al reclamar.
- Fase 9 — Tarea 3: transición condicional por `deliveryId` + lease para evitar que un worker viejo sobrescriba el resultado de un worker recuperado; errores persistidos sólo como códigos controlados.
- Fase 9 — Tarea 3: reintentos con jitter acotado 80–120 %, máximo de intentos, clasificación temporal/permanente, comando one-shot, worker continuo con apagado limpio y diagnóstico operativo no sensible.
- Fase 9 — Tarea 3: migración `20260908120000_notifications_error_code_constraint` aplicada para cerrar en PostgreSQL la allowlist de códigos de error.

### En desarrollo

- Fase 9 — Tarea 4: integración de eventos transaccionales de auth, solicitudes, cotizaciones, aceptación, mensajería y archivos.

### Prototipo o incompletos para el producto comercial

- Contacto directo por correo/WhatsApp: canal informativo, todavía fuera del expediente persistido.

### Pendientes

- Arquitectura de aplicación comercial por dominios de negocio.
- Detalle completo del expediente y cotización versionada dentro del portal.
- Revisión legal de términos de PDF/aceptación.
- Integración de eventos transaccionales con destinatarios reales y fan-out por audiencia.
- Auditoría comercial y de seguridad.
- Dashboard y métricas.
- Hardening, backups, observabilidad y preparación para producción.

## Decisiones arquitectónicas vigentes

1. Mantener la web pública existente y su identidad visual.
2. Construir un monolito modular, no microservicios.
3. Mantener Next.js App Router como aplicación principal.
4. Usar PostgreSQL como fuente de verdad transaccional.
5. Separar marketing, portal de cliente y sistema interno mediante route groups y módulos de dominio.
6. Mantener sesiones privadas y autorización en backend; no usar el folio como autenticación.
7. Separar el folio comercial del identificador interno UUID/ULID.
8. Tratar las versiones enviadas o aceptadas como inmutables.
9. Guardar snapshots de precios, impuestos y conceptos dentro de cada versión de cotización.
10. Iniciar localmente con aplicación, PostgreSQL y Mailpit; agregar storage, worker, antivirus o Redis sólo cuando el módulo lo justifique.
11. Mantener WhatsApp y otros canales externos desacoplados del flujo principal.
12. No afirmar que la aceptación digital sustituye contratos formales sin revisión jurídica.
13. Mantener las transiciones dependientes de cotización cerradas en el inbox hasta que exista el módulo de cotizaciones.
14. Representar dinero con `BigInt` en unidad mínima y cantidades con escala fija de milésimas; porcentajes como basis points enteros.
15. Aplicar redondeo half-up explícito por línea para cantidad, descuento e impuesto; sumar los resultados de línea para los totales.
16. Permitir sólo códigos de moneda de tres letras normalizados en el dominio; la lista comercial definitiva de monedas queda pendiente de confirmación.
17. Congelar snapshots de dominio y persistirlos como datos históricos en la siguiente tarea; ninguna versión distinta de `BORRADOR` será editable.
18. Evitar solapamientos de precios con constraint PostgreSQL `EXCLUDE USING gist`; el servicio además resolverá la vigencia dentro de transacción.
19. Relacionar una cotización con solicitud y cliente mediante FK compuesto, además de FK directo al cliente.
20. Resolver precios dentro de transacción con bloqueo de solicitud/cotización; una carrera de creación de versión produce una sola versión ganadora.
21. La operación de envío de cotización y el cambio de estado de solicitud se auditan y publican como Outbox en la misma transacción.
22. Las mutaciones del catálogo y precios requieren sesión de empleado, permiso de escritura y same-origin; el frontend sólo refleja capacidades, nunca sustituye la autorización.
23. Los conceptos se archivan en lugar de eliminarse físicamente; los precios vigentes no pueden solaparse para la misma lista y concepto.
24. Los importes monetarios viajan por API como cadenas de unidades mínimas y se formatean con `BigInt` para evitar pérdida de precisión en la UI.
25. La UI interna de catálogo usa un espacio de trabajo denso de dos zonas, superficies planas, reglas y responsive apilado, consistente con la identidad OCPOOL y sin métricas decorativas.
26. Crear o modificar precios exige `quotes.edit_prices`; aplicar un descuento exige `quotes.apply_discount`; enviar una versión con descuento exige además `quotes.approve_discount`.
27. La API de cotizaciones serializa todas las unidades monetarias como cadenas antes de construir JSON; las vistas internas pueden calcular previews con `BigInt` sin confiar en los totales del navegador.
28. El constructor trabaja sobre una solicitud existente y una cotización raíz; cada cambio después de una versión enviada crea una nueva versión y nunca muta el histórico.
29. El portal cliente aplica el scope `clientId` en backend; el actor, no el request, define el cliente autorizado.
30. Las versiones `BORRADOR` no se exponen al cliente; el portal sólo presenta versiones enviadas o posteriores y una proyección sin actores internos ni notas operativas.
31. La resolución de sesión invalida a un cliente cuyo vínculo `Client` está archivado; un usuario cliente sin vínculo se conserva como actor para que cada guard de superficie responda 403 explícito sin convertirlo en una sesión inexistente.
32. Las fechas comerciales del portal se formatean en UTC porque `validUntil` representa una fecha de vigencia persistida, no la zona horaria local arbitraria del navegador.
33. Fase 6 usará una conversación única por `QuoteRequest`, con `clientId` redundante controlado para mantener scope e impedir cruces de expediente.
34. Los mensajes serán append-only y tendrán visibilidad explícita `CUSTOMER` o `INTERNAL`; una nota interna nunca se filtra por proyección, conteo, HTML, log ni Outbox.
35. Los eventos de mensajería publicarán sólo IDs, folio, visibilidad y metadatos mínimos en Outbox; el cuerpo se consultará desde PostgreSQL por el worker futuro.
36. `ConversationReadState` queda fuera del primer slice de Fase 6; no se implementará unread hasta tener contrato de producto, permisos y pruebas de avance monotónico.
37. Las mutaciones de conversación bloquean la fila de `QuoteRequest` antes de crear, cerrar, reabrir o escribir mensajes; esto serializa reintentos concurrentes por expediente y mantiene el scope compuesto request+cliente.
38. La paginación del hilo usa cursor opaco basado en `(createdAt, id)` y orden ascendente estable; la primera entrega prioriza continuidad y consistencia antes de agregar unread.
39. La UI cliente consume una proyección mínima `CUSTOMER`, deriva la etiqueta de autor desde el tipo de remitente y nunca modela campos internos; la visibilidad sigue siendo una decisión de backend.
40. Las pruebas de integración PostgreSQL se ejecutan con un worker en el comando oficial para privilegiar reproducibilidad y evitar timeouts de transacción en laptops con recursos compartidos; la concurrencia de negocio continúa cubierta dentro de las pruebas de servicio.
41. La UI staff recibe capacidades booleanas derivadas de sesión y oculta acciones no autorizadas, pero nunca usa esas capacidades como autorización; cada mutación sigue validándose en backend.
42. El staff usa vistas segmentadas por `visibility` y compositores distintos; una nota interna nunca se envía al endpoint compartido ni se oculta sólo con CSS.
43. El timeout de `webServer` de Playwright es de 600 segundos porque el build frío local puede superar dos minutos bajo carga; el timeout de cada assertion conserva el límite normal de Playwright.
44. La paleta staff usa variantes de cobre y texto muted con contraste suficiente, y los controles de operación tienen nombres accesibles explícitos; esto prioriza Axe y lectura real sobre conservar valores decorativos de bajo contraste.
45. El cierre de Fase 6 exige validar capacidades en backend aun cuando la UI las oculte; la matriz final confirma que un rol limitado no puede cerrar ni reabrir conversaciones y que las respuestas no devuelven claves de idempotencia.
46. El Outbox de mensajería permanece preparado para un worker futuro, pero no se agrega Redis ni un worker productivo antes de que archivos/notificaciones definan sus garantías de entrega y reintento.
47. Los archivos se separan en `StorageObject` y `FileAttachment`: el primero representa bytes privados y el segundo su relación con expediente, cliente, categoría y visibilidad.
48. MinIO será el storage S3-compatible local para probar el contrato real de objetos privados; el dominio no dependerá de SDKs ni de rutas físicas y el bucket nunca será público.
49. El servidor no entregará archivos que no estén en `AVAILABLE`; la validación local de firma/tipo no se presentará como antivirus productivo, y ese proveedor será un gate explícito de salida.
50. Los adjuntos de mensajes quedan fuera de Fase 7 para no mezclar dos superficies de visibilidad; primero se estabiliza el ciclo de vida del archivo por expediente.
51. La primera persistencia separa `scanStatus` del storage y `status` del adjunto: un objeto puede estar validado físicamente mientras el vínculo comercial conserva su ciclo de vida y borrado lógico.
52. El upload usa reserva DB idempotente por `(uploadedById, reservationKeyHash)` y expiración explícita; una URL presigned es sólo transporte temporal, nunca autorización.
53. El bucket MinIO/S3 es privado y la aplicación valida HEAD, bytes, firma y hash antes de marcar `AVAILABLE`; el scanner básico no se presenta como antivirus.
54. El listado de archivos valida la existencia y scope del expediente antes de devolver una colección, para no convertir un expediente ajeno en un 200 vacío enumerables.
55. La API separa reserva/finalización: una URL presigned sirve sólo para transportar bytes durante minutos; la autorización de lectura se vuelve a ejecutar al descargar y no se conserva en el frontend como permiso.
56. La UI cliente muestra únicamente una proyección operativa del archivo; valida experiencia y formato para feedback inmediato, pero reserva, análisis, scope, descarga y borrado siguen siendo decisiones de backend.
57. La UI staff separa `CUSTOMER` e `INTERNAL` en tabs accesibles y deriva controles de carga/borrado desde capacidades, manteniendo la autorización real en cada endpoint.
58. Fase 7 queda cerrada con scanner local explícitamente limitado: antivirus productivo, cuarentena, backups/restauración de objetos y retención no se ocultan como completados y quedan en hardening/operación.
59. Los PDFs comerciales se modelan como `GeneratedDocument`, no como `FileAttachment`, porque son artefactos de sistema derivados de un snapshot y requieren ciclo de vida, hash y regeneración controlada propios.
60. La relación documento/versiones usa FK compuesto `(quoteVersionId, quoteId)` y `quote_versions(id, quoteId)` único para impedir que un UUID válido se vincule a otra cotización por manipulación de alcance.
61. Un PDF sólo puede exponerse como `READY` cuando tiene objeto privado, tamaño, hash y timestamp de disponibilidad; PostgreSQL conserva esta garantía además del servicio.
62. `QuoteAcceptance` guarda el hash del PDF aceptado, versión de términos, nombre normalizado y fingerprints opcionales; no almacena claves de idempotencia, IP ni user-agent crudos.
63. La primera versión de aceptación comercial es evidencia auditable de intención dentro de OCPOOL y no se presenta como firma electrónica avanzada sin revisión jurídica y proveedor especializado.
64. El renderer PDF será determinista y server-side con `pdf-lib`; el cliente nunca decide totales, contenido, storage key ni bytes del documento.
65. La primera plantilla usa fuentes PDF estándar para evitar artefactos WOFF no portables; la calidad visual se controla desde composición, color, ritmo y QA rasterizado.
66. La aceptación de cliente sólo puede operar sobre `Quote.currentVersionId`; no se acepta una versión histórica aunque su PDF siga disponible para lectura.
67. El lock de aceptación se toma sobre cotización y solicitud antes de crear evidencia; la clave única `(acceptedById, idempotencyKeyHash)` permite replay exacto y la unicidad por versión impide doble aceptación con claves distintas.
68. La URL de descarga se emite sólo después de validar DB + HEAD del objeto privado, con expiración de 60 segundos y auditoría; el portal recibe metadata mínima y nunca una storage key.
69. La ruta staff de generación requiere `{}` con schema estricto, para que incluso regeneraciones mantengan contrato JSON y protección same-origin uniforme.
70. El portal muestra el éxito de aceptación antes de refrescar el expediente; el refresh ocurre al pulsar `Continuar`, evitando que un remount borre el feedback de una acción irreversible.
71. La descarga cliente abre únicamente la URL presigned retornada por backend; el frontend no construye keys ni intenta leer bytes del PDF.
72. El diálogo de aceptación usa nombre y checkbox explícitos, pero no se presenta como firma electrónica avanzada; el copy mantiene la revisión jurídica pendiente visible en riesgos.
73. El estado operativo staff se separa de la descarga: puede mostrar `MISSING`/`PENDING`/`FAILED` sin convertir un 409 de disponibilidad en un estado ambiguo; la descarga continúa validando DB + HEAD antes de emitir URL.
74. La interfaz sólo ofrece generar/reintentar cuando el documento falta o falló; un documento `READY` se conserva como artefacto inmutable y el backend devuelve el existente sin reemplazarlo.
75. La evidencia de aceptación visible para staff se limita a firmante, versión de términos y fecha; hashes, fingerprints, storage keys y códigos de fallo permanecen en backend/auditoría.
76. Fase 9 separa `NotificationDelivery` de `OutboxEvent`: un evento puede generar varios destinatarios y cada entrega necesita retry/lease/provider propios sin mutar el agregado comercial.
77. El primer canal de Fase 9 será email con Mailpit y adaptador SMTP; PostgreSQL gestionará claims y leases, y Redis/broker se reconsiderará sólo con evidencia de volumen o contención.
78. Los eventos no soportados se cancelan como intención de notificación con causa controlada; nunca se renderizan por inferencia ni se pasa el JSON completo de Outbox a templates.
79. `SENT` significará aceptación del adaptador/proveedor, no lectura del correo; el portal y el expediente seguirán siendo la fuente de verdad.
80. Los destinatarios de notificación tendrán una clave de cifrado independiente de MFA y tokens de autenticación; la base conserva hash para deduplicar y ciphertext para reintentar sin exponer correo crudo.
81. `NotificationDelivery` será una intención de entrega versionada y no una copia mutable del Outbox; la unicidad incluirá evento, canal, destinatario hash, template y versión.
82. Los mappers y templates de notificaciones se implementarán con allowlist explícita en la siguiente tarea; ningún evento desconocido podrá inferirse desde JSON arbitrario.
83. PostgreSQL conserva invariantes de intentos, hash, claves de template, snapshot cifrado y evidencia de procesamiento; Prisma no será la única capa de integridad.
84. El mapper valida el `aggregateType` esperado por cada evento y mantiene una allowlist explícita; un JSON válido con agregado incorrecto queda rechazado.
85. Los datos enriquecidos por el worker tienen límites de longitud y controles antes de persistirse/renderizarse; los tokens cifrados sólo viajan como material transitorio y nunca como `safePayload`.
86. El proveedor SMTP usa Nodemailer 10.0.1 sin `raw`, archivos ni URLs del mensaje y con `disableFileAccess`/`disableUrlAccess`; la configuración de Mailpit no se mezcla con el contrato de negocio.
87. PostgreSQL es el coordinador de claims de notificaciones en esta escala: cada batch usa `FOR UPDATE SKIP LOCKED`, y un `PROCESSING` cuyo lease expiró puede recuperarse sin introducir Redis prematuramente.
88. El worker incrementa `attempts` al reclamar y sólo completa o falla una entrega si conserva el mismo lease; esto evita que un worker tardío sobrescriba el resultado de otro que recuperó el trabajo.
89. Los reintentos usan jitter acotado 80–120 %, backoff exponencial con máximo de una hora y máximo de intentos configurable; una entrega permanente termina en `FAILED` operable y no se reintenta indefinidamente.
90. El worker descifra destinatarios y tokens únicamente en memoria durante el envío; los logs, payloads seguros, estados operativos y códigos de error no contienen correo crudo, tokens ni respuestas completas del proveedor.
91. La operación local se expone en dos modos: one-shot para jobs controlados y continuo con `SIGINT`/`SIGTERM`; ambos reutilizan el mismo servicio transaccional y no cambian el resultado del agregado comercial.

## Pruebas realizadas

Gate final ejecutado después de instalación limpia de dependencias:

- `npm ci --no-audit --fund=false --foreground-scripts` — correcto; se recuperó previamente un conflicto Windows `ENOTEMPTY` moviendo sólo directorios generados de `node_modules`, sin tocar código ni datos.
- `npm run db:up` — PostgreSQL y Mailpit activos.
- `npm run db:validate` — schema válido.
- `npm run db:generate` — cliente Prisma 7.10.0 generado.
- `npm run db:migrate:deploy` — sin migraciones pendientes.
- `npm run db:seed` — correcto e idempotente.
- `npm test` — correcto en el estado final: typecheck, 29 unitarias, 9 integraciones PostgreSQL, contrato de contenido, build, 29 E2E públicos con 2 omitidas explícitamente y 1 E2E foundation dedicado.
- Tras Tarea 1 de Fase 3: `npm run test:unit` 34/34, `npm run test:integration` 9/9, `npm run typecheck` y `npm run lint` correctos.
- Tras Tarea 2 de Fase 3: `npm run test:integration` 10/10, `npm run db:validate`, `npm run db:generate`, migración aplicada/inspeccionada, `npm run db:seed`, `npm run typecheck` y `npm run lint` correctos.
- Tras Tarea 3 de Fase 3: prueba dirigida del servicio 2/2 y `npm run test:integration` 12/12; incluye concurrencia de folios, replay idempotente, agregado atómico, historial, auditoría y Outbox.
- Tras Tarea 4 de Fase 3: `npm run test:integration` 14/14, prueba E2E dirigida del formulario 1/1 y `npm run build`, `npm run typecheck` y `npm run lint` correctos; la suite pública valida API, responsive, accesibilidad, consola y folio.
- Gate final de Fase 3: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy` sin pendientes, `npm run db:seed` idempotente, `npm run test:unit` 35/35, `npm run test:integration` 20/20, `npm run test:content`, `npm run build`, E2E pública 31/31 con 2 omitidas explícitamente, foundation E2E 1/1 y auth E2E 1/1.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilidades después de fijar `deepmerge-ts@8.0.2` y `mysql2@3.24.3` mediante overrides compatibles con Prisma 7.10.0.
- `npm run lint` — correcto.
- `npm run test:e2e:auth` — 1 flujo correcto: fixture desechable, login, sesión, rechazo de logout foreign-origin y logout.
- `npm run test:content` — correcto.
- `npx tsc --noEmit` / `npm run typecheck` — correctos, incluyendo los tipos de las pruebas Playwright y Vitest.
- Revisión independiente de seguridad — sin hallazgos Critical/Important bloqueantes después de corregir rate limit sin IP, body chunked, retorno temprano antes de Argon2 y circuit breaker condicionado por IP confiable.
- `git diff --check` — correcto.
- Tarea 1 de Fase 4: prueba roja inicial de contrato, después `npm run test:unit` 41/41, `npm run test:integration` 20/20, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Tarea 2 de Fase 4: migración `20260908032000_catalog_quotes`, `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npx prisma migrate status`, `npm run db:seed`, schema dirigido 3/3, integración completa 23/23, typecheck, lint y `git diff --check` correctos.
- Tarea 3 de Fase 4: `npm run test:integration` 25/25, `npm run test:unit` 41/41, `npm run typecheck`, `npm run lint` y `git diff --check` correctos; se verificaron snapshots históricos, permisos, edición de borrador, transición de envío, aceptación bloqueada, concurrencia y limpieza de fixtures.
- Tarea 4 de Fase 4: commit `861e4d8` (`feat: add protected catalog and price operations`); `npm run test:integration` 28/28, `npm run test:unit` 41/41, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` 32/32 ejecutadas con 2 omitidas explícitamente y `git diff --check` correctos. Se verificaron 401/403, same-origin, archivado, precios solapados, permisos de ventas/gerencia, UI restringida sin sesión y formato monetario sin floats.
- Tarea 5 de Fase 4: commit `2909b62` (`feat: add protected quote builder workflow`); `npm run test:integration` 30/30, `npm run test:unit` 41/41, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` 33/33 ejecutadas con 3 omitidas explícitamente y `git diff --check` correctos. La prueba opt-in `QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts` pasó 1/1 con login real, selección de expediente, creación de borrador, revisión y envío. Se verificaron serialización BigInt, 401/403, same-origin, IDOR por expediente inexistente, permisos de edición/descuento/aprobación, inmutabilidad post-envío y actualización atómica de la solicitud.
- Gate de Fase 4: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npx prisma migrate status`, `npm audit --omit=dev --audit-level=high` (0 vulnerabilidades) y `npm test` correctos. `npm test` quedó en typecheck, 41 unitarias, 30 integraciones, contrato de contenido, build, 33 E2E ejecutadas con 3 omitidas explícitamente y foundation 1/1. La primera ejecución tuvo una condición temporal de artefacto `.next` al encadenar dos servidores en Windows; la reproducción aislada y la repetición completa pasaron sin cambiar código productivo.
- Tarea 1 de Fase 5: commit `17a50e9` (`feat: add scoped client portal read service`); `npm run typecheck`, unit test dirigido 1/1, integración dirigida 1/1 y `git diff --check` correctos. Se verificaron scope por cliente, rechazo de empleado, cliente cruzado como `NOT_FOUND`, ocultamiento de borradores/actores internos y serialización de importes grandes sin `number`.
- Tarea 2 de Fase 5: commit `76214bd` (`feat: expose scoped client portal APIs`); `npm run typecheck`, `npm run lint`, integración API dirigida 1/1 y `git diff --check` correctos. Se verificaron 401 sin sesión, 403 empleado, cliente propio, cliente cruzado, cotización cruzada, UUIDs seguros, `cache-control: no-store` y respuestas sin token/hash.
- Tarea 3 de Fase 5: commit `0d90fc9` (`feat: add customer portal dashboard`); `npm run typecheck`, `npm run lint`, E2E dirigida `npx playwright test tests/quality.spec.ts --grep "customer portal"` 1/1 y `git diff --check` correctos. Se verificaron acceso restringido sin sesión, Axe sin violaciones serias, ausencia de overflow a 390 px, metadata privada, estados de carga/vacío/error/logout y shell responsive propio del cliente.
- Tarea 4 de Fase 5: commit `c0da91e` (`feat: show customer quote snapshots`); integración dirigida, API dirigida, `npm run typecheck`, `npm run lint`, E2E de protección y `git diff --check` correctos. Se verificó que actualizar catálogo después del envío no altera nombre, precio, impuesto ni total del snapshot mostrado al cliente; la vista comunica vigencia expirada sin habilitar acciones fuera de alcance.
- Tarea 5 de Fase 5: pendiente de commit en este cierre; `npm run test:unit` 42/42, `npm run test:integration` 32/32, `npm run typecheck`, `npm run lint`, E2E opt-in `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2 y `git diff --check` correctos. Se verificaron sesiones revocadas/archivadas, aislamiento por cliente, UUID malformado, payloads sin secretos, Axe, estado vacío, error recuperable, consola limpia y responsive móvil.
- Tarea 5 de Fase 5: commit `af55a09` (`test: harden customer portal isolation`); `npm run test:unit` 42/42, `npm run test:integration` 32/32, `npm run typecheck`, `npm run lint`, E2E opt-in `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2 y `git diff --check` correctos. Se verificaron sesiones revocadas/archivadas, aislamiento por cliente, UUID malformado, payloads sin secretos, Axe, estado vacío, error recuperable, consola limpia y responsive móvil.
- Gate de Fase 5: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npx prisma migrate status`, `npm test`, `npm audit --omit=dev --audit-level=high` (0 vulnerabilidades) y árbol limpio correctos. `npm test` quedó en 42 unitarias, 32 integraciones, contenido, build, 34 E2E públicas con 5 omitidas explícitamente y foundation 1/1.
- Tarea 2 de Fase 6: prueba dirigida `messaging-service.test.ts` 1/1 y `npm run test:integration` 34/34; `npm run typecheck`, `npm run lint` y `git diff --check` correctos. Se verificaron dos clientes aislados, permisos de empleado, nota interna fuera de proyección cliente, idempotencia secuencial y concurrente, rate-limit injectable, cierre/reapertura y Outbox/auditoría sin cuerpos.
- Tarea 3 de Fase 6: commit `8446663` (`feat: expose protected messaging APIs`); prueba API `messaging-api.test.ts` 3/3 y `npm run test:integration` 37/37; `npm run typecheck`, `npm run lint` y `git diff --check` correctos. Se verificaron 401/403/404/409/429, scope IDOR, same-origin, schemas estrictos, `no-store`, RBAC limitado y ausencia de notas/IDs internos en portal.
- Tarea 4 de Fase 6: implementación y cierre documental de UI cliente; E2E opt-in `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2, `npm run test:unit` 45/45, `npm run test:integration` 37/37 serializado, `npm run test:e2e` 34/34 ejecutadas con 5 omitidas explícitamente, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:content` y `git diff --check` correctos. Se verificaron lectura/envío/refresh, notas internas invisibles, cierre de conversación, error recuperable, responsive, Axe, consola limpia y payload cliente mínimo.
- Tarea 5 de Fase 6: commits `09d979f`, `f2b0e4b` y `9eb9a04`; E2E opt-in `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` 2/2, `messaging-api.test.ts` 4/4, `npm run test:unit` 45/45, `npm run test:integration` 38/38, `npm run test:e2e` 34/34 ejecutadas con 7 omitidas explícitamente, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:content`, migraciones/seed, `npm audit --omit=dev --audit-level=high` (0) y `git diff --check` correctos. Se verificaron separación de visibilidades, dos perfiles RBAC, compositores independientes, cierre/reapertura, Axe, consola y no overflow.
- Tarea 6 de Fase 6: commit `6e1037c` (`test: harden messaging security matrix`) más cierre documental; API `messaging-api.test.ts` 4/4 con negative checks finales, E2E cliente 2/2, staff 2/2, auth 1/1 y constructor 1/1. Gate `npm test` 45 unitarias, 38 integraciones, contenido, build, 34 E2E públicas ejecutadas con 7 omitidas explícitamente y foundation 1/1; `npm run db:validate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npm audit --omit=dev --audit-level=high` (0) y `git diff --check` correctos. Se verificaron IDOR, sesión/RBAC, same-origin, rate limit, idempotencia concurrente, cierre, UUID inválido, Axe, responsive, consola, cleanup y ausencia de cuerpos sensibles en HTML/payloads/logs/Outbox.
- Fase 7 — planificación: especificación `docs/superpowers/specs/2026-09-08-ocpool-private-files.md` y plan `docs/superpowers/plans/2026-09-08-ocpool-private-files.md` creados y revisados; aún no cuenta como evidencia de implementación ni como fase terminada.
- Fase 7 — Tarea 1: prueba dirigida de dominio 6/6, schema 1/1, migración aplicada, Prisma validate/generate, seed, typecheck, lint y diff check correctos. No se agregaron dependencias ni servicios externos.
- Fase 7 — Tarea 2: scanner 3/3, servicio transaccional 3/3, storage MinIO 1/1, unitarias completas 54/54, typecheck/lint, Compose y auditoría de dependencias correctos. Se verificaron replay/concurrencia, rechazo por firma, expiración, cleanup, soft delete, URL efímera y no exposición de keys/bytes.
- Fase 7 — Tarea 3: `private-files-api.test.ts` 4/4, typecheck y lint dirigidos correctos. Se verificaron 401/403/404, cliente cruzado, same-origin, Zod estricto, upload/complete/download/delete, visibilidad interna, rol limitado, rate limit, no-store y ausencia de storage keys en proyecciones.
- Fase 7 — Tarea 4: `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` pasó 2/2 con carga real a MinIO, finalización, disponibilidad, persistencia tras recarga y descarga; Axe, consola, no overflow y logout correctos. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 7 — Tarea 5: `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` pasó 2/2 con carga staff real, validación, borrado confirmado, descarga, separación compartido/interno, aislamiento de rol limitado, Axe, consola y no overflow. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 7 — Tarea 6/gate: 54 unitarias, 47 integraciones, contenido, build, 34 E2E públicas con 7 omitidas explícitamente, foundation 1/1, portal 2/2, staff 2/2, migraciones/seed/auditoría de dependencias y Compose saludables. Árbol limpio y diff check correctos.
- Fase 8 — Tarea 1: prueba roja inicial del dominio; después `npm run test:unit` 57/57, `npm run typecheck`, `npm run db:validate`, `npm run db:generate`, migración aplicada y prueba de persistencia `quote-documents-schema.test.ts` 1/1. Se verificaron estados, elegibilidad, normalización, documentos READY incompletos, duplicados, hashes y aceptación vinculada.
- Fase 8 — Tarea 2: `quote-pdf-renderer.test.ts` 3/3, `quote-pdf-service.test.ts` 1/1, `npm run typecheck`, fixture generado de 2 páginas, `pdftoppm` sin errores de fuente invalidante, `pdfinfo` metadata estable y `pypdf` con folio/resumen/total presentes y texto interno ausente.
- Fase 8 — Tarea 3: `quote-acceptance-service.test.ts` 1/1 y `quote-documents-api.test.ts` 2/2 dirigidas; se verificaron aceptación concurrente con un ganador, replay, PDF READY/hash/HEAD, scope cruzado, 401/403/404/409, CSRF, schema estricto, permisos, no-store y no exposición de storage key/hash. `npm run typecheck` y `npm run lint` correctos.
- Fase 8 — Tarea 4: `npx cross-env PORTAL_E2E=1 playwright test tests/client-portal.spec.ts` pasó 2/2; se verificaron descarga PDF, popup/API presigned, validación negativa del checkbox, diálogo accesible, aceptación, refresh, mensajería persistida, archivos, Axe, consola limpia y responsive móvil. `npm run typecheck` y `npm run lint` correctos.
- Fase 8 — Tarea 5: `quote-documents-api.test.ts` pasó 2/2 con estado `MISSING`/`READY`, cliente bloqueado, acciones condicionadas, evidencia post-aceptación y ausencia de `storageKey`/`sha256`; `npx cross-env QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts` pasó 1/1 con generación real en MinIO, descarga presigned, Axe, consola limpia, payload mínimo y no overflow desktop/móvil. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 9 — Tarea 1: prueba roja inicial de contratos; `tests/unit/notifications-domain.test.ts` y `tests/unit/env.test.ts` pasaron 8/8; `notifications-schema.test.ts` pasó 1/1 contra PostgreSQL con duplicados, hash inválido, destinatario sin cifrado y estados incompletos rechazados. `npm run db:validate`, `npx prisma migrate status`, `npm run db:seed`, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 9 — Tarea 2: pruebas rojas de templates/provider, después `notifications-templates.test.ts`, `email-provider.test.ts` y `env.test.ts` 13/13; se verificaron ocho templates, escape HTML/texto, scope interno, agregado incorrecto, tamaños, URL allowlist, header injection y credentials SMTP. Nodemailer 10.0.1 pasó `npm audit --omit=dev --audit-level=high` con 0; Mailpit aceptó un mensaje real con from/reply-to correctos y el fixture fue eliminado.
- Fase 9 — Tarea 3: pruebas dirigidas de dispatcher/worker/esquema 3/3 y unitarias 8/8; se verificaron upsert idempotente, carrera de dos workers, recuperación de lease, transición condicional, envío exitoso, retry temporal, fallo terminal por máximo de intentos y códigos de error controlados.
- Gate técnico de Tarea 3: `npm run test:unit` 77/77, `npm run test:integration` 55/55 serializado, `npm run db:validate`, `npx prisma migrate status` con 15 migraciones al día, `npm run db:seed`, `npm run worker:notifications:once` sin pendientes, `npm run typecheck`, `npm run lint`, `git diff --check` y `npm audit --omit=dev --audit-level=high` con 0 vulnerabilidades.

La suite E2E completa descubre 41 pruebas: auth, foundation, portal, mensajería staff y cotizaciones staff se omiten en el comando normal para no exigir fixtures/infraestructura; todas fueron validadas de forma dedicada en el gate.

## Pruebas pendientes

- Pruebas unitarias restantes de servicios comerciales y reglas persistidas.
- Pruebas de IDOR sobre clientes, solicitudes, expedientes y futuras cotizaciones.
- E2E cliente y empleado de los flujos comerciales.
- Pruebas finales de archivos privados: staff, seguridad de fase, URLs temporales, cleanup y proveedor antivirus productivo.
- Pruebas de snapshots e inmutabilidad.
- Pruebas de cálculo de cotizaciones.
- Pruebas por evento de notificaciones, resolución de destinatarios y fan-out desde Outbox.
- Pruebas del worker continuo bajo apagado, recuperación y proveedor no disponible.
- Pruebas de carga y restauración de backups.

## Riesgos abiertos

- Reglas de moneda, IVA, descuentos y redondeos aún no confirmadas.
- Alcance de datos por ejecutivo, sucursal o zona aún no confirmado.
- Proveedor de correo transaccional de producción aún no seleccionado.
- Política de retención y eliminación de datos personales pendiente de revisión formal.
- Requisitos legales de aceptación y evidencia pendientes de revisión jurídica.
- Destino de despliegue de producción aún no definido.
- La protección por IP requiere `TRUST_PROXY_HEADERS=true` sólo detrás de un proxy confiable que sobrescriba la IP. Sin IP confiable, el backend usa límites por identificador y un circuit breaker global separado; el proxy de producción debe aportar rate limiting por origen.
- La infraestructura de identidad ya está expuesta por endpoints y escribe Outbox, pero el worker SMTP que entrega esos eventos pertenece a la siguiente etapa de mensajería.
- El Outbox de mensajería está listo como contrato transaccional, pero la entrega asíncrona y sus reintentos siguen pendientes de la fase de notificaciones; no se considera una omisión del cierre de Fase 6.
- El scanner local de Fase 7 validará firma y tipo, pero no sustituirá antivirus; antes de producción deberá existir proveedor, política de cuarentena, pruebas de evasión y operación de reintentos.
- MinIO local está incorporado al Compose con credenciales de desarrollo; producción deberá reemplazarlas mediante secretos y política de bucket privada.
- El scanner local sólo valida firma/tipo/hash; proveedor antivirus productivo, cuarentena operacional, backups y restauración de objetos siguen pendientes de hardening.
- La aceptación backend, portal y staff ya están operativos y protegidos; el lanzamiento todavía requiere revisión legal de términos, política de firma, notificaciones productivas, retención y gate de producción.
- Puede existir una diferencia temporal residual entre cuentas existentes e inexistentes en solicitudes de link/recovery; no hay enumeración en respuesta ni payload.

## Deuda técnica conocida

- El portal ya tiene shell y dashboard; todavía faltan detalle versionado completo, mensajería, archivos y aceptación digital.
- El endpoint de contacto actual no debe considerarse backend comercial.
- El timestamp de la migración foundation es el generado por Prisma en la ejecución local (`20260907231807_foundation`); no se renombró después de aplicarlo para no desalinear el historial de migraciones.
- Las versiones transitorias de Prisma están fijadas en `package.json` para mantener la auditoría limpia; deben revisarse cuando Prisma publique una actualización estable que incorpore esas versiones de forma nativa.
- La migración de documentos reutiliza el prefijo privado de objetos existente; si producción separa buckets o proveedores, deberá conservarse la misma política de privacidad y verificarse el contrato de migración.
- La plantilla comercial usa fuentes PDF estándar por compatibilidad; si diseño requiere una fuente de marca embebida, deberá incorporarse en formato TTF/OTF válido y repetir el gate de visores Poppler, navegador y extracción.

## Dependencias entre módulos

- `src/server/env.ts` es dependencia de Prisma, seed y runtime del servidor.
- Docker Compose debe proporcionar PostgreSQL antes de migraciones, integración y health E2E.
- Prisma schema/migraciones son dependencia de cualquier módulo comercial con persistencia.
- Logger y errores HTTP son dependencias transversales de las futuras APIs.
- La separación Playwright/Vitest protege la regresión de landing mientras crece el backend.
- Fase 2 (identidad/RBAC) debe preceder a expedientes, cotizaciones y portal porque todos requieren autorización backend.
- Las rutas de autenticación dependerán de `sessions.ts`, `tokens.ts`, `mfa.ts`, `rate-limit.ts`, `permissions.ts`, el logger y el envelope de errores.
- Los contratos de `src/server/modules/quotes/domain.ts` son dependencia de schema, servicio de precios, snapshots persistidos y constructor.
- El schema de Fase 4 y la migración son dependencia del servicio de resolución de precios y creación de versiones.
- El servicio de `src/server/modules/quotes/service.ts` es dependencia de las APIs internas y del constructor operativo.
- El servicio y las rutas de `src/server/modules/catalog/` son dependencia del selector de conceptos, listas y precios del constructor.
- Fase 5 depende de sesiones/actor de cliente de Fase 2, solicitudes de Fase 3 y snapshots/versiones de Fase 4.
- Fase 6 depende de sesiones/RBAC de Fase 2, scope de solicitudes de Fase 3, Outbox/auditoría transaccional y portal de cliente de Fase 5.
- Fase 8 depende de snapshots/versiones de cotización de Fase 4, portal/sesiones de Fase 5, storage privado de Fase 7 y del contrato PDF/aceptación de Tareas 1–3 antes de la UI cliente.
- Fase 8 Tarea 5 depende de las APIs de documento/aceptación de Tarea 3 y del workspace staff de cotizaciones; no puede inferir evidencia desde el portal cliente.
- Fase 9 dependerá del Outbox transaccional de identidad, solicitudes, cotizaciones, mensajería y aceptación; el canal de entrega no podrá cambiar el resultado de la transacción comercial.
- Fase 9 Tarea 2 dependió de los contratos/persistencia de `NotificationDelivery`, `readServerEnv()` y el Outbox transaccional; Tarea 3 consumió sus mappers, templates y provider.
- Fase 9 Tarea 3 dejó disponible el dispatcher, el fan-out idempotente, los estados, leases, intentos, proveedor, payloads safe y diagnóstico; Tarea 4 consume ese contrato para resolver destinatarios reales por evento y Tarea 5 expondrá la operación staff.

## Problemas encontrados y resolución

- Vitest 5 exigía tipos Node 22; se actualizó `@types/node` al rango compatible con Node 22.14.
- Playwright descubría pruebas unitarias `.test.ts`; se limitó el patrón E2E a `*.spec.ts`.
- Vitest no cargaba `.env` en integración; se añadió `tests/setup-env.ts`.
- El guard de migraciones no cargaba `.env`; se añadió `dotenv/config` y una prueba de contrato.
- La primera prueba E2E pública tuvo un timeout intermitente en overflow horizontal; la repetición posterior con la configuración corregida terminó en 29/29.
- El wrapper npm para argumentos Prisma eliminó `--name`; se usó el CLI directo y se conservó el timestamp generado para no renombrar una migración aplicada.
- Next.js no acepta el enum ambient de `@node-rs/argon2` con `isolatedModules`; se usó el valor estable `2` para Argon2id y se verificó con build y pruebas.
- La revisión de seguridad detectó reutilización de la clave MFA, tokens de recovery paralelos y carrera de sesión; se separó `AUTH_DELIVERY_ENCRYPTION_KEY`, se invalidan recovery tokens pendientes y la resolución de sesión usa actualización condicional atómica.
- La revisión posterior detectó y corrigió bloqueo global por `unknown-client`, lectura tardía de bodies chunked, hashing Argon2 antes del rate limit y aplicación excesiva del circuit breaker; cada corrección quedó cubierta por pruebas unitarias o de integración.
- El E2E de producción local inicialmente no reenviaba cookies `Secure` sobre HTTP; se mantuvo `Secure` y la prueba valida atributos y transporta explícitamente el valor opaco para probar la API.
- La primera compuerta final encontró contaminación de buckets sintéticos entre ejecuciones; el test de API ahora limpia únicamente sus hashes de fixture y quedó estable en la repetición completa.
- La prueba del seed asumía que el contador de folios siempre era `1`; se corrigió para verificar que el seed sea idempotente y preserve secuencias ya consumidas.
- El typecheck conservó referencias generadas al endpoint legado después de retirarlo; el build de producción regeneró `.next` y confirmó el árbol de rutas final sin `send-email`.
- La ejecución paralela de integración expuso aserciones frágiles sobre folios y buckets de rate limit; se corrigieron para tolerar concurrencia controlada y limpiar únicamente fixtures identificables.
- La ejecución paralela completa de integración volvió a provocar timeouts de inicio de transacción y cascadas de cleanup con fixtures aún no creados; la corrida serializada pasó 18/18 archivos y 37/37 pruebas, y el script oficial quedó fijado a `--maxWorkers=1`.
- La primera regresión E2E completa tuvo dos timeouts de cierre del contexto bajo carga; ambos casos pasaron aislados y la segunda regresión completa terminó 34/34, sin cambios productivos derivados de ese falso negativo.
- La primera E2E staff encontró que el estado de cierre se devolvía plano mientras el componente esperaba una propiedad `conversation`; se corrigió el mapeo y se añadió una prueba que valida que el composer desaparece al cerrar.
- La primera E2E de archivos encontró selectores ambiguos porque el nombre del archivo también aparece en la acción de descarga; se ajustaron los asserts a nombres exactos y Axe detectó un contraste insuficiente en el distintivo `PDF`, corregido antes de cerrar Tarea 4. En Tarea 5, Axe detectó un `<ul role="tabpanel">` inválido; se separó el contenedor ARIA del listado.
- La primera E2E de aceptación abrió el popup en `about:blank` antes de navegar al PDF; la aserción se trasladó a la respuesta API y se mantuvo el popup sólo como verificación de apertura. El primer flujo de éxito remonteaba el componente antes de mostrar confirmación; el refresh del expediente se movió a `Continuar`. Finalmente, la prueba de mensajería esperaba un mensaje optimista antes de que el fetch terminara; se añadió polling de persistencia DB antes de recargar.
- Axe del inbox staff detectó contraste bajo y selects sin nombre; se corrigieron variables de color y `aria-label` explícitos, y la E2E staff volvió a pasar 2/2.
- La primera E2E del constructor con PDF encontró un selector ambiguo por el `role=status` del estado de carga documental; se acotaron los asserts al aviso principal. La misma revisión Axe detectó contraste insuficiente en fechas del historial y un selector sin nombre; se corrigieron color y `aria-label`, y la repetición pasó 1/1 en desktop y móvil.
- La primera E2E del constructor con PDF encontró un selector ambiguo por el `role=status` del estado de carga documental; se acotaron los asserts al aviso principal. La misma revisión Axe detectó contraste insuficiente en fechas del historial y un selector sin nombre; se corrigieron color y `aria-label`, y la repetición pasó 1/1 en desktop y móvil.
- El cold build local agotó el timeout original de 120 segundos al iniciar Playwright; se amplió sólo `webServer.timeout` a 600 segundos y el build explícito terminó correctamente.
- El gate de seguridad encontró vulnerabilidades transitorias de Prisma; se resolvieron con overrides verificables y se repitió la suite completa antes de cerrar Fase 3.
- `npx tsc --noEmit` encontró tipos incompletos en pruebas existentes; se corrigieron sin relajar `strict`.
- La primera ejecución dirigida de la integración de notificaciones omitió `RUN_DB_TESTS=1` y falló por el guard de entorno; se repitió con el script oficial y pasó 1/1, sin cambio productivo asociado.
- Nodemailer 7 introducía vulnerabilidades altas conocidas en la auditoría de dependencias; se actualizó a Nodemailer 10.0.1, se conservaron sólo opciones SMTP controladas y se deshabilitaron accesos a archivos/URLs del mensaje.
- La primera verificación del proveedor con `tsx -e` usó await de nivel superior en salida CommonJS; se repitió con una IIFE async y la entrega a Mailpit pasó, sin cambio de producto asociado.
- La revisión de concurrencia de Tarea 3 detectó una carrera en el manejo de fallos: una entrega podía volver a `PENDING` y ser reclamada antes de la segunda escritura. Se corrigió con una única actualización condicional ligada al lease reclamado y se añadió una prueba de dos workers.
- La primera prueba de máximo de intentos no aislaba correctamente el umbral configurable; se ajustó el fixture para verificar explícitamente la transición terminal `FAILED` y el código persistido `TEMPORARY_PROVIDER`.

## Criterio de terminado de Fase 1

Se considera terminada porque la base instala desde cero, levanta servicios reproducibles, valida y aplica migraciones, ejecuta seed idempotente, expone un health check seguro, separa pruebas por capa, conserva la landing y pasa el gate documentado. No implica que el producto comercial completo esté terminado.

## Planes vigentes

- `docs/superpowers/plans/2026-09-07-ocpool-foundation.md` — Fase 1, fundamentos técnicos, ejecutado.
- `docs/superpowers/plans/2026-09-07-ocpool-identity-rbac.md` — Fase 2, plan aprobado y ejecutado.
- `docs/superpowers/plans/2026-09-07-ocpool-clients-requests.md` — Fase 3, plan técnico ejecutado; Tareas 1–6 terminadas con gate final.
- `docs/superpowers/specs/2026-09-07-ocpool-client-portal.md` — especificación aprobada para Fase 5.
- `docs/superpowers/plans/2026-09-07-ocpool-client-portal.md` — Fase 5, plan aprobado y ejecutado; Tareas 1–6 cerradas con gate verde.
- `docs/superpowers/plans/2026-09-07-ocpool-catalog-quotes.md` — Fase 4, Tareas 1–6 ejecutadas; gate cerrado.
- `docs/superpowers/specs/2026-09-07-ocpool-messaging.md` — especificación aprobada para Fase 6.
- `docs/superpowers/specs/2026-09-07-ocpool-messaging-apis.md` — contrato HTTP privado de la Tarea 3, aprobado y ejecutado.
- `docs/superpowers/plans/2026-09-07-ocpool-messaging.md` — plan aprobado y ejecutado para Fase 6; Tareas 1–6 cerradas con gate verde.
- `docs/superpowers/plans/2026-09-07-ocpool-messaging-apis.md` — plan enfocado de APIs, ejecutado.
- `docs/superpowers/specs/2026-09-07-ocpool-customer-messaging-ui.md` — especificación aprobada y ejecutada para la UI cliente de la Tarea 4.
- `docs/superpowers/plans/2026-09-07-ocpool-customer-messaging-ui.md` — plan enfocado de UI cliente, ejecutado.
- `docs/superpowers/specs/2026-09-08-ocpool-staff-messaging-ui.md` — especificación aprobada y ejecutada para la UI staff de la Tarea 5.
- `docs/superpowers/plans/2026-09-08-ocpool-staff-messaging-ui.md` — plan enfocado de UI staff, ejecutado.
- `docs/superpowers/specs/2026-09-08-ocpool-private-files.md` — especificación aprobada para Fase 7; fase cerrada.
- `docs/superpowers/plans/2026-09-08-ocpool-private-files.md` — plan ordenado de Fase 7; Tareas 1–6 cerradas con gate verde.
- `docs/superpowers/specs/2026-09-08-ocpool-pdf-acceptance.md` — especificación aprobada para Fase 8; no implica firma electrónica avanzada por sí sola.
- `docs/superpowers/plans/2026-09-08-ocpool-pdf-acceptance.md` — plan ordenado de Fase 8; Tareas 1–6 cerradas con gate verde.
- `docs/superpowers/specs/2026-09-08-ocpool-notifications.md` — especificación aprobada para Fase 9.
- `docs/superpowers/reviews/2026-09-08-ocpool-notifications-review.md` — autorrevisión de Fase 9, completada antes de código.
- `docs/superpowers/plans/2026-09-08-ocpool-notifications.md` — plan ordenado de Fase 9; Tareas 1–3 cerradas, Tarea 4 en ejecución.
- `docs/superpowers/specs/2026-09-08-ocpool-staff-private-files-ui.md` — especificación enfocada para la UI staff de archivos de Tarea 5.
- `docs/superpowers/plans/2026-09-08-ocpool-staff-private-files-ui.md` — plan enfocado ordenado para ejecutar Tarea 5.

## Criterio de terminado de Fase 5

La fase se considera terminada porque el cliente autenticado sólo lee recursos de su `clientId`, las cotizaciones históricas se sirven desde snapshots, las rutas privadas no enumeran recursos ajenos ni exponen secretos, la UI cubre estados de sesión/carga/vacío/error, responsive, teclado, reduced motion y Axe, y el gate de infraestructura, build, pruebas, auditoría y árbol limpio quedó registrado.

## Próximo paso autorizado

Ejecutar Fase 9, Tarea 4: integrar eventos transaccionales de auth, solicitudes, cotizaciones, aceptación, mensajería y archivos con destinatarios reales y fan-out idempotente.
