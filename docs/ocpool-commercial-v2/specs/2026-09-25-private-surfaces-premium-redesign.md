# Rediseño premium de todas las superficies privadas (staff, portal y acceso)

**Fecha:** 2026-09-25
**Rama:** `catalog-ux-redesign`
**Contexto:** tras cerrar las piezas de Catálogo y el sistema de modales, el responsable de producto pidió llevar el diseño y la UI/UX de *todos* los flujos a un nivel premium ("que sea perfecto, fácil de usar, intuitivo… super pulido"), con autonomía total y verificación en bloques. La landing pública queda fuera: está congelada por G0-05 y no se tocó ni un selector que la afecte.

## Diagnóstico (verificado en navegador real, 1440/1024/390 px)

Capturas de página completa de las 9 rutas de staff, el portal y las 5 pantallas de acceso, con sesión real de gerente y de cliente piloto:

1. **Staff no tenía forma de cerrar sesión** ni veía con qué cuenta estaba trabajando: el header legado (duplicado a mano en 8 paneles) sólo mostraba navegación.
2. **La navegación desaparecía por completo bajo 900 px** (`.staff-top-nav { display: none }` sin alternativa): en tablet y móvil no había forma de moverse entre secciones.
3. **Tipografía ilegible:** etiquetas, navegación y botones de 8–9 px en mayúsculas con tracking; el texto base de la interfaz usaba `system-ui` en vez de Manrope, la tipografía de marca que la propia landing ya carga.
4. **Héroes de 88–122 px** en cada vista operativa empujaban el contenido útil por debajo del primer pantallazo.
5. **Defectos visibles:** la tabla de líneas del constructor de cotizaciones se desbordaba bajo el resumen lateral (botones de mover/quitar recortados); la fila de Aprobaciones colocaba "Abrir expediente" en una posición aleatoria; el historial del expediente pegaba el estado con el motivo ("RecibidaCambio registrado"); el panel de Proyecto reutilizaba el marcado de notificaciones para mostrar alcance y checklist.
6. **Datos crudos:** Auditoría mostraba `EN_REVISION`, `2026-09-25T06:00:00.000Z`, `5000` (unidades mínimas) y `328177` (bytes); Notificaciones y la tarjeta "Fallos de aviso" mostraban `quote.version_sent`/`QUOTE.PUBLISHED`/`TEMPORARY_PROVIDER`; el portal mostraba `ENVIADA`.
7. **Hueco funcional:** Notificaciones decía "306 entregas" pero sólo 20 eran alcanzables — no había paginación.

## Decisiones de diseño

- **Un solo lenguaje visual** para staff, portal y acceso, definido como tokens en `private-ui.css`: Manrope (marca) para la interfaz y Cormorant Garamond sólo como acento editorial (`<em>` de los títulos); radios 8/12/16; sombras en capas de bajo contraste; colores de estado como tintes suaves; piso tipográfico de 11 px; botones en *sentence case* de 44 px (objetivo táctil ya exigido por U1).
- **CSS privado fuera de `globals.css`:** todo lo de auth/staff/portal vive ahora en `src/components/private/ui/private-surfaces.css`, cargado sólo por los layouts privados. La landing deja de descargar ~100 KB que no usaba y ningún cambio privado puede alterar su render congelado. Una verificación automática de colisiones de nombres de clase entre ambos archivos encontró una (`.project-card`), resuelta con el prefijo `handoff-`.
- **`StaffHeader` compartido** en lugar del header duplicado: navegación filtrada por permisos (con íconos en escritorio amplio), menú de cuenta con identidad, rol, "Ir al sitio público" y **"Cerrar sesión"**, menú móvil completo y un destino real para "Saltar al contenido". La identidad sale de `getStaffHeaderContext`: una sola lectura sin transacción ni escritura (la autorización sigue en cada API); si falla, el header se muestra sin menú de cuenta en vez de tumbar la página.
- **Encabezados compactos** (28–36 px) con métrica en tarjeta; rails de lista pegajosos con su propio scroll en los master–detail; el resumen del constructor pasa a colapsable bajo 1440 px para que la tabla de líneas nunca se comprima.
- **Dashboard reordenado:** KPIs → "Qué atender ahora" (colas con contador) → "Lectura del periodo".
- **Presentación legible sin tocar contratos de API:** `formatAuditDetail` (estados, fechas, importes, tamaños) y `notification-labels` traducen en la vista; la proyección del servidor y sus pruebas no cambian.
- **"Opcional" con criterio:** `optionalHint={false}` en filtros y en selectores que en la práctica siempre se eligen (lista de precios, perfil de IVA).

## Fuera de alcance

- Landing pública (congelada).
- Superficies V2 detrás de banderas (`RequestWorkspace*V2`): heredan los tokens nuevos pero no se rediseñaron.
- Cambios de reglas de negocio o de API: la única función de servidor nueva es de lectura para el header.

## Verificación

- `tsc`, lint y 276 pruebas unitarias (incluida la nueva `audit-detail-format.test.ts`).
- Capturas de todas las rutas en 1440/1280/1024/390 px sin desbordamiento horizontal; diálogos, menús, estados vacíos, de carga y restringidos revisados uno por uno; la vista de Proyecto se validó con datos simulados vía intercepción de red para no alterar los fixtures del piloto.
- Suite E2E completa contra build de producción (resultado registrado en `PROJECT_STATUS.md`).
