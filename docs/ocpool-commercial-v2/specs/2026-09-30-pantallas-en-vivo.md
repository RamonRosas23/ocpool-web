# Pantallas en vivo y “Visto por el cliente” — bloque 3

Fecha: 2026-09-30
Plan: [bloque 3](../../superpowers/plans/2026-09-30-pantallas-en-vivo-bloque-3.md)
Diseño rector: [avisos de operación y tiempo real](../../superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md)

## Problema

Los avisos en tiempo real ya actualizaban la campana y el flash, pero las pantallas de expedientes todavía podían mostrar mensajes, archivos, estados y cotizaciones viejos hasta una recarga o consulta posterior. El equipo tampoco tenía confirmación de que el cliente hubiera leído su respuesta.

## Decisión y protocolo

Cada cambio publica, dentro de la transacción que lo guarda, una señal compacta en PostgreSQL `ocpool_realtime`. El hub recibe la señal y la distribuye por SSE; `RealtimeProvider` mantiene una conexión por navegador y reparte el evento entre pestañas con Web Locks y BroadcastChannel. La señal sólo lleva identificadores y clasificación; el navegador relee datos mediante las API existentes, que vuelven a comprobar los permisos.

La señal `r` identifica el expediente (`r`), cliente (`c`), responsable actual (`a`), responsable anterior opcional (`pa`), actor (`b`), partes (`p`) y visibilidad (`v`: `C` para contenido visible al cliente, `I` para uso interno). El servidor evalúa el alcance antes de distribuirla:

- Personal con permiso global de solicitudes recibe las señales de expedientes.
- El resto del personal las recibe si el expediente no está asignado o si es el responsable actual o anterior.
- El cliente sólo recibe señales de su propio `clientId` cuando `v` es `C`.
- El hub convierte `b` en `self` por conexión. El navegador puede omitir una relectura redundante por la acción propia; el identificador del actor no se envía en el evento SSE.
- Una señal nunca contiene mensajes, nombres, archivos ni otros datos del expediente.

La tabla de reglas es exhaustiva y está cubierta por una prueba de contrato. Los cambios de lectura se publican directamente con `read` y visibilidad interna.

| Evento | Partes | Visibilidad |
|---|---|---|
| `REQUEST.RECEIVED` | `created` | `C` |
| `REQUEST.ASSIGNED` | `assignment` | `I` |
| `REQUEST.STATUS_CHANGED` / `REQUEST.CUSTOMER_RESPONSE` | `status` | `C` / `I` respectivamente |
| `MESSAGE.CREATED` | `messages` | Según la visibilidad del mensaje |
| `CONVERSATION.STATUS_CHANGED` | `messages` | `C` |
| `FILE.AVAILABLE` / `FILE.DELETED` | `files` | Según la visibilidad del archivo |
| `QUOTE.VERSION_CREATED`, `QUOTE.VERSION_UPDATED`, `QUOTE.VERSION_SUBMITTED`, `QUOTE.VERSION_REOPENED`, `QUOTE.VERSION_STATUS_CHANGED` | `quote` | `I` |
| `QUOTE.VERSION_REJECTED` | `quote` | `C` si la versión ya se había enviado; en otro caso `I` |
| `QUOTE.PUBLISHED` | `quote` | `C` |
| `QUOTE.PDF_READY` | `quote` | `I` |
| `QUOTE.APPROVAL_REQUESTED` | `approvals` | `I` |
| `QUOTE.APPROVAL_RESOLVED` | `approvals`, `quote` | `I` |
| `QUOTE.ACCEPTED` | `quote`, `status` | `C` |
| `PROJECT.CREATED` | `project` | `C` |

Los demás eventos de proyecto, catálogo, precios o logística que no actualizan una pantalla del expediente no generan una señal `r` en este bloque.

## Comportamiento de las pantallas

| Pantalla | Partes observadas | Actualización |
|---|---|---|
| Conversación del equipo y del portal | `messages`, `read` | Trae lo posterior al último cursor y lo agrega sin duplicar. Marca “Nuevo”; si el lector no está al final, muestra una píldora para bajar a los mensajes nuevos. |
| Archivos del expediente | `files` | Relee la lista en silencio y conserva lo que ya muestra si la consulta falla. |
| Detalle clásico, V2 y portal | estado, asignación, cotización, proyecto | Relee en silencio, con aviso discreto de actualización; conserva datos actuales mientras carga y vuelve a intentar si había otra carga en curso. |
| Bandeja de solicitudes | alta, estado, asignación | Actualiza de inmediato cuando la lista está arriba y sin interacción; en otro caso ofrece “Hay N novedades · Actualizar”. |
| Dashboard y aprobaciones | partes pertinentes a sus colas | Agrupa cambios y espera dos segundos antes de volver a leer. |
| Constructor de cotizaciones | `quote`, `approvals` | Relee silenciosamente si no hay trabajo local. Si hay cambios, formularios, diálogos o guardados en curso, los protege y muestra el aviso de cambios nuevos. |

Cuando el cliente abre la conversación, `listConversationMessages` registra de forma monótona hasta qué mensaje leyó y emite `read` interno. El equipo recibe `customerReadAt` y ve “Visto · hace …” bajo su mensaje más reciente. Leer páginas antiguas no retrocede el cursor.

Si llega actividad normal del cliente o del equipo para el expediente abierto, no aparece un flash duplicado: el hilo muestra los mensajes nuevos y el aviso de actividad se marca leído. Los avisos urgentes del expediente sí conservan el flash. Si SSE no está disponible, sigue funcionando la consulta de respaldo cada 30 segundos y las vistas se ponen al día al volver el foco.

## Hallazgos y decisiones de ejecución

- La prueba de dos pestañas debía esperar a que la pestaña secundaria obtuviera el bloqueo compartido antes de observar el flash; sin esa espera terminaba antes de que la suscripción estuviera lista.
- Un aviso flash vacío no renderiza una región visible. La prueba comprueba que no exista ningún estado de aviso, en vez de exigir que aparezca una región vacía.
- “Marcar todo como leído” aparecía en más de un lugar; la prueba limita el clic al panel de notificaciones.
- La espera de lectura se estabilizó calentando la ruta de lectura antes del escenario. La prueba de ancho móvil mide el contenedor estable, no la tarjeta durante su animación de entrada.
- Una corrida de carga de archivos devolvió 403 porque el servidor de prueba no tenía `APP_URL` apuntando a su propio origen. Se corrigió la configuración del ejecutor y la prueba pasó; no era un defecto de autorización del producto.
- Para respetar el servidor de desarrollo existente en `:3000`, las pruebas aisladas usaron `:3010` y `.next-qa`. La configuración local de `.claude/launch.json` se conservó.
- La suite E2E completa conserva un fallo de línea base en `tests/quality.spec.ts:623`: recursos de imágenes de proyectos inexistentes o inválidos responden 400 y generan errores de consola. No corresponde a tiempo real; la línea base aceptada ya está registrada en `PROJECT_STATUS.md` bajo el bloque 2.

## Verificación

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | Correcto |
| `npm run lint` | Correcto |
| `npx vitest run tests/unit` | 76 archivos, 446 pruebas correctas |
| `RUN_DB_TESTS=1 npx vitest run tests/integration --maxWorkers=1` | 65 archivos, 209 pruebas correctas |
| `REALTIME_E2E=1` con `tests/realtime-screens.spec.ts` y `tests/realtime-notifications.spec.ts` en `:3010` | 3 pruebas nuevas y 4 de notificaciones correctas |
| E2E completa con `INBOX_E2E=1 REALTIME_E2E=1` | 47 correctas, 41 omitidas y el fallo de línea base descrito arriba |
| Auditoría de limpieza en la base | Cero usuarios, contactos, expedientes relacionados o avisos sobrantes con prefijos `rt-`, `realtime-e2e-`, `screens-` y `qa-realtime-` |

Comandos E2E ejecutados en PowerShell, con un servidor dedicado en `:3010` y build temporal `.next-qa`:

```powershell
$env:APP_URL='http://127.0.0.1:3010'; $env:E2E_PORT='3010'; $env:NEXT_DIST_DIR='.next-qa'; $env:REALTIME_E2E='1'; npx playwright test tests/realtime-screens.spec.ts tests/realtime-notifications.spec.ts --reporter=list
$env:INBOX_E2E='1'; npx playwright test --reporter=list
```

## Lo que sigue

El bloque 3 cubre las pantallas en vivo y la lectura del cliente. Quedan para el bloque 4 las nuevas señales iniciadas por el cliente (declinar una propuesta, abrir una propuesta y entrar al portal). El bloque 5 queda para correo inteligente, plantillas pendientes, recordatorios y preferencias de notificación.
