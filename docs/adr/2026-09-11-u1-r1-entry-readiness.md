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
implementación reversible. No se crea todavía un layout nuevo, no se cambia la
URL pública, no se conecta ningún consumidor al módulo de flags y no se
instrumenta telemetría productiva. El único cambio de contrato es aditivo: se
exponen tres capacidades booleanas seguras para que el futuro shell filtre su
navegación.

## Precondiciones que siguen bloqueando la implementación visible

Estas condiciones no se consideran aprobadas por este ADR:

1. piloto T1 con ventas, gerencia, administración y clientes;
2. decisión de retención y acceso de telemetría;
3. signoff fiscal de BIZ-03/BIZ-04;
4. signoff jurídico de BIZ-09/BIZ-10;
5. cierre formal de G0-05 y autorización explícita de la primera cohorte.

La autorización local para preparar el trabajo no sustituye ninguna de esas
condiciones.

### Actualización 2026-09-11 — fundamento privado inerte

Como preparación reversible de Entrada 1 se creó el namespace
`src/components/private/ui/` con tokens semánticos, relaciones de accesibilidad
para campos, Button/IconButton/LinkButton, campos de texto y área, wrappers
numéricos, Select sobre Radix y estados de status, skeleton, empty y bloqueo.
Sus estilos viven en `private-ui.css` bajo `.private-ui-scope` y todavía no son
importados por layouts ni pantallas. La búsqueda de consumidores confirma que
ninguna ruta de producto los ha activado y las flags continúan fail-closed.

La prueba contractual nueva cubre la separación de tokens y la asociación
label/description/error. Después de este slice, la suite local queda en
36 archivos y 143 pruebas verdes.

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

## Auditoría de entrada

| Superficie | Estado actual comprobado | Brecha de U1/R1 | Tratamiento aprobado |
| --- | --- | --- | --- |
| `/login`, `/login/recovery`, `/portal/access` y enlaces de consumo | Componentes de autenticación separados, respuestas no enumerativas y sesión en servidor | Falta un contrato visual compartido de estados, foco, busy y recuperación | U1-04 con wrappers privados; conservar endpoints y allowlist existente |
| `/staff` | Dashboard autónomo con navegación propia y datos protegidos por API | No hay `staff/layout.tsx`, usuario/logout/capabilities en un shell único | U1-03 como shell server-first; no duplicar navegación por página |
| `/staff/requests` | Lista y detalle en una sola pantalla; selección, filtros y paginación viven en estado cliente | No hay URL como fuente de selección, tabs ni ruta profunda | R1-01/R1-02; mantener el panel actual como fallback durante la migración |
| `/staff/quotes` | Módulo separado del expediente | Duplica contexto y no cumple el destino canónico de cotización | R1-08 redirect compatible a `/staff/requests/:id?tab=quote` |
| `/portal` | Lista limitada a `page=1&pageSize=25`; selección y detalle viven en estado cliente | No hay deep link, timeline/tab URL ni carga por expediente desde la ruta | U1-04 y la slice posterior de portal; no mezclarla con R1 staff |
| `/staff/catalog`, `/staff/notifications`, `/staff/audit` | Rutas existentes con APIs protegidas | La visibilidad del menú no está centralizada en capabilities | U1-03: filtrar navegación en servidor y mantener protección backend |
| estilos privados | Selectores `staff-*`, `analytics-*`, `client-*` y `auth-*` están en `src/app/globals.css` | No existe namespace/tokens privados aislados ni fecha de retiro | U1-01: tokens y estilos privados separados; prueba de regresión de landing |

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
- `npm run test:unit` — 36 archivos / 143 pruebas — PASS;
- `git diff --check` — PASS;
- gate técnico G0-05 aislado — verificaciones técnicas PASS, salida
  `BLOCKED` deliberada por T1 y signoffs externos.

## Siguiente acción exacta

Después del cierre formal de G0, iniciar Entrada 1 con un diff aislado de
`src/components/private/ui/`, layouts privados y estilos del namespace
privado. Ejecutar primero el harness accesible y la regresión de landing; sólo
después conectar `commercialWorkspaceV2`. Hasta entonces, este ADR y el
fallback existente son la preparación aprobada.
