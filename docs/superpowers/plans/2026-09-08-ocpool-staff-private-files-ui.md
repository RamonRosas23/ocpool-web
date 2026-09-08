# Plan — UI staff de archivos privados

> Plan enfocado de Tarea 5 de Fase 7. Se ejecuta después de la especificación y del cierre de la UI cliente; cada tarea actualiza `PROJECT_STATUS.md` y deja evidencia antes de avanzar.

## Tarea 1 — Contrato E2E y capacidades

- [x] Extender fixture staff opt-in para dos visibilidades y capacidades manager/rol limitado.
- [x] Escribir prueba roja de listado separado, descarga, estado interno y controles condicionados.
- [x] Confirmar que los payloads del navegador no contienen keys, hashes ni datos de otro cliente.

## Tarea 2 — Componente operativo

- [x] Crear panel staff con tabs accesibles y estados de carga/error/vacío/pending/rejected.
- [x] Integrar listado, descarga efímera y borrado lógico con autorización backend.
- [x] Integrar reserva/finalización con categoría y visibilidad explícitas; ocultar acciones según capacidades.

## Tarea 3 — Integración visual y responsive

- [x] Integrar el panel en el detalle del inbox sin romper mensajería ni historial.
- [x] Añadir estilos densos y consistentes con el workspace staff, teclado, contraste y reduced motion.
- [x] Verificar no overflow, consola y estados de sesión en escritorio/móvil.

## Tarea 4 — Verificación de Tarea 5

- [x] Ejecutar E2E staff opt-in, integración API dirigida y gate de typecheck/lint/build/diff check.
- [x] Corregir regresiones y documentar problemas/resoluciones.
- [x] Commit `feat: add staff private files workspace`.

Evidencia de cierre:

- `StaffFilesPanel` quedó integrado en `/staff/requests` y consume el mismo contrato privado con tabs `Compartidos`/`Internos`, categorías, visibilidad, estados, descarga efímera, borrado confirmado y carga real presigned.
- `STAFF_MESSAGING_E2E=1 npx playwright test tests/client-messaging-staff.spec.ts` pasó 2/2: manager carga y elimina un archivo; manager ve ambos alcances; rol limitado sólo ve compartidos y no recibe controles de carga/borrado ni contenido interno.
- La E2E validó Axe sin violaciones serias, no overflow, consola limpia y continuidad de mensajería. `npm run typecheck`, `npm run lint` y `git diff --check` correctos.
- Se corrigió una semántica ARIA detectada por Axe: el `tabpanel` ahora envuelve al `<ul>` y sus `<li>` permanecen en una lista válida.

## Tarea 5 — Handoff a gate Fase 7

- [x] Actualizar plan principal y `PROJECT_STATUS.md` con Tarea 5 cerrada.
- [x] Preparar matriz final de seguridad, cleanup y riesgos de antivirus/backups para Tarea 6.
