# ADR — Ciclo comercial canónico de OCPOOL V2

**ID:** ADR-2026-09-10-commercial-lifecycle-v2  
**Estado:** `APPROVED_LOCAL_PRODUCT` — revisión técnica local completa; aprobación explícita de producto registrada el 2026-09-11
**Fecha:** 2026-09-10  
**Owner:** Codex/arquitectura  
**Aprobador requerido:** responsable de producto OCPOOL — cubierto para el alcance local por autorización explícita en la tarea del 2026-09-11
**Alcance:** sistema staff, portal y autenticación privada; la landing no participa.

## Contexto

La implementación actual conserva datos y controles valiosos, pero varias entidades expresan verdades distintas con el mismo estado o puntero. `Quote.currentVersionId` funciona simultáneamente como working y propuesta del cliente; `QuoteRequestStatus` copia etapas de cotización; el frontend proyecta transiciones que el backend no acepta; el PDF y la notificación no tienen un orden comercial seguro; y la aceptación recibe una cadena de términos elegida por el navegador.

La auditoría se realizó contra el código del commit `ee7d06df970691ff60caccc8d634516120516885`. Este ADR y [`commercial-workflow-v2.ts`](../../tests/fixtures/commercial-workflow-v2.ts) definen el contrato que D1/D2 implementarán. No cambian schema, endpoints, permisos ni comportamiento en G0-01.

## Decisión

Cada verdad comercial tendrá un dueño único. La etapa visible será una proyección calculada desde esas fuentes, no otra máquina mutable. La propuesta publicada se conservará mientras exista una revisión interna nueva.

| Pregunta | Fuente canónica V2 | No debe volver a ser fuente |
| --- | --- | --- |
| ¿Dónde se capta y califica? | `QuoteRequest` | estados de cotización copiados en la solicitud |
| ¿Qué edita staff? | `Quote.workingVersionId` + `QuoteVersion` | `currentVersionId` ambiguo |
| ¿Qué ve el cliente? | `Quote.publishedVersionId` + `QuotePublication` | la última versión no `BORRADOR` |
| ¿Cuánto vale? | snapshot inmutable de versión y líneas | catálogo vigente al reabrir |
| ¿Requiere autorización? | `QuoteApproval` sobre digest exacto | `PENDIENTE_DE_APROBACION` |
| ¿Existe documento? | `GeneratedDocument` con objeto privado, hash y `READY` | un estado `ENVIADA` |
| ¿Fue publicada? | `QuotePublication` | `QuoteRequest.status` |
| ¿Qué ocurrió con el aviso? | `NotificationDelivery` | creación de Outbox interpretada como entrega |
| ¿Qué aceptó el cliente? | `QuoteAcceptance` sobre publicación, PDF y términos exactos | `currentVersionId` |
| ¿Existe proyecto? | `Project` + snapshot de handoff | `CONVERTIDA_EN_PROYECTO` sin entidad |

## Ciclos objetivo

### Solicitud

```text
RECIBIDA → EN_REVISION ↔ INFORMACION_REQUERIDA
           ├─→ LISTA_PARA_COTIZAR ─→ CONVERTIDA_EN_PROYECTO
           └─→ RECHAZADA
```

La conversión sólo es posible después de una aceptación exacta y de que el contrato de proyecto esté habilitado. `COTIZACION_DISPONIBLE`, `EN_NEGOCIACION`, `PENDIENTE_DE_APROBACION`, `ACEPTADA` y `VENCIDA` dejan de ser una segunda máquina de la solicitud; durante la transición se conservan únicamente para lectura, backfill y reconciliación.

### Versión

```text
BORRADOR → EN_REVISION → LISTA_PARA_PUBLICAR → PUBLICADA
                 ↘ BORRADOR                     ├─→ REEMPLAZADA
                                                ├─→ ACEPTADA
                                                ├─→ RECHAZADA
                                                └─→ VENCIDA
```

Sólo `BORRADOR` es editable. Volver a borrador invalida aprobación, PDF y preflight. Vencer no reabre ni muta evidencia: permite clonar una nueva working version.

### Aprobación, documento, publicación y entrega

El orden obligatorio es:

```text
congelar digest
→ resolver aprobación aplicable
→ preparar/verificar PDF privado
→ seleccionar términos activos y congelar destinatario
→ crear preflight
→ confirmación humana
→ publicar y mover publishedVersionId
→ encolar Outbox/delivery
→ entregar, fallar o cancelar sin despublicar
```

Una entrega fallida no revierte la publicación. Una reintentada usa idempotencia ligada al payload; una clave reutilizada con otro payload se rechaza.

## Contrato de eventos

La tabla exhaustiva `evento → precondición → entidad mutada → auditoría → outbox → etapa visible` vive en `TARGET_TRANSITIONS` dentro del fixture. Cada fila debe tener precondiciones explícitas, acción de auditoría y una decisión explícita sobre Outbox; no se permite una transición “implícita”.

Eventos de especial riesgo:

- `publishQuote` sólo después de `GeneratedDocument.READY`, términos activos y preflight coincidente.
- `acceptPublishedQuote` sólo si la versión es exactamente `publishedVersionId`, el PDF y los términos coinciden por hash y el actor tiene scope propio.
- `returnQuoteToDraft` invalida approval/document/preflight y conserva la publicación anterior.
- `createProjectFromAcceptance` es idempotente y no cambia la solicitud si no crea el `Project` completo.
- `PENDIENTE_DE_APROBACION` legacy nunca autoriza descuento ni prueba aceptación.

## Proyección de etapa y acciones

El resolver futuro devolverá, como mínimo:

```ts
type CommercialPresentation = {
  stage: string;
  stageLabel: string;
  actorExpected: 'STAFF' | 'CUSTOMER' | 'MANAGER' | 'SYSTEM' | 'NONE';
  waitingSince: string | null;
  primaryAction: string | null;
  secondaryActions: readonly string[];
  blockers: readonly string[];
  delivery: 'NONE' | 'QUEUED' | 'SENT' | 'FAILED' | 'CANCELLED';
};
```

El servidor es la autoridad. La UI no mantiene `NEXT_STATUS_OPTIONS`, no calcula permisos a partir del rol y no renderiza una acción que no tenga comando y precondiciones válidas.

## Inventario legacy y reconciliación

El fixture conserva el inventario completo de estados actuales, comandos que los alcanzan y dueño V2. En particular:

| Legacy | Tratamiento V2 |
| --- | --- |
| `currentVersionId` | dual-read temporal; backfill separado a working/published; cuarentena si hay ambigüedad |
| `EN_ELABORACION` | existencia de working version, no publicación |
| `COTIZACION_DISPONIBLE` | proyección derivada sólo con `QuotePublication` |
| `EN_NEGOCIACION` | evento de cambio/conversación, no estado duplicado |
| `PENDIENTE_DE_APROBACION` | puente legacy; nunca aprobación de descuento |
| `VENCIDA` | expiración de versión publicada; no bloquea clonar working |
| `ENVIADA` | mapeo temporal de delivery/publication; no prueba PDF listo |
| términos string del cliente | cuarentena/registro activo; no aceptación nueva sin términos server-owned |

El backfill D1 será expand/backfill/contract, idempotente y con reporte de ambigüedades. Ninguna ambigüedad se resuelve eligiendo silenciosamente la versión más reciente.

## Invariantes no negociables

El fixture y sus pruebas cubren, al menos:

1. working y published no comparten significado;
2. portal y aceptación parten de publicación deliberada;
3. staff, portal, PDF y aceptación usan el mismo snapshot;
4. PDF verificable precede publicación y aviso;
5. aprobación está ligada a versión/revisión/digest exactos;
6. términos activos son inmutables y seleccionados por servidor;
7. actor, permiso y scope se verifican en backend;
8. idempotencia liga clave y hash de payload;
9. expiración no bloquea una nueva working;
10. un estado imposible bloquea y diagnostica; nunca inventa una acción.

## Decisiones aún abiertas

Las políticas BIZ-01…BIZ-14 se formalizan en `2026-09-10-commercial-policy-v1.md`.
BIZ-03, BIZ-04, BIZ-09 y BIZ-10 permanecen bloqueadas por fiscal/jurídico; una
slice que dependa de ellas sigue `BLOQUEADA` hasta tener owner, decisión, impacto
y no-go explícitos.

## Evidencia y aceptación

G0-01 se considera técnicamente verificable cuando:

- el fixture cubre todas las entidades y estados inventariados;
- cada estado no inicial tiene una transición de entrada y cada transición tiene auditoría, precondiciones y etapa;
- los casos válidos e inválidos están cubiertos sin conectar el runtime;
- `npm run typecheck`, lint y `npm run test:unit` pasan;
- el responsable de producto registra `APPROVED` en `docs/adr/2026-09-10-commercial-v2-g0-acceptance.md`.

La aprobación local de producto está registrada en el artefacto de aceptación;
las aprobaciones fiscal/legal y el cierre formal del Gate G0 siguen siendo
requisitos independientes.

## Supersesión

Este ADR reemplaza, sólo para el alcance privado V2 y cuando exista contradicción, las decisiones comerciales de los documentos históricos de Fases 3–9 y el plan anterior `ee7d06d`. No borra ni reescribe historia; el índice exacto y la reconciliación se mantienen en el plan maestro.
