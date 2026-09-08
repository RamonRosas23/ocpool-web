# Runbook de auditoría operativa y seguridad

Este runbook describe la lectura local, segura y de sólo consulta del historial de OCPOOL. La superficie no edita eventos, no cambia permisos y no convierte el registro en un sistema de alertas.

## Alcance

- Interfaz staff: `/staff/audit`.
- API: `GET /api/staff/audit`.
- Fuente operativa: `AuditLog`, con acciones conocidas y detalles proyectados por allowlist.
- Fuente de seguridad: `AuthEvent`, únicamente para administradores.
- Cache: la API responde con `cache-control: no-store`.
- Fechas: rango semiabierto `[from,to)`, en `APP_TIMEZONE`, con un máximo de 93 días.
- Paginación: cursor opaco HMAC ligado a rango, categoría, resultado, fuente y límite.

La auditoría es histórica y de sólo lectura. En esta fase no hay exportación, purga, retención automática, SIEM ni alertas en tiempo real. No se deben inventar plazos legales: la política de retención y cualquier disposición futura requieren aprobación legal, de privacidad y de operación.

## Acceso y permisos

| Actor | Actividad operativa | Eventos de seguridad |
| --- | --- | --- |
| `manager` | `audit.read` | No |
| `admin` | `audit.read` | `audit.security.read` |
| `sales` | No | No |
| `customer` | No | No |

La autorización se valida en backend a partir de la sesión persistida. Ocultar una opción en la UI no sustituye al control del servicio. Un administrador debe tener una sesión MFA verificada para consultar la superficie de seguridad.

## Uso de la interfaz

1. Iniciar el entorno local con el procedimiento de [desarrollo local](local-development.md).
2. Acceder a `/staff/audit` con una sesión autorizada.
3. Elegir `Desde`, `Hasta`, categoría y resultado.
4. Pulsar `Aplicar filtros`.
5. Usar `Cargar eventos anteriores` para avanzar con el cursor vigente; nunca copiar ni editar el cursor manualmente.

La UI muestra acción, resultado, fecha, entidad genérica, actor proyectado y detalles permitidos. No muestra UUIDs, correo, teléfono, IP, user-agent, hashes, ciphertext, payloads, storage keys ni enlaces profundos a entidades.

## Contrato HTTP

Ejemplo local:

```text
GET /api/staff/audit?from=2026-09-01&to=2026-09-08&category=commercial&outcome=SUCCESS&limit=25
```

Filtros aceptados:

- `from`, `to`: `YYYY-MM-DD`; `to` es exclusivo.
- `category`: `commercial`, `communication`, `documents`, `notifications` o `security`.
- `outcome`: `SUCCESS`, `DENIED` o `FAILURE`.
- `limit`: entero de 1 a 50; la UI usa 25.
- `cursor`: valor opaco entregado por la respuesta anterior.

La API rechaza campos desconocidos, fechas imposibles, rangos vacíos, rangos mayores a 93 días, fechas futuras y cursores manipulados o usados con filtros distintos. Todas las respuestas privadas se sirven sin cache compartido.

## Diagnóstico seguro

### 401 o 403

- Confirmar que existe la cookie `ocpool_session` y que la sesión no expiró o fue revocada.
- Confirmar el tipo de actor y la asignación de `audit.read`.
- Para `category=security`, confirmar `audit.security.read` y MFA verificado.
- No corregir el problema agregando bypass en el componente cliente ni ampliando permisos de `sales`.

### 400

- Verificar que el rango cumple `[from,to)` y no supera 93 días.
- Eliminar campos no documentados y no reutilizar un cursor con otro filtro.
- El mensaje público no debe incluir SQL, stack trace, rutas internas, secretos ni metadata cruda.

### 429

La lectura usa el rate limit persistido de PostgreSQL con scope `audit-read` y clave del actor. Esperar la ventana indicada por la política del entorno; no aumentar el límite durante un incidente sin evaluar el costo de las consultas y el proxy/WAF. Revisar logs estructurados usando el `requestId`, sin registrar el contenido de respuestas ni metadata sensible.

### 5xx o estado vacío inesperado

- Revisar `/api/ready` y la salud de PostgreSQL.
- Comprobar que `AUDIT_CURSOR_SECRET` está configurado con una clave canónica de 32 bytes en base64.
- Revisar que `APP_TIMEZONE` sea el esperado.
- Consultar métricas de tiempo y errores del proceso sin copiar secretos ni payloads.
- Repetir con un rango pequeño y un filtro de categoría conocido.

La consulta operacional limita columnas, filtra acciones allowlisted, ordena por `createdAt` e `id`, y resuelve actores en un batch único. No se debe añadir enriquecimiento por fila ni consultar entidades relacionadas desde la UI.

## Rendimiento y `EXPLAIN`

Antes de agregar índices, usar datos representativos y revisar el plan de PostgreSQL para:

- `AuditLog` por rango, categoría y resultado.
- `AuthEvent` por rango y resultado.

Registrar sólo plan, filas estimadas, filas reales, tiempo y memoria; omitir valores sensibles. Con el volumen local actual no se agrega un índice especulativo. Si la evidencia muestra regresión, crear una propuesta separada con migración, impacto de escritura, rollback y prueba de volumen.

## Pruebas y regresión

```powershell
npm run test:unit
npm run test:integration
$env:AUDIT_E2E='1'; npm run test:e2e -- tests/audit.spec.ts
npm run typecheck
npm run lint
npm run build
```

La E2E usa usuarios y eventos desechables y debe limpiar exactamente sus IDs. Nunca usar cuentas reales, emails reales o secretos de producción en fixtures.

## Retención, backup y límites de esta fase

`AuditLog` y `AuthEvent` participan en los respaldos de PostgreSQL existentes. Restaurar para verificar continuidad sólo debe hacerse en un destino local desechable siguiendo [backup y restauración](backup-restore.md). No ejecutar operaciones destructivas sobre el entorno de desarrollo compartido para “limpiar” auditoría.

La retención, eliminación, exportación, legal hold, acceso de soporte, SIEM, alertas y anonimización son decisiones posteriores. Deben contar con responsable, clasificación de datos, periodo aprobado, evidencia de autorización, prueba de recuperación y procedimiento reversible antes de implementarse.

## Seguridad operacional

- Mantener `AUDIT_CURSOR_SECRET` fuera de Git y rotarlo mediante el procedimiento de secretos del entorno; una rotación invalida cursores existentes.
- No copiar respuestas de auditoría a tickets, logs o chats si contienen contexto operativo.
- No usar filtros del navegador como autorización.
- No mostrar el body crudo de `AuditLog`, `AuthEvent` ni errores del proveedor.
- No agregar exportación, purga o endpoint de administración como solución temporal.
