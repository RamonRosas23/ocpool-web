# OCPOOL — Especificación de Fase 5: Portal autenticado del cliente

> Estado: aprobado para implementación incremental después del cierre verificable de Fase 4.

## Objetivo

Construir el primer portal privado del cliente para que pueda autenticarse de forma segura, consultar únicamente sus propios expedientes y revisar cotizaciones versionadas con una experiencia visual premium, clara y responsive.

El portal será una superficie de lectura y seguimiento en esta fase. No habilitará aceptación digital, firma, pagos, archivos privados ni mensajería hasta que sus módulos tengan contratos, permisos, auditoría y pruebas independientes.

## Alcance funcional

### Incluido

- entrada al portal mediante el mecanismo de autenticación de cliente existente;
- sesión privada de cliente con expiración, revocación y aislamiento por `clientId`;
- inicio del portal con solicitudes propias, folio, proyecto, estado y última actividad;
- detalle de una solicitud propia con alcance compartido y resumen de cotización disponible;
- consulta de versiones de cotización que pertenecen al mismo cliente;
- visualización de líneas snapshot, vigencia, descuentos, impuestos, totales y estado;
- estados de carga, vacío, error, sesión expirada, acceso restringido y datos no disponibles;
- diseño premium, responsive, accesible y diferenciado del sistema interno;
- auditoría de accesos sensibles sin registrar tokens, secretos ni datos innecesarios;
- pruebas de IDOR, sesión, alcance por cliente, proyecciones seguras y flujos E2E.

### Fuera de alcance de esta fase

- aceptación digital o evidencia legal de aceptación;
- firma, PDF final, descarga de documentos o envío productivo;
- mensajería cliente–equipo y notas internas;
- archivos privados, antivirus y URLs temporales;
- pagos, facturación fiscal y conversión a proyecto;
- edición de solicitudes o cotizaciones desde el portal;
- métricas administrativas.

## Actores y límites

- `CUSTOMER`: sólo puede consultar recursos cuyo `clientId` coincida con el de su actor autenticado.
- `EMPLOYEE`: conserva las superficies internas existentes; el portal no será una forma alternativa de acceder al inbox.
- Sesión ausente, expirada, revocada o de usuario archivado: respuesta pública segura y sin enumerar recursos.
- Un folio nunca es autenticación ni autorización.
- Los identificadores internos no serán suficientes para cruzar clientes: servicio, consulta y base de datos deben mantener el alcance por cliente.

## Contratos de datos

Las proyecciones del portal no devolverán secretos de autenticación, tokens, hashes, notas internas, logs, IDs de otros clientes ni campos operativos que no sean necesarios.

El portal podrá recibir:

- `request`: `id`, `folio`, estado público, fechas, tipo de proyecto, ubicación compartida y descripción compartida;
- `quote`: estado, número de versión, moneda, vigencia, importes serializados como cadenas y líneas snapshot;
- `line`: nombre, código comercial, unidad, cantidad, precio, descuento, impuesto y total snapshot;
- `history`: cambios públicos de versión/estado, sin actores internos ni notas confidenciales.

Los importes monetarios seguirán viajando como cadenas de unidad mínima. El cliente no recalculará totales para autorizar operaciones; cualquier resumen visual será informativo y el servidor seguirá siendo la fuente de verdad.

## Seguridad y privacidad

- Toda ruta privada deriva el actor desde la sesión persistida en servidor.
- Toda consulta de solicitud/cotización incluirá el alcance `clientId` en la misma operación y se probará con un segundo cliente.
- Se rechazarán UUIDs inválidos, recursos inexistentes y recursos de otro cliente sin filtrar si existen.
- Las mutaciones futuras exigirán same-origin, aunque esta fase sea de lectura.
- No se pondrán datos privados en URLs públicas, metadata indexable, logs de frontend ni mensajes de error.
- Las páginas del portal llevarán `noindex` y no expondrán contenido en prerender público.
- El logout y expiración invalidarán la sesión; las respuestas no distinguirán entre sesión inválida y recurso no autorizado cuando corresponda.

## Experiencia visual

- Portal de cliente: editorial, visual y sereno, con jerarquía amplia, lenguaje de propuesta y resumen de avance.
- Sistema interno: permanece denso y operativo; el portal no reutilizará una tabla de inbox como layout principal.
- Todas las pantallas tendrán navegación clara, foco visible, hit areas táctiles, contraste, teclado y reduced motion.
- Los estados vacíos explicarán qué puede esperar el cliente; los errores ofrecerán recuperación sin mostrar detalles técnicos.
- Responsive prioritario: móvil de 360–430 px, tablet y escritorio amplio.

## Arquitectura

- Mantener Next.js App Router y monolito modular.
- Añadir un módulo de lectura de portal separado de `staff-service`, con funciones de alcance explícito como `listCustomerQuoteRequests` y `getCustomerQuoteWorkspace`.
- Reutilizar sesiones, actor, permisos, errores, logger y dominio de cotizaciones; no duplicar autenticación.
- Mantener las cotizaciones históricas en snapshots; el portal jamás resolverá precio desde el catálogo vigente.
- No agregar Redis, worker o dependencia visual nueva sin una necesidad demostrada por esta fase.

## Decisiones abiertas que no bloquean el primer vertical slice

- texto comercial definitivo de estados para el cliente;
- si la ubicación debe mostrar colonia/ciudad completa o una versión abreviada;
- proveedor de correo productivo para futuros enlaces;
- idioma adicional y timezone comercial;
- requisitos legales de aceptación, que permanecen fuera de esta fase.

## Criterios de aceptación

- un cliente autenticado ve sólo sus propios expedientes y cotizaciones;
- un cliente no autenticado no obtiene datos del portal;
- un cliente no puede acceder al expediente de otro cliente aunque conozca UUID o folio;
- una cotización histórica conserva los snapshots presentados por el servidor;
- el portal no expone secretos, IDs cruzados, stack traces ni campos internos;
- las pantallas completan estados de carga, vacío, error, sesión expirada y responsive;
- pruebas unitarias, integración, seguridad negativa y E2E del portal pasan antes de cerrar la fase.
