# OCPOOL — Plan maestro integrado de rearquitectura comercial V2

> **Versión del plan:** 2.0
> **Estado:** plan revisado; G0 sigue abierto y se permite implementar verticales de integridad local cuando reducen un bloqueo P0 sin activar flags ni tocar la landing.
> **Fase activa:** G0 — Gobierno, decisiones y baseline.
> **Tarea actual (`EN_PROGRESO`):** G0-03/G0-05 — baseline HTTP y navegador anónimo PASS; auth surfaces 5/5, calidad pública 35/35 y matriz comercial autenticada ampliada 17/17 en runner aislado (incluye catálogo/precios); G0-04 quedó aprobado localmente con `lang="es-MX"` SSR y primitives por patrón. La muestra mínima local de G0-03 ya reúne 65 registros PII-safe (`13 métricas × n=5`) y sus objetivos de §29 quedaron aprobados localmente; falta el piloto real y las decisiones fiscales/legales. Bajo la excepción de integridad local quedaron implementados y verificados los verticales P0 de punteros working/published, snapshot financiero (S0-02), aprobación de descuentos (A1-01/A1-02), acciones server-owned (S0-03), publicación con preflight PDF (P0-05 parcial) y términos controlados por servidor (D1-04 parcial), sin activación productiva. La preparación local U1-01/U1-03/U1-06 ya tiene namespace, layouts, shell verificable y harness sintético, sin activar flags ni tocar la landing. La congelación de landing y rollback fail-closed ya tienen manifiesto reproducible.
> **Último gate técnico local:** contrato canónico G0-01 verificado, matriz de baseline validada, `40/40` archivos y `185/185` unitarias, `42/42` archivos y `95/95` integraciones, E2E pública `35/35` ejecutables con `29` omitidas por opt-in, E2E V2 `5/5` (incluye dedupe visible, decisión explícita y reutilización de contacto), portal autenticado `4/4`, staff de mensajería/archivos `2/2`, foundation `2/2`, typecheck, lint, build, schema/migraciones y audit PASS. El gate formal de G0 y el gate de entrada R1 siguen abiertos por sus aprobaciones no técnicas.
> **Bloqueo actual:** G0-03 tiene muestra mínima y objetivos aprobados localmente, pero conserva pendiente el piloto real y el cierre formal del gate; además siguen los signoffs externos de fiscal/jurídico para BIZ-03, BIZ-04, BIZ-09 y BIZ-10. Los verticales locales no se activan por flag hasta cerrar G0. La contención S0-01 sigue aplicada por seguridad.
> **Siguiente paso exacto:** ejecutar el gate R1 completo con flags apagadas y conservar la compatibilidad legacy; la cobertura técnica local de R1-07 ya incluye conversación/archivos autenticados, deep links, fallos/reintentos, preservación de drafts y actividad paginada, pero R1 no se cierra hasta completar su checklist y aprobaciones. En paralelo siguen pendientes el cierre formal de G0-05, piloto T1 y signoffs fiscales/jurídicos.
> **Última actualización:** 2026-09-13.
> **Slices locales vigentes:** R1-03/R1-04/R1-05/R1-06/R1-08 están implementadas bajo flags fail-closed; R1-07 tiene paginación de conversación, archivos y actividad, progreso/scan/reintento para staff y portal, drafts preservados, semántica accesible de intención y deep links gated. El expediente V2 incorpora cabecera contextual, acción primaria server-authorized y menú accesible de acciones secundarias, con foco conservado en formularios. No se marca R1 `DONE` hasta cerrar su checklist formal.
> **Responsables:** producto OCPOOL (decisiones de negocio/legal) + Codex (arquitectura, implementación y evidencia).
> **Commit/evidencia:** `8217c5c` + `2f3cc16` + `ee24879` + `5247674` + `f787468` + `499bfd4` + `1d408f7` + `6611299` + `0cc3683`; S0-01 está aplicada como excepción de seguridad y documentada en su ADR, sin activar V2 ni cerrar G0.

## 0. Cómo usar este documento

Este archivo es la fuente operativa única de la iniciativa V2. La especificación define qué producto se busca; la autorrevisión documenta por qué cambió el plan; este archivo decide en qué orden se ejecuta, cómo se verifica y cuál es el siguiente paso.

Documentos normativos:

- `docs/ocpool-commercial-v2/specs/2026-09-10-ocpool-commercial-ux-rearchitecture.md`;
- `docs/ocpool-commercial-v2/reviews/2026-09-10-ocpool-commercial-ux-rearchitecture-review.md`;
- este plan;
- `PROJECT_STATUS.md` como estado general del repositorio.

En caso de contradicción:

1. una decisión/ADR posterior y explícito vence;
2. después este plan V2;
3. después la especificación V2;
4. los documentos históricos sólo explican contexto y no reactivan decisiones reemplazadas.

### 0.1 Reglas de ejecución

- Trabajar directamente en `main`; no crear ramas, worktrees, PR ni workflows de GitHub.
- No publicar producción durante esta iniciativa sin gate y autorización expresos.
- Crear commits lógicos y pequeños por slice verificable.
- Intentar `push origin main` después de cada bloque terminado; si faltan credenciales, documentar el commit pendiente sin alterar Git remoto.
- No mezclar una migración de dominio, un rediseño completo y un cleanup ajeno en un commit gigante.
- Escribir primero spec/ADR, luego prueba roja, implementación mínima, pruebas y documentación.
- No marcar “terminado” por compilar, verse bien o pasar el happy path.
- No tocar la landing. Si un cambio compartido la afecta, la tarea se detiene.
- Preservar trabajo ajeno y no usar operaciones Git destructivas.
- No versionar secretos, `.env`, credenciales, tokens, backups ni datos reales.

### 0.2 Estados de una tarea

| Estado | Significado |
| --- | --- |
| `DISEÑADO` | Existe alcance, pero faltan dependencias/decisiones/evidencia para comenzar |
| `READY` | Cumple Definition of Ready |
| `EN_PROGRESO` | Hay una sola tarea activa con responsable |
| `IMPLEMENTADO` | Código escrito; todavía no equivale a verificado |
| `VERIFICADO_LOCAL` | Unitarias/integración/lint/typecheck/build aplicables pasan |
| `VERIFICADO_E2E` | Navegador, a11y, responsive y negativas pasan |
| `PILOTO_APROBADO` | Usuarios representativos completaron los recorridos y métricas |
| `DESPLEGADO` | Cohorte productiva activada y observada |
| `RETIRADO_LEGADO` | Fallback y contratos antiguos se eliminaron de forma segura |
| `BLOQUEADO` | Falta una decisión/autoridad/entorno que impide progreso real |

Sólo `VERIFICADO_E2E` permite cerrar una slice funcional; `PILOTO_APROBADO` y `DESPLEGADO` son gates posteriores.

### 0.3 Actualización obligatoria al cerrar cada tarea

Registrar aquí:

- estado nuevo;
- commits;
- archivos/migraciones;
- comandos y conteos de pruebas;
- evidencia visual y de rendimiento;
- riesgos/deuda restantes;
- decisión tomada;
- siguiente tarea exacta.

## 1. Norte inmutable

### 1.1 Resultado buscado

OCPOOL debe sentirse como una herramienta que acompaña el trabajo, no como un conjunto de módulos que el usuario tiene que aprender a conectar.

```text
Solicitud
→ revisión guiada
→ información suficiente
→ propuesta en un solo expediente
→ aprobación cuando aplique
→ PDF verificable
→ publicación y aviso
→ decisión del cliente
→ nueva versión sin perder la anterior
→ aceptación
→ handoff real a proyecto
```

### 1.2 Promesa staff

> “El sistema me muestra qué atender y me deja completar el siguiente paso correcto sin perder el expediente.”

### 1.3 Promesa cliente

> “Sé qué ocurrió, quién debe actuar y cuál es la propuesta exacta que puedo revisar.”

### 1.4 No negociables

1. Una intención tiene un espacio principal.
2. Una acción visible debe ser legal para ese actor y estado.
3. Versión interna y versión publicada jamás vuelven a compartir significado.
4. El portal sólo muestra publicaciones deliberadas.
5. Staff, portal, PDF y auditoría muestran el mismo snapshot económico.
6. Documento listo precede a publicación; publicación precede al aviso.
7. La entrega de email se comunica aparte de la publicación.
8. El usuario no maneja códigos internos, centavos ni basis points.
9. Autosave no sacrifica control de concurrencia.
10. Seguridad y trazabilidad no dependen de la UI.
11. La experiencia privada usa tipografía de sistema, logo oficial y jerarquía operacional.
12. La landing queda intacta.

## 2. Alcance, libertad de cambio y límites

### 2.1 Todo lo privado es modificable

Pueden reemplazarse desde cero:

- arquitectura de información;
- rutas privadas;
- componentes y estilos privados;
- contratos API internos;
- servicios de aplicación;
- estados/modelos que hoy mezclan responsabilidades;
- PDF;
- flujos staff, portal y autenticación.

No se conserva una pantalla por apego. Tampoco se reescribe una base segura sin motivo: sesiones, MFA, RBAC backend, PostgreSQL, snapshots, Outbox, auditoría, storage privado e idempotencia se reutilizan o refuerzan.

### 2.2 Fuera de alcance

- cambios a landing, formulario público, fotografías o navegación pública;
- CRM genérico;
- gestión completa de construcción/obra;
- pagos, facturación, proveedores o compras;
- multiempresa;
- WhatsApp/SMS como dependencia del camino crítico;
- microservicios o frontend/backend separados sin evidencia;
- firma electrónica avanzada antes de revisión jurídica.

### 2.3 Decisión técnica ejecutiva

Se mantiene Next.js App Router + TypeScript + Prisma/PostgreSQL como monolito modular. La rearquitectura es profunda en dominio y experiencia, no una migración de stack por moda. Se privilegian Server Components para sesión/primera proyección y pequeñas islas cliente para mutaciones.

## 3. Baseline auditado

### 3.1 Fortaleza existente

- autenticación staff/cliente, sesiones, MFA y recuperación;
- RBAC deny-by-default;
- formulario público persistido, folio e idempotencia;
- solicitudes, asignaciones e historial;
- catálogo/listas/vigencias;
- cálculo monetario con enteros y snapshots;
- mensajería, notas, archivos privados;
- PDF, aceptación, Outbox y notificaciones;
- auditoría, health/readiness y pruebas amplias;
- onboarding manual de cliente.

### 3.2 Bloqueadores P0

| ID | Problema | Riesgo | Primer cierre |
| --- | --- | --- | --- |
| P0-01 | `currentVersionId` mezcla working/published | exposición interna y pérdida de propuesta publicada | S0-01 + migración `20260911093000_quote_working_published_pointers` + D1-01 |
| P0-02 | portal sólo excluye `BORRADOR` | muestra `EN_REVISION` | S0-01 |
| P0-03 | UI y backend tienen mapas distintos | 409 en flujo guiado | S0-03 + D2-01 |
| P0-04 | constructor rehidrata con precio vigente | discrepancia económica | S0-02 |
| P0-05 | Outbox ocurre antes del PDF | propuesta anunciada sin documento | S0-04 + P1; ruta de publicación ya hace preflight local |
| P0-06 | términos elegidos por navegador | evidencia legal débil | S0-04 + D1-04 + C1; control servidor local implementado, texto jurídico BIZ-10 pendiente |
| P0-07 | portal no exige `portal.self.read` | RBAC incompleto | S0-01 |
| P0-08 | PDF trunca alcance/no usa logo | documento comercial incompleto | contención S0-04 + solución P1-02 |

### 3.3 Fricción P1

- no existe shell staff ni logout staff;
- logo/regresos/navegación no son consistentes;
- rutas no representan selección ni tabs;
- Solicitudes y Cotizaciones duplican contexto;
- no existe alta manual de solicitud;
- “Solicitar información” no incluye mensaje ni entrega;
- ventas no puede proponer descuento ni invitar acceso con permiso estrecho;
- no existe scope propio/equipo/global formal;
- catálogo del constructor se limita a 50;
- importes y tasas se capturan de forma técnica;
- no hay autosave, revision ni recuperación de conflicto;
- portal limita la lista y carece de deep links;
- no existe no-leído/prioridad/SLA aunque el plan anterior los prometía;
- datos completos e historiales crecen sin paginación;
- fechas usan zonas distintas.

### 3.4 Deuda P2

- `globals.css` mezcla landing y producto privado;
- títulos privados de hasta 122 px;
- componentes cliente grandes y waterfalls;
- formatters/labels duplicados;
- controles accesibles sin un sistema coherente;
- tests críticos opt-in pueden quedar omitidos;
- notificaciones no enlazan siempre al expediente exacto;
- proyecto existe como estado, no como entidad.

## 4. Decisiones ya fijadas

Estas decisiones no vuelven a abrirse salvo evidencia nueva y ADR:

| ID | Decisión |
| --- | --- |
| DEC-01 | Landing completamente excluida y congelada |
| DEC-02 | Mantener monolito modular Next.js/PostgreSQL |
| DEC-03 | El expediente es la unidad principal de trabajo |
| DEC-04 | `/staff` es centro de trabajo y regreso staff |
| DEC-05 | Cotización se integra en `/staff/requests/[id]?tab=quote` |
| DEC-06 | `/staff/quotes` será redirect/vista compatible, no segundo constructor |
| DEC-07 | Separar working version de published version |
| DEC-08 | La etapa visible se deriva; no es otra máquina mutable |
| DEC-09 | Aprobación, publicación, entrega y aceptación tienen fuentes distintas |
| DEC-10 | `PENDIENTE_DE_APROBACION` actual no se reutiliza para descuento |
| DEC-11 | Abrir/preparar no crea borrador vacío; el primer contenido válido lo crea |
| DEC-12 | Sólo snapshots representan versiones guardadas |
| DEC-13 | Autosave usa revisión optimista; último guardado gana queda prohibido |
| DEC-14 | PDF `READY` y preflight preceden a publicación |
| DEC-15 | El servidor selecciona términos inmutables |
| DEC-16 | Acceso de cliente usa permiso estrecho y automatización idempotente |
| DEC-17 | Concepto especial no contamina catálogo global |
| DEC-18 | Proyecto se oculta hasta tener entidad/ruta/handoff reales |
| DEC-19 | Tipografía privada de sistema; logo oficial; iconografía funcional única |
| DEC-20 | Select/combobox/date/dialog/tabs usan primitivas accesibles de librería |
| DEC-21 | Feature flags server-side existen desde el primer cambio |
| DEC-22 | Migraciones son expand/backfill/contract; no rollback destructivo |

## 5. Decisiones que debe cerrar G0

Cada una tendrá ADR con responsable, fecha, decisión, alternativa descartada e impacto. La recomendación no equivale a aprobación legal/fiscal.

| ID | Decisión | Recomendación segura | Bloquea |
| --- | --- | --- | --- |
| BIZ-01 | Zona de negocio | `America/Chihuahua` sólo si OCPOOL confirma | fechas, vencimiento |
| BIZ-02 | Monedas/precisión | MXN/2 como inicial, allowlist configurable | pricing/PDF |
| BIZ-03 | Perfiles fiscales | perfiles versionados; no tasa libre por defecto | builder/PDF |
| BIZ-04 | IVA incluido/excluido y redondeo | cálculo backend documentado | pricing |
| BIZ-05 | Vigencia predeterminada | policy configurable; sin promesa inventada | builder |
| BIZ-06 | Umbral descuento/override | cualquier descuento requiere aprobación hasta definir umbral | approvals |
| BIZ-07 | Autoaprobación | prohibida; admin override con MFA/motivo | approvals |
| BIZ-08 | Scope de ventas | “mías + sin asignar”; global por permiso | colas/RBAC |
| BIZ-09 | Firmante cliente | contacto principal o autorizado explícito | aceptación |
| BIZ-10 | Términos/privacidad | texto versionado aprobado por jurídico | aceptación/lanzamiento |
| BIZ-11 | Momento de acceso portal | al pedir información o publicar; un correo útil | onboarding |
| BIZ-12 | SLA/prioridad | razones deterministas; SLA sólo tras aprobar tiempos | work center |
| BIZ-13 | Proyecto mínimo | handoff comercial real, no gestión completa de obra | J1 |
| BIZ-14 | Identidad cliente | una organización por usuario por ahora; dedupe administrado | onboarding |

Regla: una decisión no cerrada sólo bloquea su slice. No autoriza inventar defaults irreversibles.

## 6. Arquitectura de experiencia objetivo

### 6.1 Mapa staff

```text
/staff                              Trabajo
/staff/requests                     Solicitudes
/staff/requests/new                 Nueva solicitud
/staff/requests/[requestId]         Expediente
  ?tab=summary|quote|conversation|files|activity
/staff/catalog                      Catálogo y precios
/staff/approvals                    Aprobaciones autorizadas
/staff/projects                     Proyectos reales
/staff/operations/notifications     Operación de entregas
/staff/operations/audit             Auditoría
/staff/settings                     Política comercial
```

Navegación primaria para ventas: Trabajo, Solicitudes. Catálogo aparece en lectura contextual; administración global sólo con permiso. Utilidades técnicas no compiten visualmente con el trabajo comercial.

### 6.2 Mapa portal

```text
/portal
/portal/requests/[requestId]
  ?tab=overview|proposal|messages|files
/portal/access
```

### 6.3 Contrato de regreso

- logo staff → `/staff`;
- “Volver a solicitudes” conserva query, página, orden y scroll mediante return target seguro;
- logo portal → `/portal`;
- browser back reproduce el estado porque la URL es fuente de verdad;
- móvil abre detalle como página completa con volver visible;
- ningún botón “Volver al sitio” sustituye el regreso al dashboard dentro del trabajo autenticado.

### 6.4 Shell privado

Incluye logo, navegación por capacidades, breadcrumbs, título, acción primaria, usuario/rol, logout, estado de sistema y `main#contenido`. Sidebar escritorio y drawer móvil comparten el mismo modelo de navegación.

## 7. Contrato de dominio resumido

### 7.1 Ownership

| Verdad | Dueño |
| --- | --- |
| captación/calificación | `QuoteRequest` |
| edición/revisión interna | `Quote.workingVersionId` |
| propuesta del cliente | `Quote.publishedVersionId` + `QuotePublication` |
| importes/contenido | snapshots de versión/líneas |
| aprobación | `QuoteApproval` |
| documento | `GeneratedDocument` |
| entrega | `NotificationDelivery` |
| términos | `CommercialTermsVersion` |
| aceptación | `QuoteAcceptance` |
| handoff | `Project` |
| presentación/acciones | resolver puro |

### 7.2 Ciclo objetivo

Solicitud:

```text
RECIBIDA → EN_REVISION ↔ INFORMACION_REQUERIDA
         → LISTA_PARA_COTIZAR
         → RECHAZADA | CONVERTIDA_EN_PROYECTO
```

Versión:

```text
BORRADOR → EN_REVISION → LISTA_PARA_PUBLICAR → PUBLICADA
                    ↘ BORRADOR                ↘ REEMPLAZADA
                                                ACEPTADA
                                                RECHAZADA
                                                VENCIDA
```

La negociación es una etapa derivada de un cambio solicitado/conversación, no una copia manual en solicitud y versión.

### 7.3 Tabla mínima de etapa/acción

| Señal | Etapa | Actor | Acción primaria |
| --- | --- | --- | --- |
| nueva, libre | Nueva solicitud | staff | Tomar y revisar |
| revisando | En revisión | staff | Completar revisión |
| mensaje de información pendiente | Información incompleta | staff | Escribir y solicitar |
| mensaje enviado | Esperando cliente | cliente | ninguna para staff; recordar secundario |
| cliente respondió | Respuesta recibida | staff | Revisar respuesta |
| lista, sin borrador | Preparar propuesta | staff | Agregar primer concepto |
| borrador | Propuesta en borrador | staff | Enviar a revisión |
| aprobación requerida | Esperando aprobación | manager | Resolver aprobación |
| PDF falló | Documento requiere atención | staff/system | Reintentar preparación |
| preflight listo | Lista para publicar | staff | Revisar y publicar |
| publicada, delivery queued | Publicada; aviso en cola | system | ninguna |
| delivery failed | Publicada; aviso falló | staff | Reintentar aviso |
| cliente pide cambios | Cambios solicitados | staff | Crear revisión |
| revisión nueva | Preparando cambios | staff | Continuar revisión |
| publicada vigente | Esperando decisión | cliente | aceptar/pedir cambios |
| vencida | Propuesta vencida | staff | Crear nueva versión |
| aceptada | Aceptada | staff | Iniciar handoff si está habilitado |

### 7.4 Acciones proyectadas

Toda proyección incluye:

```ts
stage
stageLabel
actorExpected
waitingSince
primaryAction
secondaryActions
blockers
workingVersion
publishedVersion
documentStatus
deliveryStatus
```

La UI no declara `NEXT_STATUS_OPTIONS`, no calcula permisos desde roles y no muestra una acción sin token/capability de servidor.

## 8. Matriz RBAC objetivo

| Acción | Sales | Manager | Admin | Customer |
| --- | :---: | :---: | :---: | :---: |
| leer propio/sin asignar | ✓ | ✓ | ✓ | — |
| leer global | por permiso | ✓ | ✓ | — |
| tomar libre | ✓ | ✓ | ✓ | — |
| reasignar ajeno | — | ✓ | ✓ | — |
| solicitud manual/edición | ✓ scope | ✓ | ✓ | — |
| invitar cliente | ✓ estrecho | ✓ | ✓ | — |
| crear/editar draft | ✓ scope | ✓ | ✓ | — |
| concepto especial | ✓ | ✓ | ✓ | — |
| proponer descuento/override | ✓ | ✓ | ✓ | — |
| aprobar propio | — | — | override | — |
| aprobar ajeno | — | ✓ | ✓ | — |
| publicar listo | ✓ scope | ✓ | ✓ | — |
| catálogo/precios/policy manage | — | ✓ | ✓ | — |
| operar deliveries | — | ✓ | ✓ | — |
| ver/actuar portal propio | — | — | — | ✓ |
| crear proyecto aceptado | ✓ scope | ✓ | ✓ | — |

Permisos nuevos: `requests.read.global`, `requests.claim`, `requests.reassign`, `requests.edit`, `customer.portal.invite`, `quotes.discount.request`, `quotes.price_override.request`, `quotes.approval.resolve`, `quotes.approval.override`, `quotes.publish`, `projects.create`, `projects.read`, `projects.manage`.

## 9. Estrategia de entrega

### 9.1 Orden por valor y dependencia

```text
G0 Gobierno/baseline
 └─ S0 Contención P0
     └─ D1 Modelo e invariantes
         └─ D2 Comandos/proyecciones
             └─ U1 Sistema privado/shell/auth
                 ├─ R1 Expediente/solicitudes ─┐
                 └─ K1 Catálogo/policy ────────┴─ Q1 Constructor
                                                   └─ A1 Aprobaciones
                                                       └─ P1 PDF/publicación
                                                           └─ C1 Portal/aceptación
                                                               ├─ W1 Centro de trabajo ──────────────┐
                                                               └─ J1 Proyecto/handoff (condicional) ─┴─ H1 Hardening
                                                                                                         └─ T1 Piloto
                                                                                                             └─ O1 Rollout/legado
```

U1 puede avanzar en paralelo con D2 sólo después de fijar contratos. Ninguna UI de publicación se implementa antes de P0/D1.

### 9.2 Feature flags desde el inicio

| Flag | Controla | Default |
| --- | --- | --- |
| `commercialWorkspaceV2` | shell y navegación V2 | off |
| `requestWorkspaceV2` | expediente/rutas V2 | off |
| `quoteBuilderV2` | constructor V2 | off |
| `quoteApprovalV1` | aprobación | off |
| `quotePublicationV2` | saga/preflight/publicación | off |
| `portalTimelineV2` | portal V2 | off |
| `projectHandoffV1` | proyecto/handoff | off |
| `commercialTelemetry` | medición por variante, sólo después de aprobar retención | off |

Reglas:

- evaluación server-side;
- cohorte estable por usuario/rol, nunca query param confiado;
- kill switch documentado;
- ruta/API anterior conservada durante transición;
- métricas etiquetadas por variante;
- fecha/condición de retiro registrada;
- flags no evitan autorización backend.

### 9.3 Migración

1. **Expand:** agregar columnas/tablas/índices nullable y contratos nuevos.
2. **Backfill:** reconciliar datos con reporte, sin decidir silenciosamente casos ambiguos.
3. **Dual-read/dual-write acotado:** sólo donde sea indispensable y con telemetría.
4. **Switch:** activar nueva lectura por flag y cohorte.
5. **Contract:** retirar campos/estados/endpoints antiguos después de dos ventanas estables.

No se intenta revertir operaciones confirmadas como publicación, aceptación o auditoría. Los fallos de datos se corrigen hacia adelante.

### 9.4 Rollback por capa

- UI: apagar flag y volver a ruta anterior.
- Routing: redirect controlado al fallback.
- API: conservar contrato anterior mientras haya consumidores.
- Datos: expand/backfill evita downgrade destructivo.
- Eventos: conservar Outbox y deduplicar reintentos.
- Publicaciones/aceptaciones: nunca “desenviar” o borrar evidencia.
- Migración incompatible: detener rollout y aplicar forward fix.

### 9.5 Umbrales de stop automático

Detener activación ante cualquiera de estos hechos:

- versión interna visible a cliente;
- borrador/publicación/email/aceptación duplicados;
- total distinto entre staff, portal y PDF;
- estado imposible o punteros working/published incoherentes;
- acceso cruzado o permiso omitido;
- publicación reportada sin PDF listo;
- éxito reportado sin Outbox/receipt esperado;
- pérdida silenciosa de draft;
- error crítico/serio Axe;
- regresión de landing;
- error rate o latencia superior al presupuesto aprobado.

## 10. G0 — Gobierno, decisiones y baseline

**Objetivo:** transformar la auditoría en contratos cerrados, métricas reproducibles y un entorno donde cada slice pueda demostrarse.
**Entrada:** spec/review V2 y código actual.
**Salida:** ADRs, fixtures, flags, baseline de landing/privado y decisiones de negocio.
**Estado:** `EN_PROGRESO`; antes del gate sólo se autorizan documentación, fixtures, medición e infraestructura inerte de flags/QA. No se modifica todavía el comportamiento funcional, el schema ni la UI del producto.

### G0-01 — Contrato canónico de ciclo comercial

**Estado:** `APPROVED_LOCAL_PRODUCT`; el cierre formal queda registrado en el artefacto de aceptación de G0.
**Propósito:** fijar ownership, estados alcanzables y efectos por evento antes de diseñar acciones.

**Archivos previstos:**

- crear `docs/adr/2026-09-10-commercial-lifecycle-v2.md`;
- crear `tests/fixtures/commercial-workflow-v2.ts` como tabla de verdad machine-readable, sin conexión al runtime;
- crear `tests/unit/commercial-workflow-contract.test.ts` para validar completitud y consistencia del fixture;
- incluir en el ADR un índice nominal de contratos legacy reemplazados; los documentos históricos permanecen inmutables.

**Trabajo:**

1. Inventariar todos los estados persistidos de solicitud, versión, política/términos, aprobación, documento, publicación, entrega, aceptación y proyecto.
2. Enumerar cuáles son alcanzables hoy y por qué comando.
3. Definir tabla `evento → precondición → entidad mutada → auditoría → outbox → etapa visible`.
4. Fijar el ciclo objetivo descrito en §7.
5. Declarar mapeo temporal de estados legacy y reglas de reconciliación.
6. Escribir fixtures de combinaciones válidas/inválidas y propiedad de la acción, sin introducir todavía el resolver productivo.

**Pruebas mínimas:**

- cada estado objetivo es alcanzable;
- ninguna combinación válida carece de etapa;
- cada combinación inválida produce bloqueo/diagnóstico, no acción inventada;
- `PENDIENTE_DE_APROBACION` no significa descuento;
- vencida permite nueva working version sin reabrir una versión inmutable;
- una publicación previa continúa siendo visible durante una nueva revisión.

**Resultado técnico:** ADR propuesto, tabla exhaustiva, fixture validable y pruebas de contrato verdes; los casos funcionales quedan trazados a las pruebas rojas de D1/D2 sin dejar `main` fallando.

**Cierre pendiente:** el responsable de producto debe registrar `APPROVED` o `REJECTED` en el artefacto de aceptación de G0. Mientras no exista esa decisión, G0-01 no se considera cerrado aunque esté `VERIFICADO_LOCAL`.

**Paquete READY de G0-01:**

- **Owner:** Codex/arquitectura; **aprobador:** responsable de producto OCPOOL; **fecha de preparación:** 2026-09-10.
- **Objetivo de usuario:** que cada actor vea una etapa y una siguiente acción coherentes a partir de una sola verdad comercial.
- **Baseline:** máquinas actuales y P0-01…P0-08 del §3; métrica inicial = combinaciones inventariadas, alcanzables, ambiguas y sin proyección.
- **Alcance:** ADR, inventario, tabla de verdad, fixture validable y referencias de supersesión. **No alcance:** schema, resolver runtime, UI, migración o cambio de comportamiento.
- **Dependencias cerradas:** spec V2, autorrevisión V2 y evidencia P0. BIZ-01…BIZ-14 se referencian como parámetros y no se adivinan.
- **Actores/scope/permisos:** sales, manager, admin, customer y system se modelan en el fixture; no se modifica RBAC.
- **API/eventos/datos:** se documentan contratos actuales/objetivo, locks, idempotencia, auditoría y Outbox; no se persiste ni migra nada.
- **UX:** sin wireframe; sí exige nombres humanos de etapa, actor esperado, acciones y bloqueos. Estados visuales no aplican hasta U1/R1.
- **Presupuestos:** a11y, responsive y bundle no aplican porque no existe UI/runtime; el test de contrato debe completar en menos de 1 s sobre el fixture base y no hacer IO externo.
- **Pruebas:** contrato del fixture verde; matrices funcionales asignadas a D1/D2 como futuras pruebas rojas, sin skips críticos ni fallo deliberado en `main`.
- **Flag/fallback/rollback:** no aplica al runtime; retirar el ADR/fixture revierte sólo documentación, pero una aprobación posterior se corrige mediante ADR nuevo, no reescritura silenciosa.
- **Archivos exactos:** únicamente los tres archivos previstos; el índice de supersesión vive dentro del ADR y no modifica documentos históricos.
- **Stop conditions:** entidad sin owner, transición sin comando, combinación ambigua, decisión BIZ irreversible implícita o contradicción sin resolver.
- **Cierre medible:** 100% de estados/comandos actuales inventariados; 100% de combinaciones objetivo del fixture con etapa, actor, acción/bloqueo y efectos; 0 duplicados/huérfanos; aprobador y evidencia registrados conforme al protocolo Gate G0.

### G0-02 — Política comercial, fiscal, scope y legal

**Estado:** `BLOQUEADO_PARCIAL`; las decisiones de producto ya están registradas, pero BIZ-03, BIZ-04, BIZ-09 y BIZ-10 requieren fiscal/jurídico.
**Propósito:** cerrar BIZ-01…BIZ-14 sin defaults ocultos.

**Entregable:** `docs/adr/2026-09-10-commercial-policy-v1.md` con:

- timezone;
- monedas y precisión;
- perfiles/impuestos/redondeo;
- vigencia;
- descuentos, overrides y autoaprobación;
- scope sales/manager;
- firmante autorizado;
- momento de onboarding;
- términos/privacidad;
- SLA/prioridad;
- definición de proyecto;
- identidad cliente.

**Regla:** si jurídico/fiscal no resuelve términos o impuestos, sus slices quedan bloqueadas y la UI no presenta aceptación/publicación como lista.

**Done:** cero `TBD` capaz de cambiar esquema, dinero, permiso o evidencia legal de la siguiente slice.

### G0-03 — Baseline de tareas y datos

**Estado:** `VERIFIED_LOCAL_PARTIAL`; matriz y reglas de medición verificadas localmente, flujos críticos 3/3 y matriz autenticada ampliada 17/17 (incluye catálogo/precios). La cobertura repetida reúne 65 registros PII-safe (`13 métricas × n=5`) de solicitud pública, solicitudes, cotizador, portal y notificaciones. Los objetivos de §29 están aprobados localmente; falta el piloto T1 con usuarios reales y el cierre formal del Gate G0.
**Propósito:** medir el problema actual y crear datasets representativos.

**Trabajo:**

- grabar recorridos actuales de ventas, gerencia y cliente;
- medir tiempo, acciones, retrocesos, errores y ayuda requerida;
- fixtures: solicitud nueva, espera cliente, borrador, aprobación, PDF fallido, delivery fallido, cambio, vencida, aceptada;
- volúmenes: 10k solicitudes, 5k conceptos, 100 versiones por expediente, 100 líneas por PDF;
- anonimizar toda evidencia;
- definir eventos de producto y diccionario de métricas.

**Métricas baseline:** confirmación de solicitud pública, tiempo a siguiente tarea,
solicitud→draft, agregar 10 conceptos, publicar, resolución de aprobación,
recuperación de PDF, recuperación de entrega, nueva versión desde publicada,
vencida→siguiente paso, acceso→decisión, errores y abandonos.

**Entregables creados:**

- `docs/adr/2026-09-10-commercial-g0-baseline.md`;
- `tests/fixtures/commercial-baseline-v2.ts`;
- `tests/unit/commercial-baseline-contract.test.ts`.

El fixture ya valida registros sintéticos de medición
(`validateBaselineMeasurementRecord`): 13 campos requeridos, dimensiones
conocidas, tiempos no negativos y rechazo recursivo de PII. Esto prepara la
captura autenticada, pero no inventa datos ni objetivos de producto. El recorrido
opt-in usa `commercial-baseline-recorder.ts` para guardar sólo muestras
sintéticas bajo `test-results/` cuando se solicita explícitamente. Las corridas
más recientes pasaron la suite pública `35/35`, portal + cotizador `3/3`,
notificaciones `1/1` y solicitudes `1/1`. Las repeticiones en builds frescos
pasaron cotizador `1/1` y portal `4/4`, y registraron trece tipos de medición
sin PII: `public_request_to_confirmation=4,368 ms`,
`portal_access_to_decision=1,212 ms`, `request_to_draft=7,368 ms`,
`add_ten_concepts=1,015 ms`, `publish_quote=6,667 ms`,
`document_failure_to_recovery=1,251 ms`, `delivery_failure_to_recovery=96 ms`,
`request_to_next_task=715 ms`, `published_to_new_working=242 ms`,
`draft_to_approval_resolution=1,694 ms` y `workflow_errors=1,212 ms` con un
error recuperable. La repetición final del portal pasó `4/4` en build fresco y
añadió `expired_quote_to_next_step=347 ms` y
`workflow_abandonment=256 ms` con `abandoned=true`.
Son evidencia del instrumento y de los recorridos actuales, no objetivos ni
una muestra suficiente para cerrar el gate en esa corrida.

La actualización del 2026-09-11 completó la muestra mínima reproducible local:
65 registros PII-safe (`13 métricas × n=5`) de corridas independientes con
fixtures desechables. El ADR [`2026-09-11-commercial-g0-03-objectives.md`](../../adr/2026-09-11-commercial-g0-03-objectives.md)
aprueba localmente los objetivos de §29 y conserva la separación entre
guardrail sintético, piloto real y aceptación formal. La muestra mínima está
verificada; no equivale a significancia estadística ni autoriza producción.

**Evidencia local:** la matriz cubre ocho superficies (landing pública y siete
privadas), tres viewports, diez escenarios, trece métricas, reglas de telemetría sin PII y los cuatro
perfiles de volumen definidos. La inspección Chromium existente queda marcada
como anónima/restringida; no se presenta como medición autenticada.

**Pendiente de cierre:** ejecutar el piloto T1, enlazar los objetivos con
pruebas U1/R1/D1/D2 y cerrar el gate formal junto con los signoffs externos.
Hasta entonces G0-03 no está cerrado y no autoriza instrumentar producción.

El bloqueo de dominio de aprobación ya tiene un cierre local parcial: la
migración `20260911090000_quote_approvals` persiste `QuoteApproval`, el servicio
calcula digest del snapshot, la API permite solicitar/resolver y el envío exige
una aprobación `APPROVED` vigente. La integración cubre idempotencia,
autoaprobación, snapshot obsoleto y envío final. `draft_to_approval_resolution`
continúa fuera del baseline aprobado hasta que producto fije objetivos y cierre
BIZ-06/BIZ-07; no se activa por flag ni se presenta como evidencia productiva.

### G0-04 — Arquitectura visual, prototipo y librerías

**Estado:** `VERIFICADO_LOCAL_APPROVED`; inventario, baseline estático, prototipo CSR/SSR aislado y repetición Next.js anónima registrados; locale SSR y primitives por patrón aprobados localmente con autorización humana explícita.
**Propósito:** validar el sistema privado antes de replicarlo.

**Trabajo:**

1. Wireframes de 360, 768 y 1440 px para shell, work center, expediente, builder, preflight, portal y auth.
2. Prototipo navegable de estos cinco recorridos críticos con copy realista:
   1. solicitud nueva → calificar → pedir/recibir información;
   2. solicitud lista → borrador → revisión/aprobación → PDF → publicación;
   3. acceso cliente → expediente → descargar → pedir cambios → nueva working sin perder publicada;
   4. propuesta vigente → aceptación exacta → handoff a proyecto o final comercial explícito;
   5. recuperación de PDF, delivery o conflicto de edición fallido sin duplicar ni perder trabajo.
3. Spike de `react-aria-components` para Select, async ComboBox, DatePicker, Dialog y Tabs.
4. Spike de `lucide-react` con imports individuales.
5. Medir SSR/hidratación, teclado, lector de pantalla básico, bundle y CSS.
6. Registrar ADR: adopción o fallback único (`Radix + react-day-picker`) con fecha de retiro; jamás mezcla arbitraria.

**Presupuesto del spike:**

- cero error de hidratación/consola;
- navegación completa por teclado;
- focus trap/restore correcto;
- locale `es-MX`;
- incremento gzip fijado tras medir y aprobado en ADR;
- no cargar la librería en landing.

**Entregable inicial:** `docs/adr/2026-09-10-private-ui-primitives.md` fija el
inventario actual, la regla de no mezcla, los criterios de comparación y el
baseline obtenido por `npm run spike:private-primitives`. El prototipo aislado
versionado en `spikes/private-primitives-react-aria/` ya cubre interacción,
teclado, focus restore, responsive, Axe y un smoke SSR/hidratación aislado; no se
añadieron dependencias al root ni se cambió la UI privada mientras faltan la
revisión sobre Next.js y la decisión aprobada.

**Done local:** sistema elegido por patrón, locale privado SSR, tokens/wireframes del spike y matriz de estados aprobados. Las futuras pantallas privadas deben conservar esta familia y cualquier excepción requiere ADR.

### G0-05 — Flags, gate local, navegador y congelación de landing

**Estado:** `EN_PROGRESO`; flags fail-closed, gate local técnico, congelación/hash de landing y baseline comercial mínimo implementados; objetivos locales y primitives/locale aprobados, mientras el piloto T1 y los signoffs externos permanecen pendientes.
**Archivos previstos:** módulo de flags server-side, fixtures E2E, scripts de gate y baseline visual.

**Trabajo:**

- implementar flags §9.2 apagadas por defecto;
- registrar variante en logs/métricas sin PII;
- instalar/fijar navegador Playwright reproducible;
- crear `scripts/quality-gate-v2.mjs` y el comando `npm run test:v2:gate` como autoridad reproducible local y consumible por cualquier runner futuro;
- separar suite premium requerida de suites realmente opcionales;
- hacer fallar ese gate si una suite crítica se omite; no crear workflows de GitHub ni asumir una plataforma CI inexistente;
- crear screenshots/hash de landing en breakpoints y recorridos actuales;
- documentar kill switch y fallback antes de activar cualquier flag.

**Implementado en G0:**

- `src/server/flags/commercial-v2.ts` con aprobación global explícita y flags
  individuales apagadas por defecto;
- `tests/unit/commercial-v2-flags.test.ts` con cobertura de bypass, valores no
  canónicos y contrato de nombres;
- `scripts/quality-gate-v2.mjs` y `npm run test:v2:gate`, que ejecutan las
  verificaciones técnicas y terminan con `BLOCKED` mientras falten signoffs,
  baseline comercial autenticado, cierre SSR/hidratación de primitives y signoffs
  finales; el hash/rollback de landing ya está documentado.
- `scripts/commercial-baseline-browser.mjs` y `npm run baseline:v2:browser`,
  recorrido anónimo reproducible de ocho superficies en tres viewports; pasó
  24/24 combinaciones con Chromium ejecutable en `/var/tmp`. La caché
  predeterminada permanece `noexec`, por lo que el runner debe conservar una
  ruta ejecutable explícita.
- `scripts/commercial-baseline-http.mjs` y `npm run baseline:v2:http`,
  comprobación complementaria de diez rutas, headers y status sin navegador.
- `scripts/landing-freeze.mjs` y `npm run baseline:v2:landing`, que
  registran hashes HTML/capturas en 390, 768 y 1440 px y documentan el rollback
  fail-closed sin modificar la landing.

El gate no se conecta a ninguna pantalla, no activa telemetría y no cambia la
landing. Un estado `BLOCKED` es intencional y distinto de una prueba omitida.

**Done:** flags probadas, navegador reproducible, gate local determinista y landing protegida.

### Gate G0

- [ ] ADR de ciclo aprobado.
- [ ] BIZ-01…BIZ-14 decididos o la slice afectada explícitamente bloqueada.
- [ ] baseline y fixtures reproducibles.
- [ ] prototipo probado con al menos un representante por rol o revisión formal equivalente.
- [ ] librería/primitivas decididas por ADR.
- [ ] flags y rollback disponibles.
- [ ] landing congelada.
- [ ] ninguna decisión estructural relevante permanece implícita.

**Protocolo de aprobación:** registrar cada casilla en `docs/adr/2026-09-10-commercial-v2-g0-acceptance.md` con owner, aprobador, fecha UTC, resultado `APPROVED|REJECTED|BLOCKED` y enlace/ruta de evidencia. El responsable de producto aprueba política, copy y recorridos; ingeniería aprueba invariantes, migración, pruebas y rollback; jurídico/fiscal aprueba sólo sus ámbitos. “Revisión formal equivalente” significa un walkthrough documentado contra el mismo checklist con decisión explícita; silencio, ausencia de objeciones o una captura aislada no cuentan como sign-off.

## 11. S0 — Contención inmediata de P0

**Objetivo:** impedir que el producto actual exponga contenido interno, represente importes incorrectos u ofrezca acciones imposibles mientras se construye V2.
**Feature flag:** correcciones de seguridad/integridad no dependen de flag; cambios de experiencia sí.
**Rollback:** forward fix para datos/seguridad; UI mediante fallback.
**Gate de entrada:** Gate G0 completo. Una decisión legal/fiscal no resuelta puede dejar bloqueada sólo la tarea que dependa de ella, siempre que G0 registre dueño, impacto y no-go explícitos; nunca se usa un default inventado.

**Excepción ejecutada:** S0-01 se aplicó como contención de seguridad/integridad
independiente de decisiones comerciales. No cierra G0, no activa V2 y no autoriza
las tareas S0 restantes.

### S0-01 — Visibilidad publicada y permiso portal

**Estado:** `VERIFICADO_LOCAL`; ver [ADR de contención](../../adr/2026-09-10-s0-01-legacy-portal-visibility.md).

**Archivos principales:**

- `src/server/modules/client-portal/service.ts`;
- `src/server/auth/customer.ts`;
- `src/server/modules/quote-documents/access-service.ts`;
- `src/server/modules/quote-documents/acceptance-service.ts`;
- pruebas unitarias/integración/E2E portal.

**Cambios:**

- exigir `portal.self.read`;
- excluir `BORRADOR` y `EN_REVISION` de toda proyección cliente;
- mientras no exista `publishedVersionId`, derivar de forma conservadora la última versión realmente enviada/publicada;
- no usar `currentVersionId` para aceptar/descargar si apunta a working interna;
- impedir acceso a documento/version de otro cliente;
- proyectar `pdfReady` sin filtrar estados internos y no mostrar botones si el
  documento privado no es elegible.
- validar la notificación de aceptación contra el `QuoteAcceptance` exacto,
  nunca contra el puntero mutable de working.

**Casos de prueba:** nueva review sobre versión enviada, cliente A/B, customer sin permiso, UUID inválido, versión reemplazada, PDF ausente, sesión expirada.

**Done:** cero versión interna visible; la última propuesta publicada sigue disponible y el permiso es obligatorio.

### S0-02 — Fidelidad del snapshot financiero

**Estado:** `IMPLEMENTADO_LOCAL`; el cierre cross-surface y la activación siguen sujetos al Gate G0/S0.

**Archivos principales:** `StaffQuotesPanel.tsx`, `quotes/staff-service.ts`, serializers y tests.

**Cambios:**

- rehidratar cantidad, precio aplicado, descuento, impuesto, moneda y total desde la línea snapshot;
- distinguir precio base, override y display;
- impedir repricing al abrir/cambiar lista en versión no editable;
- ocultar edición de versiones inmutables;
- comparar staff/portal/PDF byte-for-data en fixtures.

**Implementación local verificada:** el constructor hidrata el precio aplicado desde
la línea persistida, muestra el importe en unidad mayor y sólo lo cambia cuando el
operador edita explícitamente el campo. La E2E modifica el precio vigente del
catálogo después de crear el borrador y confirma que la versión existente y su
nueva versión conservan `150.00`; pasó 1/1 sin overflow, Axe serio ni errores de
consola. La comparación completa staff/portal/PDF y la matriz de versiones
inmutables siguen pendientes para cerrar el gate.

**Done:** el total y cada línea son idénticos en staff, portal y PDF aunque cambie catálogo/precio.

### S0-03 — Acciones legales desde servidor

**Estado:** `IMPLEMENTADO_LOCAL`; la matriz completa de acciones y el cierre del
gate siguen pendientes.

**Archivos principales:** dominio de solicitudes/cotizaciones, capabilities, componentes staff y tests.

**Cambios:**

- retirar mapas frontend divergentes como autoridad;
- proyectar acciones conservadoras desde backend;
- ocultar/deshabilitar transición sin permiso/precondición;
- mostrar bloqueo humano y `requestId` en conflicto real;
- testear cada botón visible contra endpoint exitoso o negativa deliberada reproducible.

**Implementación local verificada:** el detalle de solicitudes ahora proyecta desde
servidor `availableStatusTransitions` y `availableActions`, calculados con estado,
permisos y precondiciones. La UI consume esa proyección para el selector de estado y
para mostrar `Abrir constructor`, sin conservar un mapa frontend de transiciones.
La integración dirigida de staff pasó 7/7 pruebas y la E2E de solicitudes pasó 1/1,
incluyendo transición a `INFORMACION_REQUERIDA`, Axe serio, responsive 390/768/1440
y consola limpia.

**Done:** 100% de acciones renderizadas son ejecutables; cero `409` esperado en camino guiado.

### S0-04 — PDF antes de aviso y términos server-owned

**Estado:** `IMPLEMENTADO_LOCAL_PARTIAL`; preflight y términos server-owned están
contenidos localmente, pero PDF completo, texto jurídico y recuperación operativa
siguen pendientes.

**Archivos principales:** `quotes/service.ts`, `quote-documents/domain.ts`, `quote-documents/service.ts`, acceptance, templates, tests.

**Cambios de contención:**

- permitir preparar PDF desde revisión congelada;
- requerir documento `READY` antes de transición/publicación actual;
- si se vuelve a borrador, invalidar de forma segura documento/preflight previo;
- no emitir `QUOTE.SENT` antes de documento listo;
- seleccionar términos en servidor; si no existe versión activa aprobada, bloquear aceptación;
- eliminar el truncado silencioso del alcance disponible, usar el logo oficial y probar paginación con texto/líneas extensos; la plantilla comercial estructurada completa permanece en P1-02 porque requiere D1;
- recuperar documentos `PENDING` abandonados mediante lease o reconciliación.

**Done:** ninguna notificación anuncia propuesta sin PDF; navegador no elige términos; el PDF actual no omite alcance silenciosamente ni sustituye el logo por iniciales/texto; reintento no duplica.

**P0-08 corregido localmente:** la plantilla `quote-pdf-v2` embebe el logo oficial
de OCPOOL y pagina todo el alcance, sin `slice` ni pérdida silenciosa de texto.
La prueba del renderer cubre cuatro casos, incluida una descripción de 180
segmentos que fuerza páginas adicionales; la generación/descarga/aceptación real
pasó en las integraciones dirigidas y el E2E del constructor continuó en 1/1.

### Gate S0

- [ ] las contenciones de P0-01…P0-08 se volvieron verdes; P0-08 conserva trazabilidad explícita hacia la plantilla completa P1-02;
- [ ] portal EN_REVISION negativa E2E;
- [ ] snapshot cross-surface verificado;
- [ ] acciones visibles/endpoints matriz completa;
- [ ] send/PDF/order y términos negativos verificados;
- [ ] seguridad IDOR/RBAC y landing regression verdes;
- [ ] no se introdujo esquema legacy nuevo.

## 12. D1 — Modelo, invariantes y migración V2

**Objetivo:** representar explícitamente working, publicación, aprobación, términos y concurrencia.
**Flag:** `quotePublicationV2` y `quoteApprovalV1` off.
**Migración:** expand/backfill/contract; jamás eliminar campos en esta fase.

### D1-01 — Working y published version

**Schema objetivo:**

- `Quote.workingVersionId` nullable/unique;
- `Quote.publishedVersionId` nullable/unique;
- FK/constraint que cada puntero pertenezca a la misma quote;
- `QuoteVersion.publishedAt`, `supersededAt`, `revision`, `contentDigest`;
- estados `LISTA_PARA_PUBLICAR`, `PUBLICADA`, `REEMPLAZADA` o equivalencia exacta definida por ADR.

**Backfill:**

- BORRADOR/EN_REVISION más reciente → working;
- ENVIADA/EN_NEGOCIACION/ACEPTADA/RECHAZADA/VENCIDA elegible → published según reglas deterministas;
- ambigüedades → reporte y cuarentena, nunca elección silenciosa;
- conservar `currentVersionId` para dual-read temporal.

**Pruebas:** constraints, carrera de creación, una working activa, publicación previa estable, backfill idempotente, rollback de código.

### D1-02 — Snapshot comercial completo

**Campos/modelos:**

- `QuoteVersion.sourcePriceListId`, `validThrough` como fecha comercial, `termsVersionId`;
- `QuoteSectionSnapshot` con posición/título/descripción;
- línea con `position`, `sectionId`, `catalogItemId?`, `baseUnitPriceMinor`, `unitPriceMinor`, `overrideReason`, tax profile snapshot;
- contenido estructurado: alcance, exclusiones, pago, garantías y notas publicables.

**Invariantes:** posiciones únicas por versión; suma backend; currency consistente; concepto especial explícito; versión publicada inmutable.

### D1-03 — Concurrencia e idempotent command receipts

**Modelo/contrato:** `revision` condicionada y, si el análisis lo justifica, `IdempotentCommand`/receipt con actor, command, aggregate, key hash, payload hash y response snapshot.

**Pruebas:** dos pestañas, retry misma carga, misma llave distinta carga, timeout después de commit, creación concurrente de primer borrador.

### D1-04 — Política, impuestos y términos versionados

**Modelos:** `CommercialPolicyVersion`, `TaxProfileVersion`, `CommercialTermsVersion` o schemas versionados equivalentes aprobados en ADR.

**Reglas:** activos inmutables; cambio crea versión; quotes capturan IDs/hashes; moneda/precisión/timezone centralizados; términos no editables después de uso.

### D1-05 — Aprobación y publicación

**Modelos:**

- `QuoteApproval`: tipo, version/revision/digest, policy, requester/resolver, status, reason, timestamps;
- `QuotePublication`: version, document, terms, preflight digest, recipient snapshot cifrado/hash, status, publishedAt, outbox reference;
- relación consultable con `NotificationDelivery` sin duplicar su máquina de entrega.

**Constraints:** una approval activa por tipo/digest; una publication por versión; documento/términos/version mismo agregado; recipient nunca en claro en logs.

### D1-06 — Integridad cliente/agregado

Agregar/verificar constraints o triggers equivalentes:

- contacto pertenece al client de solicitud;
- usuario/contacto comparten client;
- version pertenece a quote de puntero;
- documento pertenece a misma version/quote;
- aceptación pertenece a mismo documento/version/quote;
- totales materializados coinciden con líneas en comandos y reconciliación.

### D1-07 — Limpieza semántica de request status

- dejar `QuoteRequest` como captación/calificación;
- retirar el puente `PENDIENTE_DE_APROBACION` de aceptación;
- dejar de escribir copias de publicación/negociación/vencimiento;
- mantener read mapper legacy durante transición;
- no eliminar enum/columnas hasta O1.

### Gate D1

- [ ] migración expand ensayada en copia/restauración;
- [ ] backfill idempotente con reporte cero ambiguo o resolución documentada;
- [ ] invariantes DB + servicio cubiertas;
- [ ] S0 sigue verde;
- [ ] dual-read/fallback probado;
- [ ] ninguna versión publicada se pierde durante nueva working;
- [ ] plan de contract migration diferido a O1.

## 13. D2 — Comandos, resolver y proyecciones

**Objetivo:** ofrecer una API de intenciones comerciales, no CRUD de estados.

### D2-01 — Resolver puro de etapa/acción/bloqueo

Crear un resolver sin IO que reciba request, working, published, approval, document, delivery, conversation/read state, project y actor capabilities.

**Salida:** §7.4 con catálogo cerrado de stages/actions/blockers.

**Cobertura:** tabla combinatoria; mutation testing o property-based cases donde aporte valor; cada acción proyectada tiene comando existente.

### D2-02 — Scope y capabilities

- implementar permisos §8;
- sales default “mías + sin asignar”; global sólo con permiso;
- `claim` distinto de `reassign`;
- assignee debe ser empleado activo con permiso operativo;
- `customer.portal.invite` separado de identidad admin;
- proyección de navegación y acciones desde permisos/scope.

### D2-03 — Comandos de solicitud

Implementar:

- `createStaffRequest` con dedupe;
- `claimRequest` y `reassignRequest`;
- `updateRequestProfile` con before/after seguro;
- `requestInformation` que exige mensaje y coordina estado, portal y notificación;
- `markInformationReviewed`;
- `startQuotePreparation` sin draft vacío.

Cada comando: schema estricto, same-origin, lock, idempotencia, auditoría y error codes tipados.

### D2-04 — Comandos de cotización

Implementar:

- `saveQuoteDraft(expectedRevision)`;
- `submitQuoteForReview`;
- `returnQuoteToDraft` con invalidación;
- `clonePublishedVersion`;
- `requestApproval`/`resolveApproval`;
- `preparePublication`/`publishQuote`;
- `requestChange`/`expire`/`accept`.

No exponer un endpoint genérico “cambiar a cualquier estado” al recorrido V2.

### D2-05 — Proyecciones compactas y paginadas

- cabecera/workspace inicial compacto;
- versiones, actividad, conversación y archivos bajo demanda;
- cursores estables, orden determinista;
- `meta.timezone`, actions, blockers y revision;
- public projection separada; nunca reutilizar DTO staff.

### D2-06 — Deep links y eventos

- todos los Outbox relevantes incluyen IDs seguros necesarios para resolver deep link server-side;
- notificaciones staff/cliente apuntan al expediente exacto;
- eventos documentan publicación versus delivery;
- cambiar email después de preflight invalida preflight, no redirige envío silenciosamente.

### Gate D2

- [ ] cada acción proyectada tiene prueba positiva/negativa;
- [ ] cada comando tiene idempotencia, concurrencia y auditoría;
- [ ] scope sales/manager/admin/customer completo;
- [ ] proyecciones no crecen sin límite;
- [ ] estados imposibles alertan y bloquean;
- [ ] contratos legacy siguen disponibles bajo fallback.

## 14. U1 — Sistema privado, shell y autenticación

**Objetivo:** construir una base visual/accessibility compartida sin tocar landing.
**Flag:** `commercialWorkspaceV2`.
**Gate de entrada:** G0-04/G0-05 y contratos D2 estables para navegación/capabilities.

### U1-01 — Aislamiento de estilos y tokens

**Archivos objetivo:**

- crear layouts/styles privados bajo `src/app/staff`, `src/app/portal` y auth o módulos equivalentes;
- crear `src/components/private/ui/*`;
- retirar gradualmente selectores privados de `src/app/globals.css`;
- mantener las reglas de landing byte/visual-equivalentes.

**Tokens mínimos:** color, surface, border, shadow, typography, spacing, radius, motion, focus, z-index y breakpoints. Todos tienen nombres semánticos, contraste medido y ejemplos.

**Done:** ningún componente privado nuevo depende de selectores de marketing; landing regression cero.

### U1-02 — Primitivas accesibles

Implementar wrappers normativos sobre la librería aprobada:

- Button/IconButton/LinkButton;
- FormField/TextField/TextArea/NumberField/MoneyField/PercentField;
- Select/RemoteComboBox/DatePicker/DateRange;
- Dialog/AlertDialog/Drawer/Popover/Menu/Tabs/Tooltip/Toast;
- Table/Pagination/FilterBar;
- Empty/Skeleton/Error/Blocking/Autosave/Conflict.

**Contrato:** label, description, error, required, disabled, read-only, busy, focus, keyboard, touch target y test harness consistentes. Un icon-only button siempre tiene nombre accesible/tooltip.

### U1-03 — Shell staff

Crear `staff/layout.tsx` o estructura equivalente con:

- logo oficial → `/staff`;
- sidebar desktop y drawer móvil;
- navegación filtrada por server capabilities;
- usuario, rol y logout;
- breadcrumb y return target;
- `main#contenido`;
- banner de entorno/salud sólo cuando sea útil;
- fallback de sesión/permiso/error uniforme.

**Negativas:** ventas no ve auditoría/settings; ruta directa sigue protegida; logout revoca sesión antes de mostrar éxito y ofrece recuperación si falla.

### U1-04 — Shell portal y auth

- logo portal → `/portal`;
- identidad y logout verificable;
- navegación compacta móvil;
- login staff en dos pasos: credenciales y después MFA sólo cuando servidor lo exige;
- recovery/magic link con token limpiado de URL;
- mensajes claros sin enumeración de cuentas;
- redirección allowlisted al expediente exacto.

### U1-05 — Copy, estados e iconografía

- catálogo central de etiquetas staff/cliente;
- prohibir códigos técnicos salvo auditoría;
- Lucide sólo si pasó G0-04, imports individuales;
- logo oficial en shell, PDF y estados de marca;
- todos los estados con texto + icono/forma, nunca sólo color;
- mensajes de error conservan requestId y recuperación.

### U1-06 — Story/test matrix visual

Crear una ruta/harness sólo de desarrollo o fixtures de componentes para capturar estados sin depender de datos reales. Probar 360/390/768/1024/1440, zoom 200%, dark mode sólo si se decide soportarlo, high contrast, reduced motion, teclado y Axe.

### Gate U1

- [ ] landing visual/content regression cero;
- [ ] shell staff/portal/auth ofrece logo, nav, back, user y logout;
- [ ] navegación coincide con capabilities;
- [ ] primitivas pasan teclado/foco/Axe;
- [ ] tamaños tipográficos/táctiles dentro de contrato;
- [ ] bundle e hidratación dentro de presupuesto;
- [ ] no hay dos sistemas visuales nuevos coexistiendo sin fecha de retiro.

## 15. R1 — Solicitudes y expediente unificado

**Objetivo:** completar el trabajo de admisión/calificación dentro de una ruta estable.
**Flags:** `commercialWorkspaceV2` + `requestWorkspaceV2`.
**Gate de entrada:** D2 y U1.

### R1-01 — Cola de solicitudes con URL como estado

Ruta `/staff/requests` con:

- vistas `mine`, `unassigned`, `all` según permiso;
- search, stage, assignee, age y sort en query params validados;
- cursor/paginación y orden estable;
- filas con folio, cliente/proyecto, etapa, responsable, antigüedad, razón de atención y acción;
- filtros guardables sólo después de probar necesidad;
- empty inicial versus empty por filtros;
- retorno con scroll/selección.

**Responsive:** tabla/lista densa en desktop; tarjetas accionables en móvil; abrir detalle navega, no apila.

### R1-02 — Ruta profunda del expediente

Crear `/staff/requests/[requestId]` con Server Component para sesión/cabecera y tabs en URL:

- `summary`;
- `quote`;
- `conversation`;
- `files`;
- `activity`.

Cabecera sticky moderada: folio, cliente, proyecto, etapa, responsable, actor esperado, blocker y acción primaria. Secondary actions en menú. Cada tab carga su recurso paginado al activarse.

### R1-03 — Alta manual y deduplicación

Ruta `/staff/requests/new` y comando D2:

- contacto, canal/origen, proyecto, ubicación, descripción;
- defaults mínimos y progressive disclosure;
- búsqueda de coincidencias por email/teléfono;
- reutilizar coincidencia confirmada;
- ambigüedad requiere selección/admin, nunca merge automático;
- redirigir al nuevo expediente con notice persistente.

**Meta:** completar caso típico en ≤ 90 s.

### R1-04 — Edición auditada de perfil comercial

Editar contacto, proyecto, ubicación, dimensiones, timeline y presupuesto según permiso. Mostrar impacto en preflight si cambia recipient. Guardar before/after seguro; pedir motivo sólo para campos sensibles o correcciones posteriores a publicación.

### R1-05 — Revisar, tomar y reasignar

- abrir nunca cambia estado/asignación;
- `Tomar solicitud` reclama sólo si libre;
- si otro la tomó, mostrar owner y actualizar sin duplicar;
- manager reassign con motivo;
- revisión presenta checklist accionable, no dropdown de estado;
- `Lista para cotizar` abre tab quote con defaults, sin crear borrador vacío.

### R1-06 — Solicitar información en una sola intención

Drawer/panel combina:

- campos faltantes sugeridos;
- mensaje editable;
- canal/recipient exacto;
- creación/reuso de acceso cliente;
- preflight y envío;
- estado esperando cliente.

No se permite cambiar a `INFORMACION_REQUERIDA` sin mensaje/evento. Si delivery falla, la solicitud conserva estado y staff recibe recuperación clara.

### R1-07 — Conversación, notas y archivos integrados

- mismas entidades/servicios seguros;
- tabs separados para contenido cliente e interno;
- paginación/carga incremental;
- no leído basado en modelo real, no badge inventado;
- subir muestra progreso, scan, fallo y retry;
- cambiar tab/volver no pierde draft de mensaje;
- deep links desde notificaciones.

### R1-08 — Compatibilidad y redirect

- `/staff/quotes?request=:id` → `/staff/requests/:id?tab=quote`;
- links antiguos de requests conservan filtros cuando sea posible;
- fallback antiguo sigue bajo flag;
- telemetría mide uso/errores de ambos caminos.

### Gate R1

- [x] crear solicitud manual, dedupe y negativas E2E — verificado localmente con `5/5` V2 y negativas de servicio/API;
- [x] abrir/tomar/reasignar/revisar/solicitar información completos — verificado localmente en el recorrido V2 y servicios protegidos;
- [x] una sola ruta conserva tabs/filtros/back/scroll — tabs, filtros, deep links, regreso y restauración del valor exacto de scroll están verificados localmente;
- [x] móvil no apila master/detail — verificado en viewports móviles y ausencia de overflow horizontal; la revisión humana de densidad/jerarquía queda para la aprobación formal del gate;
- [x] scope/RBAC/IDOR completos — la matriz formal [`request-workspace-idor-matrix.md`](../request-workspace-idor-matrix.md) documenta las superficies, respuestas 404/403 y evidencia; el backend aplica `requests.read.global` para distinguir solicitudes propias/sin asignar de la vista global y protege detalle, actividad, mensajes, archivos, cotizaciones, aprobaciones, PDF, onboarding, filtros y destinos de asignación. La aprobación final de gate permanece separada;
- [x] conversación/archivos/actividad paginados — verificado localmente con cursores, carga progresiva, drafts y estados de carga/reintento;
- [ ] primera task de usuario cumple baseline/meta — pendiente de piloto T1 con usuarios representativos;
- [x] fallback y landing verdes — regresión legacy `35/35` con flags apagadas y landing sin cambios.

## 16. K1 — Catálogo, precios y política comercial

**Objetivo:** hacer confiable y alcanzable el universo comercial antes de conectarlo al builder V2.
**Gate de entrada:** D1-02/D1-04, D2 y U1.

### K1-01 — Search API completa

Endpoint paginado/cursor por `priceListId`, query, código, categoría, moneda, estado y fecha efectiva. Sólo devuelve conceptos con su precio elegible o blocker tipado. Debounce/cancelación en cliente; sin precargar 50.

**Pruebas:** concepto 51/5000 alcanzable, acentos/case, precio vencido/futuro, lista incorrecta, permiso, p95 con dataset.

### K1-02 — Modelo de precio programado

Comando `schedulePrice` atómico:

- bloquea item/lista;
- valida fecha comercial;
- cierra vigencia anterior y abre siguiente sin solapamiento;
- detecta duplicado/idempotencia;
- registra motivo/actor/auditoría;
- ofrece preview de efecto antes de confirmar.

### K1-03 — Administración completa

En `/staff/catalog`:

- categorías CRUD/orden/archivo sin ciclos;
- conceptos crear/editar/archivar/reactivar;
- código autogenerado y override autorizado;
- unidades controladas + “otra”;
- listas crear/editar/archivar;
- precios actuales/futuros/históricos;
- dependencias antes de archivar;
- MoneyField/DatePicker/Select de librería.

Ventas ve lectura contextual; manager/admin administran. No hay importe “en centavos”.

### K1-04 — Política e impuestos

UI autorizada para policy versionada: moneda, precision, timezone, vigencia, tax profiles, discount/override threshold. Publicar nueva policy muestra impacto y nunca cambia snapshots existentes.

### K1-05 — Concepto especial y promoción

Contrato para línea sin `catalogItemId`, con nombre/descripcion/unidad/precio/motivo. Según policy requiere aprobación. Manager puede promoverla después mediante flujo separado con dedupe; promoción no altera la quote histórica.

### Gate K1

- [ ] todo concepto alcanzable, sin límites silenciosos;
- [ ] price scheduling concurrente/atómico;
- [ ] money/tax/date semantics únicas;
- [ ] CRUD y archivo tienen confirmación, dependencias y rollback lógico;
- [ ] ventas puede cotizar especial sin administrar catálogo;
- [ ] p95 de búsqueda ≤ 300 ms objetivo;
- [ ] snapshots existentes intactos.

## 17. Q1 — Constructor contextual de propuesta

**Objetivo:** preparar una propuesta profesional dentro del expediente, con autosave seguro y contenido comercial completo.
**Flag:** `quoteBuilderV2`.
**Gate de entrada:** R1, K1 y D2.

### Q1-01 — Workspace y defaults

El tab `quote` muestra:

- contexto del expediente y última propuesta publicada;
- working version separada;
- policy/lista/moneda/tax/vigencia preseleccionados;
- templates sugeridos sin imponerlos;
- blocker si datos mínimos faltan;
- no selector de expediente.

`startQuotePreparation` no persiste versión vacía. Primera línea/sección válida crea un único BORRADOR idempotente.

### Q1-02 — Buscador y selección rápida

- RemoteComboBox con búsqueda completa;
- recientes/frecuentes sólo como ayudas, no filtros ocultos;
- selección múltiple;
- cantidad 1 y tax profile por defecto;
- agregar diez conceptos sin diez diálogos;
- teclado y lector de pantalla;
- alta de concepto especial inline/drawer.

### Q1-03 — Líneas, secciones y contenido

- drag/reorder accesible con alternativa por botones/teclado;
- secciones con título/alcance;
- nombre/descripción snapshot editables según permiso;
- cantidad/unidad/precio/discount/tax claros;
- exclusiones, condiciones de pago, garantías y notas públicas estructuradas;
- errores por línea y resumen de blockers;
- 1–100 líneas con layout virtualizado sólo si medición lo exige.

### Q1-04 — Money, pricing y comparación

- MoneyField localizado sin floats;
- precio base visible; override separado con motivo;
- total backend autoritativo y preview cliente marcado como tal durante edición;
- cambios de lista sólo en BORRADOR y con comparación/confirmación;
- `Repreciar` explícito muestra línea antes/después;
- jamás repricing al abrir.

### Q1-05 — Autosave y conflicto

- debounce inicial objetivo 800 ms, ajustado por medición;
- estados `Sin guardar`, `Guardando`, `Guardado`, `Error`, `Conflicto`, `Sin conexión`;
- expected revision en cada comando;
- cola de cambios serializada;
- retry idempotente después de timeout;
- conflicto ofrece comparar/recargar/copiar cambios, nunca overwrite silencioso;
- navegación bloquea sólo cuando existe trabajo realmente no persistido.

### Q1-06 — Review y versiones

- acción principal `Listo para revisión`;
- precheck de campos, precios, tax, términos y vigencia;
- digest congelado y timeline;
- volver a editar explica que invalida aprobación/PDF;
- crear revisión desde publicada copia snapshots, no catálogo actual;
- historial compara versiones y señala cambios;
- published anterior sigue visible al cliente.

### Q1-07 — Resumen y diseño responsive

Desktop: contenido principal + resumen sticky sin tapar campos. Tablet: resumen colapsable visible. Móvil: total/action bar fija segura y editor en bloques. Cero tabla horizontal inaccesible.

### Gate Q1

- [ ] solicitud→tres conceptos ≤ 5 acciones significativas y mediana objetivo;
- [ ] diez conceptos ≤ 45 s;
- [ ] concepto especial ≤ 90 s;
- [ ] autosave/concurrencia/offline/timeout negativos;
- [ ] versión snapshot no cambia con catálogo;
- [ ] secciones/contenido comercial completo;
- [ ] teclado/Axe/responsive/zoom;
- [ ] ninguna navegación al catálogo en caso típico;
- [ ] old builder fallback intacto.

## 18. A1 — Aprobaciones comerciales

**Objetivo:** convertir descuentos y overrides en un recorrido explícito, rápido y auditable.
**Flag:** `quoteApprovalV1`.
**Gate de entrada:** D1-05, D2 y Q1 review estable.

### A1-01 — Evaluador de policy

**Estado actual:** `IMPLEMENTADO_LOCAL` para descuento; el evaluador final de
umbrales/overrides sigue pendiente de BIZ-06/BIZ-07.

Función pura determina por versión/digest:

- aprobación no requerida;
- descuento requerido;
- price override requerido;
- ambos combinados o approvals independientes según ADR;
- actor elegible;
- razón/bloqueo.

**Pruebas:** bordes exactos de umbral, cero descuento, múltiples monedas, policy histórica, requester=approver, cambio de digest.

### A1-02 — Solicitar aprobación

**Estado actual:** `VERIFICADO_LOCAL` para descuentos. Existe migración,
idempotencia por digest, API, auditoría/Outbox e invalidación al editar.

Desde review:

- staff escribe motivo comercial;
- ve cambio/base/total y política aplicada;
- comando crea una sola approval activa para digest;
- etapa cambia a espera gerencial derivada;
- manager recibe deep link;
- staff ve responsable, fecha y estado;
- retry no duplica.

### A1-03 — Resolver en contexto

**Estado actual:** `IMPLEMENTADO_LOCAL` dentro del expediente; la cola global
`/staff/approvals`, deep links y preview de PDF quedan pendientes.

Manager abre el mismo expediente o `/staff/approvals` y ve:

- cliente/proyecto/owner;
- versión/digest;
- precio base, override, descuento y total;
- comparación y motivo;
- PDF preview si corresponde después, no requerido aquí;
- aprobar o rechazar; rechazo exige comentario útil;
- autoaprobación bloqueada;
- admin override separado con MFA/motivo.

### A1-04 — Invalidación, reemplazo y vencimiento

- volver a BORRADOR marca approval `SUPERSEDED`;
- una nueva solicitud reemplaza la anterior sólo según reglas;
- resolver approval obsoleta devuelve conflicto con link a actual;
- no hay approvals huérfanas;
- notificaciones deduplicadas y cancelables.

### A1-05 — Cola y tiempos

`/staff/approvals` es una vista autorizada, no un universo separado: cada fila abre el expediente exacto y conserva retorno. Orden por antigüedad/impacto bajo fórmula documentada. No mostrar “urgente” sin regla.

### Gate A1

- [x] sales propone, manager elegible resuelve (descuento, local);
- [x] autoaprobación bloqueada por servidor;
- [x] digest cambiado invalida approval;
- [x] una approval activa por versión/tipo y solicitudes repetidas idempotentes;
- [ ] cero approvals duplicadas/huérfanas en una suite E2E completa;
- [ ] todo bloqueo tiene actor y siguiente paso;
- [ ] RBAC, concurrencia, deep link y notificación E2E;
- [ ] flag off revierte al fallback seguro sin perder datos.

## 19. P1 — PDF, preflight, publicación y entrega

**Objetivo:** producir una propuesta comercial de alta calidad y publicarla sin confundir disponibilidad con entrega.
**Flag:** `quotePublicationV2`.
**Gate de entrada:** A1, términos/policy aprobados y Q1 estable.

### P1-01 — Snapshot de publicación y digest

Congelar exactamente:

- versión/revision/content digest;
- cliente/contacto/destinatario;
- secciones/líneas/importes;
- moneda/impuestos/vigencia;
- alcance/exclusiones/pagos/garantías;
- términos ID/hash;
- template PDF version.

El snapshot no consulta catálogo vigente después de congelar. Cambiar contacto, contenido, policy o términos invalida el preflight.

### P1-02 — Renderer PDF comercial V2

**Requisitos visuales/contenido:**

- logo oficial embebido, no texto sustituto;
- tipografía con soporte completo de acentos;
- portada/cabecera sobria con folio/versión/fecha/vigencia;
- cliente/proyecto/alcance;
- secciones y tabla legible;
- descuentos/impuestos/total inequívocos;
- condiciones de pago, exclusiones, garantías y términos;
- footer, confidencialidad y paginación;
- sin truncamiento silencioso;
- metadata/template version deterministas;
- snapshot y hash verificables.

**Fixtures obligatorios:** 1, 20 y 100 líneas; nombres/descripciones largos; acentos/símbolos; múltiples páginas; descuento/impuesto/exento; vigencia; concepto especial; límites monetarios. Renderizar PDF→PNG y revisar visualmente.

### P1-03 — Job/lease de documento

- estados preparando/listo/fallido/eliminado;
- claim con lease, heartbeat/recovery o job idempotente equivalente;
- un PDF READY es inmutable;
- storage head/hash/size verificados;
- objeto ausente/corrupto produce recovery controlada, no “READY” falso;
- template version usa una sola fuente;
- cleanup de huérfanos seguro.

### P1-04 — Preflight humano

`preparePublication` devuelve un preflight limitado y firmado/digestado:

- versión y total;
- documento/hash;
- términos;
- vigencia;
- destinatario exacto;
- onboarding requerido;
- approval status;
- blockers;
- expiración del preflight.

La pantalla permite preview/descarga y confirmación informada. No usa `confirmation: true` como única evidencia.

### P1-05 — Comando de publicación

Entrada mínima:

- idempotency key;
- expected revision/digest;
- preflight ID/digest;
- version/document/terms/recipient exactos.

Efectos SQL atómicos:

- validar/lock;
- marcar publicación;
- mover `publishedVersionId`;
- marcar anterior reemplazada si aplica;
- limpiar working pointer;
- escribir auditoría/Outbox.

Storage ya fue verificado antes; SMTP ocurre después por worker. Timeout/retry devuelve el mismo receipt.

### P1-06 — Onboarding y delivery

- cliente activo: notificación con deep link;
- cliente nuevo: crear/reusar INVITED + magic link y enviar un correo contextual de propuesta, no dos mensajes contradictorios;
- recipient snapshot no cambia después del preflight;
- status UI: en cola, aceptada por proveedor, fallida, cancelada;
- retries/backoff sin duplicar;
- fallo de correo no despublica;
- staff puede copiar un enlace seguro sólo según política, nunca token desde UI/log.

### P1-07 — UI de publicación y operación

Dentro del expediente:

- checklist de readiness;
- preview PDF;
- resumen confirmable;
- CTA `Publicar propuesta y avisar al cliente`;
- resultado separado publicación/delivery;
- retry delivery con reason/status;
- notificación operator en `/staff/operations/notifications` enlaza folio, publicación y recovery;
- no mostrar secreto, email completo donde no corresponda ni provider internals.

### Gate P1

- [ ] PDF V2 visual y de contenido aprobado;
- [ ] ningún texto/alcance truncado;
- [ ] PDF/hash/snapshot deterministas;
- [ ] documento listo antes de publicación;
- [ ] preflight invalida cualquier cambio;
- [ ] publicación idempotente, anterior reemplazada correctamente;
- [ ] Outbox/delivery no duplican y comunican estado real;
- [ ] primer onboarding entrega un solo mensaje claro;
- [ ] fallos storage/PDF/worker/SMTP simulados y recuperables;
- [ ] portal aún no expone nada antes de `publishedAt`.

## 20. C1 — Portal, cambios y aceptación

**Objetivo:** permitir al cliente comprender y decidir sobre la propuesta publicada sin asistencia.
**Flag:** `portalTimelineV2`.
**Gate de entrada:** P1, BIZ-09/BIZ-10 y revisión jurídica.

### C1-01 — Portal home y rutas profundas

`/portal` muestra:

- saludo/identidad sin exceso decorativo;
- expedientes paginados;
- primero los que requieren acción;
- etapa humana, proyecto, última actividad y acción;
- empty/onboarding/error/session states.

`/portal/requests/[id]` conserva tab en URL y nunca carga otro cliente. Links de correo aterrizan aquí.

### C1-02 — Timeline público

Derivado del mismo resolver, pero con copy y datos del cliente:

- recibida;
- en revisión;
- necesitamos información;
- preparando propuesta;
- propuesta disponible;
- cambios en preparación conservando publicación anterior;
- aceptada/vencida/cerrada.

Nunca muestra aprobación, notas, assignee interno, delivery técnico ni working version.

### C1-03 — Propuesta publicada

- summary y PDF exactos;
- versión/vigencia/total;
- secciones, líneas y términos humanos;
- historial de versiones publicadas/reemplazadas;
- sólo published actual tiene acciones;
- PDF ausente bloquea acciones con recuperación, no botón fallido;
- todos los importes desde snapshot.

### C1-04 — Solicitar cambios

Acción explícita abre diálogo accesible con mensaje requerido. Comando:

- valida publicación vigente;
- registra request-change idempotente;
- crea mensaje compartido/evento;
- coloca trabajo en cola staff;
- no edita, rechaza ni oculta la propuesta;
- confirma qué ocurrirá.

### C1-05 — Aceptación server-owned

UI muestra:

- versión, total, vigencia y documento;
- texto/links de términos aprobados, nunca código técnico;
- nombre/autoridad requerida según policy;
- checkbox/consentimiento;
- confirmación final.

Servidor verifica published pointer, signer, scope, vigencia, PDF hash, terms hash, amount/currency, permission e idempotency payload hash. Evidencia snapshot inmutable. Dos pestañas producen una aceptación o receipt coherente.

### C1-06 — Acceso, expiración y logout

- magic link limpia token y respeta deep link allowlisted;
- nuevo cliente entiende que el folio no autentica;
- acceso solicitado antes de habilitación explica la secuencia sin prometer correo;
- invitación expirada ofrece solicitar otra;
- logout sólo confirma tras revocación; fallo explica reintento/seguridad;
- sesión expirada preserva destino seguro para volver.

### C1-07 — Mensajes y archivos

Conversación/archivos cargan por tab, paginados y con scopes. Estados de scan/upload/download claros. Notas internas y archivos internos jamás aparecen. `lastRead` se actualiza sólo cuando contenido fue presentado, no al prefetch.

### Gate C1

- [ ] cliente nuevo: correo→acceso→expediente exacto;
- [ ] propuesta publicada descargable y consistente;
- [ ] working/review/approval interna imposible de observar;
- [ ] request-change llega a staff sin retirar propuesta;
- [ ] aceptación exacta/legal/idempotente;
- [ ] IDOR completo cliente A/B y customer sin permiso;
- [ ] sesión/logout/replay/expired links negativos;
- [ ] ≥95% éxito piloto técnico sin asistencia;
- [ ] móvil/teclado/Axe/zoom/consola verdes.

## 21. W1 — Centro de trabajo y métricas accionables

**Objetivo:** hacer de `/staff` el lugar donde cada rol reconoce qué hacer ahora.
**Gate de entrada:** resolvers/commands de R1, A1, P1 y C1 estables.

### W1-01 — Read state y razones de atención

Agregar sólo si G0 confirma necesidad:

- `ConversationReadState` por usuario/conversación;
- `lastReadMessageId`/timestamp coherente;
- `lastCustomerMessageAt`, `lastStaffReplyAt` proyectados o derivados;
- razones deterministas: nueva libre, respuesta cliente, draft, aprobación, lista para publicar, delivery fallido, por vencer.

No crear score opaco. Cada prioridad explica la razón.

### W1-02 — Colas operativas

Inicio por rol:

- Mi trabajo;
- Sin asignar;
- Cliente respondió;
- Borradores/revisión;
- Aprobaciones;
- Listas para publicar;
- Fallos de aviso;
- Por vencer.

Cada cola tiene fórmula, scope, orden, count, paginación y enlace filtrado. Sales no ve global sin permiso.

### W1-03 — Acción rápida y continuidad

Filas ofrecen una acción primaria server-projected y abren el expediente. Optimistic UI sólo cuando reversible; cualquier conflicto refresca la fila y explica cambio. Volver conserva la cola.

### W1-04 — Lectura gerencial

Métricas actuales se conservan como segunda capa:

- volumen/conversión/tiempos;
- carga;
- importe publicado/aceptado por moneda;
- health delivery;
- muestras protegidas.

Corregir conteo por quote publicada, no cada versión histórica cuando la métrica sea por expediente. Definir freshness/timezone.

### Gate W1

- [ ] siguiente tarea mediana ≤10 s, p90 ≤20 s;
- [ ] cada cola tiene fórmula y actor;
- [ ] counts coinciden con lista;
- [ ] badges no leídos son reales;
- [ ] sales/manager scopes probados;
- [ ] retornar conserva contexto;
- [ ] analytics y work queues no mezclan semántica.

## 22. J1 — Handoff a proyecto y administración final

**Objetivo:** cerrar el ciclo comercial sin fingir un módulo de obra completo.
**Flag:** `projectHandoffV1`.
**Gate de entrada:** aceptación C1 estable y BIZ-13 aprobada.

### J1-01 — Modelo mínimo real

`Project` debe incluir:

- código/folio de proyecto;
- client/contact;
- acceptance única fuente;
- owner;
- status de handoff;
- fechas;
- `ProjectScopeSnapshot` de versión aceptada;
- checklist items;
- auditoría/eventos.

Una aceptación genera máximo un proyecto. Ningún dato de catálogo futuro cambia scope.

### J1-02 — Comando de conversión

Preflight muestra cliente, versión aceptada, total, alcance, responsable y checklist. Comando idempotente crea proyecto, vincula solicitud, conserva evidencia y devuelve ruta. Si falla, solicitud no queda “convertida” sin Project.

### J1-03 — Workspace de handoff

Ruta `/staff/projects/[id]` limitada a:

- resumen fuente;
- responsable;
- checklist de transición;
- documentos/enlaces autorizados;
- estado de handoff;
- actividad.

No añadir cronograma de obra, inventario, pagos o proveedores en esta slice.

### J1-04 — Estados terminales y reapertura

Rechazada/cerrada/vencida muestran motivo, historial y acción permitida. Reabrir crea nueva intención/version, no muta evidencia histórica. Si J1 no pasa gate, acción Proyecto permanece invisible.

### Gate J1

- [ ] una aceptación → máximo un Project;
- [ ] snapshot de handoff exacto;
- [ ] fallo no deja status huérfano;
- [ ] permisos/scope/auditoría;
- [ ] ruta real y retorno;
- [ ] no se expandió a gestión completa de obra.

## 23. H1 — Hardening premium previo al piloto

**Objetivo:** demostrar que el sistema completo funciona bajo error, carga, concurrencia, seguridad y dispositivos reales antes de exponerlo a usuarios piloto.
**Gate de entrada:** S0–C1 y W1 verdes; J1 verde sólo si `projectHandoffV1` entra en la cohorte piloto. Si J1 queda fuera, su acción, ruta y flag permanecen apagados y H1 registra el no-go.

### H1-01 — Matriz E2E completa

Recorridos obligatorios, sin `skip`:

1. público crea solicitud → staff la recibe;
2. staff toma/revisa → solicita información → cliente responde;
3. staff prepara draft → autosave → review;
4. descuento/override → approval;
5. PDF → preflight → publicación → delivery;
6. cliente nuevo consume enlace → propuesta;
7. cliente pide cambio → nueva working mientras published anterior sigue visible;
8. nueva publicación reemplaza la anterior;
9. cliente acepta versión exacta;
10. handoff a Project si flag habilitado;
11. rechazo/vencimiento/reapertura;
12. logout/expiración/recovery/MFA.

Ejecutar en 360, 390, 768, 1024 y 1440 donde aplique, con consola limpia y screenshots de estados críticos.

### H1-02 — Seguridad y permisos

Matriz automática/manual:

- IDOR cliente A/B y staff scope;
- cada permiso positivo/negativo;
- CSRF/same-origin;
- XSS en nombres, descripciones, mensajes, PDF y términos;
- SQL injection/query validation;
- sesiones, expiración, revocación y fixation;
- magic link/recovery replay;
- MFA replay/elevación;
- rate limits;
- archivos privados, MIME/size/scan/URL expiry;
- logs/payloads sin secretos/PII innecesaria;
- approvals, publication y acceptance tampering;
- idempotency key con payload distinto;
- destinatario/preflight alterado.

Codex Security o revisión externa puede añadirse cuando esté disponible, pero no sustituye pruebas del repositorio.

### H1-03 — Concurrencia y fallos

Simular:

- dos usuarios reclaman la misma solicitud;
- dos tabs editan draft;
- dos review/approval/publication/accept clicks;
- timeout antes/después de commit;
- PDF worker cae, lease expira y recupera;
- storage put/head/delete falla;
- SMTP temporal/permanente;
- notification worker reinicia;
- cambio de recipient/policy/terms tras preflight;
- expiración ocurre durante aceptación;
- backfill se interrumpe y reanuda.

### H1-04 — Migración, backup y restore

- migraciones expand/backfill sobre copia representativa;
- duración/locks medidos;
- reporte pre/post de invariantes;
- backup checksum y restore aislado;
- deploy código compatible antes/después de cada expand;
- forward-fix ensayado;
- contract migration aún no aplicada;
- datos ambiguos bloquean rollout.

### H1-05 — Rendimiento y bundle

- dataset G0;
- `EXPLAIN` de work queues, catalog search y portal;
- p95 de API §29;
- Web Vitals rutas críticas;
- bundle por route y dependencia;
- memoria/CPU worker PDF/notifications;
- PDFs 100 líneas;
- navegación sin waterfalls evitables;
- no descargar fuentes/librerías privadas en landing.

### H1-06 — Accesibilidad y diseño

- Axe cero critical/serious;
- teclado completo;
- lector de pantalla smoke test;
- focus order/trap/restore;
- zoom 200%;
- contrast/high contrast;
- reduced motion;
- touch targets;
- no overflow;
- copy review;
- visual regression;
- PDF review PNG página por página.

### H1-07 — Observabilidad y runbooks

Dashboards/alertas por:

- command error/latency;
- invalid state;
- draft conflict/duplicate;
- approval aging;
- PDF preparing/failure;
- publication failures;
- delivery queue/failure;
- acceptance failure/tampering;
- auth anomalies;
- flag variant.

Runbooks: kill switch, retry, recipient correction, PDF recovery, reconcile pointers, approval orphan, worker, rollback UI/API, forward-fix DB y soporte con requestId.

### Gate H1

- [ ] todos los checks automáticos §28 pasan;
- [ ] cero suites críticas omitidas;
- [ ] matriz seguridad/RBAC completa;
- [ ] fallos/concurrencia recuperables;
- [ ] migración/restore/forward-fix ensayados;
- [ ] accesibilidad/visual/responsive aprobados;
- [ ] presupuestos de performance cumplidos o excepción aprobada;
- [ ] alertas/runbooks/kill switches operables;
- [ ] landing sin regresión;
- [ ] bloqueos externos de lanzamiento siguen explícitos.

## 24. T1 — Piloto controlado y validación humana

**Objetivo:** demostrar facilidad de uso real; no usar al equipo de desarrollo como sustituto de usuarios.
**Entrada:** H1 completo.
**Cohorte:** cuentas internas controladas y clientes de prueba, nunca todos los usuarios.

### T1-01 — Protocolo

Participantes mínimos recomendados:

- 2 ventas con distinto nivel técnico;
- 1 gerente;
- 1 administrador/operador;
- 3 clientes representativos, al menos 2 en móvil.

Tareas sin instrucción paso a paso:

- localizar siguiente pendiente;
- crear/revisar solicitud;
- pedir información;
- cotizar tres y diez conceptos;
- resolver un concepto especial;
- aprobación;
- publicar;
- acceder, pedir cambio y aceptar;
- recuperar un error de delivery/conflicto.

### T1-02 — Instrumentación y entrevista

Registrar, sin PII innecesaria:

- éxito/fracaso;
- tiempo y acciones;
- retrocesos/dudas;
- errores y asistencia;
- SEQ por tarea;
- SUS al final;
- observaciones verbales y severidad.

No enseñar el flujo salvo bloqueo; observar el modelo mental.

### T1-03 — Go/no-go

Go sólo si:

- éxito crítico staff ≥ 90%;
- portal ≥ 95%;
- mediana/p90 de siguiente tarea cumplen;
- SUS ≥ 85 y SEQ ≥ 6/7;
- cero severidad crítica;
- ningún participante confunde folio, publicación, email o aceptación;
- problemas P1 tienen owner/fecha y no impiden tareas.

Una sesión fallida por diseño vuelve la slice correspondiente; no se “explica” para aprobarla.

## 25. O1 — Rollout, estabilización y retiro de legado

### O1-01 — Cohortes

1. admin interno;
2. manager;
3. ventas piloto;
4. todos los staff autorizados;
5. clientes de prueba;
6. clientes nuevos;
7. clientes existentes.

Cada paso tiene ventana de observación, métricas, stop conditions y rollback. No activar portal antes de staff capaz de soportarlo.

### O1-02 — Operación durante coexistencia

- flags server-side estables;
- contratos legacy y V2 monitorizados;
- no escribir estados incompatibles;
- reconciliation job/report diario durante rollout;
- soporte conoce variante y requestId;
- cambios de datos son forward compatible.

### O1-03 — Dos ventanas estables

Una ventana estable significa:

- duración definida por operación;
- cero P0/stop condition;
- error/latency dentro de presupuesto;
- cero inconsistencia de pointers/snapshots;
- deliveries/retries sanos;
- uso legacy por debajo del criterio aprobado;
- feedback de usuario sin bloqueo crítico.

Se requieren dos antes de contract migration.

### O1-04 — Retiro

- redirects definitivos;
- borrar constructor/shell/DTOs legacy sin tocar historial;
- dejar de dual-write;
- contract migration de `currentVersionId` y estados legacy;
- eliminar CSS privado viejo de globals;
- eliminar flags;
- actualizar README/runbooks/status/specs;
- ejecutar gate completo después del cleanup.

### Gate O1

- [ ] 100% cohorte objetivo estable;
- [ ] dos ventanas sin P0;
- [ ] cero consumidores legacy;
- [ ] backup/restore antes de contract;
- [ ] rollback ya no depende del legado retirado;
- [ ] documentación y operación entregadas;
- [ ] iniciativa marcada completa sólo con evidencia final.

## 26. Definition of Ready

Ninguna tarea cambia a `READY` sin:

- ID y owner;
- objetivo de usuario;
- actor, scope y permisos;
- escenario inicial/final;
- alcance y no alcance;
- dependencias cerradas;
- ADR/policy aplicable;
- wireframe/flujo aprobado cuando haya UI;
- estados loading/empty/error/conflict/success/permission/offline;
- contrato API/comando/evento;
- impacto de datos y migración;
- invariantes y locks;
- idempotencia/rollback;
- flag/cohorte/fallback;
- métricas/eventos;
- fixtures;
- pruebas positivas, negativas, security y concurrency;
- presupuesto a11y/responsive/performance/bundle;
- lista exacta de archivos previstos;
- criterio de terminado medible;
- riesgos y stop conditions.

Si falta una decisión que modifica schema, dinero, autorización o evidencia legal, la tarea queda `BLOQUEADO`, no se adivina.

## 27. Definition of Done

Cada tarea debe evidenciar:

### Producto y UX

- criterio de usuario cumplido;
- acción/actor/blocker comprensible;
- todos los estados visuales;
- copy revisado;
- URL/back/refresh coherentes;
- responsive y teclado;
- no agrega clics o página sin justificar.

### Dominio y datos

- servidor autoridad;
- invariantes/transacciones/locks;
- idempotencia con payload hash;
- concurrencia;
- migración y backfill;
- audit/Outbox;
- snapshots históricos;
- rollback/forward-fix.

### Seguridad

- auth, RBAC y scope positivos/negativos;
- same-origin/rate limit/validation;
- IDOR/XSS/injection relevante;
- secretos/PII/logs revisados;
- error público seguro y requestId.

### Calidad

- prueba roja registrada antes del fix;
- unitarias/integración/API/E2E aplicables;
- cero test crítico skip;
- typecheck/lint/build;
- Axe/teclado/responsive/consola;
- performance/bundle;
- landing regression;
- documentación/status/runbook;
- commit y evidencia.

Una tarea `IMPLEMENTADO` que no cumple todo esto no es `VERIFICADO_E2E`.

## 28. Gate técnico reproducible

Orden mínimo por slice, ajustado sólo si el cambio no toca esa capa y se documenta:

```text
npm run db:validate
npm run db:generate
npm run db:migrate:deploy        # entorno disposable/verificación
npm run db:seed                  # idempotencia
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:content
npm run build
npm run test:e2e                 # suites base
<suite V2 obligatoria con flags y fixtures>
npm audit --omit=dev --audit-level=high
npm run analyze                  # cuando cambie bundle
git diff --check
```

Además, cuando aplique:

- migration diff/backfill/reconciliation;
- restore aislado;
- visual regression landing/private;
- PDF→PNG/text/hash;
- Web Vitals/API load;
- manual keyboard/screen reader;
- fault injection storage/SMTP/workers;
- production readiness sin declarar resueltos bloqueos externos.

### Matriz de prueba por slice

| Slice | Unit | DB/integration | API | E2E | Security | Visual/a11y | Perf |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| S0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| D1 | ✓ | ✓ | ✓ | — | ✓ | — | migration |
| D2 | ✓ | ✓ | ✓ | contract | ✓ | — | ✓ |
| U1 | ✓ | — | — | ✓ | auth | ✓ | bundle |
| R1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| K1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Q1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| A1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| P1 | ✓ | ✓ | ✓ | ✓ | ✓ | PDF | ✓ |
| C1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| W1 | ✓ | ✓ | ✓ | ✓ | scope | ✓ | ✓ |
| J1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## 29. Presupuestos y métricas

### 29.1 Rendimiento

- workspace compacto server p95 ≤ 800 ms;
- catalog search p95 ≤ 300 ms con 5k conceptos;
- mutación interna p95 ≤ 1 s sin dependencias externas;
- LCP p75 < 2.5 s;
- INP p75 < 200 ms;
- CLS p75 < 0.1;
- cero query/lista sin límite;
- bundle budget fijado en G0-04 y fallado automáticamente.

### 29.2 Eficiencia y comprensión

- siguiente tarea mediana ≤ 10 s, p90 ≤ 20 s;
- request lista → draft 3 items ≤ 5 acciones;
- 10 items ≤ 45 s;
- special item ≤ 90 s;
- primer intento staff ≥ 90%;
- portal acceso→decisión ≥ 95%;
- máximo un retroceso por tarea crítica;
- SUS ≥ 85;
- SEQ promedio ≥ 6/7.

### 29.3 Integridad

Objetivo absoluto:

- 0 internal versions visibles;
- 0 totals cross-surface distintos;
- 0 duplicate drafts/publications/deliveries/acceptances;
- 0 impossible states;
- 0 orphan approvals/projects;
- 0 cross-client access;
- 0 success sin receipt/Outbox requerido;
- 0 pérdida silenciosa de autosave;
- 0 Axe critical/serious;
- 0 critical suites skipped;
- 0 landing regressions.

## 30. Arquitectura de archivos objetivo

La forma exacta se confirma en ADR, pero el norte es:

```text
src/app/staff/
  layout.tsx
  page.tsx
  requests/page.tsx
  requests/new/page.tsx
  requests/[requestId]/page.tsx
  approvals/page.tsx
  catalog/page.tsx
  projects/[projectId]/page.tsx
  operations/...

src/app/portal/
  layout.tsx
  page.tsx
  requests/[requestId]/page.tsx

src/components/private/ui/       wrappers accesibles y tokens
src/features/work-center/
src/features/requests/
src/features/quote-builder/
src/features/approvals/
src/features/catalog/
src/features/publication/
src/features/client-portal/
src/features/projects/

src/server/modules/commercial-workflow/
src/server/modules/quote-requests/
src/server/modules/quotes/
src/server/modules/quote-approvals/
src/server/modules/quote-publications/
src/server/modules/commercial-policy/
src/server/modules/projects/
```

Reglas:

- page/route no contiene reglas comerciales;
- DTO staff y portal separados;
- dominio puro separado de IO;
- servicios coordinan transacción/eventos;
- componentes de feature no redefinen tokens/primitivas;
- archivos no superan tamaño sin revisión; dividir por responsabilidad, no por fragmentación artificial;
- no crear un endpoint gigante con historial/mensajes/archivos ilimitados.

## 31. Plantilla de paquete de tarea

Copiar esta estructura al comenzar cada ID:

```text
ID / Estado / Owner / Fecha
Objetivo de usuario
Baseline y métrica
Alcance / no alcance
Dependencias / ADR / policy
Actor / scope / permisos
Modelo / migración / backfill
Comando / API / DTO / eventos
Invariantes / locks / idempotencia
Wireframe y estados UX
A11y / responsive / performance
Pruebas rojas
Implementación
Pruebas positivas/negativas/security/concurrency
Flag / cohorte / fallback / rollback
Archivos exactos
Evidencia / commit
Riesgos restantes
Siguiente paso exacto
```

## 32. Registro de riesgos

| ID | Riesgo | Severidad | Mitigación | Owner | Estado |
| --- | --- | --- | --- | --- | --- |
| RSK-01 | internal review visible a cliente | crítica | S0-01 + published pointer | Ingeniería | abierto |
| RSK-02 | total histórico incorrecto | crítica | S0-02 + snapshot V2 | Ingeniería | abierto |
| RSK-03 | aviso sin PDF | crítica | S0-04/P1 saga | Ingeniería | abierto |
| RSK-04 | evidencia legal insuficiente | crítica lanzamiento | terms registry + jurídico | Producto/Jurídico | abierto |
| RSK-05 | migración ambigua de currentVersion | alta | report/quarantine/backfill | Ingeniería | abierto |
| RSK-06 | pérdida por dos pestañas | alta | revision/conflict | Ingeniería | abierto |
| RSK-07 | RBAC demasiado amplio | alta | permisos/scope D2 | Producto/Ingeniería | abierto |
| RSK-08 | fiscalidad incorrecta | alta | BIZ-02…04 | Fiscal/Producto | abierto |
| RSK-09 | UI V2 afecta landing | alta | CSS isolation + regression | Diseño/Ingeniería | abierto |
| RSK-10 | librería aumenta bundle/hidratación | media | spike/budget/route split | Frontend | abierto |
| RSK-11 | dos experiencias divergen | alta | flags/telemetry/retirement | Ingeniería | abierto |
| RSK-12 | proyecto crece a ERP | media | no-go J1 | Producto | abierto |
| RSK-13 | SMTP/storage externos bloquean | alta lanzamiento | readiness/runbooks | Operación | abierto |
| RSK-14 | identidad duplicada de clientes | alta | dedupe/admin resolution | Producto/Ingeniería | abierto |

## 33. Tablero maestro

| Fase | Estado | Dependencia | Gate/salida |
| --- | --- | --- | --- |
| G0 Gobierno/baseline | `EN_PROGRESO` | auditoría | decisiones, ADR, flags, baseline |
| S0 Contención P0 | `EN_PROGRESO` | Gate G0; excepción local de integridad | producto actual seguro/coherente |
| D1 Modelo/invariantes | `DISEÑADO` | S0/G0 | schema V2 expand/backfill |
| D2 Comandos/proyecciones | `DISEÑADO` | D1 | actions/blockers server-owned |
| U1 Sistema privado | `PREPARADO_LOCAL` | cierre formal G0 + D2 contract | shell/primitives aisladas bajo fallback |
| R1 Expediente/solicitudes | `PREPARADO_LOCAL` | D2/U1 | admisión vertical completa bajo fallback |
| K1 Catálogo/policy | `DISEÑADO` | D1/D2/U1 | catálogo completo/confiable |
| Q1 Constructor | `DISEÑADO` | R1/K1 | draft/review profesional |
| A1 Aprobaciones | `DISEÑADO` | Q1/D1 | approval vertical |
| P1 PDF/publicación | `DISEÑADO` | A1/Q1 | propuesta publicada y delivery |
| C1 Portal/aceptación | `DISEÑADO` | P1/legal | cliente decide versión exacta |
| W1 Centro de trabajo | `DISEÑADO` | R1/A1/P1/C1 | colas reales y métricas |
| J1 Proyecto | `DISEÑADO` | C1/BIZ-13 | handoff real o flag off |
| H1 Hardening | `DISEÑADO` | S0–C1 + W1; J1 si entra al piloto | gate premium |
| T1 Piloto | `DISEÑADO` | H1 | go/no-go humano |
| O1 Rollout/legado | `DISEÑADO` | T1 | rollout, estabilidad, cleanup |

### Foco actual

- **Ahora:** revisar el cierre técnico de G0-05 y conservar preparada la entrada U1/R1 bajo flags fail-closed; G0-04 ya quedó aprobado localmente. El mapa de entrada está en [`ADR de entrada U1/R1`](../../adr/2026-09-11-u1-r1-entry-readiness.md).
- **Después:** signoffs fiscal/jurídico restantes y cierre formal de G0; después U1 shell + R1 expediente bajo flags.
- **Primera mutación funcional autorizada tras G0:** S0-01.
- **Primer valor UX visible:** U1 shell + R1 expediente bajo flags.
- **Mayor riesgo:** D1/P1/C1, no la capa visual.

## 34. Evidencia acumulada

### 2026-09-11 — U1 Entrada 1: fundamento privado inerte

- Se creó [`private/ui`](../../src/components/private/ui/) con tokens
  semánticos, contrato de accesibilidad de campos, primitives de controles y
  estados; los estilos están aislados bajo `.private-ui-scope`.
- La entrada no modifica layouts, rutas, landing, sesión ni telemetría. Sólo
  añade tres campos booleanos seguros al endpoint de capabilities para el
  futuro filtro de navegación. No hay consumidores de la nueva base en
  `src/app` ni en servicios; las flags de V2 siguen apagadas por defecto.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (`36` archivos / `143`
  pruebas), `npm run test:content` y `git diff --check` pasan.
- La integración de capabilities pasó `3/3` con sesiones sintéticas y
  verificación de autenticación, separación RBAC y payload seguro.
- U1/R1 continúan `PREPARADO_LOCAL`; la conexión del namespace al shell sólo
  inicia después del cierre formal de G0 y conserva fallback legacy.

### 2026-09-11 — S0-02/S0-03 y regresión local

- S0-02 conserva el precio aplicado del snapshot al rehidratar el constructor; la
  prueba `tests/quotes.spec.ts` cambia el precio vigente del catálogo y confirma
  que el borrador y la nueva versión mantienen `150.00`. E2E del constructor:
  `1/1`, con Axe serio, responsive y consola limpia.
- S0-03 retiró la tabla frontend de transiciones como autoridad: el backend
  proyecta `availableStatusTransitions` y `availableActions` según estado y
  permisos. La integración dirigida de solicitudes/cotizaciones pasó `2/2`
  archivos y `7/7` pruebas; `tests/requests.spec.ts` pasó `1/1` en 390, 768 y
  1440 px. Se corrigió el overflow real del título móvil causado por la escala de
  escritorio; la prueba confirma scroll horizontal cero.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (`34` archivos / `139`
  pruebas) y `git diff --check` pasaron.
- El renderer PDF `quote-pdf-v2` embebe `public/brand/ocpool-logo.png` y conserva
  el alcance completo con paginación; `tests/unit/quote-pdf-renderer.test.ts`
  pasó `4/4`, y las integraciones dirigidas de PDF/publicación pasaron `2/2`
  archivos y `3/3` pruebas.
- Con PostgreSQL local, `RUN_DB_TESTS=1 npx vitest run tests/integration
  --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000 --reporter=dot` pasó
  `42/42` archivos y `88/88` pruebas. Los logs 401/403/404/409/429 son casos
  negativos esperados; permanecen sólo avisos conocidos de Node 20/AWS SDK y pg.
- La compilación aislada usada por Playwright pasó al ejecutar la E2E de
  solicitudes; no se modificó la landing ni se activaron flags. S0-02/S0-03
  permanecen como implementación local, no como autorización de rollout.

### 2026-09-11 — G0-03 cobertura adicional del cotizador

- `tests/quotes.spec.ts` pasó `1/1` contra el build fresco en
  `APP_URL=http://127.0.0.1:3192`, con fixtures desechables y limpieza completa.
- El recorrido autenticado agregó diez conceptos desde la lista contextual y
  registró `add_ten_concepts=1,015 ms`; después guardó el borrador y confirmó
  que el snapshot mantuvo `150.00` aunque el catálogo cambió a `250.00`.
- El flujo provocó un fallo sintético del renderer, mostró `Requiere reintento`
  en el panel staff y recuperó el PDF mediante el botón real, registrando
  `document_failure_to_recovery=1,251 ms` y estado final `Listo para compartir`.
- El mismo recorrido creó una versión con descuento, solicitó aprobación como
  un usuario y la resolvió con un segundo usuario autorizado, registrando
  `draft_to_approval_resolution=1,694 ms` sin autoaprobación.
- La misma corrida registró `request_to_draft=7,368 ms`, `publish_quote=6,667 ms`
  y `published_to_new_working=242 ms`; el portal volvió a pasar `2/2` y registró
  `workflow_errors=1,255 ms` con un error de validación recuperado. Todas las
  muestras no contienen PII y G0-03 sigue abierto para expiración, abandono,
  muestra suficiente y objetivos de producto.

### 2026-09-11 — G0-03 expiración y abandono

- `tests/client-portal.spec.ts` pasó `4/4` contra el build fresco en
  `APP_URL=http://127.0.0.1:3193`, usando Chromium local y fixtures desechables.
- La cotización vencida muestra el estado sin llamarlo vigente y orienta al
  cliente a la conversación del expediente; el mensaje de actualización se
  envió y quedó persistido, registrando `expired_quote_to_next_step=347 ms`.
- Una segunda sesión abrió el mismo estado y terminó antes de enviar el mensaje,
  registrando `workflow_abandonment=256 ms` con `abandoned=true`.
- La misma suite conservó aceptación completa, estado sin cotización y error de
  aceptación recuperable (`workflow_errors=1,212 ms`, `errorCount=1`). Las
  muestras son sintéticas, no contienen PII y G0-03 queda pendiente sólo por
  muestra suficiente y objetivos de producto.

### 2026-09-11 — G0-03 muestra mínima y objetivos locales

- La matriz de G0-03 quedó repetida con fixtures desechables en cinco grupos:
  formulario público, solicitudes staff, cotizador, portal y notificaciones.
- Cada una de las 13 métricas tiene `n=5`: 65 registros PII-safe, sin
  producción, sin telemetría activa y fuera del repositorio. Las medianas, p95
  y guardrails están en el [ADR de objetivos locales](../../adr/2026-09-11-commercial-g0-03-objectives.md).
- El cotizador pasó `5/5` en su recorrido completo; la solicitud pública pasó
  `5/5` después de endurecer la espera observable de confirmación ante latencia
  local; solicitudes y notificaciones pasaron `5/5`; el portal conserva `5/5`
  con aceptación, error recuperable, expiración guiada y abandono válido.
- La autorización explícita recibida aprueba localmente los objetivos de §29,
  manteniendo separados el guardrail sintético, el piloto real y la aceptación
  estadística. G0-03 queda `VERIFIED_LOCAL_PARTIAL`; el piloto T1 y el cierre
  formal del Gate G0 permanecen pendientes.

### 2026-09-11 — G0-04 locale y primitives aprobados localmente

- `src/middleware.ts` marca las rutas privadas sin alterar la respuesta pública;
  `src/app/layout.tsx` entrega `lang="es-MX"` desde SSR en login, auth, portal y
  staff. La landing conserva `lang="es"`.
- `check:next` pasó `12/12` combinaciones en 390 y 1440 px con `lang="es-MX"`,
  cero overflow, cero errores de página y cero peticiones fallidas después de
  clasificar cancelaciones normales de precarga RSC.
- Se aprobó el fallback único actual: Radix para Select, react-day-picker para
  DatePicker y wrappers propios auditados para Dialog/Tabs; React Aria/Lucide
  permanecen como spike aislado y no se añaden dependencias al root.
- El gate técnico ejecutado contra un build fresco en `3188` pasó typecheck, lint,
  `139/139` unitarias, contenido y baseline HTTP `10/10`; termina `BLOCKED` sólo
  por la matriz G0-03, objetivos y signoffs fiscales/jurídicos restantes.

### 2026-09-12 — U1-01/U1-03/U1-06 preparados localmente

- Con autorización explícita para continuar sólo en la computadora local, el
  namespace privado quedó conectado por layouts route-local de `/auth`, `/login`,
  `/portal`, `/staff` y el harness de desarrollo, manteniendo el layout raíz
  público libre de `private-ui.css`.
- `PrivateShell` ya ofrece un único `main#contenido`, retorno contextual de
  marca (`/staff` o `/portal`), breadcrumb para rutas anidadas, navegación
  móvil, identidad sintética y logout preparado; los paneles legacy conservan
  su `<main>` cuando se renderizan fuera del shell mediante `PrivateSurfaceRoot`.
- U1-06 quedó cubierto por `/private-shell-harness`, que se niega en producción,
  no consulta Prisma ni APIs y sólo usa contextos sintéticos. La E2E opt-in pasó
  `2/2` para staff y portal con reduced motion, teclado, objetivos táctiles,
  Axe sin violaciones críticas/serias, consola limpia y cero overflow en
  360/390/768/1024/1440 px más la anchura efectiva de 180 px para zoom 200%.
- La suite actual es `37` archivos/`149` pruebas unitarias; typecheck, lint,
  contenido y diff-check pasan. Con el `.env` local ignorado, Docker saludable,
  migraciones al día y seed idempotente, integración pasó `42/42` archivos y
  `88/88` pruebas. Las flags V2 permanecen apagadas, la landing no cambió y no
  hubo push, deploy ni mutación de producción. El trabajo no cierra G0 ni
  convierte U1/R1 en `DONE`; la siguiente decisión sigue siendo el cierre formal
  de G0-05 y la cohorte del piloto.
- La regresión E2E opt-in completa sobre build aislado pasó `57/57` casos
  ejecutables; los 2 casos restantes se omiten porque `/private-shell-harness`
  sólo existe con `next dev`. El comando dedicado `npm run test:e2e:private-shell`
  pasó staff/portal `2/2`, con responsive, teclado, foco, Axe, reduced motion,
  touch targets y zoom equivalente. El constructor también quedó protegido
  contra seleccionar una lista de precios incompatible tras recargar una versión
  publicada. No se crean secretos productivos ni se ejecuta push/deploy.

### 2026-09-12 — R1-01/R1-02 implementados localmente bajo flags

- La cola V2 usa [`request-workspace-query.ts`](../../src/lib/request-workspace-query.ts)
  como contrato único para `view`, `query`, `stage`, `assignee`, `age`, `sort`,
  `page` y `tab`; el servidor aplica rangos de fecha no solapados y orden
  determinista. El selector de responsable consume sólo el directorio staff
  protegido por `requests.assign` y permanece ausente para perfiles sin ese
  permiso.
- `/staff/requests/[requestId]` conserva el contexto de la cola y expone
  `summary`, `quote`, `conversation`, `files` y `activity` mediante enlaces
  URL-driven. Las dos superficies reutilizadas se montan al activar su tab;
  cotización consulta `/api/staff/quotes/:id` sólo al abrirse; actividad usa la
  proyección server-owned de historial y asignaciones.
- La prueba opt-in `npm run test:e2e:request-workspace` pasó `2/2`, con filtros,
  deep link, retorno, tabs, selector de responsable, normalización de URLs,
  Axe serio y cero overflow en 360/390/768/1024/1440 px. La regresión general
  `npm run test:e2e` pasó `35/35` escenarios ejecutables y omitió `26` por
  flags opt-in; `npm run test:e2e:foundation` pasó `2/2`.
- La regresión local completa pasó `159` pruebas unitarias y `89` de
  integración; typecheck, lint, contenido, build y `git diff --check` pasan.
  Se ajustó `package.json` para fijar el host E2E local en `127.0.0.1:3100`,
  evitando que el `.env` de desarrollo dirija Playwright a un puerto apagado.
  No se activaron flags por defecto, no se modificó la landing y no hubo push,
  deploy ni mutación de producción.

### 2026-09-13 — R1-03/R1-04/R1-05/R1-06/R1-08 y base R1-07 local

- La admisión manual, edición auditada, toma/reasignación y redirect compatible quedaron conectados a servicios server-owned con dedupe explícito, bloqueo transaccional, permisos separados, motivos y metadatos PII-safe.
- `Solicitar información` es una intención única: valida etapa, mensaje y campos faltantes, crea/reutiliza acceso de portal opcional, publica mensaje, cambia estado, registra historial/auditoría y emite Outbox dentro de una transacción; la clave reutilizada con otro cuerpo se rechaza.
- La conversación conserva el draft al cambiar de tab, usa paginación por cursor y no inventa badges de no leído; archivos ahora tienen cursor seguro, carga incremental, progreso de bytes, scan visible y reintento con reserva idempotente. Los avisos staff pueden usar el expediente y tab exactos sólo cuando las flags V2 están activas; flags apagadas conservan la cola legacy.
- Evidencia fresca en local: `40/40` archivos y `185/185` pruebas unitarias, `42/42` archivos y `95/95` integraciones, E2E V2 `5/5` (incluye dedupe visible, decisión explícita y reutilización de contacto), portal autenticado `4/4`, staff de mensajería/archivos `2/2`, E2E pública `35/35` ejecutables con `29` omitidas por opt-in, foundation `2/2`, typecheck, lint, build, audit y diff-check PASS.
- La prueba V2 también verifica en móvil que el detalle no apila la cola maestra ni genera overflow, y conserva el valor exacto de scroll al regresar con la misma consulta; la API niega con `403` la lectura directa del detalle staff a una sesión cliente. Los fixtures E2E se limpian sin dejar contactos ni usuarios temporales.
- R1-07 tiene su cobertura técnica local ampliada: conversación, archivos y actividad paginados; carga de cliente y staff con progreso, scan, fallo y retry; drafts entre tabs; deep links condicionados por flags; y pruebas autenticadas de portal/staff. Permanece abierta la ejecución y aprobación del gate R1 completo; no se activaron flags, no se modificó la landing y no hubo push/deploy.

### 2026-09-13 — Pulido de experiencia y resiliencia V2

- La idempotencia de mensajes se conserva durante un reintento explícito y se invalida al cambiar el contenido o el modo de visibilidad; los errores de API V2 conservan la referencia de solicitud para recuperación operativa.
- Las acciones heredadas de conversación/archivos quedan dentro de un contrato táctil privado de `44px`, sin cambiar rutas públicas ni introducir una segunda hoja global; en tabs distintas de Resumen, las acciones operativas se contraen y se expanden bajo demanda para evitar scroll y decisiones duplicadas.
- La cola guarda y restaura la posición de scroll por consulta al volver del expediente, después de que la lista queda cargada; si el navegador no ofrece `sessionStorage`, conserva el flujo sin bloquearlo.
- Evidencia local actualizada: `40/40` archivos y `185/185` unitarias, `42/42` archivos y `95/95` integraciones, typecheck, lint, build y contratos V2 PASS; E2E V2 `5/5` PASS. La cobertura autenticada de portal/staff permanece `4/4` y `2/2`; R1 y G0 continúan abiertos formalmente por las tareas restantes, el piloto T1 y signoffs externos.

### 2026-09-13 — Alcance de solicitudes BIZ-08 consolidado localmente

- Se añadió el permiso explícito `requests.read.global`: Ventas queda limitada a solicitudes propias y sin asignar; Gerencia/Administración conservan la vista global. El backend aplica la misma regla a cola, detalle, actividad, toma/reasignación, mensajería, archivos, cotizaciones, aprobaciones, PDF y habilitación del portal; los filtros y destinos de responsable también se validan en servidor.
- La UI V2 y el fallback legacy reflejan el permiso sin usar la ocultación como seguridad: Ventas no recibe el selector global ni el directorio completo; Gerencia puede filtrar y reasignar globalmente. La prueba unitaria cubre propia/sin asignar, extranjera y filtro/target; la integración cubre lectura directa extranjera y el recorrido global.
- Evidencia fresca: `npm run test:unit` `40/40` archivos / `185/185` pruebas y `npm run test:integration` `42/42` archivos / `95/95` pruebas, ambas PASS. La matriz formal completa de IDOR del workspace quedó documentada en [`request-workspace-idor-matrix.md`](../request-workspace-idor-matrix.md); continúan pendientes la aprobación del gate R1, el piloto T1 y los signoffs externos. No se activaron flags, no se modificó la landing y no hubo push/deploy.

### 2026-09-10 — Auditoría y plan V2

- baseline de código auditado: commit `ee7d06df970691ff60caccc8d634516120516885`; rutas, componentes, servicios, schema, pruebas y plan anterior revisados de forma estática;
- tres revisiones independientes de UI/UX, dominio y ejecutabilidad se sintetizaron en la autorrevisión y su mapa de evidencia P0;
- se identificaron P0 de publicación, privacidad, snapshot, PDF, términos y acciones;
- se creó spec normativa y autorrevisión;
- se reemplazó el plan horizontal por slices con gates;
- Chrome for Testing 151 inspeccionó contra `http://127.0.0.1:3008` las rutas `/login`, `/portal/access`, `/staff` y `/portal` sin sesión a 390 y 1440 px; confirmó escala editorial, longitud móvil y regresos inconsistentes en las entradas privadas;
- las capturas de esta pasada son evidencia observacional local, no baseline G0 versionado; G0-03/G0-05 deben recrearlas con fixtures, comando y ubicación estable;
- la inspección visual autenticada de solicitudes, catálogo, cotizador, aprobaciones y portal queda explícitamente pendiente de los fixtures anonimizados de G0-03;
- el baseline anónimo versionado en [`g0-03-browser-baseline.md`](../g0-03-browser-baseline.md) pasó 24/24 combinaciones con Chromium ejecutable en `/var/tmp`, sin overflow ni errores inesperados;
- `AUTH_SURFACES_E2E=1` pasó 5/5 y `tests/quality.spec.ts` pasó 35/35 en servidores E2E aislados; esto valida auth/landing pública, no sustituye la matriz comercial autenticada;
- la corrida comercial autenticada crítica pasó 3/3 en conjunto (`tests/client-portal.spec.ts` y `tests/quotes.spec.ts`): portal privado completo, recuperación móvil y cotizador hasta PDF/descarga; la primera corrida descubrió y corrigió un defecto Axe real en el estado de carga de archivos;
- la expansión autenticada posterior pasó onboarding 2/2, dashboard 1/1, notificaciones 1/1, auditoría 1/1, mensajería staff 2/2 e identidad API 1/1; la suite de superficies de acceso pasó 5/5 tras corregir roles ARIA incompletos en la tabla de carga, overflow móvil en headers operativos/login y selectores ambiguos de DateField;
- la corrida cruzada de todas las suites autenticadas opt-in pasó 17/17 en un único servidor E2E (`E2E_PORT=3149`), incluyendo catálogo/precios con creación, vigencia y archivado de conceptos, sin errores de página ni contaminación de fixtures; esto amplía la evidencia de regresión, pero no sustituye la medición de tareas/tiempos ni los signoffs de G0;
- el runtime dirigido de primitives ejercitó `SelectField`, `DateField` (apertura/cierre con `Escape` y retorno de foco) y el diálogo de aceptación en el flujo comercial; el prototipo aislado ahora cubre React Aria/ComboBox, Tabs con teclado, focus trap/restore, SSR/hidratación, formato MXN `es-MX` y comparación de bundle/CSS; Next.js anónimo pasó 12/12, pero lector de pantalla, decisión de `lang` privado y aprobación final siguen pendientes;
- catálogo/precios quedó cubierto con `CATALOG_E2E=1`: 1/1 aislado y 17/17 en la corrida cruzada; se validaron creación/archivado de conceptos, asignación de categoría, vigencias de precio, responsive y Axe, corrigiendo la semántica ARIA de la tabla de precios;
- las pestañas staff de archivos y mensajería incorporaron navegación de teclado con `tabIndex` roving y flechas/Home/End; `STAFF_MESSAGING_E2E=1` pasó 2/2 con Axe, responsive y foco comprobados. La E2E ahora espera la confirmación real del POST antes de cerrar la conversación, eliminando una carrera que producía un `409` falso;
- el spike versionado [`spikes/private-primitives-react-aria/`](../../spikes/private-primitives-react-aria/) pasó su build aislado (569.93 kB JavaScript/175.31 kB gzip; 4.10 kB CSS/1.36 kB gzip), su matriz Playwright 3/3 viewports, relaciones semánticas de lector y `check:ssr` con hidratación en Chromium y formato MXN `es-MX`, sin overflow, warnings/errors, peticiones fallidas ni Axe serio/crítico; `check:next` pasó 12/12 rutas anónimas y registró `lang="es"` como gap; queda explícitamente pendiente revisión humana de lector de pantalla, decisión de locale privado y aprobación de la familia final;
- `npm run test:content`, verificación de enlaces Markdown relativos, estructura de secciones/tareas, code fences y `git diff --check` pasan para esta revisión;
- S0-01 sí modificó la proyección customer de portal/PDF/aceptación como contención independiente; ninguna migración, activación V2 o despliegue se ejecutó.

### 2026-09-10 — G0-01 verificado localmente

- se creó `docs/adr/2026-09-10-commercial-lifecycle-v2.md` con estado `PROPOSED` y contrato de ownership, estados, eventos, legacy y invariantes;
- se creó `tests/fixtures/commercial-workflow-v2.ts` con inventario actual, estados objetivo, 38 transiciones/eventos, 22 casos válidos e inválidos y catálogo de bloqueos;
- se creó `tests/unit/commercial-workflow-contract.test.ts`: 7 pruebas del contrato pasaron;
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (32 archivos/126 pruebas) y `npm run test:content` pasaron;
- no se modificaron schema, endpoints, permisos, UI, migraciones ni comportamiento productivo;
- el cierre de G0-01 queda pendiente de aprobación explícita del responsable de producto.

### 2026-09-10 — G0-02 preparado y bloqueado

- se creó `docs/adr/2026-09-10-commercial-policy-v1.md` con BIZ-01…BIZ-14, recomendaciones separadas de decisiones activas y no-go explícito;
- G0-02 permanece `BLOQUEADO` hasta que producto, fiscal y jurídico registren decisión, responsable, fecha, impacto y evidencia;
- no se asumieron moneda, tasa fiscal, vigencia, firmante, onboarding, SLA, scope ni términos.

## 35. Registro de decisiones/cambios

### Versión 2.0 — 2026-09-10

Reemplaza el plan del commit `ee7d06d` porque:

- el estado “aprobado” era prematuro;
- `PENDIENTE_DE_APROBACION` estaba mal interpretado;
- preparar cotización prometía un draft vacío incompatible con el dominio;
- envío/PDF/publicación estaban en orden inseguro;
- faltaba separar working/published;
- se priorizaba dashboard antes de crear sus datos;
- el piloto ocurría antes del hardening;
- flags, rollback, migración y medición no eran ejecutables;
- no se protegía formalmente la landing;
- no existía una Definition of Ready/Done suficientemente precisa.

### Reglas para cambios futuros

- cualquier cambio de norte, schema, permission o política crea/actualiza ADR;
- registrar qué reemplaza, por qué, desde qué commit y qué pruebas cambian;
- no borrar historia;
- actualizar encabezado, tablero, evidencia, riesgos y siguiente paso en el mismo commit;
- si el plan y el código divergen, detener la siguiente slice y reconciliar antes de continuar.
