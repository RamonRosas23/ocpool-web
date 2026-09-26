# Aprobaciones, catálogo y proyectos: flujos más cortos y guiados

**Fecha:** 2026-09-26
**Rama:** `catalog-ux-redesign`
**Contexto:** tras los flujos guiados de Solicitudes, constructor y portal ([spec](2026-09-26-private-flows-guidance.md)), el responsable de producto pidió seguir con "los demás flujos (aprobaciones, catálogo, proyectos)". Mismo criterio: la landing no se toca, ninguna regla de negocio cambia y el servidor sigue siendo quien autoriza cada acción.

## Diagnóstico

1. **Aprobaciones obligaba a salir de la cola para decidir.** Cada fila sólo tenía "Abrir expediente": el gerente iba al constructor, buscaba la barra de acciones, decidía y volvía a la cola para el siguiente. Para un concepto especial ni siquiera veía cuál era el concepto antes de abrirlo.
2. **Proyectos no tenía índice.** Un proyecto sólo era alcanzable desde el documento comercial de su cotización — que además deja de aparecer en Cotizaciones una vez aceptada. No existía forma de ver "qué proyectos están en transición, quién los coordina y cuánto falta".
3. **El workspace de proyecto no decía qué seguía**, permitía cerrar el handoff con tareas pendientes sin advertirlo, cada casilla del checklist esperaba el viaje completo al servidor, y un perfil sin permiso de gestión veía controles que fallaban (y un error al cargar responsables).
4. **Catálogo:** el detalle de un concepto no mostraba su precio (la pregunta más común: "¿cuánto cuesta esto?") y asignarlo obligaba a cambiar de pestaña, buscar la lista y reencontrar el concepto. El selector de concepto de "Programar precio" **sólo ofrecía los primeros 50 conceptos activos**: en un catálogo más grande había conceptos imposibles de programar desde ahí, y al editar el precio de uno fuera de esos 50 su nombre aparecía en blanco. La búsqueda de conceptos tenía botón "Buscar".
5. **Escape cerraba el diálogo completo** cuando sólo se quería cerrar un combobox o un calendario dentro de él, tirando lo que se llevaba capturado (visible en "Programar precio", "Nuevo concepto", etc.).
6. **El header se encimaba** con 8 secciones a 1440 px (perfil de gerencia + la nueva sección Proyectos): los puntos de corte fijos no consideraban cuántas secciones ve cada rol.

## Cambios

### Aprobaciones — decidir en la cola
- Cada solicitud es una tarjeta con tipo, antigüedad (marcada si lleva 2 días o más esperando), versión, total, descuento, quién la pidió y su motivo.
- **"Ver conceptos de la versión"** despliega las líneas (con el mismo endpoint del constructor) y resalta las que motivan la aprobación: las que llevan descuento o las especiales, con su motivo.
- **Aprobar** a un clic y **Rechazar…** con motivo obligatorio (el mismo endpoint `decision` y las mismas reglas del servidor: p. ej. quien pidió la aprobación no puede resolverla sin el permiso de excepción; el error del servidor se muestra con el folio). La tarjeta sale de la cola al momento, se avisa con un toast y, si la página queda vacía, se carga la siguiente. "Abrir en el constructor" sigue disponible para el contexto completo.

### Proyectos — índice nuevo y handoff guiado
- **`/staff/projects`** (sección "Proyectos" en la navegación, con permiso `projects.read`): lista con estado, cliente, expediente, responsable (o "Sin responsable"), avance del checklist, total aceptado y antigüedad; vistas "En transición / Completados / Todos" (recordadas) y búsqueda instantánea por folio del proyecto, del expediente o cliente.
- **Servidor:** `listProjects` (sólo lectura) + `GET /api/staff/projects`, con **exactamente el mismo alcance** que el detalle (`staffRequestReadScopeWhere` sobre el expediente de origen): quien no puede abrir un proyecto tampoco lo ve listado. Cubierto en `projects-service.test.ts` (responsable lo ve, ajeno no, sin permiso se bloquea, filtros de estado y búsqueda).
- **Workspace:** enlace "Todos los proyectos", **"Siguiente paso"** (`project-stage.ts`, con pruebas: asignar responsable → armar checklist → completar pendientes → cerrar), confirmación al cerrar con tareas abiertas ("Quedan 2 tareas… cerrar de todos modos"), casillas del checklist optimistas, toasts al asignar responsable/agregar tareas/cerrar o reabrir, y controles de gestión ocultos para perfiles de sólo lectura. **No se agregó ninguna plantilla de tareas**: el contenido del checklist sigue siendo decisión operativa del equipo (J1-01/U1-05).

### Catálogo
- **Precio vigente por lista** en el detalle del concepto (usando la búsqueda por lista que ya usa el constructor), con "Sin precio" señalado y la consecuencia explicada; **"Asignar precio" / "Actualizar"** abre ahí mismo el diálogo de precio (el mismo del alta guiada) con la lista y la fecha de hoy precargadas.
- **"Programar precio" busca en todo el catálogo** (búsqueda remota nueva y opcional en `PrivateCombobox`); sin término muestra primero los conceptos que ya tienen precio en esa lista, y el concepto elegido nunca queda sin etiqueta.
- Búsqueda de conceptos instantánea con botón de limpiar; el vacío por filtros ofrece "Quitar filtros".

### Transversal
- **Escape por capas:** `PrivateDialog` ignora un Escape que un control anidado ya consumió, y el calendario escucha en fase de captura; el primer Escape cierra el desplegable y el segundo, el diálogo.
- **Header adaptable a lo que cabe:** `StaffHeader` mide su navegación y compacta por niveles (sin íconos → sin subtítulos ni etiquetas auxiliares → menú), re-midiendo al cambiar el ancho o al cargar la tipografía.
- Los buscadores fijan su nombre accesible (`aria-label`) para que el botón de limpiar dentro de la etiqueta no lo altere.
- **Constructor — carrera de autoguardado (hallada por la suite E2E):** si se agregaba y quitaba un concepto mientras el último guardado estaba en vuelo, el borrador volvía a "Guardado" con líneas sin precio congelado: mostraba el precio vivo del catálogo en lugar del guardado (contra Q1-05) y "Verificar precios vigentes" dejaba de detectar cambios. Ahora, aunque el borrador haya cambiado durante el viaje, las líneas que el servidor ya guardó reciben su precio congelado sin tocar lo que el usuario esté editando.

## Fuera de alcance
- Landing pública y superficies V2 detrás de banderas (sólo heredan la entrada "Proyectos" en su navegación, filtrada por el mismo permiso).
- Reglas de aprobación, de precios y de handoff: sin cambios. La única función de servidor nueva es de lectura (`listProjects`).

## Verificación
- `tsc`, lint completo, pruebas unitarias (nueva `project-stage`) y `projects-service.test.ts` contra base real.
- Navegador real: header sin encimarse a 1680/1440/1280/1100/1024 px con perfil de gerencia; índice de proyectos (real vacío y con datos simulados por intercepción de red, sin tocar la base) a 1440 y 390 px; workspace con confirmación y "Ver pendientes"; cola de aprobaciones con conceptos, rechazo sin motivo bloqueado y aprobación que retira la tarjeta; precios por lista y búsqueda remota del concepto con datos reales; Escape por capas en combobox, calendario y select.
- Suite E2E opt-in completa contra build de producción: 59/61 en la primera corrida — la falla preexistente de `quality.spec.ts` (assets de la landing) y `quotes.spec.ts`, que destapó la carrera de autoguardado descrita arriba; tras corregirla, `quotes.spec.ts` pasa 2/2 (`--repeat-each=2`). `request-workspace-v2.spec.ts` con banderas 5/5 y el harness del shell privado 2/2.
