# Autorrevisión crítica — Experiencia comercial V2

> **ARCHIVADO 2026-09-19:** documento histórico, conservado como evidencia de
> la auditoría original. Ver
> [`docs/ocpool-commercial-v2/plans/2026-09-19-ocpool-commercial-v3-continuacion.md`](../../ocpool-commercial-v2/plans/2026-09-19-ocpool-commercial-v3-continuacion.md)
> para el estado y el plan vigentes.

**Fecha:** 2026-09-10
**Especificación revisada:** `docs/ocpool-commercial-v2/specs/2026-09-10-ocpool-commercial-ux-rearchitecture.md`
**Plan anterior revisado:** `docs/ocpool-commercial-v2/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md` en commit `ee7d06d`
**Resultado:** la visión se conserva; el plan anterior no es apto para ejecución y debe ser reemplazado por una secuencia basada en invariantes y slices verticales.

## 1. Veredicto

La versión anterior entendía correctamente el problema de fragmentación, pero asumía como sólidos contratos que el código actual no cumple. Ejecutarla habría producido un workspace más atractivo encima de estados ambiguos, una publicación insegura y permisos incompletos.

Evaluación del plan anterior:

| Dimensión | Nota | Dictamen |
| --- | ---: | --- |
| Norte de producto | 8/10 | Correcto y aprovechable |
| Comprensión del usuario | 7/10 | Buena intención, faltan recorridos observables |
| Precisión de dominio | 3/10 | Confunde solicitud, aprobación, publicación y aceptación |
| Arquitectura de información | 6/10 | Reduce saltos, pero aún conserva universos duplicados |
| Secuencia | 4/10 | Horizontal y con dependencias circulares |
| Migración/rollback | 3/10 | Mencionados, no ejecutables |
| Criterios medibles | 5/10 | Parciales y sin baseline |
| Control de avance | 4/10 | Casillas sin estados de verificación |

Decisión: conservar monolito modular e invariantes probadas; permitir rehacer por completo las superficies privadas y los contratos de dominio que no representan el negocio correctamente.

### 1.1 Inventario de superficies privadas actuales

| Superficie | Estado actual | Problema de experiencia/contrato | Destino V2 |
| --- | --- | --- | --- |
| `/staff` | dashboard analítico, hero y KPIs | no prioriza trabajo; tipografía sobredimensionada; no logout | centro de trabajo por rol; métricas como segunda capa |
| `/staff/requests` | master/detail en estado cliente | selección/filtros se pierden; móvil apila; status dropdown; sin crear/editar | cola URL-driven + expediente profundo |
| detalle de solicitud | vive dentro de la lista | acciones dispersas; “Abrir constructor” cambia de universo; onboarding oculto | `/staff/requests/[id]` con siguiente acción y tabs |
| `/staff/quotes` | segundo master/detail y builder | vuelve a seleccionar solicitud; catálogo 50; snapshot/pricing defectuoso; manual save/send | tab quote único, search remoto, autosave y review |
| `/staff/catalog` | conceptos/listas/precios básicos | centavos; formularios técnicos; administración incompleta; archivo sin contexto suficiente | catálogo completo + policy + schedulePrice |
| `/staff/notifications` | diagnóstico de deliveries | lenguaje técnico; recuperación y enlace al folio insuficientes | utilidad de operación con contexto/deep link |
| `/staff/audit` | consulta operativa separada | correcta como utilidad, pero navegación/copy/shell duplicados | conservar dominio; integrar al shell por capability |
| `/portal` | lista y detalle en una sola página cliente | selección sin permalink; límite; hero enorme; puede exponer review | home sereno + expediente profundo publicado-only |
| propuesta portal | resumen/PDF/aceptación | download visible sin PDF; términos hardcodeados; current ambiguo | publicación exacta + acciones elegibles server-owned |
| mensajería/archivos portal | paneles embebidos | carga/acumulación sin ruta; read state ausente | tabs profundos paginados y scope propio |
| `/portal/access` | solicitud genérica de magic link | copy ya mejorado, pero onboarding sigue manual/oculto | acceso contextual automático al pedir datos/publicar |
| `/login` | credenciales + MFA visible siempre | no es challenge progresivo; shell/copy aislados | credenciales → MFA condicional → destino seguro |
| recovery/consume-link | flujos funcionales | deben compartir sistema visual y redirect profundo | conservar seguridad; unificar UI y telemetría |
| PDF | renderer `pdf-lib` V1 | marca textual, contenido truncado y términos insuficientes | documento comercial V2 completo y probado |
| APIs/servicios | módulos seguros pero CRUD/state-oriented | DTOs grandes, estados duplicados y commands compuestos ausentes | intenciones comerciales, projections y pagination |

La landing no aparece en este inventario porque está deliberadamente fuera de alcance.

### 1.2 Inspección visual fresca en navegador

El 2026-09-10 se inspeccionaron con Chromium real, en anchos de 390 y 1440 px, `/login`, `/portal/access`, `/staff` y `/portal` sin sesión. Esta evidencia no sustituye la revisión de los workspaces autenticados, pero confirma problemas estructurales de las entradas privadas:

- `/login` dedica aproximadamente media pantalla de escritorio a un bloque editorial y, en móvil, desplaza el formulario por debajo de una portada decorativa; además presenta MFA antes de que exista un challenge;
- `/portal/access` repite la misma escala editorial y obliga a recorrer una página innecesariamente larga en móvil antes de completar la tarea;
- los estados restringidos sí usan la marca oficial, pero no comparten un shell ni una semántica de regreso coherente: algunos regresos abandonan el contexto privado y llevan al sitio público;
- la jerarquía, el ritmo y la densidad observados son propios de marketing, no de una herramienta operativa de uso repetido.

Límite de evidencia: esta pasada no autenticó usuarios ni simuló datos comerciales. El baseline autenticado de solicitudes, catálogo, cotizador, aprobaciones y portal es una salida obligatoria de G0-03 mediante fixtures anonimizados y recorridos reproducibles; hasta entonces no se afirmará que esas vistas fueron validadas visualmente de extremo a extremo.

## 2. Hallazgos P0 verificados en código

### P0-01 — Una working nueva reemplaza el único puntero vigente

`Quote.currentVersionId` se actualiza en cuanto se crea una versión, y portal, descarga y aceptación usan ese mismo puntero como versión vigente.

Impacto: preparar cambios puede retirar del cliente la propuesta ya publicada antes de que exista un reemplazo válido.

Corrección normativa: `workingVersionId` y `publishedVersionId`, más publicación explícita. La publicación anterior permanece vigente durante toda revisión interna.

### P0-02 — El portal puede filtrar una revisión interna

`visibleVersions` excluye únicamente `BORRADOR`; `EN_REVISION` permanece visible y puede coincidir con `currentVersionId`.

Impacto: el cliente puede ver importes o contenido todavía internos.

Corrección normativa: el portal parte exclusivamente de `publishedVersionId` + `QuotePublication`; nunca infiere visibilidad desde un estado de edición.

### P0-03 — La UI ofrece transiciones ilegales

`StaffRequestsPanel` mantiene su propio mapa de estados, distinto del dominio. Algunas acciones terminan inevitablemente en `409`.

Impacto: el flujo guiado deja de ser confiable; el usuario aprende por error qué está permitido.

Corrección normativa: el servidor devuelve `availableActions`, `primaryAction` y `blockers`; la UI no mantiene mapas de transición.

### P0-04 — Los precios históricos pueden representarse con el catálogo actual

Al hidratar el constructor, las líneas pierden el precio snapshot como valor aplicado y la previsualización vuelve a resolver el precio de la lista vigente.

Impacto: staff, portal y PDF pueden contar historias económicas distintas; repricing ocurre sin decisión explícita.

Corrección normativa: todas las lecturas de versión usan snapshot. Repreciar es un comando explícito con comparación antes/después.

### P0-05 — Envío y PDF están en el orden equivocado

- la transición a `ENVIADA` actualiza la solicitud y emite Outbox;
- el dominio de documentos sólo permite generar PDF después de `ENVIADA`;
- la propia prueba E2E formaliza enviar primero y generar PDF después.

Impacto: el cliente puede recibir una notificación de una propuesta que aún no puede descargar ni aceptar.

Corrección normativa: congelar → aprobar → generar/verificar PDF → preflight → publicar → encolar notificación. Publicación y entrega se presentan como estados distintos.

### P0-06 — La aceptación no prueba los términos mostrados

El frontend envía `quote-terms-2026-01`; el servidor sólo valida forma y no selecciona/verifica una versión inmutable con hash.

Impacto: la evidencia no prueba qué texto aceptó el cliente.

Corrección normativa: `CommercialTermsVersion`, selección en servidor y hashes de términos/PDF/importe en la aceptación. Mantener bloqueo jurídico de lanzamiento.

### P0-07 — Falta autorización declarada en lectura de portal

El servicio valida tipo CUSTOMER y `clientId`, pero no exige explícitamente `portal.self.read`.

Impacto: el catálogo RBAC y la ejecución pueden divergir.

Corrección normativa: permiso explícito en backend y prueba negativa.

### P0-08 — El PDF aún no es una propuesta comercial robusta

- usa texto “OCPOOL” en lugar del logo oficial;
- trunca alcance a cuatro líneas;
- carece de términos, exclusiones, garantías y pagos estructurados;
- no demuestra textos extensos, 100 conceptos ni paginación integral.

Impacto: aun si es técnicamente descargable, no cumple el estándar comercial buscado.

Corrección normativa: workstream PDF dedicado con marca, contenido estructurado, snapshot completo, fixtures extremos y revisión visual.

### 2.1 Mapa reproducible de evidencia P0

| Hallazgo | Evidencia primaria actual | Prueba que hoy fija o revela el comportamiento |
| --- | --- | --- |
| P0-01 puntero working/publicada | `src/server/modules/quotes/service.ts` mueve `currentVersionId` al crear; access/acceptance también resuelven ese puntero | falta la prueba de nueva working que conserva descargable/aceptable la publicación anterior |
| P0-02 filtro portal | `src/server/modules/client-portal/service.ts` excluye sólo `BORRADOR` y busca el puntero actual dentro de ese resultado | las pruebas de portal sólo cubren la versión después de `ENVIADA`; falta la negativa obligatoria para `EN_REVISION` |
| P0-03 acciones ilegales | `src/components/StaffRequestsPanel.tsx` contiene `NEXT_STATUS_OPTIONS`; `src/server/modules/quote-requests/domain.ts` conserva la autoridad real | pruebas de dominio cubren backend, pero no demuestran que cada botón visible sea exitoso |
| P0-04 snapshot representado con precio vigente | `src/components/StaffQuotesPanel.tsx` rehidrata `unitPriceMinorOverride` vacío y calcula con `pricesByItem` de la lista consultada | `tests/integration/quotes-service.test.ts` prueba persistencia backend, no fidelidad al reabrir la UI |
| P0-05 aviso antes de PDF | `src/server/modules/quotes/domain.ts` permite `EN_REVISION → ENVIADA`; `quotes/service.ts` emite Outbox; `quote-documents/domain.ts` sólo permite PDF desde estados enviados | `tests/quotes.spec.ts` formaliza enviar y después generar |
| P0-06 términos elegidos por navegador | `src/components/ClientQuoteActions.tsx` hardcodea `TERMS_VERSION`; route/domain validan patrón, no un registro inmutable | pruebas de aceptación aceptan la cadena enviada por el cliente |
| P0-07 permiso portal omitido | `src/server/modules/client-portal/service.ts` aplica scope de cliente sin una exigencia explícita de `portal.self.read` | `tests/integration/client-portal-service.test.ts` obtiene datos con un actor CUSTOMER cuyo set de permisos está vacío |
| P0-08 PDF comercial incompleto | `src/server/modules/quote-documents/pdf-renderer.ts` dibuja “OCPOOL” como texto y limita alcance con `slice(0, 4)` | `tests/unit/quote-pdf-renderer.test.ts` no cubre logo ni el set extremo de contenido |

Las rutas anteriores son anclas de auditoría, no una orden de parchear todo en esos mismos archivos. La rearquitectura puede reemplazarlos bajo los gates del plan.

## 3. Hallazgos P1

### Flujo y navegación

- no existe `staff/layout.tsx`; cada pantalla duplica su cabecera;
- staff no tiene logout visible;
- el logo/regreso puede llevar a la landing cuando el usuario espera el dashboard;
- selección y filtros viven sólo en estado React;
- master/detail apilado en móvil no ofrece retorno claro;
- “Solicitudes” y “Cotizaciones” duplican selección y contexto;
- no existe alta manual de solicitud aunque `requests.create` y `STAFF_CREATED` existen.

### Cotizador y catálogo

- sólo se precargan 50 conceptos;
- importes se piden como centavos o se transforman eliminando caracteres;
- impuesto se presenta como `IVA pb`;
- no se conserva `sourcePriceListId`, posición, precio base/override ni motivo;
- toda línea requiere catálogo global;
- faltan secciones, condiciones, exclusiones, garantías y templates prometidos originalmente;
- no existe programación atómica de un nuevo precio;
- listas y categorías no tienen administración completa.

### Operación y permisos

- ventas no puede proponer descuento: `quotes.apply_discount` es de gerencia;
- quien puede aplicar también puede aprobar, sin separación real;
- invitar cliente requiere `identity.users.manage`, demasiado amplio;
- ventas puede ver/reasignar globalmente sin política de scope diferenciada;
- se puede asignar a un empleado activo que no tenga permisos comerciales;
- “Solicitar información” cambia estado sin exigir mensaje ni garantizar aviso.

### Concurrencia e idempotencia

- dos pestañas usan último guardado gana;
- la idempotencia no siempre vincula la clave con el hash del payload;
- no hay recibo de comando uniforme;
- una versión `EN_REVISION` no bloquea necesariamente crear otra revisión de manera coherente.

### Portal y work center

- portal carga como máximo 25 solicitudes sin una navegación completa;
- no existen deep links de notificaciones al expediente exacto;
- el dashboard es analítico, no una cola de trabajo;
- “no leído”, prioridad y SLA son promesas sin modelo;
- el logout del portal puede ocultar un fallo de revocación real;
- login muestra MFA incluso cuando no se ha solicitado el challenge.

## 4. Hallazgos P2

- títulos de 80–122 px en herramientas operativas;
- metadata de 8–12 px y controles menores al objetivo táctil;
- 1,800+ líneas en `globals.css` mezclan marketing y producto privado;
- grandes componentes cliente generan waterfalls después de hidratación;
- formatters, etiquetas y lógica de presentación están duplicados;
- datepicker y diálogos custom no garantizan foco/restauración uniforme;
- timezone se mezcla entre UTC, navegador y `APP_TIMEZONE`;
- errores pierden código/requestId y pueden aparecer lejos de la acción;
- navegación móvil desaparece o se vuelve una página muy larga;
- iconografía y logo no siguen un contrato único.

## 5. Contradicciones corregidas del plan anterior

| Plan anterior | Evidencia real | Corrección |
| --- | --- | --- |
| Estado “aprobado para ejecución” | R0 contenía decisiones abiertas | Estado bloqueado hasta G0 |
| `PENDIENTE_DE_APROBACION` = descuento | Es puente instantáneo de aceptación | Aprobación en entidad propia; retirar ese uso |
| Preparar cotización crea borrador vacío | Dominio exige al menos una línea y precio válido | Abrir workspace/defaults; crear al primer contenido válido |
| `COTIZACION_DISPONIBLE` = lista por compartir | Hoy se establece al marcar `ENVIADA` | Publicación explícita separada de entrega |
| `VENCIDA` → crear nueva versión | `VENCIDA` es terminal en solicitud | Clonar versión publicada; solicitud no copia vencimiento |
| Dashboard primero | Sus colas dependen de modelos aún inexistentes | Dominio/proyecciones antes de work center |
| Feature flags en fase tardía | Riesgo desde el primer cambio | Flags desde la primera migración/UI |
| Piloto antes del hardening | Calidad se validaba después | Gate premium completo antes del piloto |
| Una acción por estado | Acción depende de actor, entrega, mensajes y bloqueos | Resolver multi-señal con actor esperado |
| Guardado explícito | Añade clics y no evita pérdida | Autosave con revisión optimista |
| Proyecto mínimo | No existe entidad ni contrato | Módulo real o acción oculta |

## 6. Decisiones de arquitectura revisadas

### Se conservan

- Next.js App Router como monolito modular;
- PostgreSQL/Prisma;
- servicios de dominio como autoridad;
- sesiones persistidas, MFA, RBAC deny-by-default;
- snapshots, Outbox, auditoría, storage privado y URL efímera;
- separación de portal y staff;
- landing sin cambios.

### Se reemplazan o amplían

- páginas aisladas → expediente con ruta profunda;
- `currentVersionId` ambiguo → working/published;
- transiciones locales → acciones proyectadas por servidor;
- “enviada” ambiguo → documento/publicación/entrega separados;
- aprobación implícita → entidad auditable;
- términos hardcodeados → versión inmutable;
- guardado manual → autosave con conflicto explícito;
- catálogo precargado → búsqueda remota completa;
- centavos/basis points → campos comerciales localizados;
- CSS global mezclado → sistema privado aislado;
- headers duplicados → shells compartidos;
- tests opt-in omitidos → CI premium determinista.

## 7. Revisión de sobrearquitectura

La especificación no recomienda microservicios, event sourcing ni una SPA separada. Los nuevos conceptos existen porque representan verdades ya diferentes en la operación:

- working/published evita exposición y pérdida de propuesta;
- approval evita autorización pasiva;
- publication evita confundir disponibilidad con email;
- terms version prueba evidencia;
- revision evita pérdida por concurrencia;
- project sólo se crea si existe un handoff verdadero.

Se evita, por ahora:

- multiempresa;
- membresía cliente múltiple sin caso confirmado;
- cache cliente global;
- tiempo real/WebSockets;
- motor BPM configurable;
- CRM genérico;
- editor WYSIWYG libre para términos;
- importación masiva antes de estabilizar catálogo individual.

## 8. Trazabilidad hacia el nuevo plan

| Hallazgo | Debe cerrarse en |
| --- | --- |
| Visibilidad interna/publicada | S0 y D1 |
| Snapshot financiero | S0, D1 y Q1 |
| Transiciones UI/backend | S0 y D2 |
| PDF antes de publicación | S0 y P1 |
| Términos/aceptación | S0, D1 y C1 |
| Permiso portal | S0 |
| Scope/RBAC | G0 y D2 |
| Shell, logout, logo, back | U1 |
| URL/deep links | U1 y R1 |
| Solicitud manual/edición | R1 |
| Autosave/concurrencia | D1 y Q1 |
| Catálogo completo/dinero | K1 y Q1 |
| Aprobación | A1 |
| Portal | C1 |
| Work center | W1 |
| Proyecto | J1 |
| Hardening/piloto/rollout | H1, T1, O1 |

## 9. Riesgos aún abiertos

| Riesgo | Tratamiento |
| --- | --- |
| Datos actuales ya inconsistentes | Reconciliación y reporte antes de backfill; no contrato destructivo |
| Cambio grande de modelo | Migraciones expand/backfill/contract y dual-read temporal |
| Dos UIs coexistentes | Flags server-side y fallback por cohorte |
| Dependencia visual nueva | Spike SSR/bundle/a11y y ADR antes de adopción |
| Política fiscal incorrecta | Gate G0; no hardcodear |
| Evidencia legal insuficiente | Gate jurídico; no declarar equivalencia contractual |
| Email falla tras publicar | Publicación sigue disponible; entrega separada y reintento idempotente |
| Storage falla durante preparación | publicación bloqueada; lease/recovery de documento |
| Landing alterada por CSS | estilos privados aislados y visual regression obligatoria |
| Scope crece a CRM/obra completo | contratos explícitos y no-go de cada slice |

## 10. Condición de go/no-go

### No-go inmediato

No iniciar el rediseño visual completo mientras no existan pruebas rojas y correcciones para:

1. una revisión interna nunca aparece en portal;
2. una nueva revisión no retira la publicación anterior;
3. staff representa precios históricos desde snapshots;
4. UI no presenta acciones ilegales;
5. el portal exige `portal.self.read`;
6. el envío no puede notificarse sin documento verificable;
7. términos manipulados por cliente son rechazados.

### Go para el primer slice

Puede comenzar S0 cuando:

- el master plan actualizado sea la fuente operativa;
- G0 registre responsables y decisiones que afecten el P0;
- exista un baseline de pruebas reproducible y navegador instalado;
- la bandera/fallback y rollback estén definidos;
- la landing tenga baseline congelado.

## 11. Conclusión

La especificación revisada sí establece un norte consistente: producto privado orientado a tareas, una sola unidad de trabajo, dominio separado por responsabilidades y calidad verificable. No promete que el producto ya está terminado. El siguiente paso correcto es cerrar G0 y ejecutar S0 antes de construir la nueva apariencia.
