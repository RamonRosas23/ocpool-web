# G0-03 — Evidencia de baseline de navegador

**Fecha:** 2026-09-10
**Alcance:** superficies anónimas/restringidas, sin PII ni fixtures persistentes
**Runner:** Chromium 151 de Playwright, reubicado en `/var/tmp` porque la caché predeterminada estaba montada `noexec`

## Ejecución

```text
PLAYWRIGHT_BROWSERS_PATH=/var/tmp/ocpool-playwright \
APP_URL=http://127.0.0.1:3008 \
npm run baseline:v2:browser
```

Resultado: `PASS`, 24 combinaciones (landing pública + 7 superficies privadas × 3 viewports).

| Control | Resultado |
| --- | --- |
| Respuesta de página | 24/24 con HTTP 200 |
| Overflow horizontal | 0/24 |
| Errores JavaScript de página | 0/24 |
| Errores de consola inesperados | 0/24 |
| Respuestas inesperadas ≥400 | 0/24 |
| 401/403 | Sólo respuestas esperadas de superficies privadas sin sesión |

Viewports cubiertos: 390×844, 768×1024 y 1440×900. Superficies: `/`, `/login`,
`/portal/access`, `/staff`, `/staff/requests`, `/staff/quotes`,
`/staff/notifications` y `/portal`.

El script ya no usa `networkidle` como condición de cierre: espera
`DOMContentLoaded`, `load` o cinco segundos como máximo y una ventana de
estabilidad de 250 ms. Así no convierte conexiones persistentes de APIs privadas
en bloqueos falsos.

## Evidencia autenticada relacionada

Con el mismo runner y fixtures desechables, `tests/auth-surfaces.spec.ts` pasó
5/5: login de empleado, MFA de administrador, magic link de cliente,
recuperación de contraseña y estados seguros de enlaces inválidos/repetidos.

La suite pública `tests/quality.spec.ts` pasó 35/35 en un servidor E2E aislado,
incluyendo formulario, folio no autenticante, responsive, Axe, foco, navegación
y ausencia de errores de consola.

La corrida comercial autenticada crítica pasó 3/3 en un único servidor E2E
aislado (`E2E_PORT=3120`): portal privado con aceptación, mensajería y archivos;
estado de expediente sin cotización y recuperación ante API 500 en móvil; y
constructor staff desde borrador hasta revisión, envío, generación y descarga de
PDF. Los fixtures se crean y limpian dentro de cada suite; la corrida conjunta
no requiere datos persistentes ni credenciales reales. Durante la primera corrida
se detectó y corrigió un defecto Axe real en el skeleton de carga de archivos del
portal (`role="status"` faltante).

La cobertura autenticada se amplió después con fixtures desechables y pasó sin
errores inesperados: onboarding de cliente 2/2, dashboard operativo 1/1,
notificaciones 1/1, auditoría 1/1, mensajería staff 2/2 e identidad API 1/1.
Durante esta expansión se corrigieron cuatro defectos de calidad encontrados por
los propios recorridos: roles ARIA incompletos en la tabla de carga del dashboard,
overflow móvil en los encabezados de dashboard/auditoría/notificaciones y
login (incluido el ancho mínimo de sus paneles) y selectores E2E ambiguos al
convivir el campo de fecha con su botón de calendario.
Cada superficie volvió a pasar sus comprobaciones Axe, responsive, foco y estados
de recuperación en su ejecución aislada.

El recorrido de catálogo/precios pasó 1/1 de forma aislada y luego dentro de la
corrida cruzada: creó una categoría y concepto, verificó una lista con precio
MXN, rechazó una vigencia invertida, guardó una vigencia válida, archivó el
concepto y comprobó responsive (390/768/1440), Axe y consola limpia. La
validación descubrió que la tabla declaraba `role="row"` sin celdas ARIA; se
corrigió el marcado a `columnheader`/`cell` y la repetición quedó verde.

Como control posterior a los cambios de pestañas y de espera de mensajería, se
repitieron por separado los tres escenarios que una corrida masiva posterior
marcó bajo contención de `ocpool_dev`: auth `5/5` (`E2E_PORT=3158`),
catálogo/precios `1/1` (`E2E_PORT=3159`) y portal `2/2` (`E2E_PORT=3160`). La
corrida masiva con esas suites no se promociona como evidencia verde porque
compartió la base de desarrollo y sufrió latencias/fixtures intermitentes; la
regresión cruzada limpia registrada arriba sigue siendo la de `17/17` en
`E2E_PORT=3149`.

La corrida cruzada de todas las suites opt-in pasó `17/17` en un solo servidor
E2E (`E2E_PORT=3149`), incluyendo auth surfaces, portal, cotizador, onboarding,
dashboard, catálogo/precios, notificaciones, mensajería staff, auditoría e
identidad API. El recorrido de catálogo creó un concepto, asignó categoría,
validó vigencia de precios, archivó el concepto y comprobó Axe, responsive y
ausencia de errores de consola.

Como validación del contrato de medición, se ejecutaron recorridos aislados con
`BASELINE_MEASUREMENTS_E2E=1` y fixtures desechables en `E2E_PORT=3172` y
`E2E_PORT=3173`:

- suite pública: `35/35`, con una muestra `public_request_to_confirmation` de
  `4,368 ms` (`ANONYMOUS`, `public-request`, `desktop`, `errorCount=0`,
  `abandoned=false`);
- portal + cotizador: `3/3`, con muestras `portal_access_to_decision` de
  `1,335 ms`, `request_to_draft` de `825 ms` y `publish_quote` de `321 ms`
  (las tres con actor/superficie declarados, cero errores y sin abandono);
- notificaciones: `1/1`, con una muestra `delivery_failure_to_recovery` de
  `96 ms` (actor `MANAGER`, superficie `staff-notifications`, cero errores y
  sin abandono).
- solicitudes: `1/1`, con una muestra `request_to_next_task` de `715 ms`
  (actor `SALES`, superficie `staff-requests`, cero errores y sin abandono).
- nueva versión de trabajo: incluida en el cotizador `1/1`, con una muestra
  `published_to_new_working` de `102 ms` en móvil, sin errores ni abandono.
- repetición del cotizador en build fresco (`APP_URL=http://127.0.0.1:3192`):
  `1/1`, con diez conceptos agregados en `1,015 ms`, recuperación de PDF
  fallido en `1,251 ms` y resolución de aprobación por un segundo usuario en
  `1,694 ms`; el recorrido también confirmó snapshot financiero, publicación y
  nueva versión, todos sin abandono.
- repetición final del portal en un build fresco (`APP_URL=http://127.0.0.1:3193`):
  `4/4`; además de aceptación completa, comprobó el estado sin cotización,
  orientó una cotización vencida al mensaje de actualización (`expired_quote_to_next_step=347 ms`)
  y registró una sesión abandonada antes de completar la tarea
  (`workflow_abandonment=256 ms`, `abandoned=true`). El error recuperable de
  aceptación quedó en `workflow_errors=1,212 ms`, `errorCount=1`.

Las trece mediciones instrumentadas son temporales, no contienen PII y se
escribieron fuera del repositorio. La selección final reúne 65 registros
(`13 métricas × 5 recorridos`) de corridas independientes con fixtures
desechables: solicitud pública, siguiente tarea, borrador, diez conceptos,
publicación, aprobación, recuperación de PDF, recuperación de entrega, nueva
versión, decisión del cliente, expiración guiada, error recuperable y abandono.
El detalle de medianas, p95 y guardrails está en el
[`ADR de objetivos locales`](../adr/2026-09-11-commercial-g0-03-objectives.md).

El instrumento y la muestra mínima quedan `VERIFIED_LOCAL_PARTIAL`, y los
objetivos de §29 están aprobados localmente con autorización explícita. Esto no
es significancia estadística ni validación con usuarios: el piloto T1 y la
comparación contra objetivos reales siguen pendientes. G0-03 no autoriza
telemetría productiva, rollout ni cambios en la landing.
