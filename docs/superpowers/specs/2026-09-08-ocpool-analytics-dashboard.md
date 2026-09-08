# Fase 11 — Dashboard y métricas operativas

## Estado

Especificación aprobada en conversación el 2026-09-08. Esta fase define la primera superficie analítica interna de OCPOOL sin convertirla en un sistema BI ni en una fuente paralela de verdad.

## Objetivo

Construir un dashboard interno rápido, seguro y accionable para que el personal autorizado pueda entender el flujo operativo de solicitudes, cotizaciones, aceptación, carga de trabajo y entregas de notificaciones. Las métricas deben derivarse de los datos transaccionales existentes, respetar el alcance RBAC y comunicar claramente periodo, zona horaria, frescura y tamaño de muestra.

El dashboard no autoriza cambios comerciales, no reemplaza el inbox de solicitudes, no expone datos personales innecesarios y no convierte un resultado agregado en evidencia legal, financiera o contable.

## Contexto actual

El sistema ya tiene:

- solicitudes persistidas con estados, historial, asignación y origen;
- cotizaciones versionadas con líneas snapshot, estados, importes enteros y aceptación;
- conversaciones, mensajes, archivos privados y documentos generados;
- entregas de notificaciones con estados, intentos, leases y salud operativa;
- autorización backend para empleados, roles `sales`, `manager` y `admin`;
- PostgreSQL como fuente de verdad y Prisma como acceso transaccional;
- superficies staff en `/staff/requests`, `/staff/quotes`, `/staff/catalog` y `/staff/notifications`.

No existe todavía un módulo analítico formal ni una ruta `/staff` raíz. Esta fase añadirá ese módulo sin reescribir las superficies existentes.

## Alcance de la primera versión

### Incluido

1. Dashboard staff en `/staff` con navegación coherente hacia las superficies existentes.
2. Rango temporal seguro con fecha inicial inclusiva y fecha final exclusiva.
3. Resumen de solicitudes:
   - recibidas en el periodo;
   - solicitudes sin asignar;
   - distribución por estado;
   - distribución por origen;
   - antigüedad de solicitudes abiertas en buckets operativos.
4. Resumen comercial:
   - cotizaciones enviadas en el periodo;
   - cotizaciones aceptadas en el periodo;
   - tasa de aceptación expresada en basis points y porcentaje formateado;
   - total de cotizaciones aceptadas usando la moneda explícita y sin convertir monedas;
   - distribución de estados de versiones.
5. Flujo operativo:
   - tiempo de creación a primera asignación;
   - tiempo de creación a primera cotización enviada;
   - tiempo de cotización enviada a aceptación;
   - percentiles P50/P90 sólo cuando el tamaño de muestra sea suficiente;
   - muestra y frescura para cada métrica temporal.
6. Carga por responsable para usuarios con permiso global:
   - solicitudes activas asignadas;
   - solicitudes sin asignar;
   - cotizaciones en borrador/revisión por responsable;
   - edad de la solicitud más antigua.
7. Salud de notificaciones:
   - pendientes, procesando, enviadas, fallidas y canceladas;
   - edad de la entrega pendiente más antigua;
   - fallos terminales del periodo;
   - proveedor/canal limitado a categorías operativas seguras.
8. Estados de UI: carga, vacío, error recuperable, datos parciales, filtros inválidos y ausencia de permiso.
9. Pruebas unitarias, integración, E2E, accesibilidad y consulta segura.

### Fuera de alcance

- reportes financieros, contabilidad, impuestos o reconocimiento de ingresos;
- pronósticos, scoring comercial, IA o recomendaciones automáticas;
- edición de solicitudes, precios, cotizaciones o estados desde el dashboard;
- exportación CSV/PDF o programación de reportes;
- métricas para clientes en el portal;
- comparación multi-moneda o tipo de cambio;
- tabla de rollups, materialized views, Redis, ClickHouse o proveedor BI;
- retención, purga o modificación de datos históricos;
- modificaciones de permisos existentes sin pruebas de regresión explícitas.

## Decisiones de arquitectura

### Opción seleccionada: agregación transaccional acotada

La primera versión calculará métricas mediante consultas agregadas parametrizadas sobre PostgreSQL, dentro de un módulo aislado:

- `src/server/modules/analytics/domain.ts` contendrá tipos, límites, buckets y reglas puras.
- `src/server/modules/analytics/service.ts` coordinará validación, alcance de actor y lectura agregada.
- `src/server/modules/analytics/repository.ts` encapsulará consultas Prisma/raw SQL parametrizadas y proyecciones mínimas.
- `src/app/api/staff/dashboard/route.ts` expondrá el contrato HTTP privado.
- `src/app/staff/page.tsx` y componentes dedicados renderizarán el dashboard.

No se crea una tabla de métricas en esta fase. PostgreSQL ya contiene timestamps, historiales e índices suficientes para el volumen actual. Si las pruebas de `EXPLAIN` o la operación real muestran latencia sostenida, una fase posterior podrá introducir rollups con una decisión y migración separadas.

### Alternativas descartadas por ahora

- Rollups/materialized views: agregan complejidad de refresco, consistencia y backfill antes de tener evidencia de necesidad.
- BI externo: amplía superficie de privacidad, costos, sincronización y gobierno de datos sin resolver primero las métricas base.

## Contrato temporal

- Todas las fechas persistidas permanecen en UTC.
- La API recibe `from` y `to` como fechas ISO con zona o fechas calendario normalizadas por el servidor.
- El intervalo se interpreta como `[from, to)`, con `from < to`.
- El rango máximo es 93 días.
- El rango predeterminado es los últimos 30 días completos según la zona de negocio configurada.
- La zona de presentación se devuelve en el payload para evitar ambigüedad.
- La primera fase no permite que el cliente envíe una zona arbitraria para alterar el alcance; el servidor usa una configuración explícita del entorno.
- Los buckets de antigüedad se calculan contra `now` del servidor y se etiquetan como `0–1`, `2–3`, `4–7`, `8–14`, `15–30` y `31+` días.

La zona de negocio inicial será `America/Chihuahua`, alineada con el entorno actual; antes de producción debe confirmarse como decisión operativa y mantenerse separada de la zona del navegador.

## Contrato de autorización

Se añadirá una capacidad de lectura explícita `dashboard.read` al catálogo RBAC. La ruta no confiará en el frontend:

- `sales` podrá consultar un dashboard de operación limitado a solicitudes y cotizaciones asignadas a ese usuario, además de salud global de notificaciones no sensible;
- `manager` y `admin` podrán consultar agregados globales de operación y carga por responsable;
- usuarios sin `dashboard.read` recibirán `403` genérico;
- clientes y sesiones revocadas nunca accederán a la ruta;
- ninguna dimensión permitirá enumerar IDs, clientes, correos, teléfonos, mensajes, archivos, storage keys o destinatarios.

Si un agregado global tiene menos de 5 observaciones, se devolverá como `suppressed` en lugar de revelar una muestra potencialmente identificable. Esta regla se aplicará a conteos por responsable y métricas temporales; los KPIs operativos generales conservarán su valor cuando no identifiquen personas.

## Contrato de datos seguro

La respuesta tendrá esta forma conceptual:

```ts
type DashboardResponse = {
  meta: {
    from: string;
    to: string;
    timezone: string;
    generatedAt: string;
    freshness: 'fresh' | 'stale';
    scope: 'self' | 'global';
  };
  requests: {
    received: number;
    unassigned: number;
    byStatus: Array<{ status: string; count: number }>;
    byOrigin: Array<{ origin: string; count: number }>;
    aging: Array<{ bucket: string; count: number }>;
  };
  quotes: {
    sent: number;
    accepted: number;
    acceptanceRateBps: number | null;
    acceptedTotals: Array<{ currencyCode: string; totalMinor: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  timing: {
    assignment: MetricSummary;
    quoteSent: MetricSummary;
    acceptance: MetricSummary;
  };
  workload: Array<WorkloadRow>;
  notifications: {
    byStatus: Array<{ status: string; count: number }>;
    oldestPendingAt: string | null;
    failedInPeriod: number;
  };
};

type MetricSummary = {
  sampleSize: number | null;
  p50Seconds: number | null;
  p90Seconds: number | null;
  suppressed: boolean;
};

type WorkloadRow = {
  actorKey: string;
  displayName: string;
  activeRequests: number | null;
  draftQuotes: number | null;
  oldestOpenAt: string | null;
  suppressed: boolean;
};
```

Los nombres de actor serán una proyección mínima de empleado activo autorizada por el backend. `actorKey` será una clave opaca no reversible sólo para renderizado estable; no será un ID interno reutilizable para otras rutas. Cuando `suppressed` sea `true`, las métricas numéricas de esa fila serán `null`. No se devolverán emails, hashes, IDs de cliente, payloads ni datos de contacto. Los importes menores viajarán como strings para conservar `BigInt`; las tasas viajarán como enteros en basis points.

## Consultas y rendimiento

- Todas las consultas usarán límites temporales y filtros de alcance desde el inicio.
- Se evitarán consultas por fila; el servicio reunirá agregados en un número fijo de lecturas.
- Se revisará `EXPLAIN` para solicitudes, historiales, cotizaciones, aceptaciones y notificaciones.
- No se añadirá un índice sólo por intuición; cualquier índice nuevo deberá justificar selectividad, consulta cubierta y costo de escritura.
- La API tendrá límite de frecuencia de lectura y `Cache-Control: no-store` por tratarse de información interna operativa.
- El servidor podrá reutilizar una ventana de lectura dentro de una sola petición, pero no se añadirá cache global compartido en esta fase.
- El objetivo inicial será P95 menor a 500 ms con fixtures representativos locales; si no se alcanza, la fase no se cerrará sin resolver la causa o documentar una decisión explícita.

## UI/UX

El dashboard será una herramienta de operación, no una pared de gráficas:

- encabezado con periodo, zona horaria, alcance y última actualización;
- fila compacta de KPIs con tendencia sólo si el dato es comparable y no ambiguo;
- bloque de alertas accionables para solicitudes sin asignar, solicitudes antiguas, fallos de notificación y cotizaciones detenidas;
- distribución del pipeline con lectura textual accesible además de cualquier visualización;
- tabla de carga para manager/admin y vista propia para sales;
- enlace directo al inbox o módulo correspondiente, sin mutaciones desde tarjetas analíticas;
- controles de periodo con presets de 7, 30 y 90 días más fechas personalizadas válidas;
- skeleton estable, estados vacíos útiles y errores con reintento;
- responsive desde 390 px, foco visible, navegación por teclado, contraste AA y `prefers-reduced-motion`;
- números formateados con locale y moneda explícitos, sin convertir o sumar monedas distintas.

## Seguridad y privacidad

- Sesión y capacidad se validan en cada request.
- Same-origin se aplicará si la ruta evoluciona a mutaciones; la primera versión es sólo lectura.
- No se incluirán PII, contenido de mensajes, archivos, URLs presigned, destinatarios, claves, stack traces ni SQL.
- Los logs registrarán request ID, actor hash/ID interno redacted, rango validado y duración; nunca el payload completo.
- Respuestas de error serán envelopes públicos genéricos.
- La supresión de muestras pequeñas impedirá inferencias sobre un empleado o cliente.
- Los agregados respetarán el scope del actor antes de contar; filtrar en UI será sólo presentación.

## Testing

### Unitarias

- normalización de rangos y fechas límite;
- zona horaria y cortes `[from, to)`;
- buckets de antigüedad;
- tasas en basis points, denominador cero y precisión;
- percentiles con muestras insuficientes y valores extremos;
- serialización de BigInt y monedas separadas;
- supresión de muestras pequeñas;
- estados de frescura y datos parciales.

### Integración PostgreSQL

- agregados con fixtures de varios clientes, empleados, monedas y estados;
- scope `sales` contra registros propios y ajenos;
- `manager/admin` globales y rol sin permiso;
- sesiones revocadas, cliente autenticado e IDOR;
- fechas en los límites del periodo y datos fuera de rango;
- snapshots históricos sin alterarse por cambios posteriores del catálogo;
- notificaciones sin destinatarios ni payloads en la respuesta;
- plan de consultas y ausencia de N+1.

### E2E

- dashboard sin sesión bloqueado;
- dashboard de sales con scope propio;
- dashboard manager con carga global;
- periodo inválido y error recuperable;
- estado vacío y datos parciales;
- responsive 390/768/1440 px;
- Axe, teclado, foco, reduced motion y consola sin errores;
- HTML y payload sin PII o secretos.

## Criterios de terminado

Fase 11 sólo se considerará terminada cuando:

1. El dashboard esté integrado con las rutas staff y no duplique autorización.
2. Todas las métricas tengan definición, fuente, periodo, zona horaria y muestra documentados.
3. Backend y base de datos apliquen el scope antes de agregar.
4. No existan PII, secretos, IDs de cliente, contenido sensible o rutas internas en las respuestas.
5. Las consultas estén parametrizadas, acotadas y revisadas con evidencia de rendimiento.
6. La UI cubra carga, vacío, error, datos parciales, responsive y accesibilidad.
7. Unitarias, integración, E2E, typecheck, lint, build, auditoría y diff check pasen.
8. `PROJECT_STATUS.md`, README y runbook de métricas indiquen qué está medido, qué no y qué riesgos permanecen.
9. No se introduzcan rollups, Redis, BI ni dependencias nuevas sin una decisión posterior basada en evidencia.

## Riesgos aceptados y controles

- **Definiciones ambiguas:** cada métrica tendrá contrato y prueba antes de UI.
- **Datos pequeños:** supresión por muestra y scope estricto.
- **Latencia:** rango máximo, agregaciones fijas, EXPLAIN y objetivo P95.
- **Zona horaria:** UTC persistido, zona del negocio explícita y payload visible.
- **Expectativa de BI:** la interfaz se documentará como operación actual, no como contabilidad ni forecasting.
- **Evolución:** el módulo mantendrá interfaces separadas para permitir rollups futuros sin romper consumidores.
