# Administración del equipo: invitar, roles, suspender y accesos

Fecha: 2026-09-27 · Rama: `catalog-ux-redesign`

## Problema

Hoy no existe ninguna pantalla para administrar a las personas del equipo. Un empleado nuevo sólo
puede darse de alta con scripts; nadie puede cambiar un rol, suspender a quien se va ni ayudar a
quien olvidó su contraseña sin tocar la base. Cuando alguien sale de la empresa, sus expedientes y
proyectos quedan a su nombre y se detienen. El permiso `identity.users.manage` (Gerencia y
Administración) ya existe, pero no tiene superficie.

## Qué se construye

Pantalla **Equipo** (`/staff/team`) para quien tiene `identity.users.manage`:

- **Lista** de empleados con rol, estado (Activa, Invitación pendiente/vencida, Suspendida), último
  acceso, verificación en dos pasos y **carga**: expedientes abiertos y proyectos en arranque a su
  cargo. Vistas: Activos · Invitaciones · Suspendidos · Todos, y búsqueda por nombre o correo.
- **Invitar persona**: nombre, correo y rol (Ventas o Gerencia). Se crea la cuenta como
  `INVITED` y se envía un correo de bienvenida con un enlace de un solo uso (72 h) para crear su
  contraseña; al crearla, la cuenta queda activa. **Reenviar** invalida el enlace anterior;
  **cancelar** deja la cuenta deshabilitada (se puede volver a invitar).
- **Cambiar rol** entre Ventas y Gerencia, explicado en lenguaje de negocio. Los permisos se leen en
  cada petición, así que el cambio aplica de inmediato sin cerrar su sesión.
- **Suspender**: no podrá entrar, sus sesiones se cierran y sus enlaces pendientes se invalidan. Si
  tiene expedientes abiertos o proyectos en arranque, se **reasignan** en el mismo paso a otra
  persona activa (o quedan "Sin asignar"), con historial y auditoría por expediente.
  **Reactivar** la devuelve a activa (o a invitación si nunca creó contraseña).
- **Enviar enlace para nueva contraseña** (reutiliza la recuperación existente) y **cerrar sus
  sesiones abiertas** (equipo perdido o robado).

## Decisiones

- **Roles asignables: Ventas y Gerencia.** Las cuentas de Administrador exigen MFA y se crean con
  `npm run admin:bootstrap` (procedimiento seguro en terminal); en la pantalla aparecen como sólo
  lectura. Así no hay escalada de privilegios ni riesgo de dejar la plataforma sin administradores.
- **Nadie se modifica a sí mismo** desde Equipo (rol, suspensión, sesiones): evita bloqueos
  accidentales. Como quien administra conserva su permiso, siempre queda al menos una persona que
  puede administrar.
- **Sin migraciones:** se usan los estados de usuario existentes (`INVITED`, `ACTIVE`, `SUSPENDED`,
  `DISABLED`) y los tokens `PASSWORD_RESET` (hash, un solo uso). La invitación es un token de 72 h;
  la recuperación conserva su vigencia corta.
- **Correo:** evento nuevo `AUTH.EMPLOYEE_INVITATION` (plantilla "Te damos la bienvenida"), cifrado
  igual que la recuperación; el enlace nunca se muestra en pantalla. El texto de recuperación deja
  de decir "Solicitaste" (ahora también la puede pedir gerencia).
- **Reasignación en bloque sin avalancha de correos:** se registran asignación, historial y
  auditoría por expediente, pero no un correo por cada uno; quien recibe los expedientes los ve en
  "Mi trabajo" del dashboard.
- **Auditoría:** categoría nueva **"Equipo y accesos"** con invitaciones, cambios de rol,
  suspensiones, reactivaciones, enlaces enviados y sesiones cerradas.

## Fuera de alcance (siguiente bloque)

- "Mi cuenta": cambiar la propia contraseña y activar la verificación en dos pasos desde la
  aplicación (hoy sólo por terminal); después, poder exigirla a Gerencia.
- Roles personalizados (`identity.roles.manage` sigue reservado).

## Verificación

Pruebas de integración del servicio (invitar, correo duplicado o de cliente, aceptar invitación,
candados de rol/propios/administrador, suspensión con reasignación de expedientes —los proyectos
en arranque siguen el mismo camino, sin prueba propia todavía—, reactivación, reenviar/cancelar,
sesiones), unitarias de dominio y plantilla, y recorrido en navegador
con un escenario QA aislado. Resultado: 319 unitarias, integración 149/149, E2E 60/61 (sólo la falla
preexistente de la landing), bandeja V2 5/5 y shell 2/2.
