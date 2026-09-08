# Runbook de preparación para producción

Este checklist separa evidencia técnica local de decisiones que requieren infraestructura, proveedor o aprobación formal. Un resultado local `PASS` no autoriza publicar OCPOOL.

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
