# ADR — Línea base reproducible de la experiencia comercial V2

- **Estado:** `PARTIAL_REPRODUCIBLE`
- **Fecha:** 2026-09-10
- **Owner:** Codex/arquitectura
- **Aprobador pendiente:** responsable de producto OCPOOL
- **Alcance:** G0-03 del plan de rearquitectura comercial
- **Baseline documental:** `d0c5218` (el código de producto no se modifica en este slice)

## Decisión

La línea base se registrará como una matriz de superficies, escenarios, eventos y
métricas, separando explícitamente la evidencia observada sin sesión de la
evidencia autenticada que todavía falta. La matriz machine-readable vive en
[`tests/fixtures/commercial-baseline-v2.ts`](../../tests/fixtures/commercial-baseline-v2.ts)
y no se conecta al runtime hasta que los contratos de G0 estén aprobados. El
mismo fixture expone `validateBaselineMeasurementRecord`, que exige 13 campos
operativos, dimensiones de la matriz, tiempos válidos y rechaza campos PII de
forma recursiva antes de aceptar una muestra sintética.

El helper opt-in [`commercial-baseline-recorder.ts`](../../tests/fixtures/commercial-baseline-recorder.ts)
escribe esas muestras sólo cuando `BASELINE_MEASUREMENTS_E2E=1` y las deja bajo
`test-results/`, nunca en runtime ni en producción.

No se aceptará una métrica sin actor, superficie, viewport, versión de fixture,
commit y evento inicial/final. Los objetivos numéricos permanecen como
`PENDING_PRODUCT_TARGET`; no se inventan metas de conversión, SLA o tiempo.

## Evidencia ya obtenida

Se realizó una inspección local con Chromium en 390 px y 1440 px sobre las rutas
públicas/restringidas siguientes:

| Superficie | Evidencia actual | Límite de la evidencia |
| --- | --- | --- |
| `/login` | La entrada anónima es alcanzable y comunica acceso de empleado. | Falta sesión staff válida para medir la siguiente tarea. |
| `/portal/access` | Distingue solicitar acceso de un cliente nuevo. | Falta invitación/correo realista para medir acceso → decisión. |
| `/staff` | Rechaza correctamente el acceso anónimo. | No mide dashboard, retorno ni densidad de tareas autenticadas. |
| `/staff/requests` | Rechaza correctamente el acceso anónimo. | No mide inbox, expediente ni solicitud → borrador. |
| `/staff/quotes` | Rechaza correctamente el acceso anónimo. | No mide catálogo, builder, preflight ni publicación. |
| `/staff/notifications` | Rechaza correctamente el acceso anónimo. | No mide visibilidad de fallo, retry ni recuperación de entrega. |
| `/portal` | Rechaza correctamente el acceso anónimo. | No mide comprensión, PDF, aceptación ni mensajería. |

Esta evidencia sirve para verificar entradas y estados restringidos; no se
presenta como prueba de los flujos privados. El baseline autenticado requiere
fixtures sintéticos y las capacidades previstas en G0-05.

El comando reproducible `npm run baseline:v2:browser` recorre la landing pública
y las siete superficies privadas en 390, 768 y 1440 px contra `APP_URL`. Con
Chromium ejecutable en `/var/tmp` pasó 24/24 combinaciones: HTTP 200, sin overflow, sin errores de
página ni errores de consola inesperados. Las respuestas 401/403 de superficies
privadas sin sesión se clasifican como esperadas. La evidencia detallada está
en [`g0-03-browser-baseline.md`](../ocpool-commercial-v2/g0-03-browser-baseline.md).

Como evidencia complementaria, `npm run baseline:v2:http` sí puede ejecutarse
sin navegador: comprueba diez rutas, status, tipo de contenido, caché,
`X-Powered-By` y HSTS sin almacenar cuerpos. Esta prueba no certifica UI,
permisos ni flujos autenticados.

La suite autenticada desechable se ejecutó con `E2E_PORT=3110` para no
interferir con el servicio existente en 3100. Los fixtures se crearon y la
limpieza dejó cero usuarios `auth-surface-*`; `tests/auth-surfaces.spec.ts`
pasó 5/5 con login, MFA, magic link, recovery y enlaces inválidos/repetidos.

La validación opt-in más reciente ejecutó la suite pública `35/35` en
`E2E_PORT=3172` y portal + cotizador `3/3` en `E2E_PORT=3173`, con fixtures
desechables. Una repetición del cotizador en un build fresco (`E2E_PORT=3192`)
pasó `1/1` y añadió recorridos de diez conceptos, recuperación de PDF fallido
y resolución de aprobación con dos sesiones staff. Una repetición final del
portal en un build fresco (`E2E_PORT=3193`) pasó `4/4`: aceptación, estado sin
cotización con recuperación de API, cotización vencida con actualización por
conversación y abandono antes de completar la tarea. El registrador emitió
trece tipos de muestra sintética fuera del repositorio:
`public_request_to_confirmation` (4,368 ms), `portal_access_to_decision`
(1,212 ms), `request_to_draft` (7,368 ms), `add_ten_concepts` (1,015 ms),
`publish_quote` (6,667 ms), `document_failure_to_recovery` (1,251 ms),
`delivery_failure_to_recovery` (96 ms), `request_to_next_task` (715 ms) y
`published_to_new_working` (242 ms), `draft_to_approval_resolution` (1,694 ms)
y `workflow_errors` (1,212 ms, `errorCount=1`), `expired_quote_to_next_step`
(347 ms) y `workflow_abandonment` (256 ms, `abandoned=true`). Todas declaran
actor, superficie y viewport, no contienen PII y la muestra de error termina
con éxito; las demás no abandonadas declaran `errorCount=0` y
`abandoned=false`. Verifican el recorder y los trece recorridos instrumentados;
no representan aún objetivos aprobados ni una matriz estadísticamente
suficiente.

### Actualización 2026-09-11 — muestra mínima y objetivos locales

El ADR [`2026-09-11-commercial-g0-03-objectives.md`](2026-09-11-commercial-g0-03-objectives.md)
registra la autorización explícita recibida para aprobar localmente los
objetivos de §29 y una muestra mínima reproducible de `n=5` por métrica. La
selección final reúne 65 registros (`13 × 5`) de corridas independientes con
fixtures desechables: cotizador, portal, solicitudes, notificaciones y
formulario público. Las medianas, p95 y guardrails están en ese ADR.

Esta aprobación es local y parcial: no convierte los recorridos sintéticos en
validación estadística ni en investigación con usuarios. El piloto T1, la
decisión de retención/telemetría y los signoffs fiscal y jurídico continúan
pendientes.

## Escenarios obligatorios

La medición debe cubrir, como mínimo:

1. solicitud nueva;
2. solicitud esperando información del cliente;
3. primer borrador;
4. aprobación requerida;
5. PDF fallido y recuperación;
6. entrega fallida y recuperación;
7. nueva versión conservando la publicada;
8. versión vencida;
9. cotización aceptada.

Cada escenario debe poder reiniciarse de forma idempotente y mantener las
relaciones request → cliente → contacto → versiones → documento/publicación /
aceptación.

## Cobertura actual y bloqueos detectados

El bloqueo P0 de puntero ambiguo tiene ahora un cierre local parcial: la
migración `20260911093000_quote_working_published_pointers` añade
`workingVersionId` y `publishedVersionId`, mantiene compatibilidad temporal con
`currentVersionId` y actualiza los consumidores privados principales. La
retirada del campo legacy y el contrato definitivo siguen sujetos a D1-01/G0.

La instrumentación local cubre trece recorridos: solicitud pública, siguiente
tarea de solicitudes, primer borrador, diez conceptos, publicación,
recuperación de PDF, recuperación de entrega, nueva versión desde una
publicada, decisión del cliente, resolución de aprobación, error recuperable,
cotización vencida con actualización por conversación y abandono antes de
completar la tarea. La cotización vencida no reabre ni muta la evidencia
histórica: orienta al cliente al canal existente del expediente.

El escenario `approval-required` ya tiene un dominio mínimo persistido en local:
`QuoteApproval` registra tipo, política, digest, solicitante, resolutor, vigencia
y estado; la API expone solicitud/decisión y el envío valida una aprobación
vigente cuyo digest coincide. La prueba de integración cubre solicitud
idempotente, autoaprobación, cambio de snapshot y envío final. La métrica
`draft_to_approval_resolution` ya tiene fixture autenticado de navegador con
solicitud y resolución por usuarios distintos (`1,694 ms`, sin error), pero no
se considera baseline aprobada hasta fijar su objetivo y la decisión final de
umbrales/permisos BIZ-06/BIZ-07. El fallo/recuperación de PDF también tiene
muestra autenticada: el estado `FAILED` queda visible y el reintento real del
panel staff termina en `READY`.

## Diccionario de métricas

El fixture define trece métricas iniciales, una por cada resultado de la matriz
de escenarios y las métricas transversales de error/abandono:

- solicitud pública → confirmación con folio;
- tiempo hasta la siguiente tarea;
- solicitud calificada → primer borrador;
- tiempo para agregar diez conceptos;
- preflight → publicación;
- borrador → resolución de aprobación;
- fallo de PDF → recuperación;
- fallo de entrega → recuperación;
- versión publicada → nueva versión de trabajo;
- cotización vencida → siguiente paso;
- acceso del cliente → decisión;
- errores recuperables por tarea;
- abandono antes de la siguiente tarea.

Los eventos son nombres estables en `snake_case` con puntos (`quote.draft_saved`)
y deben incluir únicamente contexto operativo mínimo. Quedan prohibidos email,
teléfono, nombre, cuerpo de mensajes, tokens, `storageKey`, IP y user-agent.

## Volúmenes representativos

Antes de optimizar o aceptar el builder se ejecutarán perfiles sintéticos de
10 000 solicitudes, 5 000 conceptos, 100 versiones por expediente y 100 líneas
por documento. Son perfiles de rendimiento y densidad, no datos comerciales.

## Criterios de cierre de G0-03

G0-03 no se cierra todavía. Requiere:

- mantener la matriz con sesiones sintéticas de sales, manager y customer;
- conservar los tiempos y conteos sin PII;
- enlazar los objetivos locales con pruebas de aceptación en U1/R1/D1/D2;
- ejecutar el piloto T1 y contrastar los resultados reales con la muestra local;
- conservar una comparación reproducible contra este commit.

El test [`commercial-baseline-contract.test.ts`](../../tests/unit/commercial-baseline-contract.test.ts)
comprueba que la matriz no pierda superficies, escenarios, eventos ni reglas de
privacidad mientras se prepara la medición autenticada.

## Riesgos y no decisiones

- No se instrumenta producción con este ADR.
- No se registra PII para completar una métrica.
- No se define todavía retención de telemetría: depende de BIZ-14 y privacidad.
- No se fija un objetivo numérico sin aprobación de producto.
- No se cambia schema, endpoint, permiso, UI, sesión ni comportamiento comercial.
