# Autorrevisión — Fase 12 Auditoría operativa y seguridad

**Especificación revisada:** `docs/superpowers/specs/2026-09-08-ocpool-audit-observability.md`

## Veredicto

La especificación es implementable como un vertical slice aislado y mantiene PostgreSQL como fuente de verdad. No se recomienda programar hasta resolver los puntos de control de esta revisión dentro del plan.

## Hallazgos críticos y resolución propuesta

### 1. Metadata heterogénea y riesgo de fuga

Los escritores existentes guardan IDs, folios, estados, categorías, códigos de error y, potencialmente, valores sensibles a futuro. El mapper no puede usar `JSON.stringify(metadata)` ni una allowlist sólo por clave.

**Resolución:** mapear por `action` con definición de claves permitidas y transformadores de tipo; cualquier acción no registrada se descarta de la vista o se devuelve como evento no proyectable sin detalles. Añadir pruebas con metadata maliciosa y campos sensibles conocidos.

### 2. RBAC transversal demasiado amplio

Una capacidad única podría dar a gerencia acceso a eventos de autenticación o permitir a ventas enumerar actividad.

**Resolución:** separar `audit.read` y `audit.security.read`; el servicio valida tipo de actor y capability antes de elegir tabla/categoría. Sales no tendrá visor transversal en esta fase.

### 3. Cursor manipulable o reutilizable

Un cursor con timestamps/UUID en claro puede enumerarse o cruzar filtros.

**Resolución:** cursor opaco firmado con una clave de aplicación o protegido por HMAC, incluyendo filtros normalizados y versión de contrato. Un cursor de otra categoría/rango debe responder `VALIDATION_ERROR` o reiniciar de forma explícita, nunca ampliar resultados.

### 4. Paginación y enriquecimiento N+1

Resolver actor o entidad dentro de un loop podría degradar el panel y exponer relaciones no autorizadas.

**Resolución:** selección mínima con `actorUser` en una consulta y batch fijo; no resolver entidades comerciales desde `entityId`. La UI sólo muestra etiquetas y detalles redacted, sin deep links.

### 5. Retención legal

Borrar eventos automáticamente sería una decisión legal y operativa, no una optimización técnica.

**Resolución:** no implementar purga; documentar clases de dato, costos y decisión pendiente. La fase sólo lee y deja evidencia para un futuro ciclo de retención aprobado.

### 6. Seguridad de AuthEvent

`AuthEvent` conserva `identifierHash`, IP y user-agent, que son datos de seguridad y pueden facilitar fingerprinting.

**Resolución:** admin-only, sin devolverlos; mostrar sólo tipo/outcome/fecha/actor etiquetado. Los logs técnicos deben seguir redacting esos campos.

## Hallazgos de producto

- Un feed transversal ayuda a gerencia a investigar, pero no reemplaza el historial contextual del expediente.
- “Actor” debe seguir siendo entendible para el personal autorizado; se permite `displayName` interno, nunca email ni perfil de cliente.
- No se añadirá búsqueda libre sobre metadata porque genera contrato débil, costos de consulta y riesgo de enumeración.
- No se mostrará una cifra total no paginada de auditoría; el panel debe comunicar que la lista es una ventana limitada.

## Hallazgos de datos y rendimiento

- Los índices actuales cubren actor y entidad, pero el feed transversal por tiempo puede requerir índice adicional después de `EXPLAIN` con volumen representativo.
- La decisión de migración debe comparar `createdAt DESC, id DESC`, filtros de outcome/category y costo de escritura.
- La respuesta no debe calcular métricas desde todos los eventos; cualquier resumen se limita a la página o a una consulta agregada acotada.

## Matriz de seguridad previa a implementación

| Riesgo | Control requerido | Evidencia |
| --- | --- | --- |
| Metadata cruda | Mapper por acción y tests de redacción | Unit + integration |
| IDOR por cursor | HMAC/filtros embebidos + scope | Integration |
| Enumeración de AuthEvent | Capability separada + proyección mínima | Integration + E2E |
| N+1 | Batch fijo o join | Revisión de repositorio + EXPLAIN |
| Abuso de lectura | Rate limit por actor y rango máximo | Unit + integration |
| Fuga en HTML/logs | Assertions de payload, HTML y logger | Integration + E2E |
| Purga incorrecta | Sin mutación ni job destructivo | Review documental |

## Decisión

**Aprobada para plan detallado**, condicionada a que el plan mantenga el orden dominio → permisos/schema → repositorio/servicio → API → UI → hardening → gate. No se aprueba todavía una migración de índices ni una política de retención.
