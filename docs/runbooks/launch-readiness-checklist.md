# OCPOOL — Checklist de preparación para lanzamiento

Este checklist consolida la evidencia previa a una eventual publicación. Es un documento operativo; no contiene credenciales, no crea infraestructura y no reemplaza la aprobación del responsable del servicio.

## Regla de decisión

- `PASS`: el control se ejecutó en el entorno indicado y la evidencia se puede localizar.
- `WARN`: el control fue omitido o es una recomendación no bloqueante para local; no debe ocultarse.
- `BLOCKED`: falta una decisión, secreto, proveedor, evidencia, responsable o target operativo.
- Cualquier `BLOCKED` produce exit code distinto de cero y mantiene el lanzamiento cerrado.
- Un `PASS` local no autoriza publicar OCPOOL. Mientras exista un `BLOCKED`, aplica **No publicar**.

## Evidencia local

Ejecutar desde el worktree correcto y adjuntar el resultado seguro del comando, fecha, commit, responsable y observaciones. No copiar conexiones, tokens, rutas internas, cuerpos sensibles ni stack traces.

| Control | Comando o evidencia | Estado | Responsable | Criterio de cierre |
|---|---|---|---|---|
| Runtime productivo | `npm run validate:production` | `BLOCKED` local por configuración de desarrollo | Ingeniería | Variables reales aprobadas y política sin bloqueos |
| Schema | `npm run db:validate` | Pendiente de preflight | Ingeniería | Prisma schema válido |
| Migraciones | `npm run db:migrate:deploy` | Pendiente de preflight | Ingeniería/Operación | Migraciones aplicadas sin drift |
| Seed | `npm run db:seed` | Pendiente de preflight | Ingeniería | Seed idempotente y controlado |
| Typecheck | `npm run typecheck` | Pendiente de preflight | Ingeniería | Sin errores TypeScript |
| Unitarias | `npm run test:unit` | Pendiente de preflight | Ingeniería | Suite completa aprobada |
| Integración | `npm run test:integration` | Pendiente de preflight | Ingeniería | PostgreSQL local, fixtures aislados y suite completa aprobada |
| Contenido | `npm run test:content` | Pendiente de preflight | Producto/Ingeniería | Contrato editorial aprobado |
| Lint | `npm run lint` | Pendiente de preflight | Ingeniería | Sin errores ni warnings no aceptados |
| Build | `npm run build` | Pendiente de preflight | Ingeniería | Build reproducible y rutas esperadas presentes |
| Dependencias | `npm audit --omit=dev --audit-level=high` | Pendiente de preflight | Ingeniería | Sin vulnerabilidades altas o críticas sin excepción aprobada |
| Liveness/readiness | `/api/health` y `/api/ready` | Pendiente de preflight | Operación | Liveness y dependencias críticas responden según contrato |
| Backup/restore local | [backup y restauración](backup-restore.md) | Pendiente de ejecución operativa | Ingeniería/Operación | Backup con checksum y restore en `ocpool_restore_verify` comprobado |
| Diff | `git diff --check` y árbol limpio | Pendiente de preflight | Ingeniería | Sin whitespace errors ni cambios no revisados |

### Secuencia recomendada

```powershell
npm run db:validate
npm run db:migrate:deploy
npm run db:seed
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:content
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Después ejecutar:

```powershell
npm run readiness:production:quick
npm run readiness:production:full
```

El reporte JSON del gate es la fuente de conteos del preflight. El resumen debe registrar `PASS`, `WARN`, `BLOCKED`, fecha, commit y cualquier fallo; nunca se debe transformar un exit code bloqueado en aprobado manual.

## Bloqueos externos

Cada fila necesita una decisión aprobada, evidencia verificable, responsable y fecha de revisión. `BLOCKED` es el estado correcto mientras el dato no exista.

| Control | Estado base | Dependencia | Responsable | Criterio de cierre |
|---|---|---|---|---|
| SMTP productivo | `BLOCKED` | Proveedor, límites, secretos y autenticación de dominio | Operación/Producto | Envío real controlado, rebotes, límites y alertas comprobados |
| Dominio, TLS, SPF, DKIM, DMARC, proxy/WAF | `BLOCKED` | DNS, certificado y perímetro confiable | Operación | Dominio autenticado y headers/origen confiables verificados |
| Antivirus y cuarentena | `BLOCKED` | Proveedor, integración y recuperación | Seguridad/Operación | Evasiones, cuarentena, reintentos y restauración probados |
| Backup externo | `BLOCKED` | Proveedor, cifrado, retención técnica y target aislado | Operación | Recuperación periódica comprobada |
| RPO/RTO | `BLOCKED` | Aprobación del responsable del servicio | Producto/Operación | Valores aprobados y prueba alineada con ellos |
| Retención y privacidad | `BLOCKED` | Revisión legal por clase de dato | Legal/Producto | Política firmada, sin purga inventada |
| Destino, supervisor y rollback | `BLOCKED` | Hosting, proceso web/worker y observabilidad | Operación | Despliegue repetible, alertas y rollback probado |
| Aceptación y términos | `BLOCKED` | Revisión jurídica y política de firma | Legal/Producto | Copy, evidencia y alcance aprobados |

## No publicar

No se debe publicar cuando:

- el reporte `readiness:production:full` tiene cualquier `BLOCKED` técnico;
- runtime, secretos, SMTP, dominio, storage/antivirus, backups, retención, destino, supervisor, observabilidad o legal no tienen evidencia aprobada;
- el backup no se puede restaurar en un destino aislado o no hay RPO/RTO aprobado;
- la suite de integración no es reproducible dos veces consecutivas;
- existen cambios del worktree no revisados o no existe rollback comprobado.

## Cierre de preflight

El responsable debe registrar:

1. commit exacto revisado;
2. fecha y entorno del preflight;
3. JSON seguro de `quick` y `full`;
4. lista de comandos y pruebas ejecutadas;
5. riesgos aceptados, nunca ocultos;
6. decisiones externas adjuntas;
7. autorización formal independiente de este repositorio.

La fase local puede cerrarse con evidencia técnica completa, pero este checklist no convierte por sí mismo a OCPOOL en un producto autorizado para lanzamiento.
