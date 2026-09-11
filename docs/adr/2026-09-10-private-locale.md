# ADR — Locale semántico de superficies privadas

- **Estado:** `APPROVED_LOCAL`
- **Fecha:** 2026-09-10
- **Owner:** Codex/arquitectura
- **Decisor:** producto/frontend OCPOOL; aprobación explícita recibida en la tarea del 2026-09-11
- **Alcance:** login, staff, portal y auth privada
- **Fuera de alcance:** landing pública y loading page, congeladas por G0-05

## Evidencia

La comprobación `check:next` del spike pasó 12/12 rutas anónimas en 390 y
1440 px sin overflow, errores de página, peticiones fallidas ni warnings
inesperados. Antes de esta decisión las 12 respuestas entregaban `lang="es"`
porque el layout global lo fijaba así; las fechas y moneda del prototipo ya
usaban `es-MX` explícitamente.

## Opciones

| Opción | Resultado | Riesgo |
| --- | --- | --- |
| Cambiar el layout raíz a `es-MX` | Corrige todas las rutas con un cambio | También modifica la semántica de la landing congelada |
| Separar un root layout para rutas privadas | `es-MX` sólo en staff/portal/auth; landing intacta | Requiere reorganización controlada de grupos/rutas y regresión SSR |
| Cambiar `document.documentElement.lang` con un efecto cliente | No reorganiza rutas | El HTML SSR inicial sigue siendo `es`; insuficiente para lector de pantalla y SEO |

## Recomendación

Se adopta la segunda opción: el layout raíz recibe una marca interna del
middleware para entregar `lang="es-MX"` desde SSR en rutas privadas, mientras
mantiene `lang="es"` en la landing. Los formatos numéricos y fechas siguen siendo
explícitos por componente; no se usa un efecto cliente como parche de
accesibilidad.

## Criterios de aceptación

- `/login`, `/portal/access`, `/staff`, `/staff/requests`, `/staff/quotes` y
  `/portal` entregan `lang="es-MX"` desde SSR.
- La landing conserva HTML, CSS, assets, loading page y hash aprobados.
- No aparecen warnings de hidratación ni cambios visuales no aprobados.
- Fechas, moneda y números usan reglas `es-MX` consistentes en staff y portal.
- La decisión queda aprobada por producto/frontend mediante la autorización
  explícita registrada en esta tarea; la implementación no toca la landing.

La implementación local queda en `src/middleware.ts` y `src/app/layout.tsx`.
La regresión SSR/Next.js debe conservar 12/12 rutas, cero overflow, cero errores
de página y `lang="es-MX"` en todas las superficies privadas.
