# UI de mensajería interna y notas — OCPOOL

**Fecha:** 2026-09-08  
**Fase:** 6 — Mensajería y notas internas  
**Slice:** Tarea 5 — UI staff y notas internas  
**Estado:** aprobada para implementación incremental

## Objetivo

Integrar la conversación de cada expediente en el inbox `/staff/requests` para que el equipo pueda responder al cliente, coordinarse con notas privadas y cerrar o reabrir la conversación sin abandonar el contexto comercial.

La superficie debe sentirse como una herramienta de operaciones: rápida, densa y legible. No será un chat genérico ni una segunda bandeja separada del expediente.

## Decisión de diseño

Se evaluaron tres opciones:

1. **Panel flotante independiente:** rápido de añadir, pero rompe el contexto del expediente y complica responsive/foco.
2. **Dos listas permanentes en paralelo:** diferencia bien las visibilidades, pero duplica scroll y reduce el ancho útil en laptop.
3. **Hilo único con vistas segmentadas:** conserva la continuidad temporal y permite separar “Compartidos” y “Notas internas” sin mezclar compositores. Es la opción elegida.

El backend seguirá entregando el hilo completo permitido al empleado. La UI filtrará por visibilidad sólo para presentación; el servicio continuará siendo la autoridad para `messaging.read`, `messaging.send`, `messaging.internal_notes.read`, `messaging.internal_notes.write` y `messaging.manage`.

## Dirección visual

La nueva superficie reutiliza la gramática ya establecida en `StaffRequestsPanel`:

- **Base:** azul profundo `#092433`, papel cálido `#f8f5ee`, arena `#eee9df`.
- **Compartido:** tratamiento agua claro, regla lateral azul y etiqueta “Visible para cliente”.
- **Nota interna:** arena cálida con keyline cobre y etiqueta inequívoca “Sólo equipo”.
- **Estado de conversación:** línea de estado en el encabezado; cerrado se muestra como lectura y una acción de reapertura sólo aparece con `messaging.manage`.
- **Estructura:** bloque debajo de las acciones del expediente y antes del historial de estados; el expediente sigue siendo la unidad de trabajo.
- **Contención:** no se agregan tarjetas redondeadas ni métricas decorativas; el hilo usa reglas, lista cronológica y un único composer contextual.

Wireframe de escritorio:

```text
┌──────────── detalle del expediente ─────────────────────────────┐
│ alcance · responsable · transición de estado                    │
├─────────────────────────────────────────────────────────────────┤
│ CORRESPONDENCIA                              abierta  [Cerrar]  │
│ [Compartidos 3] [Notas internas 2]                              │
│  ─ Equipo OCPOOL · fecha       Visible para cliente             │
│  ─ Cliente · fecha             Respuesta del cliente            │
│                                                                 │
│ Mensaje compartido                                             │
│ [Escribe una actualización…                         Enviar]    │
│ 0 / 10,000                                                      │
├─────────────────────────────────────────────────────────────────┤
│ HISTORIAL DEL EXPEDIENTE                                       │
└─────────────────────────────────────────────────────────────────┘
```

En móvil las vistas se apilan; el composer ocupa el ancho disponible, conserva un área táctil mínima de 44 px y nunca exige scroll horizontal.

## Contrato de capacidades

`GET /api/staff/capabilities` agregará sólo booleanos derivados del actor:

```ts
type StaffMessagingCapabilities = {
  messagingRead: boolean;
  messagingSend: boolean;
  messagingInternalNotesRead: boolean;
  messagingInternalNotesWrite: boolean;
  messagingManage: boolean;
};
```

La UI usa estos valores para ocultar acciones que el actor no puede realizar, pero todos los endpoints mantienen sus guardias backend.

## Contrato de datos del hilo

El componente staff consumirá `GET /api/staff/quote-requests/:id/messages?limit=30`:

```ts
type StaffMessage = {
  id: string;
  conversationId: string;
  visibility: 'CUSTOMER' | 'INTERNAL';
  body: string;
  createdAt: string;
  sender: { id: string; displayName: string; type: 'CUSTOMER' | 'EMPLOYEE' } | null;
};

type StaffConversationResponse = {
  conversation: {
    id: string;
    quoteRequestId: string;
    clientId: string;
    status: 'OPEN' | 'CLOSED';
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  } | null;
  items: StaffMessage[];
  nextCursor: string | null;
};
```

Mutaciones existentes:

- Compartido: `POST /api/staff/quote-requests/:id/messages` con `{ body, idempotencyKey }`.
- Nota: `POST /api/staff/quote-requests/:id/notes` con `{ body, idempotencyKey }`.
- Estado: `POST /api/staff/quote-requests/:id/conversation-status` con `{ status: 'OPEN' | 'CLOSED' }`.

La clave de idempotencia se genera en el navegador por intento, nunca se muestra al usuario ni se acepta desde un campo editable.

## Comportamiento y estados

- **Carga:** skeleton local dentro de la sección; no bloquea la lectura del expediente.
- **Sin conversación:** mensaje vacío operativo. El hilo se crea sólo al enviar la primera mutación.
- **Con mensajes:** orden cronológico ascendente; cliente, equipo y nota tienen tratamientos distintos y texto de visibilidad explícito.
- **Más mensajes:** botón de cursor que conserva la vista actual y deduplica por ID.
- **Composer compartido:** aparece sólo con `messaging.send`, etiqueta explícita “Visible para cliente”, contador y bloqueo durante envío.
- **Composer de nota:** aparece sólo con `messaging.internal_notes.write`, etiqueta “Sólo equipo”, fondo diferenciado y sin posibilidad de cambiar de visibilidad con un selector ambiguo.
- **Sin permiso de notas:** la pestaña y composer privado no aparecen; nunca se simula una nota con un error del servidor.
- **Cerrada:** ambos compositores desaparecen; se muestra estado bloqueado. Con `messaging.manage`, aparece “Reabrir conversación”; sin él, sólo el estado.
- **Error de lectura:** la propuesta operativa y el resto del expediente permanecen visibles; se ofrece “Reintentar” dentro del bloque.
- **Error de envío:** el texto permanece en el composer correcto, el error se anuncia y reintentar usa una nueva clave.
- **Error de estado:** no se cambia la etiqueta local hasta confirmar la respuesta del backend.

## Seguridad y privacidad

- El componente no recibe ni construye `clientId`, `senderUserId` o permisos desde el expediente; sólo consume la respuesta protegida y capacidades derivadas.
- La UI no oculta mensajes internos mediante CSS: filtra los objetos por `visibility` antes de renderizar y nunca envía notas al endpoint compartido.
- No se loguea cuerpo de mensaje, nota, token ni clave de idempotencia.
- Cerrar/reabrir requiere confirmación inline accesible y `messaging.manage`; el backend mantiene same-origin, sesión, scope y transacción.

## Accesibilidad y rendimiento

- `h3`/`h4` jerárquicos, tabs como botones con `aria-selected`, panel activo con `aria-labelledby` y lista cronológica semántica.
- `role="status"` para cambios confirmados y `role="alert"` para errores; foco visible en tabs, composer y acciones de estado.
- El cambio de vista no mueve el foco inesperadamente ni hace autofocus en el textarea.
- Lectura `no-store`, cursor bajo demanda y cancelación de fetch al cambiar de expediente.
- Respeta `prefers-reduced-motion`, contrastes existentes y tamaños 360/390/768/1440 px.
- No se agregan dependencias.

## Criterios de terminado

- El equipo puede leer mensajes compartidos e internos permitidos dentro del expediente.
- Compartido y nota interna son visual y operativamente inequívocos; cada composer sólo escribe en su endpoint.
- Capacidades sales/manager/admin controlan la visibilidad de acciones sin sustituir autorización backend.
- Cierre/reapertura respeta permisos, confirmación, estados y errores recuperables.
- Se verifican privacidad de payload/HTML, dos capacidades distintas, IDOR, same-origin, closed state, idempotencia, Axe, consola, responsive y no overflow.
