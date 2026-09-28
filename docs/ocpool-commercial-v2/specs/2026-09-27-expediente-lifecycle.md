# Ciclo de vida del expediente: de la solicitud al proyecto, con cierre, seguimiento y rastro

Fecha: 2026-09-27 · Rama: `catalog-ux-redesign`

## Qué se pidió

El responsable de producto pidió revisar el negocio completo: cómo inicia un expediente, cómo lo
sigue el empleado, qué etapas hay hasta la aceptación y **qué pasa después** ("actualmente se acepta
y ahí queda, ¿cuándo se convierte en proyecto?"). También pidió revisar las tres pestañas
(Solicitudes, Cotizaciones, Proyectos), qué pasa si un expediente se queda detenido, si existe la
cancelación, y cómo consultar lo archivado o borrado. La meta: que nadie se abrume y que cada persona
sepa cuál es el siguiente paso y cómo darlo.

## El ciclo, de punta a punta

Un **expediente** es una sola historia que vive en tres pestañas. La franja de recorrido
(Solicitud → Cotización → Proyecto) aparece ahora en las tres y lleva de una a otra.

| Etapa | Estados | Quién actúa | Dónde | Siguiente paso visible |
| --- | --- | --- | --- | --- |
| Entrada | `RECIBIDA` | Ventas (tomar/asignar) | Solicitudes | "Tomar solicitud" |
| Revisión | `EN_REVISION`, `INFORMACION_REQUERIDA` | Ventas / cliente | Solicitudes | Pedir datos (borrador automático) o pasar a elaboración |
| Elaboración | `EN_ELABORACION` | Ventas (y gerencia si hay descuento) | Cotizaciones | Borrador → revisión → aprobación → enviar |
| Propuesta enviada | `COTIZACION_DISPONIBLE`, `EN_NEGOCIACION` | Cliente | Portal | Aceptar o pedir cambios |
| Aceptación | `ACEPTADA` → `CONVERTIDA_EN_PROYECTO` | Automático | Proyectos | Checklist de arranque y responsable |
| Arranque | Proyecto `EN_TRANSICION` → `COMPLETADO` | Responsable del proyecto | Proyectos | Tareas sugeridas, "Marcar handoff completado" |
| Cierre | `RECHAZADA` ("Cerrada") | Ventas / gerencia | Solicitudes | Motivo obligatorio; "Reabrir expediente" |

## Hallazgos y correcciones

### 1. "Se acepta y ahí queda" (error de negocio, crítico)
- **Causa raíz:** convertir en proyecto era un paso manual escondido y, aun convertido, el expediente
  nunca pasaba a `CONVERTIDA_EN_PROYECTO`: las aceptadas desaparecían de todas las bandejas.
- **Corrección:** al aceptar en el portal se crea el proyecto en el mismo momento, a cargo de quien
  llevaba el expediente, y el expediente pasa a `CONVERTIDA_EN_PROYECTO` (historial, auditoría y
  evento). Idempotente con la conversión manual. Migración `20260927010000_backfill_converted_requests`
  corrige los expedientes con proyecto que habían quedado en `ACEPTADA`.
- **Red de seguridad:** aceptadas sin proyecto (anteriores o si la creación falló) aparecen en el
  dashboard ("Aceptadas sin proyecto") y en Solicitudes/Cotizaciones con "Convertir en proyecto".
- El cliente ve "Tu proyecto está en marcha" al aceptar; el correo al equipo lo explica.

### 2. No existía la cancelación después de enviar
- **Antes:** sólo se podía "rechazar" antes de cotizar; una propuesta enviada que el cliente nunca
  contestó se quedaba "disponible" para siempre.
- **Ahora:** "Cerrar expediente" en cualquier etapa abierta, con motivo (el cliente desistió, eligió
  otra opción, sin respuesta, fuera de alcance, duplicada, otro) y nota. Si había una propuesta
  enviada, se retira del portal (el cliente ya no puede aceptarla). "Cerrada" reemplaza "Rechazada".
- **Reabrir:** con cotización vuelve a **elaboración** (antes regresaba a revisión y el constructor
  ofrecía "Crear nueva versión" que el servidor rechazaba: callejón sin salida corregido); sin
  cotización vuelve a revisión. El constructor, además, sólo ofrece versiones nuevas cuando el
  expediente lo permite y, si está cerrado o en revisión, lleva a Solicitudes.

### 3. ¿Qué pasa si se queda en un proceso?
- **Cola "Sin respuesta del cliente"** en el dashboard: datos pedidos o propuesta enviada, 4+ días
  sin movimiento y con el equipo como último en hablar (si el cliente respondió, va a "Cliente
  respondió"). Respeta el alcance de cada vendedor.
- **"Dar seguimiento"** con un mensaje ya redactado (datos pendientes o propuesta) que llega por
  correo y queda en la conversación.
- **El siguiente paso lee la conversación:** "El cliente te escribió" (la pelota es del equipo), "Le
  diste seguimiento hace…", o "Sin respuesta desde hace N días" con la opción de cerrar con motivo.

### 4. Propuestas vencidas (dos errores reales)
- Solicitudes, el constructor y la franja de recorrido dicen "La propuesta venció" / "Vencida".
- **Error 1:** "Crear nueva versión" desde una propuesta vencida copiaba la vigencia vieja y el
  servidor la rechazaba ("La vigencia no es válida"). Ahora se propone el mismo plazo desde hoy.
- **Error 2:** Ventas nunca podía crear la V2 (tras cambios pedidos, vencimiento o rechazo): el
  constructor reenvía los precios congelados de la versión anterior y el servidor los trataba como
  cambio de precio (`quotes.edit_prices`). Conservar el precio ya no exige el permiso; cambiarlo, sí.
- **Error 3:** el constructor mostraba la vigencia con la fecha UTC (un día después de la real).

### 5. Otros errores encontrados en el recorrido
- **Detalle que no se refrescaba** al cerrar/reabrir un expediente abierto por enlace con un filtro
  activo: el `setState` de la selección vaciaba una referencia dentro del updater (React lo ejecuta
  dos veces en desarrollo). Corregido en Solicitudes y Cotizaciones.
- **Portal:** ofrecía "Revisar y aceptar" en expedientes cerrados (terminaba en error 409); ahora no.
  "Solicitar cambios" se oculta en versiones retiradas; el cliente ve "Este expediente se cerró" y
  cómo retomarlo. Mientras carga, el portal muestra el esqueleto en vez de "Elige un expediente".
- **Portal en idioma del cliente:** "Propuesta lista", "Datos pendientes", "Preparando propuesta",
  "Proyecto en marcha" (diccionario canónico `QUOTE_REQUEST_STATUS_CUSTOMER_LABELS`).
- **"Siguiente estado" vacío** ("Sin transiciones disponibles" + botón deshabilitado) se reemplazó
  por una explicación de cómo avanza el expediente en esa etapa.
- **"Nueva solicitud"** existe también en la vista clásica (antes sólo con la bandeja V2), protegida
  por `requests.create`.
- **Descuentos:** Ventas puede proponerlos (`quotes.apply_discount`); los que superan la política
  siguen requiriendo aprobación de gerencia antes de enviarse.

## Lo archivado y lo borrado: dónde se consulta

| Qué | Cómo queda | Dónde verlo |
| --- | --- | --- |
| Expedientes cerrados | Estado "Cerrada" con motivo en el historial | Solicitudes → filtro "Cerrada"; Cotizaciones → "Cerradas"; "Reabrir expediente" |
| Propuestas retiradas o vencidas | Versión "Rechazada"/"Vencida" | Historial de versiones (constructor y portal) |
| Proyectos terminados | `COMPLETADO` | Proyectos → "Completados" |
| Conceptos, listas y categorías | `ARCHIVED` (borrado lógico) | Catálogo → "Mostrar archivados/archivadas"; se reactivan |
| Archivos | Borrado lógico en la base y físico en el almacenamiento | **Nuevo:** "Archivos eliminados" en cada expediente (quién lo subió, quién lo eliminó y cuándo; sin descarga) |
| Conversaciones | Abierta/Cerrada | Correspondencia del expediente |
| Todo lo anterior | Evento con autor y fecha | Auditoría (gerencia/admin) |
| Usuarios, clientes y contactos | Estados `DISABLED`/`ARCHIVED` existen en el modelo | Sin interfaz todavía (ver trabajo futuro) |

## Decisiones

- La aceptación del cliente **es** la decisión de venta: el proyecto nace solo; la conversión manual
  queda como respaldo idempotente.
- Cerrar requiere motivo y retira la propuesta; nada se borra y todo se puede reabrir.
- El proyecto nace sin checklist impuesto; el espacio del proyecto guía con "Arma el checklist" y las
  tareas sugeridas en un clic (el checklist no admite borrar tareas, por eso no se imponen).
- Un archivo eliminado no se puede recuperar (el objeto se retira del almacenamiento); se conserva
  el rastro.

## Verificación

- Escenario QA aislado (`@qa-life.test`, retirado al terminar): aceptación real en el portal →
  proyecto automático; aceptada sin proyecto → conversión en un clic; propuesta sin respuesta →
  dashboard, "Dar seguimiento", cierre con motivo, reapertura; propuesta vencida → V2 creada por
  Ventas; cierre desde "Recibida"; "Cerradas" en Cotizaciones; portal de cliente aceptado y vencido;
  "Nueva solicitud" y "Archivos eliminados".
- Pruebas nuevas: integración de cierre/reapertura/seguimiento (incluye V2 tras reabrir y el permiso
  de precios), creación automática del proyecto, archivos eliminados; unitarias de dominio, etapas
  del portal y del constructor, vigencia y zona horaria.

## Trabajo futuro

- Administración de usuarios del equipo (alta, baja, roles) y archivo de clientes/contactos desde la
  interfaz: el modelo ya tiene los estados.
- Recordatorio automático al responsable cuando un expediente entra a "Sin respuesta del cliente".
- Paridad de cerrar/reabrir en la bandeja V2 (detrás de bandera, apagada por defecto).
