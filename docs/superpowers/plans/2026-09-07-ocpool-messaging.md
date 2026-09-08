# Mensajería y notas internas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Pasos usan checkbox (`- [ ]`) para control documental.

**Goal:** Construir conversación segura por expediente con mensajes compartidos cliente–equipo y notas internas que nunca se filtren al portal.

**Architecture:** Monolito modular Next.js App Router. Una conversación por `QuoteRequest`, scope redundante por `clientId`, mensajes append-only, visibilidad explícita, RBAC separado y Outbox transaccional sin cuerpos sensibles en payload.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript ES2023, Prisma 7.10.0/PostgreSQL 16, sesiones persistidas, Zod, Vitest, Playwright y CSS OCPOOL. No se agrega dependencia nueva.

**Spec:** `docs/superpowers/specs/2026-09-07-ocpool-messaging.md`

## Reglas globales

- El actor siempre deriva de sesión; el request nunca define `clientId` ni `senderUserId`.
- Cliente sólo ve/escribe `CUSTOMER` en solicitudes propias; notas `INTERNAL` no llegan a ninguna proyección cliente.
- Empleado necesita `requests.read` más permiso de mensajería; scope comercial sigue siendo obligatorio.
- Mensajes no se editan ni borran en esta fase; cuerpo plano, longitud limitada y sin HTML.
- Cada mutación debe usar same-origin, rate limit, idempotencia, transacción, auditoría y Outbox.
- Cada tarea termina con pruebas, `git diff --check`, PROJECT_STATUS y commit lógico.

## Mapa de archivos

- `prisma/schema.prisma`: enums/modelos de conversaciones y mensajes.
- `prisma/migrations/<timestamp>_messaging/`: migración con FKs, índices y constraints.
- `src/server/auth/constants.ts`: permisos de mensajería y roles.
- `src/server/modules/messaging/domain.ts`: visibilidad, estados, límites y normalización pura.
- `src/server/modules/messaging/service.ts`: scope, lectura, envío, notas, cierre e idempotencia.
- `src/app/api/portal/requests/[id]/messages/route.ts`: API cliente.
- `src/app/api/staff/quote-requests/[id]/messages/route.ts`: API empleado de mensajes compartidos.
- `src/app/api/staff/quote-requests/[id]/notes/route.ts`: API empleado de notas internas.
- `src/app/api/staff/quote-requests/[id]/conversation-status/route.ts`: cierre/reapertura protegida.
- `src/components/ClientPortalPanel.tsx`: hilo del cliente dentro del detalle.
- `src/components/StaffRequestsPanel.tsx`: mensajes y notas del expediente interno.
- `src/app/globals.css`: estados y responsive del hilo.
- `tests/unit/messaging-domain.test.ts`: límites, normalización, estados y reglas puras.
- `tests/integration/messaging-service.test.ts`: transacciones, idempotencia, scope, notas y Outbox.
- `tests/integration/messaging-api.test.ts`: 401/403/404, same-origin, rate limit y payloads.
- `tests/messaging.spec.ts`: E2E opt-in cliente/empleado, privacidad, responsive y Axe.
- `PROJECT_STATUS.md`: seguimiento de fase y evidencia.

## Tareas ordenadas

### Tarea 1 — Contrato, permisos y persistencia

**Objetivo antes de iniciar:** fijar visibilidad, estados, límites y modelo relacional sin tocar UI.

**Riesgos:** FKs que permitan cruces de cliente, duplicados de conversación, permisos que amplíen scope, migración no reversible en cleanup.

- [ ] Escribir pruebas rojas de dominio para visibilidad, estados, longitud, caracteres de control e idempotency key.
- [ ] Agregar permisos `messaging.read`, `messaging.send`, `messaging.internal_notes.read`, `messaging.internal_notes.write`, `messaging.manage` y asignarlos a roles apropiados.
- [ ] Crear enums/modelos `Conversation` y `ConversationMessage`; decidir formalmente si `ConversationReadState` entra en este slice y documentarlo.
- [ ] Agregar constraints de append-only lógico, body no vacío, longitud máxima, visibilidad válida, índices y FK compuesto/validación equivalente por scope.
- [ ] Crear migración, ejecutar validate/generate/deploy y seed idempotente.
- [ ] Ejecutar unitarias dirigidas, schema dirigido, typecheck, lint y `git diff --check`.
- [ ] Actualizar estado y hacer commit `feat: add messaging persistence contracts`.

**Criterios de terminado:** migración aplicada, permisos probados, contrato puro verde, cleanup exacto posible y ningún dato de mensaje aún expuesto por API.

### Tarea 2 — Servicio transaccional y proyecciones

**Objetivo antes de iniciar:** persistir mensajes/notas con scope, idempotencia y Outbox atómicos.

**Riesgos:** doble envío concurrente, notas visibles por error, cuerpo sensible en logs/payload, cierre con carrera.

- [ ] Escribir pruebas rojas de cliente propio/ajeno, empleado con/sin permisos, nota interna, conversación cerrada, UUID inválido y reintento.
- [ ] Implementar `getOrCreateConversationForRequest` con lock/constraint y coherencia request+client.
- [ ] Implementar listados paginados estables con proyección cliente sin notas/senders internos y proyección staff con visibilidad controlada.
- [ ] Implementar envío de cliente, envío de staff y nota interna; nunca aceptar sender/visibility críticos sin derivarlos del actor/capacidad.
- [ ] Implementar hash de idempotencia por actor/conversación y resultado repetible sin duplicado.
- [ ] Emitir `MESSAGE.CREATED` y cambios de estado en Outbox sin body; registrar auditoría mínima sin contenido completo.
- [ ] Implementar cierre/reapertura con lock y reglas documentadas; rechazar nuevos mensajes después del cierre.
- [ ] Ejecutar unitarias/integración, revisar payloads/logs, typecheck/lint y commit `feat: add transactional messaging service`.

**Criterios de terminado:** servicio transaccional probado con dos clientes, Outbox atómico, idempotencia concurrente y ninguna nota en proyección cliente.

### Tarea 3 — APIs privadas de portal y staff

**Objetivo antes de iniciar:** publicar contratos HTTP seguros, no UI.

**Riesgos:** diferencias de autorización entre servicio y rutas, enumeración por status/count, mutaciones cross-origin, cache de contenido privado.

- [ ] Crear esquemas Zod estrictos para cursor/paginación, body plano, idempotency key y estado.
- [ ] Crear rutas portal y staff con `requestId`, guards existentes, same-origin en mutaciones y `no-store`.
- [ ] Verificar respuestas 401/403/404 uniformes, rate limit, UUID/folio ajeno y headers sensibles.
- [ ] Probar que respuestas cliente no incluyen notas, `senderUserId` interno, token/hash, cuerpo de nota, payload Outbox ni stack.
- [ ] Documentar ejemplos públicos de request/response sin secretos y hacer commit `feat: expose protected messaging APIs`.

**Criterios de terminado:** API íntegra para cliente/staff con contrato validado y regresión de rutas existentes verde.

### Tarea 4 — UI portal cliente

**Objetivo antes de iniciar:** integrar hilo de mensajes compartidos en detalle existente, sin convertir el portal en chat genérico.

**Riesgos:** filtrado sólo frontend, composer duplicado, mala densidad móvil, leaks en estados de error.

- [ ] Escribir E2E roja de hilo privado y notas no visibles.
- [ ] Añadir sección de conversación al detalle, carga incremental/paginación estable y estado vacío.
- [ ] Añadir composer de texto con contador, bloqueo mientras envía, error recuperable e idempotencia transparente.
- [ ] Mostrar conversación cerrada como lectura y explicar por qué no acepta mensajes.
- [ ] Verificar teclado, foco, hit area, Axe, reduced motion y no overflow 360/390/768/1440.
- [ ] Hacer commit `feat: add customer messaging thread`.

**Criterios de terminado:** cliente sólo ve mensajes compartidos propios, puede enviar de forma segura y UI cubre todos los estados.

### Tarea 5 — UI staff y notas internas

**Objetivo antes de iniciar:** dar al equipo una superficie productiva con separación inequívoca de nota y mensaje.

**Riesgos:** mezclar visibilidad en el mismo composer, permisos visuales que no coincidan con backend, impacto en densidad del inbox.

- [ ] Añadir pestañas o zonas separadas para mensajes compartidos y notas internas.
- [ ] Ocultar acciones según capacidades, manteniendo validación backend.
- [ ] Mostrar autor/fecha al staff, pero proyectar identidad de equipo al cliente cuando corresponda.
- [ ] Añadir cierre/reapertura sólo con `messaging.manage`, confirmación y feedback accesible.
- [ ] Verificar responsive, estados vacíos/error/locked, Axe y consola.
- [ ] Hacer commit `feat: add staff messaging and internal notes`.

**Criterios de terminado:** equipo puede coordinarse sin filtrar notas y el flujo no rompe inbox/cotizaciones.

### Tarea 6 — Seguridad negativa, E2E y gate

**Objetivo antes de iniciar:** demostrar aislamiento, consistencia y ausencia de filtraciones antes de cerrar fase.

- [ ] Crear fixtures de dos clientes, dos empleados con capacidades distintas, conversación y mensajes/notas.
- [ ] Ejecutar pruebas IDOR, sesión revocada/archivada, same-origin, rate limit, idempotencia concurrente, cierre y UUID inválido.
- [ ] Ejecutar E2E opt-in cliente/staff con envío, refresh, nota interna y comprobación de no filtración.
- [ ] Ejecutar Axe, responsive, consola, HTML/payload/log audit y cleanup exacto.
- [ ] Ejecutar gate de DB, unit, integration, content, typecheck, lint, build, E2E normal, E2E opt-in, audit y diff check.
- [ ] Actualizar riesgos/deuda/decisiones y hacer commit `docs: close phase six messaging`.

## Gate de Fase 6

No se iniciará archivos, notificaciones productivas ni aceptación digital hasta que todos los criterios de la especificación tengan evidencia, las notas internas estén aisladas y el Outbox esté listo sin cuerpos sensibles.
