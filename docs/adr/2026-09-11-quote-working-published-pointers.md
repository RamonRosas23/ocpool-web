# ADR — Punteros separados para trabajo y publicación

- **Estado:** `VERIFICADO_LOCAL`
- **Fecha:** 2026-09-11
- **Alcance:** contención P0-01 del ciclo comercial V2

## Decisión

`Quote` conserva temporalmente `currentVersionId` por compatibilidad, pero el
dominio ya escribe y consulta dos significados explícitos:

- `workingVersionId`: única versión editable/en revisión del equipo;
- `publishedVersionId`: último snapshot enviado y visible para el cliente.

Crear una nueva versión conserva la publicada y mueve sólo el puntero de
trabajo. Enviar una versión mueve `publishedVersionId` y limpia el puntero de
trabajo. Volver a borrador o rechazar no publica nada. El portal, PDF de cliente
y aceptación prefieren siempre la versión publicada; staff prefiere trabajo y,
si no existe, muestra la publicada como contexto para iniciar una nueva.

## Migración segura

Las migraciones `20260911093000_quote_working_published_pointers` y
`20260911094000_quote_pointer_integrity` son expand/backfill + constraints:
añade columnas nullable, rellena la última versión visible como publicada y
marca como trabajo sólo `BORRADOR`/`EN_REVISION`, crea índices únicos y conserva
el puntero legado sin borrarlo y las FK compuestas impiden cruzar versiones
entre expedientes. El contrato de compatibilidad permite leer
fixtures antiguos que todavía sólo establecen `currentVersionId`; la escritura
nueva ya mantiene los tres valores coherentes.

## Evidencia

- `npx prisma migrate status`: 20 migraciones al día;
- servicios dirigidos portal, PDF/aceptación, staff y cotizador: 6/6 pruebas
  de integración verdes;
- el flujo de cotización verifica explícitamente trabajo → publicada y nueva
  versión sin perder la anterior;
- `npm run typecheck`, `npm run lint` y `git diff --check`: correctos.

## Retirada futura

No se elimina `currentVersionId` hasta que fixtures, APIs legacy y consumidores
externos se migren y exista un gate de contrato. La limpieza será una migración
contract posterior, no un cambio destructivo silencioso.
