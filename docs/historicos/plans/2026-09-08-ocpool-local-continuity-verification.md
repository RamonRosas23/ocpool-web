# OCPOOL Local Continuity Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ejecutar y documentar el backup/restore local aislado de PostgreSQL sin tocar la base de desarrollo ni declarar continuidad productiva.

**Architecture:** Reutilizar los scripts existentes y el servicio PostgreSQL de Docker. Los dumps se generan bajo `.artifacts/backups/`, se excluyen de Git, se restauran sólo en `ocpool_restore_verify` y se eliminan después de capturar la verificación.

**Tech Stack:** PowerShell, Docker Compose, PostgreSQL 16, scripts existentes de backup/restore y Markdown.

**Spec:** `docs/historicos/specs/2026-09-08-ocpool-local-continuity-verification.md`

## Global Constraints

- No tocar `ocpool_dev` con comandos destructivos.
- No aceptar destinos o URLs desde formularios o variables ambiguas.
- No versionar dumps, checksums ni datos derivados.
- No afirmar backup externo, RPO/RTO o recuperación productiva.
- Mantener el orden documental y registrar evidencia segura.

---

### Task 1: Proteger artefactos locales

**Files:**
- Modify: `.gitignore`

  - [x] **Step 1: Añadir la exclusión exacta**

  Añadir `/\.artifacts/` junto a las exclusiones de artefactos locales, sin ignorar otras rutas del proyecto.

  - [x] **Step 2: Verificar que la ruta queda ignorada**

  Run: `git check-ignore -v .artifacts/backups/verification.sql`

  Expected: `.gitignore` reporta la regla `/\.artifacts/`.

### Task 2: Separar la preparación DDL del target de restore

**Files:**
- Modify: `scripts/db-restore-verify.ps1`
- Modify: `tests/unit/runbook-contract.test.ts`

- [x] **Step 1: Escribir el contrato que reproduce la restricción PostgreSQL**

  Añadir un test que exija comandos separados para terminar conexiones, eliminar la base y crearla, con `-v ON_ERROR_STOP=1` en cada invocación. El contrato debe rechazar una única variable SQL que concatene `DROP DATABASE` y `CREATE DATABASE`.

- [x] **Step 2: Ejecutar el contrato antes del cambio**

  Run: `npx vitest run tests/unit/runbook-contract.test.ts`

  Expected: falla el nuevo caso porque el script actual concatena las tres operaciones en una sola llamada `psql -c`.

- [x] **Step 3: Implementar el cambio mínimo**

  Separar en tres variables SQL y tres llamadas `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 ... -c`, manteniendo el target literal derivado internamente como `ocpool_restore_verify`. Cada fallo debe producir el mismo mensaje seguro de preparación y nunca imprimir la conexión.

- [x] **Step 4: Ejecutar el contrato después del cambio**

  Run: `npx vitest run tests/unit/runbook-contract.test.ts`

  Expected: `8/8` contratos aprobados.

### Task 3: Ejecutar backup y restore verificable

**Files:**
- Use: `scripts/db-backup.ps1`
- Use: `scripts/db-restore-verify.ps1`
- Use: `docs/runbooks/backup-restore.md`

- [x] **Step 1: Confirmar servicios y migraciones**

  Run: `docker compose ps`

  Expected: `postgres` está activo; Mailpit/MinIO no se modifican.

  Run: `npm run db:migrate:deploy`

  Expected: 17 migraciones al día.

- [x] **Step 2: Crear un backup único**

  Run: `pwsh -File .\scripts\db-backup.ps1 -OutputPath .artifacts\backups\ocpool-dev-2026-09-08T1520Z.sql`

  Expected: JSON `PASS` con `backupPath`, `checksumPath` y SHA-256; ningún secreto en salida.

- [x] **Step 3: Restaurar sólo en target desechable**

  Run:

  ```powershell
  pwsh -File .\scripts\db-restore-verify.ps1 `
    -BackupPath .artifacts\backups\ocpool-dev-2026-09-08T1520Z.sql `
    -ConfirmLocalDisposable I_UNDERSTAND_LOCAL_DISPOSABLE_TARGET
  ```

  Expected: JSON `PASS`, `targetDatabase` igual a `ocpool_restore_verify` y conteo de tablas públicas.

- [x] **Step 4: Eliminar sólo la base de verificación**

  Run: `docker compose exec -T postgres psql -U ocpool -d postgres -c "DROP DATABASE IF EXISTS ocpool_restore_verify;"`

  Expected: se elimina sólo `ocpool_restore_verify`; `ocpool_dev` no se toca.

### Task 4: Registrar y cerrar

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `docs/historicos/plans/2026-09-08-ocpool-local-continuity-verification.md`

- [x] **Step 1: Verificar cleanup de artefactos y árbol**

  Confirmar que el dump no aparece en `git status` por `.gitignore`, que no existe `ocpool_restore_verify` y que `git diff --check` pasa.

- [x] **Step 2: Registrar evidencia segura**

  Añadir comandos, resultado, migraciones y target verificado; no añadir dump, checksum completo, PII ni SQL.

- [x] **Step 3: Commit lógico**

  ```bash
  git add .gitignore PROJECT_STATUS.md docs/historicos/specs/2026-09-08-ocpool-local-continuity-verification.md docs/historicos/reviews/2026-09-08-ocpool-local-continuity-verification-review.md docs/historicos/plans/2026-09-08-ocpool-local-continuity-verification.md
  git commit -m "docs: verify local backup restoration"
  ```

## Gate final

- [x] Backup con checksum aprobado.
- [x] Restore aislado en `ocpool_restore_verify` aprobado.
- [x] Cleanup exacto aprobado.
- [x] Artefactos ignorados y árbol limpio.
- [x] Status distingue continuidad local de DR productivo pendiente.

## Evidencia final

- `docker compose ps` — PostgreSQL, Mailpit y MinIO saludables.
- `npm run db:migrate:deploy` — 17 migraciones, sin pendientes.
- `pwsh -File .\\scripts\\db-backup.ps1 -OutputPath .artifacts\\backups\\ocpool-dev-2026-09-08T1520Z.sql` — `PASS` con checksum SHA-256.
- Primer restore — falló porque el script concatenaba `SELECT + DROP DATABASE + CREATE DATABASE` en una sola llamada `psql -c`; PostgreSQL rechazó `DROP DATABASE` dentro de una transacción.
- Contrato rojo/verded: `npx vitest run tests/unit/runbook-contract.test.ts` pasó de `7/8` a `8/8` después de separar las tres llamadas DDL.
- Restore corregido — `PASS` en `ocpool_restore_verify`; verificación posterior reportó `35` tablas públicas.
- Cleanup — `DROP DATABASE IF EXISTS ocpool_restore_verify` pasó; la consulta posterior muestra únicamente `ocpool_dev` entre los targets verificados.
- `npm run typecheck` — correcto.
- `npm run lint` — correcto.
- `npm run test:unit` — `31 archivos / 116 pruebas` aprobadas.
- `git check-ignore` y `git diff --check` — correctos; el dump quedó ignorado y no aparece en cambios versionables.
- Continúan fuera de alcance: backup externo, objetos MinIO/S3 productivos, RPO/RTO y retención legal.
