# Runbook de preparación para producción

Este checklist separa evidencia técnica local de decisiones que requieren infraestructura, proveedor o aprobación formal. Un resultado local `PASS` no autoriza publicar OCPOOL.

Para el preflight completo con responsables, dependencias y criterios de cierre usa el [checklist consolidado de preparación para lanzamiento](launch-readiness-checklist.md). Este runbook conserva el detalle del gate técnico y sus estados seguros.

## Estados

- `PASS`: el control se ejecutó y la evidencia está disponible en el entorno indicado.
- `BLOCKED`: falta un secreto, proveedor, decisión legal, backup, dominio autenticado o destino de despliegue; el lanzamiento no puede avanzar.
- `WARN`: el control no bloquea el entorno local, pero debe resolverse antes de una operación seria.

## Checks técnicos

| Check | Estado local esperado | Evidencia |
| --- | --- | --- |
| Runtime production policy | `BLOCKED` con `.env.example` | `npm run validate:production` |
| Schema y migraciones | `PASS` | `npm run db:validate`, `npx prisma migrate status` |
| Seed | `PASS` e idempotente | `npm run db:seed` |
| Liveness/readiness | `PASS` con PostgreSQL local | `/api/health` y `/api/ready` |
| Backup verificable | `PASS` sólo después de restaurar en target desechable | `docs/runbooks/backup-restore.md` |
| Dependencias | `PASS` sin vulnerabilidades altas | `npm audit --omit=dev --audit-level=high` |
| Pruebas y build | `PASS` | unitarias, integración, E2E, typecheck, lint y build |

## Ejecución del gate

El comando produce únicamente JSON seguro con IDs estables y resúmenes controlados:

```powershell
npm run readiness:production:quick
npm run readiness:production:full
```

`readiness:production:quick` comprueba el contrato del reporte sin ejecutar herramientas; `readiness:production:full` añade migraciones, seed, integración y build. Un código de salida distinto de cero es obligatorio cuando existe cualquier `BLOCKED`. Los bloqueos externos permanecen visibles aunque toda la evidencia local pase.

## Bloqueos obligatorios antes del lanzamiento

- proveedor SMTP productivo, credenciales gestionadas, SPF, DKIM, DMARC, rebotes y límites;
- proveedor S3/antivirus, cifrado, versionado, cuarentena y restauración;
- dominio, TLS, proxy/WAF, rate limit por origen y configuración confiable de headers;
- backup externo cifrado, RPO/RTO, prueba de recuperación y alertas;
- supervisor del worker, logs redacted, métricas, alertas y procedimiento de rollback;
- revisión legal de privacidad, aceptación digital, auditoría, mensajes transaccionales y retención.

La retención se define por clase de dato y dependencia. No se ejecutan purgas automáticas ni se fijan plazos legales inventados mientras la política no esté aprobada.

## Worker y notificaciones

El supervisor elegido debe ejecutar una sola instancia por entorno lógico, reiniciar ante salida anormal, conservar `SIGTERM` para shutdown limpio y alertar por backlog, edad del evento, fallos permanentes y ausencia del proceso. `SENT` sólo significa aceptación del proveedor; no representa apertura ni lectura.

## Build y reinicio seguro del runtime

No ejecutes `npm run build` sobre el mismo `.next` que está sirviendo un proceso Next/PM2 activo. El build reemplaza chunks con nombres nuevos y un proceso anterior puede conservar HTML que apunta a archivos ya eliminados, provocando respuestas `404` para JavaScript/CSS y dejando la landing sin hidratación.

Las cabeceras que dependen del entorno se resuelven durante el build. En HTTPS productivo, ejecuta el build con el `APP_URL` público real y `NODE_ENV=production`; no uses los valores de `.env.example` para generar el artefacto que servirá el dominio.

Para un despliegue simple de desarrollo controlado, detén o reinicia el proceso después de terminar el build y valida el conjunto completo:

```bash
pm2 restart <id-o-nombre>
curl -fsS https://ocpool.com.mx/api/health
curl -fsS https://ocpool.com.mx/api/ready
```

Para producción con usuarios, el procedimiento preferido es construir en un directorio de release separado (`NEXT_DIST_DIR`), validar sus assets y hacer un cambio atómico de release antes de reiniciar el supervisor. El rollback debe conservar el release anterior y sus chunks; nunca debe borrar el directorio que todavía usa el proceso activo.
