# Runbook de desarrollo local

Este documento describe la recuperación segura del entorno local de OCPOOL. Los comandos están pensados para PowerShell en Windows.

## Puertos ocupados

Los servicios usan estos puertos:

- Next.js: `3000`.
- PostgreSQL: `55432`.
- SMTP Mailpit: `11025`.
- UI Mailpit: `18025`.

Identifica el proceso que ocupa un puerto antes de detenerlo:

```powershell
Get-NetTCPConnection -LocalPort 55432 -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 18025 -ErrorAction SilentlyContinue
```

No detengas procesos desconocidos. Si el puerto pertenece a otro proyecto, apaga ese proyecto o coordina un cambio de puertos explícito en `docker-compose.yml` y `.env`.

## PostgreSQL todavía no está listo

Comprueba el estado y los logs:

```powershell
docker compose ps
docker compose logs postgres
docker compose exec -T postgres pg_isready -U ocpool -d ocpool_dev
```

Es normal que el primer arranque tarde mientras se inicializa el volumen. Espera a que el estado sea `healthy` y repite `npm run db:validate` o el comando que falló.

## Falta `DATABASE_URL`

Confirma que existe el archivo local:

```powershell
Test-Path .env
Copy-Item .env.example .env
node scripts/require-env.mjs DATABASE_URL
```

No copies credenciales reales a `.env.example`. El valor local esperado apunta a `localhost:55432`.

## Cliente Prisma no generado

Regenera el cliente a partir del schema:

```powershell
npm run db:generate
npm run db:validate
```

`src/generated/prisma/` es salida generada y está excluida de Git. No la confirmes manualmente.

## Migración ya aplicada

Para un checkout normal, usa:

```powershell
npm run db:migrate:deploy
npm run db:seed
```

No edites una migración ya aplicada. Si el schema cambió, crea una nueva migración con `npx prisma migrate dev --name descripcion-corta`, inspecciona el SQL y confirma el resultado junto con el schema.

## Mailpit no está disponible

Comprueba el contenedor y su API:

```powershell
docker compose ps mailpit
docker compose logs mailpit
Invoke-WebRequest http://localhost:18025/api/v1/info
```

Si el contenedor no está levantado, ejecuta `npm run db:up`. Mailpit es un servicio local de desarrollo; no sustituye la configuración de correo transaccional de producción.

## Restablecer únicamente los datos locales desechables

Esta operación elimina todos los datos de desarrollo guardados en el volumen Docker `ocpool-postgres-data`. Requiere confirmación explícita del desarrollador responsable porque no es recuperable desde el entorno local:

```powershell
docker compose down
docker volume rm ocpool_ocpool-postgres-data
docker compose up -d postgres mailpit
npm run db:migrate:deploy
npm run db:seed
```

Verifica el nombre exacto con `docker volume ls` antes de eliminarlo. No uses este procedimiento contra una base de datos compartida, staging o producción.
