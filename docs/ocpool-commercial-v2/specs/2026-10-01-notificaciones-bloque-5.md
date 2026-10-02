# Notificaciones inteligentes y recordatorios — Bloque 5

**Fecha de cierre local:** 2026-10-02
**Estado:** implementación y verificación local completas. No desplegado.

## Base aprobada

Este cierre ejecuta el diseño aprobado en [`2026-09-29-notificaciones-tiempo-real-design.md`](../../superpowers/specs/2026-09-29-notificaciones-tiempo-real-design.md), en particular el modelo de preferencias y recordatorios (§1), los correos transaccionales y resúmenes diferidos (§8), la programación de recordatorios (§9), la sincronización de preferencias (§10), las garantías de privacidad y concurrencia (§11), la configuración de entorno (§13) y el cierre del roadmap local (§14).

## Entregado

- Preferencias de notificación persistentes en servidor para cliente y equipo, con migración controlada de valores locales existentes, API autenticada y controles accesibles.
- Plantillas transaccionales del inbox con destinatarios resueltos desde el estado vigente del expediente. Los mensajes ordinarios no producen un correo inmediato si siguen sin leerse; se agrupan en un resumen diferido sujeto a preferencias y estado de lectura.
- El worker programa resúmenes para el equipo a 10 minutos y para clientes a 15 minutos, y vuelve a validar lectura, preferencias y destinatarios antes de entregar.
- Recordatorios comerciales idempotentes y protegidos con lock transaccional: solicitudes esperando al cliente, solicitudes sin responsable, aprobaciones pendientes, vencimiento y expiración de propuestas, y seguimiento de expedientes estancados. El barrido corre cada cinco minutos, de lunes a sábado entre 08:00 y 19:00 en `APP_TIMEZONE`.
- El vencimiento de propuestas usa el emisor de dominio común para registrar el correo sin generar una señal innecesaria en el panel vivo.
- `.env.example` y el runbook de disponibilidad describen las demoras, el interruptor `INBOX_REMINDERS_ENABLED` y la operación del worker.

## Verificación local

La corrida final de integración y E2E usó una base local desechable `ocpool_block5_test`, migrada y sembrada para este bloque. Un intento preliminar sobre la base configurada de desarrollo encontró eventos de resumen antiguos que interferían con las pruebas globales; se procesaron/cancelaron algunos de esos eventos, sin enviar correos. Las corridas finales se trasladaron a la base aislada y no se repitió ese barrido sobre `ocpool_dev`.

| Verificación | Resultado |
| --- | --- |
| `npm run typecheck` | Aprobado |
| `npm run lint` | Aprobado |
| `npm run test:unit -- --maxWorkers=1` | 79 archivos, 465 pruebas aprobadas |
| `npm run test:integration` | 71 archivos, 225 pruebas aprobadas |
| Playwright: `tests/realtime-notifications.spec.ts` y `tests/foundation-health.spec.ts`, con `REALTIME_E2E=1`, `FOUNDATION_E2E=1` y `APP_URL=http://127.0.0.1:3100` | 8 pruebas aprobadas |
| `git diff --check` | Sin errores de formato |

La corrida de navegador se mantuvo en el puerto QA 3100 y en la base local aislada. No escribió en la base del servidor de desarrollo del usuario.

## Límites de este cierre

- No se verificó la entrega con credenciales SMTP o proveedor de correo de producción; las pruebas validan la resolución, programación y encolado local.
- El proxy productivo, PM2, la configuración real de `APP_TIMEZONE` y el reinicio operativo del worker requieren validación en el entorno de despliegue, siguiendo el runbook.
- No se hizo push ni despliegue. Este cierre local no elimina los bloqueos externos de lanzamiento que ya constan en `PROJECT_STATUS.md`.
