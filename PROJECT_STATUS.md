# OCPOOL — Estado del proyecto

> Fuente única de seguimiento del proyecto de plataforma comercial. Este archivo se actualiza después de cada fase, vertical slice y verificación relevante.

## Estado actual

- **Fase:** Iniciativa Experiencia Comercial V2 — G0 (gobierno, decisiones y baseline) activa; las Fases 1–17 permanecen cerradas para su alcance local.
- **Estado:** la auditoría crítica de código, dominio, UI/UX y plan quedó documentada; se creó la especificación normativa, su autorrevisión y un plan maestro V2 ejecutable por gates. G0-01 está `APPROVED_LOCAL_PRODUCT` con ADR, fixture y pruebas verdes; G0-02 está aprobado para políticas de producto y permanece bloqueado sólo por fiscalía/jurídico en BIZ-03, BIZ-04, BIZ-09 y BIZ-10. G0-03 tiene matriz, fixture, diccionario de 13 métricas, baseline anónimo 24/24 y una muestra mínima local de 65 registros PII-safe (`13 × n=5`) con objetivos de §29 aprobados localmente; permanece `VERIFIED_LOCAL_PARTIAL` hasta el piloto real y el cierre formal. G0-04 está `APPROVED_LOCAL` con primitives por patrón y `lang="es-MX"` SSR en superficies privadas. En paralelo quedaron implementados y verificados localmente el snapshot financiero S0-02, las acciones server-owned S0-03, los punteros working/published, la aprobación de descuentos y el PDF v2; no están activados por flag ni sustituyen los signoffs de G0. La contención S0-01 continúa impidiendo exponer versiones internas al customer. El producto aún no está listo para lanzamiento y conserva los bloqueos externos previamente documentados.
- **Última actualización:** 2026-09-15.
- **Rama de implementación:** `main`.
- **Integración de servidor:** `main` conserva el dominio `ocpool.com.mx`, el correo `contacto@ocpool.com.mx`, el arranque local en `127.0.0.1:3008` y la ausencia del endpoint legado `/api/send-email`. El pase de consolidación S0/U1/R1 (2026-09-14) y K1-01 (2026-09-15) ya quedaron comiteados a `main` en slices revisables; el worktree conserva únicamente 15 eliminaciones de assets de marketing (PDF de portafolio y fotos de galería) ajenas a este trabajo, sin resolver a la espera de decisión del responsable del repositorio.
- **K1-01 — Search API completa 2026-09-15:** se corrigió el defecto original que motivó la auditoría de UX: el constructor de cotizaciones (`StaffQuotesPanel.tsx`) precargaba una sola página de 50 conceptos y nunca repaginaba ni buscaba, dejando inalcanzable cualquier concepto posterior. Se añadió `searchQuoteCatalogItems` (paginado por cursor, precio vigente resuelto por `priceListId` o `blocker: 'NO_PRICE_IN_LIST'` tipado, nunca se omite un concepto silenciosamente) y un combobox accesible real (`CatalogItemSearchCombobox`, patrón ARIA combobox/listbox con búsqueda remota debounced) que sustituye el `<select>` estático. Las líneas del borrador ahora llevan nombre/código/unidad denormalizados desde el propio snapshot de versión, eliminando la necesidad de mantener un catálogo completo en memoria. Verificado con un catálogo de 56 conceptos: unitarias (`catalog-search-service.test.ts`), integración HTTP (`catalog-api.test.ts`) y E2E de navegador real confirman que un concepto en la posición 56 es alcanzable por texto. `npx tsc --noEmit`, `npm run lint`, `190/190` unitarias, `102/102` integraciones (`43/43` archivos) y E2E de `quotes.spec.ts`/`catalog.spec.ts` en verde. K1-02 (`schedulePrice`), K1-03 (administración completa de `/staff/catalog`) y K1-05 (concepto especial) quedan como trabajo futuro; K1-04 (política e impuestos) permanece bloqueado por BIZ-03/BIZ-04 (fiscalía) — no se inventó tasa ni perfil fiscal. La fase K1 en el tablero maestro permanece `DISEÑADO` hasta cerrar el resto de sus sub-tareas; esto no cierra Gate K1 ni ningún gate formal.
- **Revisión 2026-09-09:** se mejoró el cierre del formulario público para explicar el folio, el alta del portal y el enlace de un solo uso; se añadió `no-store` a health/readiness, se ocultó `X-Powered-By` y se documentó el límite seguro entre build y reinicio. La mezcla de propietarios en `.next` se corrigió y el proceso PM2 fue reiniciado como `web_front` con el build vigente.
- **Revisión adicional 2026-09-09:** las respuestas JSON de autenticación y los errores públicos ahora declaran `cache-control: no-store`; la cobertura unitaria verifica que los errores no puedan quedar almacenados por un proxy.
- **Verificación pública posterior al despliegue:** `ocpool.com.mx` y `www.ocpool.com.mx` responden `200` en la landing y health; las rutas `/portal`, `/portal/access`, `/login`, `/login/recovery`, `/auth/customer/consume-link`, `/auth/recovery`, `/staff`, `/staff/requests`, `/robots.txt` y `/sitemap.xml` responden `200`; los 12 assets estáticos referenciados responden `200`, HSTS está activo y no se expone `X-Powered-By`. La validación de interacción con navegador real queda como prueba manual final, no como evidencia sustituida por HTTP.
- **Ajuste de onboarding 2026-09-09:** `/portal/access` ya distingue un cliente nuevo sin cuenta de un cliente cuyo portal ya fue habilitado; el botón y la confirmación no prometen un enlace inmediato antes de la revisión staff. El modelo continúa requiriendo habilitación explícita desde el expediente para crear la cuenta `CUSTOMER` invitada y emitir el enlace de un solo uso.
- **Claridad de mensajes 2026-09-09:** el folio ahora se presenta como identificador no autenticante; el formulario indica que el cliente nuevo no necesita hacer nada más mientras se revisa la solicitud; staff y notificaciones explican la secuencia habilitación → enlace → portal.
- **Revisión UI/UX 2026-09-09 (baseline histórico):** se consolidó de forma incremental la identidad visual de las superficies privadas con el logo oficial en encabezados, estados restringidos y estados vacíos; staff añadió retorno visible al dashboard y navegación entre módulos, mientras portal conservó el regreso al sitio público. Se mantienen intactos la landing y sus controles públicos. Typecheck, lint, build, 119 unitarias y contrato de contenido pasaron; la prueba E2E foundation requería liberar el puerto local 3100. Este cierre describe aquel alcance incremental y no constituye aprobación del flujo o diseño V2; la auditoría del 2026-09-10 lo reemplaza como autoridad para el trabajo futuro.
- **Experiencia Comercial V2 2026-09-10:** una segunda auditoría encontró bloqueadores previos al rediseño: `currentVersionId` mezcla borrador y publicación, el portal puede proyectar `EN_REVISION`, el flujo notifica antes del PDF, el constructor puede representar precios vigentes en lugar del snapshot, los términos dependen del navegador y la UI ofrece transiciones distintas al backend. La nueva [`especificación`](docs/ocpool-commercial-v2/specs/2026-09-10-ocpool-commercial-ux-rearchitecture.md), [`autorrevisión`](docs/ocpool-commercial-v2/reviews/2026-09-10-ocpool-commercial-ux-rearchitecture-review.md) y [`plan maestro integrado`](docs/ocpool-commercial-v2/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md) separan working/published, aprobación, documento, publicación, delivery y aceptación; fijan expediente único, shell privado, catálogo contextual, autosave concurrente, portal profundo, gates premium, piloto y rollout. Una inspección local con Chromium a 390 y 1440 px confirmó los problemas de escala, longitud y regreso de las entradas privadas sin sesión; los flujos críticos pasan 3/3, la suite de acceso pasa 5/5 y la expansión autenticada pasa onboarding 2/2, dashboard 1/1, notificaciones 1/1, auditoría 1/1, mensajería staff 2/2 e identidad API 1/1. Esa expansión corrigió roles ARIA incompletos, overflow móvil en headers operativos/login y selectores ambiguos de fechas. La medición completa, objetivos y decisiones de producto siguen pendientes. La landing está explícitamente congelada. En ese corte ninguna implementación V2 se consideraba iniciada; la habilitación local controlada posterior queda registrada abajo y no activa producción.
- **Baseline G0-03 2026-09-10/11:** se creó [`ADR de baseline`](docs/adr/2026-09-10-commercial-g0-baseline.md), [`ADR de objetivos locales`](docs/adr/2026-09-11-commercial-g0-03-objectives.md), [`fixture de escenarios y métricas`](tests/fixtures/commercial-baseline-v2.ts) y [`prueba de contrato`](tests/unit/commercial-baseline-contract.test.ts). La matriz cubre ocho superficies (landing pública + siete privadas), tres viewports, diez escenarios, trece métricas, cuatro perfiles de volumen y reglas de telemetría sin PII. El fixture valida muestras sintéticas con 13 campos requeridos, exige una métrica conocida por escenario y rechaza PII de forma recursiva; el recorder opt-in cubre solicitud pública, solicitudes staff, cotizador, portal y notificaciones bajo `test-results/`. El baseline anónimo de navegador pasó 24/24 y la suite autenticada de acceso 5/5; las suites de medición pasaron pública 35/35, solicitudes 1/1, portal+cotizador 3/3, notificaciones 1/1, una repetición del cotizador 1/1 en build fresco y una repetición final del portal 4/4. La muestra mínima posterior reúne 65 registros PII-safe (`13 métricas × n=5`) en corridas independientes y los objetivos de §29 quedaron aprobados localmente. Se verificaron diez conceptos, recuperación de PDF fallido, aprobación con separación de funciones, un error recuperable de aceptación, una cotización vencida con actualización por conversación y una sesión de abandono válida; el piloto T1 y la instrumentación productiva siguen fuera de alcance.
- **Aprobación de descuentos A1-01/A1-02 2026-09-11:** se añadió [`ADR del dominio`](docs/adr/2026-09-11-quote-approval-domain.md), migración `20260911090000_quote_approvals`, servicio con digest del snapshot, API de solicitud/decisión, auditoría/Outbox e invalidación automática al editar. El constructor staff muestra el siguiente paso y el estado de aprobación dentro del expediente; el envío rechaza descuentos sin aprobación vigente y la autoaprobación se bloquea en servidor. `npx vitest run tests/integration/quotes-service.test.ts --maxWorkers=1` pasó 3/3, incluyendo idempotencia, stale digest y envío final; no se activó flag ni se tocó la landing. Umbrales/permisos finales, cola global y baseline de producto siguen pendientes.
- **Punteros working/published P0-01 2026-09-11:** se añadió [`ADR de punteros`](docs/adr/2026-09-11-quote-working-published-pointers.md) y migraciones expand/backfill + FK compuestas `20260911093000_quote_working_published_pointers` y `20260911094000_quote_pointer_integrity`. Las nuevas versiones escriben `workingVersionId`, el envío mueve `publishedVersionId`, staff conserva contexto para crear una nueva versión y portal/PDF/aceptación prefieren la publicada. Se preserva `currentVersionId` sólo como compatibilidad temporal. Los servicios dirigidos de cotización, staff, portal y aceptación pasaron 6/6; schema local quedó en 20 migraciones. La retirada del campo legacy requiere un gate posterior.
- **Términos de aceptación P0-06 2026-09-11:** se añadió [`ADR de términos controlados`](docs/adr/2026-09-11-quote-terms-server-owned.md). El servidor es dueño de `quote-terms-2026-01`, el portal recibe esa versión y una etiqueta humana desde el backend, y la aceptación rechaza identificadores distintos; el navegador ya no define la evidencia. La aprobación del texto y del registro jurídico versionado sigue bloqueada por BIZ-10.
- **Publicación con preflight PDF P0-05 2026-09-11:** se añadió [`ADR de publicación`](docs/adr/2026-09-11-quote-publication-preflight.md). La ruta que envía una cotización prepara/verifica o reutiliza el PDF antes de cambiar a `ENVIADA` y emitir los eventos de publicación; el constructor ya muestra el documento listo inmediatamente después de enviar. La primitive de transición directa se conserva sólo para compatibilidad interna pendiente de migración.
- **Snapshot financiero y acciones server-owned S0-02/S0-03 2026-09-11:** el constructor conserva el precio aplicado de la línea al rehidratar un borrador aunque el catálogo cambie; `tests/quotes.spec.ts` pasó 1/1 con ese caso y nueva versión. El detalle de solicitudes recibe del backend `availableStatusTransitions` y `availableActions`, y la UI ya no mantiene el mapa de transiciones como autoridad; la integración dirigida pasó 2 archivos/7 pruebas y `tests/requests.spec.ts` pasó 1/1 en 390/768/1440 px sin overflow, Axe serio ni errores de consola. Se corrigió el título móvil que mantenía escala de escritorio. Estos verticales son implementación local verificable, no activación productiva ni cierre de Gate G0/S0.
- **Aprobación local G0-01/G0-02 2026-09-11:** la autorización explícita del responsable de la iniciativa aprobó el ciclo canónico y las políticas de producto BIZ-01, BIZ-02, BIZ-05…BIZ-08, BIZ-11…BIZ-14 para slices locales. BIZ-03/BIZ-04 permanecen bloqueadas por fiscalía y BIZ-09/BIZ-10 por jurídico; no se inventan tasas, firmantes ni términos.
- **PDF comercial P0-08/S0-04 2026-09-11:** `quote-pdf-v2` embebe el logo oficial de OCPOOL y pagina todo el alcance, eliminando el truncado silencioso de cuatro líneas. El renderer pasó 4/4 pruebas, incluyendo contenido extenso; las integraciones dirigidas de generación/publicación pasaron 2 archivos/3 pruebas y el E2E del constructor continuó 1/1. La plantilla comercial estructurada completa, recuperación operativa y aprobación jurídica siguen pendientes; no se activó producción.
- **Cobertura autenticada G0-03 2026-09-11:** la repetición del cotizador pasó `5/5` en cada recorrido instrumentado; la solicitud pública, solicitudes staff, portal y notificaciones también pasaron `5/5`. La muestra consolidada es de 65 registros PII-safe (`13 métricas × n=5`), con expiración guiada, abandono válido, error recuperable, diez conceptos, fallo/recuperación de PDF, aprobación con dos sesiones y recuperación de entrega. Los objetivos de §29 quedaron aprobados localmente; el piloto T1, la comparación estadística y el cierre formal de G0-03 siguen pendientes.
- **Primitivas privadas G0-04 2026-09-11:** se aprobó localmente el fallback por patrón: Radix para Select, react-day-picker para DatePicker y wrappers propios auditados para Dialog/Tabs. El spike aislado de React Aria/Lucide pasó 3/3 viewports, teclado, focus restore, SSR/hidratación, responsive y Axe; la revisión humana fue aceptada por autorización explícita. `check:next` pasó 12/12 rutas en 390/1440 px con `lang="es-MX"` SSR, sin overflow, errores de página ni peticiones fallidas; la landing conserva `lang="es"` y no se añadieron dependencias al root.
- **Catálogo y precios G0-03 2026-09-10:** se añadió [`catalog.spec.ts`](tests/catalog.spec.ts) como recorrido opt-in desechable. Pasó 1/1 aislado y quedó incluido en la regresión cruzada 17/17: categoría/concepto, lista de precios MXN, validación de vigencia invertida, guardado de vigencia válida, archivado, Axe, responsive 390/768/1440 y consola limpia. La prueba descubrió y se corrigió la semántica ARIA incompleta de la tabla de precios; no se modificó la landing.
- **Pestañas privadas 2026-09-10:** archivos y mensajería staff ahora ofrecen navegación de teclado (`ArrowLeft`/`ArrowRight`/`Home`/`End`) con selección y foco sincronizados. La suite `STAFF_MESSAGING_E2E=1` pasó 2/2, incluyendo ambos paneles, Axe, responsive y consola limpia; la prueba también espera la confirmación real del POST antes de cerrar la conversación para evitar carreras `409`. El prototipo comparativo de G0-04 ya está versionado y pasa su matriz CSR/SSR aislada y formato numérico `es-MX`; Next.js anónimo pasó 12/12, registrando `lang="es"`; lector de pantalla, decisión de locale y decisión final siguen pendientes.
- **Gate G0-05 2026-09-10/11:** se añadieron [`flags server-side fail-closed`](src/server/flags/commercial-v2.ts), [`pruebas de flags`](tests/unit/commercial-v2-flags.test.ts), [`gate local`](scripts/quality-gate-v2.mjs) y [`manifiesto reproducible de landing`](docs/ocpool-commercial-v2/landing-freeze.md). El gate fresco aislado en `3195` dejó typecheck, lint, 143 unitarias, contenido y baseline HTTP 10/10 verdes; permanece `BLOCKED` deliberadamente por el piloto T1 y los signoffs fiscal/jurídicos. Ninguna flag está conectada a UI o telemetría.
- **Preparación U1/R1 2026-09-11:** se registró [`ADR de entrada U1/R1`](docs/adr/2026-09-11-u1-r1-entry-readiness.md) con auditoría de rutas privadas, brechas reales, contratos reutilizables, fallback, no-go y orden de implementación. U1/R1 quedan `PREPARADO_LOCAL`; la UI nueva permanece detrás de sus flags fail-closed y la telemetría sigue sin activarse hasta el cierre formal de G0.
- **Fundamento U1-01/U1-02 2026-09-11:** se creó [`private/ui`](src/components/private/ui/) con tokens semánticos, primitives accesibles y estados privados bajo un namespace aislado, junto con el mapa de navegación por capabilities. El endpoint aditivo de capabilities pasó integración 3/3 con separación RBAC y payload seguro. Desde la habilitación local controlada, el stylesheet se carga sólo desde los layouts de `/auth`, `/login`, `/portal`, `/staff` y el harness privado de desarrollo, nunca desde el layout público raíz; el fallback permanece intacto. Typecheck, lint, build, contenido y la suite local quedan verdes en 37 archivos/149 pruebas.
- **Slice local U1-01/U1-03 2026-09-11:** con autorización explícita para continuar sólo en la computadora local, se conectó el aislamiento de estilos a layouts privados/auth y se corrigió el destino contextual del logo del shell (`/staff` o `/portal`) con nombre accesible. `commercialWorkspaceV2` continúa apagada por defecto, no se tocó la landing, no hubo push/deploy, el contrato nuevo pasó 2/2 pruebas dirigidas y el baseline anónimo de Chromium pasó 24/24 en 390/768/1440 px, sin overflow, errores de página ni respuestas inesperadas.
- **Harness local U1-06 2026-09-12:** se añadió `/private-shell-harness` como ruta sólo de desarrollo, con layout privado propio, contextos sintéticos y sin Prisma, APIs ni datos reales; en producción devuelve 404. El comando dedicado `npm run test:e2e:private-shell` lo ejecuta con `next dev` y pasó `2/2` para staff y portal con reduced motion, menú móvil, navegación por teclado, objetivos táctiles, Axe sin violaciones `critical/serious`, consola limpia, cero overflow en 360/390/768/1024/1440 px y una anchura efectiva de 180 px para la comprobación de zoom 200%. El runner E2E de producción omite el harness por diseño y la regresión opt-in completa pasó `57/57`, con sólo esos `2` casos omitidos. El harness no sustituye la cobertura autenticada ni activa flags. No hubo push, deploy ni cambio en producción.
- **Slice local R1-01/R1-02 2026-09-12:** la cola V2 quedó conectada al contrato compartido de URL con vistas, búsqueda, etapa, responsable, antigüedad, orden, paginación y normalización fail-closed; el servicio aplica rangos exclusivos/inclusivos y orden determinista. La ruta profunda `/staff/requests/[requestId]` conserva contexto al volver y ofrece `summary`, `quote`, `conversation`, `files` y `activity`; conversación/archivos reutilizan paneles protegidos y cotización carga sólo al activar la tab. Se añadió selector de responsable usando el directorio staff autorizado, sin habilitarlo para perfiles que no pueden consultarlo. Contratos unitarios `5/5`, typecheck, lint, build, integración completa `42/42` archivos/`89/89` pruebas, E2E V2 `2/2` y E2E general `35/35` ejecutables pasan; foundation `2/2`. La suite V2 permanece opt-in y las flags siguen apagadas por defecto; la landing no cambió y no hubo push, deploy ni mutación de producción.
- **Slices locales R1-03/R1-04/R1-05/R1-06/R1-08 + base R1-07 2026-09-13:** la admisión manual aplica dedupe explícito, auditoría segura y redirect canónico; la edición comercial conserva control de concurrencia, motivo y before/after sin PII; tomar/reasignar usa permisos separados, bloqueo transaccional y motivo; `Solicitar información` combina campos faltantes, mensaje, acceso opcional al portal, estado, historial, auditoría y Outbox en una sola transacción idempotente. El estado `INFORMACION_REQUERIDA` ya no puede forzarse por el endpoint genérico. Conversación conserva draft al cambiar de tab y pagina por cursor; archivos y actividad usan cursores estables; staff y portal muestran progreso, scan y reintento idempotente de cargas; la intención de información tiene semántica accesible y foco restaurable; avisos staff pueden profundizar al expediente sólo cuando ambas flags V2 están activas y mantienen fallback legacy apagado. Verificación actual: `40/40` archivos y `185/185` unitarias, `42/42` archivos y `95/95` integraciones, E2E V2 `5/5` (incluye dedupe visible, decisión explícita y reutilización de contacto), portal autenticado `4/4`, staff de mensajería/archivos `2/2`, E2E general `35/35` ejecutables con `29` omitidos por opt-in, foundation `2/2`, typecheck, lint, build, audit y diff-check PASS. R1-07 tiene cobertura técnica local ampliada, pero R1 no se marca terminado hasta cerrar su checklist formal; flags por defecto apagadas, landing intacta y sin push/deploy.
- **Pulido de experiencia y resiliencia V2 2026-09-13:** los mensajes compartidos reutilizan la misma clave de idempotencia durante un reintento explícito y la rotan al editar, cambiar de visibilidad o completar; los errores de API de las superficies V2 conservan la referencia de solicitud cuando está disponible. Los módulos heredados de conversación/archivos reciben dentro del namespace privado objetivos táctiles mínimos de `44px`, sin alterar las rutas públicas ni el CSS global. En tabs distintas de Resumen, las acciones operativas se presentan contraídas y se pueden expandir bajo demanda, reduciendo scroll y carga cognitiva; Resumen conserva la acción abierta para el flujo principal. La cola guarda y restaura el scroll por consulta al volver del expediente. Contratos, typecheck, lint, build y E2E V2 se repitieron en local; el cierre formal de R1/G0 permanece abierto por checklist, piloto y aprobaciones externas.
- **Cabecera contextual del expediente 2026-09-13:** se consolidó el patrón R1-02 en `RequestWorkspaceHeaderV2`: regreso, folio, estado, cliente, proyecto, etapa, responsable, siguiente actor y atención quedan en una única jerarquía; la acción primaria se selecciona sólo de las capacidades/transiciones autorizadas por servidor y el resto se agrupa en un menú accesible con foco inicial, flechas, Home/End, Escape, clic externo y devolución de foco. Las acciones que requieren formulario expanden el bloque operativo y enfocan el campo correcto, incluso desde tabs secundarias; el panel oculta sólo el control duplicado de la acción primaria. La regresión E2E V2 pasó `5/5` después de añadir cobertura explícita del menú y dedupe; la prueba unitaria quedó en `185/185`; build, lint y typecheck permanecen verdes. Esta mejora reduce repetición y conserva el fallback legacy; no activa flags ni modifica producción.
- **Matriz de alcance BIZ-08 2026-09-13:** se formalizó [`request-workspace-idor-matrix.md`](docs/ocpool-commercial-v2/request-workspace-idor-matrix.md) y se enlazó al contrato unitario. `requests.read.global` deja la vista global en Gerencia/Administración; Ventas queda en propias + sin asignar. La regla server-owned cubre cola, detalle, actividad, acciones, mensajería, archivos, cotizaciones, aprobaciones, PDF y onboarding; las listas combinan scope con búsqueda/filtros y las mutaciones vuelven a validar después del lock. La verificación local queda en `185/185` unitarias y `95/95` integraciones; falta sólo la aprobación formal del gate R1, piloto T1 y signoffs externos.
- **Pase de consolidación (hardening) 2026-09-14:** auditoría crítica del working tree de S0/U1/R1 seguida de correcciones dirigidas, sin features nuevas. Se corrigió un defecto real de cara al cliente (`ClientPortalPanel` mostraba el estado `CONVERTIDA_EN_PROYECTO` sin traducir y aceptaba un `ENVIADA` inválido) unificando `QUOTE_REQUEST_STATUS_LABELS`/`requestWorkspaceStatusActionLabel` como fuente única en 6 componentes. Se consolidaron cuatro duplicaciones de lógica (`pathMatches`, generación de idempotency-key en cliente y servidor, roving-tabindex de tabs) en utilidades compartidas (`src/lib/idempotency-key.ts`, `src/server/http/idempotency.ts`, `nextRovingTabIndex`), aplicando además navegación por teclado a los tabs del expediente (`RequestWorkspaceDetailV2`). Se corrigió el token `--private-font-display` (referenciado, nunca definido) y se añadió una prueba de contrato que compara `PRIVATE_UI_TOKENS` contra `private-ui.css` para que ambas fuentes no puedan divergir en silencio. Se unificó la clasificación de errores del workspace de solicitudes (`src/lib/request-workspace-error.ts`) en `forbidden`/`not_found`/`transient` por status HTTP real, reemplazando una detección fragil por texto y haciendo alcanzable el estado "expediente no encontrado". Se endureció la cobertura de seguridad del patrón de scope (`request-scope.ts`), antes concentrada en un solo archivo de pruebas: se añadieron casos dirigidos para `quotes-staff-service`, `private-files-service`, aprobaciones de descuento, generación de PDF y el endpoint `GET .../activity` (antes sin ninguna invocación real de su route handler), además de un caso HTTP compuesto para el modo de filtro "workspace query". Se corrigió además un test unitario intermitente (`quote-pdf-renderer.test.ts`) por margen de timeout insuficiente bajo carga paralela. Verificación: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` (`194/194`, 3 corridas consecutivas) y `npm run test:integration` (`101/101`, `42/42` archivos) en verde. Este pase no cierra ningún gate formal ni activa flags; el piloto T1 y los signoffs fiscal/jurídico siguen pendientes como se documentó el 2026-09-13.
- **Verificación local integrada 2026-09-12:** se creó `.env` sólo para desarrollo y quedó ignorado por Git; PostgreSQL, Mailpit y MinIO están saludables en Docker; `db:validate`, migraciones (`20` al día), seed idempotente, typecheck, lint, contenido, `37` archivos/`149` pruebas unitarias, integración serial (`42/42` archivos, `88/88` pruebas), build aislado y E2E autenticada completa (`57` pasadas, `2` omitidas intencionalmente) están verificados. Durante la regresión se corrigió un defecto real del constructor: al recargar una cotización enviada, el backend sólo ofrece listas activas compatibles con moneda, vigencia y todos los conceptos de la versión; se añadió cobertura con una lista incompatible. También se endurecieron los fixtures de catálogo/cotizador para no asumir una base vacía. Las flags V2 siguen apagadas, la landing no cambió y no se tocó producción.
- **Baseline de navegador G0-03/G0-05 2026-09-10:** se añadió [`commercial-baseline-browser.mjs`](scripts/commercial-baseline-browser.mjs) como recorrido anónimo de ocho superficies (landing + privadas) y tres viewports. Con Chromium ejecutable en `/var/tmp` pasó 24/24 combinaciones sin overflow, errores de página ni respuestas inesperadas; la evidencia está en [`g0-03-browser-baseline.md`](docs/ocpool-commercial-v2/g0-03-browser-baseline.md).
- **Baseline HTTP complementario 2026-09-10:** se añadió [`commercial-baseline-http.mjs`](scripts/commercial-baseline-http.mjs) para comprobar diez rutas, status y headers sin navegador; sirve como evidencia de disponibilidad, no como sustituto de UI/permisos autenticados.
- **E2E autenticada y build aislado 2026-09-10:** la suite `AUTH_SURFACES_E2E=1` pasó 5/5 con `E2E_PORT=3110`, Chromium ejecutable y fixtures limpiados completamente. La suite pública `tests/quality.spec.ts` pasó 35/35 en `E2E_PORT=3112`. Los flujos comerciales críticos `PORTAL_E2E=1 QUOTES_E2E=1` pasaron 3/3 juntos en `E2E_PORT=3120`, incluyendo portal/aceptación/mensajería/archivos, recuperación móvil y cotizador hasta PDF/descarga; durante la validación se corrigió un defecto Axe real en el skeleton de archivos. La expansión autenticada posterior pasó onboarding 2/2, dashboard 1/1, catálogo/precios 1/1, notificaciones 1/1, auditoría 1/1, mensajería staff 2/2 e identidad API 1/1; la corrida cruzada limpia de todas las suites opt-in pasó 17/17 en `E2E_PORT=3149`. Después del hardening de pestañas y esperas de mensajería, las repeticiones aisladas pasaron auth 5/5 (`3158`), catálogo 1/1 (`3159`), portal 2/2 (`3160`) y mensajería 2/2 (`3156`); una corrida masiva posterior sobre la base compartida no se cuenta como verde por latencias/fixtures intermitentes. El build `NEXT_DIST_DIR=.next-verify-final-tabs npm run build` pasó sin tocar el `.next` activo; los artefactos temporales se eliminaron.
- **Verificación técnica adicional 2026-09-10:** `npm audit --omit=dev --audit-level=high` quedó en 0 vulnerabilidades altas; `npm run db:validate` y `npx prisma migrate status` confirmaron schema válido y 17 migraciones al día en `ocpool_dev`.
- **Contención S0-01 2026-09-10 (`f787468` + `499bfd4` + `1d408f7` + `6611299` + `0cc3683`):** se corrigió la exposición legacy de versiones internas: portal, PDF y aceptación comparten [`customer-visibility.ts`](src/server/modules/quotes/customer-visibility.ts), excluyen `EN_REVISION`/`BORRADOR`, exigen `portal.self.read` tanto en el guard HTTP como en el servicio, conservan la última versión pública cuando `currentVersionId` apunta a working, sólo muestran acciones cuando el PDF privado está verificablemente listo (`pdfReady`) y las notificaciones de aceptación se atan al `QuoteAcceptance` exacto. Las integraciones de portal, aceptación, PDF y fan-out pasaron; no hubo migración ni cambio en la landing. G0 continúa abierto; S0-02/S0-03 tienen implementación local verificable y S0-04 permanece parcial, pero ningún vertical se activa hasta el gate.
- **Regresión local 2026-09-11:** `npm run typecheck`, `npm run lint`, `npm run test:unit` pasó 34 archivos/139 pruebas y `git diff --check` pasaron. La integración completa serial con PostgreSQL local pasó 42 archivos/88 pruebas con timeout de 60 s; los logs 401/403/404/409/429 son negativos esperados y quedan sólo avisos conocidos de Node 20/AWS SDK y pg. El E2E de solicitudes pasó 1/1 en 390/768/1440 px sin overflow, Axe serio ni errores de consola; el E2E del constructor pasó 1/1 con conservación del snapshot y PDF v2. El schema local conserva 20 migraciones aplicadas.
- **Gate técnico G0-05 2026-09-10:** `APP_URL=http://127.0.0.1:3008 npm run test:v2:gate` verificó typecheck, lint, 137 unitarias, contenido y baseline HTTP 10/10; terminó con `exit 2` deliberado (`BLOCKED`) por signoffs, piloto T1 y cierre formal de G0. La verificación final posterior conserva 139 unitarias verdes y objetivos/primitives/locale aprobados localmente.
- **Últimos commits de Fase 11:** `6fe361e` (`feat: add staff analytics dashboard`), `fbbd641` (`docs: document analytics operations`), `2fc037f` (`security: rate limit analytics reads`).
- **Últimos commits de Fase 12:** `a40d839` (`docs: close audit observability phase`), `d9a87e0` (`fix: stabilize audit verification fixtures`), `c341c66` (`feat: add staff audit workspace`), `df315e2` (`feat: expose staff audit api`), `23a9ab5` (`feat: add secure audit read service`).
- **Documentos de Fase 12:** especificación, autorrevisión, plan ordenado y runbook versionados; Tasks 1–6 cerradas con evidencia de gate.
- **Documentos de Fase 13:** especificación, autorrevisión, plan ordenado y runbook versionados; Tasks 1–6 cerradas con evidencia de gate.
- **Últimos commits de Fase 13:** `5c66c6b` (`docs: close auth surfaces phase`), `3ebf8f6` (`feat: add browser auth surfaces`).
- **Últimos commits de Fase 14:** `405c3c8` (`feat: improve public quote intake flow`), `ae01fdb` (`feat: show quote intake qualification in staff`), `2d3ada5` (`feat: extend public quote request intake`), `9ce47ed` (`feat: add premium quote intake contracts`), `b187cde` (`docs: define premium quote intake phase`).
- **Últimos commits de Fase 15:** `8183321` (`test: cover customer onboarding boundary states`), `9a5fb21` (`feat: expose customer portal onboarding in staff`), `67199a9` (`fix: route customer notifications safely before onboarding`), `4f92b2d` (`feat: add transactional customer portal onboarding`), `1c6b78a` (`test: harden customer invitation lifecycle`), `cb7787e` (`feat: activate invited customers through magic link`), `d25bb1a` (`feat: grant customer access management to managers`), `1fe4619` (`docs: define customer onboarding phase`).
- **Últimos commits de Fase 16:** `00c48c0` (`docs: consolidate launch readiness checklist`), `4fb4a0e` (`test: isolate customer invitation rate limits`).
- **Commits de Fase 4:** `cda7a7a`, `4240d15`, `cea2064`, `78bd3fb`, `4236430`, `861e4d8`, `2909b62`, `89ec64e`.

## Orden documental obligatorio

1. Auditoría y decisiones iniciales.
2. Especificación activa V2 en `docs/ocpool-commercial-v2/specs/`.
3. Autorrevisión activa V2 en `docs/ocpool-commercial-v2/reviews/`.
4. Plan maestro activo V2 en `docs/ocpool-commercial-v2/plans/`.
5. Documentos sustituidos y fases cerradas en `docs/historicos/`.
6. Implementación por vertical slices.
7. Verificación de fase.
8. Actualización de este archivo y documentación técnica.

No se iniciará una slice si su dependencia o gate anterior no tiene criterios de terminado verificables. Sólo pueden avanzar en paralelo las ramas que el grafo del plan V2 declare independientes y después de cerrar sus dependencias compartidas.

## Módulos

### Terminados para el alcance actual de la web pública

- Landing pública editorial de OCPOOL.
- Identidad visual y sistema de estilos de la landing.
- Portafolio de proyectos y diálogo accesible.
- Navegación responsive.
- Formulario público básico de contacto.
- Metadata, Open Graph, Twitter card, JSON-LD, robots y sitemap.
- Contrato de contenido de la web.
- Pruebas E2E de calidad visual, interacción, responsive, consola y accesibilidad.
- Formulario público de cotización conectado al expediente persistido, con validación, consentimiento, estados de UI, folio e idempotencia de reintentos.
- Endpoint público `POST /api/quote-requests` con protección same-origin, límite de body, rate limiting por email/IP confiable y respuesta sin IDs internos.
- Inbox interno `/staff/requests` con lista paginada, filtros, detalle, historial, estados vacíos/carga/error y diseño responsive.
- Endpoints internos protegidos por sesión de empleado, RBAC, same-origin en mutaciones, bloqueo transaccional, asignación histórica y transiciones de estado auditadas.
- Onboarding interno de cliente desde `/staff/requests`, con `identity.users.manage`, vinculación única `ClientContact.userId`, cuenta `CUSTOMER` `INVITED`/`ACTIVE`, Outbox cifrado, auditoría segura y rechazo de colisiones de empleado/cliente.
- Endpoint `POST /api/staff/quote-requests/:id/customer-access` con `{}` estricto, same-origin, sesión staff, lock de solicitud y respuesta sin IDs de usuario ni tokens.
- UI staff de onboarding con estados `Portal sin habilitar`, `Invitación pendiente` y `Portal habilitado`, acción condicionada por capability, feedback de reenvío y protección responsive/Axe.

### Fundamentos terminados en esta fase

- Toolchain ESM con TypeScript ES2023, Vitest y scripts reproducibles.
- Separación de descubrimiento E2E (`*.spec.ts`) y pruebas unitarias/integración.
- PostgreSQL 16 y Mailpit versionados en Docker Compose con healthcheck.
- `.env.example`, guard de variables y runbook de desarrollo local.
- Prisma 7.10.0 con adaptador PostgreSQL, schema foundation y migración aplicada.
- Seed idempotente de `system.schema_version`.
- Cliente Prisma lazy y servicio de health de base de datos.
- Logger estructurado con redacción y sanitización de valores sensibles.
- Contrato de errores HTTP públicos sin stack traces, SQL ni secretos.
- Endpoint `GET /api/health` con `requestId` y estado degradado seguro.
- Pruebas unitarias, integración PostgreSQL, E2E foundation y regresión de landing.
- Contrato de entorno para MFA, sesiones, tokens y rate limiting.
- Modelo relacional de clientes, usuarios, roles, permisos, sesiones, tokens, eventos y buckets de intentos.
- Migración adicional de protección contra replay de MFA (`20260908002806_mfa_replay_protection`).
- Argon2id para contraseñas de empleados; huellas SHA-256 para tokens y sesiones; AES-256-GCM para secretos MFA.
- Catálogo RBAC inicial con roles `customer`, `sales`, `manager` y `admin`, seed idempotente y guardias backend deny-by-default.
- Sesiones persistidas con expiración, revocación, actor derivado desde PostgreSQL y cookie `ocpool_session` con política segura.
- Tokens de autenticación de un solo uso y rate limiting de ventana fija con bloqueo de fila PostgreSQL.
- Onboarding de clientes reutilizando `User`, `ClientContact`, `AuthToken`, Outbox y sesiones existentes: invitación `INVITED`, activación condicional a `ACTIVE`, deduplicación y no persistencia de tokens crudos.
- MFA TOTP con ventana controlada y contador persistido para rechazar replays.
- Servicios y rutas API de autenticación: login empleado, magic link, recovery, sesión y logout.
- Eventos de autenticación y Outbox transaccionales; tokens de entrega cifrados con clave separada de MFA.
- Protección same-origin, validación JSON con límite de body, errores públicos genéricos y request IDs.
- Rate limit por email/IP confiable sin bucket global `unknown-client`; circuit breaker global separado sólo para solicitudes sin IP confiable.
- Parser de cuerpos JSON con límite streaming de 16 KiB y cancelación temprana para requests chunked.
- Typecheck explícito (`npm run typecheck`) integrado en `npm test`.
- Contratos puros iniciales de solicitudes: estados, transiciones, folio provisional `OCQ-YYYY-NNNNNN`, normalización y permisos RBAC de solicitudes.
- Schema relacional de clientes/contactos, solicitudes, detalles, asignaciones, historial, folios e índices; migración `20260908025713_clients_requests` aplicada.
- Seed idempotente de `FolioSequence.quote_request` y catálogo RBAC ampliado para solicitudes.
- Servicio transaccional de solicitudes: cliente/contacto, folio bloqueado, detalle, historial inicial, auditoría y Outbox en una transacción.
- Idempotencia pública mediante huella SHA-256 de clave de reintento limitada; migración `20260908030200_quote_request_idempotency` aplicada.
- Captación pública E2E sobre navegador de producción local; el endpoint legado de `mailto` fue retirado para evitar flujos no persistentes.
- Servicio operativo de inbox: listado/detalle con proyección segura, responsables activos, asignación con cierre de asignación previa y eventos Outbox de operación.
- Gate reproducible de Fase 3: migraciones/seed al día, auditoría de producción sin vulnerabilidades conocidas y lockfile con overrides compatibles de dependencias transitorias.
- Contratos de Fase 4 para dinero, cantidades de punto fijo, porcentajes en basis points, redondeo half-up, límites y monedas explícitas.
- Cálculo puro de líneas con subtotal, descuento, base gravable, impuesto y total sin floats.
- Snapshots de líneas y totales congelados en memoria, con identidad comercial y valores monetarios capturados.
- Estados de cotización versionada con edición exclusiva de borradores y aceptación bloqueada hasta existir evidencia de aceptación.
- Permisos RBAC separados para lectura/administración de catálogo y lectura/administración de precios.
- Schema relacional de categorías, conceptos, listas, vigencias de precio, cotización raíz, versiones, líneas snapshot e historial.
- Migración `20260908032000_catalog_quotes` aplicada con extensión `btree_gist`, exclusión de vigencias solapadas y constraints monetarios.
- FK compuesto de `Quote` a solicitud+cliente para impedir cruces de expedientes desde la base de datos.
- Seed local demo (`DEMO-SERVICES`, `DEMO-CONSULTA`, `DEMO-MXN`) idempotente y explícitamente no comercial.
- Servicio transaccional de cotizaciones: resolución de precio vigente, snapshots completos, reemplazo de borrador, versionado concurrente, auditoría y Outbox.
- Envío de versión que actualiza la solicitud a `COTIZACION_DISPONIBLE` sólo dentro de la misma transacción.
- API interna protegida de capacidades, categorías, conceptos, listas y precios con validación same-origin, RBAC y errores públicos seguros.
- Servicio transaccional de catálogo con búsqueda, filtros, paginación, archivado no destructivo, vigencias sin solapamiento y auditoría/Outbox.
- UI interna responsive de catálogo y listas de precios con permisos por capacidad, estados de carga/error/vacío, confirmación de archivado y formato monetario sin floats.
- Servicio de lectura del espacio de trabajo de cotización con alcance de solicitud, cliente, contacto, versiones, líneas, historial y listas vigentes, sin BigInt crudo ni datos innecesarios.
- API interna protegida para listar expedientes cotizables, crear/reemplazar borradores y transicionar versiones con same-origin, RBAC, serialización monetaria y errores seguros.
- Constructor `/staff/quotes` responsive con selección de expediente, lista de precios, líneas, cantidades, descuentos, impuestos, resumen vivo, vigencia, historial y acciones de revisión/envío.
- Política backend que separa editar precios, aplicar descuentos y aprobar descuentos antes del envío; versiones enviadas no son editables.
- Gate reproducible de Fase 4 cerrado: migraciones/seed al día, dependencias sin vulnerabilidades altas, regresión completa y E2E del constructor opt-in verificados.
- Servicio de lectura del portal con scope obligatorio por `clientId`, proyecciones seguras, ocultamiento de borradores y serialización BigInt para cliente.
- Guard y API privada de cliente para listar expedientes, leer detalle y consultar cotizaciones propias con `no-store`, respuestas seguras y errores no enumerables.
- Portal privado `/portal` con shell de cliente propio, metadata `noindex`, estados de sesión/carga/vacío/error, dashboard de expedientes, logout, responsive, foco visible y reduced motion.
- Detalle de expediente y cotización versionada con líneas/totales snapshot, histórico de versiones, descuentos, impuestos y mensaje de vigencia expirada sin acciones fuera de alcance.
- Hardening del portal: sesiones de clientes archivados invalidadas, pruebas IDOR/UUID/sesión revocada, E2E autenticada opt-in, Axe, auditoría de payloads y limpieza exacta de fixtures.
- Gate de Fase 5 cerrado: migraciones/seed al día, regresión completa, E2E autenticada separada, auditoría de dependencias sin vulnerabilidades altas y árbol limpio.
- Contrato de mensajería y notas: permisos RBAC explícitos, conversación única por expediente, mensajes append-only, visibilidad `CUSTOMER`/`INTERNAL`, índices, FKs compuestos y constraints de body/cierre.
- Migraciones `20260908062317_messaging` y `20260908062400_messaging_constraints` aplicadas; seed idempotente con 27 permisos catalogados.
- Servicio transaccional de mensajería con scope por cliente, lock de solicitud, conversación única, cursor estable, reintentos idempotentes, rate limiting, mensajes compartidos, notas internas y cierre/reapertura.
- Auditoría y Outbox atómicos de mensajes y estados de conversación, con payloads sin cuerpo sensible.
- APIs privadas de portal y staff para lectura, mensajes compartidos, notas internas y cierre/reapertura, con Zod estricto, same-origin, no-store, RBAC, rate limit y proyecciones sin datos internos.
- Hilo de mensajería del portal cliente integrado en el detalle del expediente, con feed cronológico, cursor incremental, composer idempotente, estados de carga/vacío/error/cierre, responsive, foco/teclado, Axe y reduced motion.
- Workspace de mensajería staff integrado en `/staff/requests`, con vistas `Compartidos`/`Notas internas`, compositores separados, capacidades derivadas, cierre/reapertura con confirmación y estados de lectura/error/bloqueo.
- Hardening de accesibilidad del inbox staff: contraste AA de la paleta operativa, nombres accesibles para selects, Axe sin hallazgos serios en el flujo staff y no overflow móvil.
- Comando oficial de integración serializado a un worker DB para evitar timeouts de inicio de transacción por saturación local; se conserva la cobertura completa de 38 pruebas.
- Gate de Fase 6 cerrado: aislamiento cliente/staff, RBAC, idempotencia, cierre/reapertura, payloads/logs sin cuerpos sensibles, E2E opt-in, auditoría de dependencias y árbol limpio verificados.
- Especificación de Fase 7 para archivos privados por expediente, con storage S3-compatible privado, metadata relacional, estados de análisis, URLs efímeras, auditoría y pruebas negativas.
- Contrato de dominio de archivos: categorías, visibilidades, estados, nombres seguros, tipos permitidos, límite de 25 MiB y keys opacas.
- RBAC de archivos con seis capacidades explícitas y asignación mínima por rol; no se modificó la autorización de expedientes existente.
- Schema relacional `StorageObject`/`FileAttachment` y migración `20260908083258_private_files` con FK compuesto, soft delete, índices y constraints de tamaño/hash/key/visibilidad.
- Storage S3-compatible privado con MinIO local versionado en Docker, presigned PUT/GET, bucket creado bajo demanda, lectura HEAD/bytes y delete encapsulados en `PrivateStorage`.
- Scanner local `basic-signature-v1` para PDF/JPEG/PNG/WebP, estados de reserva/análisis, hash SHA-256 servidor, expiración y cleanup físico de reservas huérfanas.
- Servicio transaccional de archivos con idempotencia por actor, concurrencia serializada por expediente, aislamiento de visibilidad, descarga sólo `AVAILABLE`, auditoría y Outbox sin bytes/URLs.
- APIs privadas de archivos para portal/staff con reserva, finalización, listado, descarga y borrado; Zod estricto, same-origin, no-store, scope backend, capabilities y rate limit persistido.
- Panel `ClientFilesPanel` integrado en el detalle del portal cliente con upload presigned, finalización validada, descarga efímera, borrado confirmado, reintento, estados de carga/error/vacío y responsive.
- Panel `StaffFilesPanel` integrado en `/staff/requests` con tabs de visibilidad, carga por categoría, descarga, borrado condicionado por capability, estados operativos y responsive.
- Gate de Fase 7 cerrado: aislamiento por cliente/visibilidad/rol, no entrega antes de validación, URLs efímeras, auditoría segura, cleanup exacto, MinIO saludable, regresión completa y riesgos operativos documentados.

- Fase 8 — Tarea 1: dominio de documentos y aceptación con estados monotónicos, elegibilidad de versión vigente, normalización de nombre/terms y permisos separados para lectura, generación y aceptación.
- Fase 8 — Tarea 1: modelos `GeneratedDocument` y `QuoteAcceptance` separados de uploads, FK compuesto versión+cotización, unicidad de documento/aceptación/idempotencia, hashes y constraints de MIME, tamaño, READY, soft delete y evidencia.
- Fase 8 — Tarea 1: migración `20260908090000_quote_documents_acceptance` aplicada; el documento generado reutiliza el almacenamiento privado existente y no se mezcla con `FileAttachment`.
- Fase 8 — Tarea 2: renderer `pdf-lib` versionado, paginado y basado en snapshot; generación de hash/tamaño, verificación HEAD y almacenamiento privado idempotente.
- Fase 8 — Tarea 2: fixture PDF de 2 páginas revisado visualmente en PNG; metadata, folio, resumen, total y ausencia de texto interno comprobados por herramientas de inspección.
- Fase 8 — Tarea 2: dependencia directa `pdf-lib@1.17.1` justificada; no se añadió proveedor externo de PDF ni fuente no portable.
- Fase 8 — Tarea 3: servicios de aceptación y acceso a PDF protegidos por scope `clientId`, RBAC, lock transaccional, validación de objeto privado, evidencia SHA-256, idempotencia y Outbox/auditoría sin datos sensibles.
- Fase 8 — Tarea 3: APIs portal/staff de PDF y aceptación con same-origin, Zod estricto, `no-store`, URL presigned efímera y respuestas sin `storageKey`/hash.
- Fase 8 — Tarea 4: `ClientQuoteActions` integrado en el portal con descarga PDF, aceptación explícita, diálogo accesible, feedback de éxito/error, estado vencido/aceptado y responsive.
- Fase 8 — Tarea 5: endpoint de estado documental staff y `StaffQuoteDocumentPanel` integrados en el constructor; estados MISSING/PENDING/READY/FAILED/DELETED, descarga privada, generación condicionada, evidencia de aceptación y respuestas sin storage key/hash.
- Gate de Fase 8 cerrado: PDF determinista, aceptación transaccional, portal/staff, storage privado, auditoría/Outbox, regresión, accesibilidad, build y auditoría de dependencias verificados.
- Fase 9 — Tarea 1: contratos de canal email y estados `PENDING`/`PROCESSING`/`SENT`/`FAILED`/`CANCELLED`, con transiciones seguras y backoff inicial acotado.
- Fase 9 — Tarea 1: permisos `notifications.read`/`notifications.manage`, separados de identidad y operación comercial; ventas sólo puede leer y gerencia administrar.
- Fase 9 — Tarea 1: `NotificationDelivery` separado de Outbox, con destinatario cifrado, hash de deduplicación, template versionado, payload snapshot, lease/timestamps, proveedor y constraints de integridad.
- Fase 9 — Tarea 1: migraciones `20260908113957_notifications` y `20260908114000_notifications_invariants`, seed de schema versión 3 y clave `NOTIFICATION_RECIPIENT_ENCRYPTION_KEY` independiente de MFA/auth.
- Fase 9 — Tarea 1: pruebas de cifrado/hash/normalización/permisos 8/8 y persistencia PostgreSQL 1/1; typecheck, lint, schema, migraciones, seed y diff check verificados.
- Fase 9 — Tarea 2: allowlist de ocho eventos, validación de agregado/payload/visibilidad y `safePayload` separado de material transitorio de tokens.
- Fase 9 — Tarea 2: ocho templates v1 HTML/texto con escape, subjects seguros, URLs same-origin allowlisted, límites de contenido y copy sin prometer lectura del correo.
- Fase 9 — Tarea 2: proveedor `EmailProvider` SMTP reemplazable sobre Nodemailer 10.0.1, `disableFileAccess`/`disableUrlAccess`, configuración SMTP validada y errores de proveedor redacted.
- Fase 9 — Tarea 2: 13 pruebas unitarias dirigidas, typecheck, lint, auditoría de dependencias 0 y entrega real a Mailpit verificada/limpiada.
- Fase 9 — Tarea 3: claim concurrente PostgreSQL con `FOR UPDATE SKIP LOCKED`, batch acotado, lease recuperable y contador de intentos incrementado al reclamar.
- Fase 9 — Tarea 3: transición condicional por `deliveryId` + lease para evitar que un worker viejo sobrescriba el resultado de un worker recuperado; errores persistidos sólo como códigos controlados.
- Fase 9 — Tarea 3: reintentos con jitter acotado 80–120 %, máximo de intentos, clasificación temporal/permanente, comando one-shot, worker continuo con apagado limpio y diagnóstico operativo no sensible.
- Fase 9 — Tarea 3: migración `20260908120000_notifications_error_code_constraint` aplicada para cerrar en PostgreSQL la allowlist de códigos de error.
- Fase 9 — Tarea 4: resolver de audiencias por relaciones activas y scope compuesto para auth, solicitudes, cotizaciones, aceptación, mensajes compartidos y archivos disponibles.
- Fase 9 — Tarea 4: fan-out automático desde Outbox con claim separado, idempotencia, snapshots históricos, cancelación explícita de eventos no entregables y worker integrado.
- Fase 9 — Tarea 4: migración `20260908123000_notification_cancellation` para registrar `CANCELLED` sin fabricar destinatarios; tokens de auth validados contra `AuthToken` y nunca copiados al payload seguro.
- Fase 9 — Tarea 4: contrato real Mailpit cubierto con SMTP, asunto/from/destinatario verificados y limpieza exacta de mensajes de prueba.
- Fase 9 — Tarea 5: servicio y API staff de diagnóstico con proyección mínima, filtros, salud agregada, RBAC, same-origin y reintento manual condicionado a errores recuperables.
- Fase 9 — Tarea 5: panel `/staff/notifications` responsive con estados de carga/vacío/error, feedback de reintento, Axe, teclado, reduced motion, consola limpia y no overflow.
- Fase 9 — Gate Tarea 6: schema válido, 16 migraciones al día, seed idempotente, unitarias 77/77, integración serial 63/63, worker one-shot con 4 entregas SMTP aceptadas y 0 fallos, Mailpit limpiado por IDs exactos, E2E staff 1/1, contenido, typecheck, lint, build, auditoría de dependencias sin vulnerabilidades altas y diff check.
- Fase 10 — Tareas 1–2: política de runtime productivo, cabeceras HTTP seguras, HSTS condicionado a HTTPS, readiness `/api/ready` separado de liveness y cobertura unitaria/integración/E2E.
- Fase 10 — Tarea 3: scripts PowerShell de backup PostgreSQL con checksum y restauración únicamente en `ocpool_restore_verify`, runbooks de continuidad, retención sin plazos inventados y documentación enlazada desde README.
- Fase 10 — Tarea 4: gate `readiness:production` con checks estables, salida JSON segura, precedencia `BLOCKED > WARN > PASS`, ejecución rápida/completa y bloqueos externos explícitos.
- Fase 10 — Gate local: 11 checks técnicos `PASS` (schema, migraciones, seed, typecheck, unitarias, integración serial, lint, contenido, auditoría, build y documentación), 0 `WARN` y 8 `BLOCKED`; no autoriza publicación.
- Fase 11 — Tareas 1–2: contratos de zona/fechas/cálculo, permiso `metrics.read.global`, repositorio parametrizado, agregados por scope y supresión de muestras; integración previa a la UI en 37 archivos/70 pruebas.
- Fase 11 — Tarea 3: API privada `GET /api/staff/dashboard`, query estricta, `no-store`, errores con `requestId`, 401/403/400 y respuesta sin PII; integración dirigida 2/2 y build/typecheck/lint correctos.
- Fase 11 — Tarea 4: dashboard `/staff` responsive con KPIs, alertas, pipeline, antigüedad, tiempos protegidos, carga y salud de notificaciones; E2E opt-in 1/1, Axe sin hallazgos serios, 390/768/1440 sin overflow, reduced motion y consola autenticada limpia. Commit `6fe361e`.
- Fase 11 — Tarea 5 y gate: mapper de serialización, runbook, documentación, rate limit por empleado configurable y revisión `EXPLAIN`; 99 unitarias, 37 archivos/71 integraciones, E2E base 34/34 ejecutadas con 10 omitidas opt-in, foundation 2/2, dashboard 1/1, build, contenido, auditoría y diff check correctos.
- Fase 12 — Tareas 1–4: contratos/redacción, permisos separados, repositorio con cursor HMAC y rate limit, API privada con Zod/no-store/request ID; integración dirigida de servicio 5/5 y API 2/2, typecheck/lint/diff check correctos.
- Fase 12 — Tarea 5: commit `c341c66` (`feat: add staff audit workspace`); panel `/staff/audit`, capabilities seguras y CSS responsive. `AUDIT_E2E=1 npm run test:e2e -- tests/audit.spec.ts` pasó 1/1 con manager, admin security, customer/sales restringidos, error recuperable, filtro/cursor, Axe, foco, reduced motion, 390/768/1440 sin overflow, ausencia de PII y consola autenticada limpia. `npm run test:integration` pasó 39 archivos/79 pruebas; `npx tsc --noEmit`, `npm run lint` y `git diff --check` correctos.

### Fases cerradas para el alcance local

- Fase 13 — superficies de acceso y recuperación: terminada para el alcance local. Login, MFA, magic link, recovery, URL limpia, estados restringidos, responsive, accesibilidad, documentación y gate técnico están comprobados; permanecen sólo decisiones externas de lanzamiento.
- Fase 14 — captación premium: terminada para el alcance local. El formulario público de dos pasos, contrato de datos, migración, API, inbox/constructor staff, validaciones, anti-spam básico, E2E, documentación y gate técnico están comprobados; los adjuntos anónimos permanecen fuera de alcance.
- Fase 15 — onboarding y vinculación de usuarios cliente: terminada para el alcance local. RBAC, servicio transaccional, API estricta, magic link `INVITED → ACTIVE`, colisiones, fallback de notificaciones, proyección staff, UI, E2E opt-in y documentación están comprobados.
- Fase 16 — consolidación de preparación para lanzamiento: terminada para el alcance local. Se corrigió la contaminación de rate limit de fixtures, la integración completa pasó 42 archivos/87 pruebas, el checklist consolidado tiene contrato documental y el gate completo quedó documentado en 11 `PASS`, 0 `WARN`, 8 `BLOCKED`.
- Fase 17 — continuidad local: terminada para el alcance local. El backup con checksum pasó, el restore real creó 35 tablas en `ocpool_restore_verify`, el target fue eliminado de forma exacta, `ocpool_dev` permaneció intacta y los artefactos quedaron excluidos de Git.

### Bloqueos de lanzamiento

- La preparación real de producción permanece bloqueada por proveedor SMTP, dominio/DNS/TLS/WAF, antivirus, backup externo, RPO/RTO, retención/legal, destino de despliegue, supervisor, observabilidad y rollback.

### Prototipo o incompletos para el producto comercial

- Contacto directo por correo/WhatsApp: canal informativo, todavía fuera del expediente persistido.
- Alta automática desde la captación pública: la web sigue sin crear cuentas sin intervención del personal; el onboarding administrativo es deliberado y requiere `identity.users.manage`.
- Acceso productivo del cliente: el recorrido local está completo, pero correo real, dominios, soporte, privacidad, recuperación y operación externa permanecen sujetos al gate de lanzamiento.
- Captación premium: el formulario público ya incorpora dimensiones/alcance, etapa, plazo, presupuesto opcional, validación por campo, honeypot y rate limit. Permanecen adjuntos anónimos fuera de alcance y el enlace legal de privacidad pendiente de revisión jurídica.

### Pendientes

- Cerrar G0 del plan V2: completar baseline de tareas, resolver fiscal/jurídico, validar flags y congelación visual de landing.
- Cerrar S0 antes de cualquier rediseño amplio: privacidad de versiones, fidelidad cross-surface del snapshot, acciones legales, PDF antes de aviso y términos server-owned. S0-02/S0-03 ya tienen implementación local verificable; falta completar su matriz de cierre y mantenerlos sin activación hasta G0.
- Revisión legal de términos de PDF/aceptación.
- Completar en G0/H1 la auditoría autenticada, comercial y de seguridad con fixtures reproducibles; la auditoría estática y la inspección sin sesión del 2026-09-10 ya están documentadas.
- Siguiente paso de producto: completar la medición comercial autenticada de G0-03 y revisar los cuatro bloqueos fiscales/legales restantes. G0-04 ya tiene aprobación local, `lang="es-MX"` SSR y primitives decididas. G0-05 ya tiene infraestructura fail-closed, browser baseline y manifiesto/hash de landing; no activa flags ni instrumentación hasta cerrar los signoffs restantes. Los controles externos de lanzamiento continúan en paralelo y no autorizan publicación.
- Selección y configuración de proveedores productivos.
- Backup externo cifrado, restauración periódica y RPO/RTO aprobados.
- Antivirus productivo, cuarentena y política de objetos.
- Retención legal, privacidad, aceptación y operación de auditoría.
- Destino de despliegue, proxy/WAF, supervisor del worker, alertas y rollback.
- Backup/restore local aislado: verificado en Fase 17; la continuidad productiva externa permanece pendiente.
- Preflight firmado usando `docs/runbooks/launch-readiness-checklist.md` y el JSON de `readiness:production:full`.

## Decisiones arquitectónicas acumuladas

Las decisiones siguientes preservan la historia técnica de las Fases 1–17. Para todo trabajo futuro en superficies privadas, la especificación y el plan V2 prevalecen cuando exista contradicción; una entrada marcada `LEGACY` describe el comportamiento actual que debe contenerse o migrarse, no el contrato objetivo.

1. Mantener la web pública existente y su identidad visual.
2. Construir un monolito modular, no microservicios.
3. Mantener Next.js App Router como aplicación principal.
4. Usar PostgreSQL como fuente de verdad transaccional.
5. Separar marketing, portal de cliente y sistema interno mediante route groups y módulos de dominio.
6. Mantener sesiones privadas y autorización en backend; no usar el folio como autenticación.
7. Separar el folio comercial del identificador interno UUID/ULID.
8. Tratar las versiones enviadas o aceptadas como inmutables.
9. Guardar snapshots de precios, impuestos y conceptos dentro de cada versión de cotización.
10. Iniciar localmente con aplicación, PostgreSQL y Mailpit; agregar storage, worker, antivirus o Redis sólo cuando el módulo lo justifique.
11. Mantener WhatsApp y otros canales externos desacoplados del flujo principal.
12. No afirmar que la aceptación digital sustituye contratos formales sin revisión jurídica.
13. Mantener las transiciones dependientes de cotización cerradas en el inbox hasta que exista el módulo de cotizaciones.
14. Representar dinero con `BigInt` en unidad mínima y cantidades con escala fija de milésimas; porcentajes como basis points enteros.
15. Aplicar redondeo half-up explícito por línea para cantidad, descuento e impuesto; sumar los resultados de línea para los totales.
16. Permitir sólo códigos de moneda de tres letras normalizados en el dominio; la lista comercial definitiva de monedas queda pendiente de confirmación.
17. Congelar snapshots de dominio y persistirlos como datos históricos en la siguiente tarea; ninguna versión distinta de `BORRADOR` será editable.
18. Evitar solapamientos de precios con constraint PostgreSQL `EXCLUDE USING gist`; el servicio además resolverá la vigencia dentro de transacción.
19. Relacionar una cotización con solicitud y cliente mediante FK compuesto, además de FK directo al cliente.
20. Resolver precios dentro de transacción con bloqueo de solicitud/cotización; una carrera de creación de versión produce una sola versión ganadora.
21. La operación de envío de cotización y el cambio de estado de solicitud se auditan y publican como Outbox en la misma transacción.
22. Las mutaciones del catálogo y precios requieren sesión de empleado, permiso de escritura y same-origin; el frontend sólo refleja capacidades, nunca sustituye la autorización.
23. Los conceptos se archivan en lugar de eliminarse físicamente; los precios vigentes no pueden solaparse para la misma lista y concepto.
24. Los importes monetarios viajan por API como cadenas de unidades mínimas y se formatean con `BigInt` para evitar pérdida de precisión en la UI.
25. La UI interna de catálogo usa un espacio de trabajo denso de dos zonas, superficies planas, reglas y responsive apilado, consistente con la identidad OCPOOL y sin métricas decorativas.
26. Crear o modificar precios exige `quotes.edit_prices`; aplicar un descuento exige `quotes.apply_discount`; enviar una versión con descuento exige además `quotes.approve_discount`.
27. La API de cotizaciones serializa todas las unidades monetarias como cadenas antes de construir JSON; las vistas internas pueden calcular previews con `BigInt` sin confiar en los totales del navegador.
28. El constructor trabaja sobre una solicitud existente y una cotización raíz; cada cambio después de una versión enviada crea una nueva versión y nunca muta el histórico.
29. El portal cliente aplica el scope `clientId` en backend; el actor, no el request, define el cliente autorizado.
30. **LEGACY:** las versiones `BORRADOR` no se exponen al cliente, pero el filtro actual de “enviadas o posteriores” es insuficiente; V2 exige publicación deliberada mediante `publishedVersionId` + `QuotePublication`.
31. La resolución de sesión invalida a un cliente cuyo vínculo `Client` está archivado; un usuario cliente sin vínculo se conserva como actor para que cada guard de superficie responda 403 explícito sin convertirlo en una sesión inexistente.
32. Las fechas comerciales del portal se formatean en UTC porque `validUntil` representa una fecha de vigencia persistida, no la zona horaria local arbitraria del navegador.
33. Fase 6 usará una conversación única por `QuoteRequest`, con `clientId` redundante controlado para mantener scope e impedir cruces de expediente.
34. Los mensajes serán append-only y tendrán visibilidad explícita `CUSTOMER` o `INTERNAL`; una nota interna nunca se filtra por proyección, conteo, HTML, log ni Outbox.
35. Los eventos de mensajería publicarán sólo IDs, folio, visibilidad y metadatos mínimos en Outbox; el cuerpo se consultará desde PostgreSQL por el worker futuro.
36. `ConversationReadState` queda fuera del primer slice de Fase 6; no se implementará unread hasta tener contrato de producto, permisos y pruebas de avance monotónico.
37. Las mutaciones de conversación bloquean la fila de `QuoteRequest` antes de crear, cerrar, reabrir o escribir mensajes; esto serializa reintentos concurrentes por expediente y mantiene el scope compuesto request+cliente.
38. La paginación del hilo usa cursor opaco basado en `(createdAt, id)` y orden ascendente estable; la primera entrega prioriza continuidad y consistencia antes de agregar unread.
39. La UI cliente consume una proyección mínima `CUSTOMER`, deriva la etiqueta de autor desde el tipo de remitente y nunca modela campos internos; la visibilidad sigue siendo una decisión de backend.
40. Las pruebas de integración PostgreSQL se ejecutan con un worker en el comando oficial para privilegiar reproducibilidad y evitar timeouts de transacción en laptops con recursos compartidos; la concurrencia de negocio continúa cubierta dentro de las pruebas de servicio.
41. La UI staff recibe capacidades booleanas derivadas de sesión y oculta acciones no autorizadas, pero nunca usa esas capacidades como autorización; cada mutación sigue validándose en backend.
42. El staff usa vistas segmentadas por `visibility` y compositores distintos; una nota interna nunca se envía al endpoint compartido ni se oculta sólo con CSS.
43. El timeout de `webServer` de Playwright es de 600 segundos porque el build frío local puede superar dos minutos bajo carga; el timeout de cada assertion conserva el límite normal de Playwright.
44. La paleta staff usa variantes de cobre y texto muted con contraste suficiente, y los controles de operación tienen nombres accesibles explícitos; esto prioriza Axe y lectura real sobre conservar valores decorativos de bajo contraste.
45. El cierre de Fase 6 exige validar capacidades en backend aun cuando la UI las oculte; la matriz final confirma que un rol limitado no puede cerrar ni reabrir conversaciones y que las respuestas no devuelven claves de idempotencia.
46. El Outbox de mensajería permanece preparado para un worker futuro, pero no se agrega Redis ni un worker productivo antes de que archivos/notificaciones definan sus garantías de entrega y reintento.
47. Los archivos se separan en `StorageObject` y `FileAttachment`: el primero representa bytes privados y el segundo su relación con expediente, cliente, categoría y visibilidad.
48. MinIO será el storage S3-compatible local para probar el contrato real de objetos privados; el dominio no dependerá de SDKs ni de rutas físicas y el bucket nunca será público.
49. El servidor no entregará archivos que no estén en `AVAILABLE`; la validación local de firma/tipo no se presentará como antivirus productivo, y ese proveedor será un gate explícito de salida.
50. Los adjuntos de mensajes quedan fuera de Fase 7 para no mezclar dos superficies de visibilidad; primero se estabiliza el ciclo de vida del archivo por expediente.
51. La primera persistencia separa `scanStatus` del storage y `status` del adjunto: un objeto puede estar validado físicamente mientras el vínculo comercial conserva su ciclo de vida y borrado lógico.
52. El upload usa reserva DB idempotente por `(uploadedById, reservationKeyHash)` y expiración explícita; una URL presigned es sólo transporte temporal, nunca autorización.
53. El bucket MinIO/S3 es privado y la aplicación valida HEAD, bytes, firma y hash antes de marcar `AVAILABLE`; el scanner básico no se presenta como antivirus.
54. El listado de archivos valida la existencia y scope del expediente antes de devolver una colección, para no convertir un expediente ajeno en un 200 vacío enumerables.
55. La API separa reserva/finalización: una URL presigned sirve sólo para transportar bytes durante minutos; la autorización de lectura se vuelve a ejecutar al descargar y no se conserva en el frontend como permiso.
56. La UI cliente muestra únicamente una proyección operativa del archivo; valida experiencia y formato para feedback inmediato, pero reserva, análisis, scope, descarga y borrado siguen siendo decisiones de backend.
57. La UI staff separa `CUSTOMER` e `INTERNAL` en tabs accesibles y deriva controles de carga/borrado desde capacidades, manteniendo la autorización real en cada endpoint.
58. Fase 7 queda cerrada con scanner local explícitamente limitado: antivirus productivo, cuarentena, backups/restauración de objetos y retención no se ocultan como completados y quedan en hardening/operación.
59. Los PDFs comerciales se modelan como `GeneratedDocument`, no como `FileAttachment`, porque son artefactos de sistema derivados de un snapshot y requieren ciclo de vida, hash y regeneración controlada propios.
60. La relación documento/versiones usa FK compuesto `(quoteVersionId, quoteId)` y `quote_versions(id, quoteId)` único para impedir que un UUID válido se vincule a otra cotización por manipulación de alcance.
61. Un PDF sólo puede exponerse como `READY` cuando tiene objeto privado, tamaño, hash y timestamp de disponibilidad; PostgreSQL conserva esta garantía además del servicio.
62. `QuoteAcceptance` guarda el hash del PDF aceptado, versión de términos, nombre normalizado y fingerprints opcionales; no almacena claves de idempotencia, IP ni user-agent crudos.
63. La primera versión de aceptación comercial es evidencia auditable de intención dentro de OCPOOL y no se presenta como firma electrónica avanzada sin revisión jurídica y proveedor especializado.
64. El renderer PDF será determinista y server-side con `pdf-lib`; el cliente nunca decide totales, contenido, storage key ni bytes del documento.
65. La primera plantilla usa fuentes PDF estándar para evitar artefactos WOFF no portables; la calidad visual se controla desde composición, color, ritmo y QA rasterizado.
66. **LEGACY:** la aceptación actual opera sobre `Quote.currentVersionId`; V2 reemplaza este contrato porque debe aceptar exclusivamente la publicación vigente exacta y conservar una working interna separada.
67. El lock de aceptación se toma sobre cotización y solicitud antes de crear evidencia; la clave única `(acceptedById, idempotencyKeyHash)` permite replay exacto y la unicidad por versión impide doble aceptación con claves distintas.
68. La URL de descarga se emite sólo después de validar DB + HEAD del objeto privado, con expiración de 60 segundos y auditoría; el portal recibe metadata mínima y nunca una storage key.
69. La ruta staff de generación requiere `{}` con schema estricto, para que incluso regeneraciones mantengan contrato JSON y protección same-origin uniforme.
70. El portal muestra el éxito de aceptación antes de refrescar el expediente; el refresh ocurre al pulsar `Continuar`, evitando que un remount borre el feedback de una acción irreversible.
71. La descarga cliente abre únicamente la URL presigned retornada por backend; el frontend no construye keys ni intenta leer bytes del PDF.
72. El diálogo de aceptación usa nombre y checkbox explícitos, pero no se presenta como firma electrónica avanzada; el copy mantiene la revisión jurídica pendiente visible en riesgos.
73. El estado operativo staff se separa de la descarga: puede mostrar `MISSING`/`PENDING`/`FAILED` sin convertir un 409 de disponibilidad en un estado ambiguo; la descarga continúa validando DB + HEAD antes de emitir URL.
74. La interfaz sólo ofrece generar/reintentar cuando el documento falta o falló; un documento `READY` se conserva como artefacto inmutable y el backend devuelve el existente sin reemplazarlo.
75. La evidencia de aceptación visible para staff se limita a firmante, versión de términos y fecha; hashes, fingerprints, storage keys y códigos de fallo permanecen en backend/auditoría.
76. Fase 9 separa `NotificationDelivery` de `OutboxEvent`: un evento puede generar varios destinatarios y cada entrega necesita retry/lease/provider propios sin mutar el agregado comercial.
77. El primer canal de Fase 9 será email con Mailpit y adaptador SMTP; PostgreSQL gestionará claims y leases, y Redis/broker se reconsiderará sólo con evidencia de volumen o contención.
78. Los eventos no soportados se cancelan como intención de notificación con causa controlada; nunca se renderizan por inferencia ni se pasa el JSON completo de Outbox a templates.
79. `SENT` significará aceptación del adaptador/proveedor, no lectura del correo; el portal y el expediente seguirán siendo la fuente de verdad.
80. Los destinatarios de notificación tendrán una clave de cifrado independiente de MFA y tokens de autenticación; la base conserva hash para deduplicar y ciphertext para reintentar sin exponer correo crudo.
81. `NotificationDelivery` será una intención de entrega versionada y no una copia mutable del Outbox; la unicidad incluirá evento, canal, destinatario hash, template y versión.
82. Los mappers y templates de notificaciones se implementarán con allowlist explícita en la siguiente tarea; ningún evento desconocido podrá inferirse desde JSON arbitrario.
83. PostgreSQL conserva invariantes de intentos, hash, claves de template, snapshot cifrado y evidencia de procesamiento; Prisma no será la única capa de integridad.
84. El mapper valida el `aggregateType` esperado por cada evento y mantiene una allowlist explícita; un JSON válido con agregado incorrecto queda rechazado.
85. Los datos enriquecidos por el worker tienen límites de longitud y controles antes de persistirse/renderizarse; los tokens cifrados sólo viajan como material transitorio y nunca como `safePayload`.
86. El proveedor SMTP usa Nodemailer 10.0.1 sin `raw`, archivos ni URLs del mensaje y con `disableFileAccess`/`disableUrlAccess`; la configuración de Mailpit no se mezcla con el contrato de negocio.
87. PostgreSQL es el coordinador de claims de notificaciones en esta escala: cada batch usa `FOR UPDATE SKIP LOCKED`, y un `PROCESSING` cuyo lease expiró puede recuperarse sin introducir Redis prematuramente.
88. El worker incrementa `attempts` al reclamar y sólo completa o falla una entrega si conserva el mismo lease; esto evita que un worker tardío sobrescriba el resultado de otro que recuperó el trabajo.
89. Los reintentos usan jitter acotado 80–120 %, backoff exponencial con máximo de una hora y máximo de intentos configurable; una entrega permanente termina en `FAILED` operable y no se reintenta indefinidamente.
90. El worker descifra destinatarios y tokens únicamente en memoria durante el envío; los logs, payloads seguros, estados operativos y códigos de error no contienen correo crudo, tokens ni respuestas completas del proveedor.
91. La operación local se expone en dos modos: one-shot para jobs controlados y continuo con `SIGINT`/`SIGTERM`; ambos reutilizan el mismo servicio transaccional y no cambian el resultado del agregado comercial.
92. El worker de notificaciones reclama sólo eventos de la allowlist de esta fase; los demás Outbox permanecen disponibles para futuros consumidores de dominio y no se cancelan por inferencia.
93. `OutboxEvent.SENT` en el consumidor de notificaciones significa que la materialización de intents terminó; la entrega SMTP conserva su propio estado en `NotificationDelivery` y puede seguir `PENDING` o `FAILED`.
94. La resolución de destinatarios consulta relaciones activas en PostgreSQL y vuelve a validar IDs, folio, visibilidad, versión, aceptación, documento y token; no confía en que el JSON del Outbox sea suficiente para autorización.
95. Los eventos históricos de cotización se renderizan desde sus identificadores y snapshots persistidos, no desde el estado mutable actual; una cotización aceptada posteriormente no reescribe el aviso de versión enviada.
96. Un evento sin destinatario válido o con visibilidad interna genera una entrega `CANCELLED` con motivo controlado y sin ciphertext; esa traza no puede entrar al claim de correo.
97. La lectura staff de notificaciones usa una proyección mínima seleccionada explícitamente; no consulta ni serializa destinatario, hash/ciphertext, payload, usuario receptor, token, error crudo ni `providerMessageId`.
98. El reintento manual sólo permite `FAILED` con códigos recuperables (`TEMPORARY_PROVIDER` o `RATE_LIMIT`), reinicia intentos/lease de forma explícita y registra auditoría sin PII; una repetición o carrera que ya dejó `PENDING` es idempotente.
99. `notifications.read` y `notifications.manage` siguen separados en backend; `same-origin` sólo protege la mutación y la interfaz nunca se considera una frontera de autorización.
100. La operación staff se presenta como una superficie de diagnóstico, no como visor de contenido; sus breakpoints usan `calc()` para que la evidencia responsive no dependa de una interpretación ambigua de CSS.
101. La política productiva se valida fuera del build local; `.env.example`, hosts de desarrollo, claves conocidas y endpoints locales son bloqueos explícitos, no advertencias silenciosas.
102. `/api/health` conserva liveness y `/api/ready` expresa disponibilidad de PostgreSQL con `no-store`; un balanceador no debe usar liveness para enviar tráfico a una instancia no lista.
103. Las cabeceras de seguridad se centralizan en `next.config.ts`; HSTS sólo se emite cuando el runtime es HTTPS productivo y no se añade un cache global que pueda afectar datos privados.
104. Los backups locales usan el servicio Compose y una base de restauración fija y desechable; no reciben `DATABASE_URL` desde formularios, no sobrescriben archivos y no ejecutan purgas productivas.
105. El gate de preparación agrega evidencia técnica y prerrequisitos externos sin ocultar bloqueos; su salida no incluye stdout/stderr de herramientas, secretos, conexiones ni rutas internas.
106. Fase 11 agrega un módulo `analytics` de lectura sobre PostgreSQL existente; no introduce rollups, materialized views, Redis, BI ni una fuente paralela de verdad sin evidencia de rendimiento.
107. `metrics.read` entrega scope propio y `metrics.read.global` habilita scope global; el backend determina el alcance antes de agregar y la UI no es frontera de autorización.
108. Las fechas del dashboard usan `[from,to)`, máximo de 93 días y `APP_TIMEZONE`; el navegador no puede enviar una zona para alterar alcance o límites.
109. Los importes del dashboard conservan moneda separada y `BigInt` como string; las tasas se serializan como basis points y nunca se convierten monedas.
110. La serialización analítica se concentra en un mapper puro que aplica supresión, claves opacas, fechas y valores seguros antes de construir el response HTTP; no devuelve PII, payloads, destinatarios, storage keys ni ciphertext.
111. La UI del dashboard reutiliza la identidad staff existente con CSS/Intl nativos, sin dependencia de gráficas; los estados de carga, vacío, error, reduced motion, foco y contraste forman parte del módulo terminado.
112. Las lecturas del dashboard usan el rate limit PostgreSQL existente por `actor.userId`, configurable con `ANALYTICS_RATE_LIMIT_MAX_ATTEMPTS`/`ANALYTICS_RATE_LIMIT_WINDOW_MINUTES`, aplicado después de validar rango y antes de ejecutar agregados.
113. Fase 12 reutiliza `AuditLog` y `AuthEvent` como fuentes de verdad; no crea una tabla paralela de eventos ni duplica auditoría transaccional.
114. La lectura operativa y la lectura de seguridad son capabilities distintas: `audit.read` para manager/admin y `audit.security.read` sólo para admin.
115. El contrato de auditoría usa una allowlist por acción para proyectar detalles; metadata desconocida se descarta y nunca se serializa como JSON genérico.
116. Los cursores de auditoría son HMAC opacos, contienen filtros normalizados y se rechazan si se reutilizan con otro rango, categoría, outcome, source o límite.
117. La vista de auditoría no muestra UUIDs, emails, teléfonos, IP, user-agent, hashes, ciphertext, payloads, storage keys ni deep links a entidades.
118. La auditoría es sólo lectura en Fase 12: no hay exportación, purga, retención automática, SIEM ni alertas en tiempo real sin una decisión posterior de producto, legal y operación.
119. La consulta transversal resuelve actores con una selección acotada y un batch único; no se permiten consultas por fila ni enriquecimiento por `entityId`.
120. La revisión `EXPLAIN` de PostgreSQL con el volumen local no justifica un índice transversal adicional: `AuthEvent` usa su índice existente y `AuditLog` resuelve el límite con un scan secuencial submilisegundo; cualquier migración futura requiere volumen representativo y evidencia nueva.
121. Fase 13 reutiliza los contratos backend de autenticación existentes y añade superficies navegables fijas (`/login`, `/portal/access`, `/auth/...`); no crea credenciales demo ni una autorización paralela en el cliente.
122. Los tokens de magic link y recovery se leen una sola vez desde la URL, se limpian con `history.replaceState` y se mantienen sólo en memoria hasta el POST de consumo; no se guardan en almacenamiento persistente del navegador.
123. El runner E2E usa `NEXT_DIST_DIR=.next-e2e` para aislar sus builds del `.next` de un `next dev` activo; la separación evita chunks corruptos sin apagar el entorno local del usuario.
124. El onboarding reutiliza `User`, `ClientContact`, `AuthToken`, Outbox y `Session`; no crea una tabla de invitaciones ni una credencial paralela mientras el modelo existente conserva las garantías necesarias.
125. La acción de habilitar portal se controla con el permiso existente `identity.users.manage`: `manager` y `admin` pueden ejecutarla; `sales` y `customer` no reciben el permiso por defecto.
126. El vínculo cliente-contacto-usuario se resuelve por `emailNormalized` dentro de una transacción con lock de `QuoteRequest`; nunca se reasigna un usuario empleado ni un usuario de otro cliente.
127. Un usuario invitado permanece `INVITED` hasta consumir un magic link vigente; la transición a `ACTIVE`, consumo único y creación de sesión ocurren dentro de la misma transacción.
128. Las invitaciones vigentes se deduplican; una cuenta activa puede recibir un enlace nuevo cuando no existe uno pendiente, y la respuesta staff sólo expone estado operativo y correo del contacto.
129. Las comunicaciones para contactos sin cuenta apuntan a `/portal/access` y usan “Solicitar acceso”; las plantillas y el resolver aplican el fallback para que ningún consumidor genere un enlace muerto a `/portal`.
130. La proyección staff expone únicamente `contact.user.id/status/type`; no expone tokens, hashes, ciphertext, secretos ni datos de autenticación en HTML o API.
131. Los paneles con tabs deben renderizar siempre el `tabpanel` referenciado por `aria-controls`, incluso cuando la colección esté vacía; esta regla evita estados accesibles inválidos durante la carga/empty state.
132. Los tests que ejercitan rate limit persistido deben aislar la clave por caso y limpiar únicamente su hash exacto; no se modifica el límite productivo ni se vacía la tabla global para hacer pasar la suite.
133. El checklist consolidado de lanzamiento separa evidencia local de decisiones externas y mantiene `BLOCKED` mientras falten proveedor, secreto, aprobación legal, RPO/RTO, observabilidad o rollback.
134. `readiness:production:quick` conserva `WARN` porque omite comandos; `readiness:production:full` ejecuta los controles costosos y ambos comandos mantienen exit code distinto de cero cuando existe cualquier `BLOCKED`.
135. Los dumps y checksums de continuidad local viven bajo `.artifacts/` y esa ruta queda ignorada para impedir que datos respaldados entren al repositorio.
136. El restore verificable prepara `ocpool_restore_verify` con comandos PostgreSQL separados para terminar conexiones, hacer `DROP DATABASE` y hacer `CREATE DATABASE`; PostgreSQL no permite el `DROP` dentro de una transacción.

## Pruebas realizadas

Verificación de integración en servidor Linux sobre `d7e40cb`:

- Instalación reproducible con `npm ci`, Node `22.23.2` aislado y Prisma Client 7.10.0 generado.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (31 archivos/116 pruebas), `npm run test:content` y `npm run build` — correctos.
- PostgreSQL, Mailpit y MinIO locales — saludables; 17 migraciones aplicadas y seed correcto.
- `npm run test:integration` — 40/42 archivos pasaron en la corrida serial; dos hooks excedieron el timeout de 10 segundos durante el arranque inicial. La repetición aislada de ambos archivos pasó 2/2 archivos y 4/4 pruebas sin cambios de código.
- E2E pública contractual: el puerto `127.0.0.1:3100` está ocupado por un servicio ajeno que responde 404; no se detuvo ni modificó ese proceso. Se ejecutó la misma suite en `127.0.0.1:3101` con `APP_URL` coincidente y Chromium en una ruta ejecutable fuera del repositorio: `tests/quality.spec.ts` pasó `35/35`; `tests/foundation-health.spec.ts` pasó `2/2`.
- La primera corrida del formulario en el puerto temporal fue rechazada por el `APP_URL` de `.env.example` (`localhost:3000`); al reiniciar el proceso con el origen exacto, el flujo pasó de forma aislada `3/3` y en la regresión completa `35/35`. Esto confirma la protección same-origin y no requiere cambio de producto.
- El build aislado con `NEXT_DIST_DIR` terminó correctamente y se revirtió el cambio automático de Next sobre `tsconfig.json`; no quedan artefactos de pruebas en el repositorio. Node del sistema sigue siendo `20.19.6` (el proyecto recomienda Node 22) y sólo genera la advertencia de compatibilidad del SDK AWS durante las pruebas.
- Revisión 2026-09-09: `npm run typecheck`, `npm run lint`, `npm run test:unit` (31 archivos/118 pruebas), `npm run test:content`, `npm audit --omit=dev --audit-level=high`, `npm run db:validate`, `npx prisma migrate status` y el build aislado con `NEXT_DIST_DIR=.next-verify` pasaron. La integración completa tuvo tres timeouts bajo ejecución paralela; `catalog-quotes-schema` y `messaging-api` pasaron al ejecutarse de forma dirigida. La verificación pública actual queda pendiente de reiniciar PM2 porque el HTML servido referencia chunks que responden `404`.
- Repetición serial posterior: `npm run test:integration` pasó `42/42` archivos y `87/87` pruebas con PostgreSQL local; se conserva la advertencia de Node `20.19.6` frente al runtime recomendado Node 22.
- Tras reiniciar el proceso `ocpool-website` (PM2 ID `7`) con el entorno de desarrollo exportado, el proceso vivo en `127.0.0.1:3008` responde `200` en `/`, `/portal`, `/staff/requests`, `/robots.txt`, `/sitemap.xml`, `/api/health` y `/api/ready`; el formulario público real respondió `201` y generó un folio de prueba. El proceso quedó ejecutándose como `web_front`; el `503` anterior era únicamente la configuración de entorno que PM2 no había recibido.

Gate final ejecutado después de instalación limpia de dependencias:

- `npm ci --no-audit --fund=false --foreground-scripts` — correcto; se recuperó previamente un conflicto Windows `ENOTEMPTY` moviendo sólo directorios generados de `node_modules`, sin tocar código ni datos.
- `npm run db:up` — PostgreSQL y Mailpit activos.
- `npm run db:validate` — schema válido.
- `npm run db:generate` — cliente Prisma 7.10.0 generado.
- `npm run db:migrate:deploy` — sin migraciones pendientes.
- `npm run db:seed` — correcto e idempotente.
- `npm test` — correcto en el estado final: typecheck, 29 unitarias, 9 integraciones PostgreSQL, contrato de contenido, build, 29 E2E públicos con 2 omitidas explícitamente y 1 E2E foundation dedicado.
- Tras Tarea 1 de Fase 3: `npm run test:unit` 34/34, `npm run test:integration` 9/9, `npm run typecheck` y `npm run lint` correctos.
- Tras Tarea 2 de Fase 3: `npm run test:integration` 10/10, `npm run db:validate`, `npm run db:generate`, migración aplicada/inspeccionada, `npm run db:seed`, `npm run typecheck` y `npm run lint` correctos.
- Tras Tarea 3 de Fase 3: prueba dirigida del servicio 2/2 y `npm run test:integration` 12/12; incluye concurrencia de folios, replay idempotente, agregado atómico, historial, auditoría y Outbox.
- Tras Tarea 4 de Fase 3: `npm run test:integration` 14/14, prueba E2E dirigida del formulario 1/1 y `npm run build`, `npm run typecheck` y `npm run lint` correctos; la suite pública valida API, responsive, accesibilidad, consola y folio.
- Gate final de Fase 3: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy` sin pendientes, `npm run db:seed` idempotente, `npm run test:unit` 35/35, `npm run test:integration` 20/20, `npm run test:content`, `npm run build`, E2E pública 31/31 con 2 omitidas explícitamente, foundation E2E 1/1 y auth E2E 1/1.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilidades después de fijar `deepmerge-ts@8.0.2` y `mysql2@3.24.3` mediante overrides compatibles con Prisma 7.10.0.
- `npm run lint` — correcto.
- `npm run test:e2e:auth` — 1 flujo correcto: fixture desechable, login, sesión, rechazo de logout foreign-origin y logout.
- `npm run test:content` — correcto.
- `npx tsc --noEmit` / `npm run typecheck` — correctos, incluyendo los tipos de las pruebas Playwright y Vitest.
- Revisión independiente de seguridad — sin hallazgos Critical/Important bloqueantes después de corregir rate limit sin IP, body chunked, retorno temprano antes de Argon2 y circuit breaker condicionado por IP confiable.
- `git diff --check` — correcto.
- Tarea 1 de Fase 4: prueba roja inicial de contrato, después `npm run test:unit` 41/41, `npm run test:integration` 20/20, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Tarea 2 de Fase 4: migración `20260908032000_catalog_quotes`, `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npx prisma migrate status`, `npm run db:seed`, schema dirigido 3/3, integración completa 23/23, typecheck, lint y `git diff --check` correctos.
- Tarea 3 de Fase 4: `npm run test:integration` 25/25, `npm run test:unit` 41/41, `npm run typecheck`, `npm run lint` y `git diff --check` correctos; se verificaron snapshots históricos, permisos, edición de borrador, transición de envío, aceptación bloqueada, concurrencia y limpieza de fixtures.
- Tarea 4 de Fase 4: commit `861e4d8` (`feat: add protected catalog and price operations`); `npm run test:integration` 28/28, `npm run test:unit` 41/41, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` 32/32 ejecutadas con 2 omitidas explícitamente y `git diff --check` correctos. Se verificaron 401/403, same-origin, archivado, precios solapados, permisos de ventas/gerencia, UI restringida sin sesión y formato monetario sin floats.
- Tarea 5 de Fase 4: commit `2909b62` (`feat: add protected quote builder workflow`); `npm run test:integration` 30/30, `npm run test:unit` 41/41, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` 33/33 ejecutadas con 3 omitidas explícitamente y `git diff --check` correctos. La prueba opt-in `QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts` pasó 1/1 con login real, selección de expediente, creación de borrador, revisión y envío. Se verificaron serialización BigInt, 401/403, same-origin, IDOR por expediente inexistente, permisos de edición/descuento/aprobación, inmutabilidad post-envío y actualización atómica de la solicitud.
- Gate de Fase 4: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npx prisma migrate status`, `npm audit --omit=dev --audit-level=high` (0 vulnerabilidades) y `npm test` correctos. `npm test` quedó en typecheck, 41 unitarias, 30 integraciones, contrato de contenido, build, 33 E2E ejecutadas con 3 omitidas explícitamente y foundation 1/1. La primera ejecución tuvo una condición temporal de artefacto `.next` al encadenar dos servidores en Windows; la reproducción aislada y la repetición completa pasaron sin cambiar código productivo.
- Tarea 1 de Fase 5: commit `17a50e9` (`feat: add scoped client portal read service`); `npm run typecheck`, unit test dirigido 1/1, integración dirigida 1/1 y `git diff --check` correctos. Se verificaron scope por cliente, rechazo de empleado, cliente cruzado como `NOT_FOUND`, ocultamiento de borradores/actores internos y serialización de importes grandes sin `number`.
- Tarea 2 de Fase 5: commit `76214bd` (`feat: expose scoped client portal APIs`); `npm run typecheck`, `npm run lint`, integración API dirigida 1/1 y `git diff --check` correctos. Se verificaron 401 sin sesión, 403 empleado, cliente propio, cliente cruzado, cotización cruzada, UUIDs seguros, `cache-control: no-store` y respuestas sin token/hash.
- Tarea 3 de Fase 5: commit `0d90fc9` (`feat: add customer portal dashboard`); `npm run typecheck`, `npm run lint`, E2E dirigida `npx playwright test tests/quality.spec.ts --grep "customer portal"` 1/1 y `git diff --check` correctos. Se verificaron acceso restringido sin sesión, Axe sin violaciones serias, ausencia de overflow a 390 px, metadata privada, estados de carga/vacío/error/logout y shell responsive propio del cliente.
- Tarea 4 de Fase 5: commit `c0da91e` (`feat: show customer quote snapshots`); integración dirigida, API dirigida, `npm run typecheck`, `npm run lint`, E2E de protección y `git diff --check` correctos. Se verificó que actualizar catálogo después del envío no altera nombre, precio, impuesto ni total del snapshot mostrado al cliente; la vista comunica vigencia expirada sin habilitar acciones fuera de alcance.
- Tarea 5 de Fase 5: pendiente de commit en este cierre; `npm run test:unit` 42/42, `npm run test:integration` 32/32, `npm run typecheck`, `npm run lint`, E2E opt-in `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2 y `git diff --check` correctos. Se verificaron sesiones revocadas/archivadas, aislamiento por cliente, UUID malformado, payloads sin secretos, Axe, estado vacío, error recuperable, consola limpia y responsive móvil.
- Tarea 5 de Fase 5: commit `af55a09` (`test: harden customer portal isolation`); `npm run test:unit` 42/42, `npm run test:integration` 32/32, `npm run typecheck`, `npm run lint`, E2E opt-in `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2 y `git diff --check` correctos. Se verificaron sesiones revocadas/archivadas, aislamiento por cliente, UUID malformado, payloads sin secretos, Axe, estado vacío, error recuperable, consola limpia y responsive móvil.
- Gate de Fase 5: `npm run db:validate`, `npm run db:generate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npx prisma migrate status`, `npm test`, `npm audit --omit=dev --audit-level=high` (0 vulnerabilidades) y árbol limpio correctos. `npm test` quedó en 42 unitarias, 32 integraciones, contenido, build, 34 E2E públicas con 5 omitidas explícitamente y foundation 1/1.
- Tarea 2 de Fase 6: prueba dirigida `messaging-service.test.ts` 1/1 y `npm run test:integration` 34/34; `npm run typecheck`, `npm run lint` y `git diff --check` correctos. Se verificaron dos clientes aislados, permisos de empleado, nota interna fuera de proyección cliente, idempotencia secuencial y concurrente, rate-limit injectable, cierre/reapertura y Outbox/auditoría sin cuerpos.
- Tarea 3 de Fase 6: commit `8446663` (`feat: expose protected messaging APIs`); prueba API `messaging-api.test.ts` 3/3 y `npm run test:integration` 37/37; `npm run typecheck`, `npm run lint` y `git diff --check` correctos. Se verificaron 401/403/404/409/429, scope IDOR, same-origin, schemas estrictos, `no-store`, RBAC limitado y ausencia de notas/IDs internos en portal.
- Tarea 4 de Fase 6: implementación y cierre documental de UI cliente; E2E opt-in `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` 2/2, `npm run test:unit` 45/45, `npm run test:integration` 37/37 serializado, `npm run test:e2e` 34/34 ejecutadas con 5 omitidas explícitamente, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:content` y `git diff --check` correctos. Se verificaron lectura/envío/refresh, notas internas invisibles, cierre de conversación, error recuperable, responsive, Axe, consola limpia y payload cliente mínimo.
- Tarea 5 de Fase 6: commits `09d979f`, `f2b0e4b` y `9eb9a04`; E2E opt-in `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` 2/2, `messaging-api.test.ts` 4/4, `npm run test:unit` 45/45, `npm run test:integration` 38/38, `npm run test:e2e` 34/34 ejecutadas con 7 omitidas explícitamente, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:content`, migraciones/seed, `npm audit --omit=dev --audit-level=high` (0) y `git diff --check` correctos. Se verificaron separación de visibilidades, dos perfiles RBAC, compositores independientes, cierre/reapertura, Axe, consola y no overflow.
- Tarea 6 de Fase 6: commit `6e1037c` (`test: harden messaging security matrix`) más cierre documental; API `messaging-api.test.ts` 4/4 con negative checks finales, E2E cliente 2/2, staff 2/2, auth 1/1 y constructor 1/1. Gate `npm test` 45 unitarias, 38 integraciones, contenido, build, 34 E2E públicas ejecutadas con 7 omitidas explícitamente y foundation 1/1; `npm run db:validate`, `npm run db:migrate:deploy`, `npm run db:seed`, `npm audit --omit=dev --audit-level=high` (0) y `git diff --check` correctos. Se verificaron IDOR, sesión/RBAC, same-origin, rate limit, idempotencia concurrente, cierre, UUID inválido, Axe, responsive, consola, cleanup y ausencia de cuerpos sensibles en HTML/payloads/logs/Outbox.
- Fase 7 — planificación: especificación `docs/historicos/specs/2026-09-08-ocpool-private-files.md` y plan `docs/historicos/plans/2026-09-08-ocpool-private-files.md` creados y revisados; aún no cuenta como evidencia de implementación ni como fase terminada.
- Fase 7 — Tarea 1: prueba dirigida de dominio 6/6, schema 1/1, migración aplicada, Prisma validate/generate, seed, typecheck, lint y diff check correctos. No se agregaron dependencias ni servicios externos.
- Fase 7 — Tarea 2: scanner 3/3, servicio transaccional 3/3, storage MinIO 1/1, unitarias completas 54/54, typecheck/lint, Compose y auditoría de dependencias correctos. Se verificaron replay/concurrencia, rechazo por firma, expiración, cleanup, soft delete, URL efímera y no exposición de keys/bytes.
- Fase 7 — Tarea 3: `private-files-api.test.ts` 4/4, typecheck y lint dirigidos correctos. Se verificaron 401/403/404, cliente cruzado, same-origin, Zod estricto, upload/complete/download/delete, visibilidad interna, rol limitado, rate limit, no-store y ausencia de storage keys en proyecciones.
- Fase 7 — Tarea 4: `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` pasó 2/2 con carga real a MinIO, finalización, disponibilidad, persistencia tras recarga y descarga; Axe, consola, no overflow y logout correctos. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 7 — Tarea 5: `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` pasó 2/2 con carga staff real, validación, borrado confirmado, descarga, separación compartido/interno, aislamiento de rol limitado, Axe, consola y no overflow. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 7 — Tarea 6/gate: 54 unitarias, 47 integraciones, contenido, build, 34 E2E públicas con 7 omitidas explícitamente, foundation 1/1, portal 2/2, staff 2/2, migraciones/seed/auditoría de dependencias y Compose saludables. Árbol limpio y diff check correctos.
- Fase 8 — Tarea 1: prueba roja inicial del dominio; después `npm run test:unit` 57/57, `npm run typecheck`, `npm run db:validate`, `npm run db:generate`, migración aplicada y prueba de persistencia `quote-documents-schema.test.ts` 1/1. Se verificaron estados, elegibilidad, normalización, documentos READY incompletos, duplicados, hashes y aceptación vinculada.
- Fase 8 — Tarea 2: `quote-pdf-renderer.test.ts` 3/3, `quote-pdf-service.test.ts` 1/1, `npm run typecheck`, fixture generado de 2 páginas, `pdftoppm` sin errores de fuente invalidante, `pdfinfo` metadata estable y `pypdf` con folio/resumen/total presentes y texto interno ausente.
- Fase 8 — Tarea 3: `quote-acceptance-service.test.ts` 1/1 y `quote-documents-api.test.ts` 2/2 dirigidas; se verificaron aceptación concurrente con un ganador, replay, PDF READY/hash/HEAD, scope cruzado, 401/403/404/409, CSRF, schema estricto, permisos, no-store y no exposición de storage key/hash. `npm run typecheck` y `npm run lint` correctos.
- Fase 8 — Tarea 4: `npx cross-env PORTAL_E2E=1 playwright test tests/client-portal.spec.ts` pasó 2/2; se verificaron descarga PDF, popup/API presigned, validación negativa del checkbox, diálogo accesible, aceptación, refresh, mensajería persistida, archivos, Axe, consola limpia y responsive móvil. `npm run typecheck` y `npm run lint` correctos.
- Fase 8 — Tarea 5: `quote-documents-api.test.ts` pasó 2/2 con estado `MISSING`/`READY`, cliente bloqueado, acciones condicionadas, evidencia post-aceptación y ausencia de `storageKey`/`sha256`; `npx cross-env QUOTES_E2E=1 npx playwright test tests/quotes.spec.ts` pasó 1/1 con generación real en MinIO, descarga presigned, Axe, consola limpia, payload mínimo y no overflow desktop/móvil. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 9 — Tarea 1: prueba roja inicial de contratos; `tests/unit/notifications-domain.test.ts` y `tests/unit/env.test.ts` pasaron 8/8; `notifications-schema.test.ts` pasó 1/1 contra PostgreSQL con duplicados, hash inválido, destinatario sin cifrado y estados incompletos rechazados. `npm run db:validate`, `npx prisma migrate status`, `npm run db:seed`, `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Fase 9 — Tarea 2: pruebas rojas de templates/provider, después `notifications-templates.test.ts`, `email-provider.test.ts` y `env.test.ts` 13/13; se verificaron ocho templates, escape HTML/texto, scope interno, agregado incorrecto, tamaños, URL allowlist, header injection y credentials SMTP. Nodemailer 10.0.1 pasó `npm audit --omit=dev --audit-level=high` con 0; Mailpit aceptó un mensaje real con from/reply-to correctos y el fixture fue eliminado.
- Fase 9 — Tarea 3: pruebas dirigidas de dispatcher/worker/esquema 3/3 y unitarias 8/8; se verificaron upsert idempotente, carrera de dos workers, recuperación de lease, transición condicional, envío exitoso, retry temporal, fallo terminal por máximo de intentos y códigos de error controlados.
- Gate técnico de Tarea 3: `npm run test:unit` 77/77, `npm run test:integration` 55/55 serializado, `npm run db:validate`, `npx prisma migrate status` con 15 migraciones al día, `npm run db:seed`, `npm run worker:notifications:once` sin pendientes, `npm run typecheck`, `npm run lint`, `git diff --check` y `npm audit --omit=dev --audit-level=high` con 0 vulnerabilidades.
- Fase 9 — Tarea 4: `notifications-fanout.test.ts` 2/2; se verificaron audiencias de solicitudes, asignaciones, cotización enviada, aceptación con total snapshot, mensajes, archivos, visibilidad interna, cross-scope y cancelación trazable.
- Fase 9 — Tarea 4: `notifications-mailpit.test.ts` 1/1; el worker integrado materializó auth, envió por SMTP real, verificó asunto/from/destinatario en Mailpit y eliminó el fixture por ID.
- Gate técnico de Tarea 4: `npm run test:unit` 77/77, `npm run test:integration` 58/58 serializado, `npm run db:validate`, `npx prisma migrate status` con 16 migraciones al día, `npm run db:seed`, `npm run worker:notifications:once`, typecheck, lint, diff check y `npm audit --omit=dev --audit-level=high` con 0 vulnerabilidades. Mailpit quedó vacío después de la verificación.
- Fase 9 — Tarea 5: `notifications-staff.test.ts` y `notifications-staff-api.test.ts` 5/5; se verificaron proyección sin secretos, 401/403, RBAC separado, same-origin, retryable/permanent, auditoría e idempotencia.
- Fase 9 — Tarea 5: `npx cross-env AUTH_E2E=1 REUSE_E2E_SERVER=1 APP_URL=http://127.0.0.1:3100 playwright test tests/staff-notifications.spec.ts` pasó 1/1; se verificaron Axe, teclado, reduced motion, payload sin destinatario/contenido, consola limpia y no overflow en 390/768/1440 px.
- Fase 9 — Tarea 5: `npm run test:unit` 77/77, `npm run test:integration` 63/63 serializado, `npm run typecheck`, `npm run lint`, `npm run build` y `git diff --check` correctos. El rate limit de login local no se relajó: el E2E de superficie usa sesión de fixture explícita y limpia su sesión/entregas por ID.
- Fase 9 — Gate Tarea 6: `npm run db:validate`, `npx prisma migrate status` con 16 migraciones al día y `npm run db:seed` correctos. `npm run worker:notifications:once` reclamó 25 eventos Outbox, canceló 25 no soportados, procesó 4 entregas y envió 4 mensajes sin retries/fallos; se verificó su contenido en Mailpit y se eliminaron únicamente esos 4 IDs, quedando el buzón en 0.
- Fase 9 — Gate Tarea 6: `npm run test:unit` 77/77, `npm run test:integration` 63/63 serializado, `npm run test:content`, `npm run typecheck`, `npx eslint src/app src/components src/lib scripts tests playwright.config.ts`, `npm run build`, `npm audit --omit=dev --audit-level=high` con 0 vulnerabilidades, E2E staff 1/1 y `git diff --check` correctos.
- Fase 10 — Tarea 1: prueba dirigida 4/4 para política de runtime; `npm run validate:production` bloquea `.env.example` con códigos seguros, typecheck, lint dirigido y diff check correctos.
- Fase 10 — Tarea 2: unitarias de headers/readiness 4/4, integración readiness 34 archivos/64 pruebas, typecheck, lint, build y foundation E2E 2/2 correctos. `/api/ready` mantiene `no-store`, request ID y no expone SQL/secretos.
- Fase 10 — Tarea 3: contrato de runbooks 4/4, parser PowerShell sin errores y diff check correctos; no se ejecutó restauración destructiva ni se tocó `ocpool_dev`.
- Fase 10 — Tarea 4: unitarias/integración del gate 4/4; `readiness:production:full` reportó 11 `PASS`, 0 `WARN`, 8 `BLOCKED`; `npm run test:e2e:foundation` pasó 2/2; `npm run test:e2e` pasó 34/34 con 9 omitidas opt-in; typecheck, lint, auditoría, build e integración serial correctos.
- Fase 11 — Tarea 4: `DASHBOARD_E2E=1 npm run test:e2e -- tests/dashboard.spec.ts` pasó 1/1. Se verificaron sesión restringida, sesión manager, rango histórico vacío, Axe sin violaciones serious/critical, no overflow a 390/768/1440, reduced motion, metadata privada, enlaces contextuales y consola autenticada limpia.
- Fase 11 — Tarea 4: `npm run typecheck`, `npm run lint`, `npm run build` y `git diff --check` correctos. La primera E2E detectó una condición de carrera al hidratar fechas; se protegió la edición del usuario. Axe detectó contrastes bajos en índices/estado protegido; se corrigieron con tonos AA y se repitió la E2E.
- Fase 11 — Tarea 5: prueba roja de serialización confirmó la ausencia del mapper; después `analytics-serialization.test.ts` pasó 1/1 verificando BigInt como string, monedas separadas, supresión, claves opacas y ausencia de identificadores/payloads/ciphertext/storage keys en JSON.
- Fase 11 — Tarea 5/gate: se añadió y probó rate limit de lecturas por empleado (`RATE_LIMITED` 429) con limpieza exacta de buckets; `npm run test:integration` terminó en 37 archivos/71 pruebas.
- Fase 11 — Gate final: `npm run test:e2e` pasó 34/34 con 10 opt-in omitidas de forma explícita; `npm run test:e2e:foundation` pasó 2/2; la E2E `DASHBOARD_E2E=1` pasó 1/1 después del hardening. Build, typecheck, lint, contenido, auditoría (0 vulnerabilidades altas), migraciones, seed y diff check pasaron.
- Fase 12 — Tarea 6/gate final: runbook `docs/runbooks/audit-observability.md`, contrato documental 5/5, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` en PostgreSQL 16, 110 unitarias, 79 integraciones, contenido, typecheck, lint, build limpio, `npm audit` con 0 vulnerabilidades altas, E2E audit 1/1, E2E normal 34 passed/11 skipped opt-in y diff check. Se corrigieron fixtures contaminables de auditoría y folios analytics; no se agregó índice especulativo.
- Fase 13 — Tasks 1–5: prueba roja inicial confirmó la ausencia de `/login`; después `3ebf8f6` añadió `/login`, `/login/recovery`, `/portal/access`, `/auth/recovery` y `/auth/customer/consume-link`, enlaces desde estados restringidos, shell responsive, metadata `noindex`, MFA opcional, limpieza de tokens y fixtures desechables. `AUTH_SURFACES_E2E=1 npm run test:e2e -- tests/auth-surfaces.spec.ts` pasó 5/5 con Axe, responsive 390/768/1440, reduced motion y replay/expiry.
- Fase 13 — Tarea 6/gate final: runbook `docs/runbooks/auth-surfaces.md`, contrato documental añadido, 110 unitarias, 79 integraciones, contenido, typecheck, lint, build aislado `.next-e2e`, `npm audit` con 0 vulnerabilidades altas, E2E auth surfaces 5/5, E2E normal 34 passed/16 skipped opt-in y diff check. Se corrigieron contrastes AA y carrera de chunks del runner sin introducir migración ni credenciales fijas.
- Fase 14 — planificación y revisión: especificación, autorrevisión, plan ordenado y límites de seguridad documentados antes de código.
- Fase 14 — Tarea 1: migración `20260908201805_premium_quote_intake`, enums PostgreSQL nullable para etapa/horizonte/rango, dimensiones acotadas y contratos de dominio; schema, unitarias y persistencia verificadas.
- Fase 14 — Tarea 2: API pública y servicio transaccional ampliados con campos opcionales, validación estricta, honeypot genérico e idempotencia preservada; invalid enum/honeypot cubiertos.
- Fase 14 — Tarea 3: inbox y constructor staff proyectan la calificación con labels controlados y `No indicado`; no se exponen hashes, IDs internos ni BigInt sin serializar.
- Fase 14 — Tarea 4: formulario público en dos pasos con focus de primer error, conservación al regresar, consentimiento, honeypot, feedback accesible y layout responsive; E2E dirigida 2/2 y regresión normal 35 passed/16 skipped opt-in.
- Fase 14 — Gate final: `db:validate`, `db:migrate:deploy`, `db:seed`, typecheck, lint, 112 unitarias, 79 integraciones, contenido, build, E2E completa, `npm audit --omit=dev --audit-level=high` (0 vulnerabilidades) y `git diff --check` correctos.

La suite E2E completa descubre 41 pruebas: auth, foundation, portal, mensajería staff y cotizaciones staff se omiten en el comando normal para no exigir fixtures/infraestructura; todas fueron validadas de forma dedicada en el gate.

## Pruebas pendientes

- Pruebas unitarias restantes de servicios comerciales y reglas persistidas.
- Pruebas de IDOR sobre clientes, solicitudes, expedientes y futuras cotizaciones.
- Matrices E2E opt-in adicionales para escenarios prolongados de cliente/empleado y recuperación.
- Pruebas finales de archivos privados: staff, seguridad de fase, URLs temporales, cleanup y proveedor antivirus productivo.
- Casos límite adicionales de snapshots, inmutabilidad y cálculo de cotizaciones.
- Prueba de larga duración del worker continuo bajo apagado coordinado; la lógica de shutdown, recuperación y proveedor no disponible sí tiene cobertura dirigida del servicio.
- Pruebas de carga del worker y restauración de backups en destino aislado.
- Fase 14 no tiene pendientes técnicos locales para su alcance; antes de producción debe validarse el copy/legal de privacidad, abuso real del honeypot/rate limit y el onboarding que vincula el contacto captado con un usuario cliente.
- Fase 11 no tiene pendientes técnicos locales para su alcance; antes de producción debe repetirse la revisión de rendimiento con volumen representativo y confirmar la política de operación.
- Confirmar antes de producción la zona `APP_TIMEZONE`, definiciones comerciales de periodo y alcance por ejecutivo/sucursal.
- Fase 12 no tiene pendientes técnicos locales dentro de su alcance; la siguiente revisión deberá tratar retención, exportación, SIEM, alertas y operación productiva como decisiones nuevas, no como deuda oculta de esta fase.
- Fase 13 Tarea 1: la primera corrida falló en el primer selector esperado porque `/staff/requests` aún no enlazaba `/login`; tras implementar la vertical slice, la repetición pasó 5/5. El contrato documental del runbook quedó añadido a unitarias.
- Fase 17 no tiene pendientes técnicos locales dentro de su alcance; para producción permanecen pendientes todos los controles externos del checklist consolidado.

## Riesgos abiertos

- Reglas de moneda, IVA, descuentos y redondeos aún no confirmadas.
- Alcance de datos por ejecutivo, sucursal o zona aún no confirmado.
- Proveedor de correo transaccional de producción aún no seleccionado.
- Política de retención y eliminación de datos personales pendiente de revisión formal.
- Requisitos legales de aceptación y evidencia pendientes de revisión jurídica.
- Destino de despliegue de producción aún no definido.
- El gate de Fase 10 permanece `BLOCKED` por SMTP productivo, DNS/TLS/SPF/DKIM/DMARC, antivirus, backup externo, retención legal, destino de despliegue y runtime no productivo.
- Fase 16 confirmó el gate completo en `11 PASS`, `0 WARN`, `8 BLOCKED`; el resultado es correcto pero no equivale a autorización de lanzamiento.
- El backup/restore local fue verificado en Fase 17 sobre `ocpool_restore_verify`; la recuperación externa, RPO/RTO, cifrado, retención y monitoreo siguen pendientes.
- El gate técnico no sustituye aprobación legal, elección de proveedores, gestión de secretos, RPO/RTO, monitoreo, rollback ni aceptación del responsable del servicio.
- El dashboard calcula agregados transaccionales directos; falta medir P95 con fixtures representativos y revisar `EXPLAIN` antes de decidir si la escala futura requiere rollups.
- La zona `America/Chihuahua` es configurable para el entorno local, pero la zona comercial definitiva y su calendario deben aprobarse antes de producción.
- Las definiciones de alcance por ejecutivo, sucursal o zona no están confirmadas; Fase 11 sólo implementa self/global con permisos explícitos.
- La auditoría transversal no tiene todavía una política legal de retención/purga; Fase 12 no eliminará eventos ni inventará plazos.
- El índice transversal por tiempo de `AuditLog`/`AuthEvent` no se añadirá sin `EXPLAIN` con volumen representativo; el costo de una futura migración sigue pendiente.
- La protección por IP requiere `TRUST_PROXY_HEADERS=true` sólo detrás de un proxy confiable que sobrescriba la IP. Sin IP confiable, el backend usa límites por identificador y un circuit breaker global separado; el proxy de producción debe aportar rate limiting por origen.
- La infraestructura de identidad, solicitudes, cotizaciones, aceptación, mensajería y archivos ya escribe Outbox y la Fase 9 Tareas 4–5 lo materializan y operan; siguen pendientes el proveedor productivo y el hardening operacional.
- El Outbox de mensajería conserva eventos de cierre/reapertura fuera de la allowlist de correo; no se cancelan porque quedan disponibles para futuros consumidores de dominio.
- El scanner local de Fase 7 validará firma y tipo, pero no sustituirá antivirus; antes de producción deberá existir proveedor, política de cuarentena, pruebas de evasión y operación de reintentos.
- MinIO local está incorporado al Compose con credenciales de desarrollo; producción deberá reemplazarlas mediante secretos y política de bucket privada.
- El scanner local sólo valida firma/tipo/hash; proveedor antivirus productivo, cuarentena operacional, backups y restauración de objetos siguen pendientes de hardening.
- La aceptación backend, portal y staff ya están operativos y protegidos; el lanzamiento todavía requiere revisión legal de términos, política de firma, notificaciones productivas, retención y gate de producción.
- La primera ejecución E2E de Tarea 6 rechazó correctamente el retry por un `APP_URL` heredado distinto del origen del navegador; se reinició el servidor con `APP_URL=http://127.0.0.1:3100` y la repetición pasó 1/1 sin relajar same-origin.
- El cleanup inicial de Mailpit usó una ruta individual incorrecta; se consultó el Swagger local y se corrigió a `DELETE /api/v1/messages` con la lista exacta de IDs, dejando el buzón en 0 sin borrar mensajes ajenos.
- Fase 12 UI: la primera E2E del visor reveló que los tags `<em>` se estaban renderizando como texto y provocaban overflow móvil; se corrigió con JSX semántico. También se aislaron fixtures por categoría/resultado y se limpiaron errores HTTP esperados antes de evaluar la consola autenticada.
- Puede existir una diferencia temporal residual entre cuentas existentes e inexistentes en solicitudes de link/recovery; no hay enumeración en respuesta ni payload.

## Deuda técnica conocida

- El portal ya tiene shell, detalle versionado, mensajería, archivos privados, PDF y aceptación dentro del alcance local; permanecen pendientes la revisión legal y los controles productivos externos.
- El endpoint de contacto actual no debe considerarse backend comercial.
- El timestamp de la migración foundation es el generado por Prisma en la ejecución local (`20260907231807_foundation`); no se renombró después de aplicarlo para no desalinear el historial de migraciones.
- Las versiones transitorias de Prisma están fijadas en `package.json` para mantener la auditoría limpia; deben revisarse cuando Prisma publique una actualización estable que incorpore esas versiones de forma nativa.
- La migración de documentos reutiliza el prefijo privado de objetos existente; si producción separa buckets o proveedores, deberá conservarse la misma política de privacidad y verificarse el contrato de migración.
- La plantilla comercial usa fuentes PDF estándar por compatibilidad; si diseño requiere una fuente de marca embebida, deberá incorporarse en formato TTF/OTF válido y repetir el gate de visores Poppler, navegador y extracción.
- El worker y la superficie staff están verificados localmente con Mailpit; producción todavía requiere proveedor, SPF/DKIM/DMARC, alertas, retención de entregas y política de reintentos operada.

## Dependencias entre módulos

- `src/server/env.ts` es dependencia de Prisma, seed y runtime del servidor.
- Docker Compose debe proporcionar PostgreSQL antes de migraciones, integración y health E2E.
- Prisma schema/migraciones son dependencia de cualquier módulo comercial con persistencia.
- Logger y errores HTTP son dependencias transversales de las futuras APIs.
- La separación Playwright/Vitest protege la regresión de landing mientras crece el backend.
- Fase 2 (identidad/RBAC) debe preceder a expedientes, cotizaciones y portal porque todos requieren autorización backend.
- Las rutas de autenticación dependerán de `sessions.ts`, `tokens.ts`, `mfa.ts`, `rate-limit.ts`, `permissions.ts`, el logger y el envelope de errores.
- Los contratos de `src/server/modules/quotes/domain.ts` son dependencia de schema, servicio de precios, snapshots persistidos y constructor.
- El schema de Fase 4 y la migración son dependencia del servicio de resolución de precios y creación de versiones.
- El servicio de `src/server/modules/quotes/service.ts` es dependencia de las APIs internas y del constructor operativo.
- El servicio y las rutas de `src/server/modules/catalog/` son dependencia del selector de conceptos, listas y precios del constructor.
- Fase 5 depende de sesiones/actor de cliente de Fase 2, solicitudes de Fase 3 y snapshots/versiones de Fase 4.
- Fase 6 depende de sesiones/RBAC de Fase 2, scope de solicitudes de Fase 3, Outbox/auditoría transaccional y portal de cliente de Fase 5.
- Fase 8 depende de snapshots/versiones de cotización de Fase 4, portal/sesiones de Fase 5, storage privado de Fase 7 y del contrato PDF/aceptación de Tareas 1–3 antes de la UI cliente.
- Fase 8 Tarea 5 depende de las APIs de documento/aceptación de Tarea 3 y del workspace staff de cotizaciones; no puede inferir evidencia desde el portal cliente.
- Fase 9 dependerá del Outbox transaccional de identidad, solicitudes, cotizaciones, mensajería y aceptación; el canal de entrega no podrá cambiar el resultado de la transacción comercial.
- Fase 9 Tarea 2 dependió de los contratos/persistencia de `NotificationDelivery`, `readServerEnv()` y el Outbox transaccional; Tarea 3 consumió sus mappers, templates y provider.
- Fase 9 Tarea 3 dejó disponible el dispatcher, el fan-out idempotente, los estados, leases, intentos, proveedor, payloads safe y diagnóstico; Tarea 4 consumió ese contrato para resolver destinatarios reales por evento y Tarea 5 lo expuso de forma segura al staff.
- Fase 9 Tarea 6 cerró el gate local con Mailpit como proveedor de desarrollo; el origen configurado para E2E debe coincidir exactamente con `APP_URL` para que la protección same-origin se pruebe sin falsos negativos.
- Fase 10 depende de la configuración de entorno, schema/migraciones, Outbox/worker, storage privado y evidencia de todas las fases anteriores; no introduce un servicio de datos paralelo.
- La política de runtime alimenta el gate de producción; `/api/ready` depende de PostgreSQL; los runbooks dependen del Compose local; el gate no puede convertir evidencia local en autorización externa.
- Fase 11 depende de identidad/RBAC, solicitudes, asignaciones, historial, cotizaciones snapshot, aceptación, notificaciones, `APP_TIMEZONE` y la API de errores; no introduce autorización duplicada.
- `/staff` depende sólo del endpoint privado de dashboard y de los enlaces existentes de operación; la UI no accede a Prisma ni decide permisos.
- Fase 12 depende de identidad/sesiones/RBAC, logger/errores HTTP, `AuditLog`/`AuthEvent` existentes, `APP_TIMEZONE`, rate limit PostgreSQL y los eventos transaccionales de solicitudes, cotizaciones, mensajería, archivos, documentos y notificaciones.
- `/staff/audit` depende del contrato del módulo audit y no debe reutilizar el scope comercial de solicitudes ni inferir autorización desde filtros del navegador.

## Problemas encontrados y resolución

- El `pull` del servidor estaba bloqueado por diez cambios locales sobre `a1887ed`. Se protegieron en un commit, se rebasaron sobre `c8f748e` y se resolvieron los conflictos manteniendo el flujo persistido actual; la ruta `send-email` permaneció eliminada y el lockfile remoto quedó libre de ruido de metadata local.
- El servidor exponía Node 20 y una caché npm con propietario distinto. La verificación usó Node 22 y caché temporal aislados, sin cambiar propietarios globales ni mezclar las cuentas del sistema.
- `.next` conservaba tipos generados para `/api/send-email`; el artefacto previo se movió a `/tmp/ocpool-next-pre-integration-20260908` y Prisma/Next regeneraron artefactos coherentes con las rutas actuales.

- Vitest 5 exigía tipos Node 22; se actualizó `@types/node` al rango compatible con Node 22.14.
- Playwright descubría pruebas unitarias `.test.ts`; se limitó el patrón E2E a `*.spec.ts`.
- Vitest no cargaba `.env` en integración; se añadió `tests/setup-env.ts`.
- El guard de migraciones no cargaba `.env`; se añadió `dotenv/config` y una prueba de contrato.
- La primera prueba E2E pública tuvo un timeout intermitente en overflow horizontal; la repetición posterior con la configuración corregida terminó en 29/29.
- El wrapper npm para argumentos Prisma eliminó `--name`; se usó el CLI directo y se conservó el timestamp generado para no renombrar una migración aplicada.
- Next.js no acepta el enum ambient de `@node-rs/argon2` con `isolatedModules`; se usó el valor estable `2` para Argon2id y se verificó con build y pruebas.
- La revisión de seguridad detectó reutilización de la clave MFA, tokens de recovery paralelos y carrera de sesión; se separó `AUTH_DELIVERY_ENCRYPTION_KEY`, se invalidan recovery tokens pendientes y la resolución de sesión usa actualización condicional atómica.
- La revisión posterior detectó y corrigió bloqueo global por `unknown-client`, lectura tardía de bodies chunked, hashing Argon2 antes del rate limit y aplicación excesiva del circuit breaker; cada corrección quedó cubierta por pruebas unitarias o de integración.
- El E2E de producción local inicialmente no reenviaba cookies `Secure` sobre HTTP; se mantuvo `Secure` y la prueba valida atributos y transporta explícitamente el valor opaco para probar la API.
- La primera compuerta final encontró contaminación de buckets sintéticos entre ejecuciones; el test de API ahora limpia únicamente sus hashes de fixture y quedó estable en la repetición completa.
- La prueba del seed asumía que el contador de folios siempre era `1`; se corrigió para verificar que el seed sea idempotente y preserve secuencias ya consumidas.
- El typecheck conservó referencias generadas al endpoint legado después de retirarlo; el build de producción regeneró `.next` y confirmó el árbol de rutas final sin `send-email`.
- La ejecución paralela de integración expuso aserciones frágiles sobre folios y buckets de rate limit; se corrigieron para tolerar concurrencia controlada y limpiar únicamente fixtures identificables.
- La ejecución paralela completa de integración volvió a provocar timeouts de inicio de transacción y cascadas de cleanup con fixtures aún no creados; la corrida serializada pasó 18/18 archivos y 37/37 pruebas, y el script oficial quedó fijado a `--maxWorkers=1`.
- La primera regresión E2E completa tuvo dos timeouts de cierre del contexto bajo carga; ambos casos pasaron aislados y la segunda regresión completa terminó 34/34, sin cambios productivos derivados de ese falso negativo.
- La primera E2E staff encontró que el estado de cierre se devolvía plano mientras el componente esperaba una propiedad `conversation`; se corrigió el mapeo y se añadió una prueba que valida que el composer desaparece al cerrar.
- La primera E2E de notificaciones detectó contraste insuficiente en un enlace por especificidad CSS; se reforzó la regla staff y Axe pasó sin violaciones serias.
- La verificación manual same-origin inicialmente usó un `APP_URL` distinto al origen del navegador; el servidor de prueba se reinició con la URL exacta y la protección permaneció activa.
- La prueba responsive detectó que `min(100% - Npx, ...)` se interpretaba con anchura incorrecta en Chromium; las variantes staff se cambiaron a `min(calc(100% - Npx), ...)` y el E2E pasó en tres anchos.
- La primera E2E de archivos encontró selectores ambiguos porque el nombre del archivo también aparece en la acción de descarga; se ajustaron los asserts a nombres exactos y Axe detectó un contraste insuficiente en el distintivo `PDF`, corregido antes de cerrar Tarea 4. En Tarea 5, Axe detectó un `<ul role="tabpanel">` inválido; se separó el contenedor ARIA del listado.
- La primera E2E de aceptación abrió el popup en `about:blank` antes de navegar al PDF; la aserción se trasladó a la respuesta API y se mantuvo el popup sólo como verificación de apertura. El primer flujo de éxito remonteaba el componente antes de mostrar confirmación; el refresh del expediente se movió a `Continuar`. Finalmente, la prueba de mensajería esperaba un mensaje optimista antes de que el fetch terminara; se añadió polling de persistencia DB antes de recargar.
- Axe del inbox staff detectó contraste bajo y selects sin nombre; se corrigieron variables de color y `aria-label` explícitos, y la E2E staff volvió a pasar 2/2.
- La primera E2E del constructor con PDF encontró un selector ambiguo por el `role=status` del estado de carga documental; se acotaron los asserts al aviso principal. La misma revisión Axe detectó contraste insuficiente en fechas del historial y un selector sin nombre; se corrigieron color y `aria-label`, y la repetición pasó 1/1 en desktop y móvil.
- El cold build local agotó el timeout original de 120 segundos al iniciar Playwright; se amplió sólo `webServer.timeout` a 600 segundos y el build explícito terminó correctamente.
- El gate de seguridad encontró vulnerabilidades transitorias de Prisma; se resolvieron con overrides verificables y se repitió la suite completa antes de cerrar Fase 3.
- `npx tsc --noEmit` encontró tipos incompletos en pruebas existentes; se corrigieron sin relajar `strict`.
- La primera ejecución dirigida de la integración de notificaciones omitió `RUN_DB_TESTS=1` y falló por el guard de entorno; se repitió con el script oficial y pasó 1/1, sin cambio productivo asociado.
- Nodemailer 7 introducía vulnerabilidades altas conocidas en la auditoría de dependencias; se actualizó a Nodemailer 10.0.1, se conservaron sólo opciones SMTP controladas y se deshabilitaron accesos a archivos/URLs del mensaje.
- La primera verificación del proveedor con `tsx -e` usó await de nivel superior en salida CommonJS; se repitió con una IIFE async y la entrega a Mailpit pasó, sin cambio de producto asociado.
- La revisión de concurrencia de Tarea 3 detectó una carrera en el manejo de fallos: una entrega podía volver a `PENDING` y ser reclamada antes de la segunda escritura. Se corrigió con una única actualización condicional ligada al lease reclamado y se añadió una prueba de dos workers.
- La primera prueba de máximo de intentos no aislaba correctamente el umbral configurable; se ajustó el fixture para verificar explícitamente la transición terminal `FAILED` y el código persistido `TEMPORARY_PROVIDER`.
- El primer gate Windows intentó ejecutar `npm.cmd` sin shell y marcó falsamente todos los comandos como fallidos (`EINVAL`); se corrigió usando shell sólo para comandos internos fijos y se verificó nuevamente el gate completo.
- Las opciones `--dry-run`/`--no-*` de npm pueden ser interpretadas por npm antes de llegar al script; se añadieron scripts npm explícitos `readiness:production:quick` y `readiness:production:full` para evitar ambigüedad.
- La primera E2E del dashboard asumía una base vacía, pero el seed local ya contenía solicitudes recientes; se volvió determinista aplicando un periodo histórico válido sin datos.
- La primera E2E de Fase 13 detectó tres contrastes AA insuficientes en textos secundarios de acceso; se ajustaron a tonos del sistema de agua y la repetición Axe pasó.
- La repetición de E2E encontró una carrera entre el `next dev` activo en `.next` y el build del runner, que dejó un chunk faltante; el runner ahora usa `NEXT_DIST_DIR=.next-e2e` aislado y `.gitignore` lo excluye, sin apagar el servidor de desarrollo.
- La hidratación inicial del rango podía sobrescribir una edición rápida del usuario mientras llegaba una respuesta; se añadió una marca de edición y el mapper de carga sólo inicializa campos una vez.
- Axe detectó contraste insuficiente en índices decorativos y en `Muestra protegida`; se conservaron los tonos de la identidad y se ajustaron a valores que cumplen AA.
- Una corrida dirigida mezcló integraciones sin `RUN_DB_TESTS=1` y falló por el guard de entorno, no por producto; la evidencia válida de integración se mantiene en el comando serial oficial con PostgreSQL activo.
- La revisión final detectó que la especificación de Fase 11 exigía limitar lecturas y la primera implementación aún no lo aplicaba; se corrigió con rate limit configurable por empleado, prueba 429, limpieza exacta y nueva integración 71/71.
- Fase 15 — documentación de diseño: especificación, autorrevisión y plan creados en ese orden antes de código; la fase reutiliza el permiso existente `identity.users.manage` y no agrega tabla de invitaciones.
- Fase 15 — Tarea 1: prueba roja de RBAC/capability, después `tests/unit/auth-permissions.test.ts` 2/2, typecheck y commit `d25bb1a`.
- Fase 15 — Tarea 2: `customer-auth-invitation.test.ts` 2/2; se verificaron helper transaccional, Outbox sin token crudo, activación `INVITED → ACTIVE`, replay, expiración y rechazo de token ligado a empleado. Commits `cb7787e` y `1c6b78a`.
- Fase 15 — Tarea 3: `customer-onboarding-service.test.ts` 4/4 y `customer-onboarding-api.test.ts` 2/2; se verificaron creación/reutilización, pending deduplication, cuenta activa, cliente/contacto archivado, UUID inválido, correo de otro cliente/empleado, same-origin, sesión, RBAC, schema `{}` y respuesta sin secretos. Commit `4f92b2d` y hardening `8183321`.
- Fase 15 — Tarea 4: `notifications-templates.test.ts` 8/8 y `notifications-fanout.test.ts` 2/2; contactos sin cuenta usan `/portal/access` + “Solicitar acceso”, mientras usuarios vinculados conservan portal y los eventos internos siguen cancelados. Commit `67199a9`.
- Fase 15 — Tarea 5: E2E opt-in `CUSTOMER_ONBOARDING_E2E=1 npx playwright test tests/customer-onboarding.spec.ts` 2/2; manager, deduplicación, rol limitado, Axe y responsive 390/768/1440 correctos. La misma ejecución detectó `aria-controls` sin `tabpanel` en archivos vacíos; se corrigió y la repetición pasó. Commit `9a5fb21`.
- Fase 15 — Gate final: `npm run db:validate` correcto, `npm run db:migrate:deploy` sin pendientes sobre 17 migraciones, `npm run db:seed` idempotente, `npm run typecheck`, `npm run lint`, `npm run test:unit` 31 archivos/114 pruebas, `npm run test:integration` 42 archivos/87 pruebas serializadas, `npm run test:content`, `npm run build`, `npm run test:e2e` 35 passed/18 skipped opt-in, `npm audit --omit=dev --audit-level=high` con 0 vulnerabilidades y `git diff --check` correctos. La E2E opt-in de onboarding quedó verificada aparte en 2/2.
- Fase 16 — diagnóstico: la integración aislada de invitaciones falló con `consumed.ok === false` por un bucket persistido bloqueado de `127.0.0.1`; la causa fue contaminación de fixture, no del flujo de negocio.
- Fase 16 — Tarea 1: `customer-auth-invitation.test.ts` usa una IP de prueba única por caso y elimina sólo su hash de `customer-magic-link-consume-ip`; la prueba dirigida pasó 2/2 en dos ejecuciones consecutivas.
- Fase 16 — Tarea 2: `runbook-contract.test.ts` pasó 7/7; se añadió `docs/runbooks/launch-readiness-checklist.md` y quedó enlazado desde README y `production-readiness.md`.
- Fase 16 — Gate técnico: `npm run db:validate`, migraciones 17 al día, seed idempotente, typecheck, lint, unitarias 31/115, integración 42/87, contenido, build, auditoría con 0 vulnerabilidades y foundation E2E 2/2 correctos; E2E base 35 passed/18 skipped opt-in.
- Fase 16 — Readiness: quick `BLOCKED` con `0 PASS / 2 WARN / 7 BLOCKED`; full `BLOCKED` con `11 PASS / 0 WARN / 8 BLOCKED`. Permanecen bloqueados runtime productivo y los siete controles externos; no se autoriza publicación.
- Fase 17 — documentación y aislamiento: especificación, autorrevisión y plan creados en ese orden; `.artifacts/` ignorado; el contrato de continuidad pasó de `7/8` rojo a `8/8` después de separar las llamadas DDL del restore.
- Fase 17 — operación: backup local con checksum `PASS`; restore corregido `PASS` en `ocpool_restore_verify` con `35` tablas públicas; cleanup exacto `DROP DATABASE IF EXISTS ocpool_restore_verify` correcto y consulta posterior dejó únicamente `ocpool_dev`.
- Fase 17 — regresión: `npm run typecheck`, `npm run lint` correctos y `npm run test:unit` `31 archivos / 116 pruebas` aprobadas; `git check-ignore` y `git diff --check` correctos.

## Criterio de terminado de Fase 1

Se considera terminada porque la base instala desde cero, levanta servicios reproducibles, valida y aplica migraciones, ejecuta seed idempotente, expone un health check seguro, separa pruebas por capa, conserva la landing y pasa el gate documentado. No implica que el producto comercial completo esté terminado.

## Planes vigentes

- `docs/ocpool-commercial-v2/specs/2026-09-10-ocpool-commercial-ux-rearchitecture.md` — especificación normativa V2 activa para todas las superficies privadas; landing excluida.
- `docs/ocpool-commercial-v2/reviews/2026-09-10-ocpool-commercial-ux-rearchitecture-review.md` — auditoría crítica y mapa de evidencia P0 que justifican el reemplazo del plan anterior.
- `docs/ocpool-commercial-v2/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md` — fuente operativa maestra V2; G0-05, el gate formal R1 y sus aprobaciones son los siguientes gates.
- `docs/adr/2026-09-10-commercial-lifecycle-v2.md` — ADR de ciclo canónico V2, verificado localmente y pendiente de aprobación de producto.
- `docs/adr/2026-09-10-commercial-policy-v1.md` — ADR de política comercial/fiscal/legal, bloqueado hasta registrar decisiones.

- `docs/historicos/plans/2026-09-07-ocpool-foundation.md` — Fase 1, fundamentos técnicos, ejecutado.
- `docs/historicos/plans/2026-09-07-ocpool-identity-rbac.md` — Fase 2, plan aprobado y ejecutado.
- `docs/historicos/plans/2026-09-07-ocpool-clients-requests.md` — Fase 3, plan técnico ejecutado; Tareas 1–6 terminadas con gate final.
- `docs/historicos/specs/2026-09-07-ocpool-client-portal.md` — especificación aprobada para Fase 5.
- `docs/historicos/plans/2026-09-07-ocpool-client-portal.md` — Fase 5, plan aprobado y ejecutado; Tareas 1–6 cerradas con gate verde.
- `docs/historicos/plans/2026-09-07-ocpool-catalog-quotes.md` — Fase 4, Tareas 1–6 ejecutadas; gate cerrado.
- `docs/historicos/specs/2026-09-07-ocpool-messaging.md` — especificación aprobada para Fase 6.
- `docs/historicos/specs/2026-09-07-ocpool-messaging-apis.md` — contrato HTTP privado de la Tarea 3, aprobado y ejecutado.
- `docs/historicos/plans/2026-09-07-ocpool-messaging.md` — plan aprobado y ejecutado para Fase 6; Tareas 1–6 cerradas con gate verde.
- `docs/historicos/plans/2026-09-07-ocpool-messaging-apis.md` — plan enfocado de APIs, ejecutado.
- `docs/historicos/specs/2026-09-07-ocpool-customer-messaging-ui.md` — especificación aprobada y ejecutada para la UI cliente de la Tarea 4.
- `docs/historicos/plans/2026-09-07-ocpool-customer-messaging-ui.md` — plan enfocado de UI cliente, ejecutado.
- `docs/historicos/specs/2026-09-08-ocpool-staff-messaging-ui.md` — especificación aprobada y ejecutada para la UI staff de la Tarea 5.
- `docs/historicos/plans/2026-09-08-ocpool-staff-messaging-ui.md` — plan enfocado de UI staff, ejecutado.
- `docs/historicos/specs/2026-09-08-ocpool-private-files.md` — especificación aprobada para Fase 7; fase cerrada.
- `docs/historicos/plans/2026-09-08-ocpool-private-files.md` — plan ordenado de Fase 7; Tareas 1–6 cerradas con gate verde.
- `docs/historicos/specs/2026-09-08-ocpool-pdf-acceptance.md` — especificación aprobada para Fase 8; no implica firma electrónica avanzada por sí sola.
- `docs/historicos/plans/2026-09-08-ocpool-pdf-acceptance.md` — plan ordenado de Fase 8; Tareas 1–6 cerradas con gate verde.
- `docs/historicos/specs/2026-09-08-ocpool-notifications.md` — especificación aprobada para Fase 9.
- `docs/historicos/reviews/2026-09-08-ocpool-notifications-review.md` — autorrevisión de Fase 9, completada antes de código.
- `docs/historicos/plans/2026-09-08-ocpool-notifications.md` — plan ordenado de Fase 9; Tareas 1–6 cerradas para el gate local, con hardening productivo y revisión legal todavía explícitos como riesgos de lanzamiento.
- `docs/historicos/specs/2026-09-08-ocpool-staff-private-files-ui.md` — especificación enfocada para la UI staff de archivos de Tarea 5.
- `docs/historicos/plans/2026-09-08-ocpool-staff-private-files-ui.md` — plan enfocado ordenado para ejecutar Tarea 5.
- `docs/historicos/specs/2026-09-08-ocpool-production-hardening.md` — especificación aprobada para Fase 10; separa controles técnicos locales de decisiones externas.
- `docs/historicos/plans/2026-09-08-ocpool-production-hardening.md` — plan ordenado de Fase 10; Tareas 1–4 ejecutadas con gate local `BLOCKED` de forma intencional.
- `docs/historicos/specs/2026-09-08-ocpool-analytics-dashboard.md` — especificación aprobada para Fase 11; métricas operativas, scope, privacidad, rendimiento y UI.
- `docs/historicos/plans/2026-09-08-ocpool-analytics-dashboard.md` — plan ordenado de Fase 11; Tareas 1–6 cerradas con gate técnico local.
- `docs/runbooks/analytics-dashboard.md` — runbook operativo de definiciones, fechas, permisos, diagnóstico seguro y pruebas.
- `docs/historicos/specs/2026-09-08-ocpool-audit-observability.md` — especificación aprobada para Fase 12; lectura segura de auditoría operativa y security.
- `docs/historicos/reviews/2026-09-08-ocpool-audit-observability-review.md` — autorrevisión de Fase 12; metadata, RBAC, cursor, N+1, retención y AuthEvent revisados antes de implementación.
- `docs/historicos/plans/2026-09-08-ocpool-audit-observability.md` — plan ordenado de Fase 12; Tasks 1–6 cerradas con evidencia de gate.
- `docs/runbooks/audit-observability.md` — runbook de acceso, filtros, redacción, rate limit, `EXPLAIN`, backup y límites legales de auditoría.
- `docs/historicos/specs/2026-09-08-ocpool-auth-surfaces.md` — especificación de Fase 13 para login de empleados, magic link de clientes y recovery.
- `docs/historicos/reviews/2026-09-08-ocpool-auth-surfaces-review.md` — autorrevisión de Fase 13 con foco en enumeración, MFA y tokens en URL.
- `docs/historicos/plans/2026-09-08-ocpool-auth-surfaces.md` — plan TDD de Fase 13; Tasks 1–6 cerradas con evidencia de gate.
- `docs/runbooks/auth-surfaces.md` — rutas, worker/Mailpit, tokens, MFA, recovery y pruebas locales.
- `docs/historicos/specs/2026-09-08-ocpool-premium-quote-intake-design.md` — especificación de Fase 14 para captación progresiva y calificación comercial.
- `docs/historicos/reviews/2026-09-08-ocpool-premium-quote-intake-review.md` — autorrevisión de Fase 14 sobre datos históricos, anti-spam, privacidad y onboarding.
- `docs/historicos/plans/2026-09-08-ocpool-premium-quote-intake.md` — plan TDD de Fase 14; Tasks 1–5 cerradas con evidencia de gate.
- `docs/historicos/specs/2026-09-08-ocpool-customer-onboarding-design.md` — especificación aprobada de Fase 15 para vinculación, invitaciones, activación y aislamiento.
- `docs/historicos/reviews/2026-09-08-ocpool-customer-onboarding-review.md` — autorrevisión de Fase 15 sobre RBAC, colisiones, tokens, Outbox, enumeración y UX.
- `docs/historicos/plans/2026-09-08-ocpool-customer-onboarding.md` — plan TDD histórico de Fase 15; Tasks 1–6 cerradas para su alcance local.
- `docs/historicos/specs/2026-09-08-ocpool-launch-readiness-consolidation.md` — especificación de Fase 16 para reproducibilidad de fixtures, gate y checklist de lanzamiento.
- `docs/historicos/reviews/2026-09-08-ocpool-launch-readiness-consolidation-review.md` — autorrevisión de Fase 16 sobre aislamiento, conteos y límites de publicación.
- `docs/historicos/plans/2026-09-08-ocpool-launch-readiness-consolidation.md` — plan TDD de Fase 16; tareas ejecutadas con evidencia final.
- `docs/runbooks/launch-readiness-checklist.md` — checklist único de preflight local y bloqueos externos.
- `docs/historicos/specs/2026-09-08-ocpool-local-continuity-verification.md` — especificación de Fase 17 para backup/restore local aislado.
- `docs/historicos/reviews/2026-09-08-ocpool-local-continuity-verification-review.md` — autorrevisión de Fase 17; identificó la restricción DDL de PostgreSQL antes del cierre.
- `docs/historicos/plans/2026-09-08-ocpool-local-continuity-verification.md` — plan ordenado de Fase 17 con evidencia del backup, restore, cleanup y regresión.
- `docs/runbooks/local-development.md` — formulario público, folio, honeypot, worker/Mailpit y dependencia de onboarding.

## Criterio de terminado de Fase 10

La fase se considera terminada para el alcance local porque la política de runtime, headers, readiness, continuidad, runbooks y gate tienen implementación, pruebas, documentación y evidencia reproducible. No se considera autorización de lanzamiento: los checks externos permanecen `BLOCKED` hasta contar con proveedores, decisiones legales, backups, observabilidad y destino operativo aprobados.

## Criterio de terminado de Fase 11

La fase queda terminada para el alcance local: el dashboard está documentado, serializado de forma segura, revisado contra regresiones y cubierto por el gate completo de pruebas. La revisión de `EXPLAIN` local no justifica índices especulativos con el volumen actual; antes de producción deberá repetirse con volumen representativo. La UI y API no autorizan lanzamiento por sí mismas; el bloqueo productivo de Fase 10 permanece vigente.

## Criterio de terminado de Fase 12

La fase queda terminada para el alcance local: el contrato de lectura, los permisos separados, la redacción por acción, el cursor HMAC, el repositorio sin N+1, el rate limit, la API privada, la UI responsive/accesible, el runbook y el gate unitario/integración/E2E/build/lint/auditoría están verificados. La ausencia de exportación y purga quedó documentada como decisión explícita, no como omisión. Las necesidades de retención productiva, exportación, SIEM, alertas y controles externos permanecen fuera del alcance local y no autorizan el lanzamiento.

## Criterio de terminado de Fase 13

La fase queda terminada para el alcance local: las cinco rutas de acceso funcionan con contratos reales, no enumeran cuentas, no filtran tokens, respetan MFA/sesión/same-origin/rate limit, cubren estados de carga/error/éxito, son responsive y accesibles, pasan E2E opt-in y regresión completa, están documentadas y el árbol queda limpio. El gate externo de producción permanece separado y bloqueado.

## Criterio de terminado de Fase 14

La fase queda terminada para el alcance local: el intake público persiste sus datos controlados en columnas relacionales, mantiene folio/idempotencia/consentimiento y protecciones HTTP, proyecta la calificación en staff, ofrece una UI de dos pasos con errores accesibles y responsive, pasa pruebas dirigidas y regresión completa, y cuenta con README, runbooks, autorrevisión, plan y evidencia de gate. No incluye onboarding automático de cliente, adjuntos anónimos ni autorización de lanzamiento.

## Criterio de terminado de Fase 15

La fase queda terminada para el alcance local cuando el personal autorizado puede habilitar el portal desde un expediente sin crear credenciales manuales, el usuario se vincula a un único cliente, `INVITED` sólo se activa al consumir un magic link vigente, los tokens se deduplican/invalidan con seguridad, las notificaciones previas al onboarding apuntan a `/portal/access`, la UI staff refleja capabilities y estados con responsive/Axe, el flujo tiene pruebas unitarias/integración/E2E y README/runbooks/plan/status contienen evidencia reproducible. No autoriza lanzamiento: correo productivo, proveedores, legal, backups, observabilidad y destino operativo siguen bloqueados.

## Criterio de terminado de Fase 16

La fase queda terminada para el alcance local cuando los fixtures de rate limit son aislados y repetibles, la integración completa pasa sin contaminación de estado, el checklist consolidado separa evidencia local de bloqueos externos, el contrato documental pasa, el gate técnico completo y la regresión E2E están verificados, y el plan/status/README/runbooks contienen los conteos exactos. No autoriza lanzamiento: runtime productivo, SMTP, dominio, antivirus, backups externos, RPO/RTO, retención/legal, destino, supervisor, observabilidad y rollback siguen bloqueados.

## Criterio de terminado de Fase 17

La fase queda terminada para el alcance local cuando `.artifacts/` está excluido de Git, el backup con checksum pasa, el restore real crea y verifica `ocpool_restore_verify`, PostgreSQL prepara el target mediante DDL separado, el cleanup elimina sólo la base desechable, `ocpool_dev` permanece disponible, los contratos/typecheck/lint/unitarias pasan y el plan/status registran evidencia segura. No equivale a disaster recovery productivo: backup externo, RPO/RTO, cifrado, retención, objetos y monitoreo siguen bloqueados.

## Criterio de terminado de Fase 5

La fase se considera terminada porque el cliente autenticado sólo lee recursos de su `clientId`, las cotizaciones históricas se sirven desde snapshots, las rutas privadas no enumeran recursos ajenos ni exponen secretos, la UI cubre estados de sesión/carga/vacío/error, responsive, teclado, reduced motion y Axe, y el gate de infraestructura, build, pruebas, auditoría y árbol limpio quedó registrado.

## Próximo paso autorizado

Registrar aprobación/rechazo de G0-01 en el artefacto de aceptación del plan maestro V2 y, si se aprueba, continuar G0-02…G0-05 antes de cualquier mutación funcional S0. Las Fases 1–17 se conservan como baseline histórico y los controles externos de lanzamiento continúan en paralelo. No publicar hasta que `readiness:production:full` no tenga bloqueos técnicos ni externos y exista autorización formal independiente del repositorio.
