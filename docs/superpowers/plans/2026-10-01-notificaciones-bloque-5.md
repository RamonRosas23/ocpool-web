# Notificaciones — Bloque 5 Implementation Plan

> Para ejecutar: usar superpowers:executing-plans en línea, tarea por tarea. Cada paso usa casillas para registrar el avance.

**Goal:** Completar el Bloque 5 del diseño aprobado: preferencias de avisos sincronizadas, resumen por correo cuando un aviso de actividad sigue sin leerse, plantillas faltantes y recordatorios idempotentes.

**Architecture:** Se conserva la bandeja y el outbox existentes. El registro de un aviso de actividad programa un evento con vencimiento; el worker relee el estado al vencer y entrega el resumen sólo si sigue aplicando. Un barrido del worker crea recordatorios dentro de una transacción con advisory lock y bitácora única. Las preferencias pertenecen al usuario autenticado y las consumen la UI y el worker.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL, Vitest, Playwright y los componentes actuales de inbox/email.

**Spec:** docs/superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md, §§1, 2.3, 8–11 y 13–15.

## Global Constraints

- El aviso se crea en la misma transacción del cambio de dominio; pg_notify sólo se entrega al confirmar.
- El canal en vivo transporta identificadores, nunca contenido.
- Nunca se avisa por correo a quien hizo la acción.
- La bandeja y los resúmenes respetan el alcance vigente del expediente.
- Los mensajes al cliente y las vistas previas usan los límites y el escapado existentes; nunca se envían datos internos.
- El resumen del equipo se programa sólo al responsable; si no existe, sólo a Gerencia. El resto del equipo consulta la bandeja.
- Retraso por defecto: 10 minutos para equipo y 15 minutos para cliente.
- El barrido corre cada 5 minutos, de lunes a sábado entre 08:00 y 19:00 en APP_TIMEZONE.
- Cada recordatorio usa InboxReminder.key como clave única y las preferencias no desactivan correos transaccionales requeridos.

## Review Focus

- Si la persona lee o resuelve el aviso justo antes del vencimiento, no recibe resumen; el intento queda cancelado con ALREADY_READ.
- Si la preferencia cambia a OFF después de programar el resumen, no se manda correo; los mensajes transaccionales requeridos siguen llegando.
- Agrupar actividad adicional no duplica el resumen ni reinicia el vencimiento; el correo incluye el conteo y la vista previa más recientes.
- En reasignaciones, suspensiones y expedientes cerrados, un resumen o recordatorio atrasado no llega a una persona que ya perdió el alcance.
- En el cambio de hora, fin de semana y límites exactos de 08:00/19:00, el barrido respeta APP_TIMEZONE sin duplicar claves.

---

### Task 1: Preferencias por usuario en servidor

**Files:**
- Modify: prisma/schema.prisma
- Create: prisma/migrations/20261001010000_inbox_preferences_reminders/migration.sql
- Create: src/server/modules/inbox/preferences.ts
- Create: src/app/api/notifications/preferences/route.ts
- Test: tests/integration/inbox-preferences.test.ts

**Interfaces:**
- Produces GET/PATCH /api/notifications/preferences. GET returns sound, desktop, activityEmail and saved for the authenticated user; PATCH updates only supplied fields.
- Produces readInboxPreferences(actor, dependencies?) and updateInboxPreferences(actor, patch, dependencies?).
- Defaults: employee sound on, customer sound off, desktop off, activityEmail DIGEST. Rows are created only on write.

- [x] Paso 1: Escribir pruebas de lectura de defaults, aislamiento por usuario, PATCH parcial, valores inválidos y same-origin.
- [x] Paso 2: Ejecutar npx vitest run tests/integration/inbox-preferences.test.ts; debe fallar por la ruta/servicio todavía inexistentes.
- [x] Paso 3: Agregar el enum InboxActivityEmail, los modelos InboxPreference e InboxReminder, la restricción de cancelación con ALREADY_READ e INBOX_DIGEST y la API propia del usuario autenticado. Validar con Zod y proteger escrituras con el helper same-origin usado por las demás rutas.
- [x] Paso 4: Ejecutar la prueba de integración y prisma validate; ambas deben pasar.
- [x] Paso 5: Commit feat(inbox): persistir preferencias de notificaciones por usuario.

Prueba de servicio esperada:

    expect(await readInboxPreferences(employee)).toEqual({ sound: true, desktop: false, activityEmail: 'DIGEST', saved: false });
    expect(await updateInboxPreferences(employee, { activityEmail: 'OFF' })).toEqual({ sound: true, desktop: false, activityEmail: 'OFF', saved: true });

### Task 2: Controles de preferencias en portal y Mi cuenta

**Files:**
- Modify: src/lib/inbox-preferences.ts
- Modify: src/components/inbox/InboxProvider.tsx
- Modify: src/components/inbox/NotificationBell.tsx
- Modify: src/components/StaffAccountPanel.tsx
- Create: src/components/inbox/InboxPreferencesControls.tsx
- Test: tests/unit/inbox-preferences.test.ts
- E2E: tests/realtime-notifications.spec.ts

**Interfaces:**
- InboxProvider loads and saves preferences through the new API and exposes a save error for the controls.
- Mi cuenta → Avisos uses the shared controls for staff. Novedades uses them for customers.
- Existing local sound/desktop values are imported once only when the server has no saved row; future updates go to the server.

- [x] Paso 1: Añadir prueba unitaria para leer valores antiguos de localStorage como migración de una sola vez.
- [x] Paso 2: Ejecutar npx vitest run tests/unit/inbox-preferences.test.ts; debe fallar porque la lectura de valores guardados aún no existe.
- [x] Paso 3: Añadir la migración de preferencias legadas, el estado de carga/guardado del provider y los controles accesibles de sonido, escritorio y correo.
- [x] Paso 4: Añadir al E2E una comprobación de persistencia al recargar y de que el ajuste OFF se muestra en ambas superficies.
- [x] Paso 5: Ejecutar la prueba unitaria y REALTIME_E2E=1 sobre tests/realtime-notifications.spec.ts; deben pasar.
- [x] Paso 6: Commit feat(inbox): sincronizar preferencias de avisos en portal y cuenta.

### Task 3: Plantillas transaccionales y reglas de correo

**Files:**
- Modify: src/server/modules/notifications/templates.ts
- Modify: src/server/modules/notifications/event-resolver.ts
- Test: tests/unit/notifications-templates.test.ts
- Test: tests/integration/notifications-fanout.test.ts

**Interfaces:**
- Adds the approved v1 templates that are missing: quote.declined, request.information_needed, project.started, project.assigned and quote.expiring.
- Keeps request.new_for_team and quote.changes_requested; activity.digest is implemented with Task 4.
- MESSAGE.CREATED uses the activity summary for inbox users, except the dedicated quote.changes_requested template; contacts without a portal account keep the immediate email.

- [x] Paso 1: Añadir pruebas unitarias de redacción/escapado de cada plantilla nueva y pruebas de mapeo de los eventos declinación, solicitud de información y proyecto.
- [x] Paso 2: Ejecutar npx vitest run tests/unit/notifications-templates.test.ts; los casos nuevos deben fallar por claves o mapeos faltantes.
- [x] Paso 3: Implementar los esquemas de payload, resolución de destinatarios con alcance vigente y contenido seguro en es-MX.
- [x] Paso 4: Añadir integración que confirme que MESSAGE.CREATED a un usuario con inbox no produce un correo inmediato, y que un contacto sin cuenta conserva su entrega.
- [x] Paso 5: Ejecutar las pruebas unitarias e integración de fanout; deben pasar.
- [x] Paso 6: Commit feat(notifications): completar plantillas transaccionales del inbox.

### Task 4: Resumen de actividad condicionado a no leídos

**Files:**
- Modify: src/server/modules/inbox/record.ts
- Create: src/server/modules/notifications/inbox-digest.ts
- Modify: src/server/modules/notifications/worker.ts
- Modify: src/server/modules/notifications/dispatcher.ts
- Modify: src/server/modules/notifications/templates.ts
- Modify: src/server/env.ts
- Test: tests/integration/notifications-inbox-digest.test.ts
- Test: tests/unit/notifications-templates.test.ts
- Modify: tests/integration/inbox-messages.test.ts, tests/integration/messaging-service.test.ts, tests/integration/realtime-request-signals.test.ts (limpiar los eventos diferidos de sus fixtures)

**Interfaces:**
- recordInboxIntents schedules INBOX.DIGEST_DUE only when a new customer.activity/team.activity notice is created and the recipient's activityEmail is DIGEST.
- processInboxDigestDueBatch re-reads notification, recipient preference and current staff scope before creating one activity.digest delivery.
- Group updates never schedule a second event or move the original availableAt.
- Read/resolved notices cancel with ALREADY_READ; OFF or lost scope cancels with INBOX_DIGEST.

- [x] Paso 1: Escribir pruebas de programación a 10/15 minutos, agrupación sin duplicados, envío sin leer y cancelación por lectura/resolución/preferencia OFF.
- [x] Paso 2: Ejecutar npx vitest run tests/integration/notifications-inbox-digest.test.ts; debe fallar porque aún no existe el procesador.
- [x] Paso 3: Agregar el evento diferido al crear el aviso, el procesador idempotente, el template activity.digest y cancelReason ALREADY_READ/INBOX_DIGEST.
- [x] Paso 4: Configurar INBOX_DIGEST_DELAY_STAFF_MINUTES e INBOX_DIGEST_DELAY_CUSTOMER_MINUTES con defaults 10 y 15, límites positivos y validación.
- [x] Paso 5: Ejecutar pruebas de digest y plantillas; deben pasar.
- [x] Paso 6: Commit feat(notifications): enviar resumen sólo si el aviso sigue sin leer.

### Task 5: Recordatorios idempotentes y horarios

**Files:**
- Create: src/server/modules/inbox/reminders.ts
- Modify: src/server/modules/notifications/worker.ts
- Modify: src/server/env.ts
- Test: tests/unit/inbox-reminders.test.ts
- Test: tests/integration/inbox-reminders.test.ts

**Interfaces:**
- Consumes InboxReminder created by Task 1, with key primary key and createdAt.
- Exports runInboxReminderSweep({ prisma, now, timeZone, enabled? }) returning acquired, examined and recorded counts.
- Uses pg_try_advisory_xact_lock, a bounded candidate batch and InboxReminder.key ON CONFLICT DO NOTHING.
- Creates the seven approved reminder kinds/recipients/thresholds in §9; quote.expiring also inserts the quote.expiring outbox email.
- Continuous worker invokes the sweep at most once every five minutes; INBOX_REMINDERS_ENABLED controls it.

- [x] Paso 1: Añadir pruebas del horario es-MX, los siete umbrales, destinatarios, clave única y doble ejecución.
- [x] Paso 2: Ejecutar npx vitest run tests/unit/inbox-reminders.test.ts tests/integration/inbox-reminders.test.ts; debe fallar por servicio/modelo faltante.
- [x] Paso 3: Implementar candidatos y escritura transaccional, respetando estados actuales, actor y alcance del expediente.
- [x] Paso 4: Conectar el worker al intervalo de cinco minutos y validar INBOX_REMINDERS_ENABLED.
- [x] Paso 5: Ejecutar pruebas dirigidas y typecheck; deben pasar.
- [x] Paso 6: Commit feat(inbox): programar recordatorios comerciales sin duplicados.

### Task 6: Documentar, verificar y cerrar el Bloque 5

**Files:**
- Create: docs/ocpool-commercial-v2/specs/2026-10-01-notificaciones-bloque-5.md
- Modify: PROJECT_STATUS.md
- Test: suites globales y E2E enfocados

- [x] Paso 1: Escribir la evidencia final y las limitaciones en la spec del Bloque 5 y PROJECT_STATUS.md.
- [x] Paso 2: Ejecutar typecheck, lint, unit, integration, E2E enfocado y foundation; registrar cada salida.
- [x] Paso 3: Ejecutar git diff --check, revisar el diff completo y confirmar que sólo entren archivos del Bloque 5.
- [x] Paso 4: Commit docs(portal): documentar cierre de notificaciones bloque 5. No hacer push ni despliegue.

## Cobertura de spec

- §1: InboxPreference, InboxReminder y cancelReason — Tasks 1, 4 y 5.
- §8.1–8.3: correcciones, resumen diferido y plantillas — Tasks 3 y 4.
- §9: recordatorios, horario, advisory lock e idempotencia — Task 5.
- §10: preferencias de servidor en staff/cliente — Tasks 1 y 2.
- §11 y §13: alcance, privacidad, carreras, templates, recordatorios y E2E — Tasks 1–6.
- §14: el Bloque 5 cierra el roadmap de notificaciones de cinco bloques; no autoriza despliegue.
