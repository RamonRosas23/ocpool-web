# OCPOOL Premium Quality Specification

**Date:** 2026-08-29  
**Scope:** Primera ronda de implementación posterior al mega-análisis  
**Estado:** Aprobada para ejecución

## Objetivo

Elevar la landing de OCPOOL a un nivel premium medible sin perder su identidad: narrativa arquitectónica, sensación de agua y materia, fotografía como protagonista, contacto directo y rendimiento sobrio. La prioridad es que la web se perciba refinada y, al mismo tiempo, sea robusta para teclado, móvil, lectores de pantalla, buscadores y mantenimiento futuro.

## Principios de diseño

- Mantener la paleta, tipografías y tono editorial existentes; pulir jerarquía, ritmo y estados.
- Usar animación con intención: entrada, continuidad espacial y feedback; no convertir la página en una demostración de efectos.
- Preferir CSS para microinteracciones sencillas y reservar Motion para transiciones con estado real, especialmente el diálogo de proyectos.
- Respetar `prefers-reduced-motion` y no bloquear la navegación ni el scroll nativo.
- Mantener una única fuente de verdad para proyectos, servicios, proceso y contacto.
- No inventar testimonios, métricas comerciales, certificaciones ni datos de contacto.

## Alcance de esta ronda

### P0 — Calidad funcional y accesibilidad

1. El menú móvil debe cerrarse con `Escape`, clic fuera y navegación por enlace; debe devolver el foco al botón disparador.
2. El diálogo de proyecto debe vivir fuera de los contextos de apilamiento de la sección, bloquear el scroll de fondo, devolver el foco al disparador y mantener el foco dentro del diálogo mientras está abierto.
3. Los anclajes deben respetar la cabecera fija en desktop y móvil, dejando el título de la sección visible.
4. El consentimiento del formulario debe validarse también en servidor; el cliente no puede ser la única barrera.
5. El menú móvil debe tener fondo opaco y estados de foco/hover consistentes.
6. El contenido útil no debe estar oculto para tecnologías de asistencia mediante `aria-hidden` incorrecto.

### P1 — SEO técnico y descubribilidad

1. Completar metadata base, canonical, Open Graph y Twitter/X card.
2. Añadir `robots.txt` y `sitemap.xml` generados por Next.
3. Añadir JSON-LD de negocio local/servicio con datos existentes y seguros.
4. Mantener idioma español, título descriptivo y descripción orientada a intención real.

### P1 — Pulido visual y movimiento

1. Integrar Motion de forma selectiva para la apertura/cierre del diálogo y continuidad de layout donde aporte valor.
2. Evitar animaciones que dejen contenido importante inicialmente invisible en capturas completas, lectores o estados de carga.
3. Afinar breakpoints para que la navegación no quede comprimida alrededor de tablet.
4. Mantener estados focus-visible claramente perceptibles y controles con nombres accesibles.

### P1 — Rendimiento y mantenibilidad

1. Añadir pruebas automatizadas de contrato, interacción, accesibilidad y rutas SEO.
2. Medir overflow horizontal, errores de consola, comportamiento en 360/390/768/1440 px y build de producción.
3. Mantener imágenes bajo el control de `next/image`; revisar prioridades de carga y duplicación del hero.
4. Dejar una ruta reproducible para analizar bundle y una política explícita de dependencias, sin introducir librerías ornamentales.

## Dependencias aprobadas

- `motion`: transiciones de UI con estado y respeto a reduced motion.
- `@playwright/test`: pruebas de navegador reproducibles.
- `@axe-core/playwright`: auditoría automatizada de accesibilidad.
- `@next/bundle-analyzer`: análisis bajo demanda del bundle, sin coste en runtime.

No se instalará Lenis en esta ronda: el scroll nativo ofrece mejor accesibilidad, anclajes más previsibles y menor superficie de regresión para esta landing.

## Criterios de aceptación

- `npm run lint` termina con código 0.
- `npm run test:content` termina con código 0.
- `npm run test:e2e` termina con código 0, incluyendo Chromium configurado para el proyecto.
- `npm run build` termina con código 0.
- Axe no reporta incidencias de impacto `critical` o `serious` en la página, menú móvil ni diálogo.
- El clic en “Cotizar” deja el encabezado del contacto debajo de la cabecera fija, no oculto.
- `Escape` y clic fuera cierran menú y diálogo; el foco queda en un control lógico.
- No existe overflow horizontal en 360, 390, 768 ni 1440 px.
- `/robots.txt` y `/sitemap.xml` responden correctamente y apuntan al dominio canónico.
- No aparecen errores de consola en los flujos cubiertos.
- El formulario rechaza en servidor cualquier envío sin aceptación explícita de términos; los datos inválidos siguen devolviendo 400.
- La implementación no modifica ni elimina los originales fotográficos.

## Fuera de alcance

- Cambios de copy que alteren afirmaciones comerciales.
- Backend de envío real, CRM, almacenamiento de leads o envío de correo SMTP.
- Rediseño completo de marca, logotipo o selección fotográfica.
- Lenis, GSAP u otra segunda capa de animación redundante.
- Actualización mayor de Next/React sin una ronda separada de compatibilidad.

## Riesgos controlados

- Las animaciones deben degradar a una página completamente usable si Motion o scroll-linked CSS no están disponibles.
- El diálogo debe seguir siendo operable si falla la animación.
- Las pruebas no enviarán información personal real ni ejecutarán el mailto.
- Los cambios de dependencias se verificarán con lint, pruebas y build; `npm audit fix` automático no forma parte del plan.
