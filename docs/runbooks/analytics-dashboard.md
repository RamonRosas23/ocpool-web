# Runbook — Dashboard operativo de OCPOOL

## Propósito

El dashboard operativo (`/staff`) ayuda al personal autorizado a priorizar trabajo sobre solicitudes, cotizaciones y entregas de notificaciones. Es una lectura agregada de operación; no es contabilidad, BI, forecasting, autorización comercial ni sustituto del inbox transaccional.

## Superficies y permisos

- `GET /api/staff/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` es una lectura privada y responde `Cache-Control: no-store`.
- Cada empleado tiene un límite configurable mediante `ANALYTICS_RATE_LIMIT_MAX_ATTEMPTS` y `ANALYTICS_RATE_LIMIT_WINDOW_MINUTES`, coordinado en PostgreSQL con el mismo mecanismo de rate limit de identidad.
- `sales` requiere `metrics.read` y recibe `scope: self`: solicitudes/cotizaciones asignadas a ese usuario.
- `manager` y `admin` requieren `metrics.read.global` y reciben `scope: global`.
- Clientes, sesiones revocadas y empleados sin la capacidad reciben una respuesta pública controlada (`401` o `403` según el guard), sin datos de la operación.
- La UI no decide el alcance. El servicio backend valida actor, permiso y scope antes de ejecutar agregados.

## Fechas, zona y frescura

- PostgreSQL conserva timestamps en UTC.
- `from` es inclusivo y `to` exclusivo: `[from, to)`.
- El rango permitido es de 1 a 93 días.
- Sin parámetros se consultan los últimos 30 días completos con la zona configurada en `APP_TIMEZONE`.
- La zona inicial es `America/Chihuahua`; no se acepta una zona enviada por el navegador para cambiar el alcance.
- `meta.generatedAt` indica cuándo se produjo la lectura. `fresh` significa lectura transaccional directa; la fase actual no usa cache global ni rollups.

## Definiciones de métricas

| Bloque | Métrica | Fuente y regla |
| --- | --- | --- |
| Solicitudes | Recibidas | `QuoteRequest.createdAt` dentro del periodo y scope. |
| Solicitudes | Sin asignar | Solicitudes del periodo global cuyo responsable actual es `null`; no se expone en scope propio de ventas. |
| Solicitudes | Pipeline/origen | Agrupación de `status` y `origin` de solicitudes del periodo. |
| Solicitudes | Antigüedad | Solicitudes abiertas contra `now` del servidor en buckets `0–1`, `2–3`, `4–7`, `8–14`, `15–30`, `31+`. |
| Cotizaciones | Enviadas | Transiciones a `ENVIADA` dentro del periodo, respetando solicitudes del scope. |
| Cotizaciones | Aceptadas | Aceptaciones cuyo `acceptedAt` está dentro del periodo. |
| Cotizaciones | Tasa | `accepted / sent`, serializada en basis points; sin denominador devuelve `null`. |
| Cotizaciones | Totales aceptados | Suma de `totalMinor` snapshot por `currencyCode`; nunca convierte ni mezcla monedas. |
| Ritmo | P50/P90 | Segundos entre creación/asignación, creación/envío o envío/aceptación. Se suprime la métrica con menos de 5 observaciones. |
| Carga | Responsable | Solicitudes abiertas y borradores/revisión por empleado activo. Si la suma de observaciones es menor a 5, los valores quedan `null`. |
| Notificaciones | Salud | Estados operativos actuales de Outbox materializado y fallos `FAILED` actualizados dentro del periodo. No expone destinatarios, payloads o ciphertext. |

Los importes menores son strings porque representan `BigInt`. Las tasas y conteos son enteros. La UI formatea sin convertir importes a `number`.

## Operación local

```powershell
docker compose up -d postgres mailpit
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Abrir `http://localhost:3000/staff` con una sesión de empleado. Para un periodo histórico vacío puede usar fechas válidas anteriores, por ejemplo `2020-01-01` a `2020-02-01`.

Para probar el endpoint directamente, usar una sesión ya autenticada y sólo fechas calendario. No copiar respuestas con datos operativos a tickets públicos ni logs compartidos.

## Rendimiento y diagnóstico

La primera versión consulta PostgreSQL directamente, con rango máximo y filtros de scope desde el inicio. El objetivo de diseño es P95 local menor a 500 ms con fixtures representativos. No se añade Redis, BI, materialized view ni tabla de rollup sin evidencia repetible.

Para una revisión segura de rendimiento:

1. Reproducir con un rango acotado y un actor de desarrollo.
2. Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` sólo en un entorno local o de staging autorizado.
3. Sustituir valores reales por parámetros o fixtures sintéticos antes de guardar el plan.
4. No pegar emails, teléfonos, folios comerciales, UUIDs de clientes, payloads, destinatarios o secretos en issues.
5. Justificar cualquier índice por selectividad, consulta cubierta y costo de escritura.

## Seguridad y privacidad

- La ruta es de sólo lectura y no muta solicitudes, precios, cotizaciones o estados.
- El rate limit se aplica después de validar actor, permiso y rango, pero antes de ejecutar agregados; un `429` no revela datos del dashboard.
- Los errores públicos no incluyen SQL, stack traces, rutas internas ni secretos.
- La respuesta no incluye emails, teléfonos, IDs de cliente, mensajes, archivos, storage keys, destinatarios ni payloads.
- La supresión de muestras pequeñas evita inferencias sobre responsables.
- Las métricas no deben usarse como autorización: una acción comercial siempre vuelve a validar permisos y scope en su propia ruta.

## Pruebas

```powershell
npm run typecheck
npm run lint
npx vitest run tests/unit/analytics-domain.test.ts tests/unit/analytics-serialization.test.ts
$env:RUN_DB_TESTS='1'; npm run test:integration
$env:DASHBOARD_E2E='1'; npm run test:e2e -- tests/dashboard.spec.ts
npm run build
```

La E2E del dashboard es opt-in porque crea un empleado desechable y requiere PostgreSQL. Limpia únicamente sus fixtures por ID. El gate de Fase 11 debe ejecutar también la suite oficial de contenido, seguridad, auditoría y E2E base.

## Limitaciones conocidas

- No hay comparación entre periodos ni tendencias: no se agrega una tendencia sin una definición temporal aprobada.
- No hay conversión multi-moneda.
- No hay exportación ni programación de reportes.
- La frescura es transaccional directa; si el volumen exige rollups, se requiere una fase separada con backfill, consistencia y pruebas de latencia.
- La zona `America/Chihuahua` debe confirmarse antes de producción junto con las políticas de calendario comercial.
