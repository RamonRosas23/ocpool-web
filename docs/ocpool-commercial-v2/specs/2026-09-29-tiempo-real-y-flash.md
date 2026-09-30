# Tiempo real y aviso flash (bloque 2 de notificaciones en tiempo real)

Fecha: 2026-09-29 / 30 · Rama: `feat/notificaciones-tiempo-real` · Diseño completo: [spec](../../superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md) · Plan: [bloque 2](../../superpowers/plans/2026-09-29-tiempo-real-y-flash-bloque-2.md) · Bloque anterior: [bandeja de avisos](2026-09-29-bandeja-de-avisos.md)

## Problema

Con el bloque 1 cada persona ya tenía su bandeja, pero se enteraba tarde: la campana consultaba al navegar, al volver a
la pestaña y cada 30 s. El responsable de producto pidió que la operación se sintiera "en tiempo real" y con alertas
que destaquen: el cliente escribió, subió un archivo, pidió cambios, un correo no se entregó.

## Decisión

- **Canal SSE `GET /api/realtime`.** Cada proceso de Next abre una conexión propia `LISTEN ocpool_realtime` a
  PostgreSQL (fuera del pool de Prisma) y reparte las señales que el bloque 1 ya emitía dentro de cada transacción:
  `n` (aviso nuevo, agrupado o resuelto) y `u` (lecturas). Se agrega `s`: cerrar el canal de una sesión, de todas
  menos la actual o de todas.
- **El canal lleva sólo identificadores.** El hub relee cada aviso con el alcance vigente de la persona, una vez por
  persona, y manda el aviso con sus contadores y los sin leer de su expediente.
- **Una conexión por navegador.** La pestaña que obtiene un Web Lock abre el `EventSource` y reparte cada evento a las
  demás por `BroadcastChannel`. Si se cierra, otra toma el candado. Sin Web Locks, `BroadcastChannel` o `EventSource`
  no se abre ninguna conexión y todo sigue con la consulta cada 30 s: con HTTP/1.1, una conexión por pestaña
  agotaría las ~6 que el navegador permite por dominio.
- **Respaldo automático.** Tres errores seguidos, 60 s sin ningún evento (el servidor manda `ping` cada 25 s) o un
  rechazo del servidor pasan a consulta cada 30 s; cada 5 min se reintenta el canal.
- **Interruptor sin desplegar:** `REALTIME_ENABLED=false` y reinicio. La ruta responde `503 { mode: 'polling' }`.
- **Reanudación.** Cada aviso lleva `id: <updatedAt ms>-<id>`. Si la conexión se corta, el navegador reconecta con
  `Last-Event-ID` y recibe lo que cambió mientras tanto (50 por vez; si hay más, pide releer).
- **Sesiones.** La conexión revalida la sesión cada 60 s (y toma cambios de rol) y se cierra al momento cuando alguien
  cierra sesión, cambia su contraseña, cierra otras sesiones, activa MFA, recupera la contraseña o es suspendido. El
  navegador vuelve a la pantalla de acceso (`/login` o `/portal/access`). Un error pasajero al revalidar no saca a nadie.

## Qué ve cada persona

| Quién | Qué cambia |
| --- | --- |
| **Equipo** (Ventas, Gerencia, Administración) | La campana, el "(N)" del título y la página de Notificaciones se actualizan al instante en todas las pestañas. Los avisos altos y urgentes aparecen como **flash** arriba a la derecha con su acción rápida (Tomar, Responder, Decidir), con un tono corto que se puede apagar. |
| **Cliente** | "Novedades" y el "(N)" del título al instante; el flash cuando el equipo le escribe o comparte archivos. El sonido empieza apagado. |

- **Flash (spec §5.3):** sólo URGENT (fijo hasta cerrarlo, `role="alert"`, borde rojo) y HIGH (8 s con barra de
  progreso, se pausa con el puntero encima o el foco dentro, `role="status"`). Esc lo cierra. Nunca roba el foco.
  Cerrar un flash no marca el aviso como leído: sigue en la campana.
- **Agrupación:** un aviso agrupado ("te escribió 2 mensajes") reemplaza su tarjeta, vuelve a destellar y reinicia su
  tiempo. Lo atendido desaparece solo ("Tomada por Ana"), y leer desde la campana quita su flash.
- **Cupo:** 3 en escritorio y 2 en teléfono; el resto es "y N más", que abre el panel. Lo urgente va primero y una
  ráfaga de avisos altos nunca lo esconde.
- **Pie del panel:** "Sonido" (encendido por defecto para el equipo, apagado para clientes) y "Activar alertas de
  escritorio" (el permiso se pide en ese clic). Si el navegador las bloqueó, el pie lo dice. Las preferencias viven
  en el navegador hasta el bloque 5 y se sincronizan entre pestañas.
- **Escritorio:** lo muestra sólo la pestaña con la conexión, cuando ninguna pestaña está a la vista; texto plano y
  `tag` por aviso (un aviso agrupado reemplaza al anterior). Al hacer clic abre el expediente.
- **Encabezado V2:** la sesión del equipo ahora envuelve también al shell, así que su campana ofrece "Tomar".

## Desviaciones del plan

- **Sin supresión en el expediente abierto todavía.** La spec pide no destellar la actividad del expediente que ya
  está abierto porque esa vista se actualiza sola, y eso llega con el bloque 3. Mientras tanto el flash sí aparece
  para que el mensaje no se pierda (abrir el expediente lo marca como leído, pero la conversación todavía no se
  recarga sola).
- **Sin Web Locks no hay conexión por pestaña** (el plan decía que cada pestaña abriría la suya): se queda en consulta.
- **El latido es un evento `ping`**, no un comentario SSE (`: ping`, spec §4.3): el navegador no ve los comentarios, y
  necesita el latido para medir los 60 s de silencio.
- **La señal `s` admite `keep`** (cerrar todas las sesiones menos la actual), además de `sid`: cambiar la contraseña o
  cerrar las otras sesiones no debe sacar a quien lo hizo.
- **El hub atiende en orden las señales de cada persona** (un contador viejo nunca pisa uno nuevo) y cierra sesiones
  sin esperar a nadie. La conexión se registra antes del `hello` para no perder lo que pase mientras tanto.
- **Un resumen pedido antes de un evento en vivo se descarta** y se pide otro: si no, podía llegar después y borrar el
  aviso recién recibido.

## Hallazgos durante el QA

- **Lo urgente quedaba escondido** en "y 2 más" cuando llegaban avisos altos después (en teléfono sólo caben 2). Ahora
  lo urgente va primero, y al pasar del tope de 20 tarjetas se descartan primero los avisos altos más viejos.
- **Permiso de escritorio bloqueado:** el pie no mostraba nada y no se entendía por qué faltaba la opción; ahora dice
  "Escritorio bloqueado en el navegador".
- **La página de acceso del portal pedía avisos sin sesión** y dejaba un 401 en la consola en cada visita (venía del
  bloque 1). Ya no pregunta.
- **Pestaña oculta:** si nadie mira la pestaña, el flash no aparece (por diseño); el contador y el título sí cambian.
- **Salir del portal** (lo detectó la E2E completa): la pestaña mostraba "Cerraste tu sesión", pero el canal recibía
  el cierre de esa misma sesión y la llevaba a la pantalla de acceso. Ahora la pestaña que cierra su propia sesión se
  queda (`announceSignOut`) y las demás pestañas del navegador sí vuelven a entrar. Las salidas del equipo ya iban a
  `/login` por su cuenta.
- **"stack" en el HTML:** una prueba del portal revisa que la página no filtre rastros internos buscando `stack`,
  `prisma` o `tokenHash`; la clase `inbox-flash-stack` la hacía fallar. La pila de flashes ahora es `inbox-flashes`.
- **E2E:** la segunda pestaña empieza a escuchar cuando termina de cargar su resumen; la prueba ahora espera a que su
  petición del candado quede en cola. El flash entra deslizándose, así que el ancho se mide sobre la pila.
- Fuera de alcance: `tests/unit/quote-pdf-renderer.test.ts` ("paginates the complete scope") tarda 5–9 s en este
  equipo y excede el límite de 5 s de vitest; pasa con más tiempo. Se propuso como tarea aparte.

## Verificación

- `npx tsc --noEmit` y `npm run lint`: sin errores.
- `npx vitest run tests/unit`: 73 archivos, 435 pruebas en verde (antes 398). Nuevas: `realtime-protocol`,
  `realtime-hub`, `realtime-listener`, `realtime-stream`, `realtime-client` e `inbox-flash`.
- `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1`: 63 archivos, 202 pruebas en verde (antes 192).
  Nuevas: `realtime-session-signals` (cada revocación publica `s`; sin la implementación, las 3 fallan por tiempo),
  `inbox-realtime-queries` y `realtime-api` (401, 503 del interruptor, encabezados, `hello`, aviso al confirmar,
  contadores tras leer, reanudación con `Last-Event-ID` y `bye` al revocar).
- E2E completa en producción con los flags de siempre más `INBOX_E2E=1 REALTIME_E2E=1`: 78 pasan, 7 omitidas y 1
  falla, la línea base aceptada (`quality.spec.ts`, sólo los 400 de las imágenes de la landing). Las 4 de
  `tests/realtime-notifications.spec.ts` pasan: flash y contador en menos de 5 s sin recargar (con axe), dos pestañas
  con una sola conexión y la lectura sincronizada, 390 px sin desborde, y una sesión revocada sale al momento a
  `/login`. La primera corrida encontró los dos errores del portal descritos arriba; tras corregirlos, la segunda
  quedó en la línea base.
- Recorrido en navegador (servidor de QA en :3010, escenario aislado que se borró al terminar): flash en ~0.2 s tras
  el commit, agrupado y con su acción; URGENT fijo y HIGH de 8 s; Esc; "y N más" abre el panel; sonido que se guarda;
  dos pestañas con una sola conexión, relevo al cerrar la líder y lectura que limpia ambas; 390 px; portal con flash
  del equipo y salida inmediata al revocar la sesión.
- **Restos en la base compartida:** 0 avisos, usuarios o contactos de prueba de este bloque. Siguen 59 contactos `qa-`
  con solicitudes de corridas anteriores al 2026-09-29 (no los creó este bloque).

## Qué sigue

Según la spec §14:

- **Bloque 3:** pantallas que se actualizan solas (hilos, archivos, detalle, bandeja, colas, cotizador y portal),
  "Visto por el cliente" y la supresión del flash en el expediente abierto.
- **Bloque 4:** declinar la propuesta con motivo, "abrió la propuesta" y "entró a su portal".
- **Bloque 5:** correo inteligente, recordatorios y preferencias en el servidor.
