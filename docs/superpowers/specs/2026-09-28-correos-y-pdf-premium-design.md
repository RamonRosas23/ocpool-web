# Correos y PDF de cotización con identidad OCPOOL — diseño

Fecha: 2026-09-28 · Estado: aprobado por el responsable ("lo que creas y como creas").

## Objetivo

Que los 12 correos transaccionales y el PDF de cotización se vean serios y profesionales, con el logo y la identidad de ocpool.com.mx, y que el PDF muestre la propuesta comercial completa que el equipo captura.

## Identidad (tomada del sitio público)

| Token | Valor | Uso |
|---|---|---|
| Marino | `#0B2736` | encabezado y pie de correo, botón, título del PDF, total |
| Tinta | `#18252A` | texto |
| Gris | `#5B6770` | texto secundario (contraste 5.8:1 sobre blanco) |
| Marfil | `#F4F1EA` / `#F9F7F2` | fondo del correo, paneles |
| Línea | `#E6E0D4` | filetes |
| Bronce | `#B88A4A` | filetes y acentos decorativos |
| Bronce texto | `#8A6530` | etiquetas pequeñas (contraste 5.3:1) |

Tipografía: Cormorant Garamond (títulos) y Manrope (texto), como el sitio. En correo, Georgia y Arial (los clientes de correo no cargan fuentes web). En el PDF se incrustan las fuentes reales.

Datos de contacto: los de `contactDetails` (correo, teléfono, WhatsApp, sitio). Sin datos fiscales: no se proporcionaron y no se inventan.

## Correos

**Arquitectura.**
- Un módulo nuevo `notifications/email-layout.ts`, con funciones puras.
  - `renderEmailLayout()` arma el documento.
  - Unos pocos bloques: párrafo, panel de datos, cita, nota y botón.
  - Todo el escapado de HTML vive ahí.
- `templates.ts` conserva el texto de cada correo (ya auditado y cubierto por pruebas) y solo compone bloques.
- El contrato de datos no cambia, así que la versión de plantilla sigue siendo `v1`.

**Estructura (HTML con tablas, 600 px, estilos en línea, compatible con Outlook y Gmail):**
1. Texto de vista previa oculto, específico de cada correo.
2. Banda marina con el logo blanco oficial, alojado en `{APP_URL}/brand/email/ocpool-logo-blanco.png`: recortado, a 2x para pantallas retina y con `alt="OCPOOL"`.
3. Filete bronce de 3 px.
4. Tarjeta blanca con:
   - etiqueta superior en bronce y mayúsculas (p. ej. `COTIZACIÓN · OCQ-2026-000123`);
   - título en Georgia;
   - saludo y párrafos;
   - panel de datos (folio, versión, total, tipo, resultado, archivo);
   - cita del mensaje, cuando aplica;
   - botón marino rectangular con texto en mayúsculas espaciadas, como el sitio;
   - enlace alterno;
   - nota de seguridad en los accesos.
5. Firma "Equipo OCPOOL" en los correos a clientes.
6. Pie sobre marfil:
   - Clientes: el aviso actual, más una línea de contacto y el lema.
   - Equipo: "Aviso automático del espacio interno de OCPOOL."
7. `color-scheme: light` para que Apple Mail no invierta los colores. La banda marina se ve bien también en el modo oscuro de Gmail.

Se conservan todas las frases que cubren las pruebas. Una aserción del test de XSS (`not.toContain('<img')`) se precisa para que verifique la etiqueta inyectada y no el logo legítimo.

## PDF de cotización (`quote-pdf-v3`)

**Contenido nuevo en la foto de la versión (`QuotePdfSnapshot`):**
- fecha de emisión (el `now` de la generación, que es determinista);
- persona de contacto del cliente;
- asesor (el responsable del expediente; si no hay, quien creó la versión);
- nombre del impuesto (`taxProfile.name`, p. ej. "IVA 16%");
- secciones con título y descripción;
- partidas con `position`, porcentaje de descuento y base gravable;
- `scopeText`, `exclusionsText`, `paymentTermsText`, `warrantyText` y `publicNotesText`;
- condiciones comerciales de la versión (`termsVersion`).

La descripción de la solicitud solo se usa como alcance cuando `scopeText` está vacío.

**Corrección:** las partidas hoy se ordenan por `id` (UUID, es decir, al azar). Pasan a ordenarse por la posición de su sección y luego por la posición de la partida. Las partidas sin sección van al final.

**Diseño (A4):**
- **Página 1:**
  - banda marina de 8 pt;
  - logo a la izquierda;
  - a la derecha: `COTIZACIÓN`, el folio en Cormorant 24 pt, la versión, la emisión y la vigencia;
  - dos columnas: *Preparada para* (cliente, atención, proyecto, ubicación) y *Emitida por* (OCPOOL, asesor, correo, teléfono, sitio).
- **Tabla "Propuesta económica":**
  - encabezado marino y columnas: #, concepto (nombre y descripción), cantidad con unidad, precio unitario, descuento (solo si alguna partida lo tiene) e importe antes de impuestos;
  - las secciones van como filas marfil con título en Cormorant y su subtotal;
  - el encabezado se repite en cada página.
- **Totales:**
  - subtotal, y descuento y subtotal neto (solo si hay descuento);
  - impuesto con su nombre;
  - **total** en un bloque marino;
  - importe con letra (MXN y USD), p. ej. "Son: dos mil quinientos dos pesos 70/100 M.N.";
  - la moneda de los importes.
- **Bloques de texto:** Alcance, Exclusiones, Condiciones de pago, Garantías y Notas. Respetan párrafos y viñetas (`-`, `•`, `*`, `1.`) y se paginan línea por línea, con el título repetido como "(continuación)".
- **Aceptación:** cómo aceptar o pedir cambios desde el portal.
- **Anexo "Condiciones comerciales":** la versión de términos, convertida de Markdown a texto con títulos y viñetas.
- **En cada página:**
  - pie con lema y contacto, y `Folio · vN · Página X de Y` (se dibuja al final, cuando ya se sabe el total de páginas);
  - en las páginas siguientes a la primera, un encabezado compacto.

**Técnica:**
- **Fuentes:**
  - `@pdf-lib/fontkit` con subconjunto de glifos y `customName`, para que la salida sea determinista.
  - Fuentes en `quote-documents/assets/fonts/`, con sus licencias OFL.
  - El texto se filtra contra la cobertura real de cada fuente, así que un emoji o un símbolo raro se omite en vez de romper la generación (hoy Helvetica falla con caracteres fuera de WinAnsi).
- **Logo:** optimizado para impresión, de unos 40 KB en lugar de 350 KB.
- **Metadatos:** se mantienen título, autor y fechas fijas; la prueba de determinismo sigue aplicando.

## Pruebas

- **Correos:** todas las plantillas se renderizan con logo bajo `appUrl`, texto de vista previa y el pie que corresponde a cada audiencia. El escapado sigue igual y las frases existentes se conservan.
- **PDF:**
  - es determinista;
  - las partidas salen en el orden de sección y posición;
  - no falla con ≥, → ni emoji;
  - pagina bien con muchas partidas y textos largos;
  - el importe con letra y el Markdown simplificado tienen pruebas unitarias.
- **Visual:** se renderizan los 12 correos (escritorio y móvil) y las páginas del PDF a PNG para revisarlos antes de entregar.

## Despliegue

Pasos: `git pull` de la rama, `npm install` (dependencia nueva: `@pdf-lib/fontkit`), `npm run build`, y reiniciar `ocpool-website` y `ocpool-notifications`.

Los PDF ya generados (v2) no cambian; los nuevos salen en v3.

## Fuera de alcance

- Datos fiscales.
- Adjuntar el PDF al correo: el acceso sigue siendo por el portal.
- Seguimiento de aperturas.
