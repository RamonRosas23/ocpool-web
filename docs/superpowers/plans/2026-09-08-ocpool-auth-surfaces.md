# Plan de implementación — Fase 13: superficies de acceso y recuperación

**Especificación:** `docs/superpowers/specs/2026-09-08-ocpool-auth-surfaces.md`  
**Autorrevisión:** `docs/superpowers/reviews/2026-09-08-ocpool-auth-surfaces-review.md`  
**Orden:** tests → implementación mínima → integración → hardening → gate

## Tarea 1 — Contratos de navegación y E2E opt-in

- [ ] Crear `tests/auth-surfaces.spec.ts` opt-in con login, MFA, recovery, magic link, replay, expiry, URL limpia, redirecciones y estados restringidos.
- [ ] Verificar inicialmente los fallos esperados por páginas inexistentes, manteniendo el ciclo TDD.
- [ ] Añadir cobertura 390/768/1440, Axe, foco visible, reduced motion, no overflow, consola sin errores inesperados y ausencia de tokens en DOM/URL final.
- [ ] Definir fixtures desechables, cleanup por IDs exactos y Mailpit aislado por mensaje.
- [ ] Commit: `test: define auth surface journeys`.

## Tarea 2 — Contratos de presentación y acceso de empleado

- [ ] Crear utilidades compartidas para errores públicos, lectura JSON, estado de formulario, sesión actual y destino seguro.
- [ ] Implementar `/login` con correo, contraseña, MFA opcional, recuperación, loading/error/success y accesibilidad completa.
- [ ] Reutilizar `POST /api/auth/employee/login` sin cambiar rate limit ni bypass de MFA.
- [ ] Cubrir credenciales inválidas, MFA inválido, administrador sin código, sesión ya existente y error de red.
- [ ] Integrar acceso sólo hacia `/staff`; rechazar cualquier destino externo o `returnTo` manipulado.
- [ ] Commit: `feat: add employee login surface`.

## Tarea 3 — Solicitud y consumo de magic link de cliente

- [ ] Implementar `/portal/access` con confirmación neutral y rate limit visible sólo como mensaje operativo genérico.
- [ ] Implementar `/auth/customer/consume-link` con lectura única del token, `POST` al endpoint existente, `history.replaceState` y redirección a `/portal`.
- [ ] Mostrar estados de token ausente, inválido, expirado, reutilizado, error recuperable y éxito.
- [ ] Validar el enlace real mediante Outbox/worker/Mailpit y verificar que no quedan tokens en el HTML ni la URL después del consumo.
- [ ] Commit: `feat: add customer access surfaces`.

## Tarea 4 — Recuperación de contraseña

- [ ] Implementar `/login/recovery` con respuesta neutral para cualquier correo.
- [ ] Implementar `/auth/recovery` con contraseña, confirmación, token en memoria, limpieza de URL y consumo de un solo uso.
- [ ] Verificar requisitos de contraseña, expiración, replay, cuenta inactiva y error de red.
- [ ] Validar el correo de recuperación en Mailpit y limpiar mensajes de fixture por IDs exactos.
- [ ] Commit: `feat: add password recovery surfaces`.

## Tarea 5 — Integración visual, documentación y seguridad de navegación

- [ ] Integrar enlaces desde estados restringidos de `/staff` y `/portal` sin revelar roles ni cuentas.
- [ ] Añadir metadata `noindex`, shell responsive, focus ring, `autocomplete`, `role=status/alert` y reduced motion.
- [ ] Confirmar que `NEXT`/`returnTo` no se acepta, que la cookie sigue siendo HttpOnly/SameSite y que los endpoints mantienen same-origin.
- [ ] Actualizar README, `PROJECT_STATUS.md` y crear `docs/runbooks/auth-surfaces.md` con rutas, Mailpit, variables y ausencia de credenciales fijas.
- [ ] Commit: `docs: document auth surfaces`.

## Tarea 6 — Gate completo de fase

- [ ] Ejecutar unitarias, integración, contenido, typecheck, lint, build, auditoría y E2E normal.
- [ ] Ejecutar E2E opt-in de superficies de acceso y revisar respuestas 401/400/429 sin información sensible.
- [ ] Revisar logs, DOM, URLs, screenshots responsive y diff de texto buscando passwords, códigos, tokens, emails privados, UUIDs o stack traces.
- [ ] Confirmar que no se agregó migración ni dependencia innecesaria; si aparece una necesidad de challenge MFA, abrir una especificación separada antes de implementarla.
- [ ] Actualizar `PROJECT_STATUS.md` con módulos, dependencias, pruebas, problemas resueltos, pendientes y criterios de terminado.
- [ ] Commit de cierre sólo después de evidencia reproducible.

## Gate de terminado

No se marcará Fase 13 como terminada por tener páginas que renderizan. Deben funcionar los enlaces reales, sesión, errores, tokens de un solo uso, RBAC, rate limit, accesibilidad, responsive, Mailpit, pruebas negativas, documentación, build y regresión sin credenciales fijas.

