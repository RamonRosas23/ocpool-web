# ADR — Política comercial, fiscal, scope y legal V1

**ID:** ADR-2026-09-10-commercial-policy-v1  
**Estado:** `PARTIAL_APPROVED_PRODUCT_PENDING_FISCAL_LEGAL` — histórico; las filas `PENDING_FISCAL`/`PENDING_PRODUCT_LEGAL`/`PENDING_LEGAL` (BIZ-03, BIZ-04, BIZ-09, BIZ-10) quedaron cerradas por [`2026-09-19-commercial-policy-v2-resolution.md`](2026-09-19-commercial-policy-v2-resolution.md). Las filas `APPROVED_PRODUCT` de este documento siguen vigentes sin cambio.
**Fecha:** 2026-09-10  
**Owner técnico:** Codex/arquitectura  
**Decisores:** responsable de producto OCPOOL; fiscalía/jurídico para los ámbitos indicados  
**Regla:** las recomendaciones no son decisiones activas y no autorizan schema, cálculo, publicación ni aceptación.

La autorización explícita recibida en la tarea del 2026-09-11 cierra las
decisiones de producto enumeradas abajo para implementación local. No sustituye
la aprobación fiscal o jurídica de BIZ-03, BIZ-04, BIZ-09 y BIZ-10.

## Propósito

Cerrar las políticas que cambian dinero, permisos, onboarding, evidencia o contratos antes de D1/D2. Cada fila debe recibir una decisión explícita, responsable y fecha UTC. Un `PENDING` no se transforma en un default por conveniencia.

## Decisiones requeridas

| ID | Tema | Recomendación segura para discutir | Estado | Bloquea |
| --- | --- | --- | --- | --- |
| BIZ-01 | Zona de negocio | Mantener `America/Chihuahua`, separada de UTC y del navegador | `APPROVED_PRODUCT` | fechas, vigencia, SLA |
| BIZ-02 | Monedas y precisión | Iniciar con `MXN` y 2 decimales; allowlist versionada para otra moneda | `APPROVED_PRODUCT` | pricing, PDF |
| BIZ-03 | Perfiles fiscales | Usar perfiles versionados y aprobados; eliminar tasas libres introducidas desde el formulario | `PENDING_FISCAL` | cálculo, PDF, aceptación |
| BIZ-04 | IVA y redondeo | Confirmar incluido/excluido por perfil; redondeo half-up por línea y suma de líneas | `PENDING_FISCAL` | totales, snapshot |
| BIZ-05 | Vigencia | `validUntil` obligatorio; sin fecha no se publica; no se inventa un default | `APPROVED_PRODUCT` | builder, publicación |
| BIZ-06 | Descuento/override | Todo descuento y override solicita aprobación separada hasta nuevo ADR | `APPROVED_PRODUCT` | permisos, aprobación |
| BIZ-07 | Autoaprobación | Prohibida; override administrativo exige MFA, motivo y auditoría | `APPROVED_PRODUCT` | aprobación |
| BIZ-08 | Scope de ventas | Propias + sin asignar; equipo/global sólo con permiso explícito | `APPROVED_PRODUCT` | colas, RBAC |
| BIZ-09 | Firmante cliente | Aceptar sólo contacto principal o contacto autorizado explícitamente por staff | `PENDING_PRODUCT_LEGAL` | aceptación |
| BIZ-10 | Términos/privacidad | Registro de términos inmutables con hash, versión activa y revisión jurídica | `PENDING_LEGAL` | publicación, aceptación, lanzamiento |
| BIZ-11 | Momento de acceso | Enlace al pedir información y al publicar, según el evento; un correo útil | `APPROVED_PRODUCT` | onboarding, notificaciones |
| BIZ-12 | SLA/prioridad | No mostrar SLA; prioridad sólo con reglas deterministas aprobadas | `APPROVED_PRODUCT` | work center |
| BIZ-13 | Proyecto mínimo | Handoff comercial real: responsable, scope snapshot, estado, ruta y permiso | `APPROVED_PRODUCT` | conversión |
| BIZ-14 | Identidad cliente | Una organización por usuario; deduplicación administrada, sin fusión automática | `APPROVED_PRODUCT` | onboarding, scope |

## Formato obligatorio de decisión

Para cerrar una fila, registrar debajo o en el acta de aceptación:

```text
ID:
Decisión aprobada:
Alternativa descartada:
Responsable:
Ámbito (producto/fiscal/legal/seguridad):
Fecha UTC:
Impacto en schema/dinero/permisos/evidencia:
Slice que desbloquea:
No-go si falta:
Evidencia o documento de respaldo:
```

Una decisión parcial no desbloquea una slice que use otra parte de la misma política. Por ejemplo, aprobar MXN no autoriza todavía una tasa de IVA ni términos de aceptación.

## Acta de aprobación local — 2026-09-11

| Alcance | Decisión | Responsable/aprobador | Impacto y no-go |
| --- | --- | --- | --- |
| BIZ-01, BIZ-02, BIZ-05…BIZ-08, BIZ-11…BIZ-14 | Aprobadas para las slices locales descritas en la tabla | Responsable de la iniciativa OCPOOL, mediante autorización explícita en esta tarea | Permite continuar contratos y UX que no calculen impuestos ni cierren evidencia legal |
| BIZ-03 y BIZ-04 | No se inventa perfil, tasa ni tratamiento fiscal | Fiscalía OCPOOL pendiente | Bloquea cálculo fiscal, aceptación y publicación dependientes |
| BIZ-09 y BIZ-10 | No se inventa firmante ni texto jurídico | Jurídico OCPOOL pendiente | Bloquea aceptación y lanzamiento productivo |

## Reglas que ya son normativas

Estas reglas no dependen de resolver las filas anteriores:

- el cliente nunca selecciona la versión de términos ni el impuesto mediante una cadena libre;
- las cifras se calculan en backend con precisión entera y se guardan como snapshot;
- una aprobación se liga a versión, revisión y digest exactos;
- sales no aprueba su propio descuento;
- portal y mutaciones exigen tipo de actor, `clientId` y `portal.self.read`;
- ninguna publicación se anuncia antes de PDF `READY`, preflight y confirmación;
- no se crea `Project` sin aceptación exacta y contrato habilitado;
- cualquier ambigüedad fiscal, legal o de identidad bloquea la slice afectada.

## No-go inmediato

Mientras exista alguna fila `PENDING` que afecte la slice:

- no se agrega migración fiscal, términos, aprobación, proyecto ni publicación V2;
- no se presenta aceptación como lista para uso real;
- no se activan flags de cohortes;
- no se rellena la decisión con el valor del entorno actual sin aprobación registrada.

## Relación con el plan

Este ADR satisface el entregable documental de G0-02 y deja aprobada la parte de
producto. G0-02 permanece `BLOQUEADO_PARCIAL` por BIZ-03, BIZ-04, BIZ-09 y BIZ-10.
G0-03 y G0-04 pueden continuar con evidencia y UX sin activar políticas fiscales
o legales; D1, D2 y S0-04 no pueden cerrar las partes que dependan de ellas.
