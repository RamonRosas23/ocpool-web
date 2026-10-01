# Nuevas señales del cliente — Bloque 4

Fecha: 2026-10-01 · Rama: `feat/notificaciones-tiempo-real` · Plan: [Bloque 4](../../superpowers/plans/2026-10-01-nuevas-senales-cliente-bloque-4.md) · Diseño aprobado: [notificaciones en tiempo real](../../superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md)

## Estado y alcance

El Bloque 4 está implementado en esta rama. Los Bloques 1–3 proporcionan la bandeja, el canal en vivo y la actualización de pantallas. El Bloque 5 sigue pendiente: correo inteligente, recordatorios y preferencias sincronizadas en el servidor. Esta entrega no declara completo el roadmap de cinco bloques ni autoriza un despliegue.

El bloque agrega tres señales: el cliente abrió por primera vez una versión publicada, activó su acceso al portal y declinó una propuesta con motivo. La declinación actualiza la experiencia del cliente y la guía al equipo hacia la siguiente versión.

## Contratos

| Señal | Origen y regla | Destino |
|---|---|---|
| `QUOTE.VIEWED` | Primera apertura autenticada de una versión publicada y visible. `QuoteVersionView` conserva la primera y última vista por cliente y versión; reabrir no duplica el aviso. | Responsable activo del expediente, prioridad informativa. |
| `CUSTOMER.PORTAL_ACTIVATED` | Sólo la transición real de cuenta `INVITED → ACTIVE`. Repetir la activación no vuelve a notificar. | Responsables activos de expedientes abiertos, prioridad informativa. |
| `QUOTE.DECLINED` | El cliente declina la versión publicada vigente, con PDF listo, antes de vencer y mientras el expediente permite negociar. | Responsable activo urgente y Gerencia informativa; se excluye al actor. |

Vista y activación no crean aviso cuando no hay responsable activo o el expediente está cerrado. La declinación se registra mediante `POST /api/portal/quotes/[id]/decline` con `versionId`, `reason`, comentario opcional e `idempotencyKey`.

Motivos disponibles: `PRICE` (El precio), `SCOPE` (Lo que incluye), `TIMING` (Los tiempos), `CHOSE_OTHER` (Elegí otra opción), `POSTPONED` (Lo voy a posponer) y `OTHER` (Otro motivo). El comentario se limita a 1000 caracteres y es obligatorio para `OTHER`.

La transacción valida alcance del cliente, versión publicada, estado, vigencia y PDF comercial verificable. En un solo commit escribe el mensaje compartido, cambia la versión a `RECHAZADA`, guarda historial y auditoría, y registra `QUOTE.DECLINED`. Si el expediente estaba en `COTIZACION_DISPONIBLE`, pasa a `EN_NEGOCIACION`. El expediente no se cierra. Un reintento idéntico conserva su resultado; una tentativa distinta no reaprovecha la llave anterior.

El cuerpo del mensaje conserva el prefijo versionado `Propuesta V{n} declinada: {motivo}. {comentario}`. El comentario vive en la conversación; las notificaciones y la vista interna sólo muestran versión y motivo. La proyección del equipo busca el mensaje más reciente del cliente y sólo para la versión publicada actual. El portal usa el historial de estado escrito por un actor `CUSTOMER` para mostrar la fecha de declinación, no confunde un rechazo del equipo con una decisión del cliente.

## Experiencia

El portal ofrece **No me interesa esta propuesta** cuando el PDF está listo, la versión es `ENVIADA` o `EN_NEGOCIACION`, la propuesta sigue vigente y el expediente está en `COTIZACION_DISPONIBLE` o `EN_NEGOCIACION`. El diálogo presenta los seis motivos, acepta un comentario de hasta 1000 caracteres y conserva la misma llave de idempotencia si un envío falla. Después de enviar, muestra la fecha de la respuesta y asigna al equipo el siguiente paso, con **Pedir una nueva versión** como acceso a la conversación.

El constructor y el detalle del expediente muestran **El cliente declinó la V{n} · {motivo}**. El comentario permanece en la conversación compartida.

## Verificación

- Proyección y siguiente paso: `tests/unit/portal-stage.test.ts` (7/7).
- Proyecciones de cliente/equipo y operaciones de solicitudes: 20 pruebas de integración en `client-portal-service`, `quotes-staff-service` y `quote-requests-staff`.
- Diálogo y respuesta de cliente-equipo: `tests/realtime-notifications.spec.ts`, bajo `REALTIME_E2E=1`, con servidor QA aislado en `127.0.0.1:3100` (5/5). Incluye 390 px, selección de motivo por teclado, fecha en portal, flash urgente y motivo legible en constructor.
- `npm run typecheck` y `npm run lint`: pasan.
- `npm run test:unit`: 77 archivos y 452 pruebas pasan.
- `npm run test:integration`: 68 archivos y 216 pruebas pasan en serie. La suite `inbox-record` inyecta intencionalmente `SELECT 1/0` para comprobar que un fallo del aviso no revierte el cambio de dominio; la prueba pasa.
- E2E general: 35 pasan, 61 se omiten por variables optativas y una falla en la línea base aceptada: `quality.spec.ts` recibe cinco HTTP 400 al cargar imágenes de proyectos inválidas, y el test de errores de consola falla por esas respuestas. No es una falla del flujo de declinación.
- `REALTIME_E2E=1` sobre `tests/realtime-notifications.spec.ts`: 5/5 pasan, incluido el nuevo flujo cliente-equipo. `npm run test:e2e:foundation`: 2/2 pasan.
- La verificación E2E usó el servidor QA aislado en el puerto 3100; el servidor de desarrollo del usuario en el puerto 3000 no se tocó. La consulta final confirmó cero contactos, usuarios, conceptos o listas de precios `RT-E2E` residuales.

## Pendiente

El Bloque 5 sigue pendiente: correo que se envía sólo mientras el aviso siga sin leer y agrupación de mensajes, recordatorios y preferencias persistentes. No se modifica la configuración del piloto ni se hace push o despliegue en esta entrega.
