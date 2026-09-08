# UI de mensajería del portal cliente — OCPOOL

**Fecha:** 2026-09-07  
**Fase:** 6 — Mensajería y notas internas  
**Slice:** Tarea 4 — UI del portal cliente  
**Estado:** aprobada para implementación incremental

## Objetivo

Integrar la conversación del expediente dentro del detalle privado del cliente. La interfaz debe ayudar a continuar una decisión comercial concreta —una solicitud, una propuesta y sus aclaraciones— sin sentirse como una aplicación de chat genérica ni duplicar el portal.

## Dirección visual

La superficie reutiliza la identidad existente del portal:

- **Base:** azul profundo `#092433` para navegación, arena `#eee9df` para el lienzo y papel `#f8f5ee` para el expediente.
- **Acentos:** cobre editorial para acciones y metadatos, azul agua para señales de equipo y estados activos.
- **Tipografía:** las familias OCPOOL ya cargadas; display para títulos y sans para operación, sin agregar dependencias.
- **Estructura:** reglas finas, superficies planas y ritmo de dossier. El único elemento expresivo nuevo es la línea temporal vertical del hilo.
- **Alineación:** contenido textual a la izquierda; acciones de envío a la derecha en escritorio y ancho completo en móvil.

Wireframe de escritorio:

```text
┌──────────────────────── expediente ────────────────────────┐
│ propuesta vigente                                           │
│ total / líneas / vigencia                                   │
├─────────────────────────────────────────────────────────────┤
│ CONVERSACIÓN DEL EXPEDIENTE              abierta            │
│  │  Equipo OCPOOL · fecha                                  │
│  ├─ mensaje del equipo                                     │
│  │  Tú · fecha                                             │
│  └─ mensaje del cliente                                    │
│                                                             │
│ Escribe una actualización…                         Enviar  │
│ 0 / 10,000                                                  │
├─────────────────────────────────────────────────────────────┤
│ trazabilidad · versiones compartidas                       │
└─────────────────────────────────────────────────────────────┘
```

En móvil la conversación mantiene la línea temporal y apila el encabezado, feed, contador y composer. El textarea nunca queda fuera del viewport; el botón conserva un área táctil mínima de 44 px.

## Contrato de datos cliente

El panel consume `GET /api/portal/requests/:id/messages` con `{ items, nextCursor, conversation }` y `POST` con `{ body, idempotencyKey }`. Nunca modela notas internas, `clientId`, `senderUserId`, hashes ni campos de autorización.

```ts
type PortalMessage = {
  id: string;
  conversationId: string;
  visibility: 'CUSTOMER';
  body: string;
  createdAt: string;
  sender: { displayName: string; type: 'CUSTOMER' | 'EMPLOYEE' } | null;
};

type PortalConversationResponse = {
  conversation: {
    id: string;
    quoteRequestId: string;
    status: 'OPEN' | 'CLOSED';
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  } | null;
  items: PortalMessage[];
  nextCursor: string | null;
};
```

## Estados y comportamiento

- **Carga:** skeleton local de la sección, sin ocultar propuesta ni expediente.
- **Vacío:** explicar que aquí se resolverán dudas del proyecto y ofrecer el composer activo.
- **Con mensajes:** mostrar orden cronológico ascendente; equipo con tratamiento agua claro, cliente con tratamiento arena/cobre, sin depender sólo del color.
- **Más mensajes:** botón discreto para cargar el siguiente cursor; conserva los mensajes ya renderizados.
- **Envío:** deshabilitar composer durante la operación, crear idempotency key opaca por intento y agregar el resultado del servidor, nunca confiar en un optimistic body sin confirmación.
- **Error de envío:** mantener el texto en el composer, anunciar el error en `role="alert"` y permitir reintentar con una nueva clave.
- **Error de lectura:** mantener la propuesta visible y mostrar una sección recuperable con acción “Reintentar”.
- **Cerrada:** feed de sólo lectura, explicación clara y composer deshabilitado. El cliente nunca reabre.
- **Sesión expirada:** el guard/API conserva la política existente; el panel muestra el error privado sin stack ni datos técnicos.

## Accesibilidad y rendimiento

- Encabezado semántico `h3`, lista de mensajes y `aria-live="polite"` para nuevos resultados.
- Cada mensaje conserva texto legible, fecha visible y etiqueta de autor; color no es el único indicador.
- Textarea con `label` visible o asociada, contador anunciado y botón con estado `aria-busy`/disabled.
- Foco visible de teclado, orden lógico, `prefers-reduced-motion`, sin autofocus que robe contexto.
- La lectura es `no-store`; el siguiente cursor sólo se solicita bajo acción del usuario.
- No se instala librería de chat, editor enriquecido ni sistema de realtime en esta tarea.

## Criterios de terminado

- El cliente puede leer y enviar mensajes del expediente desde `/portal`.
- Las notas internas nunca aparecen, aunque existan en el mismo expediente.
- Se cubren carga, vacío, error, envío, reintento, cierre, paginación y responsive en 360/390/768/1440 px.
- Playwright verifica Axe, consola limpia, no overflow, privacidad del payload y foco/teclado básico.
