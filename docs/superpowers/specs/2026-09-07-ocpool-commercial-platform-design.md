# OCPOOL Commercial Platform — Especificación de diseño

**Fecha:** 2026-09-07  
**Estado:** Dirección aprobada por el usuario; documento pendiente de revisión antes del plan de implementación.  
**Producto:** Plataforma comercial de solicitudes, cotizaciones y aceptación para OCPOOL.

## 1. Objetivo

Transformar la web pública de OCPOOL, actualmente orientada a presentación y contacto, en la entrada de una plataforma comercial profesional que permita:

```text
Captar solicitud
→ crear expediente
→ asignar responsable
→ solicitar información
→ construir cotización
→ versionar y negociar
→ comunicar al cliente
→ aceptar una versión
→ convertir a proyecto
```

La solución debe conservar la identidad premium de la web pública, pero optimizar el sistema interno para velocidad operativa y trazabilidad.

## 2. Alcance del producto

### 2.1 Web pública

Se conserva la landing existente como superficie de marca y captación. El formulario actual evolucionará hacia una solicitud persistida, preferentemente en una ruta propia como `/cotizar`, sin romper los anclajes ni la experiencia actual.

### 2.2 Portal del cliente

El cliente podrá consultar únicamente sus expedientes autorizados y:

- consultar folio y estado;
- completar información requerida;
- ver cotizaciones y versiones disponibles;
- descargar documentos autorizados;
- enviar y recibir mensajes;
- solicitar modificaciones;
- aceptar o rechazar una versión vigente;
- consultar historial visible al cliente.

### 2.3 Sistema interno

El personal autorizado podrá:

- recibir y clasificar solicitudes;
- asignar responsables;
- operar expedientes;
- solicitar información;
- administrar notas internas;
- administrar catálogo y precios;
- construir cotizaciones;
- aprobar descuentos según permisos;
- enviar versiones;
- revisar actividad y auditoría;
- consultar métricas operativas.

### 2.4 MVP operativo

La primera versión utilizable debe entregar un flujo vertical completo, no una colección de pantallas aisladas:

1. formulario progresivo;
2. creación de solicitud y expediente;
3. folio comercial;
4. acceso seguro del personal;
5. inbox interno y asignación;
6. estados e historial;
7. catálogo mínimo;
8. constructor de cotización;
9. versionado con snapshots;
10. portal básico del cliente;
11. mensajería persistida;
12. PDF;
13. aceptación con evidencia;
14. notificaciones por correo;
15. auditoría básica.

Quedan fuera del primer corte operativo, aunque la arquitectura no debe impedirlos: WhatsApp, SMS, tiempo real, multiempresa, pagos, compras a proveedores, firma electrónica avanzada y gestión completa de obra.

## 3. Principios de diseño

1. **Persistencia antes que notificación:** el correo nunca será la fuente de verdad.
2. **Autorización en backend:** ningún permiso crítico dependerá de la interfaz.
3. **Historial inmutable:** lo enviado o aceptado no se reescribe.
4. **Separación de contextos:** cliente, empleado y administración tendrán límites explícitos.
5. **Modularidad sin microservicios prematuros:** un monolito modular permite entregar valor y mantener operación simple.
6. **Diseño por estados:** cada operación importante tendrá estados válidos y transiciones controladas.
7. **Datos mínimos necesarios:** no se recopilarán datos personales sin propósito definido.
8. **Seguridad por defecto:** enlaces privados, sesiones seguras, límites, auditoría y errores seguros.
9. **Experiencias distintas:** portal premium y visual para cliente; consola rápida y densa para empleados.
10. **Dependencias justificadas:** cada librería deberá aportar una capacidad clara y mantenida.

## 4. Arquitectura técnica

### 4.1 Arquitectura recomendada

Monolito modular dentro de la aplicación Next.js actual:

```text
Next.js App Router
├── (marketing) Web pública y landing
├── (customer) Portal del cliente
├── (staff) Sistema interno
├── (auth) Acceso y recuperación
├── app/api Route Handlers
├── server/modules/* Servicios de dominio
├── PostgreSQL Persistencia transaccional
├── Storage privado Archivos y PDFs
└── Worker opcional Notificaciones y tareas asíncronas
```

La aplicación no se separará en un frontend y un backend independientes hasta que exista una necesidad operativa demostrable.

### 4.2 Infraestructura local inicial

El primer entorno reproducible tendrá:

- aplicación Next.js;
- PostgreSQL;
- Mailpit para correo local;
- volumen persistente para PostgreSQL.

Se incorporará MinIO o storage S3-compatible cuando se implemente el módulo de archivos. El worker se incorporará cuando existan notificaciones o tareas que necesiten reintentos. Redis no será requisito inicial.

### 4.3 Separación de módulos

```text
identity
clients
quote-requests
assignments
catalog
quotes
conversations
attachments
notifications
audit
projects
analytics
```

Cada módulo tendrá contratos claros, servicios propios, validaciones y pruebas. Las páginas y Route Handlers no contendrán reglas comerciales complejas directamente.

## 5. Dependencias entre módulos

```text
identity ───────────────┐
                        ├── clients ── quote-requests ── assignments
                        │                                  │
                        │                                  ├── conversations
                        │                                  ├── attachments
                        │                                  └── quotes
                        │                                      │
                        └── catalog ───────────────────────────┘
                                                               │
                                  quote versions ───────────────┤
                                                               ├── acceptance
                                                               ├── notifications
                                                               └── projects

audit y actividades reciben eventos de todos los módulos mutables.
```

Ningún módulo de UI podrá saltarse las reglas de sus servicios de dominio.

## 6. Modelo de dominio

### 6.1 Identidad y acceso

- `users`
- `roles`
- `permissions`
- `user_roles`
- `sessions`
- `auth_tokens`
- `auth_events`

El cliente y el empleado serán usuarios con contextos y permisos diferentes. La autorización combinará permiso, actor y alcance del registro.

### 6.2 Clientes y solicitudes

- `clients`
- `client_contacts`
- `quote_requests`
- `quote_request_details`
- `request_assignments`
- `request_status_history`

Una solicitud generará en una transacción:

1. cliente o contacto;
2. solicitud;
3. folio comercial;
4. estado inicial;
5. actividad;
6. evento de notificación.

### 6.3 Catálogo y plantillas

- `catalog_categories`
- `catalog_items`
- `catalog_price_versions`
- `catalog_item_media`
- `quote_templates`
- `quote_template_items`

Desactivar un producto no cambiará ninguna cotización histórica.

### 6.4 Cotizaciones

- `quotes`
- `quote_versions`
- `quote_sections`
- `quote_items`
- `quote_version_terms`
- `quote_version_guarantees`

Cada `quote_item` guardará los datos utilizados en la versión: descripción, unidad, cantidad, precio, impuesto, descuento, moneda y referencia opcional al catálogo. La referencia al catálogo nunca sustituirá al snapshot.

### 6.5 Comunicación y archivos

- `conversations`
- `messages`
- `message_reads`
- `internal_notes`
- `attachments`
- `storage_objects`

Mensajes de cliente y notas internas serán entidades y permisos distintos, no sólo un campo booleano en la interfaz.

### 6.6 Auditoría y notificaciones

- `activities`
- `audit_logs`
- `notifications`
- `outbox_events`

La actividad visible al cliente será diferente de la auditoría técnica y de seguridad.

## 7. Estados y reglas de integridad

### 7.1 Solicitud

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

Las transiciones serán explícitas y dependerán del actor y permiso.

### 7.2 Cotización

```text
Borrador → En revisión → Enviada → Vista →
Modificación solicitada → Reemplazada

Enviada → Aceptada | Rechazada | Vencida
```

Una versión `Enviada`, `Vista`, `Aceptada`, `Rechazada`, `Vencida` o `Reemplazada` no se editará. Cualquier cambio comercial generará una nueva versión.

### 7.3 Dinero y snapshots

- No se utilizarán números de punto flotante para dinero.
- Cada cotización guardará moneda, impuestos, descuentos y redondeos aplicados.
- El cambio posterior del catálogo no alterará versiones existentes.
- Los totales se recalcularán en backend y se verificarán en base de datos y pruebas.

## 8. Autenticación y autorización

### Cliente

- Magic link u OTP por correo.
- Token de un solo uso.
- Expiración corta.
- Token almacenado de forma no reversible.
- Sesión privada posterior.
- El folio sólo sirve para comunicación, nunca para autenticar.

### Empleado

- Sesión persistida en servidor.
- Cookie `HttpOnly`, `Secure` y `SameSite`.
- Hashing fuerte de contraseñas.
- Rotación de sesión al elevar privilegios.
- MFA obligatorio para administradores.
- Recuperación con token de un solo uso.
- Rate limiting para autenticación.

### Permisos

El sistema distinguirá al menos:

- ver expediente;
- editar datos;
- asignar;
- cambiar precios;
- aplicar descuentos;
- aprobar descuentos;
- enviar cotización;
- administrar catálogo;
- administrar usuarios;
- exportar;
- aceptar o cerrar;
- consultar métricas.

La verificación se ejecutará dentro de los servicios backend y no sólo en los componentes de UI.

## 9. Seguridad, privacidad y evidencia

### Seguridad

- Validación de entrada con schemas compartidos y límites de tamaño.
- Protección CSRF y validación de origen para operaciones mutables.
- Rate limiting en autenticación, recuperación, mensajes y carga de archivos.
- IDs internos opacos y folios no autenticadores.
- Cookies seguras y rotación de sesiones.
- Auditoría de cambios de permisos, precios, estados, versiones y aceptación.
- Errores públicos genéricos y logs internos estructurados.
- Backups cifrados y separación de entornos.

### Privacidad

El sistema tratará nombres, teléfonos, correos, ubicaciones, archivos de proyecto, mensajes e información comercial. La implementación deberá aplicar:

- minimización de datos;
- finalidad explícita;
- consentimiento cuando corresponda;
- control de acceso por necesidad;
- política de retención;
- exportación o eliminación conforme a la política aprobada;
- revisión formal del aviso de privacidad aplicable en México.

### Aceptación

La aceptación digital registrará como mínimo usuario, versión, importe, moneda, fecha, hora, términos mostrados, IP y user agent cuando la política jurídica y de privacidad lo autorice. El sistema no presentará esta evidencia como sustituto automático de un contrato formal.

## 10. API y contratos

Los Route Handlers serán adaptadores del dominio, no el lugar de la lógica comercial. Las familias previstas son:

```text
POST   /api/quote-requests
GET    /api/staff/quote-requests
GET    /api/staff/quote-requests/:id
POST   /api/staff/quote-requests/:id/assign
POST   /api/staff/quote-requests/:id/status
GET    /api/quotes/:id
POST   /api/quotes/:id/versions
POST   /api/quote-versions/:id/send
POST   /api/quote-versions/:id/request-change
POST   /api/quote-versions/:id/accept
POST   /api/expedientes/:id/messages
POST   /api/files/presign
GET    /api/files/:id/download
```

Los nombres definitivos se validarán contra la estructura final de rutas y permisos antes de implementar.

## 11. Archivos y PDFs

Los archivos serán privados y tendrán:

- categoría;
- tamaño máximo;
- MIME validado;
- nombre interno generado;
- propietario y expediente;
- estado de análisis;
- URL temporal;
- historial de acceso cuando corresponda.

Los PDFs comerciales se generarán a partir de una plantilla versionada y se asociarán a una versión específica de cotización. Un PDF histórico no se regenerará silenciosamente porque haya cambiado la marca o el catálogo.

## 12. Notificaciones

El flujo será:

```text
Cambio de dominio
→ evento Outbox
→ worker o procesador
→ plantilla de correo
→ proveedor
→ estado de entrega y reintentos
```

Eventos iniciales:

- solicitud recibida;
- solicitud asignada;
- información requerida;
- cotización enviada;
- nuevo mensaje;
- cambio solicitado;
- cotización próxima a vencer;
- cotización aceptada.

WhatsApp y SMS no serán dependencias del flujo principal.

## 13. Manejo de errores y observabilidad

El usuario verá mensajes claros y no recibirá:

- stack traces;
- consultas SQL;
- rutas internas;
- secretos;
- identificadores sensibles.

Los logs internos tendrán:

- correlation ID;
- actor;
- módulo;
- operación;
- resultado;
- duración;
- error seguro;
- referencia de expediente cuando sea necesario.

Los tokens, contraseñas y contenido sensible no se registrarán.

## 14. Estrategia de testing

### Unitarias

- totales;
- folios;
- permisos;
- transiciones;
- expiraciones;
- snapshots;
- descuentos;
- aceptación.

### Integración

- migraciones;
- transacciones;
- constraints;
- concurrencia;
- almacenamiento;
- outbox;
- repositorios.

### API

- autenticación;
- autorización;
- IDOR;
- enumeración;
- rate limiting;
- errores;
- idempotencia.

### E2E

- flujo cliente completo;
- flujo empleado completo;
- negociación;
- versionado;
- aceptación;
- casos negativos.

### Calidad transversal

- Axe;
- responsive;
- reduced motion;
- screenshots de estados críticos;
- consola;
- build;
- auditoría de dependencias;
- rendimiento.

## 15. Fases de implementación

### Fase 0 — Auditoría y diseño

Entregables: esta especificación, estado del proyecto, glosario, riesgos y decisiones abiertas.

### Fase 1 — Fundamentos

Docker local, entorno, base de datos, migraciones, seeds, logger, errores, estructura modular y documentación de desarrollo.

### Fase 2 — Identidad y RBAC

Usuarios, sesiones, clientes, roles, permisos, recuperación, MFA administrativo y pruebas de autorización.

### Fase 3 — Solicitudes y expedientes

Formulario progresivo, folio, solicitud, estados, historial, asignación y primera notificación.

### Fase 4 — Sistema interno

Inbox, búsqueda, filtros, expediente, notas internas, actividad y solicitudes de información.

### Fase 5 — Catálogo

Categorías, conceptos, unidades, precios, impuestos, proveedores, historial y plantillas.

### Fase 6 — Cotizador

Borradores, secciones, conceptos, cantidades, descuentos, términos, cálculos y snapshots.

### Fase 7 — Portal y mensajería

Acceso de cliente, cotización visual, archivos, mensajes, timeline y solicitudes de cambio.

### Fase 8 — PDF y aceptación

PDF comercial, envío, vigencia, aceptación, evidencia y notificaciones con reintentos.

### Fase 9 — Métricas y proyectos

Dashboard, tiempos, conversión, importe potencial, importe ganado y conversión explícita a proyecto.

### Fase 10 — Hardening y producción

Seguridad, carga, backups, restauración, observabilidad, documentación operativa y checklist de salida.

## 16. Criterios de terminado

Un módulo sólo será `Terminado` cuando:

- funcione en el flujo real;
- esté integrado;
- tenga validación servidor/cliente;
- maneje errores, carga y estados vacíos;
- respete permisos;
- tenga pruebas apropiadas;
- sea responsive y accesible;
- tenga logs y auditoría cuando aplique;
- no exponga información sensible;
- no rompa módulos existentes;
- tenga documentación;
- tenga migraciones y seeds si corresponde;
- tenga un criterio de rollback;
- haya sido verificado con evidencia.

Compilar no es un criterio suficiente.

## 17. Decisiones abiertas que deben confirmarse antes del modelo final

1. Operación inicial de una sola empresa o con sucursales.
2. Moneda y reglas de impuestos.
3. Alcance de visibilidad por ejecutivo.
4. Límites de descuentos y aprobaciones.
5. Proveedor de correo de producción.
6. Retención y eliminación de datos.
7. Requisitos legales de aceptación.
8. Destino de producción.
9. Política de conversión a proyecto.

Mientras no se confirme lo contrario, la implementación de diseño asumirá una sola organización OCPOOL, MXN configurable, sin multiempresa y con conversión a proyecto explícita por un usuario autorizado.

## 18. Disciplina de cambios

Todo cambio relevante se documentará como:

1. actualización de esta especificación si modifica arquitectura o alcance;
2. ADR si cambia una decisión técnica;
3. actualización de `PROJECT_STATUS.md`;
4. plan de implementación afectado;
5. pruebas nuevas o ajustadas;
6. commit lógico y separado.

No se mezclarán cambios de infraestructura, dominio, UI y documentación en un commit gigantesco salvo que formen una unidad vertical verificable.
