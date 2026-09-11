# Fase 12 — Auditoría operativa y seguridad

**Estado:** Especificación propuesta para revisión antes de implementación.

## Objetivo

Convertir los registros transaccionales existentes de OCPOOL en una superficie interna de investigación segura, útil y mantenible. El personal autorizado debe poder responder qué ocurrió, cuándo, sobre qué tipo de operación y con qué resultado, sin convertir la auditoría en una fuente de PII, secretos, payloads o identificadores reutilizables.

La fase no modifica operaciones comerciales, no añade exportación masiva, no purga datos históricos y no sustituye revisión legal de retención. Su propósito es lectura controlada, trazabilidad y diagnóstico.

## Problema actual

Los módulos ya escriben `AuditLog` dentro de transacciones para solicitudes, cotizaciones, catálogo, mensajería, archivos, documentos, aceptación y notificaciones. Identidad escribe `AuthEvent`. Sin embargo:

- no existe un módulo de lectura común;
- `metadata` es heterogéneo y no debe serializarse directamente;
- no hay permiso dedicado para consultar auditoría;
- no existe cursor estable ni filtros temporales estrictos;
- no hay una vista staff que separe actividad comercial de eventos de seguridad;
- el historial contextual de una solicitud no sustituye una investigación transversal.

## Alcance

### Incluido

1. Contratos puros de auditoría: categorías, acciones allowlisted, outcomes, filtros, fechas, cursor y proyección segura.
2. Servicio de lectura sobre `AuditLog` y, sólo para administradores, `AuthEvent`.
3. Permisos separados:
   - `audit.read` para actividad operativa autorizada de `manager` y `admin`;
   - `audit.security.read` sólo para `admin` y eventos de identidad/security.
4. API privada `GET /api/staff/audit` con query estricta, `no-store`, rate limit, paginación cursor-based y errores públicos.
5. UI `/staff/audit` con actividad operativa, filtro de periodo/categoría/outcome, carga, vacío, error, acceso restringido, responsive, teclado, Axe y reduced motion.
6. Mapper de redacción que nunca copia `metadata` crudo, `entityId`, `actorUserId`, `identifierHash`, IP, user-agent, emails, teléfonos, cuerpos, payloads, storage keys, hashes de documentos o ciphertext.
7. Runbook de operación, límites, retención pendiente y diagnóstico seguro.
8. Unitarias, integración, E2E y regresión RBAC/IDOR.

### Fuera de alcance

- exportación CSV/PDF;
- purga o retención automática;
- reconstrucción de eventos faltantes en históricos;
- exposición de IP, user-agent, hashes, UUIDs o metadata arbitraria;
- edición, corrección o borrado desde la UI;
- ingestión en un SIEM externo;
- alertas en tiempo real;
- convertir la auditoría en una fuente de métricas BI.

## Arquitectura propuesta

Crear `src/server/modules/audit/` con tres fronteras:

- `domain.ts`: tipos, categorías, filtros, límites, acciones y cursor opaco;
- `repository.ts`: lecturas parametrizadas y acotadas sobre `AuditLog`/`AuthEvent`, sin consultas por fila;
- `service.ts`: RBAC, selección de fuente, rate limit, paginación y mapper seguro.

La API será `src/app/api/staff/audit/route.ts`. La superficie visual será `src/app/staff/audit/page.tsx` y `src/components/StaffAuditPanel.tsx`, reutilizando tokens staff y patrones de estados existentes.

No se añade tabla paralela en esta fase. Se revisarán índices existentes con `EXPLAIN`; cualquier migración debe justificarse por selectividad y volumen real.

## Autorización y alcance

- `audit.read` permite actividad operativa: solicitudes, cotizaciones, catálogo, conversaciones, archivos, documentos y notificaciones.
- `audit.security.read` habilita además `AuthEvent` para administradores; nunca retorna datos técnicos de red o identificación.
- `sales` no obtiene un visor transversal. Sus historiales contextuales continúan protegidos por los módulos existentes.
- `customer` no accede a `/api/staff/audit`.
- El backend decide permisos y categorías; filtros del navegador sólo reducen la consulta, nunca amplían alcance.
- La lectura de auditoría no crea una cadena recursiva de `AuditLog`; la consulta se registra en logs técnicos redacted con request ID, duración y categoría, sin payload.

## Contrato seguro

```ts
type AuditQuery = {
  from?: string;
  to?: string;
  category?: 'commercial' | 'communication' | 'documents' | 'notifications' | 'security';
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  cursor?: string;
  limit?: number;
};

type AuditEntry = {
  eventKey: string;          // opaca, no reutilizable como ID de otra ruta
  occurredAt: string;
  category: string;
  action: string;            // etiqueta allowlisted
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  actorLabel: string;        // displayName de empleado autorizado o “Sistema”
  actorKey: string | null;   // hash opaco estable, no reversible
  entityLabel: string;       // etiqueta, nunca entityId
  details: Array<{ label: string; value: string }>;
};

type AuditResponse = {
  items: AuditEntry[];
  nextCursor: string | null;
  meta: { from: string; to: string; timezone: string; scope: 'operational' | 'security'; freshness: 'fresh' };
};
```

La redacción será por acción allowlisted. Las claves desconocidas se descartan, no se convierten automáticamente a string. Las etiquetas visibles no contendrán emails, teléfonos, nombres de clientes, mensajes, UUIDs, hashes ni secretos.

## Fechas, cursor y rendimiento

- Timestamps se consultan en UTC y se presentan con `APP_TIMEZONE`.
- El intervalo es `[from,to)` y el máximo es 93 días.
- El cursor encapsula `(createdAt,id)` y se firma o cifra para evitar manipulación y enumeración.
- El límite de página será acotado, con default pequeño y máximo explícito.
- La consulta ordena por `createdAt DESC, id DESC` y filtra antes de paginar.
- No se hará `findUnique` por entrada para enriquecer actor o entidad; se usarán joins/selects acotados o un batch fijo.
- Objetivo inicial: P95 local menor a 500 ms con fixtures representativos.
- La fase no añade cache compartida porque la información es privada y la lectura debe ser fresca.

## Seguridad y privacidad

- Query Zod `.strict()`; se rechazan filtros desconocidos, SQL, IDs arbitrarios y zonas horarias del navegador.
- Rate limit por actor antes de leer auditoría.
- `Cache-Control: no-store`.
- `entityId`, `actorUserId`, `identifierHash`, IP, user-agent y metadata cruda permanecen en backend.
- El actor se proyecta por display name interno sólo para roles autorizados; no se expone correo ni vínculo de cliente.
- Logs de errores usan el envelope existente y no revelan metadata.
- La vista no habilita acciones; los deep links se dejan fuera hasta definir una navegación segura por capability.
- AuthEvent security sólo muestra tipo/outcome/fecha/actor etiquetado; no muestra señales que faciliten enumeración o fingerprinting.

## UI/UX

La vista será una herramienta de investigación, no un muro de eventos:

- encabezado con propósito, periodo, zona y alcance;
- filtros discretos de periodo, categoría y resultado;
- feed/tablet de eventos con jerarquía de acción, actor, entidad y detalles redactados;
- cursor “Cargar anteriores” accesible y sin saltos de scroll;
- estados de carga estable, vacío útil, error recuperable y acceso restringido;
- responsive 390/768/1440, targets táctiles, focus visible, labels explícitos, contraste AA y reduced motion;
- indicadores visuales de `DENIED`/`FAILURE` sin usar color como única señal.

## Testing requerido

### Unitarias

- catálogo de acciones/categorías;
- filtros estrictos y rango `[from,to)`;
- cursor válido, alterado, expirado y límite máximo;
- actor key/event key opacos;
- redacción de cada metadata sensible conocida;
- unknown action/category descartados o rechazados según contrato;
- serialización JSON sin BigInt, PII, UUIDs, hashes, IP, user-agent, payloads ni ciphertext.

### Integración PostgreSQL

- manager consulta actividad operativa propia del entorno permitido;
- admin puede consultar seguridad con permiso separado;
- sales/customer reciben 403;
- IDOR por cursor/entity/action no amplía el resultado;
- límites temporales, outcomes y categorías se aplican en backend;
- paginación estable sin duplicados ni saltos;
- actor eliminado/sistema se proyecta sin error;
- metadata histórica sensible nunca llega a la respuesta;
- rate limit 429 ocurre antes de agregados/lecturas pesadas.

### E2E

- sin sesión/acceso restringido;
- manager ve operación y no datos sensibles;
- admin ve operación + seguridad;
- filtros, “cargar anteriores”, vacío y error recuperable;
- Axe, teclado, reduced motion, consola y no overflow.

## Criterios de terminado

Fase 12 sólo se cerrará cuando:

1. `AuditLog` y `AuthEvent` tengan contratos de lectura separados y seguros.
2. Permisos operativos/seguridad estén catalogados, sembrados y probados.
3. La API aplique RBAC, fechas, cursor, rate limit, `no-store` y redacción backend.
4. Ninguna respuesta exponga metadata cruda, IDs internos, PII, red técnica o secretos.
5. La UI sea responsive, accesible y útil en vacío/error/carga.
6. Las consultas tengan evidencia de paginación, ausencia de N+1 y rendimiento.
7. README, runbook, `PROJECT_STATUS.md`, spec, review y plan estén actualizados.
8. Tests unitarios, integración, E2E, typecheck, lint, build, auditoría y diff check pasen.
9. Retención y purga queden explícitamente bloqueadas por decisión legal, sin defaults destructivos.
