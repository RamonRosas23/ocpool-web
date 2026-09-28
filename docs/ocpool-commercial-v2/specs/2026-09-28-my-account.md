# Mi cuenta: contraseña, verificación en dos pasos y sesiones

Fecha: 2026-09-28 · Rama: `catalog-ux-redesign`

## Problema

Cada persona del equipo depende de otros para cuidar su propio acceso: no puede cambiar su contraseña
(sólo recuperarla por correo), la verificación en dos pasos sólo existe para administradores y se
activa por terminal, y nadie puede ver ni cerrar sus sesiones abiertas en otros equipos.

## Qué se construye

**Mi cuenta** (`/staff/account`), para cualquier empleado, desde el menú de su nombre (escritorio y
móvil), el shell V2 y el buscador rápido (Ctrl + K):

- **Perfil:** nombre visible (así lo ven sus compañeros y los clientes en la conversación); al
  guardarlo el encabezado se actualiza sin recargar. Correo, rol y antigüedad, de sólo lectura.
- **Contraseña:** cambiarla con la contraseña actual; mismas reglas que la recuperación (12+
  caracteres con letras y números) más "distinta de la actual", validadas en vivo. Al cambiarla se
  cierran sus otras sesiones y se anulan enlaces de recuperación pendientes. Enlace a "¿No recuerdas
  la actual?" (recuperación por correo).
- **Verificación en dos pasos (TOTP):** tres pasos en la misma tarjeta: abrir la app, escanear el QR
  (o escribir la clave agrupada de 4 en 4, copiarla, o "Abrir en mi app" con el enlace `otpauth` en
  pantallas táctiles) y confirmar un código de 6 dígitos. Desde ese momento el acceso pide el código.
  Se desactiva con contraseña y código; para administradores es obligatoria.
- **Sesiones abiertas:** equipo legible ("Chrome en Windows", "Safari en iPhone"), "Esta sesión",
  última actividad, IP e inicio; cerrar una sesión o todas las demás (con confirmación).
- **Actividad reciente:** últimos 8 accesos, intentos fallidos y cambios de seguridad, en segunda
  persona y distinguiendo lo que hizo gerencia ("Gerencia quitó tu verificación en dos pasos").
- **Estado de protección** en la cabecera: "Protección básica" (sólo contraseña) o "Cuenta
  protegida", enlazado a la verificación.

En **Equipo**, gerencia puede **quitar la verificación en dos pasos** de alguien que perdió o cambió
su teléfono (no a administradores ni a sí misma), con confirmación; queda en auditoría y en la
actividad de la persona.

## Decisiones

- **La inscripción no guarda nada hasta confirmar:** el servidor entrega la clave junto con un
  comprobante sellado (cifrado con `MFA_ENCRYPTION_KEY`, ligado a la persona y válido 15 min) y sólo
  al validar el primer código guarda el secreto cifrado. Sin columnas nuevas. Si la clave vence, la
  pantalla lo dice y ofrece generar otra.
- **No sacar a nadie de su sesión:** activar la verificación marca la sesión actual como verificada
  (ya probó tener el teléfono) y cierra las demás, que se abrieron sin código. El mismo código no se
  acepta dos veces (último contador aceptado).
- **Límite de intentos** para cambiar la contraseña y confirmar/desactivar códigos, con el mismo
  mecanismo de los accesos (por persona).
- **QR sin servicios externos:** `qrcode-generator` (MIT, sin dependencias) calcula la matriz y la
  pantalla la dibuja como un solo trazo SVG con fondo blanco; la clave nunca sale del navegador.
- **Auditoría de seguridad:** eventos nuevos `PASSWORD_CHANGED` y `MFA_DISABLED` (migración de enum)
  junto al existente `MFA_ENROLLED`; el origen (`account`, `account_others`, `team`) va en los
  metadatos y la actividad lo usa para redactar.
- **Errores que la persona corrige, sin referencia de soporte:** en Mi cuenta, "La contraseña actual
  no es correcta" o "El código no coincide" se muestran limpios (`readApiResponse(..., {
  plainClientErrors: true })`); los fallos del servidor conservan la referencia. El resto de la
  plataforma no cambia.
- **El foco nunca se pierde:** al abrir un formulario va al primer campo; al guardar o cancelar
  vuelve al botón que lo abrió; al activar/desactivar la verificación o cerrar una sesión pasa al
  título de la tarjeta. Al empezar la activación, la tarjeta completa queda a la vista (el QR antes
  que el campo del código).
- **Nombre del equipo, no huella:** el user agent sólo se traduce a navegador y sistema para que la
  persona se reconozca.

## Fuera de alcance

- Exigir la verificación a Gerencia desde Equipo: requiere inscripción durante el primer acceso de
  quien aún no la tiene.
- Códigos de respaldo (`MFA_RECOVERY` sigue reservado); por ahora la recuperación es que gerencia
  quite la verificación desde Equipo.
- Cambiar el propio correo (es el usuario de acceso).

## Operación

- Aplicar la migración `20260928010000_account_security_events` y regenerar el cliente
  (`npx prisma migrate deploy && npx prisma generate`).
- En desarrollo el cliente de Prisma vive en `globalThis`: un `npm run dev` que ya estaba corriendo
  antes de regenerar sigue con el cliente anterior y `/api/staff/account` responde 500 hasta
  reiniciarlo.

## Verificación

- Navegador (escenario QA aislado `@qa-account.test`, retirado al terminar, sobre un servidor de
  desarrollo propio): nombre (el encabezado se actualiza), contraseña incorrecta / igual a la actual
  / correcta (cierra 2 sesiones), activar con el código calculado de la clave mostrada, acceso real
  con la contraseña nueva + código, cerrar la sesión de otro equipo, desactivar con contraseña y
  código, reactivar y quitarla desde Equipo como gerencia; 1440, 768 y 375 px sin desbordes.
- `tsc`, lint (incluido `src/server`), 323 pruebas unitarias, integración completa 150/150, E2E
  opt-in contra build de producción 61/62 (nueva prueba de Mi cuenta en `auth-surfaces.spec.ts`;
  sólo la falla preexistente de imágenes de la landing en `quality.spec.ts`), `request-workspace-v2`
  5/5 y harness del shell 2/2.
