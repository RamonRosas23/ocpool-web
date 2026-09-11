# ADR — Preflight documental antes de publicar una cotización

**Fecha:** 2026-09-11
**Estado:** implementado en la ruta de publicación; pendiente de migrar
  cualquier integración interna que invoque la primitive de transición directa

## Problema

El flujo anterior cambiaba la versión a `ENVIADA` y emitía el evento de estado
antes de generar el PDF. Eso podía anunciar una propuesta en el portal sin un
documento verificable.

## Decisión

La operación HTTP que publica (`POST .../status` con `ENVIADA`) usa ahora
`publishQuoteVersion`: exige `quotes.send`, genera o reutiliza de forma
idempotente el PDF con `quotes.pdf.generate`, verifica almacenamiento y sólo
después ejecuta la transición y sus eventos Outbox. El renderer puede preparar
una versión en `EN_REVISION`; esa versión todavía no es visible al cliente.

Si la preparación falla, la transición no ocurre y el usuario recibe el error
sin una notificación falsa. Si el PDF ya está `READY`, la generación se
reutiliza y no duplica el documento.

## Límite conocido

`transitionQuoteVersion` se conserva como primitive de dominio para pruebas y
transiciones internas. Ninguna ruta HTTP la usa directamente para publicar.
Antes de retirar esa compatibilidad se debe convertir cualquier consumidor
interno a `publishQuoteVersion` y añadir el preflight a los contratos restantes.

## Evidencia

- `src/server/modules/quotes/service.ts` implementa la operación de publicación;
- `src/app/api/staff/quotes/versions/[versionId]/status/route.ts` la utiliza
  únicamente para `ENVIADA`;
- `src/server/modules/quote-documents/pdf-renderer.ts` genera `quote-pdf-v2`,
  embebe el logo oficial y pagina el alcance completo;
- `tests/integration/quotes-api.test.ts` cubre el envío por ruta y pasó 1/1;
- el E2E del constructor espera el PDF listo inmediatamente después de enviar.
