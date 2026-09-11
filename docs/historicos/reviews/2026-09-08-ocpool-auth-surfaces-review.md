# Autorrevisión — Fase 13: superficies de acceso y recuperación

**Especificación revisada:** `docs/historicos/specs/2026-09-08-ocpool-auth-surfaces.md`
**Fecha:** 2026-09-08
**Resultado:** apta para plan de implementación con límites explícitos

## 1. ¿La fase resuelve una brecha real?

Sí. La autenticación backend ya tiene cobertura, pero las rutas privadas no ofrecen una experiencia de acceso desde navegador. Además, las plantillas de correo ya apuntan a `/auth/customer/consume-link` y `/auth/recovery`; dejar esas rutas sin página produce enlaces funcionalmente incompletos.

## 2. ¿Se está duplicando seguridad en frontend?

No. La UI sólo valida formato, muestra estado y consume contratos. La sesión, RBAC, MFA, rate limit, expiración y uso único continúan en servicios y rutas backend. La UI no recibirá permisos como fuente de autorización ni podrá convertir un error en acceso.

## 3. ¿El login MFA actual es suficiente para la primera vertical slice?

El contrato actual acepta el código MFA junto con credenciales y ya está cubierto por integración. La primera implementación mostrará el campo MFA dentro del formulario, evitando almacenar contraseñas o introducir una tabla de challenges sin necesidad. Si las pruebas de UX muestran que un flujo de dos pasos es indispensable, se detendrá ese cambio y se diseñará un challenge persistido, expirado y de un solo uso antes de tocar el esquema.

## 4. ¿Hay riesgo de enumeración?

La especificación exige mensajes neutrales para login inválido, recovery y magic link. El comportamiento exacto debe verificarse con pruebas de respuesta y de contenido, no sólo con el texto de la UI. No se mostrarán “correo no registrado”, “cliente inexistente” ni estados que permitan inferir cuentas.

## 5. ¿Hay riesgo por tokens en URL?

Sí, es el riesgo principal de esta fase. Se mitiga consumiendo el token inmediatamente, no persistiendo secretos, reemplazando la URL antes de la navegación normal y comprobando que el DOM, consola y logs no contienen el token. La URL del correo ya está limitada por allowlist; no se añadirá redirección abierta.

## 6. ¿El correo local forma parte del alcance?

Sí, como dependencia de verificación, no como proveedor productivo. Mailpit debe demostrar que la solicitud produce el enlace correcto, que el worker lo entrega y que el enlace permite completar el flujo. Producción SMTP, DNS, reputación y observabilidad siguen bloqueados por Fase 10.

## 7. ¿Se necesita una dependencia nueva?

No. Next.js, React, Zod, CSS existente, Vitest y Playwright cubren la fase. Una librería de formularios no aporta suficiente valor para cinco formularios pequeños y añadirla ahora aumentaría superficie sin mejorar seguridad.

## 8. ¿Qué podría bloquear el desarrollo?

- Si el endpoint de login no permite distinguir una solicitud de MFA sin filtrar información sensible, la UX de dos pasos no se implementará por intuición.
- Si el worker no corre durante E2E, se usará un fixture de Outbox controlado para separar pruebas de UI de pruebas de entrega, sin saltarse la integración Mailpit.
- Si una ruta de consumo deja el token en el historial, se considerará falla de seguridad y no sólo defecto visual.

## 9. Veredicto

La especificación es apta para convertirse en plan. El plan debe comenzar por contratos y E2E que fallen, reutilizar los endpoints existentes, evitar migraciones por defecto y cerrar con pruebas negativas de enumeración, replay, expiración, open redirect, sesión y filtración de secretos.

