# Runbook de backup y restauración local

Este procedimiento sirve únicamente para el entorno Docker local de OCPOOL. No usa credenciales de producción ni autoriza restaurar sobre una base compartida.

## Backup PostgreSQL

El backup se escribe en una ruta explícita que no exista previamente y genera un checksum SHA-256 al lado:

```powershell
New-Item -ItemType Directory -Path .artifacts\backups -Force
pwsh -File .\scripts\db-backup.ps1 -OutputPath .artifacts\backups\ocpool-dev-2026-09-08.sql
```

Usa nombres únicos con fecha y hora UTC cuando generes más de un backup, por ejemplo `ocpool-dev-2026-09-08T0915Z.sql`.

El script usa `pg_dump` dentro del contenedor `postgres`, no imprime la conexión ni credenciales y no sobrescribe un archivo existente. Conserva el archivo `.sha256` para verificar integridad antes de restaurar.

## Restauración verificable

La restauración exige un destino fijo y desechable (`ocpool_restore_verify`) y una confirmación literal. Nunca se ejecuta contra `ocpool_dev` ni contra una URL recibida desde un formulario:

```powershell
pwsh -File .\scripts\db-restore-verify.ps1 `
  -BackupPath .artifacts\backups\ocpool-dev-2026-09-08.sql `
  -ConfirmLocalDisposable I_UNDERSTAND_LOCAL_DISPOSABLE_TARGET
```

El script valida el checksum si existe, recrea únicamente la base de verificación, restaura con `ON_ERROR_STOP=1` y consulta el número de tablas públicas. La base `ocpool_restore_verify` queda disponible para inspección; elimínala sólo verificando el nombre exacto:

```powershell
docker compose exec -T postgres psql -U ocpool -d postgres -c "DROP DATABASE IF EXISTS ocpool_restore_verify;"
```

## Objetos privados

Los objetos de MinIO/S3 no se respaldan copiando el volumen mientras el servicio está escribiendo. Para producción se deberá seleccionar el mecanismo de versionado/snapshot del proveedor, cifrado, retención y restauración, y probarlo en un destino aislado. El contrato de aplicación exige bucket privado, keys opacas y URLs efímeras; un backup no cambia esas reglas.

## Bloqueos de lanzamiento

Antes de producción deben existir, con evidencia:

- backup externo cifrado y recuperación periódica comprobada;
- RPO/RTO aprobados por el responsable del servicio;
- política de retención legal para datos comerciales, auditoría, notificaciones y objetos;
- proveedor de storage con versionado, borrado protegido y restauración verificable;
- monitoreo de edad del backup, fallos y espacio disponible.

No se agrega una tarea de purga ni se asignan plazos legales desde este runbook.
