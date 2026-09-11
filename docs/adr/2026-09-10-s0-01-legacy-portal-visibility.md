# ADR — Contención S0-01 para visibilidad del portal legacy

- **Estado:** `VERIFIED_LOCAL`
- **Fecha:** 2026-09-10
- **Owner:** Codex/arquitectura
- **Motivo de excepción:** corrección de seguridad/integridad independiente de BIZ-01…BIZ-14
- **No cierra G0 ni autoriza despliegue**

## Problema

El modelo legacy sólo tiene `Quote.currentVersionId`. Ese puntero se mueve a la
nueva working version cuando el personal empieza una revisión. Si el portal,
la descarga PDF o la aceptación lo usaban directamente, un cliente podía ver,
descargar o intentar aceptar una versión `EN_REVISION`.

## Decisión de contención

Se centralizó la lista de estados de versión visibles al cliente en
`src/server/modules/quotes/customer-visibility.ts`:

`ENVIADA`, `EN_NEGOCIACION`, `ACEPTADA`, `RECHAZADA`, `VENCIDA`.

Las superficies customer ahora:

- excluyen `BORRADOR` y `EN_REVISION` de versiones, historial y resumen;
- exigen `portal.self.read` además de tipo `CUSTOMER` y `clientId` activo;
- eligen la versión pública más reciente cuando `currentVersionId` apunta a
  working interna;
- exponen sólo un booleano `pdfReady` calculado con el documento privado y su
  objeto escaneado; el portal no ofrece descargar/aceptar mientras el PDF no
  esté verificablemente listo;
- exigen scope `clientId` para PDF y devuelven `404` ante una versión interna o
  de otro cliente;
- aceptan únicamente la versión pública elegible con PDF listo.
- validan las notificaciones de aceptación contra `QuoteAcceptance.quoteVersionId`
  y su snapshot aceptado, sin depender de `Quote.currentVersionId` que puede
  haber cambiado a una nueva working version.

No se cambia schema, se mantienen los punteros legacy para staff y no se altera
la landing.

## Evidencia

- `tests/unit/client-portal-service.test.ts` verifica la lista de estados.
- `tests/integration/client-portal-service.test.ts` crea V1 enviada y V2 en
  revisión; el portal sólo devuelve V1.
- `tests/integration/quote-acceptance-service.test.ts` crea V1 con PDF y V2 en
  revisión; la aceptación se registra en V1.
- `tests/integration/quote-documents-api.test.ts` verifica descarga de V1 y
  rechazo `404` de V2 para customer.
- `tests/integration/client-portal-api.test.ts` verifica que un customer sin
  `portal.self.read` recibe `403`.
- `tests/integration/notifications-fanout.test.ts` crea una working V2 después
  de la aceptación y verifica que el evento sigue notificando la V1 aceptada.
- Typecheck, lint, contenido y build aislado (`NEXT_DIST_DIR=.next-verify-s0`) PASS.
- Suite unitaria completa: 34 archivos / 135 pruebas PASS.
- Suite de integración serial con márgenes explícitos: 42 archivos / 87 pruebas PASS.
- Regresión dirigida de las tres superficies: 4 pruebas de integración PASS.

## Límite

Esta contención no resuelve todavía `publishedVersionId`, backfill, digest,
publicación ni reconciliación V2. Es un forward fix reversible por código y
debe conservarse durante D1 hasta completar migración y doble lectura.
