# APIs privadas de mensajería — Plan de implementación

> Plan de la Tarea 3 de Fase 6. Se ejecuta después del servicio transaccional y antes de la UI.

**Spec:** `docs/historicos/specs/2026-09-07-ocpool-messaging-apis.md`
**Regla:** pruebas rojas, implementación mínima por contrato, verificación, actualización de estado y commit lógico.

## Tareas ordenadas

### 1. Pruebas API rojas

- [x] Crear fixtures de dos clientes, empleado con permisos completos y empleado limitado.
- [x] Probar 401/403/404, scope ajeno, same-origin, esquema estricto, límite y `no-store`.
- [x] Probar separación de nota interna y ausencia de `clientId`, `senderUserId`, hashes y bodies internos en portal.

### 2. Schemas y rutas

- [x] Crear esquemas Zod estrictos para body, cursor, límite y estado.
- [x] Crear rutas portal de lectura/envío.
- [x] Crear rutas staff de lectura/envío/notas/estado.
- [x] Mantener handlers delgados con guard, same-origin, `requestId`, `parseBody` y `toErrorResponse`.

### 3. Proyección y hardening

- [x] Sanitizar la respuesta cliente para ocultar IDs internos y notas.
- [x] Verificar headers `no-store`, status codes y serialización de cursor.
- [x] Ejecutar integración API, integración completa, typecheck, lint y diff check.

### 4. Cierre documental

- [x] Actualizar plan de Fase 6 y `PROJECT_STATUS.md`.
- [x] Hacer commit `feat: expose protected messaging APIs`.

## Evidencia de cierre

- `messaging-api.test.ts` 3/3 valida sesión, RBAC completo/limitado, scope entre clientes, UUID inválido, schemas estrictos, same-origin, `no-store`, notas internas y rate limit real por bucket PostgreSQL.
- El portal nunca recibe `clientId`, `senderUserId`, hash de idempotencia ni cuerpo de nota; el staff limitado sólo recibe mensajes `CUSTOMER`.
- `npm run test:integration` 37/37, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.

## Criterio de terminado

Las rutas permiten el flujo privado de mensajes para cliente/staff, bloquean cruces de cliente y mutaciones cross-origin, aplican permisos backend y no exponen datos internos ni notas en la proyección cliente.
