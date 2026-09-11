# OCPOOL — Autorrevisión de consolidación de preparación para lanzamiento

## Alcance revisado

La especificación de Fase 16 cubre dos problemas comprobados: la no determinismo de la integración de invitaciones por contaminación del bucket persistido de rate limit y la dispersión de la evidencia de preparación comercial entre scripts, runbooks y `PROJECT_STATUS.md`.

## Revisión de arquitectura

### Aislamiento del test

La corrección debe vivir en el fixture de integración, no en producción. El rate limit persistido es una garantía de seguridad y no puede ignorarse ni resetearse globalmente para satisfacer una suite. El test debe generar una clave IP exclusiva para su caso y eliminar únicamente el hash de esa clave al terminar.

### Readiness

El script actual ya separa controles técnicos de bloqueos externos, redacted summaries y precedencia `BLOCKED > WARN > PASS`. No se justifica añadir un servicio, una dependencia o una nueva ruta HTTP. La mejora adecuada es consolidar la interpretación y la evidencia en documentación comprobable, preservando el contrato JSON existente.

### Backups y proveedores

Los runbooks existentes son correctos para local: backup explícito, checksum, target de restauración fijo y advertencia de MinIO/S3. No se debe simular un proveedor externo ni declarar restauración productiva sin evidencia real. Es un bloqueo operacional, no una tarea de código local.

## Riesgos detectados antes de implementación

1. Cambiar la función de rate limit para acomodar tests debilitaría la seguridad y ocultaría el problema.
2. Eliminar toda la tabla `auth_rate_limits` al inicio de la suite destruiría estado ajeno y haría imposible detectar interacción real.
3. Reescribir los conteos históricos sin volver a ejecutar los comandos produciría documentación no verificable.
4. Presentar el gate local como `PASS` completo sería incorrecto mientras runtime productivo y controles externos estén bloqueados.

## Decisiones de revisión

- Aceptar aislamiento por clave + cleanup exacto en el test.
- Ejecutar primero el test dirigido y después `npm run test:integration` completo.
- Mantener `npm run readiness:production:quick` como contrato rápido, con `WARN` intencionales porque no ejecuta comandos.
- Ejecutar `npm run readiness:production:full` después de la corrección y documentar sus conteos exactos.
- Añadir un checklist de lanzamiento que distinga alcance local, bloqueos externos, evidencia requerida y criterios de no publicación.
- No agregar dependencias, servicios ni cambios de schema.

## Criterio de aceptación de la revisión

La especificación es implementable sin decisiones abiertas: el cambio de código se limita al aislamiento de fixtures; la documentación puede verificarse con pruebas de contrato; los bloqueos externos quedan explícitos; y ningún documento usa la palabra “listo” para producción mientras el gate global esté bloqueado.
