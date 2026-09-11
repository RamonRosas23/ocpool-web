# ADR — Términos de aceptación controlados por servidor

**Fecha:** 2026-09-11
**Estado:** implementado localmente; pendiente de aprobación legal BIZ-10

## Contexto

La aceptación de una cotización recibía un `termsVersion` enviado por el
navegador. Aunque el valor se guardaba como evidencia, el cliente podía
seleccionar cualquier identificador válido y la interfaz tenía la versión
duplicada como constante propia.

## Decisión

El servidor mantiene una única versión vigente (`quote-terms-2026-01` por
ahora), la expone como parte de la versión publicada del portal y rechaza toda
aceptación que no coincida exactamente con ella. La interfaz sólo muestra y
reenvía ese valor; no decide la versión. La aceptación conserva el
identificador recibido para que la evidencia histórica siga siendo auditable.

La cadena sigue siendo provisional hasta que jurídico apruebe el texto y la
política de versionado (BIZ-10). Cambiar el identificador requiere una nueva
decisión/ADR y el despliegue coordinado del texto correspondiente.

## Consecuencias

- se elimina la selección arbitraria de términos desde el navegador;
- un cliente ve en el portal la misma versión que valida el backend;
- el cliente ve una etiqueta comprensible y el identificador técnico queda
  reservado para la evidencia y soporte;
- una versión antigua no se puede aceptar después de cambiar la política sin
  una migración/decisión explícita;
- todavía no se declara cumplimiento legal ni firma electrónica avanzada.

## Evidencia

- `src/server/modules/quote-documents/domain.ts` controla la versión vigente;
- `src/server/modules/quote-documents/acceptance-service.ts` rechaza versiones
  distintas antes de persistir evidencia;
- `src/server/modules/client-portal/service.ts` entrega el identificador al
  portal y `ClientQuoteActions` ya no mantiene una constante local;
- pruebas unitarias y de portal pasan con la versión vigente.
