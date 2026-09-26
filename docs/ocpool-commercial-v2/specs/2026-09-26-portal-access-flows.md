# Portal del cliente y accesos: continuidad y confianza

**Fecha:** 2026-09-26
**Rama:** `catalog-ux-redesign`
**Contexto:** cuarta tanda de flujos ("sigue con el portal del cliente y los accesos"). Se partió del seguimiento en 5 etapas y "Tu siguiente paso" ya agregados al portal ([spec](2026-09-26-private-flows-guidance.md)); esta vez el foco fue la conversación, moverse por un expediente largo y las pantallas de acceso. Sin cambios de reglas de negocio ni de API.

## Diagnóstico

1. **La conversación abría en los mensajes más viejos.** La API pagina en orden cronológico ascendente y su cursor avanza hacia los más nuevos; el portal (y el panel de staff) pedían sólo la primera página de 30, así que en un hilo largo se veían los 30 más antiguos y los recientes — los que importan — quedaban detrás de "Ver más mensajes"… cuyo botón estaba *arriba* de la lista aunque cargaba mensajes *abajo*.
2. **El expediente del portal es una página larga** (etapas, alcance, propuesta, archivos, conversación, historial) sin forma rápida de saltar entre secciones, sobre todo en móvil; recargar perdía el expediente abierto si había más de uno.
3. **Cerrar sesión en el portal mostraba "Necesitas un enlace de acceso válido"**, como si algo hubiera fallado.
4. **Solicitar acceso / recuperar contraseña:** tras enviar, el formulario seguía activo con un párrafo largo debajo (fácil reenviar sin querer, sin confirmar a qué correo se envió ni qué hacer si no llega); un correo mal escrito se enviaba al servidor y regresaba un error genérico.
5. **Nueva contraseña:** las reglas (12+ caracteres, letras y números) sólo se descubrían al fallar el envío; no había forma de ver lo escrito.
6. **Login interno:** Bloq Mayús activado era invisible; en el paso del código MFA, correo y contraseña quedan bloqueados y no había forma de volver si la cuenta era la equivocada (había que recargar).

## Cambios

### Conversación (portal y staff)
- `loadThroughLatest` (`src/lib/load-latest-messages.ts`, con pruebas) sigue el cursor hasta el mensaje más reciente (páginas de 100, tope de 10) para que el hilo abra siempre en su estado actual; si aún quedara historia, "Cargar mensajes más recientes" aparece **al final** de la lista, donde llegan.
- Fechas relativas ("Hace 2 h", fecha exacta en `title`) y, en el portal, **Ctrl/⌘ + Enter para enviar** (indicado junto al contador).

### Portal
- **Atajos de sección** bajo "Tu siguiente paso": Propuesta · Archivos · Conversación · Historial (llevan a la sección, la resaltan y, en la conversación, enfocan el campo para escribir).
- El expediente abierto vive en `?request=`.
- Cerrar sesión confirma "Cerraste tu sesión. Para volver, solicita un nuevo enlace de acceso con tu correo."

### Accesos
- **Solicitar acceso / recuperación:** validación del correo antes de enviar; al enviarse, la pantalla pasa a **"Revisa tu correo"** con el resultado en una sola región de estado (misma respuesta exista o no la cuenta), el correo al que se solicitó, consejos (un solo uso, revisar spam), **"Reenviar enlace"** con espera de 60 s y **"Usar otro correo"**.
- **Nueva contraseña:** requisitos en vivo que reflejan exactamente `passwordSchema` del servidor (12–128 caracteres, una letra, un número) más "Ambas coinciden", y "Mostrar claves".
- **Enlace de cliente:** el botón "Entrar a mi portal" recibe el foco (Enter basta).
- **Login interno:** aviso de Bloq Mayús mientras se escribe la contraseña (sin alterar el orden de tabulación) y **"Usar otra cuenta"** en el paso del código MFA.

## Fuera de alcance
- Detectar una sesión ya abierta en `/portal/access`: la consulta de sesión responde 401 sin sesión y dejaría un error en consola en cada visita; se dejó para una solución del lado del servidor.

## Verificación
- `tsc`, lint completo y pruebas unitarias (nueva `load-latest-messages`).
- Navegador real: correo inválido rechazado antes de enviar; "Revisa tu correo" con reenvío en espera y "Usar otro correo" (regresa al formulario con el foco en el correo); requisitos de contraseña parciales y completos, "Mostrar claves"; portal con atajos de sección, expediente en la URL y foco en la conversación.
- Suite E2E opt-in completa contra build de producción: 60/61 (la única falla sigue siendo la preexistente de `quality.spec.ts` por los assets de la landing); `request-workspace-v2.spec.ts` con banderas 5/5 y el harness del shell privado 2/2. Las pruebas de acceso y portal conservan sus contratos (una sola región de estado con los mismos textos, "Acceso privado." tras cerrar sesión, etiquetas de campos sin cambios).
