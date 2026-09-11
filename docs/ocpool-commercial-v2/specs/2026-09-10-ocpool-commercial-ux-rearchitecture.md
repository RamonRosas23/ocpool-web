# OCPOOL — Especificación normativa de experiencia comercial V2

**Fecha:** 2026-09-10
**Versión:** 2.0
**Estado:** revisada técnicamente; los cambios funcionales de flujo, datos y UI comienzan únicamente después de cerrar el gate G0 del plan maestro. G0 sí puede crear documentación, fixtures, medición e infraestructura inerte de flags/QA.
**Superficies:** sistema staff, portal del cliente y autenticación privada.
**Fuera de alcance:** landing pública, su contenido, composición, estilos, recursos y comportamiento.

## 1. Propósito

Convertir OCPOOL en una herramienta comercial que reduzca decisiones innecesarias y conserve siempre el contexto. El resultado debe ser rápido para ventas, seguro para la operación, claro para el cliente y visualmente consistente con una empresa premium sin adoptar la escala editorial de la landing dentro de una herramienta de trabajo.

Esta especificación reemplaza, para las superficies privadas, las decisiones de experiencia de documentos anteriores cuando exista contradicción. No invalida la evidencia histórica ni las invariantes de seguridad ya implementadas.

No existe obligación de conservar páginas, componentes o rutas actuales. Sí existe obligación de conservar o mejorar las invariantes comprobadas: aislamiento por cliente, RBAC backend, snapshots, auditoría, idempotencia, almacenamiento privado, Outbox, sesiones, MFA y errores seguros.

## 2. Dictamen de la auditoría

La aplicación tiene una base técnica valiosa, pero el flujo comercial actual no está consolidado. El problema no es sólo visual:

- solicitud y cotización usan máquinas de estado parcialmente duplicadas;
- `Quote.currentVersionId` mezcla borrador de trabajo y propuesta publicada;
- el portal puede mostrar una versión `EN_REVISION` porque sólo excluye `BORRADOR`;
- el sistema anuncia el envío antes de que el PDF esté listo;
- el constructor puede recalcular una versión desde el precio vigente en vez de representar su snapshot;
- el cliente envía una clave de términos hardcodeada y el servidor no prueba el texto exacto aceptado;
- acciones presentadas por el frontend no siempre son transiciones legales del backend;
- el catálogo está truncado a los primeros 50 conceptos dentro del constructor;
- filtros, selección y pestañas no viven en la URL;
- no existe shell staff compartido, cierre de sesión staff ni navegación consistente;
- `globals.css` mezcla la landing con más de 1,800 líneas de estilos públicos y privados;
- la experiencia obliga a saltar entre solicitudes, cotizaciones y catálogo para completar una sola intención.

El plan maestro ejecuta primero G0 para fijar decisiones y evidencia. Una vez superado ese gate, el orden de cambio funcional es:

1. contener filtraciones y discrepancias actuales;
2. persistir el contrato canónico de dominio ya acordado en G0;
3. construir comandos y proyecciones confiables;
4. crear el sistema privado compartido;
5. entregar recorridos verticales completos;
6. validar con usuarios antes de retirar el legado.

## 3. Norte inmutable

### 3.1 Promesa al personal

> “Veo qué requiere mi atención, abro un solo expediente y el sistema me guía hasta completar la acción correcta.”

### 3.2 Promesa al cliente

> “Entiendo qué recibió OCPOOL, qué está ocurriendo, si necesito actuar y cuál propuesta exacta estoy revisando.”

### 3.3 Principios

1. Una intención del usuario tiene un lugar principal para completarse.
2. El sistema presenta una acción primaria sólo cuando ese actor puede avanzar.
3. Si la acción depende de otra persona, muestra quién debe actuar, desde cuándo y qué puede hacer mientras espera.
4. La UI consume acciones permitidas por el servidor; no reconstruye transiciones ni permisos con mapas locales.
5. La versión interna y la versión publicada son conceptos distintos.
6. Publicar no significa que el correo ya fue entregado.
7. Ninguna versión interna aparece en el portal.
8. Todo importe histórico se representa desde su snapshot.
9. Lo frecuente requiere pocos pasos; lo avanzado aparece bajo demanda.
10. Las automatizaciones son predecibles, auditables, idempotentes y reversibles cuando corresponda.
11. Las acciones externas, irreversibles o de impacto económico muestran un preflight comprensible.
12. Folios, estados técnicos, centavos, basis points, UUID y códigos legales no se convierten en instrucciones para usuarios finales.
13. El logo oficial identifica la aplicación; las iniciales “OC” no sustituyen la marca.
14. La tipografía privada es de sistema, sobria y legible; la expresividad proviene de composición, iconografía, color y detalle, no de títulos gigantes.
15. La landing permanece congelada y aislada del sistema visual privado.

## 4. Actores y trabajos principales

### 4.1 Ventas

Necesita:

- identificar su siguiente pendiente en menos de 10 segundos;
- tomar una solicitud sin apropiarse accidentalmente del trabajo de otra persona;
- corregir datos autorizados;
- solicitar información enviando el mensaje en la misma acción;
- preparar una propuesta sin elegir dos veces el expediente;
- encontrar cualquier concepto y crear una línea especial sin contaminar el catálogo;
- guardar sin miedo a perder trabajo;
- solicitar aprobación y conocer quién debe responder;
- publicar una propuesta sólo cuando documento, destinatario y términos sean correctos;
- continuar una negociación sin ocultar al cliente la última propuesta publicada.

### 4.2 Gerencia comercial

Necesita:

- ver colas globales y carga;
- reasignar con trazabilidad;
- resolver aprobaciones con contexto y comparación económica;
- administrar catálogo, precios y política comercial;
- detectar bloqueos, vencimientos y fallos de entrega;
- revisar indicadores sin reemplazar el centro de trabajo.

### 4.3 Administración/operación

Necesita:

- operar usuarios, auditoría, notificaciones y configuración conforme a permisos;
- diagnosticar fallos sin ver secretos;
- usar kill switches y procedimientos de recuperación documentados;
- no mezclar herramientas técnicas con el recorrido diario de ventas.

### 4.4 Cliente

Necesita:

- recibir una explicación clara después de solicitar cotización;
- entrar al portal sin creer que el folio es una contraseña;
- llegar desde el correo al expediente exacto;
- distinguir “OCPOOL está trabajando” de “necesitamos algo de ti”;
- consultar la última propuesta publicada y su historial visible;
- descargar el documento correcto;
- pedir cambios o aceptar sin incertidumbre legal ni técnica;
- comunicarse y compartir archivos dentro del expediente.

## 5. Alcance de superficies

### Incluido

- `/staff` y todas sus rutas;
- `/portal`, acceso, consumo de enlace y todas sus rutas privadas;
- `/login`, recuperación y MFA;
- APIs, servicios, jobs, modelos, documentos y notificaciones que soportan esos recorridos;
- PDF comercial;
- catálogo, listas de precios, impuestos y políticas necesarias para cotizar;
- futuro handoff a proyecto, sólo cuando exista una entidad real.

### Excluido y protegido

- `src/app/page.tsx`;
- estilos y selectores usados únicamente por la landing;
- navegación, formulario público y activos visuales públicos, salvo un defecto crítico aprobado por el usuario;
- rebranding de OCPOOL;
- microservicios, SPA separada o reescritura de infraestructura sin evidencia de necesidad.

El gate de landing compara contenido, screenshots y flujos públicos antes y después de cada slice privado.

## 6. Arquitectura de información objetivo

### 6.1 Staff

```text
/staff                              Centro de trabajo
/staff/requests                     Cola de solicitudes, filtros en URL
/staff/requests/new                 Alta manual rápida
/staff/requests/[requestId]         Expediente comercial único
  ?tab=summary                      Resumen y siguiente acción
  ?tab=quote                        Constructor y versiones
  ?tab=conversation                 Mensajes compartidos y notas internas
  ?tab=files                        Archivos
  ?tab=activity                     Actividad comercial visible para staff
/staff/catalog                      Administración global de catálogo/precios
/staff/approvals                    Cola gerencial, sólo si tiene permiso
/staff/projects                     Proyectos reales, sólo cuando el módulo exista
/staff/operations/notifications     Diagnóstico autorizado
/staff/operations/audit             Auditoría autorizada
/staff/settings                     Política comercial autorizada
```

`/staff/quotes` deja de ser un segundo universo operativo. Durante la migración redirige a la vista correspondiente de solicitudes o al expediente indicado. No habrá dos constructores.

### 6.2 Portal

```text
/portal                             Inicio sereno y lista paginada
/portal/requests/[requestId]        Expediente del cliente
  ?tab=overview                     Etapa y siguiente paso
  ?tab=proposal                     Propuesta publicada e historial visible
  ?tab=messages                     Conversación
  ?tab=files                        Archivos compartidos
/portal/access                      Solicitud de acceso con estados claros
```

Los enlaces de notificación apuntan al recurso exacto. Después de consumir un magic link, el token desaparece de la URL y el redirect sólo puede usar un destino interno previamente permitido.

### 6.3 Navegación y retorno

- `/staff` es siempre el inicio de trabajo, no la landing.
- El logo staff enlaza a `/staff`; el logo portal enlaza a `/portal`.
- “Volver” usa una ruta explícita y conserva filtros/scroll; no depende únicamente de `history.back()`.
- Breadcrumbs representan jerarquía, no sustituyen el botón volver en móvil.
- En móvil, una selección abre una ruta/pantalla completa; lista y detalle no se apilan en una columna interminable.
- Toda selección, búsqueda, orden, página, vista y pestaña compartible vive en la URL.

## 7. Shell y sistema visual privado

### 7.1 Shell staff

- sidebar persistente en escritorio y drawer accesible en móvil;
- logo oficial, nombre de producto y entorno cuando no sea producción;
- navegación filtrada por capacidades devueltas por servidor;
- usuario, rol efectivo y cierre de sesión verificable;
- breadcrumb, título, acción primaria y acciones secundarias;
- área de avisos globales para fallos operativos relevantes;
- `main#contenido` válido para el skip link.

Navegación primaria: Trabajo, Solicitudes y Catálogo cuando tenga permiso. Aprobaciones, Proyectos y Operación aparecen sólo a los roles aplicables. Métricas gerenciales viven como sección del centro de trabajo, no como puerta de entrada obligatoria para ventas.

### 7.2 Shell portal

- logo oficial y regreso coherente al inicio del portal;
- identidad del cliente y cierre de sesión;
- lenguaje sereno, sin términos internos;
- estado y acción requerida antes que decoración;
- navegación móvil prioritaria.

### 7.3 Tipografía y densidad

La UI privada usa una pila de sistema:

```css
font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
  Inter, Roboto, Helvetica, Arial, sans-serif;
```

Escala objetivo:

| Uso | Tamaño | Line-height |
| --- | ---: | ---: |
| Título de página | 28–36 px | 1.15–1.25 |
| Título de sección | 20–28 px | 1.2–1.3 |
| Texto operativo | 14–16 px | 1.45–1.6 |
| Metadata | mínimo 12 px | mínimo 1.4 |
| Etiqueta/control | mínimo 13 px | mínimo 1.3 |

No se permiten títulos operativos de 80–122 px. La escala espacial parte de 4 px y prioriza múltiplos de 8 px. Objetivos táctiles: mínimo 44 × 44 px.

### 7.4 Personalidad visual

- superficies claras con contraste suficiente y profundidad discreta;
- azul/verde de marca para navegación y estados positivos;
- cobre como acento selectivo, no como texto pequeño de bajo contraste;
- bordes, sombras suaves, iconos funcionales y barras de progreso sólo cuando comuniquen información;
- una ilustración o fotografía sólo si ayuda a orientación o estado vacío;
- ningún adorno compite con total, vigencia, bloqueo o acción primaria;
- un solo set de iconos consistente, acompañado por texto en acciones ambiguas.

### 7.5 Componentes

El sistema privado tendrá wrappers propios con API estable:

- `AppShell`, `PageHeader`, `Breadcrumbs`, `UserMenu`;
- `Button`, `IconButton`, `LinkButton`, `ActionMenu`;
- `FormField`, `TextField`, `TextArea`, `NumberField`, `MoneyField`, `PercentField`;
- `SelectField`, `RemoteComboBox`, `DateField`, `DateRangeField`;
- `Tabs`, `Dialog`, `AlertDialog`, `Drawer`, `Popover`, `Tooltip`, `Toast`;
- `StatusBadge`, `NextActionCard`, `BlockingReason`, `Timeline`;
- `DataTable`, `Pagination`, `FilterBar`, `EmptyState`, `Skeleton`, `ErrorState`;
- `AutosaveStatus`, `ConflictResolver`, `ConfirmSummary`.

Los selects simples, combobox, calendarios, diálogos, tabs y menús se basarán en una librería de primitivas accesibles; no se reimplementará foco, navegación de teclado o anuncios ARIA desde cero. La opción normativa inicial es `react-aria-components`, validada por un spike de SSR, bundle y comportamiento antes de su adopción. `lucide-react` será el único set de iconos funcionales si supera el mismo gate. Los controles existentes se migran de forma controlada; no se mezclan sistemas indefinidamente.

### 7.6 Estados obligatorios de cada superficie

Toda lectura o mutación documenta y prueba:

- carga inicial;
- carga incremental;
- vacío inicial;
- vacío por filtros;
- éxito;
- validación por campo;
- error recuperable;
- conflicto de concurrencia;
- sin conexión o timeout;
- sesión expirada;
- permiso insuficiente;
- recurso retirado/no encontrado;
- estado no disponible por dependencia externa.

Los errores conservan `requestId` visible para soporte cuando exista, explican qué se preservó y ofrecen una acción concreta. Los mensajes de éxito aparecen junto a la acción y también se anuncian mediante región viva.

## 8. Modelo canónico de dominio

### 8.1 Propiedad de cada verdad

| Pregunta | Fuente de verdad |
| --- | --- |
| ¿La solicitud está recibida/calificándose/esperando datos/cerrada? | `QuoteRequest` |
| ¿Qué versión edita staff? | `Quote.workingVersionId` |
| ¿Qué versión puede ver el cliente? | `Quote.publishedVersionId` + publicación |
| ¿Qué contiene y cuánto vale una versión? | snapshots de `QuoteVersion` y líneas |
| ¿Requiere/aprobó descuento o precio especial? | `QuoteApproval` ligada al digest exacto |
| ¿Existe PDF verificable? | `GeneratedDocument(READY)` y hash |
| ¿Fue publicada? | `QuotePublication` |
| ¿El correo está en cola, entregado o falló? | `NotificationDelivery` ligada a la publicación |
| ¿El cliente pidió cambios? | comando/evento de cambio + conversación |
| ¿Qué versión aceptó? | `QuoteAcceptance` sobre la versión publicada |
| ¿Existe proyecto? | `Project` ligado a la aceptación |
| ¿Qué debe mostrar la UI? | resolver puro de etapa/acciones desde las fuentes anteriores |

La etapa visible es una proyección; no se persiste como otra máquina mutable que pueda divergir.

### 8.2 Solicitud

La solicitud gobierna captación y calificación, no el ciclo completo de cotización. El contrato objetivo conserva estados equivalentes a:

```text
RECIBIDA → EN_REVISION ↔ INFORMACION_REQUERIDA
           ├─→ LISTA_PARA_COTIZAR ─→ CONVERTIDA_EN_PROYECTO
           └─→ RECHAZADA
```

Los estados actuales `COTIZACION_DISPONIBLE`, `EN_NEGOCIACION`, `PENDIENTE_DE_APROBACION`, `ACEPTADA` y `VENCIDA` dejan de ser una segunda copia del estado de la cotización. Se mantienen temporalmente sólo para lectura/backfill y se retiran mediante migración expand/backfill/contract.

`PENDIENTE_DE_APROBACION` no volverá a representar aprobación de descuento ni un puente instantáneo de aceptación.

### 8.3 Cotización y versiones

`Quote` tendrá punteros separados:

- `workingVersionId`: versión privada editable o en revisión;
- `publishedVersionId`: última versión deliberadamente publicada al cliente.

Una nueva revisión no reemplaza la propuesta publicada hasta que la nueva publicación finaliza. El ciclo objetivo de versión es:

```text
BORRADOR
→ EN_REVISION
→ LISTA_PARA_PUBLICAR
→ PUBLICADA
→ REEMPLAZADA | ACEPTADA | RECHAZADA | VENCIDA

EN_REVISION → BORRADOR          sólo para corregir; invalida aprobación/PDF
```

- sólo `BORRADOR` es editable;
- `EN_REVISION` está congelada por digest;
- cambiar contenido después de revisión requiere retorno explícito a borrador;
- publicar una nueva versión marca la anterior como reemplazada, sin borrarla;
- una versión vencida puede clonarse a una nueva versión; el expediente no queda atrapado;
- una versión publicada siempre se renderiza desde snapshots, nunca desde catálogo vigente.

### 8.4 Snapshot comercial mínimo

`QuoteVersion` y sus líneas conservan:

- lista de precios origen;
- moneda y precisión;
- posición y sección;
- código/nombre/descripción/unidad;
- cantidad;
- precio base;
- precio aplicado;
- motivo de override cuando exista;
- descuento y motivo;
- perfil fiscal, tasa y modalidad incluido/no incluido;
- subtotales y totales;
- vigencia comercial;
- secciones, alcance, exclusiones, condiciones de pago y garantías;
- versión/hash de términos;
- digest canónico de todo el contenido publicable.

`catalogItemId` puede ser nulo para un concepto especial. Crear una línea especial no crea automáticamente un concepto global.

### 8.5 Revisión optimista

Cada borrador tiene `revision` incremental. Toda escritura incluye la revisión esperada:

- coincidencia: actualiza y devuelve la nueva revisión;
- divergencia: responde `409 DRAFT_STALE` con una proyección segura de la versión vigente y no sobrescribe;
- la UI permite recargar, comparar o conservar una copia; nunca pierde silenciosamente cambios;
- dos preparaciones concurrentes no crean dos borradores activos.

### 8.6 Aprobaciones

`QuoteApproval` es una entidad separada con:

- tipo (`DISCOUNT`, `PRICE_OVERRIDE` o política futura);
- versión, revisión y digest;
- política/umbral aplicados;
- solicitante, aprobador y comentarios;
- estado `REQUESTED`, `APPROVED`, `REJECTED`, `CANCELLED`, `SUPERSEDED`;
- vencimiento opcional;
- unicidad de aprobación activa por versión/tipo;
- auditoría y notificación idempotente.

Cualquier cambio al digest invalida la aprobación. Por defecto, quien solicita no se autoaprueba. Un override administrativo de emergencia requiere permiso específico, MFA, motivo y auditoría visible.

### 8.7 Términos y aceptación

`CommercialTermsVersion` es inmutable después de activarse y conserva contenido, versión, hash, vigencia y estado. El servidor decide qué términos se publican.

La aceptación requiere:

- sesión cliente activa y permiso `quotes.accept`;
- relación autorizada con el cliente;
- versión igual a `publishedVersionId` y estado aceptable;
- vigencia inclusiva según zona de negocio;
- PDF `READY` cuyo hash coincide;
- términos exactos cuyo hash coincide;
- consentimiento y nombre del firmante;
- política definida de firmante autorizado;
- idempotencia con hash de payload;
- snapshot de total, moneda, PDF y términos en la evidencia.

El navegador no elige `termsVersion`. La revisión jurídica sigue siendo un gate real de lanzamiento.

### 8.8 Publicación y entrega

Publicar es una saga idempotente, no una falsa transacción que abarque PostgreSQL, storage y SMTP:

```text
Congelar revisión
→ resolver aprobaciones
→ generar y verificar PDF
→ crear preflight con digest, términos y destinatario exactos
→ confirmación humana
→ publicar versión y mover publishedVersionId
→ registrar Outbox
→ entregar notificación con reintentos
```

Estados comunicados por separado:

- documento: preparando / listo / falló;
- publicación: no publicada / publicada;
- entrega: en cola / enviada por proveedor / fallida / cancelada.

La UI nunca muestra “correo enviado” al recibir sólo un `202` o crear Outbox. Si el correo falla, la propuesta permanece publicada y la operación muestra cómo reintentar. Reintentar no duplica publicaciones ni entregas.

### 8.9 Proyecto

`CONVERTIDA_EN_PROYECTO` no aparece como acción hasta existir:

- `Project` con identificador comercial, cliente, origen, responsable y estado;
- vínculo único a la aceptación fuente;
- `ProjectScopeSnapshot` inmutable;
- checklist de handoff;
- ruta real y permisos;
- comando idempotente y auditoría.

Si el contrato de proyecto no se aprueba, la aceptación es el final comercial temporal y el botón permanece oculto.

## 9. Resolver de etapa y acción

El backend calcula una proyección compacta:

```ts
type CommercialPresentation = {
  stage: PublicStage;
  stageLabel: string;
  actorExpected: 'STAFF' | 'CUSTOMER' | 'MANAGER' | 'SYSTEM' | 'NONE';
  waitingSince: string | null;
  primaryAction: AvailableAction | null;
  secondaryActions: AvailableAction[];
  blockers: BlockingReason[];
  delivery: 'NONE' | 'QUEUED' | 'SENT' | 'FAILED' | 'CANCELLED';
};
```

Cada `AvailableAction` incluye `key`, `label`, `intent`, `confirmation`, `requiredFields` y endpoint/command permitido. Cada bloqueo usa un código cerrado, texto humano y recuperación.

Tabla mínima:

| Hecho canónico | Etapa staff | Actor esperado | Acción staff | Portal |
| --- | --- | --- | --- | --- |
| Solicitud nueva sin responsable | Nueva solicitud | Staff | Tomar y revisar | Recibida; sin acción |
| Solicitud asignada en revisión | En revisión | Staff | Completar revisión | En revisión |
| Falta información y mensaje no enviado | Información incompleta | Staff | Escribir y solicitar | Sin cambio aún |
| Mensaje enviado, sin respuesta cliente | Esperando al cliente | Cliente | Recordar / cancelar espera | Acción requerida y mensaje |
| Cliente respondió | Respuesta recibida | Staff | Revisar respuesta | Gracias; OCPOOL revisa |
| Lista para cotizar, sin línea válida | Preparar propuesta | Staff | Agregar primer concepto | Preparando propuesta |
| Borrador válido | Borrador guardado | Staff | Enviar a revisión | Preparando propuesta |
| Revisión congelada, requiere aprobación | Esperando aprobación | Manager | Ver solicitud de aprobación | Preparando propuesta |
| Aprobación rechazada | Requiere corrección | Staff | Volver a editar | Preparando propuesta |
| Revisión aprobada, PDF pendiente | Preparando documento | System | Reintentar si falla | Preparando propuesta |
| PDF listo, preflight válido | Lista para publicar | Staff | Revisar y publicar | Preparando propuesta |
| Publicada, entrega en cola | Propuesta publicada | System | Ver entrega | Propuesta disponible |
| Publicada, entrega fallida | Propuesta publicada; aviso falló | Staff | Reintentar aviso | Propuesta disponible si ya tiene acceso |
| Cliente solicitó cambios | Cambios solicitados | Staff | Crear revisión desde publicada | Solicitud de cambio registrada |
| Nueva revisión interna | Revisando cambios | Staff | Continuar revisión | Sigue visible la última publicada |
| Publicada y vigente | Esperando decisión | Cliente | Recordar / conversar | Descargar, pedir cambios o aceptar |
| Publicada vencida | Propuesta vencida | Staff | Crear nueva versión | Vencida; contactar a OCPOOL |
| Aceptada | Aceptada | Staff | Iniciar handoff si existe | Confirmación y evidencia visible |
| Cerrada sin venta | Cerrada | None | Reabrir sólo con permiso | Cierre humano, sin códigos |

Una combinación inválida produce alerta operativa y no inventa una acción.

## 10. Comandos de aplicación

Los Route Handlers adaptan HTTP; la lógica vive en comandos de aplicación. Contratos mínimos:

- `createStaffRequest`;
- `claimRequest`;
- `reassignRequest`;
- `updateRequestProfile`;
- `requestInformation` — mensaje + estado + acceso/notificación en una operación coordinada;
- `startQuotePreparation` — no crea una versión vacía;
- `saveQuoteDraft` — crea el primer borrador al existir una línea válida y luego usa revisión optimista;
- `submitQuoteForReview`;
- `returnQuoteToDraft`;
- `requestQuoteApproval`;
- `resolveQuoteApproval`;
- `prepareQuotePublication`;
- `publishQuote`;
- `requestQuoteChange`;
- `acceptPublishedQuote`;
- `expirePublishedQuotes`;
- `createProjectFromAcceptance`.

Todo comando declara actor, scope, permisos, precondiciones, idempotencia, locks, efectos, auditoría, eventos, error codes y compensación/reintento.

## 11. Contrato de UX por recorrido

### 11.1 Alta pública y onboarding

La landing no cambia. Después del envío:

- se confirma recepción y folio;
- se explica que el folio identifica, no autentica;
- se indica que OCPOOL revisará la solicitud;
- no se manda al cliente nuevo a solicitar acceso inmediatamente;
- BIZ-11 decide si el alta ocurre al pedir información, al preparar la primera publicación o en ambos hitos; en cualquier caso, el sistema crea/reutiliza acceso mediante `customer.portal.invite` antes de exigir una acción autenticada al cliente;
- un cliente nuevo recibe un único correo útil con enlace de acceso y contexto, no dos correos contradictorios;
- un cliente activo recibe deep link al expediente.

### 11.2 Solicitud creada por staff

Desde cualquier cola autorizada existe “Nueva solicitud”. El formulario pide sólo contacto, origen/canal, proyecto, ubicación y descripción mínima. Detecta coincidencias de correo/teléfono y permite reutilizar el cliente correcto. Nunca fusiona automáticamente clientes ambiguos.

### 11.3 Revisión de solicitud

El expediente presenta resumen, responsable, antigüedad y próxima acción. Cambiar a “falta información” exige redactar el mensaje en la misma interfaz. Editar datos sensibles o reasignar conserva antes/después y motivo cuando tenga valor operativo.

### 11.4 Constructor

- se abre dentro del expediente, sin selector duplicado;
- carga precio, moneda, impuesto y vigencia desde política comercial;
- buscador remoto encuentra el catálogo completo y soporta teclado;
- selección múltiple agrega cantidad 1 por defecto;
- líneas se reordenan y agrupan por secciones;
- dinero se escribe en moneda normal y se convierte en backend sin floats;
- impuesto se presenta por nombre/porcentaje, nunca “pb”;
- concepto especial es local a la versión y puede promoverse después;
- autosave debounced muestra Guardando/Guardado/Error/Conflicto;
- resumen de totales permanece visible;
- “Listo para revisión” reemplaza el guardado manual como acción principal;
- repricing es explícito y muestra diferencias; abrir una versión nunca la repricia.

### 11.5 Aprobación

El solicitante ve política, motivo, responsable y tiempo de espera. El aprobador recibe una vista comparativa con subtotal, descuento, override, margen disponible si existe dato autorizado, total y comentario. Aprobar/rechazar ocurre sin abandonar el contexto.

### 11.6 Publicación

La pantalla de revisión muestra versión, destinatario congelado, vigencia, total, términos, estado del PDF y preview. La acción dice “Publicar propuesta y avisar al cliente”. El resultado separa “Propuesta publicada” de “Aviso en cola/enviado/fallido”.

### 11.7 Portal

El inicio destaca primero lo que requiere acción. El expediente tiene permalink, timeline humano y sólo contenido compartido. La propuesta muestra versión, total, vigencia, secciones, PDF y acciones. Versiones reemplazadas se etiquetan como históricas y no son aceptables.

### 11.8 Cambios y nueva versión

“Solicitar cambios” pide un mensaje, crea evento de negocio y lo comparte. Staff crea una revisión copiando el snapshot publicado. Hasta publicar el reemplazo, el cliente conserva acceso a la propuesta anterior con una nota de que OCPOOL prepara cambios.

## 12. Catálogo, dinero, impuestos y fechas

### 12.1 Catálogo

- búsqueda server-side paginada por texto, código, categoría, lista y vigencia;
- ningún límite de 25/50 vuelve registros inalcanzables;
- códigos autogenerados por defecto y editables sólo con permiso;
- unidad mediante lista controlada con opción “otra” explícita;
- CRUD real de categorías y listas, archivo con confirmación y dependencias visibles;
- programación atómica de precio: cierra vigencia anterior y abre la nueva;
- detección de solapamiento y duplicados;
- importación masiva se planifica después del flujo individual estable.

### 12.2 Dinero

- `MoneyField` localizado muestra pesos/unidad comercial, nunca centavos;
- backend convierte a unidades mínimas y calcula con enteros;
- moneda proviene de allowlist configurada con precisión ISO 4217;
- la versión conserva moneda y precisión;
- precio base y override son campos distintos;
- todo override requiere permiso, motivo y quizá aprobación según política.

### 12.3 Impuestos

La UI usa perfiles fiscales (`IVA 16%`, `Exento`, etc.) administrados y versionados. Debe definirse si el precio incluye impuesto, tasa predeterminada y redondeo. Hasta decisión formal no se inventa una política fiscal.

### 12.4 Fechas

- zona de negocio única devuelta por servidor y formateador compartido;
- vigencia de propuesta es una fecha comercial inclusiva, no un instante ambiguo;
- timestamps operativos permanecen `TIMESTAMPTZ`;
- todos los payloads incluyen semántica y zona cuando aplique;
- antes de lanzamiento se confirma la zona real de OCPOOL.

## 13. Permisos objetivo

| Capacidad | Ventas | Gerencia | Admin | Cliente |
| --- | :---: | :---: | :---: | :---: |
| Ver solicitudes propias/sin asignar | Sí | Sí | Sí | No |
| Ver todas las solicitudes | Según permiso | Sí | Sí | No |
| Tomar una sin asignar | Sí | Sí | Sí | No |
| Reasignar trabajo ajeno | No | Sí | Sí | No |
| Crear solicitud manual | Sí | Sí | Sí | No |
| Editar perfil comercial autorizado | Sí | Sí | Sí | No |
| Invitar acceso del cliente | Sí, permiso estrecho | Sí | Sí | No |
| Crear/editar borrador | Sí en su scope | Sí | Sí | No |
| Agregar concepto especial | Sí | Sí | Sí | No |
| Proponer descuento/override | Sí | Sí | Sí | No |
| Aprobar solicitud propia | No | No por defecto | Override auditado | No |
| Aprobar solicitud ajena | No | Sí | Sí | No |
| Publicar versión aprobada | Sí en su scope | Sí | Sí | No |
| Administrar catálogo/precios/política | No | Sí | Sí | No |
| Ver portal propio | No | No | No | Sí |
| Pedir cambios/aceptar | No | No | No | Sí, scope propio |
| Operar notificaciones | No | Sí | Sí | No |
| Auditoría operativa/seguridad | No | Operativa | Completa | No |

Permisos nuevos o separados como mínimo:

- `requests.read.global`, `requests.claim`, `requests.reassign`, `requests.edit`;
- `customer.portal.invite`;
- `quotes.discount.request`, `quotes.price_override.request`;
- `quotes.approval.resolve`, `quotes.approval.override`;
- `quotes.publish`;
- `projects.create`, `projects.read`, `projects.manage`.

El backend filtra scope; ocultar un enlace no autoriza ni protege.

## 14. Contratos de datos y rendimiento

### 14.1 Proyecciones

- la ruta del expediente entrega cabecera, etapa, acciones, bloqueos y resumen compacto;
- conversación, archivos, actividad, historial y versiones se paginan bajo demanda;
- no se devuelve un agregado ilimitado;
- Server Components resuelven sesión y primera proyección; Client Components quedan como islas de interacción;
- no se agrega una caché cliente global hasta demostrar que el modelo nativo no basta.

### 14.2 Búsqueda y paginación

- cursor estable para listas con crecimiento;
- orden determinista con desempate por ID;
- búsqueda remota debounced, cancelable y con estado vacío;
- índices trigram/compuestos cuando `EXPLAIN` con volumen representativo lo justifique;
- todas las colecciones son alcanzables.

### 14.3 Presupuestos

- lectura compacta de workspace: p95 ≤ 800 ms en servidor con dataset objetivo;
- búsqueda de catálogo: p95 ≤ 300 ms;
- mutación interna: p95 ≤ 1 s, excluyendo storage/SMTP;
- LCP p75 < 2.5 s, INP p75 < 200 ms y CLS p75 < 0.1 en rutas críticas;
- rutas privadas no cargan fuentes editoriales innecesarias;
- regresión de bundle por slice dentro del presupuesto fijado en G0.

## 15. Idempotencia, integridad y seguridad

- toda idempotency key se liga a actor, comando, agregado y hash canónico de payload;
- reutilizarla con otro payload responde conflicto;
- FK/constraints prueban que contacto, solicitud, cotización, versión, documento y aceptación pertenecen al mismo cliente/agregado;
- `portal.self.read` se exige explícitamente en backend;
- acciones disponibles no contienen endpoints que el actor no puede ejecutar;
- CSRF/same-origin, rate limiting, cookies seguras y errores sanitizados se conservan;
- archivos y PDFs usan storage privado y URLs efímeras;
- no se registran tokens, recipients en claro, texto privado o secretos;
- auditoría registra cambios económicos, publicación, acceso, aceptación, override y proyecto;
- cualquier estado imposible genera alerta segura con correlation ID.

## 16. Automatizaciones y confirmaciones

| Acción | Automática | Confirmación |
| --- | --- | --- |
| Abrir expediente | Nunca cambia responsable/estado | No |
| Tomar solicitud | Sólo al pulsar acción y si está libre | Confirmación ligera embebida |
| Defaults de cotización | Sí, desde política | No; son editables |
| Autosave de borrador | Sí | No; estado visible |
| Invalidar aprobación/PDF al editar | Sí y auditado | Aviso antes de volver a borrador |
| Crear/invitar acceso en el hito aprobado por BIZ-11 | Sí, idempotente | Se explica antes de enviar la primera acción autenticada |
| Generar PDF | Sí tras completar revisión y cualquier aprobación aplicable | No; reintento visible si falla |
| Publicar y avisar | No | Sí, resumen exacto |
| Reintentar entrega | No automático después del máximo | Sí para operador |
| Vencer propuestas | Job según fecha de negocio | No; aviso previo configurable |
| Archivar catálogo/lista | No | Sí, dependencias y consecuencia |
| Aceptar propuesta | No | Sí, consentimiento explícito |
| Convertir a proyecto | No | Sí, resumen de handoff |

## 17. Accesibilidad y responsive

- cero violaciones Axe critical/serious;
- recorridos críticos completos por teclado;
- foco visible y restaurado en overlays;
- diálogos capturan foco y `Esc` funciona cuando sea seguro;
- tabs usan flechas/Home/End y su selección se refleja en URL;
- calendarios tienen etiquetas en español y semántica de fecha clara;
- mensajes dinámicos se anuncian sin robar foco;
- color nunca es la única señal;
- zoom 200% funcional;
- sin overflow horizontal en 360, 390, 768, 1024 y 1440 px;
- `prefers-reduced-motion` y contraste alto se respetan;
- áreas táctiles de 44 px;
- matrices explícitas para móvil, tablet y escritorio por componente.

## 18. Copy y lenguaje

Un catálogo central define:

- nombre humano de etapas staff y portal;
- acción, responsable y tiempo de espera;
- mensajes de vacío, error, conflicto y éxito;
- términos legales aprobados;
- estados de entrega diferenciados.

Ejemplos:

- “Propuesta publicada; aviso por correo en cola”, no “Enviada” si aún no existe entrega;
- “Esperamos información del cliente”, no `INFORMACION_REQUERIDA`;
- “El folio identifica tu solicitud; no es una contraseña”;
- “Tus cambios siguen guardados en este dispositivo mientras resolvemos el conflicto” sólo si esa garantía es real;
- no prometer minutos, soporte o validez legal sin política aprobada.

## 19. Métricas de producto

“Acción significativa” es una selección, navegación o confirmación deliberada; no cuenta cada carácter escrito.

Objetivos de piloto:

- siguiente tarea identificada: mediana ≤ 10 s, p90 ≤ 20 s;
- solicitud lista → borrador con tres conceptos: ≤ 5 acciones significativas;
- diez conceptos existentes agregados: ≤ 45 s;
- concepto especial creado, preciado y agregado: ≤ 90 s;
- cero navegación obligatoria al catálogo en una cotización común;
- éxito en primer intento del recorrido crítico staff ≥ 90%;
- acceso → propuesta → decisión del cliente: ≥ 95% sin asistencia;
- ruta profunda, recarga y volver conservan contexto;
- cero borradores, publicaciones, correos o aceptaciones duplicadas;
- cero versiones internas o datos cruzados expuestos;
- total idéntico en staff, portal y PDF;
- SUS ≥ 85 y SEQ promedio ≥ 6/7 con muestra representativa;
- cero pruebas requeridas omitidas en CI premium.

## 20. Decisiones que G0 debe formalizar

La especificación fija la arquitectura, pero estas políticas requieren una respuesta del responsable de negocio/legal antes de implementar su slice:

1. zona horaria oficial;
2. monedas permitidas y precisión;
3. perfiles fiscales, IVA incluido/no incluido y redondeo;
4. vigencia predeterminada;
5. umbral de descuento/override y política de autoaprobación;
6. alcance de ventas: propio, equipo o global;
7. quién puede aceptar por parte del cliente;
8. texto y alcance legal de términos/privacidad;
9. cuándo se habilita acceso del cliente;
10. definición mínima y responsable del proyecto;
11. SLA operativos usados para atención/prioridad;
12. una persona cliente por organización o futura membresía múltiple.

El plan conserva recomendaciones seguras y feature flags; no inventa silenciosamente estas respuestas.

## 21. Criterios de aceptación global

La experiencia V2 sólo puede declararse terminada cuando:

1. 100% de acciones visibles son legales y ejecutables;
2. ninguna revisión interna se muestra al cliente;
3. publicar requiere PDF `READY`, términos exactos y aprobación aplicable;
4. abrir una versión inmutable reproduce exactamente su snapshot;
5. nueva revisión no retira la propuesta publicada anterior;
6. filtros, pestañas, selección y retorno son deterministas;
7. no existen límites silenciosos que oculten registros;
8. money, tax, dates y timezone tienen una semántica única;
9. el shell ofrece logo, navegación, usuario, logout y regreso correctos;
10. UI, API, PDF, notificación y auditoría cuentan la misma historia;
11. seguridad, concurrencia, accesibilidad, responsive, rendimiento y observabilidad cumplen sus gates;
12. el piloto demuestra comprensión y éxito, no sólo ausencia de errores técnicos;
13. la landing no presenta ninguna regresión;
14. el legado se retira sólo después de dos ventanas estables y rollback ensayado.
