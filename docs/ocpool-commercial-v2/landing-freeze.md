# G0-05 — Congelación y rollback de la landing

**Estado técnico:** `VERIFIED_LOCAL_PARTIAL`
**Fecha de captura:** 2026-09-10
**Runner:** Chromium de Playwright en `/var/tmp/ocpool-playwright`
**Alcance:** sólo `/`; no modifica archivos de la landing ni activa flags V2.

## Captura reproducible

```text
PLAYWRIGHT_BROWSERS_PATH=/var/tmp/ocpool-playwright \
APP_URL=http://127.0.0.1:3008 \
npm run baseline:v2:landing
```

El comando escribe capturas efímeras en `/var/tmp/ocpool-landing-freeze/` y
actualiza el manifiesto versionado [`landing-freeze.json`](landing-freeze.json).
La captura local del 2026-09-10 obtuvo HTTP 200, título estable y cero overflow
en los tres breakpoints:

| Breakpoint | Screenshot SHA-256 |
| --- | --- |
| 390×844 | `fe2699a25177a6953215f79590da0bf01c978db8b3791531ba1ed4a4ee82c165` |
| 768×1024 | `bdfb252246c7a137f90268f7e38b66e8fa27ab53f452d3bc6746978f131afb34` |
| 1440×900 | `602f9f53fce72437f842251bd5d389bc4113a7a187bbfd5a1e01c55772354e49` |

El manifiesto conserva `landingTouched: false`. Un cambio de hash no autoriza
por sí solo una modificación: debe detenerse la slice privada, identificar la
causa y repetir la revisión pública antes de aceptar cualquier cambio.

## Kill switch y fallback

El rollout V2 permanece fail-closed. Para habilitar una superficie se requieren
simultáneamente `OCPOOL_V2_FLAGS_APPROVED=true` y el flag canónico de esa
superficie en `true`; cualquier otro valor mantiene todo desactivado. El
rollback operativo es retirar `OCPOOL_V2_FLAGS_APPROVED` (o ponerlo en un valor
distinto de `true`) y reiniciar el proceso de aplicación conforme al runbook de
operación. No se cambia la landing ni se requiere migración de datos.

Este documento no es aprobación de producto. G0-05 sigue pendiente de signoffs,
de los objetivos comerciales de G0-03 y de la revisión humana de primitives y
locale privado.
