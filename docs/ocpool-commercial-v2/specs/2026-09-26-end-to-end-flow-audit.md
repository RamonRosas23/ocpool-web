# Auditoría de flujos de punta a punta (protocolo de piloto)

**Fecha:** 2026-09-26
**Rama:** `catalog-ux-redesign`
**Contexto:** "haz análisis de la calidad de los distintos flujos, desde el comienzo, los diferentes casos de uso, los éxitos, errores, facilidad de uso… que el usuario diga wow, esto casi se hace solo". Se recorrieron en navegador real las tareas del protocolo de usabilidad del piloto (`docs/runbooks/pilot-usability-protocol.md`) con un escenario QA aislado (ventas A/B, gerencia, admin con MFA y tres clientes con enlace mágico), en escritorio y móvil. Cada hallazgo se corrigió en la raíz; no cambian reglas de negocio ni permisos.

## Hallazgos y correcciones

### Dashboard ("¿qué atiendo primero?")
- **El periodo excluía el día de "Hasta":** el rango decía "— 26 sep" pero `to` era exclusivo, así que hoy nunca contaba y ventas veía "0 solicitudes recibidas" en pleno día. `from`/`to` ahora son días calendario inclusivos (`dashboardRangeUpperBound`, mismo criterio que Auditoría); el predeterminado son 30 días incluyendo hoy y las vistas rápidas 7/30/90 cuentan el día final. Runbook actualizado.
- **"Sin asignar 0 · Sin pendientes" para ventas** (el alcance propio lo fija en 0) mientras la cola decía 123: el cuarto KPI ahora es **"Vendido"/"Vendiste"** (importe aceptado del periodo, corto con BigInt y exacto debajo). El total vigente sin responsable vive en la cola "Sin asignar".
- **"Cliente respondió" contaba mensajes del propio equipo:** tomaba el último mensaje *visible para el cliente*, no el último *del* cliente; una solicitud de información de ventas aparecía como "cliente respondió" para gerencia. Corregido en la consulta.
- Tarjetas de "Qué atender ahora" con alto igual por fila, pie consistente ("Abrir en Solicitudes →") y la última suelta a todo el ancho. "Fallos de aviso" dice folio y cliente y lleva al expediente.
- "Carga por responsable" se oculta en el alcance propio (era una sola fila propia con "Muestra protegida"); "Tasa de aceptación" sin envíos explica "Aparece al enviar cotizaciones"; se retiró el importe aceptado duplicado del panel de origen.

### Solicitudes
- **"Solicitar información" redacta el mensaje:** antes era un campo de una línea vacío aunque "Faltan: medidas, fecha de inicio, presupuesto" ya estaba calculado. Ahora propone un borrador con lo que falta, área de texto amplia, destinatario visible y "Enviar y esperar respuesta" (registra `missingFields`).
- **Siguiente paso honesto mientras se espera al cliente:** antes sugería "Marcar en revisión" justo después de pedir los datos. Ahora: "Esperando la respuesta del cliente" (con "Ver conversación"); si el cliente respondió, "Revisar y continuar" (acción dedicada que valida la respuesta); si el equipo ya capturó lo que faltaba, "Continuar con la revisión".
- **"Editar datos" en la vista clásica** (antes sólo existía en V2): contacto y proyecto con el mismo PATCH y reglas de motivo del servidor. Se abre desde el encabezado, desde "Faltan: …" ("¿Ya los tienes? Captúralos", con el foco en el campo que falta) y desde la espera ("¿Te respondió por otro medio?"). Cambiar correo o teléfono advierte que se cancelan los avisos pendientes al dato anterior. Resuelve la tarea de admin "corrige el correo de este contacto".
- Los selectores distinguen "Sin dato" (vacío) del valor del dominio "Por definir".

### Cotizaciones y aprobaciones
- **El "Siguiente paso" ejecuta la acción de un clic** (Pasar a revisión, Solicitar aprobación, Revisar y enviar, Crear nueva versión); las decisiones siguen llevando a la barra de acciones resaltada.
- **Pedir aprobación con contexto:** un resumen (descuento más alto, descuento total, total) y "Motivo para gerencia"; la cola de aprobaciones lo muestra como "Motivo de ventas". En conceptos especiales se propone el motivo que ventas ya escribió en la línea.
- **El rechazo de gerencia llega a ventas:** su motivo aparece en el siguiente paso ("Gerencia rechazó la aprobación: «…»"), en el avance ("Rechazada por gerencia") y en la barra de acciones.
- **La petición de cambios del cliente llega al constructor:** "El cliente pidió cambios: «…»" con "Crear nueva versión" (antes decía "Esperando al cliente").
- Los avisos al pasar a revisión o enviar dicen qué pasó y qué sigue ("Cotización enviada: Cliente X recibirá un aviso para revisarla") en lugar de "Cotización movida a enviada".

### Catálogo
- **El concepto recién creado quedaba fuera de vista:** tras crearlo se recargaba la página actual de la lista y, con más de 25 conceptos, el nuevo quedaba en otra página y el detalle en "Selecciona un concepto". Ahora queda al frente de la lista y seleccionado (lo detectó la E2E de catálogo con los datos del escenario QA).

### Notificaciones y correos
- Cada entrega muestra **a qué expediente pertenece** (folio y cliente, respetando el alcance de ventas; en avisos de acceso, el cliente sólo para gerencia/admin) con "Abrir expediente para avisar al cliente". Resuelve "un cliente no recibió un correo, encuentra qué pasó".
- "Reintentar entrega" se oculta a quien no puede reintentar (ventas recibía un 403) → "Gerencia puede reintentarla". Los enlaces del dashboard abren la operación ya filtrada en "Fallidas".
- Los correos al equipo abrían la lista de solicitudes; ahora el expediente exacto (`?request=`).
- Textos: sin jerga ("snapshot", "fuente de verdad") frente al cliente; asuntos más claros ("Tu cotización OCQ-… está disponible", "Te asignaron la solicitud…", "Aprobación de descuento pendiente: …"); la respuesta de un cliente al responsable tiene su propio texto ("Ana respondió en OCQ-…"); todas las versiones de texto llevan el enlace; enlace de respaldo bajo el botón; pie distinto para clientes y equipo; paleta actual de la marca.

### Auditoría
- Categoría **"Inicios de sesión"** (accesos exitosos y fallidos, sin el ruido de solicitudes de enlace y sesiones) y el **rol junto a cada persona**: responde "¿quién entró como administrador esta semana?".
- En identidad, un evento sin usuario ya no se atribuye a "Sistema": "Cuenta no identificada" (correo que no corresponde) o "Cuenta retirada"; los clientes se ven como "Cliente". "Visibilidad: CUSTOMER" ahora dice "Visible para el cliente".

### Portal del cliente
- **La vista previa del PDF antes de aceptar nunca se mostraba:** reutilizaba la URL de descarga (`attachment`) y el navegador descargaba el archivo dejando el recuadro vacío. Ahora la vista previa pide `disposition=inline` (sólo para el PDF que genera OCPOOL; los archivos subidos siempre se descargan). En pantallas táctiles, donde muchos navegadores no muestran PDF en un iframe, se ofrece "Abrir PDF" en el visor del teléfono (la pestaña se abre dentro del gesto, como exige Safari).
- "Descargar PDF" (portal y equipo) guarda el archivo sin abrir una pestaña en blanco ni depender de ventanas emergentes.
- Tras "Solicitar cambios", el siguiente paso dice "Pediste cambios a tu propuesta" (antes seguía "Tu propuesta está lista"); tras aceptar, la tarjeta del riel se sincroniza con el detalle.
- Los nombres de concepto se leen completos en móvil y el descuento en cero ya no aparece. El enlace mágico dice "Un paso más y estarás dentro…" en lugar de "Estamos validando…".

### Transversal
- La trampa de foco de los diálogos incluye `textarea` y `select` (con formularios largos el Tab podía salir del modal).
- `pilot:clean` también retira lo que generan las sesiones: avisos de conversaciones, archivos y documentos (antes quedaban entregas pendientes de conversaciones ya borradas), los objetos de archivos subidos y la auditoría de las cuentas del piloto.

## Observaciones sin cambio
- Ventas no tiene `quotes.apply_discount`: sólo gerencia puede capturar descuentos, así que "pedir aprobación de descuento" sólo ocurre sobre descuentos que gerencia capturó (en el escenario QA venían sembrados). Es una decisión de permisos, no de interfaz.
- La base de desarrollo conserva residuos de pruebas (p. ej. una entrega "En proceso" fechada en 2030); dos pruebas de integración que asumían una base vacía (entregas FAILED y carga global) ahora validan su propio dato o el invariante de privacidad.

## Verificación
- `tsc`, lint del proyecto (incluido `src/server`) y 305 pruebas unitarias (nuevas: contrato del periodo del dashboard, etapas de cotización y portal, petición de cambios, correos).
- Integración (`RUN_DB_TESTS=1`) de analytics, auditoría (nueva: "Inicios de sesión" con rol), notificaciones, solicitudes (nueva: espera y respuesta del cliente en el detalle), cotizaciones, portal, almacenamiento (`inline`) y PDF.
- Navegador real con el escenario QA: tareas del protocolo para ventas, gerencia, admin y clientes (escritorio y 390 px, con emulación táctil para la vista previa del PDF). El escenario se retiró por completo al terminar.
- Suite E2E opt-in contra build de producción: 60/61 (la única falla sigue siendo la preexistente de `quality.spec.ts` por las imágenes de la landing); `request-workspace-v2.spec.ts` 5/5 y el harness del shell privado 2/2.
