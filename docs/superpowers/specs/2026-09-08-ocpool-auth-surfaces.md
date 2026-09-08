# Especificación — Fase 13: superficies de acceso y recuperación

**Fecha:** 2026-09-08  
**Estado:** propuesta técnica preparada para revisión y ejecución  
**Alcance:** local primero, compatible con la política de producción existente  
**Dependencias:** Fases 2, 5, 9 y 12

## 1. Problema y objetivo

OCPOOL ya tiene autenticación backend, sesiones persistidas, RBAC, MFA administrativo, magic link de cliente, recuperación de contraseña y entrega transaccional por Outbox/Mailpit. Sin embargo, no existe una superficie web completa para iniciar esos flujos:

- `/staff` y `/portal` muestran acceso restringido cuando no hay sesión, pero no ofrecen una entrada operativa.
- No existe una ruta navegable `/login` para empleados.
- No existe una pantalla para solicitar un magic link de cliente.
- Los enlaces que ya genera el correo (`/auth/customer/consume-link` y `/auth/recovery`) todavía no tienen páginas de consumo.
- No existe una pantalla de solicitud de recuperación de contraseña.

El objetivo es cerrar esa brecha sin duplicar seguridad en frontend, sin crear credenciales demo estáticas y sin cambiar el modelo de autorización backend. El resultado debe permitir que una persona real recorra el acceso desde el navegador y reciba feedback claro, seguro y coherente con la identidad visual de OCPOOL.

## 2. Resultado esperado

Al finalizar la fase existirán estas superficies:

| Ruta | Actor | Propósito |
| --- | --- | --- |
| `/login` | empleado | Correo, contraseña y código MFA opcional según la cuenta; acceso al sistema interno |
| `/login/recovery` | empleado | Solicitar recuperación sin enumerar cuentas |
| `/auth/recovery?token=...` | empleado | Consumir token de un solo uso y definir nueva contraseña |
| `/portal/access` | cliente | Solicitar magic link sin revelar si el correo existe |
| `/auth/customer/consume-link?token=...` | cliente | Consumir magic link, limpiar el token del navegador y entrar al portal |

Las rutas de destino después de autenticación serán fijas y seguras: empleado a `/staff` y cliente a `/portal`. No se aceptará un `returnTo` arbitrario ni se implementará redirección externa.

## 3. Alcance funcional

### 3.1 Acceso de empleado

- Formulario con correo, contraseña y campo de código MFA de seis dígitos.
- El campo MFA tendrá ayuda contextual: sólo es necesario para cuentas configuradas con MFA o administradores.
- Mensaje genérico para credenciales inválidas, cuenta inactiva, límite de intentos o MFA incorrecto; nunca se indicará si el correo existe.
- Estados de carga, error, bloqueo temporal y éxito.
- `autocomplete` correcto (`username`, `current-password`, `one-time-code`) y foco inicial razonable.
- Enlace a recuperación de contraseña.
- Si ya hay sesión válida, la página no debe destruirla; debe ofrecer continuar al destino correspondiente o redirigir según el tipo de sesión.

### 3.2 Recuperación de contraseña

- `/login/recovery` solicita correo y siempre muestra una confirmación neutral.
- El backend existente conserva rate limit, respuesta sin enumeración, token cifrado en Outbox y expiración.
- `/auth/recovery` valida el token en memoria del cliente, permite nueva contraseña y confirmación, y consume el token una sola vez.
- El token se elimina de la barra de direcciones inmediatamente después de leerlo y nunca se guarda en `localStorage`, `sessionStorage`, analytics ni logs de aplicación.
- Tras éxito, se informa que la contraseña fue actualizada y se ofrece regresar a `/login`.

### 3.3 Acceso de cliente

- `/portal/access` solicita correo con una explicación breve del acceso sin contraseña.
- La confirmación es idéntica para correo existente, inexistente, inactivo o limitado.
- El enlace enviado por `auth.customer.magic_link` llega a `/auth/customer/consume-link?token=...`.
- La página consume el token mediante `POST /api/auth/customer/consume-link`, limpia la URL con `history.replaceState`, muestra progreso y redirige a `/portal` sólo con sesión válida.
- Token expirado, reutilizado, malformado o de otro tipo produce una pantalla segura de acceso no disponible, sin datos internos.

### 3.4 Consistencia visual y UX

- Shell de acceso editorial sobrio, premium y coherente con la landing; no se reutilizará el dashboard como formulario improvisado.
- Diferenciación clara entre “acceso interno” y “portal de cliente”.
- Layout usable a 390, 768 y 1440 px sin overflow.
- Contraste AA, foco visible, labels asociados, mensajes con `role="alert"`/`role="status"`, targets táctiles y `prefers-reduced-motion`.
- No mostrar stack traces, códigos SQL, rutas internas, identificadores, emails de otras personas ni tokens.
- No instalar una librería visual nueva: se reutilizarán tokens y CSS de la identidad existente.

## 4. Contratos backend reutilizados

La fase consumirá estos contratos ya existentes:

- `POST /api/auth/employee/login` con `email`, `password` y `mfaCode` opcional.
- `POST /api/auth/recovery/request` con `email`.
- `POST /api/auth/recovery/consume` con `token` y `newPassword`.
- `POST /api/auth/customer/request-link` con `email`.
- `POST /api/auth/customer/consume-link` con `token`.
- `GET /api/auth/session` para resolver sesión actual.
- `POST /api/auth/session` para logout cuando aplique.

Si la implementación demuestra que el flujo MFA necesita un estado intermedio para ofrecer una UX de dos pasos, se deberá diseñar primero un contrato explícito de challenge de corta duración. No se guardará una contraseña en almacenamiento del navegador ni se añadirá un bypass de MFA para simplificar la pantalla. La primera implementación preferirá el contrato actual de código opcional y sólo ampliará backend con evidencia de necesidad.

## 5. Seguridad

- Mantener autorización, rate limit, MFA y consumo de tokens en backend.
- Mantener protección same-origin de las mutaciones.
- Evitar enumeración de cuentas en login, magic link y recovery.
- Limpiar tokens de URL antes de renderizar contenido posterior o navegar.
- No registrar tokens, contraseñas, códigos MFA, emails crudos ni cuerpos de respuesta.
- Validar longitud y formato en frontend sólo como feedback; el backend sigue siendo la fuente de verdad.
- Rechazar tokens ausentes, expirados, consumidos, de tipo incorrecto y repetidos.
- Probar navegación directa a `/auth/...` sin token y con token externo manipulado.
- No introducir `returnTo`, enlaces externos ni persistencia local de secretos.

## 6. Fuera de alcance

- Alta pública de empleados o clientes.
- Cambio de correo o administración de perfiles.
- Enrolamiento visual de MFA y recuperación de MFA.
- SSO, OAuth, passkeys o proveedores externos.
- CAPTCHA o WAF productivo; se mantienen como decisiones del gate de producción.
- Credenciales de prueba fijas o una cuenta demo pública.

## 7. Dependencias y decisiones esperadas

- El worker de notificaciones local debe estar disponible para comprobar los enlaces de correo en Mailpit.
- `APP_URL` debe coincidir con el origen del navegador para conservar same-origin.
- Las plantillas ya tienen rutas allowlisted; no se ampliará esa lista salvo necesidad documentada.
- La fase no requiere migración de base de datos salvo que el diseño MFA intermedio lo justifique y pase una revisión específica.
- No se añadirá dependencia importante; se usarán React, Next.js, Zod/contratos actuales, CSS existente y Playwright/Vitest.

## 8. Criterios de aceptación

La fase sólo podrá cerrarse cuando:

1. Las cinco superficies se puedan abrir mediante enlaces navegables y tengan metadata `noindex` donde corresponda.
2. El login de empleado funcione con sesión real, rechace credenciales incorrectas y cubra MFA administrativo sin relajar el backend.
3. Cliente pueda solicitar y consumir un magic link local desde Mailpit; el token sea de un solo uso y desaparezca de la URL.
4. Recovery permita solicitar y consumir un enlace sin enumerar cuentas ni exponer el token.
5. Las rutas privadas continúen protegidas y redirijan sólo al destino seguro definido.
6. Existan pruebas unitarias/integración para contratos, errores, tokens y redirecciones negativas.
7. Exista E2E opt-in para empleado, MFA, cliente, recovery, replay/expiry y estados de error.
8. Axe, foco, responsive, reduced motion, consola limpia y ausencia de secretos en DOM/URL/logs estén verificados.
9. `typecheck`, lint, build, auditoría de dependencias y regresión completa permanezcan verdes.
10. `PROJECT_STATUS.md`, README y un runbook de acceso local documenten rutas, flujo, variables, Mailpit y la ausencia deliberada de credenciales fijas.

