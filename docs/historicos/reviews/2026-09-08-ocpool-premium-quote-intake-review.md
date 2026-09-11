# Autorrevisión — Captación premium de solicitudes de cotización

## Alcance revisado

Esta revisión cubre la ampliación de la captación pública desde el formulario de primer contacto hacia una solicitud comercial calificable, sin convertir el formulario anónimo en un portal de cliente ni introducir carga pública de archivos.

## Decisiones verificadas

- La solicitud conserva el expediente relacional existente y agrega columnas nullable con enums PostgreSQL para etapa, horizonte y rango de inversión; no se usa JSON para datos que requieren filtros o reporting.
- Las dimensiones permanecen como texto acotado porque en esta fase son una referencia comercial aproximada, no un cálculo geométrico ni una especificación técnica.
- El endpoint conserva same-origin, límite de body, rate limiting, idempotencia y respuesta pública mínima `{ accepted, folio }`.
- El honeypot sólo rechaza valores no vacíos con un error genérico; no se añade CAPTCHA sin evidencia de abuso que justifique la fricción.
- La UI usa dos pasos para reducir carga cognitiva: contacto/alcance mínimo primero y calificación opcional después. Los valores se conservan al regresar y se limpian sólo tras éxito.
- Las proyecciones staff traducen enums mediante mapas controlados y muestran `No indicado` cuando el registro histórico no tiene esos campos.
- No se habilitan adjuntos anónimos en esta fase; el canal seguro existente se mantiene para expedientes con sesión y permisos.

## Riesgos revisados

| Riesgo | Mitigación | Estado |
| --- | --- | --- |
| Datos históricos sin calificación | Columnas nullable y fallback visual | Controlado |
| Replay por doble clic o retry | `Idempotency-Key` existente, estable durante el envío | Controlado |
| Spam automatizado | Honeypot, rate limit y validación server-side | Controlado localmente; monitoreo productivo pendiente |
| Exposición de información interna | El endpoint no devuelve IDs ni hashes; staff usa permisos existentes | Controlado |
| Fricción excesiva en captación | Calificación opcional y formulario progresivo | Controlado por E2E y revisión UX |
| Consentimiento/legal | Se mantiene consentimiento explícito; aviso de privacidad requiere revisión jurídica antes de producción | Pendiente externo |
| Acceso posterior del cliente | La creación de cliente/contacto no crea todavía usuario portal automáticamente | Pendiente de onboarding |

## Evidencia requerida para cerrar la fase

- Migración aplicada y schema Prisma generado.
- Pruebas unitarias de contratos, integración de API/servicios/proyecciones y E2E del flujo de navegador.
- Typecheck, lint, contrato de contenido, build, auditoría de dependencias y `git diff --check`.
- README, runbook local, runbook de superficies de acceso, `PROJECT_STATUS.md` y este plan actualizados.

## No-go explícitos

La fase no autoriza publicación por sí sola. El lanzamiento continúa bloqueado hasta cerrar onboarding de usuario cliente, revisión legal, proveedores productivos, observabilidad, backups, antivirus y destino operativo definidos en el baseline de producción.
