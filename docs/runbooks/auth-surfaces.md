# Runbook de superficies de acceso

Este runbook describe las rutas de navegador de autenticación local. La autenticación, autorización, rate limit, MFA y uso único de tokens siguen siendo responsabilidad del backend; las pantallas sólo presentan estado y consumen contratos existentes.

## Rutas

| Ruta | Uso |
| --- | --- |
| `/login` | Acceso de empleados con correo, contraseña y MFA opcional |
| `/login/recovery` | Solicitud de recuperación de contraseña de empleado |
| `/auth/recovery?token=...` | Definición de nueva contraseña desde un enlace de un solo uso |
| `/portal/access` | Solicitud de magic link de cliente |
| `/auth/customer/consume-link?token=...` | Consumo de magic link y entrada a `/portal` |

Todas las rutas tienen `noindex`. El login exitoso de empleado lleva a `/staff`; el magic link exitoso lleva a `/portal`. No se acepta `returnTo` ni se redirige a destinos externos.

## Relación con la captación pública

La landing puede crear un expediente anónimo desde `/#contacto` mediante `POST /api/quote-requests`. Ese flujo sólo crea o reutiliza cliente/contacto y solicitud; no crea una cuenta cliente, no inicia sesión y no convierte el folio `OCQ-YYYY-NNNNNN` en credencial. Mientras el contacto no tenga una cuenta cliente activa vinculada, las notificaciones comerciales apuntan a `/portal/access` con la acción “Solicitar acceso”; nunca apuntan a un portal inaccesible.

La captación pública usa consentimiento explícito, idempotencia, rate limiting, protección same-origin, validación backend y honeypot. No se deben documentar contraseñas de prueba ni permitir que el formulario público suba archivos; la autenticación y los archivos permanecen en superficies privadas.

## Inicio local

```powershell
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Abrir:

- Aplicación: `http://localhost:3000`
- Login de empleados: `http://localhost:3000/login`
- Acceso de cliente: `http://localhost:3000/portal/access`
- Mailpit: `http://localhost:18025`

No existen credenciales fijas de prueba. Las E2E crean usuarios desechables, consumen tokens de fixtures y limpian sus IDs al terminar. Para una cuenta real local se debe usar el flujo de recuperación o crear un registro controlado por el procedimiento interno; nunca se deben documentar contraseñas en Git.

## Habilitar el portal desde un expediente

El acceso del cliente se habilita desde `/staff/requests`, dentro del expediente, mediante `Habilitar portal`. La acción exige una sesión de empleado y el permiso backend `identity.users.manage`; el rol `manager` lo recibe por catálogo y `admin` lo hereda, mientras `sales` y los clientes no pueden ejecutarla. La UI oculta la acción cuando la capability no está presente, pero la autorización real siempre se valida en servidor.

El procedimiento es:

1. Abrir `/staff/requests` con una cuenta `manager` o `admin`.
2. Seleccionar el expediente y revisar que el contacto y cliente estén activos.
3. Pulsar `Habilitar portal`.
4. Confirmar en la bandeja que el estado cambie a `Invitación pendiente` y ejecutar el worker local:

```powershell
npm run worker:notifications:once
```

5. Abrir Mailpit, localizar el enlace de acceso y seguirlo una sola vez.
6. Confirmar que el cliente llegue a `/portal` y que el expediente corresponda a su cliente.

Una invitación vigente responde `ALREADY_PENDING` y no crea otro token. Un cliente activo puede recibir un nuevo enlace (`ALREADY_ACTIVE`) sin ser reasignado. Los tokens se guardan como huella y sólo viajan cifrados en el Outbox; no aparecen en la respuesta staff, auditoría, logs ni HTML persistido. Si el contacto está archivado, el cliente está archivado o el correo pertenece a un empleado u otro cliente, la operación se rechaza con un conflicto controlado y no altera vínculos existentes.

## Flujo de empleado

1. Abrir `/login`.
2. Introducir correo y contraseña.
3. Introducir el código TOTP de seis dígitos si la cuenta lo solicita.
4. Confirmar que el navegador llega a `/staff` y que la cookie `ocpool_session` es `HttpOnly`, `SameSite=Lax` y no contiene datos identificables.
5. Para recuperación, abrir `/login/recovery` y solicitar el correo.

La respuesta visible ante credenciales inválidas, cuenta inactiva, MFA incorrecto o rate limit no enumera cuentas. El campo MFA se envía sólo cuando tiene valor; no se relaja el requisito backend de administradores.

## Flujo de cliente

1. Abrir `/portal/access`.
2. Si el contacto es nuevo, no solicitar un enlace todavía: primero un `manager` o `admin` debe habilitar el portal desde el expediente.
3. Cuando la cuenta esté habilitada, introducir el correo asociado al expediente.
4. Confirmar el mensaje que distingue cuenta activa de cliente nuevo; la respuesta no revela si un correo existe.
5. Ejecutar el worker local si se quiere comprobar entrega completa:

```powershell
npm run worker:notifications:once
```

6. Abrir Mailpit, localizar el mensaje del fixture y seguir el enlace.
7. Confirmar que `/auth/customer/consume-link` consume el token, lo elimina del historial mediante `history.replaceState` y redirige a `/portal`.

Los tokens no se guardan en `localStorage`, `sessionStorage`, DOM, logs ni respuestas. Si el enlace expira, se reutiliza o se manipula, la pantalla sólo muestra que no está disponible.

## Recuperación de contraseña

1. Abrir `/login/recovery` y solicitar el correo.
2. Procesar el Outbox con el worker y abrir el enlace de Mailpit.
3. En `/auth/recovery`, definir una contraseña de al menos 12 caracteres con letras y números.
4. Confirmar la contraseña y regresar a `/login`.

El token se quita de la URL antes de mostrar la pantalla de formulario. El endpoint consume el token en una transacción y no permite replay.

## Diagnóstico seguro

- **Ruta 404:** confirmar que el build incorpora `/login`, `/portal/access`, `/auth/recovery` y `/auth/customer/consume-link`; no crear rutas alternativas con nombres parecidos.
- **401 en login:** revisar mensaje genérico, rate limit y estado de la cuenta; no cambiar el frontend para aceptar la sesión.
- **MFA no funciona:** verificar reloj del dispositivo autenticador y que la cuenta tenga secreto MFA configurado; no desactivar MFA para diagnosticar.
- **No llega el correo:** comprobar Outbox, worker, Mailpit y `SMTP_*`; no copiar tokens desde logs ni insertar URLs manuales en producción.
- **Enlace no disponible:** tratarlo como expirado, consumido o manipulado; solicitar uno nuevo.
- **Invitación pendiente:** no crear cuentas manualmente ni repetir inserts; revisar el estado del contacto y procesar Outbox/worker. La reemisión controlada invalida tokens anteriores sólo cuando ya no existe una invitación vigente.
- **Contacto sin acción de portal:** comprobar que la sesión staff tenga `identity.users.manage` y que el usuario sea `manager`/`admin`; la ausencia en UI es intencional para otros roles.
- **Conflicto al habilitar:** confirmar que el contacto esté activo y que su correo no esté asociado a otro cliente o empleado. No reasignar `clientId` manualmente.
- **Origen rechazado:** `APP_URL` debe coincidir con el origen del navegador y las mutaciones deben permanecer same-origin.

No ejecutar consultas destructivas ni borrar cuentas compartidas para “limpiar” una prueba. Los fixtures E2E tienen sufijo único y cleanup exacto.

## Pruebas

```powershell
npx cross-env AUTH_SURFACES_E2E=1 npm run test:e2e -- tests/auth-surfaces.spec.ts
npx cross-env CUSTOMER_ONBOARDING_E2E=1 npx playwright test tests/customer-onboarding.spec.ts
```

La prueba cubre acceso restringido, login de empleado, MFA administrativo, solicitudes neutrales, consumo de magic link, recovery, links inválidos/replay, Axe, foco, reduced motion y los viewports 390/768/1440.
La prueba de onboarding cubre acción manager, deduplicación de invitación, ocultamiento para rol de sólo lectura, estado persistido, Axe y overflow en 390/768/1440. Es opt-in y requiere base local desechable.

El runner E2E construye en `.next-e2e` para no compartir artefactos con un `next dev` activo en `.next`. No se debe ejecutar un build de producción escribiendo el mismo directorio mientras otro proceso de Next está recompilando.
