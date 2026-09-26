# Pulido fino de Catálogo, Cotizaciones y Solicitudes

**Fecha:** 2026-09-26
**Rama:** `catalog-ux-redesign`
**Contexto:** "revisa catálogo, cotizaciones, solicitudes… que sea lo más perfecto posible, fácil de usar". Recorrido real en navegador de los tres flujos con perfiles de ventas y de gerencia, a 1440, 1280 y 390 px, armando un borrador real en el constructor (sobre datos de prueba locales). Todo lo encontrado se corrigió; sin cambios de reglas de negocio ni de API.

## Hallazgos y correcciones

### Cotizaciones
- **Importes cortados:** la columna Total de cada línea truncaba montos grandes ("MXN 145,928…"). Un importe nunca debe recortarse: columna más ancha y sin puntos suspensivos. El total grande del resumen (bajo 1440 px) ya no se parte en dos renglones.
- **Precio editable sin separadores:** se mostraba "125800.00"; ahora "125,800.00" (el análisis ya aceptaba comas; `money-input.test.ts` cubre formato y viaje de ida y vuelta). En móvil el precio tiene más ancho para no cortarse.
- **Buscador de conceptos:**
  - Los conceptos sin precio en la lista (no seleccionables) se mezclaban con los útiles; ahora van después, bajo "Sin precio en esta lista", y las flechas del teclado recorren sólo los que se pueden agregar.
  - Sin escribir sólo se veían 20 resultados (varios con precio quedaban fuera); ahora 50 (el máximo de la API) y, si hay más, se sugiere acotar la búsqueda.
  - Al enfocarlo cerca del borde inferior, el desplegable se abría fuera de la pantalla; ahora el campo sube para que se vea.
- **Contenido de la propuesta:** el resumen plegado indica "N de 5 con texto" (verde cuando están las cinco) y Garantías/Notas públicas tienen ejemplos de qué escribir.

### Solicitudes
- La tarjeta "Responsable" quedaba casi vacía cuando la acción de tomar estaba en "Siguiente paso"; ahora lo explica ("Hazte responsable con «Tomar solicitud» en el siguiente paso").
- La marca "Sin asignar" se repetía en cada fila dentro de la propia vista "Sin asignar"; ahí se oculta.
- La conversación decía "Correspondencia" dos veces (etiqueta y título); la etiqueta ahora es "Cliente y equipo".
- Espaciado irregular en la tarjeta de proyecto (márgenes por defecto de los párrafos).

### Catálogo
- "Nuevo concepto": "Especificar clave manualmente" (la excepción) estaba primero; ahora va al final con la aclaración de que la clave se genera sola, el foco inicial queda en "Nombre" y la descripción sugiere qué incluir.
- La fecha del riel de listas de precio ahora dice "Desde …".

### Transversal (tablet y móvil)
- En pantallas donde lista y detalle se apilan (Solicitudes ≤900 px, Cotizaciones ≤1100 px, Catálogo ≤1020 px), elegir un elemento cambiaba el detalle *debajo* de la lista y parecía que no pasaba nada. `revealWhenStacked` lleva al detalle — en Solicitudes y Cotizaciones cuando termina de cargar (con el esqueleto la página aún no era lo bastante alta y el salto se quedaba corto) — respetando "reducir movimiento"; tocar el elemento ya abierto también lleva al detalle.

## Verificación
- `tsc`, lint completo y pruebas unitarias (nueva `money-input`).
- Navegador real: importes completos en la línea y el resumen; precio "125,800.00" sin re-guardado espurio; buscador agrupado con teclado; contador de contenido; foco en "Nombre"; salto al detalle en 390 px (Solicitudes aterriza bajo el encabezado).
- Suite E2E opt-in completa contra build de producción: 60/61 (la única falla sigue siendo la preexistente de `quality.spec.ts` por los assets de la landing); `request-workspace-v2.spec.ts` con banderas 5/5 y el harness del shell privado 2/2.
