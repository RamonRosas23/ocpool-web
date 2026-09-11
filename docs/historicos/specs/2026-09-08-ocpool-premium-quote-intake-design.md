# OCPOOL — Diseño de captación comercial premium

## Estado

Diseño aprobado para ejecución local. Esta fase mejora el formulario público existente sin convertirlo todavía en un portal de cliente ni en un sistema de carga pública de archivos.

## Objetivo

Convertir el formulario actual en una solicitud comercial inicial de nivel premium: clara, progresiva, accesible, con datos suficientes para priorizar y calificar el expediente, sin aumentar innecesariamente la fricción de primer contacto.

## Problema actual

El formulario actual persiste correctamente una solicitud, pero sólo captura contacto, tipo de obra, ubicación y descripción. La interfaz se percibe cuidada, aunque todavía funciona como un formulario mínimo de captación y no como una entrada comercial completa. Además, el correo de recepción puede enlazar al portal antes de que exista un usuario cliente vinculado.

## Decisiones de diseño

1. El producto seguirá llamando a esta operación `Solicitud de proyecto` internamente; el usuario puede llegar desde `Cotizar`, pero el sistema no prometerá un precio automático.
2. La captura será progresiva en dos pasos dentro de la misma superficie, conservando los datos al retroceder.
3. El primer paso priorizará contacto y contexto mínimo: nombre, correo, teléfono, tipo de obra y ubicación.
4. El segundo paso recogerá calificación operativa: etapa del proyecto, dimensiones aproximadas, horizonte de inicio, rango de presupuesto opcional y descripción.
5. La descripción seguirá siendo obligatoria y tendrá límites claros; los campos de calificación serán opcionales para no bloquear oportunidades tempranas.
6. Las opciones de etapa, horizonte y presupuesto se almacenarán como enums controlados, no como JSON ni texto libre.
7. La API mantendrá compatibilidad con clientes que no envíen los nuevos campos; sus valores persistirán como `null`.
8. Se agregará un honeypot invisible como control anti-spam de bajo costo junto con el rate limit existente. No se añadirá CAPTCHA sin evidencia de abuso o decisión de producto.
9. Los adjuntos permanecerán fuera de esta fase. Se habilitarán después del onboarding, usando el storage privado ya existente y sin aceptar archivos anónimos directamente desde el formulario.
10. El formulario mostrará validación por campo, foco accesible, estados de carga/error/éxito y un resumen de siguiente paso sin inventar tiempos de respuesta.
11. El enlace jurídico completo del aviso de privacidad queda condicionado a revisión legal; no se inventará texto legal dentro de esta fase.

## Contrato de datos

Los campos nuevos de `QuoteRequestDetail` serán:

- `projectStage`: `IDEA`, `SITE_READY`, `UNDER_CONSTRUCTION`, `REMODEL`, `EQUIPMENT_ONLY` o `UNSURE`.
- `dimensions`: texto opcional normalizado, máximo 500 caracteres.
- `timeline`: `ASAP`, `ONE_TO_THREE_MONTHS`, `THREE_TO_SIX_MONTHS`, `SIX_PLUS_MONTHS` o `UNSURE`.
- `budgetRange`: `UNDER_250K`, `FROM_250K_TO_500K`, `FROM_500K_TO_1M`, `OVER_1M` o `UNSURE`.

Los enums viven en PostgreSQL/Prisma y el endpoint público los valida con Zod. La vista staff los proyecta con etiquetas de negocio sin exponer valores internos innecesarios.

## Flujo

```text
Landing / #contacto
        |
        v
Paso 1: contacto + contexto mínimo
        |
        v
Paso 2: calificación opcional + descripción
        |
        v
POST /api/quote-requests
        |
        v
Transacción: cliente/contacto + detalle + folio + historial + auditoría + Outbox
        |
        v
Éxito: folio + instrucciones de seguimiento
        |
        v
Inbox staff /staff/requests
```

## Seguridad

- Se conserva same-origin, límite de body, normalización, consentimiento, rate limit por email/IP e idempotencia.
- El honeypot no sustituye el rate limit ni una protección perimetral productiva.
- El cliente no puede fijar `clientId`, estado, folio, actor, permisos ni campos fuera del schema estricto.
- Los campos nuevos no deben aparecer en logs ni respuestas de error crudas.
- La respuesta pública seguirá devolviendo únicamente aceptación y folio.

## UX y accesibilidad

- Paso actual anunciado con `aria-current="step"` y texto de progreso legible.
- Cada error se asociará al campo mediante `aria-describedby` y `aria-invalid`.
- El foco se moverá al primer error sólo después de intentar avanzar o enviar.
- El botón de avance tendrá copy de acción (`Continuar` / `Enviar solicitud`).
- Los placeholders no serán la única fuente de instrucción.
- Se reforzará contraste de etiquetas, ayudas, líneas y consentimiento sin abandonar la identidad visual.
- El formulario seguirá funcionando a 390, 768 y 1440 px, con reduced motion y teclado.

## Criterios de terminado

- Migración aplicada y reversible en local; seed idempotente preservado.
- API acepta y persiste todos los campos nuevos, rechaza enums inválidos y honeypot rellenado.
- Replay con la misma `Idempotency-Key` no crea otro expediente y devuelve el mismo folio.
- Staff ve las nuevas señales en el detalle sin romper expedientes históricos.
- UI mantiene datos entre pasos, valida campos, muestra estados y conserva el folio.
- Unitarias, integración, E2E, Axe, responsive, typecheck, lint, build, auditoría y diff check correctos.
- `PROJECT_STATUS.md`, README/runbook y el plan quedan actualizados.

## Fuera de alcance

- Creación/invitación automática de usuarios cliente.
- Administración de usuarios y roles.
- Carga pública de archivos.
- CAPTCHA/Turnstile obligatorio.
- Texto jurídico definitivo del aviso de privacidad.
