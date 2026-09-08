# Runbook de desarrollo local

Este documento describe la recuperación segura del entorno local de OCPOOL. Los comandos están pensados para PowerShell en Windows.

## Puertos ocupados

Los servicios usan estos puertos:

- Next.js: `3000`.
- PostgreSQL: `55432`.
- SMTP Mailpit: `11025`.
- UI Mailpit: `18025`.
- API MinIO: `19000`.
- Console MinIO: `19001`.

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

## Formulario público de cotización

La captación pública vive en la landing, en la sección `/#contacto`, y se completa en dos pasos:

1. Contacto y alcance mínimo: nombre, teléfono, correo, tipo de obra y ubicación.
2. Calificación comercial: etapa del proyecto, medidas aproximadas, horizonte de inicio, rango de inversión opcional y descripción.

El consentimiento para contacto es obligatorio. Al finalizar, la aplicación crea un expediente mediante `POST /api/quote-requests` y muestra un folio `OCQ-YYYY-NNNNNN`. El folio sirve para referencia comercial; nunca funciona como contraseña ni sustituye una sesión del portal.

El endpoint conserva validación server-side, protección same-origin, límite de body, rate limiting, `Idempotency-Key` y errores públicos genéricos. El campo honeypot no debe ser visible ni llenarse manualmente; un valor no vacío se rechaza sin detallar la regla. No se habilitan adjuntos anónimos: los planos, fotografías y documentos deben incorporarse después al expediente mediante el canal privado autorizado.

La solicitud crea cliente/contacto y expediente, pero todavía no crea automáticamente el usuario del portal. El acceso posterior depende del módulo de onboarding y de un usuario cliente activo vinculado; no se deben inventar credenciales de prueba ni usar el folio para entrar.

Para verificar el flujo completo en local, con Docker y la base levantados:

```powershell
npm run db:migrate:deploy
npm run db:seed
npx playwright test tests/quality.spec.ts --grep "public form|first step"
```

La prueba E2E confirma validación del primer paso, conservación al regresar, campos de calificación, respuesta con folio y feedback accesible. La entrega de notificaciones, cuando exista un evento permitido para el expediente, se inspecciona mediante el worker y Mailpit; la captura del formulario no depende de que el navegador envíe correo directamente.

## Worker de notificaciones

El worker se ejecuta como proceso separado y usa PostgreSQL para coordinar claims, leases, reintentos y recuperación de trabajos abandonados:

```powershell
npm run worker:notifications:once
npm run worker:notifications
```

Usa `worker:notifications:once` para una ejecución acotada durante pruebas o diagnóstico. Usa `worker:notifications` para mantenerlo activo; detenlo con `Ctrl+C` y verifica que el proceso termine limpiamente. En local sólo procesa eventos de la allowlist de esta fase y entrega por SMTP a Mailpit. Un estado `SENT` confirma aceptación del proveedor, no apertura ni lectura del mensaje. No agregues Redis ni otro broker sin evidencia de volumen o contención que justifique el cambio.

## MinIO no está disponible

Comprueba el contenedor y su endpoint de salud:

```powershell
docker compose ps minio
docker compose logs minio
Invoke-WebRequest http://localhost:19000/minio/health/live
```

MinIO debe permanecer privado: el navegador sólo recibe URLs efímeras emitidas por la aplicación después de la autorización. No publiques el puerto ni cambies las credenciales locales a valores de producción.

## Identidad y pruebas locales

Después de migrar el schema, ejecuta el seed idempotente para crear el catálogo inicial:

```powershell
npm run db:migrate:deploy
npm run db:seed
```

El seed crea los roles `customer`, `sales`, `manager` y `admin` junto con el catálogo de permisos. No elimina roles o permisos personalizados futuros; sólo sincroniza los registros system-managed.

La configuración de identidad se valida al iniciar el servidor. `MFA_ENCRYPTION_KEY` y `AUTH_DELIVERY_ENCRYPTION_KEY` deben ser claves base64 canónicas de 32 bytes y mantenerse separadas. Los valores de `.env.example` son exclusivamente locales; no los reutilices en staging o producción. `TRUST_PROXY_HEADERS` sólo debe activarse detrás de un proxy que sobrescriba los headers de IP. Cuando no hay IP confiable, el backend aplica un circuit breaker global independiente para reducir abuso computacional; en producción debe existir además un rate limit por IP en el proxy.

Los endpoints de autenticación son:

- `/api/auth/employee/login` para password y MFA TOTP administrativo.
- `/api/auth/customer/request-link` y `/api/auth/customer/consume-link` para magic link de cliente.
- `/api/auth/session` para consulta y logout.
- `/api/auth/recovery/request` y `/api/auth/recovery/consume` para recovery de empleados.

Los mensajes públicos son genéricos para no enumerar cuentas. Los links y sesiones se almacenan únicamente como huellas; el worker materializa los eventos permitidos y Mailpit recibe los mensajes SMTP locales. En esta fase, el Outbox guarda el token de entrega cifrado con `AUTH_DELIVERY_ENCRYPTION_KEY`, nunca en texto plano ni con la clave de MFA; el token sólo se descifra en memoria durante el envío y no aparece en logs, payloads seguros ni respuestas.

La operación staff está disponible en `/staff/notifications`. `notifications.read` permite consultar estados, categorías controladas y salud agregada; `notifications.manage` permite reintentar únicamente fallos recuperables. Las mutaciones exigen same-origin y quedan auditadas.

Para validar el flujo de API con un fixture desechable:

```powershell
npm run test:e2e:auth
```

La prueba crea y elimina su usuario temporal. Si una ejecución se interrumpe, busca únicamente usuarios `e2e-*@example.test` y elimínalos mediante una revisión explícita; no borres toda la base de datos.

Para ejecutar la compuerta local completa:

```powershell
npm test
npm run lint
npm run test:e2e:auth
npm audit --omit=dev
```

`npm test` incluye `npm run typecheck`, pruebas unitarias, integración PostgreSQL, contrato de contenido, build y regresiones E2E públicas/foundation.

## Backup y restauración verificable

Para proteger el trabajo local o comprobar una recuperación, sigue [backup-restore.md](backup-restore.md). El procedimiento genera un checksum y restaura únicamente en `ocpool_restore_verify`, una base desechable que requiere confirmación literal. No restaures sobre `ocpool_dev` ni uses estos comandos con credenciales de producción.

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
