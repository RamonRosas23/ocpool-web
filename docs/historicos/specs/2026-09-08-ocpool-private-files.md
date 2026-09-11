# Fase 7 — Archivos privados por expediente

**Estado:** aprobada para ejecución incremental dentro de la rama `codex/ocpool-foundation`.
**Fecha:** 2026-09-08.
**Dependencias:** identidad/RBAC, solicitudes, cotizaciones, portal cliente y auditoría transaccional ya cerrados.

## 1. Objetivo

Incorporar archivos privados al expediente comercial sin convertir el navegador ni el storage en una frontera de confianza. Un archivo sólo será visible después de que el backend valide actor, expediente, cliente, categoría, tamaño, tipo real, estado de análisis y ciclo de vida.

La primera entrega será una vertical slice de adjuntos asociados a `QuoteRequest`, disponible para cliente y personal autorizado. El diseño debe permitir reutilizar el mismo storage para PDFs comerciales y futuras evidencias de aceptación sin copiar bytes ni relajar permisos.

## 2. Alcance

Incluye:

- metadata relacional de objeto físico y adjunto de expediente;
- categorías y visibilidad explícitas `CUSTOMER` e `INTERNAL`;
- permisos separados para listar, cargar, descargar, borrar y administrar;
- storage privado S3-compatible en local mediante MinIO, detrás de un puerto de aplicación;
- claves internas opacas, nunca nombres o rutas proporcionados por el usuario;
- flujo de reserva, carga, verificación y finalización idempotente;
- validación de extensión, MIME declarado, firma mágica, tamaño y hash SHA-256;
- estados `PENDING_SCAN`, `AVAILABLE`, `REJECTED` y `DELETED`;
- URLs temporales o descarga proxy con `no-store`, `nosniff`, `Content-Disposition: attachment` y auditoría;
- soft delete lógico y limpieza de objetos huérfanos;
- UI de lista/carga/descarga/errores para portal y workspace staff;
- pruebas de IDOR, cliente cruzado, rol limitado, sesión revocada, replay, tipos disfrazados, límites y expiración.

No incluye en esta fase:

- adjuntos dentro de mensajes;
- PDF comercial o aceptación digital;
- compartir enlaces públicos;
- edición de archivos o reemplazo destructivo;
- OCR, thumbnails o preview inline de contenido no confiable;
- integración productiva con un proveedor externo de antivirus antes de cerrar el contrato operacional.

La aplicación no entregará un objeto que no esté en `AVAILABLE`. El proveedor de análisis queda detrás de una interfaz; el entorno local usará validación de firma/tipo y dejará explícito en el estado que no es una garantía antivirus de producción. El gate de salida no podrá declararse listo para producción hasta seleccionar y probar el scanner operacional.

## 3. Modelo de autorización

El actor se deriva exclusivamente de la sesión:

- cliente: sólo expedientes de su `clientId`, adjuntos `CUSTOMER`, y sólo si el cliente y la sesión siguen activos;
- empleado: necesita `requests.read` y `files.read`; el acceso a `INTERNAL` requiere `files.internal.read`;
- carga: cliente con `files.upload` sólo en su expediente; staff con `files.upload` y scope de solicitudes;
- borrado: soft delete, sólo por el uploader dentro de una ventana definida o por `files.manage`; nunca se elimina metadata histórica;
- descarga: vuelve a validar actor, cliente, visibilidad, estado y expediente en cada solicitud;
- ninguna capacidad enviada al frontend sustituye los guards del servicio.

Permisos nuevos, explícitos y deny-by-default:

- `files.read`
- `files.upload`
- `files.download`
- `files.delete`
- `files.internal.read`
- `files.manage`

## 4. Modelo de datos

Se usarán dos entidades para separar metadata del objeto físico de su uso comercial:

### `StorageObject`

- `id` UUID;
- `provider` y `storageKey` únicos, opacos y no derivados del nombre original;
- `contentType`, `byteSize`, `sha256` y `etag` verificados por servidor;
- `scanStatus`, `scannerName`, `scannedAt` y `scanReason` sin guardar contenido sensible;
- `createdAt`, `verifiedAt`, `deletedAt`.

### `FileAttachment`

- `id` UUID;
- `quoteRequestId` y `clientId` con FK compuesto al expediente;
- `storageObjectId` único mientras el primer slice no soporte deduplicación compartida;
- `category`, `visibility`, `originalFileName` sanitizado y `status`;
- `uploadedById`, `createdAt`, `deletedAt`;
- índices por expediente, cliente, visibilidad y estado.

El nombre original es sólo una etiqueta de presentación. Nunca participa en la ruta física. `AuditLog` registrará carga, rechazo, descarga y borrado con IDs, folio, categoría, outcome y motivo seguro; no registrará bytes, tokens, URLs firmadas ni contenido.

## 5. Contrato de archivos

Categorías iniciales controladas por dominio:

- `REFERENCE_IMAGE`
- `TECHNICAL_DOCUMENT`
- `CLIENT_DOCUMENT`
- `INTERNAL_DOCUMENT`

Tipos iniciales permitidos: PDF, JPEG, PNG y WebP. Se rechazan HTML, SVG, XML, scripts, ejecutables, archivos comprimidos y cualquier extensión o firma no reconocida. El tamaño máximo inicial es 25 MiB por archivo y existe un límite por expediente configurable antes de persistir bytes.

El servidor valida:

1. UUID, categoría y nombre UTF-8 normalizado;
2. cuota y tamaño declarado;
3. extensión coherente con MIME declarado;
4. firma mágica leída desde los bytes reales;
5. tamaño/hash calculados desde el objeto almacenado;
6. estado de análisis antes de marcar `AVAILABLE`.

## 6. Flujo transaccional

```text
actor autorizado
  → reserve upload (DB, PENDING_SCAN, clave opaca)
  → upload privado al storage (presigned o proxy)
  → complete upload (HEAD/stream, hash, firma, cuota)
  → scanner adapter
  → AVAILABLE o REJECTED
  → lista/descarga con autorización en cada request
```

La reserva expira y puede limpiarse sin dejar acceso. `complete` es idempotente para la misma reserva y no acepta que el cliente elija `storageKey`, `clientId`, `uploadedById`, estado o scan result. Si DB y storage divergen, un job de reconciliación futura eliminará objetos huérfanos; la primera entrega debe exponer métricas/logs seguros para detectarlos.

## 7. API privada

- `GET /api/portal/requests/:id/files`
- `POST /api/portal/requests/:id/files/reserve`
- `POST /api/portal/requests/:id/files/:fileId/complete`
- `GET /api/portal/requests/:id/files/:fileId/download`
- `DELETE /api/portal/requests/:id/files/:fileId`
- equivalentes staff bajo `/api/staff/quote-requests/:id/files`, siempre con scope y visibilidad explícitos;
- `GET /api/staff/capabilities` incluye sólo booleans de capacidad, nunca permisos crudos.

Las respuestas privadas usan `Cache-Control: no-store`. Las respuestas no incluyen storage key, presigned URL reutilizable, hash de idempotencia, ruta local, stack, secreto ni metadata de scanner que facilite enumeración.

## 8. Storage local y producción

El contrato `PrivateStorage` será agnóstico al proveedor. El entorno local usará MinIO S3-compatible en Docker para probar presigned URLs y ciclo de vida real sin publicar archivos. Las credenciales sólo viven en variables de entorno; el bucket es privado y no se expone por el frontend.

La configuración de producción, retención, backup, versionado de bucket, KMS y proveedor antivirus quedan como gate operativo posterior. No se permitirá declarar "listo para producción" mientras el scanner, backups/restauración y política de retención sigan sin decisión.

## 9. UI/UX

El portal mostrará una sección de archivos dentro del detalle del expediente con categorías legibles, tamaño, fecha, estado, carga progresiva, progreso, cancelación, reintento y errores accionables. No habrá preview inline por defecto.

El staff tendrá una vista de alta densidad dentro del expediente, con separación visual entre compartidos e internos, filtros mínimos y acciones condicionadas por capacidad. Ambos contextos cubrirán vacío, carga, rechazo, pendiente de análisis, expiración, borrado lógico, móvil y reduced motion.

## 10. Pruebas y criterios de terminado

Debe existir evidencia de:

- dominio: límites, categorías, nombres, MIME/firma, estados y transiciones;
- persistencia: FKs compuestos, unicidad, constraints, soft delete e idempotencia;
- servicio: aislamiento, concurrencia, cuota, cleanup y no entrega antes de `AVAILABLE`;
- API: 401/403/404/409/413/415/422, same-origin, no-store y payload mínimo;
- seguridad: IDOR entre clientes, visibilidad interna, sesión revocada, replay, URL expirada, path traversal y nombre malicioso;
- E2E: cliente y staff, carga/descarga/rechazo, responsive, Axe, consola, no overflow y cleanup exacto;
- gate: DB, seed, unit, integration, content, typecheck, lint, build, E2E, audit y diff check.

La fase no se marcará completa si una prueba sólo demuestra que el frontend oculta un botón. Cada autorización y cada descarga deben verificarse en backend.
