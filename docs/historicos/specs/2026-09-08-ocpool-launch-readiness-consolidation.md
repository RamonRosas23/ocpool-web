# OCPOOL — Especificación de consolidación de preparación para lanzamiento

## 1. Propósito

Consolidar la evidencia local de calidad y los bloqueos externos de lanzamiento, corregir la contaminación de estado que vuelve no determinista la suite de integración y dejar un checklist operativo único, auditable y honesto. Esta fase no publica OCPOOL ni convierte decisiones de proveedor, infraestructura o legal en supuestos de código.

## 2. Contexto verificado

- Fases 1–15 están implementadas para el alcance local y el árbol parte limpio.
- `npm run readiness:production:quick` reporta `7 BLOCKED` externos y `2 WARN` técnicos omitidos por diseño.
- `npm run readiness:production:full` reportó `10 PASS`, `0 WARN` y `9 BLOCKED`: el build, schema, migraciones, seed, unitarias, typecheck, lint, contenido, auditoría y documentación pasan; la política de runtime local y la integración quedaron bloqueadas en esa ejecución.
- La repetición aislada de `tests/integration/customer-auth-invitation.test.ts` reproduce una falla en la activación porque el bucket persistido `customer-magic-link-consume-ip` para `127.0.0.1` queda bloqueado entre ejecuciones. El test no limpia ese recurso y usa un timestamp fijo anterior al estado persistido.
- El backup/restauración local existe y está protegido por target desechable; no existe evidencia automática de recuperación externa ni autorización de publicación.

## 3. Objetivos

1. Hacer deterministas y repetibles los tests de invitación de cliente sin debilitar el rate limit productivo.
2. Mantener una separación explícita entre evidencia técnica local y prerequisitos externos.
3. Reconciliar el checklist y `PROJECT_STATUS.md` con conteos y comandos realmente ejecutados.
4. Documentar un recorrido único de preflight, evidencia, bloqueos, responsables y criterio de salida.
5. Agregar contratos documentales para impedir que el checklist vuelva a perder la distinción entre `PASS`, `WARN` y `BLOCKED`.

## 4. Alcance

### Incluido

- Aislamiento y cleanup del estado de rate limit usado por la integración de magic links.
- Pruebas dirigidas de la regresión y suite de integración completa posterior.
- Checklist operativo de lanzamiento con evidencia técnica local, controles externos, dependencia y responsable por decisión.
- Actualización de runbooks, README, plan y `PROJECT_STATUS.md` con evidencia fresca.
- Revisión de que los scripts de readiness mantengan salida segura, IDs estables y código de salida bloqueante.

### Fuera de alcance

- Elegir proveedor SMTP, storage antivirus, DNS/WAF, hosting, observabilidad externa o backups externos.
- Definir plazos legales de retención, términos contractuales o nivel de firma.
- Publicar el sistema, registrar dominios, crear secretos reales o borrar datos locales.
- Añadir Redis, microservicios o supervisores productivos sin una decisión operativa aprobada.

## 5. Criterios de diseño

### Pruebas reproducibles

Los tests que ejercitan rate limit persistido deben usar claves aisladas por caso o limpiar exactamente la clave creada. No se modifican límites globales ni se desactiva la protección para hacer pasar la suite. Las fechas de prueba deben ser compatibles con el estado que crean o deben limpiar el bucket correspondiente.

### Gate honesto

- `PASS` significa evidencia ejecutada y disponible.
- `WARN` significa control omitido o recomendación no bloqueante para el entorno local.
- `BLOCKED` significa que falta una decisión, secreto, proveedor, target operativo o evidencia obligatoria.
- Cualquier `BLOCKED` conserva exit code distinto de cero.
- El reporte no incluye conexiones, secretos, rutas internas ni stack traces.

### Evidencia de salida

La fase sólo puede cerrarse para el alcance local cuando la regresión queda corregida, la integración completa pasa, los scripts de readiness se ejecutan y la documentación refleja los conteos reales. El lanzamiento comercial sigue bloqueado mientras existan controles externos `BLOCKED`.

## 6. Dependencias

- PostgreSQL local y migraciones aplicadas para ejecutar integración.
- Variables de desarrollo válidas, pero no configuración de producción.
- Scripts existentes `production-readiness.mjs`, `validate-production-env.ts`, `db-backup.ps1` y `db-restore-verify.ps1`.
- Runbooks existentes de desarrollo, backups, autenticación, auditoría y producción.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un test compartirá estado persistido y volverá a fallar en una segunda ejecución | clave de rate limit aislada por caso y cleanup exacto en `finally` |
| Un conteo histórico contradirá el reporte actual | registrar los conteos del comando ejecutado junto con fecha, alcance y bloqueo |
| Un `PASS` local se interpreta como autorización de publicación | checklist separa controles técnicos y externos, y mantiene el gate global bloqueado |
| El checklist documenta secretos o targets ambiguos | sólo nombres de control, estado, evidencia y responsable; nunca valores sensibles |
| La restauración local destruye una base de desarrollo | target fijo `ocpool_restore_verify`, confirmación literal y runbook existente |

## 8. Resultado esperado

Un baseline local repetible y documentado: la suite no depende de residuos de ejecuciones anteriores, el reporte de readiness se puede interpretar sin contexto oculto, y el equipo sabe exactamente qué está terminado, qué falta y qué evidencia desbloquea el siguiente paso sin publicar prematuramente.
