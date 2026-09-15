# ADR — Preparación de entrada U1/R1

- **Estado:** `READY_LOCAL_BLOCKED_BY_G0`
- **Fecha:** 2026-09-11
- **Owner:** Codex/arquitectura
- **Dependencia:** cierre formal de G0-03/G0-05 y contratos D2
- **Alcance:** preparación técnica y de diseño; no activa flags ni cambia el comportamiento de producción

## Decisión

U1 y R1 quedan preparados para iniciar en cuanto G0 cierre formalmente. La
primera slice será el sistema privado compartido y el shell bajo
`commercialWorkspaceV2`, seguida por el expediente profundo bajo
`requestWorkspaceV2`. Ambas flags permanecerán apagadas y el comportamiento
actual seguirá siendo el fallback hasta contar con el gate correspondiente.

La preparación se limita a un mapa verificable de la superficie actual, sus
contratos reutilizables, las brechas que deben cerrarse y una secuencia de
implementación reversible. En la habilitación local posterior se crearon
layouts route-local para cargar el namespace privado y un harness de desarrollo
sin datos reales; no se cambia la URL pública, no se conecta ningún consumidor
al módulo de flags y no se instrumenta telemetría productiva. El único cambio
de contrato de backend es aditivo: se exponen capacidades booleanas seguras
para que el shell filtre navegación y acciones sin sustituir la autorización
del servidor.

## Precondiciones que siguen bloqueando la implementación visible

Estas condiciones no se consideran aprobadas por este ADR:

1. piloto T1 con ventas, gerencia, administración y clientes;
2. decisión de retención y acceso de telemetría;
3. signoff fiscal de BIZ-03/BIZ-04;
4. signoff jurídico de BIZ-09/BIZ-10;
5. cierre formal de G0-05 y autorización explícita de la primera cohorte.

La autorización local para preparar el trabajo no sustituye ninguna de esas
condiciones.

### Actualización 2026-09-11 — fundamento privado conectado sólo por rutas autorizadas

Como preparación reversible de Entrada 1 se creó el namespace
`src/components/private/ui/` con tokens semánticos, relaciones de accesibilidad
para campos, Button/IconButton/LinkButton, campos de texto y área, wrappers
numéricos, Select sobre Radix y estados de status, skeleton, empty y bloqueo.
Sus estilos viven en `private-ui.css` bajo `.private-ui-scope` y, tras la
autorización local explícita posterior a este ADR, se importan únicamente desde
los layouts de `/auth`, `/login`, `/portal`, `/staff` y el harness privado de
desarrollo; nunca desde el layout público raíz. La flag
`commercialWorkspaceV2` continúa apagada por defecto, por lo que ninguna ruta
de producto cambia su fallback ni se activa en producción.

La prueba contractual nueva cubre la separación de tokens y la asociación
label/description/error. La prueba de aislamiento de este slice cubre además
la carga por layout y el destino contextual de marca; la suite local queda en
37 archivos y 148 pruebas verdes.

Como contrato adicional de U1-03 se preparó el mapa declarativo de navegación
staff en `src/components/private/navigation.ts`. Cada destino exige una
capability explícita (`metricsRead`, `requestsRead`, `quotesRead`,
`catalogRead`, `notificationsRead` o `auditRead`); la ausencia equivale a
oculto. El endpoint de capabilities expone esas tres capacidades de navegación
que antes no estaban disponibles (`metricsRead`, `requestsRead` y
`notificationsRead`) sin entregar permisos crudos. La integración autenticada
de capabilities pasó 3/3 con negativo de sesión, separación de roles y
respuesta sin datos sensibles. El cambio es aditivo y no modifica los guards
de las rutas.

### Actualización 2026-09-11 — slice local de aislamiento y marca

Con autorización explícita para continuar en la computadora local, se retiró
la importación de `private-ui.css` del layout raíz y se añadió a los layouts de
las superficies privadas/auth. `PrivateShellChrome` ahora entrega `/staff` o
`/portal` según la superficie y expone un nombre accesible coherente. El
contrato dirigido pasó 2/2; typecheck, lint, contenido y build pasaron. El
baseline anónimo de Chromium pasó 24/24 en 390/768/1440 px, sin overflow,
errores de página ni respuestas inesperadas. No se activó ninguna flag, no se
modificó la landing y no se hizo push, deploy ni cambio en producción.

### Actualización 2026-09-12 — harness local U1-06 y verificación responsive

Se añadió `/private-shell-harness` como ruta sólo de desarrollo: usa contextos
sintéticos constantes, no consulta Prisma ni APIs, y ejecuta `notFound()` cuando
`NODE_ENV` es `production`. Su stylesheet se carga desde un layout route-local,
conservando el contrato de aislamiento y evitando que el harness dependa de la
landing.

La prueba opt-in `tests/private-shell-harness.spec.ts` pasó `2/2` para staff y
portal con reduced motion, menú móvil, foco por teclado, objetivos táctiles y
Axe sin violaciones `critical`/`serious`. La matriz comprobó cero overflow en
360/390/768/1024/1440 px y en una anchura efectiva de 180 px para el caso de
zoom 200%. La suite unitaria completa quedó en 37 archivos/148 pruebas. La
regresión pública/fallback pasó `32/32` al excluir los tres casos que requieren
persistir datos; la corrida E2E completa se intentó, pero su runner no pudo
sembrar por la ausencia de `.env`, `DATABASE_URL` y las claves requeridas. No
se activaron flags, no se usaron datos reales, no se modificó la landing y no
hubo push, deploy ni cambio en producción.

### Actualización 2026-09-12 — R1-01/R1-02 local bajo autorización explícita

Con la autorización explícita de continuar en la computadora local, se
implementó una primera slice reversible de la cola y el expediente sin cambiar
el fallback ni activar flags por defecto. `request-workspace-query.ts` es el
contrato único para vistas, búsqueda, etapa, responsable, antigüedad, orden,
paginación y tab; el servicio aplica rangos de fecha no solapados y orden
determinista. La nueva ruta `/staff/requests/[requestId]` conserva el contexto
de la cola y ofrece `summary`, `quote`, `conversation`, `files` y `activity`.

Conversación y archivos reutilizan sus paneles server-protected y sólo se
montan al activar la sección; cotización consulta su endpoint protegido bajo
demanda; actividad usa historial y asignaciones ya proyectados por el servidor.
El directorio de responsables se consulta únicamente mediante la ruta
existente protegida por `requests.assign`, por lo que no se amplía el alcance
RBAC de sólo lectura. El fallback legacy, la landing y las flags siguen sin
cambio. Contratos `5/5`, integración `42/42` archivos/`89/89` pruebas, E2E de
la slice `2/2`, regresión E2E general `35/35` ejecutables, foundation `2/2`,
typecheck, lint, contenido, build y diff-check pasan. Esto no equivale a
`DONE`, cierre formal de G0 ni autorización productiva.

### Actualización 2026-09-13 — R1-03/R1-04/R1-05/R1-06/R1-08 y base R1-07 local

La implementación local avanzó con flags fail-closed: admisión manual con dedupe
explícito, edición comercial auditada, toma/reasignación con concurrencia segura,
redirect compatible y la intención transaccional `Solicitar información`. Esta
última enlaza mensaje, campos faltantes, acceso opcional al portal, estado,
historial, auditoría y Outbox; una clave idempotente con otro cuerpo se rechaza.

La base de R1-07 conserva drafts al cambiar de tab, pagina conversación, archivos y
actividad por cursor, muestra progreso/scan/reintento de cargas en staff y portal y
sólo agrega deep links al expediente cuando ambas flags V2 están activas. El detalle
V2 incorpora una cabecera contextual única, una acción primaria derivada de las
capacidades/transiciones server-owned y un menú accesible para acciones secundarias;
los comandos con formulario expanden el bloque operativo y conservan el foco. No se
inventan indicadores unread: esa señal queda pendiente de un modelo de lectura
explícito. La evidencia fresca es `40/40` archivos y `182/182` unitarias, `42/42`
archivos y `94/94` integraciones, E2E V2 `5/5` (incluye dedupe visible, decisión
explícita y reutilización de contacto), portal autenticado `4/4`, staff de
mensajería/archivos `2/2`, E2E general `35/35` ejecutables con `28` omitidas por
opt-in, foundation `2/2`, typecheck, lint, build, audit y
diff-check PASS. R1-07 tiene cobertura técnica local ampliada, pero R1 no se
considera cerrado hasta completar su gate integral y sus aprobaciones.

### Actualización 2026-09-13 — alcance de lectura y anti-IDOR BIZ-08

Se consolidó el alcance de solicitudes en una regla server-owned: el permiso
`requests.read.global` habilita la vista global para Gerencia/Administración;
Ventas sólo puede leer solicitudes propias o sin asignar. La regla se aplica a
cola, filtros, detalle, actividad, toma/reasignación, mensajería, archivos,
cotizaciones, aprobaciones, PDF y habilitación del portal. La UI V2 y el
fallback legacy reflejan la misma capacidad, pero las rutas siguen protegidas
aunque se invoquen directamente.

La cobertura local actual es `40/40` archivos y `185/185` unitarias, `42/42`
archivos y `95/95` integraciones, con typecheck, lint y build PASS. La matriz
formal de IDOR del workspace quedó incorporada en
[`request-workspace-idor-matrix.md`](../ocpool-commercial-v2/request-workspace-idor-matrix.md);
siguen pendientes la aprobación del gate R1, el piloto T1 y los signoffs
externos. No se activan flags ni se autoriza producción.

## Auditoría de entrada

| Superficie | Estado actual comprobado | Brecha de U1/R1 | Tratamiento aprobado |
| --- | --- | --- | --- |
| `/login`, `/login/recovery`, `/portal/access` y enlaces de consumo | Componentes de autenticación separados, respuestas no enumerativas y sesión en servidor | Falta un contrato visual compartido de estados, foco, busy y recuperación | U1-04 con wrappers privados; conservar endpoints y allowlist existente |
| `/staff` | Dashboard autónomo con navegación propia y datos protegidos por API; layout local ya preparado para estilos | Aún no hay usuario/logout/capabilities en un shell único de producto | U1-03 como shell server-first; no duplicar navegación por página |
| `/staff/requests` | Lista y detalle en una sola pantalla; selección, filtros y paginación viven en estado cliente | No hay URL como fuente de selección, tabs ni ruta profunda | R1-01/R1-02; mantener el panel actual como fallback durante la migración |
| `/staff/quotes` | Módulo separado del expediente | Duplica contexto y no cumple el destino canónico de cotización | R1-08 redirect compatible a `/staff/requests/:id?tab=quote` |
| `/portal` | Lista limitada a `page=1&pageSize=25`; selección y detalle viven en estado cliente | No hay deep link, timeline/tab URL ni carga por expediente desde la ruta | U1-04 y la slice posterior de portal; no mezclarla con R1 staff |
| `/staff/catalog`, `/staff/notifications`, `/staff/audit` | Rutas existentes con APIs protegidas | La visibilidad del menú no está centralizada en capabilities | U1-03: filtrar navegación en servidor y mantener protección backend |
| estilos privados | Los selectores legacy siguen en `src/app/globals.css`; el namespace nuevo vive en `src/components/private/ui/private-ui.css` y se carga por layouts privados | Falta migrar consumidores de producto y definir retiro del legacy | U1-01/U1-03: tokens y estilos privados separados; prueba de regresión de landing |

## Contratos que se reutilizan

- `requireStaffActor` y `requireCustomerActor` continúan siendo los límites de
  sesión. La UI no puede sustituir autorización server-side.
- `/api/staff/capabilities` sigue siendo la fuente para acciones y navegación
  permitidas; el expediente ya recibe `availableStatusTransitions` y
  `availableActions` proyectadas por el servidor.
- Los servicios de solicitudes, mensajería, archivos, onboarding y cotización
  se conservan. R1 compone sus proyecciones; no replica reglas de dominio en
  componentes cliente.
- `WorkspaceBrand`, `WorkspaceLogo`, `SelectField` y `DateField` son piezas de
  transición. Podrán envolverse o migrarse por etapas, pero no se crearán dos
  variantes visuales equivalentes sin criterio de retiro.
- El módulo [`commercial-v2.ts`](../../src/server/flags/commercial-v2.ts)
  conserva ocho flags con aprobación global fail-closed. Ninguna se consume
  todavía.

## Orden de implementación después de G0

### Entrada 1 — U1-01/U1-02: fundamento privado

Crear `src/components/private/ui/` y el namespace de estilos privado con
tokens semánticos de superficie, texto, borde, foco, espaciado, tipografía,
radio, sombra, movimiento, capas y breakpoints. Los wrappers deben definir
label, descripción, error, required, disabled, read-only, busy, foco, teclado y
objetivo táctil. Se migrarán primero las superficies privadas pequeñas y se
mantendrá la landing fuera de esa dependencia.

**Salida:** typecheck, lint, Axe/teclado/foco en harness, regresión de landing
sin cambios y evidencia de que no se cargan dos sistemas equivalentes.

### Entrada 2 — U1-03/U1-04: shell y auth

Construir layouts privados server-first con `main#contenido`, retorno estable,
logo oficial, navegación móvil, identidad y logout verificable. La navegación
se deriva de capabilities en servidor; una ruta directa no obtiene acceso por
estar oculta. El fallback legacy se conserva detrás de la flag apagada.

**Salida:** staff, portal y auth verificados en 360/390/768/1024/1440 px,
zoom 200%, teclado, reduced motion, estados restringidos y error/recuperación.

### Entrada 3 — R1-01/R1-02: cola y expediente

Mover la selección de solicitudes a query params validados (`view`, `query`,
`stage`, `assignee`, `age`, `sort`, `page` y `tab`) y crear la ruta profunda
`/staff/requests/[requestId]`. La vista móvil abre el expediente como ruta,
no como segundo panel apilado. Los tabs `summary`, `quote`, `conversation`,
`files` y `activity` se cargan al activarse y mantienen retorno, filtro y
selección.

**Salida:** abrir/volver/recargar conserva contexto; no hay IDOR; acciones,
transiciones, archivos y conversación siguen dependiendo de capabilities y
servicios server-owned.

### Entrada 4 — R1-03/R1-08: admisión compatible

Implementar alta manual con dedupe explícito, redirección al expediente y
compatibilidad de `/staff/quotes?request=:id`. No se hará merge automático ni
se reutilizará un estado mutable para representar descuento, aprobación,
publicación o aceptación.

**Salida:** E2E de alta, coincidencia exacta, ambigüedad, colisión,
redirect/fallback y auditoría before/after.

## Contrato de flags y fallback

| Flag | Primera superficie | Fallback mientras esté apagada | Kill switch |
| --- | --- | --- | --- |
| `commercialWorkspaceV2` | layouts, tokens y shell privado | páginas/paneles actuales | cualquier excepción vuelve al shell legacy |
| `requestWorkspaceV2` | cola y expediente profundo | `/staff/requests` actual y rutas legacy | volver a master/detail actual |
| `projectHandoffV1` | fuera de U1/R1 | no mostrar proyecto | no-op |
| `commercialTelemetry` | sólo medición aprobada | ningún evento productivo | apagado por defecto |

`quoteBuilderV2`, `quoteApprovalV1`, `quotePublicationV2` y
`portalTimelineV2` no forman parte de la primera entrada U1/R1. Se mantienen
apagadas hasta que sus dependencias y gates propios estén cerrados.

## Criterios de no-go

Se detiene la slice si ocurre cualquiera de estas condiciones:

- la landing cambia en contenido, estilos, hash o comportamiento;
- la flag global de aprobación no está presente o no es `true` en un entorno
  autorizado;
- el backend recibe una acción que la UI no puede justificar con capabilities;
- una ruta profunda permite cruzar cliente, solicitud o archivo fuera de scope;
- el fallback pierde filtros, retorno, mensajes, auditoría o la versión publicada;
- el cambio obliga a activar telemetría sin la decisión de retención;
- aparece una segunda regla de negocio en el cliente.

## Evidencia de entrada

Este ADR se considera cumplido para preparación cuando el plan maestro lo
enlaza, la matriz anterior coincide con el código revisado y la suite base
permanece verde. No equivale a U1/R1 `DONE`.

Verificaciones ejecutadas antes de registrar esta preparación:

- `npm run typecheck` — PASS;
- `npm run lint` — PASS;
- `npm run test:unit` — 37 archivos / 149 pruebas — PASS;
- `npm run test:integration` — 42 archivos / 88 pruebas — PASS;
- `npm run test:e2e:private-shell` — 2/2 — PASS;
- regresión E2E opt-in con build aislado — 57/57 ejecutables PASS y 2 omitidas por ser harness dev-only;
- `npm run build` con `NEXT_DIST_DIR` aislado — PASS;
- `git diff --check` — PASS;
- gate técnico G0-05 aislado — verificaciones técnicas PASS, salida
  `BLOCKED` deliberada por T1 y signoffs externos.

## Siguiente acción exacta

La cobertura técnica local de R1-07 ya quedó verificada con conversación/archivos,
deep links, fallos/reintentos, drafts, actividad paginada y reasignación; el
harness sigue siendo una prueba de contrato y el fallback legacy y las flags
permanecen fail-closed. El siguiente entregable es ejecutar el gate R1 completo
con flags apagadas, revisar cada criterio de la checklist y obtener las
aprobaciones formales de entrada; el cierre de G0, el piloto T1 y los signoffs
externos siguen siendo independientes.
Después del cierre formal de G0 deberán repetirse las revisiones de entrada,
la regresión de landing y la aprobación de cohorte. Este ADR no equivale a
U1/R1 `DONE` ni autoriza producción.
