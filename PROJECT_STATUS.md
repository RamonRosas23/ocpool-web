# OCPOOL — Estado del proyecto

> Fuente única de seguimiento del proyecto de plataforma comercial. Este archivo se actualiza después de cada fase, vertical slice y verificación relevante.

## Estado actual

- **Fase:** Fase 0 — Auditoría, alcance y diseño arquitectónico.
- **Estado:** Diseño base documentado; pendiente de revisión documental antes de crear el plan de implementación.
- **Última actualización:** 2026-09-07.
- **Rama base auditada:** `main`.
- **Working tree al iniciar esta fase:** limpio.

## Orden documental obligatorio

1. Auditoría y decisiones iniciales.
2. Especificación de diseño en `docs/superpowers/specs/`.
3. Autorrevisión de la especificación.
4. Plan de implementación en `docs/superpowers/plans/`.
5. Implementación por vertical slices.
6. Verificación de fase.
7. Actualización de este archivo y documentación técnica.

No se iniciará una fase posterior si la fase anterior no tiene criterios de terminado verificables.

## Módulos

### Terminados para el alcance actual de la web pública

- Landing pública editorial de OCPOOL.
- Identidad visual y sistema de estilos de la landing.
- Portafolio de proyectos y diálogo accesible.
- Navegación responsive.
- Formulario público básico de contacto.
- Metadata, Open Graph, Twitter card, JSON-LD, robots y sitemap.
- Contrato de contenido de la web.
- Pruebas E2E de calidad visual, interacción, responsive, consola y accesibilidad.

### Prototipo o incompletos para el producto comercial

- Formulario de cotización: sólo valida datos y prepara un `mailto`; no crea una solicitud persistida.
- Contacto: no existe confirmación transaccional ni expediente.

### Pendientes

- Arquitectura de aplicación comercial.
- PostgreSQL, migraciones y seeds.
- Identidad, sesiones y RBAC.
- Clientes, contactos y expedientes.
- Solicitudes, folios, estados y asignaciones.
- Catálogo, precios y plantillas.
- Constructor de cotizaciones.
- Snapshots y versionado inmutable.
- Portal del cliente.
- Mensajería y notas internas.
- Archivos privados.
- PDF comercial.
- Aceptación digital.
- Notificaciones y Outbox.
- Auditoría comercial y de seguridad.
- Dashboard y métricas.
- Hardening, backups, observabilidad y preparación para producción.

## Decisiones arquitectónicas vigentes

1. Mantener la web pública existente y su identidad visual.
2. Construir un monolito modular, no microservicios.
3. Mantener Next.js App Router como aplicación principal.
4. Usar PostgreSQL como fuente de verdad transaccional.
5. Separar marketing, portal de cliente y sistema interno mediante route groups y módulos de dominio.
6. Mantener sesiones privadas y autorización en backend; no usar el folio como autenticación.
7. Separar el folio comercial del identificador interno UUID/ULID.
8. Tratar las versiones enviadas o aceptadas como inmutables.
9. Guardar snapshots de precios, impuestos y conceptos dentro de cada versión de cotización.
10. Iniciar localmente con aplicación, PostgreSQL y Mailpit; agregar storage, worker, antivirus o Redis sólo cuando el módulo lo justifique.
11. Mantener WhatsApp y otros canales externos desacoplados del flujo principal.
12. No afirmar que la aceptación digital sustituye contratos formales sin revisión jurídica.

## Pruebas realizadas

- `npm run test:content` — correcto.
- `npm run build` — correcto.
- `npm run test:e2e` — 29 pruebas correctas.
- `npm audit --omit=dev` — 0 vulnerabilidades reportadas.
- `npm audit` completo — 1 vulnerabilidad moderada en dependencia de desarrollo indirecta de ESLint (`@humanfs/node`).
- `npm run lint` independiente — no terminó después de más de un minuto y fue detenido; el build sí completó su etapa de validación de lint y tipos.

## Pruebas pendientes

- Pruebas unitarias de dominio.
- Pruebas de servicios y transacciones de base de datos.
- Pruebas de API y autorización.
- Pruebas de IDOR, enumeración, sesiones y rate limiting.
- Pruebas de archivos privados y URLs temporales.
- Pruebas de snapshots e inmutabilidad.
- Pruebas de cálculo de cotizaciones.
- E2E cliente y empleado.
- Pruebas de PDF y aceptación.
- Pruebas de notificaciones y reintentos.
- Pruebas de carga y restauración de backups.

## Riesgos abiertos

- Reglas de moneda, IVA, descuentos y redondeos aún no confirmadas.
- Alcance de datos por ejecutivo, sucursal o zona aún no confirmado.
- Proveedor de correo transaccional de producción aún no seleccionado.
- Política de retención y eliminación de datos personales pendiente de revisión formal.
- Requisitos legales de aceptación y evidencia pendientes de revisión jurídica.
- Destino de despliegue de producción aún no definido.
- La vulnerabilidad de desarrollo de ESLint requiere revisión de compatibilidad antes de actualizar dependencias.

## Deuda técnica conocida

- El README todavía es el README inicial de Next.js y no documenta el producto real.
- No existe `.env.example`.
- No existe Docker Compose.
- No existe una capa de dominio separada de los componentes de la landing.
- El endpoint de contacto actual no debe considerarse backend comercial.
- El lint independiente necesita diagnóstico para quedar reproducible y documentado.

## Próximo paso autorizado

Revisar la especificación `docs/superpowers/specs/2026-09-07-ocpool-commercial-platform-design.md`. Después de su aprobación se creará el plan de implementación ordenado, sin iniciar código funcional antes de ese plan.

