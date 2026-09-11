# ADR — Aprobación versionada de descuentos en cotizaciones

- **Estado:** `VERIFICADO_LOCAL`
- **Fecha:** 2026-09-11
- **Alcance:** primer vertical slice del flujo comercial V2 (A1-01/A1-02)
- **Landing:** fuera de alcance y sin cambios

## Decisión

La autorización de un descuento no se deriva únicamente del permiso del usuario.
Se persiste como `QuoteApproval`, ligada a `Quote` y a una `QuoteVersion`, con
tipo, política, digest del snapshot económico, solicitante, resolutor, fechas,
vigencia y estado. Sólo puede existir una aprobación activa por versión/tipo.

Una aprobación `APPROVED` sólo permite enviar la versión si su digest coincide
con el snapshot actual y no está vencida. Cualquier edición del borrador o una
nueva solicitud con otro digest marca las aprobaciones activas como
`SUPERSEDED`. La autoaprobación se rechaza aunque el actor consiga el permiso;
el servidor no confía en la UI.

## Invariantes

- el descuento requiere `quotes.apply_discount` para ser capturado;
- solicitar aprobación requiere `quotes.create` y una versión en `EN_REVISION`;
- resolver requiere `quotes.approve_discount` y un actor distinto al solicitante;
- un rechazo exige motivo;
- las decisiones se bloquean si el snapshot cambió o la aprobación expiró;
- `QUOTE.APPROVAL_REQUESTED` y `QUOTE.APPROVAL_RESOLVED` quedan en Outbox;
- auditoría y payloads no almacenan correo, teléfono ni contenido de líneas;
- toda mutación privada exige same-origin en la API y respuesta `no-store`.

## Implementación

- modelo y constraints: `prisma/schema.prisma` y migración
  `20260911090000_quote_approvals`;
- dominio/servicio: `src/server/modules/quotes/approval-service.ts`;
- bloqueo de envío e invalidación al editar: `src/server/modules/quotes/service.ts`;
- API: `POST/GET /api/staff/quotes/versions/:versionId/approvals` y
  `POST /api/staff/quotes/approvals/:approvalId/decision`;
- eventos de Outbox y plantillas de notificación staff con deep link al expediente;
- proyección staff y acciones guiadas: `staff-service.ts` y
  `StaffQuotesPanel.tsx`.

## Evidencia

- `npx prisma migrate status`: schema local al día (18 migraciones);
- `npx vitest run tests/integration/quotes-service.test.ts --maxWorkers=1`:
  3/3, incluyendo solicitud idempotente, autoaprobación, digest obsoleto y
  envío sólo después de la aprobación vigente;
- `npm run test:unit`: 34 archivos / 138 pruebas;
- `npm run typecheck` y `npm run lint`: correctos;
- `git diff --check`: correcto.

## Pendiente explícito

Este slice no cierra G0 ni inventa los permisos finales BIZ-06/BIZ-07. Antes de
activar flags de V2 todavía deben aprobarse política/umbrales, locale, términos,
primitives y el resto del ciclo working/publicada/documento/publicación/delivery.
