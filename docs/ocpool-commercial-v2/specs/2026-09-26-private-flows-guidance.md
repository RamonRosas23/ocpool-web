# Flujos guiados: "qué sigue" en cada pantalla privada (staff, constructor, portal y acceso)

**Fecha:** 2026-09-26
**Rama:** `catalog-ux-redesign`
**Contexto:** con el sistema visual premium ya aprobado ("me encantó el estilo visual"), el responsable de producto pidió analizar cómo trabajan realmente los usuarios cada flujo y hacerlos "más dinámicos, más entendibles, más rápidos, mejor UI/UX", con autonomía total. Igual que en el rediseño anterior, la landing pública (congelada por G0-05) no se tocó y ninguna regla de negocio ni contrato de API cambió: todo lo nuevo es presentación sobre datos y permisos que el servidor ya calcula.

## Diagnóstico (recorrido real de cada rol)

1. **Nadie decía qué hacer después.** En Solicitudes, el siguiente estado venía *preseleccionado* con la primera transición disponible — a menudo "Información requerida", que exige un mensaje al cliente — como si fuera la recomendación. En el constructor, la acción correcta había que deducirla de qué botones aparecían en la barra inferior (hasta 9 combinaciones según versión, aprobaciones y permisos). En el portal, el cliente veía un estado ("Cotización disponible") sin saber si le tocaba actuar a él o esperar.
2. **Encontrar un expediente costaba varios pasos:** ir a Solicitudes, escribir en el buscador, pulsar "Aplicar filtros", esperar, elegir. No había forma de saltar a un folio desde otra sección.
3. **Filtros con botón "Aplicar"** en Solicitudes y Cotizaciones: cambiar el estado no hacía nada hasta pulsarlo, y era fácil olvidarlo. No había vistas "Mías"/"Sin asignar" pese a que el API ya las soporta para el dashboard.
4. **Tomar una solicitud** reutilizaba el endpoint de asignación con "el primer responsable de la lista" (`assign(assignees[0]?.id)`), y la tarjeta de Responsable decía "tomada por ti o por el responsable asignado" sin decir quién.
5. **El expediente abierto no vivía en la URL:** recargar perdía la selección y no se podía compartir el enlace.
6. **Confirmaciones fuera de vista:** el aviso "Estado actualizado." aparecía arriba del workspace aunque el usuario estuviera trabajando al fondo del detalle.
7. **Seguridad (preexistente):** un clic en "Entrar" antes de que React hidratara enviaba el formulario nativo por GET y dejaba correo y contraseña en la URL (`/login?email=…&password=…`) — historial del navegador y logs del servidor.

## Cambios

### Staff — global
- **Buscador global (`Ctrl/⌘ + K` o `/`)** en el header (`StaffQuickFind`): busca expedientes por folio, cliente o correo (mismo endpoint de la bandeja, 8 resultados, debounce 220 ms), recuerda los 5 últimos abiertos y filtra secciones. Patrón ARIA combobox/listbox; los resultados son enlaces reales, así que respetan la guarda de cambios sin guardar del constructor igual que la navegación del header.

### Solicitudes
- **Vistas "Todas / Mías / Sin asignar"** (se recuerdan por usuario) usando el modo de bandeja de trabajo que el endpoint ya tenía (`view=mine|unassigned`); los enlaces "Ver las N solicitudes" de las colas del dashboard abren la bandeja directo en la vista correspondiente (`?view=`, que se consume y se quita de la URL).
- **Filtros instantáneos:** la búsqueda se aplica sola al dejar de escribir (350 ms; Enter la aplica al momento), el estado al elegirlo; botón de limpiar búsqueda y "Limpiar filtros" cuando hay alguno activo. Estados vacíos que orientan ("Aún no tienes expedientes a tu cargo" → "Ver sin asignar").
- **Filas con fecha relativa** ("Hace 2 h", con la fecha exacta en `title`) y marca "Sin asignar".
- **Tarjeta "Siguiente paso"** con la acción recomendada a un clic, decidida por `getRequestWorkspacePrimaryAction` (el resolvedor ya probado de la bandeja V2): tomar, pedir información (prepara el formulario y lleva el foco al mensaje, nunca envía a ciegas; lista los datos faltantes), avanzar de estado, o abrir el constructor. El selector de "Siguiente estado" ya no viene preseleccionado.
- **Tomar** usa el endpoint real `/take`; la tarjeta de Responsable muestra avatar y nombre, con "(tú)" cuando corresponde.
- **El expediente abierto vive en `?request=`**, y tras una acción (tomar, cambiar estado) se conserva aunque salga de la vista actual — antes, tomar uno desde "Sin asignar" saltaba al siguiente expediente.
- **Avisos:** las confirmaciones flotan como toast abajo a la derecha y se retiran solas (8 s); los errores quedan fijos bajo el header mientras se trabaja en el detalle.

### Constructor de cotizaciones
- **Etapas de la versión** (Borrador → Revisión → Enviada → Aceptada) con notas de aprobación ("Requiere aprobación", "En aprobación", "Aprobada") y de cierre ("En negociación", "Rechazada", "Vencida"), más **"Siguiente paso"** en lenguaje de negocio (`src/lib/quote-stage.ts`, con pruebas) y un botón que lleva directo al control que lo resuelve (lista de precios, buscador de conceptos, barra de acciones o documento comercial, con un resaltado breve). Los nombres de esos botones no repiten los de la barra de acciones para no crear ambigüedad.
- **"Ver expediente"** (respeta la guarda de cambios sin guardar), búsqueda instantánea en el riel, expediente en la URL, y el expediente abierto ya no se cierra cuando una búsqueda del riel no lo incluye (antes podía cambiar de borrador sin avisar).
- **Estados vacíos reales:** "No pudimos cargar el constructor" con Reintentar, y "Nada por cotizar todavía" con enlace a la bandeja, en vez de "Selecciona un expediente" en ambos casos.

### Portal de cliente
- **Seguimiento en 5 etapas** (Solicitud recibida → En revisión → Propuesta → Aceptada → Proyecto) y **"Tu siguiente paso" / "Lo que sigue"** (`src/lib/portal-stage.ts`, con pruebas) que deja claro de quién es el turno; cuando le toca al cliente, un botón lo lleva a la propuesta o enfoca la conversación. En móvil estrecho sólo se nombra la etapa actual (las demás siguen disponibles para lectores de pantalla).

### Acceso
- Formularios de login y solicitud de acceso con `method="post"` y botón deshabilitado hasta hidratar (`useHydrated`, sin efectos): ningún envío temprano puede volver a poner credenciales en la URL.

## Fuera de alcance
- Landing pública (congelada) y superficies V2 detrás de banderas.
- Reglas de negocio, permisos y contratos de API: sin cambios. No se agregó nada al servidor; todo consume endpoints existentes.

## Verificación
- `tsc`, lint completo y pruebas unitarias (nuevas: `relative-time`, `quote-stage`, `portal-stage`).
- Recorrido en navegador real (1440 y 390 px) con sesiones de prueba locales de ventas y de cliente: vistas, búsqueda instantánea, `Ctrl+K` → abrir expediente sin recargar, tomar desde "Sin asignar" (se conserva el expediente, el siguiente paso avanza a "Marcar en revisión", toast), constructor (etapas, "Agregar conceptos" enfoca el buscador) y portal (etapas + "Lo que sigue"), sin desbordamiento horizontal.
- Suite E2E opt-in completa contra build de producción: 60/61 (la única falla es la preexistente de `quality.spec.ts` por assets de la landing borrados antes de este trabajo); `requests.spec.ts` + `dashboard.spec.ts` tras el último ajuste (3/3), `request-workspace-v2.spec.ts` con banderas (5/5) y el harness del shell privado en modo dev (2/2).
