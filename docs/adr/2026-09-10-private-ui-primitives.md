# ADR — Primitivas accesibles para las superficies privadas V2

- **Estado:** `APPROVED_LOCAL`
- **Fecha:** 2026-09-10
- **Owner:** Codex/arquitectura
- **Aprobadores:** producto/frontend OCPOOL; aprobación explícita recibida en la tarea del 2026-09-11
- **Alcance:** G0-04; sólo superficies staff, portal y auth privada
- **Fuera de alcance:** landing pública y su loading page, que permanecen congeladas

## Decisión aprobada

Se conserva una familia por patrón, sin añadir una librería nueva ni replicar el
patrón visual de la landing dentro del sistema privado:

- `@radix-ui/react-select` para selects complejos mediante `SelectField`;
- `react-day-picker` con locale `es` para `DateField`;
- patrones propios auditados para dialog, tabs, foco y retorno.

La comparación aislada contra `react-aria-components` y `lucide-react` pasó su
matriz de teclado, semántica, SSR/hidratación, locale `es-MX`, responsive y Axe,
pero su coste de bundle y la ausencia de necesidad de ComboBox/Iconos en las
rutas actuales no justifican introducir dependencias al root. Se mantiene el
fallback único actual: Radix para Select, react-day-picker para DatePicker y
wrappers propios para Dialog/Tabs. No se mezclan familias por pantalla.

## Inventario observado

| Primitiva | Uso actual | Riesgo a medir |
| --- | --- | --- |
| Select | `SelectField` en requests, quotes, catálogo, archivos, audit y notifications | búsqueda async, listas grandes, anuncio de selección y mobile |
| DatePicker | `DateField` en catálogo y audit | foco al abrir/cerrar, entrada manual, timezone y formato |
| Dialog | aceptación del cliente y modal de proyectos | focus trap/restore, escape, scroll lock y lector de pantalla |
| Tabs | archivos y mensajería | flechas, `tablist`/`tabpanel`, estado profundo y mobile |
| ComboBox | aún no existe como primitive compartida | búsqueda de conceptos sin lista enorme ni clicks repetidos |
| Iconos | símbolos/texto y estilos propios | consistencia, nombre accesible y bundle |

## Spike obligatorio

Crear un prototipo aislado de los cinco recorridos críticos de G0-04 con:

1. Select nativo/actual y Select/ComboBox accesible para catálogo;
2. DatePicker con fecha de vigencia y entrada manual;
3. Dialog de aceptación con focus trap y restore;
4. Tabs de mensajes/archivos con navegación por teclado;
5. iconos de acción con imports individuales.

Cada variante se prueba en 360, 768 y 1440 px, con JavaScript habilitado y
deshabilitado cuando aplique a SSR. Se registran consola, hidratación, teclado,
`aria-*`, locale, bundle gzip y CSS agregado. El spike no puede tocar rutas de
producción ni la landing.

## Criterios de aceptación

- cero errores de hidratación y cero errores serios de Axe;
- todos los recorridos se completan sin ratón;
- focus trap y restore demostrables en dialog;
- `es-MX` consistente en fechas, números y mensajes;
- ningún control crítico depende de placeholder como única etiqueta;
- incremento gzip y CSS documentados antes de decidir;
- una sola familia de primitives para cada patrón después del ADR;
- si se conserva Radix, se registra fecha de retiro de cualquier fallback propio;
- si se adopta React Aria, se elimina el wrapper duplicado antes de cerrar G0.

## Regla de no mezcla

Durante el spike se permiten dos variantes aisladas. Después de la decisión no se
introduce una tercera familia por pantalla ni se mezclan primitives sin un ADR
nuevo. La landing queda fuera de esta regla para proteger su loading page y su
regresión visual.

## Baseline local reproducible

El primer corte del spike mide la superficie declarada de los entrypoints
instalados y el tamaño de los wrappers privados actuales. No decide todavía la
librería final ni sustituye el prototipo navegable.

Comando:

```text
npm run spike:private-primitives
```

Resultado local registrado:

| Elemento | Estado/versión | Bytes de entrypoints | Gzip de entrypoints |
| --- | --- | ---: | ---: |
| `@radix-ui/react-select` | instalado `2.3.7` | 112,423 | 21,452 |
| `react-day-picker` | instalado `9.14.0` | 1,857 | 609 |
| `react-aria-components` | no instalado | — | — |
| `lucide-react` | no instalado | — | — |

Baseline de código privado: `SelectField.tsx` 2,278 bytes/54 líneas,
`DateField.tsx` 3,708/93, `ClientQuoteActions.tsx` 8,668/163,
`StaffFilesPanel.tsx` 15,068/224, `StaffMessagingPanel.tsx` 15,722/278 y
`globals.css` 190,983/1,863. El script también registra coincidencias de cada
patrón para que la comparación posterior sea reproducible.

Como corte runtime dirigido, la suite `QUOTES_E2E=1` pasó 1/1 en `E2E_PORT=3121`
y ejercitó los dos `SelectField` del constructor, `DateField` con apertura y
cierre por `Escape` con retorno de foco al disparador, y el diálogo de aceptación
del portal quedó cubierto por la corrida comercial 3/3. Esto confirma que las
primitives actuales se ejecutan en los recorridos reales, pero no sustituye el
prototipo aislado ni la comparación contra React Aria.

Como hardening adicional, las pestañas de archivos y mensajería staff ahora
usan `tabIndex` roving y navegación `ArrowLeft`/`ArrowRight`/`Home`/`End` con
selección y foco sincronizados. `STAFF_MESSAGING_E2E=1` pasó 2/2 en
`E2E_PORT=3150`, incluyendo Axe, responsive y el recorrido de teclado en ambos
paneles. La misma prueba se endureció para esperar la confirmación real del
POST antes de cerrar la conversación, evitando un falso positivo que podía
provocar un `409` por una carrera de fixture. Esto cubre el comportamiento
actual, pero no reemplaza la matriz del prototipo comparativo de G0-04.

El prototipo navegable versionado vive en
[`spikes/private-primitives-react-aria`](../../spikes/private-primitives-react-aria/)
y no se importa desde producción. Fija `react-aria-components` 1.21.1 y
`lucide-react` 1.44.0, cubre ComboBox/Select, DatePicker, Dialog, Tabs e iconos,
y se ejecutó en 360, 768 y 1440 px sin overflow, errores de consola/página,
peticiones fallidas ni violaciones Axe serias/críticas. Su build Vite aislado
midió 569.93 kB de JavaScript (175.31 kB gzip) y 4.10 kB de CSS (1.36 kB gzip);
es una medición comparativa del spike, no el presupuesto aprobado de una ruta
Next.js. El procedimiento está en el README del spike y no añade dependencias al
`package.json` raíz.

La comprobación `npm run check:ssr` renderiza `App` en Node y lo hidrata en
Chromium; pasó con `renderMode: "hydration"`, 9,862 bytes de HTML inicial, cero
warnings/errors de React y cero peticiones fallidas. Esto valida el contrato del
prototipo; el mismo recorrido comprueba un importe MXN mediante
`Intl.NumberFormat("es-MX")` y relaciones semánticas de diálogo/grid/tabs. La repetición anónima sobre rutas Next.js reales
está registrada abajo; queda la prueba de lector de pantalla representativa, la decisión del `lang` de
las rutas privadas y la comparación final contra los wrappers actuales. Estos
huecos mantienen G0-04 abierto.

La decisión de idioma quedó separada en el [ADR de locale privado](2026-09-10-private-locale.md)
para no mezclar una corrección semántica con la selección de primitives.

La repetición anónima contra Next.js (`npm run check:next`) pasó 12/12
combinaciones de `/login`, `/portal/access`, `/staff`, `/staff/requests`,
`/staff/quotes` y `/portal` en 390/1440 px: HTML 200, headings presentes, sin
overflow, errores de página, peticiones fallidas ni warnings inesperados. Los
`401` de APIs privadas quedaron clasificados como esperados. Tras la decisión de
locale, las 12 combinaciones entregan `lang="es-MX"` desde SSR.

## Cierre

G0-04 queda aprobado localmente con la revisión humana autorizada en la tarea,
la matriz automatizada del spike y la regresión Next.js. Las futuras pantallas
privadas usarán las primitives existentes por patrón y cualquier cambio de
familia requerirá un ADR nuevo; la landing queda fuera de alcance.
