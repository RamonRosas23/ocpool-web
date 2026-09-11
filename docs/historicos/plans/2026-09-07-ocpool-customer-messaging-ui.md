# UI de mensajería del portal cliente — Plan de implementación

> Plan de la Tarea 4 de Fase 6. Mantiene el hilo dentro del detalle existente del portal.

**Spec:** `docs/historicos/specs/2026-09-07-ocpool-customer-messaging-ui.md`
**Regla:** prueba E2E dirigida, implementación por estados, QA responsive/a11y y commit lógico.

## Tareas ordenadas

### 1. Contrato E2E rojo

- [x] Ampliar fixture opt-in con mensaje compartido y nota interna.
- [x] Escribir flujo de lectura, envío, refresh y nota no visible.
- [x] Añadir assertions de payload, consola, Axe y no overflow.

### 2. Modelo de estado y fetch

- [x] Crear tipos de respuesta cliente sin datos internos.
- [x] Cargar conversación al cambiar de expediente con cancelación/guard contra respuestas obsoletas.
- [x] Implementar cursor incremental, reintento de lectura y separación de errores.
- [x] Implementar envío con idempotency key, bloqueo durante request y reintento seguro.

### 3. Superficie visual

- [x] Integrar la sección de conversación después de la propuesta y antes de la trazabilidad.
- [x] Diseñar vacío, feed, autor/fecha, error, cierre y composer dentro de la gramática OCPOOL.
- [x] Añadir contador, texto plano y feedback accesible.
- [x] Añadir estilos responsive 360/390/768/1440 y reduced motion.

### 4. QA y cierre

- [x] Ejecutar E2E opt-in cliente, Axe, consola y payload audit.
- [x] Ejecutar regresión pública, typecheck, lint, integración y diff check.
- [x] Actualizar plan de Fase 6 y `PROJECT_STATUS.md`.
- [x] Hacer commit `feat: add customer messaging thread`.

Evidencia de cierre:

- La prueba roja inicial falló por la ausencia esperada de la sección; después `PORTAL_E2E=1 npx playwright test tests/client-portal.spec.ts` pasó 2/2, incluyendo lectura, envío, refresh, nota interna invisible y conversación cerrada de sólo lectura.
- `ClientMessagingThread` usa tipos cliente mínimos, cancelación al cambiar de expediente, cursor incremental, reintento de lectura, error de envío recuperable y clave opaca por intento; el backend sigue siendo la autoridad de idempotencia y permisos.
- La integración se insertó después de la propuesta y antes de la trazabilidad; cubre vacío, carga, error, feed, contador, accesibilidad, responsive y `prefers-reduced-motion` sin dependencias nuevas.
- `npm run test:unit` 45/45, `npm run test:integration` 37/37 con un worker DB, `npm run test:content`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` 34/34 ejecutadas con 5 omitidas explícitamente, y `git diff --check` correctos.
- La primera corrida E2E completa tuvo 2 timeouts de cierre bajo carga; ambos checks aislados pasaron 1/1 y la segunda regresión completa pasó 34/34. El comando oficial de integración quedó serializado para evitar timeouts de transacción reproducibles en PostgreSQL local.

## Criterio de terminado

La conversación funciona como parte del expediente, cubre todos los estados y tamaños, mantiene accesibilidad y no filtra notas internas ni datos privados adicionales.
