# ADR — Objetivos locales y muestra mínima de G0-03

- **Estado:** `APPROVED_LOCAL_PARTIAL`
- **Fecha:** 2026-09-11
- **Owner:** Codex/arquitectura
- **Aprobación local:** autorización explícita del responsable de la iniciativa en esta tarea
- **Alcance:** muestra reproducible de G0-03; no sustituye fiscalía, jurídico ni piloto con usuarios reales

## Decisión

Se acepta como evidencia mínima reproducible local una muestra de cinco
recorridos independientes y limpios por cada métrica instrumentada. Cada
recorrido usa fixtures desechables, Chromium, base PostgreSQL local, datos
sintéticos y el registrador opt-in; ningún registro se activa en producción ni
contiene PII.

La muestra no se presenta como significancia estadística ni como validación de
usuarios. Su propósito es demostrar que el instrumento, el flujo y la
recuperación son repetibles antes de abrir U1/R1. La validación real queda para
el piloto T1 con ventas, gerencia, administración y clientes.

## Objetivos aprobados localmente

Se adoptan como objetivos de producto los presupuestos ya definidos en §29 del
plan maestro:

- siguiente tarea: mediana ≤ 10 s y p90 ≤ 20 s;
- lista de solicitud → borrador de tres conceptos: ≤ 5 acciones;
- agregar diez conceptos: ≤ 45 s;
- ítem especial: ≤ 90 s;
- primer intento staff: ≥ 90%;
- portal acceso → decisión: ≥ 95% de finalización;
- máximo un retroceso por tarea crítica;
- piloto de usabilidad: SUS ≥ 85 y SEQ promedio ≥ 6/7.

Para las métricas sin un umbral numérico en §29 se aprueba un guardrail local,
no un SLA inventado: cinco de cinco recorridos completan su resultado esperado,
sin duplicados, sin PII, sin fuga cross-client, sin estado imposible y con
`errorCount=0`, salvo el escenario que prueba explícitamente un error
recuperable. La tasa de abandono y la comprensión del cliente se volverán a
medir con usuarios reales; los cinco casos sintéticos de abandono sólo prueban
que el evento se registra correctamente.

## Evidencia local seleccionada

La muestra final reúne 65 registros: 13 métricas × 5 recorridos. Las carpetas
temporales se conservaron fuera del repositorio para no convertir datos de QA en
artefactos de producto.

| Métrica | n | Mediana | p95 | Resultado de integridad |
| --- | ---: | ---: | ---: | --- |
| `public_request_to_confirmation` | 5 | 5,657 ms | 6,018 ms | 5/5 confirmaciones |
| `request_to_next_task` | 5 | 645 ms | 9,020 ms | 5/5 completados |
| `request_to_draft` | 5 | 2,053 ms | 6,448 ms | 5/5 completados |
| `add_ten_concepts` | 5 | 1,013 ms | 1,016 ms | 5/5 completados |
| `publish_quote` | 5 | 1,986 ms | 7,966 ms | 5/5 publicados |
| `draft_to_approval_resolution` | 5 | 1,538 ms | 13,031 ms | 5/5 resueltos, sin autoaprobación |
| `document_failure_to_recovery` | 5 | 1,172 ms | 3,719 ms | 5/5 recuperados |
| `delivery_failure_to_recovery` | 5 | 96 ms | 97 ms | 5/5 recuperados |
| `published_to_new_working` | 5 | 129 ms | 2,148 ms | 5/5 conservaron publicada |
| `expired_quote_to_next_step` | 5 | 1,712 ms | 2,469 ms | 5/5 orientados a conversación |
| `portal_access_to_decision` | 5 | 1,174 ms | 1,359 ms | 5/5 decisiones |
| `workflow_errors` | 5 | 1,174 ms | 1,359 ms | 5/5 recuperados, `errorCount=1` |
| `workflow_abandonment` | 5 | 254 ms | 355 ms | 5/5 abandonos intencionales |

La prueba repetida del cotizador también corrigió la espera del panel
documental durante una recarga móvil: el expediente podía renderizarse antes
de que terminaran las capacidades y la lista. La comprobación ahora espera el
estado estable real. La ruta pública conservó el mismo comportamiento de
producto y amplió la espera de la aserción E2E para no confundir latencia local
con rechazo de la solicitud.

## Criterio de salida

G0-03 queda `VERIFIED_LOCAL_PARTIAL`: instrumento, recorridos y muestra mínima
están verificados, y los objetivos locales están aprobados. No se cierra el Gate
G0 porque siguen pendientes el piloto con usuarios reales, la decisión de
telemetría/retención y los signoffs fiscales y jurídicos de G0-02.

La siguiente fase permitida es preparar U1/R1 bajo flags fail-closed después de
la revisión técnica correspondiente. No se habilita rollout, producción,
telemetría ni publicación por esta decisión.
