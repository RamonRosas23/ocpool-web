# Especificación — UI staff de archivos privados

## Propósito

Dar al equipo operativo una vista de archivos dentro de cada expediente, útil para decidir y actuar rápido sin mezclar documentos compartidos con material interno ni convertir la interfaz en una segunda autorización.

## Usuarios y permisos

- Sales puede consultar archivos compartidos y, si el backend lo permite, leer archivos internos; no debe ver acciones de administración sin `files.manage`.
- Manager/admin conserva las capacidades operativas completas definidas por RBAC.
- Un rol sin `files.read` debe recibir un estado de acceso restringido en la UI; la API continúa siendo la autoridad.
- Los booleanos de `/api/staff/capabilities` sólo controlan affordances; cada listado, reserva, descarga, finalización y borrado vuelve a validar sesión, expediente y capability en backend.

## Experiencia

- Sección `Archivos del expediente` dentro del detalle existente de `/staff/requests`, después del contexto del proyecto y antes de mensajería/historial.
- Tabs o filtros explícitos `Compartidos` e `Internos`; nunca se mezclan en una colección visual sin una etiqueta de visibilidad.
- Filas densas pero legibles: nombre saneado, tipo, tamaño, fecha, estado de validación y acciones disponibles.
- Estados completos: cargando, vacío, error recuperable, `En validación`, `Disponible` y `No disponible`.
- Upload staff con categoría seleccionable entre documento cliente/documento interno y visibilidad derivada de la elección, usando la misma reserva → PUT presigned → finalización del portal.
- Descarga sólo si la proyección marca `downloadAvailable`; se obtiene URL efímera bajo demanda y no se persiste en el estado.
- Borrado lógico visible sólo con `files.delete`/`files.manage`, con confirmación y feedback de resultado.
- No preview embebido, no exposición de `storageKey`, hash, `clientId`, URL presigned ni razón interna del scanner.

## No funcionales

- Keyboard-first, foco visible, nombres explícitos, tablist accesible y contraste WCAG AA.
- No overflow en viewport móvil; densidad optimizada para escritorio.
- `cache: no-store`, consola limpia y respuestas mínimas.
- Animaciones discretas y desactivables con `prefers-reduced-motion`.

## Fuera de alcance

- Antivirus productivo, cuarentena operacional, preview/thumbnail y adjuntos de mensajería.
- Cambios al modelo de autorización o bypass para empleados.

## Criterios de aceptación

1. Un empleado autorizado puede ver compartidos y, según capacidad, internos dentro del expediente correcto.
2. Un rol limitado no ve ni puede ejecutar controles de carga, borrado o lectura interna no autorizados.
3. Un archivo se carga y queda disponible sólo después de finalización/validación del backend.
4. La UI conserva estados claros sin filtrar detalles internos ante errores.
5. E2E opt-in, Axe, consola, responsive, typecheck, lint y diff check quedan verdes.
