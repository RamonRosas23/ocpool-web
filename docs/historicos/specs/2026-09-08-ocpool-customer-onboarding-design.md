# Especificación — Onboarding y acceso del cliente

## Objetivo

Cerrar la transición entre un expediente público captado y un cliente con acceso seguro al portal, sin usar el folio como credencial, sin mezclar clientes y sin permitir que un empleado comercial con permisos de lectura habilite cuentas por accidente.

## Alcance

La fase implementa una acción interna `Habilitar portal` sobre un expediente, creación o reutilización segura del usuario `CUSTOMER`, vinculación única `ClientContact.userId`, invitación por magic link de un solo uso, activación transaccional al consumir el enlace, proyecciones staff y corrección de enlaces de notificación cuando todavía no existe acceso.

Quedan fuera de esta fase: contraseñas para clientes, invitaciones masivas, cambio de correo por el cliente, recuperación administrativa, SSO, MFA del cliente, exportación de usuarios y archivos anónimos.

## Modelo de datos vigente

Se reutilizan las relaciones existentes:

- `User(type=CUSTOMER, status=INVITED|ACTIVE, clientId)` representa la cuenta.
- `ClientContact(userId)` representa la vinculación con el contacto autorizado.
- `AuthToken(type=MAGIC_LINK)` guarda sólo la huella del token y su expiración.
- `OutboxEvent(AUTH.CUSTOMER_MAGIC_LINK)` entrega el token cifrado al worker.
- `AuthEvent` y `AuditLog` conservan la trazabilidad.

No se agrega una tabla de invitaciones. La unicidad actual de `User.emailNormalized` y `ClientContact.userId` se mantiene como constraint de seguridad.

## Flujo normal

1. La solicitud pública crea o reutiliza cliente/contacto, pero no crea una cuenta ni habilita portal.
2. Un empleado con `identity.users.manage` abre el expediente y pulsa `Habilitar portal`.
3. El servicio bloquea el expediente, valida que el contacto y cliente estén activos, resuelve el usuario por correo y verifica que no pertenezca a otro cliente.
4. Si no existe, crea un usuario `CUSTOMER` en estado `INVITED`; si existe el usuario correcto, lo reutiliza. Vincula el contacto dentro de la misma transacción.
5. Si hay una invitación vigente no consumida, no envía otra y devuelve `ALREADY_PENDING`. Si no, invalida invitaciones anteriores, crea un `MAGIC_LINK` nuevo y registra Outbox/AuthEvent/AuditLog.
6. El worker entrega el enlace cifrado a Mailpit/local SMTP. El token crudo nunca aparece en respuesta, payload seguro ni logs.
7. El cliente abre el enlace; el consumidor valida una sola vez, cambia `INVITED → ACTIVE`, crea la sesión y redirige a `/portal`.

## Colisiones y negativas

- Un `CUSTOMER` existente vinculado al mismo cliente se reutiliza.
- Un usuario con el mismo correo vinculado a otro cliente, un empleado con ese correo o un contacto archivado produce `CONFLICT` controlado; no se reasigna ni se filtra la existencia de otra cuenta al navegador.
- Un cliente o contacto archivado no puede recibir invitación.
- Dos invitaciones simultáneas se serializan por el lock del expediente y constraints existentes.
- Un token expirado, consumido o reemplazado no crea sesión.
- Repetir la acción durante una invitación vigente es idempotente y no genera correo duplicado.

## Autorización

Se otorga el permiso de catálogo existente `identity.users.manage` sólo al rol `manager`; `admin` ya lo hereda por su definición completa y `sales` conserva lectura de identidad pero no puede habilitar portal. El backend verifica sesión, tipo EMPLOYEE, permiso y same-origin. La UI sólo oculta acciones no autorizadas; nunca es la única barrera.

## Notificaciones

Los eventos dirigidos a un contacto sin usuario no deben apuntar a `/portal`. El resolver seleccionará `/portal` cuando exista usuario cliente activo y `/portal/access` cuando no exista, con etiqueta de acción coherente (`Ver expediente` o `Solicitar acceso`). Las URLs continúan limitadas al allowlist existente.

## Criterios de terminado

- Cuenta y contacto se crean/vinculan sólo dentro de una transacción y con constraints existentes.
- El magic link es de un solo uso, expira, no se guarda en claro y activa sólo al consumirse.
- La matriz RBAC cubre manager/admin permitido y sales/customer denegados.
- API y UI staff cubren carga, éxito, pendiente, conflicto y error.
- E2E verifica expediente público → habilitar portal → Mailpit → consumo → `/portal`, replay bloqueado y cliente cruzado aislado.
- README, runbooks, `PROJECT_STATUS.md`, revisión y plan registran límites, pruebas y operación local.
