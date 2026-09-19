# OCPOOL — Plan de continuación V3 (post-G0, D1 real y cierre del backlog comercial)

> **Estado:** activo. **Reemplaza como fuente operativa a:** [`docs/historicos/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md`](../../historicos/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md) (plan V2, archivado — su tablero/evidencia quedaron desactualizados frente al trabajo real hecho vía `PROJECT_STATUS.md`).
> **Por qué existe este documento:** el plan V2 fue diseñado alrededor de un gate G0 formal con aprobaciones externas (fiscal/jurídico) que nunca iban a llegar como función separada del negocio. El responsable de producto resolvió directamente esas decisiones ([ADR 2026-09-19](../../adr/2026-09-19-commercial-policy-v2-resolution.md)) y pidió un plan limpio, sin la ceremonia de gates/paquetes READY que ya no aporta valor, para continuar sin pausas hasta terminar todo el backlog comercial.
> **Última actualización:** 2026-09-19.
> **Responsable:** producto OCPOOL (decisión) + Codex (arquitectura, implementación, evidencia) — autoridad de decisión técnica delegada explícitamente a Codex para todo lo no cubierto por el ADR de política.

## 0. Cómo usar este documento

Fuente operativa única desde el 2026-09-19. Para contexto histórico de cómo se llegó aquí: `PROJECT_STATUS.md` (bitácora exacta de cada slice, con commit y conteo de pruebas) y `docs/historicos/plans/2026-09-10-...` (plan V2 archivado). No hace falta leer esos documentos para continuar el trabajo — este archivo es autocontenido.

### 0.1 Reglas de ejecución (vigentes, actualizadas)

- Trabajar directamente en `main`; sin ramas/PR/workflows de GitHub.
- Commits pequeños y lógicos por slice; no mezclar migración de dominio + rediseño + cleanup ajeno en un commit gigante.
- **Verificación por bloque, no por cambio:** acumular varias piezas relacionadas (p. ej. todo D1-01, o dos/tres partes seguidas de un mismo módulo) y correr `tsc`/`lint`/unitarias/integración/E2E **una sola vez por bloque**, no después de cada cambio mínimo. Esto reemplaza la disciplina anterior de verificar cada micro-cambio — instrucción explícita del responsable de producto tras observar que la cadencia anterior consumía tiempo desproporcionado.
- No tocar la landing. Si un cambio compartido la afecta, la tarea se detiene y se avisa.
- Preservar trabajo ajeno; nunca operaciones Git destructivas sin autorización explícita.
- No versionar secretos/`.env`/credenciales/backups/datos reales.
- Migraciones: expand/backfill/contract; nunca eliminar campos/enums en esta fase (contract se deja para O1, igual que en V2).
- Cualquier cambio de norte, schema, permiso o política crea/actualiza un ADR — pero el ADR registra la decisión, no un protocolo de aprobación externa que ya no aplica.
- Cerrar cada pieza con una entrada en `PROJECT_STATUS.md` (mismo estilo denso ya establecido: qué se encontró, qué se decidió, qué se verificó, qué queda fuera).
- Producción sigue sin fecha: se trabaja 100% en local hasta que **todo** el backlog de este documento esté implementado y verificado; sólo entonces el responsable de producto hace una revisión final única (y posible ajuste) antes de cualquier despliegue.

### 0.2 Qué ya NO aplica del plan V2

- El protocolo formal de "Gate" con checklist de aprobador/fecha UTC/artefacto de aceptación por fase — sustituido por una `Definition of Done` simple por módulo (ver §8).
- Los estados `PENDIENTE_FISCAL`/`PENDIENTE_LEGAL` como bloqueo de slice — resueltos por el [ADR de política v2](../../adr/2026-09-19-commercial-policy-v2-resolution.md).
- La idea de que las flags V2 (`commercialWorkspaceV2`, `quoteBuilderV2`, etc.) son el único camino de entrega: en la práctica, todo el valor de simplificación de flujo (Q1, W1, P1, C1) se construyó y ya vive en los paneles legacy por defecto (`StaffQuotesPanel`, `StaffDashboardPanel`, `StaffRequestsPanel`, `ClientPortalPanel`), que son los que de verdad usa el negocio hoy. Las flags/rutas V2 quedan como opción futura de shell, no como bloqueo de nada de este documento.

## 1. Norte inmutable (sin cambio respecto a V2)

```text
Solicitud → revisión guiada → información suficiente → propuesta en un solo expediente
→ aprobación cuando aplique → PDF verificable → publicación y aviso → decisión del cliente
→ nueva versión sin perder la anterior → aceptación → handoff real a proyecto
```

Flujo simple, rápido, sin pasos innecesarios — mandato explícito y permanente del responsable de producto para toda decisión de UX de aquí en adelante.

No-negociables (sin cambio): una intención = un espacio principal; acción visible = legal para ese actor/estado; working ≠ published; el portal sólo muestra publicaciones deliberadas; staff/portal/PDF/auditoría comparten el mismo snapshot económico; documento listo precede publicación; entrega de email se comunica aparte de publicación; el usuario nunca ve centavos/basis points/código interno; autosave no sacrifica concurrencia; seguridad no depende de la UI; tipografía de sistema/logo oficial; landing intacta.

## 2. Estado real alcanzado (resumen; detalle exacto y evidencia en `PROJECT_STATUS.md`)

| Rama del plan V2 | Estado real 2026-09-19 |
| --- | --- |
| G0 (gobierno/decisiones) | Cerrado en la práctica por el [ADR de política v2](../../adr/2026-09-19-commercial-policy-v2-resolution.md); no queda ninguna decisión de negocio bloqueante. |
| S0 (contención P0) | Implementado y verificado localmente (S0-01…S0-04); sigue siendo la base de integridad, no se revierte. |
| D1 (modelo objetivo) | **No construido todavía — objeto de este plan (ver §3).** Los punteros `workingVersionId`/`publishedVersionId` de P0-01 ya existen; falta el resto. |
| D2 (comandos/resolver/proyecciones) | **Cerrado por completo** (D2-01 puente…D2-06), incluyendo permisos nuevos, comandos, proyección compacta paginada y deep links. |
| U1 (sistema privado/shell) | **Cerrado por completo** (U1-01…U1-06, incluida toda la iconografía/labels de U1-05). |
| R1 (expediente/solicitudes V2) | Implementado y verificado localmente bajo flag; falta sólo el piloto humano (no bloquea nada de este documento). |
| K1 (catálogo/precios/policy) | Cerrado salvo K1-04 (política e impuestos), que este plan desbloquea con el ADR de política v2. |
| Q1 (constructor) | Q1-01 (implícito vía autosave), Q1-02 (vía K1-01), Q1-04, Q1-05 y Q1-06 cerrados sobre el panel legacy. **Faltan Q1-03 (secciones/reorder) y Q1-07 (resumen responsive).** |
| A1 (aprobaciones) | A1-02 y A1-04 cerrados para descuento/concepto especial. **Falta A1-01 (umbral real, ahora desbloqueado), A1-03 (cola/preview) y A1-05 (fórmula de orden) más allá de lo ya construido en W1-02 parte 2.** |
| P1 (PDF/publicación) | P1-04 parte 1 (preflight visual) cerrado. **El resto (P1-01/03/05/06/07 reales) depende de D1 y es el mayor entregable pendiente junto con D1.** |
| C1 (portal/aceptación) | C1-04 y fricción general cerrados. **C1-05 (aceptación legal real) estaba bloqueada por BIZ-09/10 — ya desbloqueada por el ADR.** C1-01/02/03/06/07 existen en forma legacy suficiente; revisar contra checklist en §3.7. |
| W1 (centro de trabajo) | W1-02 (mine/unassigned/aprobaciones) cerrado. **Falta W1-01 (read-state/razones), colas de "listas para publicar"/"fallos de aviso" y W1-03.** |
| J1 (handoff a proyecto) | No construido — BIZ-13 ya confirmada, sin cambio de alcance frente a V2 (§22 de ese plan). |
| Deuda técnica señalada en sesión | Consolidación de tokens CSS `--staff-*`/`--analytics-*`/`--audit-*`, rediseño de indicadores de punto compacto (fila de solicitud, punto de sesión del cliente) y 4 defectos ya flagueados (ver §6). |
| H1/T1/O1 | Sin empezar; dependen de que el resto cierre primero. |

## 3. D1 — Modelo objetivo real (siguiente entregable)

**Por qué ahora:** D2/K1/Q1/A1/C1 se construyeron deliberadamente sobre un **resolver puente** (`workspace-projection.ts`, documentado en su propio código como reemplazo total, no extensión, cuando D1 llegue) precisamente para no bloquear el valor de UX mientras D1 esperaba autorización. Esa autorización ya existe: *"Si construyelo, que quede todo bajo una misma arquitectura, bien hecho, sin huecos, perfecto, sin defectos e inconsistencias."*

**Decisión de alcance (para no sobre-construir):** D1 entrega la modelación que hoy falta — revisión/digest real, publicación como hecho de primera clase, política/impuestos/términos versionados, contenido comercial estructurado — sin renombrar los 7 valores existentes de `QuoteVersionStatus` (`BORRADOR`/`EN_REVISION`/`ENVIADA`/`EN_NEGOCIACION`/`ACEPTADA`/`RECHAZADA`/`VENCIDA`). Un renombre de enum (p. ej. `ENVIADA`→`PUBLICADA`) tocaría ~30 pruebas y todo el resolver puente sin agregar ninguna capacidad real; en cambio, "reemplazada" se deriva de `supersededAt IS NOT NULL`, consistente con el no-negociable #2 del norte ("la etapa se deriva, no es otra máquina mutable"). Se documenta aquí como decisión deliberada, no como hueco.

### 3.1 D1-01 — Revisión y publicación como hechos de primera clase

Agregar a `QuoteVersion`:

- `revision Int @default(1)` — reemplaza el sustituto `updatedAt` que D2-04/Q1-05 usan hoy para concurrencia optimista; se incrementa en cada comando que muta contenido.
- `contentDigest String? @db.Char(64)` — sha256 del contenido congelado (líneas + secciones + totales + términos), calculado igual que ya lo hace `QuoteApproval.digest` hoy (mismo algoritmo, reutilizado).
- `publishedAt DateTime? @db.Timestamptz(3)` y `supersededAt DateTime? @db.Timestamptz(3)`.

Backfill: `revision = 1` para toda versión existente (no hay historial de revisiones previas que reconciliar); `publishedAt`/`supersededAt` se derivan de `QuoteStatusHistory` (primera transición a `ENVIADA` → `publishedAt`; si la quote tiene una versión posterior con `publishedVersionId` distinto, la anterior recibe `supersededAt` = `createdAt` de esa transición). Reporte de ambigüedades (ninguna esperada, dado que el propio puntero `publishedVersionId` ya es la fuente de verdad de cuál es la vigente) antes de cerrar el backfill.

### 3.2 D1-02 — Contenido comercial estructurado

- `QuoteSectionSnapshot` (nuevo): `id`, `quoteVersionId` (FK), `position Int`, `title VarChar(180)`, `description Text?`.
- `QuoteLineSnapshot` gana `position Int` (reemplaza depender del orden de `id` — el mismo defecto de ordenamiento ya documentado como gotcha esta sesión) y `sectionId String? @db.Uuid` (FK opcional a `QuoteSectionSnapshot`; una línea sin sección es válida, para no forzar Q1-03 a existir antes de que el usuario cree secciones).
- `QuoteLineSnapshot` gana `baseUnitPriceMinor BigInt` (precio de catálogo antes de cualquier override — hoy sólo se guarda el precio final `unitPriceMinor`, perdiendo la distinción que Q1-04 ya muestra en UI a partir de datos derivados en memoria) y `overrideReason VarChar(300)?`.
- `QuoteVersion` gana campos de contenido publicable: `scopeText Text?`, `exclusionsText Text?`, `paymentTermsText Text?`, `warrantyText Text?`, `publicNotesText Text?` — hoy no existen en ningún lado; sin esto, P1-02 (plantilla PDF completa) y C1-03 (propuesta publicada con "alcance, exclusiones, pago, garantías" en términos humanos) no tienen de dónde leer ese contenido.

Backfill: `position` de líneas existentes = orden actual por `id` (preserva el orden visible hoy, sin reordenar nada); resto de campos nuevos quedan `NULL` (ninguna versión histórica tenía este contenido — no se inventa retroactivamente).

### 3.3 D1-03 — Política, impuestos y términos versionados

- `CommercialPolicyVersion` (nuevo): `id`, `versionTag VarChar(64) @unique`, `currencyCode Char(3)`, `precision Int @default(2)`, `timezone VarChar(64)` (= `America/Chihuahua`, ya usado como `APP_TIMEZONE`), `discountApprovalThresholdBps Int @default(1000)` (10%, BIZ-06/07), `createdAt`, `createdById`, `active Boolean @default(true)`. Publicar una policy nueva marca `active=false` en la anterior; nunca se edita una ya usada por una `QuoteVersion`.
- `TaxProfileVersion` (nuevo): `id`, `code VarChar(32) @unique` (`IVA_GENERAL`, `IVA_FRONTERA`), `name VarChar(120)`, `ratePercentBasisPoints Int` (1600 / 800), `roundingRule` enum (`HALF_UP` único valor por ahora), `currencyCode Char(3)`, `active Boolean @default(true)`, `createdAt`. Seed inicial con los dos perfiles del ADR de política v2.
- `CommercialTermsVersion` (nuevo): `id`, `versionTag VarChar(64) @unique`, `title VarChar(180)`, `bodyMarkdown Text`, `privacyMarkdown Text`, `publishedAt DateTime`, `createdById`. Seed inicial con el contenido de [`docs/legal/terminos-y-privacidad-comercial.md`](../../legal/terminos-y-privacidad-comercial.md) como v1 activa.
- `QuoteVersion` gana `taxProfileId String? @db.Uuid` (FK), `commercialPolicyId String? @db.Uuid` (FK), `termsVersionId String? @db.Uuid` (FK), `sourcePriceListId String? @db.Uuid` (FK a `PriceList`, para saber de qué lista se originó sin depender de leer las líneas). Todas nullable porque una versión `BORRADOR` puede no tener política resuelta todavía; se vuelven efectivamente obligatorias (validadas en servicio, no en DB) al pasar a `EN_REVISION`.

Sin esto, K1-04 (UI de política e impuestos) no tiene tabla donde escribir, y el IVA seleccionable por zona que pidió el responsable de producto seguiría siendo una idea sin implementación real.

### 3.4 D1-04 — Publicación como registro propio

- `QuotePublication` (nuevo): `id`, `quoteId`, `quoteVersionId`, `documentId` (FK a `GeneratedDocument`), `termsVersionId` (FK), `preflightDigest Char(64)`, `recipientEmailHash Char(64)` (nunca el correo en claro en este registro — mismo criterio que ya aplica el sistema de auditoría a otros datos sensibles), `status` enum (`PUBLISHED`, `SUPERSEDED`), `publishedAt`, `publishedById`.

Una fila por evento de publicación real (no por versión) — permite que D2/P1 consulten "¿cuándo y con qué digest se publicó esto exactamente?" sin inferirlo de `QuoteStatusHistory`, que hoy mezcla todas las transiciones sin distinguir cuál fue una publicación real.

### 3.5 Migración

Expand puro: todas las columnas nuevas son nullable o tienen default seguro; ninguna tabla ni columna existente se elimina o se vuelve `NOT NULL` de golpe. Backfill en el mismo commit (dataset local es pequeño; no requiere job separado). Dual-read no aplica porque nada lee estos campos todavía — el resolver puente sigue siendo la única fuente de proyección hasta que D2 se actualice explícitamente para consumir D1 (pieza separada, después de D1).

### 3.6 Explícitamente fuera de alcance de D1

- `IdempotentCommand`/receipt genérico: la concurrencia optimista real (`revision`) y las claves de idempotencia ya existentes por comando (approval digest, aceptación, mensajería) cubren los casos reales conocidos; una tabla de receipts genérica sin un bug concreto que la exija sería abstracción prematura.
- Renombrar `QuoteVersionStatus` (ver justificación en la introducción de §3).
- Retirar el bridge resolver — se hace en una pieza posterior explícita ("D2 sobre D1"), no dentro de esta migración, para poder verificar el schema nuevo de forma aislada antes de tocar el resolver que todo el frontend ya consume.

### 3.7 Checklist de cierre de D1 (reemplaza el "Gate D1" formal de V2)

- [ ] migración aplica limpia sobre una copia de la base local y el backfill no deja ambigüedades sin reportar;
- [ ] `npx prisma validate` + `npx tsc --noEmit` limpios con los nuevos campos tipados en los servicios que ya existen (sin romper ninguno);
- [ ] seed idempotente crea los dos `TaxProfileVersion` y la `CommercialTermsVersion` v1 si no existen, sin duplicar en reejecuciones;
- [ ] ninguna publicación ni aceptación existente pierde datos ni cambia de estado visible;
- [ ] suite completa (unitarias/integración/E2E ya existentes) sigue en verde — D1 es aditivo puro, cero comportamiento debe cambiar todavía.

## 4. Backlog ordenado después de D1

Orden por dependencia real, no por número de sección:

1. **D1** (§3) — esta pieza.
2. **K1-04** — UI de política/impuestos/términos sobre las tablas de D1-03; desbloquea mostrar IVA correcto y términos reales en el builder.
3. **A1-01 final** — evaluador de umbral real (10%) sobre `CommercialPolicyVersion`.
4. **Q1-03** — secciones/reorder accesible, ahora que `QuoteSectionSnapshot`/`position` existen.
5. **Q1-07** — resumen responsive (no depende de D1; puramente UI, se intercala donde convenga).
6. **P1 real** (P1-01, P1-03, P1-05, P1-06, P1-07) — snapshot de publicación congelado, comando idempotente con `expected revision`, `QuotePublication`, delivery/onboarding. El mayor entregable técnico pendiente junto con D1.
7. **C1-05** — aceptación con términos reales (`CommercialTermsVersion` de D1-03) y firmante según BIZ-09; C1-01/02/03/06/07 se auditan contra su checklist (§20 del plan V2 archivado) y se cierran los huecos reales que se encuentren, sin asumir que ya están completos sólo porque el portal funciona hoy.
8. **W1-01** — `ConversationReadState` + razones deterministas (ya confirmado por el responsable de producto).
9. **W1-03** y colas restantes de W1 ("listas para publicar", "fallos de aviso").
10. **A1-03/A1-05** — cola `/staff/approvals` dedicada con preview, más allá de lo ya cubierto por W1-02 parte 2.
11. **J1 completo** (J1-01…J1-04) — BIZ-13 ya confirmada.
12. **Deuda técnica** (§6) — se intercala en cualquier punto conveniente del bloque de trabajo, no bloquea nada de lo anterior.
13. **H1** — hardening premium (matriz E2E completa, seguridad, concurrencia, migración/backup, rendimiento, accesibilidad, observabilidad) — igual que V2 lo definía, sin cambios de alcance.
14. **T1** — piloto humano real.
15. **O1** — rollout y contract migration (retiro de `currentVersionId`, flags, dual-write).

## 5. Matriz RBAC y contrato de dominio

Sin cambios respecto a V2 (§7/§8 de ese documento) — siguen vigentes tal cual, no se repiten aquí para no duplicar texto que no cambió.

## 6. Deuda técnica autorizada (resolver en este bloque)

- **Tokens CSS duplicados:** consolidar las paletas `--staff-*`/`--analytics-*`/`--audit-*` de `globals.css` en un solo set de tokens semánticos reutilizado por las tres superficies, sin cambiar ningún valor de color visible.
- **Indicadores de punto compacto:** rediseñar el marcador de fila de la lista de solicitudes y el punto de sesión del cliente para que comuniquen estado con algo más que color (mismo criterio que U1-05 ya aplicó a píldoras y badges de archivo).
- **4 defectos ya flagueados como tareas separadas** (`task_770d8526` duplicación de paginación en auditoría, `task_23866bee` aserción obsoleta en `requests.spec.ts`, `task_303e09eb` conteo inestable en `analytics-service.test.ts`, `task_701c1329` logo faltante en `auth-surfaces.spec.ts`): resolver cada uno como parte del bloque de trabajo donde se toque el archivo relacionado, o en un bloque dedicado de limpieza si ninguna pieza los toca antes de H1.

## 7. Feature flags

Sin cambio de valores (todas `off` por defecto, server-side, cohorte estable) — ver §9.2 del plan V2 archivado para la tabla completa. La diferencia real es de expectativa: activarlas deja de ser un evento ceremonioso de "gate" y pasa a ser una decisión de rollout (H1/T1/O1), porque el valor de producto ya vive en los paneles legacy sin depender de ellas.

## 8. Definition of Done por módulo (reemplaza el protocolo de Gate formal)

Una pieza queda cerrada cuando:

1. el código implementa exactamente lo descrito en su sección de este plan (o una decisión documentada de alcance distinto, con la razón);
2. `npx tsc --noEmit`, `npm run lint` y la suite unitaria/integración relevante pasan;
3. existe al menos un caso E2E o de integración dirigido que prueba el comportamiento nuevo, no sólo que compila;
4. `PROJECT_STATUS.md` tiene una entrada nueva con lo encontrado, decidido, verificado y lo que queda fuera;
5. no se rompió ninguna suite existente (regresión completa al cierre del bloque, no de cada pieza individual — ver §0.1).

No existe un estado "aprobado por producto" intermedio: el responsable de producto ya delegó la decisión técnica; su única revisión pendiente es la final, sobre el conjunto completo, antes de producción.
