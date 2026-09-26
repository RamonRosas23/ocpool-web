# Dashboard, notificaciones y auditoría: de lectura a acción

**Fecha:** 2026-09-26
**Rama:** `catalog-ux-redesign`
**Contexto:** tercera tanda de flujos ("sigue con notificaciones, auditoría y dashboard"). Son las pantallas de monitoreo: el objetivo fue que cada número o señal lleve directo a la acción que corresponde, sin cambiar reglas de negocio ni contratos de API.

## Diagnóstico

1. **Dashboard:** los indicadores y el pipeline eran sólo lectura — "109 sin asignar" o "En revisión 12" no llevaban a ningún lado; la señal "solicitudes sin asignar" abría la bandeja sin filtrar; no había un resumen personal de "qué tengo hoy"; la cola de aprobaciones sólo enlazaba a la página de Aprobaciones cuando había más de 5; los proyectos recién creados no aparecían en "Qué atender ahora".
2. **Notificaciones:** los indicadores de salud (Pendientes/En proceso/Fallidas/Enviadas) no filtraban; la antigüedad de la entrega más vieja se calculaba en el servidor pero nunca se mostraba; no había forma de refrescar la cola sin cambiar el filtro; tras una caída del proveedor había que reintentar las fallidas una por una; la confirmación aparecía arriba aunque se hubiera reintentado al fondo de la lista.
3. **Auditoría:** la lista era una columna continua sin separación por día (difícil leer "qué pasó hoy/ayer"); para ver "la última semana" había que escribir dos fechas; nada indicaba que había filtros elegidos sin aplicar (el modelo de "Aplicar filtros" confundía); no había forma rápida de quitar los filtros de categoría/resultado.
4. **Error transversal (preexistente) en `PrivateSelect`:** cuando el valor de un select cambiaba por código (no por el usuario), el `<select>` nativo oculto de Radix emitía un `onValueChange('')` espurio que se propagaba como "limpiar": cualquier filtro aplicado desde otro control o desde la URL se borraba en silencio. El código ya esquivaba este eco en un caso puntual (la siembra del filtro guardado en Solicitudes); ahora se corrige en el componente.

## Cambios

### Dashboard
- **Saludo con resumen personal** ("Buenos días, Laura. Tienes 3 expedientes a tu cargo, 1 aprobación espera tu decisión y 4 solicitudes siguen sin responsable."), armado sólo con las colas ya cargadas y sólo tras hidratar (la hora local nunca entra al HTML del servidor).
- **Pipeline accionable:** cada barra abre la bandeja filtrada por ese estado (`/staff/requests?status=…`; la bandeja consume el parámetro y lo quita de la URL, igual que `?view=`).
- **KPI "Sin asignar"** con "Asignar responsables →" y la señal de operación correspondiente, ambos a `/staff/requests?view=unassigned`.
- **Tarjeta "Proyectos en arranque"** en "Qué atender ahora" (sólo para perfiles con lectura de proyectos, así nunca dispara una petición que el servidor rechazaría): folio, cliente, responsable o "Sin responsable" y avance del checklist.
- La tarjeta de Aprobaciones siempre ofrece "Decidir en la cola →"; las antigüedades usan la misma etiqueta relativa que el resto del producto ("Hace 3 h").

### Notificaciones
- **Los indicadores de salud son el filtro:** un clic muestra sólo esas entregas y otro lo quita (`aria-pressed`); bajo el número, "La más antigua: hace X" para pendientes, en proceso y fallidas.
- Barra con **"Actualizar"** y "Actualizado hace …"; **"Reintentar las N reintentables"** cuando hay dos o más en la página (mismo endpoint idempotente, una por una, con resumen del resultado).
- La confirmación flota y se retira sola; estados vacíos por filtro ("No hay entregas fallidas…") con "Ver todas las entregas"; "Actualizada" en formato relativo con la fecha exacta en `title`.

### Auditoría
- **Agrupada por día** (Hoy, Ayer, "Lunes 21 de septiembre") con encabezado fijo al desplazarse; cada evento muestra sólo la hora (fecha completa en `title`). El último día indica "N+" cuando quedan eventos por cargar.
- **Rango rápido:** Hoy / 7 días / 30 días, aplicados al momento con la categoría y el resultado elegidos.
- **"Cambios sin aplicar"** junto a "Aplicar filtros" cuando lo elegido difiere de lo aplicado, y **"Filtrando por … · Quitar filtros"** cuando hay categoría o resultado activos.

### Transversal
- `PrivateSelect` ignora el `''` crudo de Radix (ningún ítem puede valer `''`; "limpiar" llega por su ítem vacío interno), lo que corrige el borrado silencioso de filtros aplicados por código.

## Verificación
- `tsc`, lint completo y pruebas unitarias.
- Navegador real con perfil de gerencia: saludo y resumen; barra del pipeline → bandeja filtrada "En revisión" (1 de 1) y el filtro persiste; elegir y limpiar desde el propio select siguen funcionando; indicadores de Notificaciones filtran y se quitan, vacío por filtro; Auditoría con rango rápido, aviso de cambios sin aplicar, filtro activo y agrupado por día; sin desbordamiento horizontal a 360 px en las tres pantallas.
- Suite E2E opt-in completa contra build de producción: 60/61 (la única falla sigue siendo la preexistente de `quality.spec.ts` por los assets de la landing borrados antes de este trabajo); `request-workspace-v2.spec.ts` con banderas 5/5 y el harness del shell privado 2/2. Las pruebas existentes de auditoría, notificaciones y dashboard pasan sin cambios: "Aplicar filtros", el filtro por estado y la confirmación de reintento conservan su contrato.
