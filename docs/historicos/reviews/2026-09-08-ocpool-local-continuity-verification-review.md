# OCPOOL — Autorrevisión de verificación de continuidad local

## Revisión previa

El repositorio ya contiene scripts PowerShell con controles adecuados: salida explícita sin sobrescritura, checksum, target fijo, confirmación literal y `ON_ERROR_STOP`. El pendiente real es ejecutar el procedimiento y evitar que el dump local aparezca como cambio accidental del repositorio.

## Decisiones

- Añadir `.artifacts/` a `.gitignore` porque contiene dumps y checksums generados localmente.
- Usar una ruta única bajo `.artifacts/backups/` y no versionar el archivo.
- Ejecutar restore sólo después de que el backup y checksum pasen.
- Eliminar `ocpool_restore_verify` únicamente después de capturar la salida de verificación y usando el nombre literal.
- Registrar en documentación el resultado, no el contenido del dump.

## Riesgos revisados

- Un target ambiguo podría destruir la base de desarrollo: mitigado por el script y su confirmación literal.
- Un checksum inválido podría restaurar datos corruptos: mitigado por validación previa.
- Un artefacto con PII podría entrar en Git: mitigado por `.gitignore` y verificación de árbol limpio.
- Una restauración local podría confundirse con DR productivo: mitigado por alcance y bloqueos explícitos.

## Aceptación

La fase es aceptable sin cambios de schema ni nuevas dependencias; la evidencia operacional y el cleanup son suficientes para cerrar el pendiente local, manteniendo abiertos proveedor, retención, RPO/RTO y objetos productivos. La primera ejecución reveló que PostgreSQL rechaza `DROP DATABASE` cuando terminación, drop y create se envían en una sola invocación `psql -c`; el plan incorpora una corrección mínima y una prueba de contrato para impedir esa regresión.
