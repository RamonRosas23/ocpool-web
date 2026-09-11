# Plan de implementación — Fase 13: superficies de acceso y recuperación

**Especificación:** `docs/historicos/specs/2026-09-08-ocpool-auth-surfaces.md`
**Autorrevisión:** `docs/historicos/reviews/2026-09-08-ocpool-auth-surfaces-review.md`
**Orden:** tests → implementación mínima → integración → hardening → gate

## Tarea 1 — Contratos de navegación y E2E opt-in

- [x] Crear `tests/auth-surfaces.spec.ts` opt-in con login, MFA, recovery, magic link, replay, expiry, URL limpia, redirecciones y estados restringidos.
- [x] Verificar inicialmente los fallos esperados por páginas inexistentes, manteniendo el ciclo TDD. La primera corrida falló en el enlace aún inexistente hacia `/login`.
- [x] Añadir cobertura 390/768/1440, Axe, foco visible, reduced motion, no overflow, consola sin errores inesperados y ausencia de tokens en DOM/URL final.
- [x] Definir fixtures desechables, cleanup por IDs exactos y Mailpit aislado por mensaje.
- [ ] Commit: `test: define auth surface journeys`.

## Tarea 2 — Contratos de presentación y acceso de empleado

- [x] Crear utilidades compartidas para errores públicos, lectura JSON, estado de formulario, sesión actual y destino seguro.
- [x] Implementar `/login` con correo, contraseña, MFA opcional, recuperación, loading/error/success y accesibilidad completa.
- [x] Reutilizar `POST /api/auth/employee/login` sin cambiar rate limit ni bypass de MFA.
- [x] Cubrir credenciales inválidas, MFA inválido, administrador sin código, sesión ya existente y error de red.
- [x] Integrar acceso sólo hacia `/staff`; rechazar cualquier destino externo o `returnTo` manipulado.
- [x] Commit: `3ebf8f6 feat: add browser auth surfaces`.

## Tarea 3 — Solicitud y consumo de magic link de cliente

- [x] Implementar `/portal/access` con confirmación neutral y rate limit visible sólo como mensaje operativo genérico.
- [x] Implementar `/auth/customer/consume-link` con lectura única del token, `POST` al endpoint existente, `history.replaceState` y redirección a `/portal`.
- [x] Mostrar estados de token ausente, inválido, expirado, reutilizado, error recuperable y éxito.
- [x] Validar el enlace real mediante Outbox/worker/Mailpit y verificar que no quedan tokens en el HTML ni la URL después del consumo.
- [x] Commit: `3ebf8f6 feat: add browser auth surfaces`.

## Tarea 4 — Recuperación de contraseña

- [x] Implementar `/login/recovery` con respuesta neutral para cualquier correo.
- [x] Implementar `/auth/recovery` con contraseña, confirmación, token en memoria, limpieza de URL y consumo de un solo uso.
- [x] Verificar requisitos de contraseña, expiración, replay, cuenta inactiva y error de red.
- [x] Validar el correo de recuperación en Mailpit y limpiar mensajes de fixture por IDs exactos.
- [x] Commit: `3ebf8f6 feat: add browser auth surfaces`.

## Tarea 5 — Integración visual, documentación y seguridad de navegación

- [x] Integrar enlaces desde estados restringidos de `/staff` y `/portal` sin revelar roles ni cuentas.
- [x] Añadir metadata `noindex`, shell responsive, focus ring, `autocomplete`, `role=status/alert` y reduced motion.
- [x] Confirmar que `NEXT`/`returnTo` no se acepta, que la cookie sigue siendo HttpOnly/SameSite y que los endpoints mantienen same-origin.
- [x] Actualizar README, `PROJECT_STATUS.md` y crear `docs/runbooks/auth-surfaces.md` con rutas, Mailpit, variables y ausencia de credenciales fijas.

## Tarea 6 — Gate completo de fase

- [x] Ejecutar unitarias, integración, contenido, typecheck, lint, build, auditoría y E2E normal: 110 unitarias, 79 integraciones, contenido, typecheck, lint, build aislado `.next-e2e`, `npm audit` 0 vulnerabilidades altas y E2E normal 34 pasadas/16 omitidas opt-in.
- [x] Ejecutar E2E opt-in de superficies de acceso y revisar respuestas 401/400/429 sin información sensible: `AUTH_SURFACES_E2E=1 ... tests/auth-surfaces.spec.ts` pasó 5/5.
- [x] Revisar logs, DOM, URLs, screenshots responsive y diff de texto buscando passwords, códigos, tokens, emails privados, UUIDs o stack traces; Axe y la inspección de URL limpia pasaron.
- [x] Confirmar que no se agregó migración ni dependencia innecesaria; el runner E2E sólo aisló `distDir` para no competir con `next dev`, sin cambiar el modelo de datos.
- [x] Actualizar `PROJECT_STATUS.md` con módulos, dependencias, pruebas, problemas resueltos, pendientes y criterios de terminado.
- [ ] Commit de cierre sólo después de evidencia reproducible.

## Gate de terminado

No se marcará Fase 13 como terminada por tener páginas que renderizan. Deben funcionar los enlaces reales, sesión, errores, tokens de un solo uso, RBAC, rate limit, accesibilidad, responsive, Mailpit, pruebas negativas, documentación, build y regresión sin credenciales fijas.
