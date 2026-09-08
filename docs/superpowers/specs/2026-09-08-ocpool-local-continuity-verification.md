# OCPOOL — Especificación de verificación de continuidad local

## Propósito

Ejecutar por primera vez el flujo local de backup y restauración verificable de PostgreSQL, con evidencia reproducible y sin poner en riesgo `ocpool_dev`. El objetivo es cerrar el pendiente operativo local; no es una prueba de backup productivo ni de objetos MinIO/S3 externos.

## Alcance

- Proteger los artefactos locales generados por backup para que nunca se confirmen accidentalmente.
- Generar un dump con ruta explícita y checksum SHA-256.
- Restaurarlo con `db-restore-verify.ps1` exclusivamente en `ocpool_restore_verify`.
- Confirmar que la restauración termina con `ON_ERROR_STOP=1` y crea tablas públicas.
- Eliminar sólo la base desechable y conservar evidencia textual segura en el status.

## Fuera de alcance

- Restaurar sobre `ocpool_dev`.
- Probar proveedores de backup externo, cifrado KMS, RPO/RTO aprobados o snapshots de MinIO.
- Inventar retención legal o configurar purgas.
- Publicar, modificar secretos o apagar servicios compartidos.

## Invariantes de seguridad

1. El backup usa un nombre único y no sobrescribe un archivo existente.
2. El restore exige `I_UNDERSTAND_LOCAL_DISPOSABLE_TARGET` y el target fijo `ocpool_restore_verify`.
3. Nunca se acepta `DATABASE_URL` desde entrada del usuario.
4. El artefacto y checksum quedan fuera de Git; el status sólo registra resultado, no datos sensibles.
5. La base de desarrollo se comprueba antes y después con liveness/migraciones; el target de verificación se elimina usando el nombre exacto.

## Restricción PostgreSQL descubierta

`DROP DATABASE` no puede ejecutarse dentro de un bloque transaccional. El script debe enviar la terminación de conexiones, el `DROP DATABASE` y el `CREATE DATABASE` como comandos `psql -c` separados, manteniendo `ON_ERROR_STOP=1`; concatenarlos en una sola cadena produce un fallo operativo aunque el target sea seguro.

## Criterio de terminado

La fase queda terminada para continuidad local cuando el backup, checksum, restauración aislada, verificación posterior y cleanup exacto pasan; los scripts/runbooks permanecen cubiertos por contrato; y el status conserva la distinción entre continuidad local verificada y controles productivos aún bloqueados.
