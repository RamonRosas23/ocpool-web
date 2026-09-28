# Selects del formulario de cotización (landing)

Fecha: 2026-09-28 · Rama: `catalog-ux-redesign` · Pedido explícito del responsable de producto
(registrado en `landing-freeze.md`, "Cambios autorizados").

## Problema

Los cuatro campos de selección del formulario público (tipo de obra, etapa del proyecto, horizonte de
inicio y rango de inversión) eran `<select>` nativos: el panel que abre cada sistema operativo rompe la
estética editorial de la landing.

## Qué se construye

- `src/components/ui/select.tsx`: el Select de **shadcn/ui** (misma anatomía: `Select`,
  `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`,
  `SelectSeparator`, botones de desplazamiento) sobre `@radix-ui/react-select`, que ya era dependencia.
  El pedido decía "shadcn vue", pero el proyecto es React/Next.js: se usa el equivalente de shadcn/ui
  para React, construido sobre el mismo primitivo.
- `QuoteForm` usa un `FormSelect` por campo: etiqueta `<label htmlFor>` que nombra al disparador
  (`combobox`), placeholder "Selecciona una opción", errores con `aria-invalid`/`aria-describedby` y
  el `id` en el disparador para enfocarlo al señalar un error.
- Estilos en `globals.css` (`.ui-select*`): el disparador conserva el trazo subrayado de los demás
  campos (chevron que gira y se vuelve cobre al abrir); el panel sigue el lenguaje de la landing
  (radio de 6 px, sombra azul petróleo, opción resaltada en tono agua, palomita cobre en la elegida),
  con animación de entrada y opciones de 44 px en pantallas táctiles.

## Decisiones

- **Sin Tailwind.** Está instalado pero ninguna hoja lo importa; activarlo metería su reset global y
  cambiaría toda la landing. Los estilos de shadcn se traducen a CSS propio.
- **Disparador subrayado, no en caja.** Así el formulario se lee como un solo sistema junto a los
  campos de texto; la parte "shadcn" visible es el panel y su comportamiento.
- **El encabezado fijo no salta.** Radix bloquea el scroll mientras el select está abierto y quita la
  barra; el encabezado descuenta `--removed-body-scroll-bar-size` (15 px en Windows).
- **Contorno de foco.** La regla global `:focus-visible` de la landing se neutraliza en el select: el
  foco ya se ve en el subrayado cobre y en la opción resaltada.
- **Falla previa corregida.** El botón "Continuar" y "Enviar solicitud" compartían nodo: React le
  cambiaba el tipo a `submit` durante el clic y el formulario se enviaba solo al pasar al paso 2,
  mostrando "Cuéntanos un poco más…" y "Necesitamos tu autorización…" sin que la persona hiciera nada.
  Ahora cada botón tiene su propia `key`.

## Verificación

- Navegador (1440 y 390 px): elegir con ratón y teclado, error de "Tipo de obra" con foco en el
  disparador, paso 2 sin errores, regresar conserva los valores, panel del ancho del disparador, sin
  desbordes, encabezado sin desplazamiento (0 px).
- `quality.spec.ts`: las pruebas del formulario usan el combobox; nueva prueba de teclado (Enter,
  flechas, Espacio, Escape, foco de regreso) con axe sobre el listbox abierto; la página completa se
  audita con los selects cerrados. 35/36 (sólo la falla preexistente de imágenes de la landing).
- `tsc`, lint y 323 pruebas unitarias. `npm run test:content` sigue fallando por la imagen ausente
  `public/proyectos/cdp/gallery/final-01.png` (preexistente, ajena a este cambio).
