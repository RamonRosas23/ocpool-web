# Protocolo del piloto controlado T1

Este runbook convierte T1 (`docs/historicos/plans/2026-09-10-ocpool-commercial-ux-rearchitecture.md`, §24) en un procedimiento que una persona moderadora puede ejecutar hoy, sin volver a interpretar el plan. No sustituye el juicio de quien modera: da el guion, el instrumento de captura y el criterio de cierre exactos.

**Entrada:** H1 (01-07) está cerrado — ver `PROJECT_STATUS.md`. Este es el único gate técnico; el resto de T1 es coordinación humana que este repositorio no puede ejecutar por sí solo.

## Qué NO es este piloto

- No es una prueba de aceptación del equipo de desarrollo. Nadie que haya construido el producto debe ser participante ni sustituir a un usuario real.
- No mide funcionalidad (eso ya lo cubre la suite automatizada de H1). Mide si una persona real, sin instrucción paso a paso, logra hacer su trabajo.
- No es un lanzamiento. Va sobre el entorno de desarrollo/staging, con cuentas y datos desechables — nunca sobre datos reales de clientes.

## Cohorte (mínimo recomendado)

| Rol | Cantidad | Criterio |
| --- | --- | --- |
| Ventas | 2 | Nivel técnico distinto entre ambos (uno cómodo con software nuevo, uno no) |
| Gerente | 1 | Con permiso real de aprobación de descuentos |
| Administrador/operador | 1 | Alguien que normalmente NO vende ni cotiza — evalúa la superficie operativa (auditoría, notificaciones) |
| Clientes representativos | 3 | Al menos 2 en móvil; ninguno debe ser empleado de OCPOOL ni haber visto el producto antes |

Ninguno de los ocho participantes debe repetirse entre sesiones ni haber recibido explicación previa del flujo — la validez del piloto depende de que nadie llegue "pre-entrenado".

## Antes de la sesión (moderador)

1. Crear una cuenta desechable por participante staff (rol real: `sales`, `manager`, `admin`) con un expediente/cotización YA en el estado que la tarea necesita (ver tabla de tareas abajo) — nunca pedir a un participante que empiece desde cero un flujo de varios días.
2. Para clientes: generar un enlace de acceso al portal real (magic link) para un expediente de prueba con una cotización ya enviada.
3. Confirmar que los flags V2 están en el estado que se va a probar (legacy por defecto salvo decisión explícita — ver el [runbook de recuperación operativa](commercial-incident-recovery.md#kill-switch-apagar-todo-v2-de-inmediato) para el mecanismo exacto).
4. Tener a la mano: cronómetro, la hoja de captura (siguiente sección), y el guion de tareas de la fila que corresponda. No compartir el guion con el participante.
5. Grabar sólo con consentimiento explícito y verbal al inicio; nunca grabar sin avisar.

## Guion de tareas (frase natural, no instrucciones paso a paso)

Leer la tarea en voz alta o mostrarla por escrito, exactamente así — sin agregar "primero haz clic en..." Si el participante se bloquea por completo, anotar el bloqueo, dar la ayuda mínima necesaria para continuar, y marcar la tarea como asistida (ver rúbrica de severidad).

### Staff — ventas / gerente

| # | Tarea (leer tal cual) | Estado inicial requerido |
| --- | --- | --- |
| 1 | "Entra y dime cuál es tu siguiente pendiente." | El participante tiene al menos un expediente propio y uno sin asignar visible en el dashboard |
| 2 | "Aquí hay una solicitud nueva. Revísala y dime qué sabes del cliente." | Un expediente en `RECIBIDA`/`EN_ELABORACION` |
| 3 | "Al cliente le falta dar una medida. Pídesela." | Mismo expediente, listo para "Solicitar información" |
| 4 | "Arma una cotización de 3 conceptos para este proyecto." | Expediente con catálogo de precios vigente |
| 5 | "Ahora una de 10 conceptos distintos." | Mismo expediente u otro nuevo |
| 6 | "El cliente pidió algo que no está en el catálogo. Cotízalo de todas formas." | Ninguno adicional — el "concepto especial" es una acción real del constructor |
| 7 | "Esta cotización tiene un descuento que necesita autorización. Pide la aprobación." *(sólo ventas)* / "Alguien te pidió aprobar un descuento. Resuélvelo." *(sólo gerente)* | Versión con descuento > 10% en `EN_REVISION` |
| 8 | "Esta cotización ya está lista. Envíasela al cliente." | Versión aprobada, PDF listo |
| 9 | "Un envío falló / un cliente aceptó algo que ya cambió. Resuélvelo." | Una entrega en `FAILED`, o una versión con digest desactualizado (ver runbook de recuperación) |

### Staff — administrador/operador

| # | Tarea | Estado inicial requerido |
| --- | --- | --- |
| 1 | "Alguien reporta que un cliente no recibió un correo. Encuentra qué pasó." | Una `notificationDelivery` en `FAILED` real |
| 2 | "¿Quién ha iniciado sesión como administrador esta semana?" | Eventos reales en `AuthEvent` |
| 3 | "Corrige el correo de este contacto, que está mal." | Un expediente con contacto editable |

### Cliente (portal)

| # | Tarea | Estado inicial requerido |
| --- | --- | --- |
| 1 | "Te llegó un enlace de tu proveedor de alberca. Ábrelo y dime qué ves." | Magic link real, sin explicación previa de qué es OCPOOL |
| 2 | "Aquí está tu cotización. ¿Qué harías si algo no te convence?" | Cotización visible, sin decir la palabra "Solicitar cambios" |
| 3 | "Ahora sí, acéptala." | Mismo expediente |

No leer los nombres de botones en voz alta como instrucción ("haz clic en Solicitar información") — la tarea describe la intención, nunca la interfaz.

## Captura por tarea (llenar durante la sesión, una fila por tarea)

| Campo | Cómo registrarlo |
| --- | --- |
| Éxito/fracaso | Completó sin ayuda / completó con ayuda / no completó |
| Tiempo | Segundos desde que se lee la tarea hasta la acción final que la completa |
| Acciones | Conteo simple de clics/pantallas distintas usadas (no un log técnico) |
| Retrocesos | Cuántas veces regresó o repitió un paso ya hecho |
| Errores y asistencia | Qué mensaje de error vio (si alguno) y qué ayuda mínima se dio |
| SEQ (Single Ease Question) | Inmediatamente después de la tarea, preguntar: **"En general, ¿qué tan fácil o difícil fue completar esta tarea?"** Escala 1 (muy difícil) a 7 (muy fácil). Anotar el número que diga el participante, sin sugerir uno. |
| Observación verbal | Cita textual si el participante piensa en voz alta algo revelador |
| Severidad (si hubo bloqueo/confusión) | Ver rúbrica abajo |

### Rúbrica de severidad

- **Crítica:** el participante no puede completar la tarea de ninguna forma, o hace algo que un usuario real jamás debería poder hacer (confundir folio con confirmación de envío, confundir "guardado" con "publicado", etc.).
- **P1 (alta):** completa con ayuda significativa o un rodeo largo; un usuario real probablemente abandonaría o llamaría a soporte.
- **P2 (media):** duda visible o un retroceso, pero se resuelve solo en menos de 20 segundos.
- **P3 (baja):** comentario o gesto de incomodidad sin impacto real en el resultado.

## Al final de cada sesión: SUS (System Usability Scale)

Instrumento estándar, sin modificar el texto ni el orden. Responder cada afirmación en escala 1 (muy en desacuerdo) a 5 (muy de acuerdo):

1. Creo que usaría este sistema con frecuencia.
2. Encontré el sistema innecesariamente complejo.
3. Pensé que el sistema era fácil de usar.
4. Creo que necesitaría el apoyo de una persona técnica para poder usar este sistema.
5. Encontré que las distintas funciones de este sistema estaban bien integradas.
6. Pensé que había demasiada inconsistencia en este sistema.
7. Me imagino que la mayoría de las personas aprenderían a usar este sistema muy rápidamente.
8. Encontré el sistema muy incómodo de usar.
9. Me sentí muy seguro/a usando el sistema.
10. Necesité aprender muchas cosas antes de poder usar este sistema.

**Cálculo del puntaje SUS:** para ítems impares (1,3,5,7,9), restar 1 al valor dado. Para ítems pares (2,4,6,8,10), restar el valor dado de 5. Sumar los diez resultados y multiplicar por 2.5. El resultado va de 0 a 100.

Cerrar con una pregunta abierta sin guion: **"¿Qué fue lo más confuso de todo lo que acabas de hacer?"** — registrar la respuesta textual completa.

## Go/No-Go (T1-03) — llenar después de completar todas las sesiones

| Criterio | Umbral | Resultado real | Cumple |
| --- | --- | --- | --- |
| Éxito crítico staff (tareas 1-9 combinadas, ventas+gerente+admin) | ≥ 90% | | |
| Éxito crítico portal (tareas cliente) | ≥ 95% | | |
| Tiempo mediana "siguiente pendiente" | según §29.2 del plan histórico | | |
| Tiempo p90 "siguiente pendiente" | según §29.2 del plan histórico | | |
| SUS promedio | ≥ 85 | | |
| SEQ promedio por tarea | ≥ 6/7 | | |
| Severidad crítica (cualquier sesión) | 0 | | |
| Confusión folio/publicación/correo/aceptación (cualquier sesión) | 0 participantes | | |
| Problemas P1 abiertos | cada uno con responsable y fecha, ninguno bloqueando una tarea | | |

**Regla de cierre:** si CUALQUIER criterio no se cumple, el resultado es **No-Go** para esa pieza específica del producto — la corrección regresa a la slice correspondiente del backlog (mismo patrón de este repositorio: hallazgo real → commit dedicado → verificación → bitácora), no se "explica" el resultado para aprobarlo de todas formas. Un No-Go parcial no bloquea necesariamente todo el piloto — sólo la pieza específica que falló, documentada aquí con la sesión y el participante exactos (sin nombre real, usar "Ventas A", "Cliente móvil 2", etc.).

## Después del piloto

1. Registrar el resultado (Go/No-Go por criterio, con evidencia) en `PROJECT_STATUS.md` bajo una entrada nueva de "Estado actual", igual que cualquier otra pieza de este proyecto.
2. Cualquier hallazgo crítico o P1 se convierte en una pieza de trabajo normal (spec del hallazgo → corrección → prueba → bitácora), no en un documento aparte.
3. No repetir sesiones con los mismos participantes para "confirmar" una corrección — usar participantes nuevos si se requiere una segunda ronda, para no contaminar la validez del piloto.
