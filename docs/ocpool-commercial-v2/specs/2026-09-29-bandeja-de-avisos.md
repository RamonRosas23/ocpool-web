# Bandeja de avisos por rol (bloque 1 de notificaciones en tiempo real)

Fecha: 2026-09-29 · Rama: `feat/notificaciones-tiempo-real` · Diseño completo: [spec](../../superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md) · Plan: [bloque 1](../../superpowers/plans/2026-09-29-bandeja-de-avisos-bloque-1.md)

## Problema

"Notificaciones" era el monitor técnico de la cola de correo: plantillas, estados de entrega y reintentos. Para
Ventas era ruido y para Gerencia sólo servía cuando un correo fallaba. Dentro de la aplicación nadie se enteraba de
lo que pasaba en la operación ("el cliente subió un archivo y dejó un mensaje", "pidió cambios a la propuesta"),
el cliente no tenía novedades en su portal, y el correo tenía huecos: la solicitud nueva del sitio no le llegaba a
Gerencia, la respuesta de un cliente sin responsable se perdía, y quien tomaba una solicitud se mandaba correo a sí
mismo.

## Decisión

Cada persona tiene una **bandeja de avisos** (`inbox_notifications`) que se llena **en la misma transacción** del
cambio que la provoca. Un emisor único, `recordDomainEvent`, escribe el outbox de siempre (el correo) y aplica
reglas por evento que deciden quién se entera, con qué prioridad y en qué idioma. Las reglas corren dentro de un
`SAVEPOINT`: si alguna falla, se deshace sólo su parte y el cambio de negocio se confirma igual.

- **Nunca se avisa a quien hizo la acción.** El cliente jamás recibe contenido interno.
- **Se agrupa lo que se repite:** dos mensajes y un archivo del mismo cliente son un solo aviso ("Laura subió un
  archivo y dejó 2 mensajes"). Un índice único parcial serializa la agrupación entre transacciones concurrentes.
- **Lo que pide una acción se cierra solo** cuando alguien la atiende: "Tomada por Ana", "La aprobaste",
  "Ya no aplica: la cotización cambió", "Le asignaste precio", "Respondiste".
- **Alcance vigente:** el equipo sólo ve los avisos de expedientes que todavía puede abrir.
- Cada aviso emite `pg_notify('ocpool_realtime', …)` con sólo identificadores. Nadie lo escucha todavía: el
  bloque 2 conecta el canal en vivo. Mientras tanto la campana consulta al navegar, al volver a la pestaña y cada 30 s.

## Qué cambia para cada rol

| Rol | Qué ve |
| --- | --- |
| **Ventas** | Campana con contador y "(N)" en el título de la pestaña. Solicitud nueva del sitio sin responsable, con **Tomar**; te asignaron o te quitaron un expediente; el cliente escribió o subió archivos (agrupado); **pidió cambios** (urgente); tu aprobación se resolvió; te devolvieron la propuesta con su motivo; ya hay precio para tu concepto «por cotizar»; notas internas; proyecto asignado; trabajo heredado de alguien suspendido; **un correo a tu cliente no se entregó** (urgente); alguien más cerró o reabrió tu expediente. Ya no ve el monitor técnico de correos. |
| **Gerencia** | Lo mismo para sus expedientes, más las solicitudes nuevas del sitio (y quién las tomó), aprobaciones por decidir, cambios pedidos y aceptaciones de cualquier expediente, proyectos creados, precios por asignar y correos no entregados. Conserva el monitor técnico, ahora **Entregas de correo**. |
| **Administración** | Todo lo de Gerencia (tiene todos los permisos). |
| **Cliente** | **Novedades** en el portal: el equipo te escribió o compartió archivos, necesitamos unos datos (se cierra al responder), tu propuesta está lista, tu proyecto arrancó y recibimos tu solicitud. "N nuevas" por expediente y el aviso **Desde tu última visita** al abrirlo. |

- **Campana y panel:** agrupados por día (Hoy, Ayer, Esta semana, Antes), filtros "Todas", "Sin leer" y
  "Requieren acción · N", acciones rápidas (**Tomar**, **Decidir**, **Responder**) y "Marcar todo como leído". En
  teléfono el panel es una hoja anclada justo debajo de la campana.
- **`/staff/notifications`** es la bandeja completa: tipo de aviso, búsqueda por folio, cliente o texto, marcar como
  leída o no leída, las mismas acciones rápidas y paginación por cursor. Sale de la barra de navegación (la campana
  la reemplaza) y se encuentra con Ctrl + K.
- **Abrir un expediente da por vista su actividad.** Lo que pide una acción (tomar, aprobar, responder cambios)
  sigue pendiente hasta atenderse.
- **`/staff/notifications/deliveries` ("Entregas de correo")**: la pantalla anterior, sólo para quien tiene
  `notifications.read` (Gerencia y Administración). Abre en "Fallidas" y "Todas" deja fuera las canceladas por el
  sistema. Ventas pierde `notifications.read` (migración `20260929030000_sales_without_delivery_monitor`); el
  dashboard deja de pedirle entregas fallidas.

## Correo

- Gerencia recibe la **solicitud nueva del sitio** (`request.new_for_team`) con cliente y proyecto.
- **Sin autoenvíos:** quien toma una solicitud ya no recibe "te asignaron", y el cliente no recibe correo por el
  archivo que él mismo subió. Ambos quedan como cancelados con el motivo nuevo `SELF_ACTION` (migración
  `20260929020000_notification_cancel_reason_self_action`).
- La respuesta de un cliente **sin responsable** llega a Gerencia; antes se cancelaba sin destinatario.
- Una **petición de cambios** usa su propia plantilla (`quote.changes_requested`) y abre la pestaña de la propuesta.
- La **aceptación** también llega a Gerencia.
- Un correo a cliente que queda fallido avisa en la bandeja: urgente al responsable y normal a Gerencia. El aviso
  se cierra solo en cuanto un reintento se entrega.

## Hallazgos durante el QA

- **La campana se caía** ("items is not iterable") cuando una consulta se cancelaba a media lectura del cuerpo: el
  cliente convertía ese error en un resumen vacío. Ahora una respuesta correcta se lee completa o falla, con prueba de
  regresión.
- **El contador volvía a su valor viejo** tras "marcar como leída" si un resumen pedido antes llegaba después. Un
  contador de escrituras descarta esos resúmenes y, con dos escrituras seguidas, sólo cuenta la última.
- **Choque de clases:** `.staff-inbox` ya era la columna de la lista de solicitudes; la página usa `.notices-page`.
- **En teléfono el panel tapaba la campana del portal** (su encabezado ocupa dos renglones): ahora se ancla debajo.
- La fila repetía folio y cliente cuando el título o el cuerpo ya los decían.
- **Avisos de prueba en bandejas reales:** "precio por asignar" agrupa expedientes y no lleva `quoteRequestId`, así
  que no caía en cascada al borrar la solicitud de una prueba y quedaba en la bandeja del equipo real de la base
  compartida. Las pruebas que lo producen ya lo limpian; se retiraron 40 filas sobrantes.
- La vista de la página seguía la spec §5.2 sólo en parte en el plan (sin tipo, búsqueda ni leer/no leer); se
  completó.

## Verificación

- `npx tsc --noEmit` y `npm run lint`: sin errores.
- `npx vitest run tests/unit`: 67 archivos, 398 pruebas en verde.
- `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1`: 60 archivos, 192 pruebas en verde (antes 152).
  Incluye las 9 suites nuevas: `inbox-schema`, `inbox-record`, `inbox-requests`, `inbox-messages`, `inbox-quotes`,
  `inbox-projects-team-prices`, `inbox-api`, `notifications-routing` y `notifications-delivery-inbox`.
- E2E completa en producción con los flags de siempre más `INBOX_E2E=1`: 74 pasan, 7 omitidas y 1 falla, la línea
  base aceptada (`quality.spec.ts` "does not emit browser console errors", imágenes de la landing con 400). Las 5 de
  `tests/inbox.spec.ts` pasan: tomar desde la campana, "Tomada por …" y Entregas de correo por rol, dos mensajes en un
  solo aviso que se lee al abrir el expediente, "Desde tu última visita" en el portal y 390 px sin desborde.
- Recorrido en navegador (servidor de QA en :3010, escenario aislado que se borró al terminar): campana, filtros,
  Tomar, Esc y clic afuera, teclado, 390 px en equipo y portal, página completa con tipo y búsqueda, leer y no leer, y
  Entregas de correo restringida para Ventas.
- **Restos en la base compartida:** 0 avisos, usuarios, contactos o roles de prueba. `quality.spec.ts` enviaba
  solicitudes por el formulario público y nunca las borraba (124 acumuladas desde el 2026-09-08). Antes eran inertes;
  ahora cada una avisaría a todo el equipo, así que la prueba ya borra las suyas al terminar (verificado: 0 restos
  tras correrla).

## Qué sigue

Según la spec §14:

- **Bloque 2:** canal en vivo (SSE), aviso flash, sonido y alertas de escritorio.
- **Bloque 3:** pantallas que se actualizan solas y "Visto".
- **Bloque 4:** declinar la propuesta con motivo, "abrió la propuesta" y "entró a su portal".
- **Bloque 5:** correo inteligente (sólo si no se leyó en la aplicación, agrupado), recordatorios y preferencias.
