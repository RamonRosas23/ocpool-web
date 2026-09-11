# Spike aislado de primitives privadas

Este prototipo compara `react-aria-components` 1.21.1 y `lucide-react` 1.44.0
en los cinco patrones que afectan al flujo comercial: ComboBox/Select,
DatePicker, Dialog, Tabs e iconos. No es una ruta de producción, no se importa
desde `src/` y no modifica la landing ni su loading page.

## Ejecución reproducible

Desde esta carpeta, con Node 20+:

```text
npm install
npm run build
npm run dev
```

En otra terminal, con el Chromium de Playwright disponible:

```text
PLAYWRIGHT_EXECUTABLE_PATH=/ruta/a/chrome-headless-shell npm run check
```

El chequeo recorre 360, 768 y 1440 px y valida interacción de teclado,
selección, locale `es-MX`, focus restore, overflow, consola, peticiones fallidas
y Axe serio/crítico, además de un valor MXN formateado por `Intl.NumberFormat`
con locale `es-MX`. También verifica nombres accesibles para los diálogos,
roles de grid/tablist/tabpanel y relaciones de tabs. La prueba de esta revisión se ejecutó localmente con
Chromium en `/var/tmp/ocpool-playwright` y pasó las tres anchuras.

La comprobación SSR/hidratación usa el servidor Vite del spike para renderizar
`App` en Node y después hidratarlo en Chromium:

```text
PLAYWRIGHT_EXECUTABLE_PATH=/ruta/a/chrome-headless-shell npm run check:ssr
```

Debe terminar con `renderMode: "hydration"`, sin warnings/errors de React ni
peticiones fallidas. Esto sólo verifica el contrato de hidratación del
prototipo; la confirmación final debe repetirse sobre la ruta Next.js antes de
adoptar una familia de primitives.

El spike no decide la adopción. La decisión requiere además revisar SSR/
hidratación, bundle/CSS de una ruta compilada, mantenimiento y aprobación de
frontend/producto en `docs/adr/2026-09-10-private-ui-primitives.md`.

La repetición anónima contra Next.js se ejecuta aparte, sin crear sesiones ni
modificar datos:

```text
APP_URL=http://127.0.0.1:3008 PLAYWRIGHT_EXECUTABLE_PATH=/ruta/a/chrome-headless-shell npm run check:next
```

Recorre `/login`, `/portal/access`, `/staff`, `/staff/requests`, `/staff/quotes`
y `/portal` en 390 y 1440 px. Exige HTML, heading, cero overflow, warnings/errors
inesperados, errores de página y peticiones fallidas; clasifica los `401` de los
endpoints privados como esperados y descarta sólo las cancelaciones normales de
precarga RSC (`net::ERR_ABORTED` con `next-router-prefetch=1`). También valida
`lang="es-MX"` en las rutas privadas. Esta prueba es evidencia de las rutas
Next.js anónimas; no sustituye la matriz autenticada ni una revisión de lector de
pantalla.
