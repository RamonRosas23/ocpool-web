# OCPOOL — Documentación activa de la rearquitectura comercial

Esta carpeta contiene la documentación vigente que gobierna la reconstrucción de las superficies privadas de OCPOOL. Es la referencia de trabajo actual; no incluye la landing pública, que permanece congelada.

## Estado (2026-09-25)

`plans/` está vacía: el plan V3 ([`2026-09-19-ocpool-commercial-v3-continuacion.md`](../historicos/plans/2026-09-19-ocpool-commercial-v3-continuacion.md)) cerró su backlog completo para alcance local el 2026-09-20 y quedó archivado en [`../historicos/plans/`](../historicos/plans/) junto con el plan V2 que reemplazó. Lo único abierto de ese plan es T1 (piloto de usabilidad humano — coordinación externa, protocolo en [`../runbooks/pilot-usability-protocol.md`](../runbooks/pilot-usability-protocol.md)); no reactivar decisiones de los planes archivados sin ADR nuevo.

Los ADR de gobierno, política, primitives y aceptación relacionados viven en [`../adr/`](../adr/), incluyendo el [ADR de resolución de política v2](../adr/2026-09-19-commercial-policy-v2-resolution.md) que cierra BIZ-03/04/06/07/09/10/13.

## Regla de uso

Mientras no exista un nuevo plan vigente en esta carpeta, la fuente operativa de trabajo es [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md) (bitácora exacta de cada slice, con commit y conteo de pruebas) más los ADR relacionados. Un plan nuevo se agrega aquí en `plans/` cuando arranque la siguiente iniciativa.
