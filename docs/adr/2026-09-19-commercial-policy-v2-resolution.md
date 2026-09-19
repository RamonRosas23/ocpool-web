# ADR — Resolución de política comercial, fiscal y legal (cierre de BIZ-03/04/06/07/09/10/13)

**ID:** ADR-2026-09-19-commercial-policy-v2-resolution
**Estado:** `APPROVED_PRODUCT`
**Fecha:** 2026-09-19
**Owner técnico:** Codex/arquitectura
**Decisor:** responsable de producto OCPOOL, con autoridad de decisión delegada explícitamente a Codex donde se indica
**Supersede parcialmente a:** [`2026-09-10-commercial-policy-v1.md`](2026-09-10-commercial-policy-v1.md) — v1 permanece como historial; sus filas `APPROVED_PRODUCT` siguen vigentes, y este documento cierra únicamente las filas que v1 dejó `PENDING_FISCAL`/`PENDING_PRODUCT_LEGAL`/`PENDING_LEGAL`.

## Contexto

OCPOOL no cuenta con fiscalía ni jurídico externo como función separada del negocio. El responsable de producto, actuando con autoridad plena sobre el negocio, decidió resolver directamente BIZ-03, BIZ-04, BIZ-06, BIZ-07, BIZ-09, BIZ-10 y BIZ-13 en vez de dejar el gate G0 bloqueado indefinidamente por una aprobación externa que no existe. Cada decisión abajo es una decisión de negocio real, no un default inventado por ingeniería sin autorización.

**Excepción explícita:** ninguna decisión de esta ADR fabrica una identidad fiscal. No existe RFC ni régimen fiscal registrado ante el SAT para OCPOOL en este momento; donde el sistema necesite ese dato no se inventa un valor — el campo queda vacío/pendiente hasta que exista un registro real, y el documento comercial lo señala explícitamente en vez de omitirlo en silencio.

## Decisiones

### BIZ-03 — Perfiles fiscales

**Decisión aprobada:** el "perfil fiscal" que modela el sistema es exclusivamente un perfil de **cálculo de impuesto** (tasa + redondeo), nunca una identidad fiscal registrada. Se crea `TaxProfileVersion` versionado e inmutable una vez usado, con al menos dos perfiles activos desde el arranque:

| Código | Nombre | Tasa | Aplica a |
| --- | --- | --- | --- |
| `IVA_GENERAL` | IVA general | 16% | resto del país (default) |
| `IVA_FRONTERA` | IVA zona fronteriza | 8% | franja fronteriza norte |

El perfil es **seleccionable y editable** desde la UI de política (K1-04), no una constante fija en código — el propio responsable de producto señaló que la tasa varía por zona y debe poder ajustarse. `RFC`/`régimen fiscal` no forman parte de `TaxProfileVersion` ni de ningún modelo nuevo; en el PDF, el bloque de datos fiscales del emisor muestra "Datos fiscales: pendientes de registro" en vez de un RFC inventado, hasta que exista uno real.

**Responsable:** producto OCPOOL. **Ámbito:** producto. **Fecha UTC:** 2026-09-19. **Impacto:** desbloquea K1-04 y la plantilla fiscal del PDF (P1-02). **Slice que desbloquea:** D1-04, K1-04. **No-go si falta:** ninguno — decisión cerrada.

### BIZ-04 — IVA incluido/excluido y redondeo

**Decisión aprobada:** el impuesto se calcula **excluido** (se suma sobre el subtotal, "más IVA"), consistente con el propio schema ya vigente (`subtotalMinor` + `taxTotalMinor` = `totalMinor`, columnas ya separadas desde Fase 4). Redondeo: half-up al centavo, por línea primero y después al sumar — mismo criterio ya aplicado de forma consistente en todo el motor de precios existente (`roundHalfUp`); esta ADR sólo lo formaliza como política, no introduce un cambio de comportamiento.

**Responsable:** producto OCPOOL. **Ámbito:** producto. **Fecha UTC:** 2026-09-19. **Impacto:** ninguno sobre cálculo ya implementado; formaliza el criterio para D1-04/K1-04. **No-go si falta:** ninguno — decisión cerrada.

### BIZ-06/BIZ-07 — Umbral de descuento y autoaprobación

**Decisión aprobada:** un descuento de hasta **10%** sobre el subtotal de la versión no requiere aprobación gerencial (autonomía de ventas para negociación menor, priorizando velocidad); un descuento mayor a 10%, cualquier override de precio unitario y cualquier concepto especial **siempre** requieren aprobación, sin excepción de umbral. Autoaprobación permanece prohibida por servidor; sólo `quotes.approval.override` (exclusivo de `admin`, ya implementado) permite que el propio solicitante resuelva su aprobación, y sigue exigiendo motivo auditable.

**Responsable:** producto OCPOOL. **Ámbito:** producto. **Fecha UTC:** 2026-09-19. **Impacto:** el evaluador de policy de A1-01 puede implementarse con este umbral real en vez de "cualquier descuento bloquea". **Slice que desbloquea:** A1-01 (evaluador final), K1-04. **No-go si falta:** ninguno — decisión cerrada.

### BIZ-09 — Firmante autorizado

**Decisión aprobada:** cualquier contacto de cliente ya autenticado en el portal (con `portal.self.read` sobre ese expediente) puede aceptar la propuesta, sin una capa adicional de verificación de autoridad — exactamente el comportamiento ya implementado en C1-04 (nombre precargado desde el contacto autenticado, editable). Se prioriza explícitamente no volver engorroso el proceso de aceptación, por instrucción directa del responsable de producto.

**Responsable:** producto OCPOOL. **Ámbito:** producto. **Fecha UTC:** 2026-09-19. **Impacto:** ninguno sobre lo ya implementado; formaliza la política para C1-05. **No-go si falta:** ninguno — decisión cerrada.

### BIZ-10 — Términos y aviso de privacidad

**Decisión aprobada:** se autoriza y encarga a Codex redactar el contenido real de condiciones comerciales y aviso de privacidad para OCPOOL, en español, adaptado al sistema actual (ver [`docs/legal/terminos-y-privacidad-comercial.md`](../legal/terminos-y-privacidad-comercial.md)). El texto se versiona como la primera `CommercialTermsVersion` activa. **Advertencia explícita conservada:** este texto es un borrador operativo completo, no una revisión de abogado certificado; el responsable de producto revisará todo el sistema al final de la iniciativa (antes de cualquier paso a producción real) y podrá sustituir el texto por una versión revisada sin romper nada, porque `CommercialTermsVersion` es inmutable una vez usada — sustituir el texto crea una versión nueva, nunca edita la existente.

**Responsable:** producto OCPOOL (autoría delegada a Codex). **Ámbito:** producto, con reserva expresa de revisión legal antes de producción. **Fecha UTC:** 2026-09-19. **Impacto:** desbloquea D1-04, C1-05 (aceptación real) y la plantilla legal del PDF. **Slice que desbloquea:** D1-04, C1-05. **No-go si falta:** ninguno para continuar en local; production launch conserva el riesgo documentado en `PROJECT_STATUS.md` → Riesgos abiertos.

### BIZ-13 — Alcance de J1 (handoff a proyecto)

**Decisión aprobada:** se confirma el alcance ya diseñado en el plan maestro (J1-01…J1-04, §22): `Project` mínimo real (folio, cliente/contacto, aceptación única fuente, responsable, snapshot de alcance, checklist, estado, auditoría), sin gestión de obra. El responsable de producto reafirmó explícitamente priorizar la simplicidad y velocidad del flujo sobre cualquier funcionalidad adicional.

**Responsable:** producto OCPOOL. **Ámbito:** producto. **Fecha UTC:** 2026-09-19. **Impacto:** desbloquea J1 completo. **No-go si falta:** ninguno — decisión cerrada.

## Reglas que quedan normativas a partir de esta ADR

- ningún modelo nuevo de impuesto/fiscal contiene RFC ni régimen fiscal inventados;
- `TaxProfileVersion` y `CommercialTermsVersion` son inmutables una vez referenciadas por una `QuoteVersion` publicada; un cambio de tasa o de texto crea versión nueva, nunca edita la existente;
- el umbral de descuento de 10% es dato de policy (`CommercialPolicyVersion`), no una constante de código, para poder ajustarse sin migración cuando el negocio lo requiera;
- el contenido de `docs/legal/terminos-y-privacidad-comercial.md` es borrador operativo hasta que el responsable de producto registre una revisión formal antes de producción.

## Relación con el plan

Esta ADR cierra las filas que [`2026-09-10-commercial-policy-v1.md`](2026-09-10-commercial-policy-v1.md) dejó pendientes de fiscalía/jurídico externo, sustituyendo esa espera por decisión directa del responsable de producto. G0-02 queda cerrado en la práctica: cero fila `PENDING` capaz de bloquear D1/D2/K1-04/A1/C1-05. El detalle operativo de continuación vive en el plan vigente: [`docs/ocpool-commercial-v2/plans/2026-09-19-ocpool-commercial-v3-continuacion.md`](../ocpool-commercial-v2/plans/2026-09-19-ocpool-commercial-v3-continuacion.md).
