# Autorrevisión — Onboarding y acceso del cliente

## Decisión revisada

Se conserva el modelo relacional existente y se reutiliza `User`, `ClientContact`, `AuthToken`, Outbox y la sesión de magic link. El acceso se habilita explícitamente desde staff porque la autorización actual del formulario sólo cubre contacto, no una activación silenciosa del portal.

## Controles revisados

- La acción exige `identity.users.manage`; ventas no puede crear ni vincular usuarios.
- El vínculo sólo puede apuntar al mismo `clientId` y el contacto mantiene unicidad.
- La cuenta nace `INVITED`, no `ACTIVE`; el token de un solo uso produce la activación.
- Los tokens y recipients continúan cifrados/hasheados según el baseline de auth y notificaciones.
- Invitaciones vigentes se deduplican para evitar spam; reemisión invalida el token anterior.
- Los correos sin cuenta no prometen una sesión inexistente: usan `/portal/access`.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Estado |
| --- | --- | --- |
| IDOR al habilitar otro expediente | Lock + lookup por UUID + empleado autorizado + vínculo al cliente | Controlado |
| Reasignación de un correo entre clientes | Conflicto seguro, nunca reubicar usuario existente | Controlado |
| Replay o token filtrado | Hash, cifrado Outbox, expiración, consumo condicional y sesión nueva | Controlado por contratos existentes |
| Spam por reintentos de staff | Invitación pendiente idempotente e invalidación explícita al reemitir | Controlado |
| Enlace portal inválido antes del onboarding | Resolver y template con fallback `/portal/access` | Controlado |
| Cuenta activada sin posesión del correo | Estado `INVITED` hasta consumo del enlace | Controlado |
| Privacidad y retención | No se agrega PII a payloads seguros; políticas legales siguen pendientes | Pendiente externo |

## No-go

No se agregan contraseñas, SSO, invitaciones masivas, MFA de cliente ni acciones administrativas de borrado. La disponibilidad del proveedor SMTP, backups y operación productiva permanece bloqueada por la fase de preparación de producción.
