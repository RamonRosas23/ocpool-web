# Matriz formal de alcance e IDOR del workspace de solicitudes

**Fecha:** 2026-09-13  
**Ámbito:** superficies privadas staff del workspace R1; sólo verificación local  
**Estado:** `VERIFIED_LOCAL_TECHNICAL_PENDING_GATE_APPROVAL`

## Regla única de alcance

El servidor es la autoridad. Un empleado con `requests.read.global` puede
consultar solicitudes globalmente y filtrar por cualquier responsable activo.
Un empleado sin ese permiso sólo puede consultar solicitudes sin responsable o
asignadas a sí mismo. La UI puede ocultar controles, pero nunca sustituye esta
regla.

Las lecturas fuera de alcance responden como si el recurso no existiera
(`404 NOT_FOUND`) para evitar enumeración. Los intentos de usar un filtro o
destino de responsable ajeno responden `403 FORBIDDEN` cuando el recurso no es
el objeto enumerado, sino una operación explícitamente prohibida.

## Matriz de superficies

| Superficie | Entrada directa | Regla sin scope global | Regla con scope global | Evidencia local |
| --- | --- | --- | --- | --- |
| Cola de solicitudes | `GET /api/staff/quote-requests` | propias + sin asignar; filtro ajeno `403` | todas; filtro por responsable activo | `quote-requests-staff.test.ts` |
| Detalle y actividad | `GET .../:id`, `GET .../:id/activity` | solicitud ajena `404` | permitido | `quote-requests-staff.test.ts` |
| Toma y asignación | `POST .../:id/take`, `POST .../:id/assign` | sólo toma propia; no puede leer/asignar solicitud ajena | asigna cualquier responsable activo | `quote-requests-staff.test.ts` |
| Edición y estado | `PATCH .../:id`, `POST .../:id/status`, `POST .../:id/request-information` | solicitud ajena `404` | permitido según capability | `quote-requests-staff.test.ts` |
| Mensajería y notas | `GET/POST .../:id/messages`, notes, conversation-status | solicitud ajena `404`; permisos de nota/cierre separados | permitido según capability | `messaging-service.test.ts` |
| Archivos | list, reserve, complete, download y delete bajo `.../:id/files` | solicitud/archivo ajeno `404` | permitido según capability | `private-files-service.test.ts`, `private-files-api.test.ts` |
| Workspace de cotización | `GET /api/staff/quotes`, `GET .../quotes/:requestId` | solicitud ajena excluida/`404` | permitido | `quotes-staff-service.test.ts` |
| Versiones de cotización | create, edit, transition y publish por `versionId` | versión ligada a solicitud ajena `404` | permitido según capability | `quotes-service.test.ts` |
| Aprobaciones | list/request/decision por `versionId`/`approvalId` | versión ligada a solicitud ajena `404` | permitido según capability y separación de funciones | `quotes-service.test.ts` |
| PDF y documento | generate/status/download por `versionId`/`quoteId` | cotización ligada a solicitud ajena `404` | permitido según capability | `quote-pdf-service.test.ts`, `quote-documents-api.test.ts` |
| Habilitación de portal | `POST .../:id/customer-access` | solicitud ajena `404` | permitido según capability | `customer-onboarding-service.test.ts` |
| Directorio de responsables | `GET .../assignees` | sólo devuelve al propio empleado | devuelve responsables activos acotados | `quote-requests-staff.test.ts`, contrato de capabilities |

## Garantías de implementación

- La regla está centralizada en
  [`request-scope.ts`](../../src/server/auth/request-scope.ts), no duplicada
  en componentes cliente.
- Las consultas de lista combinan el alcance con búsqueda, estado, fechas,
  orden y paginación dentro de `AND`; un `OR` de búsqueda no puede escapar del
  scope.
- Las mutaciones vuelven a comprobar el alcance después de tomar el bloqueo
  transaccional de la solicitud; un cambio concurrente de responsable no abre
  una ventana de autorización.
- Las relaciones derivadas (mensajes, archivos, cotizaciones, aprobaciones,
  PDFs y onboarding) comprueban el request padre antes de devolver datos o
  ejecutar una operación.
- `requests.read.global` es una capability catalogada y sembrada de forma
  idempotente; Ventas no la recibe, mientras Gerencia y Administración sí.
- La UI V2 y el fallback legacy consumen `requestsReadGlobal` para evitar
  controles imposibles, pero las pruebas de seguridad no dependen de esa
  ocultación.

## Pendientes que no invalida esta matriz

Esta matriz cierra la verificación técnica local del alcance staff, pero no
cierra el gate R1 ni G0. Siguen pendientes el piloto T1, la aprobación formal
del gate, los signoffs fiscal/jurídicos y la repetición de pruebas con la
cohorte productiva autorizada. No se activan flags ni se publica desde este
artefacto.
