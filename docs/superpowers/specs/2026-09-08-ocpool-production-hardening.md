# Fase 10 — Especificación de hardening operativo y preparación para producción

## Propósito

Esta fase convierte la plataforma local verificada en un sistema técnicamente preparado para una futura infraestructura de producción, sin declarar lanzamiento ni inventar decisiones que pertenecen al negocio, jurídico o proveedor de infraestructura.

El objetivo es cerrar controles técnicos repetibles: configuración segura de runtime, cabeceras HTTP, readiness, operación del worker, backups verificables, ciclo de vida de datos documentado y una compuerta de salida que falle de forma explícita cuando falte una decisión crítica.

## Estado de partida

- Las Fases 1–9 tienen implementación local, pruebas y documentación.
- PostgreSQL es la fuente transaccional; el worker de notificaciones usa claims y leases en PostgreSQL.
- El canal de correo productivo, SPF/DKIM/DMARC, retención legal, backups productivos, antivirus productivo y destino de despliegue siguen sin seleccionarse.
- El entorno local usa credenciales y endpoints de desarrollo en `.env.example`; esos valores no deben poder pasar silenciosamente a producción.

## Alcance

### 1. Política de runtime seguro

Se añadirá una validación explícita para el arranque de producción. La validación deberá rechazar:

- `APP_URL` no HTTPS o apuntando a localhost, loopback o dominios de desarrollo.
- Claves de cifrado iguales a las claves conocidas de `.env.example`.
- SMTP local o inseguro en producción, y ausencia de credenciales cuando el proveedor las requiere.
- Storage S3 local/MinIO o credenciales de desarrollo en producción.
- Configuración de proxy confiable incoherente con el contrato de rate limiting.

El build local seguirá siendo reproducible con `.env.example`; la validación se ejecutará en el comando explícito de arranque/validación de producción y no bloqueará `npm run build` local.

### 2. Cabeceras y readiness

La aplicación añadirá cabeceras HTTP defensivas compatibles con la landing, portal, staff, API y PDF: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, protección contra framing y HSTS sólo bajo HTTPS de producción. Las rutas privadas conservarán `no-store` y no se cambiarán por headers globales.

Se añadirá un endpoint de readiness separado de `/api/health`. El readiness comprobará sólo dependencias necesarias para aceptar tráfico, devolverá `200` o `503`, `requestId`, estados agregados y nunca credenciales, SQL, stack traces ni rutas internas.

### 3. Operación del worker

El worker continuo conservará apagado limpio con `SIGINT`/`SIGTERM`, batch limitado, leases y logs redacted. La documentación fijará el contrato de supervisión: un supervisor externo reinicia el proceso, no se arrancan dos instancias por accidente en el mismo entorno y `SENT` no significa lectura.

No se añadirá Redis, un broker ni un microservicio adicional sin evidencia de volumen o contención. La compuerta local verificará el one-shot y la finalización limpia del proceso; la alta disponibilidad de producción queda condicionada al supervisor elegido.

### 4. Backups y ciclo de vida

Se documentará backup/restauración de PostgreSQL y objetos privados con procedimientos locales seguros, verificación de integridad y restauración en destino desechable. Las operaciones destructivas exigirán un target explícito y confirmación inequívoca.

La retención se documentará por clase de dato y dependencia, pero no se elegirán plazos legales inventados ni se ejecutará purga destructiva hasta que exista una política aprobada. Los campos sensibles seguirán sin copiarse a logs, métricas ni backups de prueba no protegidos.

### 5. Gate de preparación

Un script de readiness de producción y el runbook deberán distinguir:

- `PASS`: controles técnicos comprobables en el entorno indicado.
- `BLOCKED`: falta una decisión o secreto obligatorio.
- `WARN`: control recomendado que no bloquea el entorno local.

El resultado será auditable y no expondrá valores de secretos. El gate no autorizará publicación por sí mismo; sólo proporcionará evidencia y bloqueará configuraciones inseguras.

## Fuera de alcance explícito

- Seleccionar proveedor comercial de correo, storage, antivirus, observabilidad o hosting.
- Fijar términos jurídicos, plazos de retención o validez de firma.
- Publicar la aplicación o modificar DNS, SPF, DKIM, DMARC, WAF o cuentas cloud.
- Agregar Redis, colas externas o microservicios por anticipación.
- Ejecutar purgas irreversibles en la base local o en objetos privados.

## Criterios de terminado

1. Una configuración local no puede presentarse como configuración de producción válida.
2. Las cabeceras defensivas tienen pruebas automatizadas y no rompen las superficies existentes.
3. Readiness diferencia aplicación viva de dependencias disponibles y usa respuestas públicas seguras.
4. El worker mantiene shutdown, leases, reintentos y logs redacted con pruebas reproducibles.
5. Backup y restauración están documentados, verificables y protegidos contra targets ambiguos.
6. El ciclo de vida declara qué queda pendiente por decisión legal y no purga por inferencia.
7. El gate de producción devuelve un resultado explícito, no revela secretos y se integra en README/runbooks.
8. Unitarias, integración, E2E, typecheck, lint, build, audit y diff check permanecen verdes.

## Riesgos aceptados temporalmente

- La ausencia de proveedor productivo, DNS autenticado, backup externo y supervisor de procesos mantiene bloqueado el lanzamiento.
- El scanner local de archivos sigue siendo validación de firma/tipo/hash, no antivirus.
- Las métricas agregadas actuales son diagnóstico operativo; no sustituyen alertas, trazas ni retención de logs de producción.
