# Correos y PDF de cotización con identidad OCPOOL — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que los 12 correos transaccionales y el PDF de cotización se vean serios y profesionales (logo, paleta y tipografía de ocpool.com.mx), y que el PDF muestre la propuesta comercial completa.

**Architecture:**
- Los correos pasan por un módulo de maquetación puro (`email-layout.ts`) que escapa todo el contenido dinámico; `templates.ts` solo compone bloques.
- El PDF se reescribe como `quote-pdf-v3`:
  - fuentes de la marca incrustadas con `@pdf-lib/fontkit`;
  - un compositor con saltos de página, encabezados repetidos y pie con "Página X de Y";
  - módulos puros para el importe con letra, el texto enriquecido y el orden de las partidas.

**Tech Stack:** TypeScript, Next.js 15, pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, vitest, sharp (solo para generar recursos).

**Spec:** `docs/superpowers/specs/2026-09-28-correos-y-pdf-premium-design.md`

## Global Constraints

**Entorno y copy**
- Se trabaja en `/var/www/ocpool-web-dev` (rama `feat/correos-y-pdf-premium`). Nunca se edita `/var/www/ocpool-web`: es producción.
- Textos en español de México. Se conservan literalmente las frases que cubren las pruebas: "Si el botón no funciona", "la información vigente de tu expediente siempre está en tu portal", "Aviso automático del espacio interno", "primero habilitaremos tu cuenta", "Nuestro equipo habilitará tu cuenta", "aceptarla o pedirnos cambios", "enlace seguro de un solo uso".

**Correos**
- Tablas y estilos en línea, 600 px.
- Solo fuentes Georgia (títulos) y Arial (texto).
- Colores exclusivamente de `brandColors`.
- La versión de plantilla sigue siendo `v1`.

**PDF**
- A4.
- Salida determinista: la misma foto produce los mismos bytes.
- `QUOTE_PDF_TEMPLATE_VERSION = 'quote-pdf-v3'`.

**Datos de contacto**
- Siempre desde `src/lib/brand.ts`.
- Sin datos fiscales.

**Calidad**
- Node 20.
- Deben pasar `npm run typecheck`, `npm run lint` y `npx vitest run tests/unit`.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/brand.ts` (nuevo) | Contacto, lema y paleta de la marca |
| `src/lib/pool-content.ts` | `contactDetails` pasa a ser `brandContact` |
| `scripts/generate-brand-assets.mjs` (nuevo) | Regenera los logos optimizados |
| `public/brand/email/ocpool-logo-blanco.png` (nuevo) | Logo del encabezado de correo (264×223) |
| `src/server/modules/quote-documents/assets/ocpool-logo-print.png` (nuevo) | Logo del PDF (640×541) |
| `src/server/modules/quote-documents/assets/fonts/*` (nuevo) | Cormorant Garamond SemiBold, Manrope Regular/SemiBold/Bold y licencias OFL |
| `src/server/modules/notifications/email-layout.ts` (nuevo) | HTML de correo: `html`, bloques y `renderEmailLayout` |
| `src/server/modules/notifications/templates.ts` | Composición de los 12 correos |
| `src/server/modules/quote-documents/amount-in-words.ts` (nuevo) | Importe con letra (MXN/USD) |
| `src/server/modules/quote-documents/rich-text.ts` (nuevo) | Texto libre / Markdown a bloques |
| `src/server/modules/quote-documents/snapshot-order.ts` (nuevo) | Orden de secciones y partidas |
| `src/server/modules/quote-documents/pdf-theme.ts` (nuevo) | Colores y geometría de página |
| `src/server/modules/quote-documents/pdf-fonts.ts` (nuevo) | Incrustación de fuentes y limpieza por cobertura de glifos |
| `src/server/modules/quote-documents/pdf-text.ts` (nuevo) | Medir, cortar y dibujar texto |
| `src/server/modules/quote-documents/pdf-renderer.ts` | Documento v3 |
| `src/server/modules/quote-documents/service.ts` | Foto enriquecida y ordenada |
| `scripts/render-quote-pdf-fixture.ts` | Muestra realista del PDF |
| `scripts/render-email-previews.ts` (nuevo) | Vista previa HTML de los correos |

---

### Task 1: Identidad compartida, logos optimizados y fuentes

**Files:**
- Create: `src/lib/brand.ts`, `scripts/generate-brand-assets.mjs`, `tests/unit/brand.test.ts`
- Modify: `src/lib/pool-content.ts` (bloque `contactDetails`)
- Create (generados/copiados): `public/brand/email/ocpool-logo-blanco.png`, `src/server/modules/quote-documents/assets/ocpool-logo-print.png`, `src/server/modules/quote-documents/assets/fonts/{CormorantGaramond-SemiBold,Manrope-Regular,Manrope-SemiBold,Manrope-Bold}.ttf`, `OFL-CormorantGaramond.txt`, `OFL-Manrope.txt`
- Modify: `package.json`, `package-lock.json` (`@pdf-lib/fontkit@^1.1.1`)

**Interfaces:**
- Produces: `brandContact` (`email`, `phone`, `phoneHref`, `whatsappHref`, `website`), `brandIdentity` (`name`, `tagline`), `brandColors` (`navy`, `ink`, `muted`, `ivory`, `paper`, `line`, `bronze`, `bronzeText`, `white`) y `brandWebsiteLabel: string` (`'ocpool.com.mx'`).

- [ ] **Step 1: Prueba que falla** — `tests/unit/brand.test.ts`:

```ts
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandContact, brandWebsiteLabel } from '@/lib/brand';
import { contactDetails } from '@/lib/pool-content';

describe('brand identity', () => {
  it('shares one contact source between the site, emails and documents', () => {
    expect(contactDetails).toBe(brandContact);
    expect(brandWebsiteLabel).toBe('ocpool.com.mx');
  });

  it('ships optimized logos and the embedded fonts with their licenses', () => {
    const files: ReadonlyArray<readonly [string, number]> = [
      ['public/brand/email/ocpool-logo-blanco.png', 40_000],
      ['src/server/modules/quote-documents/assets/ocpool-logo-print.png', 90_000],
      ['src/server/modules/quote-documents/assets/fonts/CormorantGaramond-SemiBold.ttf', 400_000],
      ['src/server/modules/quote-documents/assets/fonts/Manrope-Regular.ttf', 200_000],
      ['src/server/modules/quote-documents/assets/fonts/Manrope-SemiBold.ttf', 200_000],
      ['src/server/modules/quote-documents/assets/fonts/Manrope-Bold.ttf', 200_000],
      ['src/server/modules/quote-documents/assets/fonts/OFL-CormorantGaramond.txt', 10_000],
      ['src/server/modules/quote-documents/assets/fonts/OFL-Manrope.txt', 10_000],
    ];
    for (const [file, maxBytes] of files) {
      const absolute = path.resolve(process.cwd(), file);
      expect(existsSync(absolute), file).toBe(true);
      expect(statSync(absolute).size, file).toBeLessThan(maxBytes);
    }
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/brand.test.ts` → FAIL (no existe `@/lib/brand`).

- [ ] **Step 3: `src/lib/brand.ts`**

```ts
/**
 * Identidad de OCPOOL compartida por el sitio, los correos y los documentos: una sola fuente para el
 * contacto, el lema y la paleta, para que un cambio de teléfono no deje desactualizado un correo o un PDF.
 */
export const brandContact = {
  email: 'contacto@ocpool.com.mx',
  phone: '667 453 2567',
  phoneHref: 'tel:+526674532567',
  whatsappHref: 'https://wa.me/526674532567',
  website: 'https://ocpool.com.mx',
} as const;

export const brandIdentity = {
  name: 'OCPOOL',
  tagline: 'Diseño, obra y sistemas coordinados.',
} as const;

/**
 * Paleta del sitio público: marino, marfil y bronce. `bronzeText` es el bronce oscurecido para
 * etiquetas pequeñas (5.3:1 sobre blanco); `bronze` queda para filetes y acentos.
 */
export const brandColors = {
  navy: '#0B2736',
  ink: '#18252A',
  muted: '#5B6770',
  ivory: '#F4F1EA',
  paper: '#F9F7F2',
  line: '#E6E0D4',
  bronze: '#B88A4A',
  bronzeText: '#8A6530',
  white: '#FFFFFF',
} as const;

/** El sitio sin protocolo ("ocpool.com.mx"), como se escribe en un pie de página. */
export const brandWebsiteLabel = new URL(brandContact.website).host;
```

- [ ] **Step 4:** en `src/lib/pool-content.ts`, añadir al inicio `import { brandContact } from '@/lib/brand';` y reemplazar el objeto literal `contactDetails` por:

```ts
export const contactDetails = brandContact;
```

- [ ] **Step 5: `scripts/generate-brand-assets.mjs`**

```js
// Regenera los logos optimizados del correo y del PDF a partir de los originales de public/brand.
// Uso: node scripts/generate-brand-assets.mjs (necesita `sharp`, que ya instala Next.js).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outputs = [
  // Encabezado marino del correo: logo blanco a 2x de 132 px.
  { source: 'public/brand/ocpool-logo-white.png', target: 'public/brand/email/ocpool-logo-blanco.png', width: 264 },
  // PDF: logo a color, con resolución de sobra para impresión a 96 pt de ancho.
  { source: 'public/brand/ocpool-logo.png', target: 'src/server/modules/quote-documents/assets/ocpool-logo-print.png', width: 640 },
];

for (const output of outputs) {
  const target = path.join(root, output.target);
  await mkdir(path.dirname(target), { recursive: true });
  const info = await sharp(path.join(root, output.source))
    .trim()
    .resize({ width: output.width })
    .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 })
    .toFile(target);
  console.log(`${output.target}: ${info.width}x${info.height}, ${info.size} bytes`);
}
```

- [ ] **Step 6:** generar logos, copiar fuentes e instalar fontkit:

```bash
node scripts/generate-brand-assets.mjs
mkdir -p src/server/modules/quote-documents/assets/fonts
cp $SCRATCH/fonts/{CormorantGaramond-SemiBold,Manrope-Regular,Manrope-SemiBold,Manrope-Bold}.ttf $SCRATCH/fonts/OFL-*.txt src/server/modules/quote-documents/assets/fonts/
npm install @pdf-lib/fontkit@^1.1.1
```

Esperado: `public/brand/email/ocpool-logo-blanco.png: 264x223, ~13000 bytes` y `...ocpool-logo-print.png: 640x541, ~48000 bytes`.

- [ ] **Step 7:** `npx vitest run tests/unit/brand.test.ts` → PASS.
- [ ] **Step 8: Commit** — `git add -A src/lib/brand.ts src/lib/pool-content.ts scripts/generate-brand-assets.mjs public/brand/email src/server/modules/quote-documents/assets tests/unit/brand.test.ts package.json package-lock.json && git commit -m "feat: identidad de marca compartida, logos optimizados y fuentes para el PDF"`

---

### Task 2: Maquetación de correo (`email-layout.ts`)

**Files:**
- Create: `src/server/modules/notifications/email-layout.ts`, `tests/unit/email-layout.test.ts`

**Interfaces:**
- Consumes: `brandColors`, `brandContact`, `brandIdentity`, `brandWebsiteLabel` (Task 1).
- Produces:
  - Tipos: `SafeHtml`, `EmailAudience = 'customer' | 'staff'`, `EmailDetail = { label; value; emphasis? }`, `EmailBlock`, `EmailLayoutInput`.
  - `escapeHtml(value: string): string`
  - `html(strings, ...values: (string | number | SafeHtml)[]): SafeHtml`
  - `strong(value: string): SafeHtml`
  - `paragraph(content: SafeHtml | string): EmailBlock`
  - `details(rows: readonly EmailDetail[]): EmailBlock`
  - `quote(text: string): EmailBlock`
  - `emailLogoUrl(appUrl: string): string`
  - `renderEmailLayout(input: EmailLayoutInput): string`
  - Constantes: `CUSTOMER_EMAIL_FOOTER`, `STAFF_EMAIL_FOOTER`.

- [ ] **Step 1: Prueba que falla** — `tests/unit/email-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { details, emailLogoUrl, html, paragraph, quote, renderEmailLayout, strong } from '@/server/modules/notifications/email-layout';

const base = {
  audience: 'customer' as const,
  appUrl: 'https://ocpool.com.mx',
  preheader: 'Vista previa',
  eyebrow: 'Cotización',
  title: 'Cotización disponible',
  greeting: 'Hola Ana,',
  blocks: [],
  action: { label: 'Revisar cotización', url: 'https://ocpool.com.mx/portal?a=1&b=2' },
};

describe('email layout', () => {
  it('escapes interpolated values but keeps trusted fragments', () => {
    const fragment = html`Hola ${'<b>Ana</b>'} ${strong('Ventas & Gerencia')}`;
    expect(fragment.value).toBe('Hola &lt;b&gt;Ana&lt;/b&gt; <strong style="color:#0B2736;font-weight:700;">Ventas &amp; Gerencia</strong>');
  });

  it('builds the logo URL from the application origin', () => {
    expect(emailLogoUrl('https://ocpool.com.mx')).toBe('https://ocpool.com.mx/brand/email/ocpool-logo-blanco.png');
    expect(emailLogoUrl('http://localhost:3000/')).toBe('http://localhost:3000/brand/email/ocpool-logo-blanco.png');
  });

  it('renders a branded, table-based document for customers', () => {
    const output = renderEmailLayout({ ...base, blocks: [paragraph('Texto'), details([{ label: 'Folio', value: 'OCQ-2026-000001' }, { label: 'Total', value: '1,250.00 MXN', emphasis: true }])] });
    expect(output.startsWith('<!doctype html>')).toBe(true);
    expect(output).toContain('role="presentation"');
    expect(output).toContain('src="https://ocpool.com.mx/brand/email/ocpool-logo-blanco.png"');
    expect(output).toContain('alt="OCPOOL"');
    expect(output).toContain('Vista previa');
    expect(output).toContain('href="https://ocpool.com.mx/portal?a=1&amp;b=2"');
    expect(output).toContain('Si el botón no funciona');
    expect(output).toContain('OCQ-2026-000001');
    expect(output).toContain('Equipo OCPOOL');
    expect(output).toContain('la información vigente de tu expediente siempre está en tu portal');
    expect(output).toContain('mailto:contacto@ocpool.com.mx');
    expect(output).not.toContain('Espacio interno');
  });

  it('marks staff emails as internal and drops the customer footer and signature', () => {
    const output = renderEmailLayout({ ...base, audience: 'staff', securityNote: 'No reenvíes este correo.' });
    expect(output).toContain('Espacio interno');
    expect(output).toContain('Aviso automático del espacio interno de OCPOOL.');
    expect(output).toContain('No reenvíes este correo.');
    expect(output).not.toContain('Equipo OCPOOL');
    expect(output).not.toContain('tu expediente');
  });

  it('escapes every dynamic field and keeps message line breaks', () => {
    const output = renderEmailLayout({ ...base, title: '<script>x</script>', greeting: 'Hola <i>Ana</i>,', preheader: '"><img src=x>', eyebrow: '<b>', blocks: [quote('Línea 1\n<script>alert(1)</script>')] });
    expect(output).not.toContain('<script>');
    expect(output).not.toContain('<img src=x');
    expect(output).not.toContain('<i>Ana</i>');
    expect(output).toContain('Línea 1<br>&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('skips an empty details panel', () => {
    const output = renderEmailLayout({ ...base, blocks: [details([])] });
    expect(output).not.toContain(`background-color:#F9F7F2;border:1px solid #E6E0D4;`);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/email-layout.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: `src/server/modules/notifications/email-layout.ts`**

```ts
import { brandColors, brandContact, brandIdentity, brandWebsiteLabel } from '@/lib/brand';

/**
 * Marco visual de los correos de OCPOOL. HTML con tablas y estilos en línea (lo único que respetan
 * Outlook y Gmail), con la paleta y el logo del sitio, y un pie distinto para clientes y para el equipo.
 * Todo texto dinámico se escapa aquí: las plantillas componen bloques, nunca concatenan HTML crudo.
 */

const SAFE_HTML = Symbol('ocpool.safe-html');

/** Fragmento de HTML ya escapado; sólo lo producen `html`, `strong` y los bloques de este módulo. */
export type SafeHtml = Readonly<{ [SAFE_HTML]: true; value: string }>;
type HtmlValue = string | number | SafeHtml;

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function isSafeHtml(value: unknown): value is SafeHtml {
  return typeof value === 'object' && value !== null && SAFE_HTML in value;
}

/** Plantilla etiquetada: interpola escapando todo lo que no sea `SafeHtml`. */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): SafeHtml {
  let output = strings[0] ?? '';
  values.forEach((value, index) => {
    output += (isSafeHtml(value) ? value.value : escapeHtml(String(value))) + (strings[index + 1] ?? '');
  });
  return { [SAFE_HTML]: true, value: output };
}

const C = brandColors;
const FONT_SANS = 'Arial,Helvetica,sans-serif';
const FONT_SERIF = "Georgia,'Times New Roman',Times,serif";

/** Énfasis dentro de un párrafo: nombres de archivo, roles, resultados. */
export function strong(value: string): SafeHtml {
  return html`<strong style="color:${C.navy};font-weight:700;">${value}</strong>`;
}

export type EmailAudience = 'customer' | 'staff';
export type EmailDetail = Readonly<{ label: string; value: string; emphasis?: boolean }>;
export type EmailBlock =
  | Readonly<{ kind: 'paragraph'; content: SafeHtml }>
  | Readonly<{ kind: 'details'; rows: readonly EmailDetail[] }>
  | Readonly<{ kind: 'quote'; text: string }>;

export function paragraph(content: SafeHtml | string): EmailBlock {
  return { kind: 'paragraph', content: typeof content === 'string' ? html`${content}` : content };
}

export function details(rows: readonly EmailDetail[]): EmailBlock {
  return { kind: 'details', rows };
}

export function quote(text: string): EmailBlock {
  return { kind: 'quote', text };
}

export type EmailLayoutInput = Readonly<{
  audience: EmailAudience;
  appUrl: string;
  /** Texto que Gmail y Apple Mail muestran junto al asunto en la bandeja. */
  preheader: string;
  eyebrow: string;
  title: string;
  greeting: string;
  blocks: readonly EmailBlock[];
  action: Readonly<{ label: string; url: string }>;
  /** Aviso breve junto al enlace alterno (p. ej. "no reenvíes este correo" en los accesos). */
  securityNote?: string;
}>;

export const CUSTOMER_EMAIL_FOOTER = 'Este correo es sólo un aviso: la información vigente de tu expediente siempre está en tu portal de OCPOOL. Si no esperabas este mensaje, puedes ignorarlo.';
export const STAFF_EMAIL_FOOTER = 'Aviso automático del espacio interno de OCPOOL.';

const LOGO_PATH = '/brand/email/ocpool-logo-blanco.png';
const LOGO_WIDTH = 132;
const LOGO_HEIGHT = 112;
// Relleno invisible tras la vista previa: evita que el cliente de correo la complete con el cuerpo.
const PREHEADER_SPACER = '&#847;&zwnj;&nbsp;'.repeat(60);
const RESPONSIVE_CSS = [
  ':root{color-scheme:light;supported-color-schemes:light}',
  'body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}',
  'table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}',
  'img{-ms-interpolation-mode:bicubic}',
  '@media screen and (max-width:620px){.oc-shell{padding:0 0 32px!important}.oc-container{width:100%!important}.oc-pad{padding-left:24px!important;padding-right:24px!important}.oc-title{font-size:26px!important}}',
].join('');

/** Logo servido por la propia aplicación, del mismo origen que los enlaces del correo. */
export function emailLogoUrl(appUrl: string): string {
  return new URL(LOGO_PATH, appUrl).toString();
}

function renderParagraph(content: SafeHtml): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_SANS};font-size:15px;line-height:1.65;color:${C.ink};">${content.value}</p>`;
}

function renderDetails(rows: readonly EmailDetail[]): string {
  if (rows.length === 0) return '';
  const body = rows.map((row, index) => {
    const divider = index < rows.length - 1 ? `border-bottom:1px solid ${C.line};` : '';
    const valueStyle = row.emphasis
      ? `font-family:${FONT_SERIF};font-size:22px;line-height:1.3;font-weight:normal;color:${C.navy};`
      : `font-family:${FONT_SANS};font-size:15px;line-height:1.5;font-weight:700;color:${C.ink};`;
    return `<tr><td style="padding:13px 0;${divider}font-family:${FONT_SANS};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};vertical-align:middle;">${escapeHtml(row.label)}</td>`
      + `<td align="right" style="padding:13px 0 13px 16px;${divider}${valueStyle}text-align:right;vertical-align:middle;">${escapeHtml(row.value)}</td></tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:collapse;background-color:${C.paper};border:1px solid ${C.line};">`
    + `<tr><td style="padding:4px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${body}</table></td></tr></table>`;
}

function renderQuote(text: string): string {
  const content = escapeHtml(text).replace(/\r\n?|\n/gu, '<br>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:collapse;"><tr>`
    + `<td width="3" style="width:3px;background-color:${C.bronze};font-size:0;line-height:0;">&nbsp;</td>`
    + `<td style="padding:18px 22px;background-color:${C.paper};font-family:${FONT_SERIF};font-size:17px;line-height:1.6;font-style:italic;color:${C.ink};">${content}</td>`
    + `</tr></table>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph': return renderParagraph(block.content);
    case 'details': return renderDetails(block.rows);
    case 'quote': return renderQuote(block.text);
  }
}

function renderHeader(input: EmailLayoutInput): string {
  const internal = input.audience === 'staff'
    ? `<p style="margin:16px 0 0;font-family:${FONT_SANS};font-size:10px;line-height:1.4;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${C.bronze};">Espacio interno</p>`
    : '';
  const logo = `<img src="${escapeHtml(emailLogoUrl(input.appUrl))}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="${brandIdentity.name}" style="display:block;margin:0 auto;width:${LOGO_WIDTH}px;max-width:${LOGO_WIDTH}px;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT_SERIF};font-size:26px;letter-spacing:4px;color:${C.ivory};">`;
  return `<tr><td align="center" bgcolor="${C.navy}" style="background-color:${C.navy};padding:32px 24px 28px;"><a href="${brandContact.website}" target="_blank" rel="noopener" style="text-decoration:none;">${logo}</a>${internal}</td></tr>`
    + `<tr><td height="3" style="height:3px;font-size:0;line-height:0;background-color:${C.bronze};">&nbsp;</td></tr>`;
}

function renderButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 0;border-collapse:collapse;"><tr>`
    + `<td align="center" bgcolor="${C.navy}" style="background-color:${C.navy};mso-padding-alt:16px 32px;">`
    + `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 32px;font-family:${FONT_SANS};font-size:13px;line-height:1.2;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.white};text-decoration:none;">${escapeHtml(label)}</a>`
    + `</td></tr></table>`;
}

const SIGNATURE = `<p style="margin:32px 0 0;font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:${C.ink};">Atentamente,<br>`
  + `<span style="font-family:${FONT_SERIF};font-size:19px;line-height:1.6;color:${C.navy};">Equipo ${brandIdentity.name}</span></p>`;

function renderSmallPrint(url: string, securityNote: string | undefined): string {
  const note = securityNote
    ? `<p style="margin:0 0 12px;font-family:${FONT_SANS};font-size:13px;line-height:1.6;color:${C.muted};">${escapeHtml(securityNote)}</p>`
    : '';
  return `<tr><td class="oc-pad" style="padding:0 48px 36px;background-color:${C.white};border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-bottom:1px solid ${C.line};">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="padding-top:22px;border-top:1px solid ${C.line};">${note}`
    + `<p style="margin:0;font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:${C.muted};">Si el botón no funciona, copia este enlace en tu navegador:<br>`
    + `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${C.navy};text-decoration:underline;word-break:break-all;">${escapeHtml(url)}</a></p>`
    + `</td></tr></table></td></tr>`;
}

function renderFooter(audience: EmailAudience): string {
  const link = `color:${C.navy};text-decoration:none;`;
  if (audience === 'staff') {
    return `<tr><td align="center" style="padding:26px 32px 0;font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:${C.muted};">${escapeHtml(STAFF_EMAIL_FOOTER)}</td></tr>`
      + `<tr><td align="center" style="padding:12px 32px 0;font-family:${FONT_SERIF};font-size:13px;line-height:1.4;letter-spacing:4px;color:${C.navy};">${brandIdentity.name}</td></tr>`;
  }
  const separator = '&nbsp;&nbsp;&middot;&nbsp;&nbsp;';
  return `<tr><td align="center" style="padding:28px 40px 0;font-family:${FONT_SANS};font-size:12px;line-height:1.65;color:${C.muted};">${escapeHtml(CUSTOMER_EMAIL_FOOTER)}</td></tr>`
    + `<tr><td align="center" style="padding:16px 24px 0;font-family:${FONT_SANS};font-size:12px;line-height:1.8;color:${C.muted};">`
    + `<a href="mailto:${brandContact.email}" style="${link}">${brandContact.email}</a>${separator}`
    + `<a href="${brandContact.phoneHref}" style="${link}">${brandContact.phone}</a>${separator}`
    + `<a href="${brandContact.whatsappHref}" target="_blank" rel="noopener" style="${link}">WhatsApp</a>${separator}`
    + `<a href="${brandContact.website}" target="_blank" rel="noopener" style="${link}">${brandWebsiteLabel}</a></td></tr>`
    + `<tr><td align="center" style="padding:20px 32px 0;"><p style="margin:0;font-family:${FONT_SERIF};font-size:14px;line-height:1.4;letter-spacing:4px;color:${C.navy};">${brandIdentity.name}</p>`
    + `<p style="margin:4px 0 0;font-family:${FONT_SERIF};font-size:14px;line-height:1.4;font-style:italic;color:${C.muted};">${escapeHtml(brandIdentity.tagline)}</p></td></tr>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const preheader = escapeHtml(input.preheader.replace(/\s+/gu, ' ').trim());
  return [
    '<!doctype html>',
    '<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(input.title)}</title>`,
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->',
    `<style>${RESPONSIVE_CSS}</style>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${C.ivory};">`,
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.ivory};">${preheader}${PREHEADER_SPACER}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${C.ivory};"><tr><td class="oc-shell" align="center" style="padding:32px 12px 40px;">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    `<table role="presentation" class="oc-container" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:600px;max-width:600px;">`,
    renderHeader(input),
    `<tr><td class="oc-pad" style="padding:44px 48px 32px;background-color:${C.white};border-left:1px solid ${C.line};border-right:1px solid ${C.line};">`,
    `<p style="margin:0 0 14px;font-family:${FONT_SANS};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.bronzeText};">${escapeHtml(input.eyebrow)}</p>`,
    `<h1 class="oc-title" style="margin:0 0 24px;font-family:${FONT_SERIF};font-size:30px;line-height:1.2;font-weight:normal;color:${C.navy};">${escapeHtml(input.title)}</h1>`,
    `<p style="margin:0 0 16px;font-family:${FONT_SANS};font-size:15px;line-height:1.65;color:${C.ink};">${escapeHtml(input.greeting)}</p>`,
    input.blocks.map(renderBlock).join(''),
    renderButton(input.action.label, input.action.url),
    input.audience === 'customer' ? SIGNATURE : '',
    '</td></tr>',
    renderSmallPrint(input.action.url, input.securityNote),
    renderFooter(input.audience),
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ].join('\n');
}
```

- [ ] **Step 4:** `npx vitest run tests/unit/email-layout.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/server/modules/notifications/email-layout.ts tests/unit/email-layout.test.ts && git commit -m "feat(correos): maquetación con tablas, logo, vista previa y pie por audiencia"`

---

### Task 3: Los 12 correos sobre la nueva maquetación

**Files:**
- Modify: `src/server/modules/notifications/templates.ts:311-485` (de `CONTROL_CHARACTERS` al final)
- Modify: `tests/unit/notifications-templates.test.ts:262` y agregar pruebas nuevas

**Interfaces:**
- Consumes: todo lo de Task 2, más `brandContact`, `brandIdentity` y `brandWebsiteLabel`.
- Produces: `renderNotificationTemplate` con la misma firma y el mismo tipo de retorno (`{ subject, text, html }`).

- [ ] **Step 1: Pruebas nuevas y ajustadas.**
  - En `escapes dynamic HTML and preserves a text alternative`, cambiar `expect(rendered.html).not.toContain('<img');` por `expect(rendered.html).not.toContain('<img src=x');`. El logo legítimo es un `<img>`; lo que no debe aparecer es la etiqueta inyectada.
  - Agregar al final del `describe`:

```ts
  it('brands every email with the hosted logo, a preview text and the audience footer', () => {
    const customer = renderNotificationTemplate({ templateKey: 'quote.version_sent', templateVersion: 'v1', data: { appUrl: 'https://ocpool.com.mx', recipientName: 'Ana', folio: 'OCQ-2026-000001', actionUrl: 'https://ocpool.com.mx/portal' } });
    expect(customer.html).toContain('src="https://ocpool.com.mx/brand/email/ocpool-logo-blanco.png"');
    expect(customer.html).toContain('La cotización OCQ-2026-000001 está lista para tu revisión.');
    expect(customer.html).toContain('Equipo OCPOOL');
    expect(customer.html).toContain('mailto:contacto@ocpool.com.mx');
    expect(customer.text).toContain('contacto@ocpool.com.mx · 667 453 2567 · ocpool.com.mx');

    const staff = renderNotificationTemplate({ templateKey: 'request.assigned', templateVersion: 'v1', data: { appUrl: 'https://ocpool.com.mx', recipientName: 'Laura', folio: 'OCQ-2026-000001', actionUrl: 'https://ocpool.com.mx/staff/requests' } });
    expect(staff.html).toContain('Espacio interno');
    expect(staff.html).not.toContain('Equipo OCPOOL');
    expect(staff.text).toContain('Aviso automático del espacio interno de OCPOOL.');
  });

  it('writes the approval version once instead of "versión versión"', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'quote.approval_requested', templateVersion: 'v1', data: { appUrl: 'http://localhost:3000', recipientName: 'Gerencia', folio: 'OCQ-2026-000003', versionNumber: 2, approvalType: 'DISCOUNT', actionUrl: 'http://localhost:3000/staff/quotes' } });
    expect(rendered.html).toContain('La versión 2 de la cotización OCQ-2026-000003 requiere tu aprobación de descuento');
    expect(rendered.html).not.toContain('versión versión');
  });

  it('signs a client reply with the client name, not with the team name', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'message.created', templateVersion: 'v1', data: { appUrl: 'http://localhost:3000', recipientName: 'Laura', folio: 'OCQ-2026-000001', preview: 'Hola', actionUrl: 'http://localhost:3000/staff/requests' } });
    expect(rendered.html).toContain('El cliente respondió en el expediente OCQ-2026-000001:');
    expect(rendered.html).not.toContain('Tu equipo OCPOOL respondió');
  });
```

- [ ] **Step 2:** `npx vitest run tests/unit/notifications-templates.test.ts` → las 3 pruebas nuevas FALLAN.

- [ ] **Step 3: Reescribir la parte de render de `templates.ts`.**
  - Agregar los imports:

```ts
import { brandContact, brandIdentity, brandWebsiteLabel } from '@/lib/brand';
import { details, html, paragraph, quote, renderEmailLayout, strong, type EmailAudience, type EmailBlock, type EmailDetail } from '@/server/modules/notifications/email-layout';
```

  - Borrar las funciones locales `escapeHtml`, `type EmailAudience` y `layout(...)`.
  - Conservar `CONTROL_CHARACTERS`, `ALLOWED_PATHS`, `safeHeader`, `allowedPath`, `buildNotificationUrl`, `validateActionUrl` y `expiresLabel`.
  - Reemplazar `renderNotificationTemplate` completo por:

```ts
const APPROVAL_TYPE_LABELS: Readonly<Record<string, string>> = { DISCOUNT: 'descuento', SPECIAL_CONCEPT: 'concepto especial' };

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Vista previa de bandeja: un renglón, sin cortar a media palabra si se puede evitar. */
function previewLine(value: string, maximum = 140): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  if (flat.length <= maximum) return flat;
  const cut = flat.slice(0, maximum - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maximum * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Pie del texto plano: el mismo contacto que el HTML, para quien lee el correo sin formato. */
function textFooter(audience: EmailAudience): string {
  return audience === 'staff'
    ? '\n\n—\nAviso automático del espacio interno de OCPOOL.'
    : `\n\n—\n${brandIdentity.name} · ${brandIdentity.tagline}\n${brandContact.email} · ${brandContact.phone} · ${brandWebsiteLabel}`;
}

type EmailContent = Readonly<{
  audience: EmailAudience;
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  blocks: readonly EmailBlock[];
  actionLabel: string;
  text: string;
  securityNote?: string;
}>;

export function renderNotificationTemplate(input: RenderNotificationTemplateInput): RenderedNotificationTemplate {
  if (input.templateVersion !== 'v1') throw new Error('Unsupported notification template version.');
  const data = input.data;
  const actionUrl = validateActionUrl(data.appUrl, data.actionUrl);
  const folio = data.folio ? safeHeader(data.folio) : '';
  const version = data.versionNumber ? ` versión ${data.versionNumber}` : '';
  const approvalType = APPROVAL_TYPE_LABELS[data.approvalType ?? ''] ?? 'ajuste de precio';
  const preview = data.preview ?? '';
  const portalAccessPending = new URL(actionUrl).pathname === '/portal/access';
  // Un mismo evento (p. ej. un mensaje) puede ir al cliente o al equipo; el destino lo distingue.
  const staffAudience = new URL(actionUrl).pathname.startsWith('/staff');
  const folioRows: EmailDetail[] = folio ? [{ label: 'Folio', value: folio }] : [];
  const versionRows: EmailDetail[] = data.versionNumber ? [{ label: 'Versión', value: String(data.versionNumber) }] : [];
  const totalRows: EmailDetail[] = data.totalLabel ? [{ label: 'Total', value: data.totalLabel, emphasis: /\d/u.test(data.totalLabel) }] : [];

  const compose = (content: EmailContent): RenderedNotificationTemplate => ({
    subject: content.subject,
    text: `${content.text}${textFooter(content.audience)}`,
    html: renderEmailLayout({
      audience: content.audience,
      appUrl: data.appUrl,
      preheader: previewLine(content.preheader),
      eyebrow: content.eyebrow,
      title: content.title,
      greeting: `Hola ${data.recipientName},`,
      blocks: content.blocks,
      action: { label: content.actionLabel, url: actionUrl },
      ...(content.securityNote ? { securityNote: content.securityNote } : {}),
    }),
  });

  switch (input.templateKey) {
    case 'auth.customer.magic_link': {
      const expires = data.expiresMinutes ?? 15;
      return compose({
        audience: 'customer',
        subject: 'Tu acceso seguro a OCPOOL',
        preheader: `Tu enlace personal para entrar al portal. Vence en ${expires} minutos.`,
        eyebrow: 'Acceso seguro',
        title: 'Accede a tu portal',
        blocks: [paragraph(`Usa este enlace para entrar de forma segura a tu portal. Expira en ${expires} minutos y sólo puede utilizarse una vez.`)],
        actionLabel: 'Entrar al portal',
        securityNote: 'Por tu seguridad, no reenvíes este correo: el enlace da acceso a tu expediente.',
        text: `Hola ${data.recipientName},\n\nAccede a tu portal de OCPOOL: ${actionUrl}\n\nEl enlace expira en ${expires} minutos y sólo puede utilizarse una vez.`,
      });
    }
    case 'auth.employee.password_reset': {
      const expires = expiresLabel(data.expiresMinutes ?? 15);
      // Neutral: la recuperación la puede pedir la propia persona o gerencia desde Equipo.
      return compose({
        audience: 'staff',
        subject: 'Restablece tu acceso interno a OCPOOL',
        preheader: `Enlace para restablecer tu contraseña. Vence en ${expires}.`,
        eyebrow: 'Acceso interno',
        title: 'Restablece tu contraseña',
        blocks: [paragraph(`Recibimos una solicitud para restablecer tu acceso interno. El enlace expira en ${expires} y sólo puede utilizarse una vez. Si no la esperabas, ignora este correo: tu contraseña actual sigue igual.`)],
        actionLabel: 'Restablecer acceso',
        securityNote: 'Por tu seguridad, no reenvíes este correo: el enlace da acceso a tu cuenta interna.',
        text: `Hola ${data.recipientName},\n\nRecibimos una solicitud para restablecer tu acceso interno a OCPOOL: ${actionUrl}\n\nEl enlace expira en ${expires} y sólo puede utilizarse una vez. Si no la esperabas, ignora este correo.`,
      });
    }
    case 'auth.employee.invitation': {
      const expires = expiresLabel(data.expiresMinutes ?? 72 * 60);
      const inviter = data.senderName ?? 'El equipo de OCPOOL';
      const role = data.roleLabel ? html` como ${strong(data.roleLabel)}` : html``;
      return compose({
        audience: 'staff',
        subject: 'Te damos la bienvenida al equipo de OCPOOL',
        preheader: `${inviter} te invitó al espacio interno de OCPOOL.`,
        eyebrow: 'Invitación al equipo',
        title: 'Crea tu contraseña',
        blocks: [paragraph(html`${inviter} te invitó al espacio interno de OCPOOL${role}. Crea tu contraseña para entrar; el enlace expira en ${expires} y sólo puede utilizarse una vez.`)],
        actionLabel: 'Crear contraseña',
        securityNote: 'Por tu seguridad, no reenvíes este correo: el enlace es personal.',
        text: `Hola ${data.recipientName},\n\n${inviter} te invitó al espacio interno de OCPOOL${data.roleLabel ? ` como ${data.roleLabel}` : ''}. Crea tu contraseña para entrar: ${actionUrl}\n\nEl enlace expira en ${expires} y sólo puede utilizarse una vez.`,
      });
    }
    case 'request.received': {
      const received = paragraph(html`Tu solicitud ${folio} fue recibida y ya forma parte de tu expediente.`);
      const status = details([...folioRows, { label: 'Estado', value: 'Recibida' }]);
      return compose({
        audience: 'customer',
        subject: safeHeader(`Recibimos tu solicitud ${folio}`),
        preheader: `Tu solicitud ${folio} ya forma parte de tu expediente.`,
        eyebrow: 'Solicitud de cotización',
        title: 'Solicitud recibida',
        blocks: portalAccessPending
          ? [received, status, paragraph('Para consultar avances en línea, solicita acceso al portal. Nuestro equipo habilitará tu cuenta y después recibirás un enlace seguro de un solo uso en este correo.')]
          : [received, status, paragraph('Consulta los avances directamente en tu portal.')],
        actionLabel: data.actionLabel ?? 'Ver expediente',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\nRecibimos tu solicitud ${folio}.\n\nPara consultar avances en línea, solicita acceso al portal: ${actionUrl}\n\nNuestro equipo habilitará tu cuenta y después recibirás un enlace seguro de un solo uso en este correo.`
          : `Hola ${data.recipientName},\n\nRecibimos tu solicitud ${folio}. Consulta el avance en tu portal: ${actionUrl}`,
      });
    }
    case 'request.assigned':
      return compose({
        audience: 'staff',
        subject: safeHeader(`Te asignaron la solicitud ${folio}`),
        preheader: `La solicitud ${folio} ahora está a tu cargo.`,
        eyebrow: 'Asignación',
        title: 'Nueva solicitud a tu cargo',
        blocks: [paragraph(html`La solicitud ${folio} ahora está a tu cargo. Revisa el alcance y define el siguiente paso con el cliente.`), details(folioRows)],
        actionLabel: 'Abrir expediente',
        text: `Hola ${data.recipientName},\n\nLa solicitud ${folio} ahora está a tu cargo. Abre el expediente: ${actionUrl}`,
      });
    case 'quote.version_sent':
      return compose({
        audience: 'customer',
        subject: safeHeader(`Tu cotización ${folio} está disponible`),
        preheader: `La cotización ${folio} está lista para tu revisión.`,
        eyebrow: 'Cotización',
        title: 'Cotización disponible',
        blocks: portalAccessPending
          ? [paragraph(html`La cotización ${folio} ya está disponible para tu expediente.`), details(folioRows), paragraph('Solicita acceso al portal para consultarla. Nuestro equipo habilitará tu cuenta y recibirás un enlace seguro de un solo uso en este correo.')]
          : [paragraph(html`Ya puedes revisar la cotización ${folio} en tu portal: el detalle, los importes y el PDF.`), details(folioRows), paragraph('Desde ahí mismo puedes aceptarla o pedirnos cambios.')],
        actionLabel: data.actionLabel ?? 'Revisar cotización',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\nLa cotización ${folio} ya está disponible para tu expediente. Solicita acceso al portal: ${actionUrl}\n\nNuestro equipo habilitará tu cuenta y recibirás un enlace seguro de un solo uso en este correo.`
          : `Hola ${data.recipientName},\n\nTu cotización ${folio} está disponible en el portal: ${actionUrl}\n\nDesde ahí puedes revisar el PDF, aceptarla o pedirnos cambios.`,
      });
    case 'quote.approval_requested':
      return compose({
        audience: 'staff',
        subject: safeHeader(`Aprobación de ${approvalType} pendiente: ${folio}`),
        preheader: `La cotización ${folio}${version} requiere tu aprobación.`,
        eyebrow: 'Aprobación',
        title: 'Aprobación requerida',
        blocks: [
          paragraph(data.versionNumber
            ? html`La versión ${data.versionNumber} de la cotización ${folio} requiere tu aprobación de ${approvalType} para continuar.`
            : html`La cotización ${folio} requiere tu aprobación de ${approvalType} para continuar.`),
          details([...folioRows, ...versionRows, { label: 'Tipo', value: capitalize(approvalType) }]),
        ],
        actionLabel: data.actionLabel ?? 'Revisar aprobación',
        text: `La cotización ${folio}${version} requiere aprobación de ${approvalType}. Revisa el expediente: ${actionUrl}`,
      });
    case 'quote.approval_resolved': {
      const approved = data.approvalStatus === 'APPROVED';
      const outcome = approved ? 'autorizada' : 'rechazada';
      return compose({
        audience: 'staff',
        subject: safeHeader(`${approved ? 'Aprobación autorizada' : 'Aprobación rechazada'} ${folio}`),
        preheader: `La aprobación de ${approvalType} para ${folio} fue ${outcome}.`,
        eyebrow: 'Aprobación',
        title: approved ? 'Aprobación autorizada' : 'Aprobación rechazada',
        blocks: [
          paragraph(html`La aprobación de ${approvalType} para la cotización ${folio}${version} fue ${strong(outcome)}.`),
          details([...folioRows, ...versionRows, { label: 'Tipo', value: capitalize(approvalType) }, { label: 'Resultado', value: capitalize(outcome) }]),
        ],
        actionLabel: data.actionLabel ?? 'Abrir expediente',
        text: `La aprobación de ${approvalType} para ${folio}${version} fue ${outcome}. Revisa el expediente: ${actionUrl}`,
      });
    }
    case 'quote.accepted':
      return compose({
        audience: 'staff',
        subject: safeHeader(`Cotización ${folio} aceptada`),
        preheader: `El cliente aceptó la cotización ${folio}.`,
        eyebrow: 'Expediente',
        title: 'Cotización aceptada',
        blocks: [
          paragraph(html`El cliente aceptó la cotización ${folio}${version}.`),
          details([...folioRows, ...versionRows, ...totalRows.map((row) => ({ ...row, label: 'Total aceptado' }))]),
          paragraph('Siguiente paso: el arranque. El proyecto se crea automáticamente con la aceptación; ábrelo desde el expediente para confirmar responsable y tareas.'),
        ],
        actionLabel: 'Abrir expediente',
        text: `Hola ${data.recipientName},\n\nEl cliente aceptó la cotización ${folio}${version}.${data.totalLabel ? ` Total aceptado: ${data.totalLabel}.` : ''}\n\nSiguiente paso: el arranque (el proyecto se crea automáticamente). Abre el expediente: ${actionUrl}`,
      });
    case 'quote.acceptance_confirmed':
      // UX audit fix: confirma la aceptación al cliente y explica qué sigue -- ninguna acción
      // pendiente de su parte, el equipo se pondrá en contacto para coordinar el arranque.
      return compose({
        audience: 'customer',
        subject: safeHeader(`Confirmamos la aceptación de tu cotización ${folio}`),
        preheader: `Registramos tu aceptación de la cotización ${folio}.`,
        eyebrow: 'Cotización aceptada',
        title: 'Aceptación confirmada',
        blocks: [
          paragraph(html`Confirmamos que tu aceptación de la cotización ${folio}${version} quedó registrada correctamente.`),
          details([...folioRows, ...versionRows, ...totalRows]),
          paragraph('No necesitas hacer nada más por ahora. Nuestro equipo revisará los detalles y te contactará en tu expediente para coordinar los siguientes pasos.'),
        ],
        actionLabel: data.actionLabel ?? 'Ver mi expediente',
        text: `Hola ${data.recipientName},\n\nConfirmamos que tu aceptación de la cotización ${folio}${version} quedó registrada correctamente.${data.totalLabel ? ` Total: ${data.totalLabel}.` : ''}\n\nNo necesitas hacer nada más por ahora. Nuestro equipo te contactará en tu expediente para coordinar los siguientes pasos.\n\nConsulta tu expediente: ${actionUrl}`,
      });
    case 'message.created': {
      if (staffAudience) {
        // Respuesta del cliente al responsable: antes recibía el texto pensado para el cliente
        // ("dejó un mensaje en tu expediente").
        // El nombre va al encabezado Subject: sin caracteres de control y acotado (safeHeader rechaza > 240).
        const senderForHeader = (data.senderName ?? 'El cliente').replace(/[\u0000-\u001F\u007F]+/gu, ' ').trim() || 'El cliente';
        return compose({
          audience: 'staff',
          subject: safeHeader(`${senderForHeader} respondió en ${folio}`.slice(0, 240)),
          preheader: `${senderForHeader}: ${preview}`,
          eyebrow: 'Mensaje del cliente',
          title: 'El cliente respondió',
          blocks: [paragraph(html`${data.senderName ?? 'El cliente'} respondió en el expediente ${folio}:`), quote(preview)],
          actionLabel: data.actionLabel ?? 'Responder',
          text: `Hola ${data.recipientName},\n\n${data.senderName ?? 'El cliente'} respondió en ${folio}:\n\n${preview}\n\nResponder: ${actionUrl}`,
        });
      }
      const sender = data.senderName ?? 'Tu equipo OCPOOL';
      const intro = paragraph(html`${sender} dejó un mensaje en tu expediente ${folio}:`);
      return compose({
        audience: 'customer',
        subject: safeHeader(`Nuevo mensaje sobre tu expediente ${folio}`),
        preheader: `${sender}: ${preview}`,
        eyebrow: 'Mensaje',
        title: 'Nuevo mensaje',
        blocks: portalAccessPending
          ? [intro, quote(preview), paragraph('Si eres cliente nuevo, primero habilitaremos tu cuenta. Después podrás continuar la conversación en el portal.')]
          : [intro, quote(preview)],
        actionLabel: data.actionLabel ?? 'Leer mensaje',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\n${sender} dejó un mensaje sobre ${folio}:\n\n${preview}\n\nSi eres cliente nuevo, primero habilitaremos tu cuenta. Solicita acceso al portal: ${actionUrl}`
          : `Hola ${data.recipientName},\n\n${sender} dejó un mensaje sobre ${folio}:\n\n${preview}\n\nAbrir mensaje: ${actionUrl}`,
      });
    }
    case 'file.available': {
      const fileName = data.fileName ?? 'Un archivo nuevo';
      const available = paragraph(html`El archivo ${strong(fileName)} ya está disponible en tu expediente ${folio}.`);
      return compose({
        audience: 'customer',
        subject: safeHeader(`Archivo disponible en ${folio}`),
        preheader: `Hay un archivo nuevo en tu expediente ${folio}.`,
        eyebrow: 'Archivo',
        title: 'Archivo disponible',
        blocks: portalAccessPending
          ? [available, paragraph('Si eres cliente nuevo, primero habilitaremos tu cuenta. Después podrás consultar el archivo en el portal.')]
          : [available],
        actionLabel: data.actionLabel ?? 'Ver archivo',
        text: portalAccessPending
          ? `Hola ${data.recipientName},\n\nEl archivo ${fileName} ya está disponible en ${folio}.\n\nSi eres cliente nuevo, primero habilitaremos tu cuenta. Solicita acceso al portal: ${actionUrl}`
          : `Hola ${data.recipientName},\n\nEl archivo ${fileName} ya está disponible en ${folio}.\n\nVer archivo: ${actionUrl}`,
      });
    }
  }
}
```

- [ ] **Step 4:** `npx vitest run tests/unit/notifications-templates.test.ts tests/unit/notifications-worker.test.ts tests/unit/email-layout.test.ts` → PASS.
- [ ] **Step 5: Vista previa** — `scripts/render-email-previews.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { renderNotificationTemplate, type NotificationTemplateData, type NotificationTemplateKey } from '../src/server/modules/notifications/templates';

// Vista previa de todos los correos con datos realistas: output/email-previews/index.html.
const appUrl = process.env.PREVIEW_APP_URL ?? 'https://ocpool.com.mx';
const outputDirectory = 'output/email-previews';
const staffPath = '/staff/requests?request=00000000-0000-4000-8000-000000000001';
const portalPath = '/portal?request=00000000-0000-4000-8000-000000000001';

type PreviewCase = Readonly<{ name: string; templateKey: NotificationTemplateKey; path: string; data?: Partial<NotificationTemplateData> }>;

const cases: PreviewCase[] = [
  { name: 'acceso-cliente', templateKey: 'auth.customer.magic_link', path: '/auth/customer/consume-link?token=muestra', data: { expiresMinutes: 1440 } },
  { name: 'restablecer-contrasena', templateKey: 'auth.employee.password_reset', path: '/auth/recovery?token=muestra', data: { expiresMinutes: 15 } },
  { name: 'invitacion-equipo', templateKey: 'auth.employee.invitation', path: '/auth/recovery?token=muestra&invite=1', data: { expiresMinutes: 4320, senderName: 'Ramón Rosas', roleLabel: 'Ventas' } },
  { name: 'solicitud-recibida', templateKey: 'request.received', path: portalPath },
  { name: 'solicitud-recibida-sin-portal', templateKey: 'request.received', path: '/portal/access', data: { actionLabel: 'Solicitar acceso' } },
  { name: 'solicitud-asignada', templateKey: 'request.assigned', path: staffPath },
  { name: 'cotizacion-disponible', templateKey: 'quote.version_sent', path: portalPath },
  { name: 'aprobacion-requerida', templateKey: 'quote.approval_requested', path: staffPath, data: { approvalType: 'DISCOUNT' } },
  { name: 'aprobacion-autorizada', templateKey: 'quote.approval_resolved', path: staffPath, data: { approvalType: 'SPECIAL_CONCEPT', approvalStatus: 'APPROVED' } },
  { name: 'cotizacion-aceptada-equipo', templateKey: 'quote.accepted', path: staffPath },
  { name: 'aceptacion-confirmada', templateKey: 'quote.acceptance_confirmed', path: portalPath },
  { name: 'mensaje-cliente', templateKey: 'message.created', path: portalPath },
  { name: 'mensaje-equipo', templateKey: 'message.created', path: staffPath, data: { senderName: 'Ana López' } },
  { name: 'archivo-disponible', templateKey: 'file.available', path: portalPath },
];

const base: Omit<NotificationTemplateData, 'actionUrl'> = {
  appUrl,
  recipientName: 'Ana López',
  folio: 'OCQ-2026-001156',
  versionNumber: 2,
  totalLabel: '687,880.00 MXN',
  senderName: 'Laura Méndez · OCPOOL',
  preview: 'Buen día, Ana. Adjuntamos el plano actualizado con la profundidad que comentamos. Si te parece bien, avanzamos con la cotización final esta semana.',
  fileName: 'Plano de alberca v3.pdf',
};

await mkdir(outputDirectory, { recursive: true });
const links: string[] = [];
for (const preview of cases) {
  const rendered = renderNotificationTemplate({ templateKey: preview.templateKey, templateVersion: 'v1', data: { ...base, ...preview.data, actionUrl: new URL(preview.path, appUrl).toString() } });
  await writeFile(`${outputDirectory}/${preview.name}.html`, rendered.html);
  await writeFile(`${outputDirectory}/${preview.name}.txt`, `Asunto: ${rendered.subject}\n\n${rendered.text}\n`);
  links.push(`<li><a href="${preview.name}.html">${preview.name}</a> — ${rendered.subject}</li>`);
}
await writeFile(`${outputDirectory}/index.html`, `<!doctype html><meta charset="utf-8"><title>Correos OCPOOL</title><ul>${links.join('')}</ul>`);
console.log(`${cases.length} correos en ${outputDirectory}/`);
```

Correr `npx tsx scripts/render-email-previews.ts`, capturar cada HTML a 680 px y 390 px con Playwright, revisar las imágenes y ajustar espaciados si hace falta.

- [ ] **Step 6: Commit** — `git add src/server/modules/notifications/templates.ts tests/unit/notifications-templates.test.ts scripts/render-email-previews.ts && git commit -m "feat(correos): los 12 avisos con la identidad de OCPOOL"`

---

### Task 4: Importe con letra, texto enriquecido y orden de partidas (módulos puros)

**Files:**
- Create: `src/server/modules/quote-documents/amount-in-words.ts`, `rich-text.ts`, `snapshot-order.ts`
- Test: `tests/unit/quote-pdf-amount-in-words.test.ts`, `tests/unit/quote-pdf-rich-text.test.ts`, `tests/unit/quote-pdf-snapshot-order.test.ts`

**Interfaces:**
- Produces:
  - `amountInWords(amountMinor: bigint, currencyCode: string): string | null`
  - `integerToSpanishWords(value: bigint): string`
  - `RichTextBlock = heading{level 1|2|3, text} | paragraph{text} | bullet{marker, text}`
  - `parseRichText(input: string | null | undefined): RichTextBlock[]`
  - `orderQuoteSections<T extends { id: string; position: number }>(sections: readonly T[]): T[]`
  - `orderQuoteLines<T extends { id: string; position: number; sectionId: string | null }>(lines: readonly T[], orderedSections: readonly { id: string }[]): T[]`

- [ ] **Step 1: Pruebas que fallan**

`tests/unit/quote-pdf-amount-in-words.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { amountInWords, integerToSpanishWords } from '@/server/modules/quote-documents/amount-in-words';

describe('importe con letra', () => {
  it.each([
    [0n, 'Cero pesos 00/100 M.N.'],
    [100n, 'Un peso 00/100 M.N.'],
    [2_200n, 'Veintidós pesos 00/100 M.N.'],
    [3_100n, 'Treinta y un pesos 00/100 M.N.'],
    [10_000n, 'Cien pesos 00/100 M.N.'],
    [10_100n, 'Ciento un pesos 00/100 M.N.'],
    [100_000n, 'Mil pesos 00/100 M.N.'],
    [250_270n, 'Dos mil quinientos dos pesos 70/100 M.N.'],
    [2_100_000n, 'Veintiún mil pesos 00/100 M.N.'],
    [10_100_000n, 'Ciento un mil pesos 00/100 M.N.'],
    [68_788_000n, 'Seiscientos ochenta y siete mil ochocientos ochenta pesos 00/100 M.N.'],
    [100_000_000n, 'Un millón de pesos 00/100 M.N.'],
    [123_456_789n, 'Un millón doscientos treinta y cuatro mil quinientos sesenta y siete pesos 89/100 M.N.'],
    [2_100_000_000n, 'Veintiún millones de pesos 00/100 M.N.'],
  ])('%s centavos en MXN', (amount, expected) => {
    expect(amountInWords(amount, 'MXN')).toBe(expected);
  });

  it('writes dollars and skips currencies without a wording', () => {
    expect(amountInWords(120_000n, 'USD')).toBe('Mil doscientos dólares 00/100 USD');
    expect(amountInWords(100n, 'usd')).toBe('Un dólar 00/100 USD');
    expect(amountInWords(100n, 'EUR')).toBeNull();
  });

  it('covers the teens, the twenties and thousands of millions', () => {
    expect(integerToSpanishWords(16n)).toBe('dieciséis');
    expect(integerToSpanishWords(26n)).toBe('veintiséis');
    expect(integerToSpanishWords(1_000_000_000n)).toBe('mil millones');
    expect(integerToSpanishWords(501_000n)).toBe('quinientos un mil');
    expect(() => integerToSpanishWords(-1n)).toThrow(RangeError);
  });
});
```

`tests/unit/quote-pdf-rich-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRichText } from '@/server/modules/quote-documents/rich-text';

describe('texto enriquecido de la cotización', () => {
  it('joins wrapped lines into paragraphs and splits on blank lines', () => {
    expect(parseRichText('Primera línea\ncontinúa aquí.\r\n\r\nSegundo párrafo.')).toEqual([
      { kind: 'paragraph', text: 'Primera línea continúa aquí.' },
      { kind: 'paragraph', text: 'Segundo párrafo.' },
    ]);
  });

  it('recognizes bullets, numbered items and headings', () => {
    expect(parseRichText('## 1. Objeto\n- Uno\n* Dos\n• Tres\n1. Anticipo\n2) Entrega\n#### Detalle')).toEqual([
      { kind: 'heading', level: 2, text: '1. Objeto' },
      { kind: 'bullet', marker: '•', text: 'Uno' },
      { kind: 'bullet', marker: '•', text: 'Dos' },
      { kind: 'bullet', marker: '•', text: 'Tres' },
      { kind: 'bullet', marker: '1.', text: 'Anticipo' },
      { kind: 'bullet', marker: '2.', text: 'Entrega' },
      { kind: 'heading', level: 3, text: 'Detalle' },
    ]);
  });

  it('continues an indented bullet and strips inline markdown', () => {
    expect(parseRichText('- Precio **fijo** con `válida hasta`\n  y ajustes [aquí](https://ocpool.com.mx)')).toEqual([
      { kind: 'bullet', marker: '•', text: 'Precio fijo con válida hasta y ajustes aquí (https://ocpool.com.mx)' },
    ]);
  });

  it('returns nothing for empty or null input and removes control characters', () => {
    expect(parseRichText(null)).toEqual([]);
    expect(parseRichText('   \n\n  ')).toEqual([]);
    expect(parseRichText('Hola\u0007 mundo')).toEqual([{ kind: 'paragraph', text: 'Hola mundo' }]);
  });
});
```

`tests/unit/quote-pdf-snapshot-order.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { orderQuoteLines, orderQuoteSections } from '@/server/modules/quote-documents/snapshot-order';

describe('orden de la foto del PDF', () => {
  it('orders sections by position and lines by section, then position, loose lines last', () => {
    const sections = orderQuoteSections([
      { id: 'b', position: 1 },
      { id: 'a', position: 0 },
    ]);
    expect(sections.map((section) => section.id)).toEqual(['a', 'b']);

    const lines = orderQuoteLines([
      { id: '1', position: 0, sectionId: null },
      { id: '2', position: 1, sectionId: 'b' },
      { id: '3', position: 0, sectionId: 'b' },
      { id: '4', position: 5, sectionId: 'a' },
      { id: '5', position: 0, sectionId: 'missing' },
      { id: '6', position: 0, sectionId: 'a' },
    ], sections);
    expect(lines.map((line) => line.id)).toEqual(['6', '4', '3', '2', '1', '5']);
  });

  it('breaks ties by id so the order never depends on the database', () => {
    const lines = orderQuoteLines([{ id: 'z', position: 0, sectionId: null }, { id: 'y', position: 0, sectionId: null }], []);
    expect(lines.map((line) => line.id)).toEqual(['y', 'z']);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/quote-pdf-amount-in-words.test.ts tests/unit/quote-pdf-rich-text.test.ts tests/unit/quote-pdf-snapshot-order.test.ts` → FAIL.

- [ ] **Step 3: `amount-in-words.ts`**

```ts
/**
 * Importe con letra, como se acostumbra en los documentos comerciales en México: "Dos mil quinientos
 * dos pesos 70/100 M.N.". Sólo para las monedas con que OCPOOL cotiza (MXN y USD); para otras devuelve
 * null y el PDF omite la línea.
 */
const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const TEENS = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const TWENTIES = ['veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

const CURRENCIES: Readonly<Record<string, Readonly<{ singular: string; plural: string; suffix: string }>>> = {
  MXN: { singular: 'peso', plural: 'pesos', suffix: 'M.N.' },
  USD: { singular: 'dólar', plural: 'dólares', suffix: 'USD' },
};

/** 1–999 en palabras, con "uno" completo (la apócope depende de lo que sigue). */
function hundredsToWords(value: number): string {
  if (value === 100) return 'cien';
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]!);
  if (rest >= 30) {
    const units = rest % 10;
    parts.push(units === 0 ? TENS[Math.floor(rest / 10)]! : `${TENS[Math.floor(rest / 10)]} y ${UNITS[units]}`);
  } else if (rest >= 20) {
    parts.push(TWENTIES[rest - 20]!);
  } else if (rest >= 10) {
    parts.push(TEENS[rest - 10]!);
  } else if (rest > 0) {
    parts.push(UNITS[rest]!);
  }
  return parts.join(' ');
}

/** "uno" → "un" y "veintiuno" → "veintiún" delante de un sustantivo masculino (mil, millones, pesos). */
function apocopate(words: string): string {
  if (words.endsWith('veintiuno')) return `${words.slice(0, -'veintiuno'.length)}veintiún`;
  if (words === 'uno' || words.endsWith(' uno')) return `${words.slice(0, -'uno'.length)}un`;
  return words;
}

/** 1–999 999 en palabras. */
function belowMillionToWords(value: number): string {
  const thousands = Math.floor(value / 1_000);
  const rest = value % 1_000;
  const parts: string[] = [];
  if (thousands === 1) parts.push('mil');
  else if (thousands > 1) parts.push(`${apocopate(hundredsToWords(thousands))} mil`);
  if (rest > 0) parts.push(hundredsToWords(rest));
  return parts.join(' ');
}

/** Entero de 0 a 999 999 999 999 en palabras ("uno" sin apocopar al final). */
export function integerToSpanishWords(value: bigint): string {
  if (value < 0n || value > 999_999_999_999n) throw new RangeError('Importe fuera de rango para escribirlo con letra.');
  if (value === 0n) return 'cero';
  const millions = Number(value / 1_000_000n);
  const rest = Number(value % 1_000_000n);
  const parts: string[] = [];
  if (millions === 1) parts.push('un millón');
  else if (millions > 1) parts.push(`${apocopate(belowMillionToWords(millions))} millones`);
  if (rest > 0) parts.push(belowMillionToWords(rest));
  return parts.join(' ');
}

export function amountInWords(amountMinor: bigint, currencyCode: string): string | null {
  const currency = CURRENCIES[currencyCode.toUpperCase()];
  if (!currency) return null;
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const whole = absolute / 100n;
  if (whole > 999_999_999_999n) return null;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  const noun = whole === 1n ? currency.singular : currency.plural;
  // "un millón de pesos", pero "un millón doscientos mil pesos".
  const joiner = whole >= 1_000_000n && whole % 1_000_000n === 0n ? ' de ' : ' ';
  const sentence = `${negative ? 'menos ' : ''}${apocopate(integerToSpanishWords(whole))}${joiner}${noun} ${cents}/100 ${currency.suffix}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
```

- [ ] **Step 4: `rich-text.ts`**

```ts
/**
 * Texto libre de la cotización (alcance, condiciones, términos en Markdown) convertido en bloques que
 * el PDF sabe dibujar. No es un intérprete de Markdown completo: sólo lo que el equipo escribe de
 * verdad (títulos con #, listas con -, *, • o 1., **énfasis**, `código` y [enlaces](url)).
 */
export type RichTextBlock =
  | Readonly<{ kind: 'heading'; level: 1 | 2 | 3; text: string }>
  | Readonly<{ kind: 'paragraph'; text: string }>
  | Readonly<{ kind: 'bullet'; marker: string; text: string }>;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function cleanInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function parseRichText(input: string | null | undefined): RichTextBlock[] {
  const source = String(input ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(CONTROL_CHARACTERS, '');
  const blocks: RichTextBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = cleanInline(paragraph.join(' '));
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(3, heading[1]!.length) as 1 | 2 | 3, text: cleanInline(heading[2]!) });
      continue;
    }
    const bullet = /^[-*•·]\s+(.+)$/u.exec(line);
    const numbered = /^(\d{1,3})[.)]\s+(.+)$/u.exec(line);
    if (bullet || numbered) {
      flush();
      blocks.push({ kind: 'bullet', marker: numbered ? `${numbered[1]}.` : '•', text: cleanInline((numbered ? numbered[2] : bullet![1])!) });
      continue;
    }
    // Renglón sangrado justo después de una viñeta: continúa esa viñeta.
    const previous = blocks.at(-1);
    if (paragraph.length === 0 && /^\s{2,}/u.test(rawLine) && previous?.kind === 'bullet') {
      blocks[blocks.length - 1] = { ...previous, text: cleanInline(`${previous.text} ${line}`) };
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.filter((block) => block.text.length > 0);
}
```

- [ ] **Step 5: `snapshot-order.ts`**

```ts
type Positioned = Readonly<{ id: string; position: number }>;

/** Secciones en el orden en que el equipo las acomodó; el id desempata para no depender de la base. */
export function orderQuoteSections<T extends Positioned>(sections: readonly T[]): T[] {
  return [...sections].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Partidas en el orden de su sección y luego en el suyo propio; las sueltas (o de una sección que ya
 * no existe) al final. Antes se ordenaban por id (UUID), es decir, al azar.
 */
export function orderQuoteLines<T extends Positioned & Readonly<{ sectionId: string | null }>>(lines: readonly T[], orderedSections: readonly Readonly<{ id: string }>[]): T[] {
  const rank = new Map(orderedSections.map((section, index) => [section.id, index]));
  const sectionRank = (line: T) => (line.sectionId !== null ? rank.get(line.sectionId) : undefined) ?? Number.MAX_SAFE_INTEGER;
  return [...lines].sort((a, b) => sectionRank(a) - sectionRank(b) || a.position - b.position || a.id.localeCompare(b.id));
}
```

- [ ] **Step 6:** correr las 3 pruebas → PASS.
- [ ] **Step 7: Commit** — `git add src/server/modules/quote-documents/{amount-in-words,rich-text,snapshot-order}.ts tests/unit/quote-pdf-{amount-in-words,rich-text,snapshot-order}.test.ts && git commit -m "feat(pdf): importe con letra, texto enriquecido y orden de partidas"`

---

### Task 5: Fuentes, texto y paleta del PDF

**Files:**
- Create: `src/server/modules/quote-documents/pdf-theme.ts`, `pdf-fonts.ts`, `pdf-text.ts`
- Test: `tests/unit/quote-pdf-text.test.ts`

**Interfaces:**
- Consumes: `brandColors` (Task 1), fuentes en `assets/fonts` (Task 1).
- Produces:
  - `PDF_COLORS` con `navy`, `ink`, `muted`, `paper`, `line`, `bronze`, `bronzeText` y `white` (tipo `RGB`).
  - `PAGE` con `width`, `height`, `marginX`, `contentWidth`, `bodyBottom` y `footerBaseline`.
  - `QuotePdfFontRole = 'display' | 'regular' | 'semibold' | 'bold'`.
  - `QuotePdfTypeface = { font: PDFFont; clean(text): string }` y `QuotePdfTypefaces`.
  - `embedQuotePdfTypefaces(pdf: PDFDocument): Promise<QuotePdfTypefaces>`.
  - `TextStyle = { face; size; color; tracking? }`.
  - Funciones de texto: `textWidth(text, style)`, `drawText(page, text, x, y, style)`, `drawTextRight(page, text, rightX, y, style)` y `wrapText(text, style, maxWidth): string[]`.

- [ ] **Step 1: Prueba que falla** — `tests/unit/quote-pdf-text.test.ts`:

```ts
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedQuotePdfTypefaces } from '@/server/modules/quote-documents/pdf-fonts';
import { drawText, textWidth, wrapText } from '@/server/modules/quote-documents/pdf-text';
import { PDF_COLORS } from '@/server/modules/quote-documents/pdf-theme';

describe('PDF text primitives', () => {
  it('drops glyphs the embedded font lacks and substitutes common symbols', async () => {
    const pdf = await PDFDocument.create();
    const faces = await embedQuotePdfTypefaces(pdf);
    expect(faces.regular.clean('Profundidad ≥ 1.20 m → 🏊 listo')).toBe('Profundidad >= 1.20 m -> listo');
    expect(faces.regular.clean('Año, niño, acción: 100 %')).toBe('Año, niño, acción: 100 %');
  });

  it('wraps by width, splits words wider than the column and accounts for tracking', async () => {
    const pdf = await PDFDocument.create();
    const faces = await embedQuotePdfTypefaces(pdf);
    const style = { face: faces.regular, size: 10, color: PDF_COLORS.ink };
    const lines = wrapText('Suministro e instalación de equipo de filtración de alta eficiencia', style, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, style)).toBeLessThanOrEqual(120);
    expect(wrapText('https://ocpool.com.mx/portal/requests/000000000000000000000000', style, 60).length).toBeGreaterThan(1);
    expect(textWidth('ABC', { ...style, tracking: 2 })).toBeCloseTo(textWidth('ABC', style) + 4, 5);
    const page = pdf.addPage();
    expect(() => drawText(page, 'Texto con emoji 🏊', 10, 10, { ...style, tracking: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/quote-pdf-text.test.ts` → FAIL.

- [ ] **Step 3: `pdf-theme.ts`**

```ts
import { rgb, type RGB } from 'pdf-lib';
import { brandColors } from '@/lib/brand';

function fromHex(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
}

/** Paleta de la marca en colores de pdf-lib. */
export const PDF_COLORS = {
  navy: fromHex(brandColors.navy),
  ink: fromHex(brandColors.ink),
  muted: fromHex(brandColors.muted),
  paper: fromHex(brandColors.paper),
  line: fromHex(brandColors.line),
  bronze: fromHex(brandColors.bronze),
  bronzeText: fromHex(brandColors.bronzeText),
  white: fromHex(brandColors.white),
} as const;

/** A4 en puntos: márgenes laterales de 48 pt y una franja inferior reservada al pie. */
export const PAGE = {
  width: 595.28,
  height: 841.89,
  marginX: 48,
  contentWidth: 595.28 - 96,
  bodyBottom: 72,
  footerBaseline: 32,
} as const;
```

- [ ] **Step 4: `pdf-fonts.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

/**
 * Tipografía de la marca (Cormorant Garamond para títulos, Manrope para texto) incrustada en el PDF.
 * Helvetica estándar sólo codifica WinAnsi y rompía el render con un "≥" o un emoji en una
 * descripción; aquí cada texto se filtra contra los glifos que la fuente realmente tiene.
 */
const FONT_DIRECTORY = path.resolve(process.cwd(), 'src/server/modules/quote-documents/assets/fonts');
const FONT_FILES = {
  display: 'CormorantGaramond-SemiBold.ttf',
  regular: 'Manrope-Regular.ttf',
  semibold: 'Manrope-SemiBold.ttf',
  bold: 'Manrope-Bold.ttf',
} as const;

export type QuotePdfFontRole = keyof typeof FONT_FILES;
export type QuotePdfTypeface = Readonly<{ font: PDFFont; clean: (text: string) => string }>;
export type QuotePdfTypefaces = Readonly<Record<QuotePdfFontRole, QuotePdfTypeface>>;

type GlyphCoverage = Readonly<{ hasGlyphForCodePoint: (codePoint: number) => boolean }>;
type LoadedFont = Readonly<{ bytes: Uint8Array; coverage: GlyphCoverage }>;

// Sustitutos tipográficos antes de descartar un carácter que la fuente no tiene.
const FALLBACKS: Readonly<Record<string, string>> = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '×': 'x', '≈': '~', '…': '...', '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '•': '·' };
const ROLES = Object.keys(FONT_FILES) as QuotePdfFontRole[];

let loadedFonts: Promise<Record<QuotePdfFontRole, LoadedFont>> | null = null;

function loadFonts(): Promise<Record<QuotePdfFontRole, LoadedFont>> {
  loadedFonts ??= (async () => {
    const entries = await Promise.all(ROLES.map(async (role) => {
      const bytes = new Uint8Array(await readFile(path.join(FONT_DIRECTORY, FONT_FILES[role])));
      return [role, { bytes, coverage: fontkit.create(bytes) as unknown as GlyphCoverage }] as const;
    }));
    return Object.fromEntries(entries) as Record<QuotePdfFontRole, LoadedFont>;
  })().catch((error: unknown) => {
    loadedFonts = null;
    throw error;
  });
  return loadedFonts;
}

function supports(coverage: GlyphCoverage, text: string): boolean {
  return [...text].every((char) => coverage.hasGlyphForCodePoint(char.codePointAt(0)!));
}

function cleanForFont(text: string, coverage: GlyphCoverage): string {
  let output = '';
  for (const char of text.normalize('NFC')) {
    if (/\s/u.test(char)) output += ' ';
    else if (coverage.hasGlyphForCodePoint(char.codePointAt(0)!)) output += char;
    else if (FALLBACKS[char] && supports(coverage, FALLBACKS[char]!)) output += FALLBACKS[char];
  }
  return output.replace(/ {2,}/gu, ' ');
}

export async function embedQuotePdfTypefaces(pdf: PDFDocument): Promise<QuotePdfTypefaces> {
  pdf.registerFontkit(fontkit);
  const fonts = await loadFonts();
  const typefaces = {} as Record<QuotePdfFontRole, QuotePdfTypeface>;
  // Secuencial a propósito: el orden de incrustación fija el orden de los objetos (PDF determinista).
  for (const role of ROLES) {
    const { bytes, coverage } = fonts[role];
    const font = await pdf.embedFont(bytes, { subset: true, customName: `OCPOOL-${role}` });
    typefaces[role] = { font, clean: (text) => cleanForFont(text, coverage) };
  }
  return typefaces;
}
```

- [ ] **Step 5: `pdf-text.ts`**

```ts
import { setCharacterSpacing, type PDFPage, type RGB } from 'pdf-lib';
import type { QuotePdfTypeface } from '@/server/modules/quote-documents/pdf-fonts';

/** Estilo de texto: `tracking` es el espaciado entre letras en puntos (etiquetas en versalitas). */
export type TextStyle = Readonly<{ face: QuotePdfTypeface; size: number; color: RGB; tracking?: number }>;

export function textWidth(text: string, style: TextStyle): number {
  const clean = style.face.clean(text);
  const tracking = style.tracking ?? 0;
  return style.face.font.widthOfTextAtSize(clean, style.size) + (Math.max(0, [...clean].length - 1) * tracking);
}

export function drawText(page: PDFPage, text: string, x: number, y: number, style: TextStyle): void {
  const clean = style.face.clean(text).trim();
  if (!clean) return;
  const tracking = style.tracking ?? 0;
  if (tracking) page.pushOperators(setCharacterSpacing(tracking));
  page.drawText(clean, { x, y, size: style.size, font: style.face.font, color: style.color });
  if (tracking) page.pushOperators(setCharacterSpacing(0));
}

export function drawTextRight(page: PDFPage, text: string, rightX: number, y: number, style: TextStyle): void {
  drawText(page, text, rightX - textWidth(text.trim(), style), y, style);
}

/** Corta por palabras al ancho dado; una palabra más ancha que la columna (URL, código) se corta por letras. */
export function wrapText(text: string, style: TextStyle, maxWidth: number): string[] {
  const clean = style.face.clean(text).trim();
  if (!clean) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of clean.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, style) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (textWidth(word, style) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = '';
    for (const char of word) {
      if (chunk && textWidth(chunk + char, style) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines;
}
```

- [ ] **Step 6:** `npx vitest run tests/unit/quote-pdf-text.test.ts` → PASS.
- [ ] **Step 7: Commit** — `git add src/server/modules/quote-documents/pdf-{theme,fonts,text}.ts tests/unit/quote-pdf-text.test.ts && git commit -m "feat(pdf): fuentes de la marca incrustadas y primitivas de texto seguras"`

---

### Task 6: PDF v3 (`pdf-renderer.ts`)

**Files:**
- Modify (reescritura): `src/server/modules/quote-documents/pdf-renderer.ts`
- Modify: `tests/unit/quote-pdf-renderer.test.ts`

**Interfaces:**
- Consumes: Tasks 4 y 5.
- Produces:
  - Tipos: `QuotePdfLine` (agrega `discountBasisPoints`, `taxableMinor` y `sectionKey`), `QuotePdfSection` (`key`, `title`, `description?`), `QuotePdfTerms` (`title`, `versionTag`, `bodyMarkdown`, `privacyMarkdown`), `QuotePdfLineGroup` y `RenderedQuotePdf`.
  - `QuotePdfSnapshot` agrega `issuedAt`, `contactName?`, `advisorName?`, `taxLabel?`, `sections`, `scopeText?`, `exclusionsText?`, `paymentTermsText?`, `warrantyText?`, `publicNotesText?` y `terms?`.
  - Funciones: `renderQuotePdf`, `formatQuotePdfAmount`, `formatQuotePdfDate`, `formatQuotePdfValidUntil` y `groupQuotePdfLines`.
  - Constante: `QUOTE_PDF_TEMPLATE_VERSION = 'quote-pdf-v3'`.

- [ ] **Step 1: Pruebas** — reemplazar `tests/unit/quote-pdf-renderer.test.ts` por:

```ts
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  QUOTE_PDF_TEMPLATE_VERSION,
  formatQuotePdfAmount,
  formatQuotePdfValidUntil,
  groupQuotePdfLines,
  renderQuotePdf,
  type QuotePdfLine,
  type QuotePdfSnapshot,
} from '@/server/modules/quote-documents/pdf-renderer';
import { zonedCalendarDateEndOfDayToUtc } from '@/lib/calendar-timezone';

function line(overrides: Partial<QuotePdfLine> = {}): QuotePdfLine {
  return {
    name: 'Bomba de filtración premium',
    description: 'Equipo de alta eficiencia',
    unit: 'pieza',
    quantityMilliunits: 1_000n,
    unitPriceMinor: 485_000n,
    discountBasisPoints: 0,
    discountMinor: 0n,
    taxableMinor: 485_000n,
    taxMinor: 77_600n,
    totalMinor: 562_600n,
    sectionKey: null,
    ...overrides,
  };
}

const snapshot: QuotePdfSnapshot = {
  folio: 'OCQ-2026-000123',
  versionNumber: 2,
  issuedAt: new Date('2026-09-28T18:00:00.000Z'),
  clientName: 'Constructora del Norte, S.A. de C.V.',
  contactName: 'Ana López',
  advisorName: 'Laura Méndez',
  projectType: 'Alberca residencial',
  location: 'Chihuahua, Chihuahua',
  description: 'Diseño, suministro e instalación integral de sistema de filtración.',
  currencyCode: 'MXN',
  validUntil: new Date('2026-10-15T00:00:00.000Z'),
  taxLabel: 'IVA 16%',
  sections: [],
  lines: [
    line(),
    line({ name: 'Instalación y puesta en marcha', description: 'Incluye pruebas y capacitación', unit: 'servicio', unitPriceMinor: 120_000n, discountBasisPoints: 1_000, discountMinor: 12_000n, taxableMinor: 108_000n, taxMinor: 17_280n, totalMinor: 125_280n }),
  ],
  subtotalMinor: 605_000n,
  discountTotalMinor: 12_000n,
  taxableTotalMinor: 593_000n,
  taxTotalMinor: 94_880n,
  totalMinor: 687_880n,
};

describe('quote PDF renderer', () => {
  it('prints dates in the business timezone, not the UTC calendar day', () => {
    // `validUntil` se guarda como el instante UTC de fin del día local elegido (ver
    // `zonedCalendarDateEndOfDayToUtc`) -- ese instante cae en el día calendario UTC siguiente, así
    // que leerlo con getUTCDate()/getUTCMonth() imprimía la vigencia un día tarde.
    expect(formatQuotePdfValidUntil(zonedCalendarDateEndOfDayToUtc('2026-10-15'))).toBe('15 de octubre de 2026');
    expect(formatQuotePdfValidUntil(zonedCalendarDateEndOfDayToUtc('2026-01-31'))).toBe('31 de enero de 2026');
    expect(formatQuotePdfValidUntil(zonedCalendarDateEndOfDayToUtc('2026-10-05'))).toBe('5 de octubre de 2026');
    expect(formatQuotePdfValidUntil(null)).toBe('Sin fecha de vencimiento');
  });

  it('formats amounts with thousands separators and sign', () => {
    expect(formatQuotePdfAmount(68_788_000n)).toBe('$687,880.00');
    expect(formatQuotePdfAmount(-1_200n)).toBe('-$12.00');
    expect(formatQuotePdfAmount(5n)).toBe('$0.05');
  });

  it('renders a deterministic, paginated PDF from the frozen quote snapshot', async () => {
    const first = await renderQuotePdf(snapshot);
    const second = await renderQuotePdf({ ...snapshot, lines: [...snapshot.lines] });

    expect(first.templateVersion).toBe(QUOTE_PDF_TEMPLATE_VERSION);
    expect(QUOTE_PDF_TEMPLATE_VERSION).toBe('quote-pdf-v3');
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
    expect(first.byteSize).toBe(first.bytes.byteLength);
    expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'));
    expect(first.pageCount).toBeGreaterThanOrEqual(1);

    const document = await PDFDocument.load(first.bytes);
    expect(document.getPageCount()).toBe(first.pageCount);
    expect(document.getTitle()).toBe('Cotización OCPOOL OCQ-2026-000123 v2');
    expect(document.getAuthor()).toBe('OCPOOL');
  }, 15_000);

  it('does not depend on catalog or internal payload fields once the snapshot exists', async () => {
    const rendered = await renderQuotePdf(snapshot);
    const mutatedCatalogContext = await renderQuotePdf({ ...snapshot, lines: snapshot.lines.map((item) => ({ ...item })) });
    expect(rendered.sha256).toBe(mutatedCatalogContext.sha256);
    expect(Buffer.from(rendered.bytes).includes(Buffer.from('secret-internal-note'))).toBe(false);
  });

  it('supports long line descriptions without dropping totals', async () => {
    const rendered = await renderQuotePdf({
      ...snapshot,
      lines: Array.from({ length: 34 }, (_, index) => line({
        name: `Concepto premium ${index + 1}`,
        description: 'Descripción extensa de prueba para verificar saltos de línea y continuidad entre páginas sin romper la tabla comercial.',
        unitPriceMinor: 1_000n,
        taxableMinor: 1_000n,
        taxMinor: 160n,
        totalMinor: 1_160n,
      })),
    });
    expect(rendered.pageCount).toBeGreaterThan(1);
    expect(rendered.bytes.byteLength).toBeGreaterThan(1_000);
  });

  it('paginates the complete scope instead of truncating it', async () => {
    const rendered = await renderQuotePdf({ ...snapshot, scopeText: Array.from({ length: 180 }, (_, index) => `Alcance contractual ${index + 1} SCOPE-END-MARKER`).join(' ') });
    expect(rendered.pageCount).toBeGreaterThan(1);
    const document = await PDFDocument.load(rendered.bytes);
    expect(document.getPageCount()).toBe(rendered.pageCount);
  });

  it('groups lines by section order and leaves loose lines for the end', () => {
    const groups = groupQuotePdfLines(
      [{ key: 'obra', title: 'Obra civil' }, { key: 'vacia', title: 'Sin partidas' }, { key: 'equipo', title: 'Equipamiento' }],
      [line({ name: 'suelta', taxableMinor: 5n }), line({ name: 'bomba', sectionKey: 'equipo', taxableMinor: 7n }), line({ name: 'trazo', sectionKey: 'obra', taxableMinor: 3n }), line({ name: 'huérfana', sectionKey: 'borrada', taxableMinor: 1n })],
    );
    expect(groups.map((group) => group.section?.key ?? null)).toEqual(['obra', 'equipo', null]);
    expect(groups.map((group) => group.lines.map((item) => item.name))).toEqual([['trazo'], ['bomba'], ['suelta', 'huérfana']]);
    expect(groups.map((group) => group.subtotalMinor)).toEqual([3n, 7n, 6n]);
  });

  it('renders sections, commercial texts and the terms annex, and survives characters outside the fonts', async () => {
    const rendered = await renderQuotePdf({
      ...snapshot,
      sections: [{ key: 'obra', title: 'Obra civil', description: 'Trazo, excavación y estructura del vaso.' }, { key: 'equipo', title: 'Equipamiento ≥ premium 🏊' }],
      lines: [line({ sectionKey: 'equipo', name: 'Bomba → 1.5 HP 🏊' }), line({ sectionKey: 'obra', name: 'Excavación', unit: 'metro cúbico', quantityMilliunits: 48_500n })],
      scopeText: 'Construcción del vaso.\n- Obra civil\n- Equipamiento',
      exclusionsText: '- Permisos municipales',
      paymentTermsText: '1. 50 % de anticipo\n2. 50 % contra entrega',
      warrantyText: 'Cinco años en estructura.',
      publicNotesText: 'Tiempo estimado: 8 semanas.',
      terms: { title: 'Condiciones comerciales', versionTag: 'v1', bodyMarkdown: '## 1. Objeto\n\nTexto del objeto.\n\n- Punto uno', privacyMarkdown: '## Aviso de privacidad\n\nTexto.' },
    });
    expect(rendered.pageCount).toBeGreaterThanOrEqual(2);
  }, 15_000);
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/quote-pdf-renderer.test.ts` → FAIL (tipos y exportaciones nuevas).

- [ ] **Step 3: Reescribir `pdf-renderer.ts`**

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import { brandContact, brandIdentity, brandWebsiteLabel } from '@/lib/brand';
import { BUSINESS_TIMEZONE, timeZoneParts } from '@/lib/calendar-timezone';
import { amountInWords } from '@/server/modules/quote-documents/amount-in-words';
import { embedQuotePdfTypefaces, type QuotePdfTypefaces } from '@/server/modules/quote-documents/pdf-fonts';
import { drawText, drawTextRight, textWidth, wrapText, type TextStyle } from '@/server/modules/quote-documents/pdf-text';
import { PAGE, PDF_COLORS } from '@/server/modules/quote-documents/pdf-theme';
import { parseRichText, type RichTextBlock } from '@/server/modules/quote-documents/rich-text';

export const QUOTE_PDF_TEMPLATE_VERSION = 'quote-pdf-v3';

const FIXED_METADATA_DATE = new Date('2026-01-01T00:00:00.000Z');
const LOGO_PATH = path.resolve(process.cwd(), 'src/server/modules/quote-documents/assets/ocpool-logo-print.png');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const RIGHT_EDGE = PAGE.marginX + PAGE.contentWidth;
const MAX_NOTE_LINES = 40;

export type QuotePdfLine = Readonly<{
  name: string;
  description?: string | null;
  unit: string;
  quantityMilliunits: bigint;
  unitPriceMinor: bigint;
  /** Descuento de la partida en puntos base (1 000 = 10 %). */
  discountBasisPoints: number;
  discountMinor: bigint;
  /** Importe antes de impuestos: cantidad × precio − descuento. */
  taxableMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  /** Sección a la que pertenece la partida; null si va suelta. */
  sectionKey: string | null;
}>;

export type QuotePdfSection = Readonly<{ key: string; title: string; description?: string | null }>;

export type QuotePdfTerms = Readonly<{ title: string; versionTag: string; bodyMarkdown: string; privacyMarkdown: string }>;

export type QuotePdfSnapshot = Readonly<{
  folio: string;
  versionNumber: number;
  /** Momento de la generación: la fecha de emisión que se imprime. */
  issuedAt: Date;
  clientName: string;
  contactName?: string | null;
  advisorName?: string | null;
  projectType: string;
  location: string;
  /** Descripción de la solicitud; sólo se imprime como alcance si la versión no trae uno propio. */
  description: string;
  currencyCode: string;
  validUntil: Date | null;
  taxLabel?: string | null;
  sections: readonly QuotePdfSection[];
  lines: readonly QuotePdfLine[];
  scopeText?: string | null;
  exclusionsText?: string | null;
  paymentTermsText?: string | null;
  warrantyText?: string | null;
  publicNotesText?: string | null;
  terms?: QuotePdfTerms | null;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxableTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
}>;

export type RenderedQuotePdf = Readonly<{
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  pageCount: number;
  templateVersion: string;
}>;

export type QuotePdfLineGroup = Readonly<{ section: QuotePdfSection | null; lines: readonly QuotePdfLine[]; subtotalMinor: bigint }>;

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function groupThousands(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/** "$687,880.00": todos los importes están en la misma moneda, que el documento indica aparte. */
export function formatQuotePdfAmount(amount: bigint): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? '-' : ''}$${groupThousands(absolute / 100n)}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function formatQuantity(quantityMilliunits: bigint): string {
  const negative = quantityMilliunits < 0n;
  const absolute = negative ? -quantityMilliunits : quantityMilliunits;
  const fraction = (absolute % 1_000n).toString().padStart(3, '0').replace(/0+$/u, '');
  return `${negative ? '-' : ''}${groupThousands(absolute / 1_000n)}${fraction ? `.${fraction}` : ''}`;
}

function formatDiscount(line: QuotePdfLine): string {
  if (line.discountBasisPoints > 0) {
    const percent = line.discountBasisPoints / 100;
    return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2).replace(/0$/u, '')}%`;
  }
  return line.discountMinor > 0n ? formatQuotePdfAmount(-line.discountMinor) : '—';
}

/** Fecha en la zona horaria del negocio: "28 de septiembre de 2026". */
export function formatQuotePdfDate(date: Date): string {
  const parts = timeZoneParts(date, BUSINESS_TIMEZONE);
  return `${parts.day} de ${MONTHS[parts.month - 1]} de ${parts.year}`;
}

// `validUntil` se guarda como el instante UTC de las 23:59:59.999 en America/Chihuahua del día
// elegido (ver `zonedCalendarDateEndOfDayToUtc`) -- por estar Chihuahua detrás de UTC, ese instante
// siempre cae en el día calendario UTC SIGUIENTE, así que leer `getUTCDate()`/`getUTCMonth()`
// directamente imprimía la "VIGENCIA" de la propuesta un día después del que el equipo configuró.
export function formatQuotePdfValidUntil(date: Date | null): string {
  return date ? formatQuotePdfDate(date) : 'Sin fecha de vencimiento';
}

function currencyDescription(code: string): string {
  if (code === 'MXN') return 'pesos mexicanos (MXN)';
  if (code === 'USD') return 'dólares estadounidenses (USD)';
  return code;
}

/** Partidas agrupadas en el orden de sus secciones; las sueltas (o de una sección desconocida) al final. */
export function groupQuotePdfLines(sections: readonly QuotePdfSection[], lines: readonly QuotePdfLine[]): QuotePdfLineGroup[] {
  const sum = (items: readonly QuotePdfLine[]) => items.reduce((total, item) => total + item.taxableMinor, 0n);
  const known = new Set(sections.map((section) => section.key));
  const groups: QuotePdfLineGroup[] = [];
  for (const section of sections) {
    const sectionLines = lines.filter((item) => item.sectionKey === section.key);
    if (sectionLines.length > 0) groups.push({ section, lines: sectionLines, subtotalMinor: sum(sectionLines) });
  }
  const loose = lines.filter((item) => item.sectionKey === null || !known.has(item.sectionKey));
  if (loose.length > 0) groups.push({ section: null, lines: loose, subtotalMinor: sum(loose) });
  return groups;
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(faces: QuotePdfTypefaces) {
  const style = (face: keyof QuotePdfTypefaces, size: number, color: TextStyle['color'], tracking = 0): TextStyle => ({ face: faces[face], size, color, tracking });
  return {
    eyebrow: style('bold', 7, PDF_COLORS.bronzeText, 1.3),
    folio: style('display', 25, PDF_COLORS.navy),
    meta: style('regular', 8.4, PDF_COLORS.muted),
    partyName: style('display', 15.5, PDF_COLORS.navy),
    partyLine: style('regular', 8.6, PDF_COLORS.ink),
    heading: style('display', 16, PDF_COLORS.navy),
    tableHead: style('bold', 6.6, PDF_COLORS.white, 0.9),
    sectionTitle: style('display', 12, PDF_COLORS.navy),
    sectionNote: style('regular', 7.4, PDF_COLORS.muted),
    sectionAmount: style('semibold', 8, PDF_COLORS.navy),
    index: style('regular', 7.4, PDF_COLORS.muted),
    lineName: style('semibold', 8.4, PDF_COLORS.ink),
    lineNote: style('regular', 7.3, PDF_COLORS.muted),
    cell: style('regular', 8, PDF_COLORS.ink),
    cellMuted: style('regular', 7.2, PDF_COLORS.muted),
    cellStrong: style('semibold', 8, PDF_COLORS.ink),
    totalsLabel: style('regular', 8.6, PDF_COLORS.muted),
    totalsValue: style('regular', 8.6, PDF_COLORS.ink),
    totalLabel: style('bold', 7.2, PDF_COLORS.white, 1.3),
    totalValue: style('display', 18, PDF_COLORS.white),
    words: style('regular', 8.4, PDF_COLORS.ink),
    body: style('regular', 8.8, PDF_COLORS.ink),
    bodyHeading: style('bold', 8.8, PDF_COLORS.navy),
    annex: style('regular', 7.8, PDF_COLORS.ink),
    annexHeading: style('bold', 8, PDF_COLORS.navy),
    footer: style('regular', 7, PDF_COLORS.muted),
  };
}

/** Páginas, posición vertical y saltos: cada salto automático redibuja lo que deba repetirse. */
class QuoteDocument {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  onBreak: (() => void) | null = null;

  constructor(readonly pdf: PDFDocument, readonly snapshot: QuotePdfSnapshot, readonly styles: Styles, readonly logo: PDFImage) {}

  addPage(): void {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: PAGE.height - 8, width: PAGE.width, height: 8, color: PDF_COLORS.navy });
    this.y = this.pages.length === 1 ? drawCoverHeader(this) : drawRunningHeader(this);
  }

  /** Garantiza `height` puntos libres; si no caben, abre otra página. Devuelve true si saltó. */
  ensure(height: number): boolean {
    if (this.y - height >= PAGE.bodyBottom) return false;
    this.addPage();
    this.onBreak?.();
    return true;
  }
}

function drawRule(page: PDFPage, y: number): void {
  page.drawLine({ start: { x: PAGE.marginX, y }, end: { x: RIGHT_EDGE, y }, thickness: 0.6, color: PDF_COLORS.line });
  page.drawLine({ start: { x: PAGE.marginX, y }, end: { x: PAGE.marginX + 56, y }, thickness: 1.4, color: PDF_COLORS.bronze });
}

function drawParty(doc: QuoteDocument, label: string, name: string, lines: readonly string[], x: number, top: number, width: number): number {
  const { page, styles } = doc;
  drawText(page, label, x, top, styles.eyebrow);
  let y = top - 21;
  for (const nameLine of wrapText(name, styles.partyName, width).slice(0, 2)) {
    drawText(page, nameLine, x, y, styles.partyName);
    y -= 17;
  }
  y -= 1;
  for (const entry of lines) {
    for (const wrapped of wrapText(entry, styles.partyLine, width).slice(0, 2)) {
      drawText(page, wrapped, x, y, styles.partyLine);
      y -= 12.5;
    }
  }
  return y;
}

function drawCoverHeader(doc: QuoteDocument): number {
  const { page, snapshot, styles, logo } = doc;
  const top = PAGE.height - 8;
  const logoWidth = 96;
  const logoHeight = logoWidth * (logo.height / logo.width);
  const logoBottom = top - 30 - logoHeight;
  page.drawImage(logo, { x: PAGE.marginX, y: logoBottom, width: logoWidth, height: logoHeight });
  drawTextRight(page, 'COTIZACIÓN', RIGHT_EDGE, top - 44, styles.eyebrow);
  drawTextRight(page, cleanText(snapshot.folio), RIGHT_EDGE, top - 72, styles.folio);
  const meta = [
    `Versión ${snapshot.versionNumber} · Emitida el ${formatQuotePdfDate(snapshot.issuedAt)}`,
    snapshot.validUntil ? `Vigente hasta el ${formatQuotePdfDate(snapshot.validUntil)}` : 'Sin fecha de vencimiento',
  ];
  meta.forEach((entry, index) => drawTextRight(page, entry, RIGHT_EDGE, top - 92 - (index * 13), styles.meta));
  const ruleY = Math.min(logoBottom, top - 105) - 20;
  drawRule(page, ruleY);

  const gap = 32;
  const width = (PAGE.contentWidth - gap) / 2;
  const partiesTop = ruleY - 28;
  const client = [
    snapshot.contactName ? `Atención: ${cleanText(snapshot.contactName)}` : '',
    cleanText(snapshot.projectType),
    cleanText(snapshot.location),
  ].filter(Boolean);
  const issuer = [
    snapshot.advisorName ? `Asesor: ${cleanText(snapshot.advisorName)}` : '',
    brandContact.email,
    `${brandContact.phone} · ${brandWebsiteLabel}`,
  ].filter(Boolean);
  const leftBottom = drawParty(doc, 'PREPARADA PARA', cleanText(snapshot.clientName), client, PAGE.marginX, partiesTop, width);
  const rightBottom = drawParty(doc, 'EMITIDA POR', brandIdentity.name, issuer, PAGE.marginX + width + gap, partiesTop, width);
  return Math.min(leftBottom, rightBottom) - 18;
}

function drawRunningHeader(doc: QuoteDocument): number {
  const { page, snapshot, styles, logo } = doc;
  const top = PAGE.height - 8;
  const logoWidth = 48;
  const logoHeight = logoWidth * (logo.height / logo.width);
  const logoBottom = top - 20 - logoHeight;
  page.drawImage(logo, { x: PAGE.marginX, y: logoBottom, width: logoWidth, height: logoHeight });
  drawTextRight(page, 'COTIZACIÓN', RIGHT_EDGE, top - 30, styles.eyebrow);
  drawTextRight(page, `${cleanText(snapshot.folio)} · Versión ${snapshot.versionNumber}`, RIGHT_EDGE, top - 45, styles.meta);
  const ruleY = logoBottom - 14;
  drawRule(page, ruleY);
  return ruleY - 24;
}

/** Título de apartado con filete bronce; reserva espacio para `keepWith` puntos del contenido. */
function drawHeading(doc: QuoteDocument, title: string, keepWith = 30): void {
  doc.ensure(40 + keepWith);
  const baseline = doc.y - 16;
  drawText(doc.page, title, PAGE.marginX, baseline, doc.styles.heading);
  doc.page.drawLine({ start: { x: PAGE.marginX, y: baseline - 9 }, end: { x: PAGE.marginX + 28, y: baseline - 9 }, thickness: 1.1, color: PDF_COLORS.bronze });
  doc.y = baseline - 24;
}

type Columns = Readonly<{ index: number; concept: number; conceptWidth: number; quantityRight: number; priceRight: number; discountRight: number | null; amountRight: number }>;

function tableColumns(showDiscount: boolean): Columns {
  const amountRight = RIGHT_EDGE - 10;
  const discountRight = showDiscount ? amountRight - 82 : null;
  const priceRight = (discountRight ?? amountRight) - (showDiscount ? 48 : 82);
  const quantityRight = priceRight - 80;
  const concept = PAGE.marginX + 28;
  return { index: PAGE.marginX + 10, concept, conceptWidth: quantityRight - 66 - concept, quantityRight, priceRight, discountRight, amountRight };
}

function drawTableHeader(doc: QuoteDocument, columns: Columns): void {
  const { page, styles } = doc;
  const height = 22;
  page.drawRectangle({ x: PAGE.marginX, y: doc.y - height, width: PAGE.contentWidth, height, color: PDF_COLORS.navy });
  const baseline = doc.y - 14;
  drawText(page, '#', columns.index, baseline, styles.tableHead);
  drawText(page, 'CONCEPTO', columns.concept, baseline, styles.tableHead);
  drawTextRight(page, 'CANTIDAD', columns.quantityRight, baseline, styles.tableHead);
  drawTextRight(page, 'P. UNITARIO', columns.priceRight, baseline, styles.tableHead);
  if (columns.discountRight !== null) drawTextRight(page, 'DESC.', columns.discountRight, baseline, styles.tableHead);
  drawTextRight(page, 'IMPORTE', columns.amountRight, baseline, styles.tableHead);
  doc.y -= height;
}

function sectionRowLayout(doc: QuoteDocument, columns: Columns, group: QuotePdfLineGroup, continued: boolean) {
  const titleWidth = columns.amountRight - 96 - columns.concept;
  const title = `${group.section ? cleanText(group.section.title) : 'Otros conceptos'}${continued ? ' (continuación)' : ''}`;
  const titleLines = wrapText(title, doc.styles.sectionTitle, titleWidth).slice(0, 2);
  const notes = !continued && group.section?.description ? wrapText(group.section.description, doc.styles.sectionNote, titleWidth).slice(0, 6) : [];
  const height = 17 + ((titleLines.length - 1) * 14) + (notes.length ? 4 + (notes.length * 9.6) : 0) + 9;
  return { titleLines, notes, height };
}

function drawSectionRow(doc: QuoteDocument, columns: Columns, group: QuotePdfLineGroup, continued: boolean): void {
  const { page, styles } = doc;
  const layout = sectionRowLayout(doc, columns, group, continued);
  page.drawRectangle({ x: PAGE.marginX, y: doc.y - layout.height, width: PAGE.contentWidth, height: layout.height, color: PDF_COLORS.paper });
  const baseline = doc.y - 17;
  layout.titleLines.forEach((entry, index) => drawText(page, entry, columns.concept, baseline - (index * 14), styles.sectionTitle));
  if (!continued) drawTextRight(page, formatQuotePdfAmount(group.subtotalMinor), columns.amountRight, baseline, styles.sectionAmount);
  const notesTop = baseline - ((layout.titleLines.length - 1) * 14) - 13;
  layout.notes.forEach((entry, index) => drawText(page, entry, columns.concept, notesTop - (index * 9.6), styles.sectionNote));
  doc.y -= layout.height;
  page.drawLine({ start: { x: PAGE.marginX, y: doc.y }, end: { x: RIGHT_EDGE, y: doc.y }, thickness: 0.5, color: PDF_COLORS.line });
}

type LineLayout = Readonly<{ nameLines: string[]; noteLines: string[]; quantity: string; unit: string | null; height: number }>;

function lineRowLayout(doc: QuoteDocument, columns: Columns, line: QuotePdfLine): LineLayout {
  const { styles } = doc;
  const nameLines = wrapText(line.name, styles.lineName, columns.conceptWidth);
  const allNotes = wrapText(line.description ?? '', styles.lineNote, columns.conceptWidth);
  const noteLines = allNotes.length > MAX_NOTE_LINES ? [...allNotes.slice(0, MAX_NOTE_LINES - 1), `${allNotes[MAX_NOTE_LINES - 1]}…`] : allNotes;
  const quantity = formatQuantity(line.quantityMilliunits);
  const unit = cleanText(line.unit);
  const inline = unit ? `${quantity} ${unit}` : quantity;
  const fitsInline = textWidth(inline, styles.cell) <= 64;
  const contentHeight = (Math.max(1, nameLines.length) * 10.6) + (noteLines.length ? 2 + (noteLines.length * 9.3) : 0);
  return { nameLines, noteLines, quantity: fitsInline ? inline : quantity, unit: fitsInline ? null : unit, height: Math.max(fitsInline ? 30 : 34, 17 + contentHeight) };
}

function drawLineRow(doc: QuoteDocument, columns: Columns, line: QuotePdfLine, index: number, layout: LineLayout): void {
  const { page, styles } = doc;
  const baseline = doc.y - 16;
  drawText(page, String(index), columns.index, baseline, styles.index);
  layout.nameLines.forEach((entry, lineIndex) => drawText(page, entry, columns.concept, baseline - (lineIndex * 10.6), styles.lineName));
  const notesTop = baseline - (layout.nameLines.length * 10.6) - 1.5;
  layout.noteLines.forEach((entry, lineIndex) => drawText(page, entry, columns.concept, notesTop - (lineIndex * 9.3), styles.lineNote));
  drawTextRight(page, layout.quantity, columns.quantityRight, baseline, styles.cell);
  if (layout.unit) drawTextRight(page, layout.unit, columns.quantityRight, baseline - 10, styles.cellMuted);
  drawTextRight(page, formatQuotePdfAmount(line.unitPriceMinor), columns.priceRight, baseline, styles.cell);
  if (columns.discountRight !== null) drawTextRight(page, formatDiscount(line), columns.discountRight, baseline, styles.cell);
  drawTextRight(page, formatQuotePdfAmount(line.taxableMinor), columns.amountRight, baseline, styles.cellStrong);
  doc.y -= layout.height;
  page.drawLine({ start: { x: PAGE.marginX, y: doc.y }, end: { x: RIGHT_EDGE, y: doc.y }, thickness: 0.5, color: PDF_COLORS.line });
}

function drawLineTable(doc: QuoteDocument): void {
  const { snapshot } = doc;
  const showDiscount = snapshot.lines.some((item) => item.discountBasisPoints > 0 || item.discountMinor > 0n);
  const columns = tableColumns(showDiscount);
  const groups = groupQuotePdfLines(snapshot.sections, snapshot.lines);
  const showSections = groups.some((group) => group.section !== null);
  let currentGroup: QuotePdfLineGroup | null = null;

  doc.onBreak = null;
  drawHeading(doc, 'Propuesta económica', 22 + 30);
  drawTableHeader(doc, columns);
  doc.onBreak = () => {
    drawTableHeader(doc, columns);
    if (showSections && currentGroup) drawSectionRow(doc, columns, currentGroup, true);
  };
  let index = 0;
  for (const group of groups) {
    // Una sección que empieza en página nueva no debe repetirse como "continuación".
    currentGroup = null;
    if (showSections) {
      doc.ensure(sectionRowLayout(doc, columns, group, false).height + 30);
      drawSectionRow(doc, columns, group, false);
    }
    currentGroup = group;
    for (const line of group.lines) {
      index += 1;
      const layout = lineRowLayout(doc, columns, line);
      doc.ensure(layout.height);
      drawLineRow(doc, columns, line, index, layout);
    }
  }
  doc.onBreak = null;
}

function drawTotals(doc: QuoteDocument): void {
  const { snapshot, styles } = doc;
  const rows: Array<readonly [string, string]> = [['Subtotal', formatQuotePdfAmount(snapshot.subtotalMinor)]];
  if (snapshot.discountTotalMinor > 0n) {
    rows.push(['Descuento', formatQuotePdfAmount(-snapshot.discountTotalMinor)]);
    rows.push(['Subtotal neto', formatQuotePdfAmount(snapshot.taxableTotalMinor)]);
  }
  rows.push([cleanText(snapshot.taxLabel) || 'Impuestos', formatQuotePdfAmount(snapshot.taxTotalMinor)]);

  const rowHeight = 16;
  const totalHeight = 38;
  const blockWidth = 228;
  const blockX = RIGHT_EDGE - blockWidth;
  const leftWidth = blockX - PAGE.marginX - 28;
  const words = amountInWords(snapshot.totalMinor, snapshot.currencyCode);
  const wordsLines = words ? wrapText(words, styles.words, leftWidth) : [];
  const validity = snapshot.validUntil ? ` Propuesta vigente hasta el ${formatQuotePdfDate(snapshot.validUntil)}.` : '';
  const noteLines = wrapText(`Importes en ${currencyDescription(snapshot.currencyCode)}.${validity}`, styles.meta, leftWidth);
  const leftHeight = (wordsLines.length ? 17 + (wordsLines.length * 12) + 8 : 0) + (noteLines.length * 11.5);
  const rightHeight = (rows.length * rowHeight) + 10 + totalHeight;
  doc.ensure(Math.max(leftHeight, rightHeight) + 22);
  const top = doc.y - 20;

  let y = top;
  for (const [label, value] of rows) {
    drawText(doc.page, label, blockX + 14, y - 11, styles.totalsLabel);
    drawTextRight(doc.page, value, RIGHT_EDGE - 14, y - 11, styles.totalsValue);
    y -= rowHeight;
  }
  y -= 10;
  doc.page.drawRectangle({ x: blockX, y: y - totalHeight, width: blockWidth, height: totalHeight, color: PDF_COLORS.navy });
  drawText(doc.page, 'TOTAL', blockX + 14, y - 23, styles.totalLabel);
  drawTextRight(doc.page, `${formatQuotePdfAmount(snapshot.totalMinor)} ${snapshot.currencyCode}`, RIGHT_EDGE - 14, y - 25.5, styles.totalValue);
  const rightBottom = y - totalHeight;

  let leftY = top - 11;
  if (wordsLines.length) {
    drawText(doc.page, 'IMPORTE CON LETRA', PAGE.marginX, leftY, styles.eyebrow);
    leftY -= 17;
    for (const entry of wordsLines) {
      drawText(doc.page, entry, PAGE.marginX, leftY, styles.words);
      leftY -= 12;
    }
    leftY -= 8;
  }
  for (const entry of noteLines) {
    drawText(doc.page, entry, PAGE.marginX, leftY, styles.meta);
    leftY -= 11.5;
  }
  doc.y = Math.min(rightBottom, leftY) - 18;
}

function drawRichBlocks(doc: QuoteDocument, blocks: readonly RichTextBlock[], body: TextStyle, heading: TextStyle, leading: number): void {
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const lines = wrapText(block.text, heading, PAGE.contentWidth);
      doc.ensure(8 + (lines.length * (leading + 1)) + (leading * 2));
      doc.y -= 8;
      for (const entry of lines) {
        drawText(doc.page, entry, PAGE.marginX, doc.y - heading.size, heading);
        doc.y -= leading + 1;
      }
      doc.y -= 2;
      continue;
    }
    const marker = block.kind === 'bullet' ? block.marker : null;
    const indent = marker ? Math.max(12, textWidth(marker, body) + 6) : 0;
    const lines = wrapText(block.text, body, PAGE.contentWidth - indent);
    lines.forEach((entry, lineIndex) => {
      doc.ensure(leading + 2);
      const baseline = doc.y - body.size;
      if (marker && lineIndex === 0) drawText(doc.page, marker, PAGE.marginX + (marker === '•' ? 2 : 0), baseline, marker === '•' ? { ...body, color: PDF_COLORS.bronze } : body);
      drawText(doc.page, entry, PAGE.marginX + indent, baseline, body);
      doc.y -= leading;
    });
    doc.y -= marker ? 2.5 : 6;
  }
}

function drawTextSection(doc: QuoteDocument, title: string, source: string | null | undefined): void {
  const blocks = parseRichText(source);
  if (blocks.length === 0) return;
  doc.onBreak = null;
  drawHeading(doc, title);
  doc.onBreak = () => drawHeading(doc, `${title} (continuación)`, 0);
  drawRichBlocks(doc, blocks, doc.styles.body, doc.styles.bodyHeading, 13.2);
  doc.onBreak = null;
  doc.y -= 10;
}

const COMMERCIAL_SECTIONS: ReadonlyArray<readonly [string, (snapshot: QuotePdfSnapshot) => string | null | undefined]> = [
  ['Alcance', (snapshot) => (snapshot.scopeText?.trim() ? snapshot.scopeText : snapshot.description)],
  ['Exclusiones', (snapshot) => snapshot.exclusionsText],
  ['Condiciones de pago', (snapshot) => snapshot.paymentTermsText],
  ['Garantías', (snapshot) => snapshot.warrantyText],
  ['Notas', (snapshot) => snapshot.publicNotesText],
];

const ACCEPTANCE_TEXT = `Puedes aceptar esta propuesta o solicitarnos cambios desde tu portal de cliente en ${brandWebsiteLabel}/portal. La aceptación queda registrada con la versión, los importes y las condiciones de este documento.`;

function drawTermsAnnex(doc: QuoteDocument): void {
  const terms = doc.snapshot.terms;
  if (!terms) return;
  const blocks = [...parseRichText(terms.bodyMarkdown), ...parseRichText(terms.privacyMarkdown)];
  if (blocks.length === 0) return;
  doc.onBreak = null;
  doc.addPage();
  drawHeading(doc, 'Condiciones comerciales');
  drawText(doc.page, `${cleanText(terms.title)} · Versión ${cleanText(terms.versionTag)}`, PAGE.marginX, doc.y - 4, doc.styles.meta);
  doc.y -= 18;
  doc.onBreak = () => drawHeading(doc, 'Condiciones comerciales (continuación)', 0);
  drawRichBlocks(doc, blocks, doc.styles.annex, doc.styles.annexHeading, 11.2);
  doc.onBreak = null;
}

function drawFooters(doc: QuoteDocument): void {
  const { styles, snapshot } = doc;
  const total = doc.pages.length;
  doc.pages.forEach((page, index) => {
    page.drawLine({ start: { x: PAGE.marginX, y: PAGE.footerBaseline + 14 }, end: { x: RIGHT_EDGE, y: PAGE.footerBaseline + 14 }, thickness: 0.5, color: PDF_COLORS.line });
    drawText(page, `${brandIdentity.name} · ${brandIdentity.tagline}`, PAGE.marginX, PAGE.footerBaseline, styles.footer);
    drawTextRight(page, `${cleanText(snapshot.folio)} · v${snapshot.versionNumber} · Página ${index + 1} de ${total}`, RIGHT_EDGE, PAGE.footerBaseline, styles.footer);
  });
}

let logoBytes: Promise<Uint8Array> | null = null;

function readLogo(): Promise<Uint8Array> {
  logoBytes ??= readFile(LOGO_PATH).then((buffer) => new Uint8Array(buffer)).catch((error: unknown) => {
    logoBytes = null;
    throw error;
  });
  return logoBytes;
}

export async function renderQuotePdf(snapshot: QuotePdfSnapshot): Promise<RenderedQuotePdf> {
  if (!snapshot.folio || snapshot.versionNumber < 1 || !snapshot.currencyCode || snapshot.lines.length === 0) {
    throw new Error('Invalid quote PDF snapshot.');
  }

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const typefaces = await embedQuotePdfTypefaces(pdf);
  const logo = await pdf.embedPng(await readLogo());
  pdf.setTitle(`Cotización OCPOOL ${cleanText(snapshot.folio)} v${snapshot.versionNumber}`);
  pdf.setAuthor('OCPOOL');
  pdf.setSubject('Propuesta comercial');
  pdf.setCreator('OCPOOL');
  pdf.setProducer('OCPOOL PDF Renderer');
  pdf.setLanguage('es-MX');
  pdf.setCreationDate(FIXED_METADATA_DATE);
  pdf.setModificationDate(FIXED_METADATA_DATE);

  const doc = new QuoteDocument(pdf, snapshot, createStyles(typefaces), logo);
  doc.addPage();
  drawLineTable(doc);
  drawTotals(doc);
  for (const [title, pick] of COMMERCIAL_SECTIONS) drawTextSection(doc, title, pick(snapshot));
  drawTextSection(doc, 'Aceptación', ACCEPTANCE_TEXT);
  drawTermsAnnex(doc);
  drawFooters(doc);

  const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
  return {
    bytes,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: pdf.getPageCount(),
    templateVersion: QUOTE_PDF_TEMPLATE_VERSION,
  };
}
```

- [ ] **Step 4:** `npx vitest run tests/unit/quote-pdf-renderer.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/server/modules/quote-documents/pdf-renderer.ts tests/unit/quote-pdf-renderer.test.ts && git commit -m "feat(pdf): cotización v3 con marca, secciones, contenido comercial y anexo de condiciones"`

---

### Task 7: Foto enriquecida desde la base y muestra realista

**Files:**
- Modify: `src/server/modules/quote-documents/service.ts` (`loadSnapshot` y su llamada)
- Modify: `scripts/render-quote-pdf-fixture.ts`

**Interfaces:**
- Consumes: `orderQuoteSections` y `orderQuoteLines` (Task 4), y el tipo `QuotePdfSnapshot` (Task 6).
- Produces: `loadSnapshot(transaction, quoteVersionId, issuedAt: Date)`.

- [ ] **Step 1:** en `service.ts`, importar `import { orderQuoteLines, orderQuoteSections } from '@/server/modules/quote-documents/snapshot-order';` y reemplazar `loadSnapshot` por:

```ts
async function loadSnapshot(transaction: Prisma.TransactionClient, quoteVersionId: string, issuedAt: Date): Promise<{ snapshot: QuotePdfSnapshot; quoteRequestId: string }> {
  const version = await transaction.quoteVersion.findUnique({
    where: { id: quoteVersionId },
    include: {
      quote: { include: { client: true, quoteRequest: { include: { detail: true, contact: true, currentAssignee: true } } } },
      lines: true,
      sections: true,
      taxProfile: true,
      termsVersion: true,
      createdBy: true,
    },
  });
  if (!version || !version.quote.quoteRequest.detail) throw new AppError('CONFLICT', 'La cotización no tiene un expediente comercial completo.', 409);
  const detail = version.quote.quoteRequest.detail;
  const sections = orderQuoteSections(version.sections);
  const lines = orderQuoteLines(version.lines, sections);
  return {
    quoteRequestId: version.quote.quoteRequestId,
    snapshot: {
      folio: version.quote.quoteRequest.folio,
      versionNumber: version.versionNumber,
      issuedAt,
      clientName: version.quote.client.displayName,
      contactName: version.quote.quoteRequest.contact.displayName,
      advisorName: version.quote.quoteRequest.currentAssignee?.displayName ?? version.createdBy.displayName,
      projectType: detail.projectType,
      location: detail.location,
      description: detail.description,
      currencyCode: version.currencyCode,
      validUntil: version.validUntil,
      taxLabel: version.taxProfile?.name ?? null,
      sections: sections.map((section) => ({ key: section.id, title: section.title, description: section.description })),
      lines: lines.map((line) => ({
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantityMilliunits: line.quantityMilliunits,
        unitPriceMinor: line.unitPriceMinor,
        discountBasisPoints: line.discountBasisPoints,
        discountMinor: line.discountMinor,
        // Versiones anteriores a D1 no guardaban la base gravable por partida.
        taxableMinor: line.taxableMinor !== 0n || line.totalMinor === 0n ? line.taxableMinor : line.totalMinor - line.taxMinor,
        taxMinor: line.taxMinor,
        totalMinor: line.totalMinor,
        sectionKey: line.sectionId,
      })),
      scopeText: version.scopeText,
      exclusionsText: version.exclusionsText,
      paymentTermsText: version.paymentTermsText,
      warrantyText: version.warrantyText,
      publicNotesText: version.publicNotesText,
      terms: version.termsVersion
        ? { title: version.termsVersion.title, versionTag: version.termsVersion.versionTag, bodyMarkdown: version.termsVersion.bodyMarkdown, privacyMarkdown: version.termsVersion.privacyMarkdown }
        : null,
      subtotalMinor: version.subtotalMinor,
      discountTotalMinor: version.discountTotalMinor,
      taxableTotalMinor: version.taxableTotalMinor,
      taxTotalMinor: version.taxTotalMinor,
      totalMinor: version.totalMinor,
    },
  };
}
```

y en `generateQuotePdf` cambiar la llamada a `loadSnapshot(transaction, quoteVersionId, now)`.

- [ ] **Step 2: `scripts/render-quote-pdf-fixture.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderQuotePdf, type QuotePdfLine, type QuotePdfSection } from '../src/server/modules/quote-documents/pdf-renderer';

// Muestra realista del PDF de cotización: output/pdf/quote-pdf-fixture.pdf.
const outputDirectory = 'output/pdf';
const outputPath = `${outputDirectory}/quote-pdf-fixture.pdf`;
const terms = await readFile('docs/legal/terminos-y-privacidad-comercial.md', 'utf8');
const privacyStart = terms.indexOf('## Aviso de privacidad simplificado');

const sections: QuotePdfSection[] = [
  { key: 'obra', title: 'Obra civil', description: 'Trazo, excavación y estructura del vaso de concreto armado.' },
  { key: 'equipo', title: 'Equipamiento y filtración', description: 'Equipos instalados, probados y con arranque supervisado.' },
  { key: 'acabados', title: 'Acabados' },
];

type Seed = readonly [name: string, description: string | null, unit: string, quantityMilliunits: bigint, unitPriceMinor: bigint, discountBasisPoints: number, sectionKey: string | null];
const seeds: Seed[] = [
  ['Excavación y trazo', 'Excavación a máquina, afine manual y retiro de material según planos del proyecto.', 'm³', 48_500n, 38_000n, 0, 'obra'],
  ['Cimentación y armado de acero', 'Plantilla de concreto, armado con varilla corrugada de 3/8" y cimbra perimetral.', 'm²', 36_000n, 115_000n, 0, 'obra'],
  ['Muros y losa de concreto armado', "Concreto f'c = 250 kg/cm² impermeable, vibrado y curado.", 'm³', 14_000n, 385_000n, 0, 'obra'],
  ['Bomba de filtración de velocidad variable 1.5 HP', null, 'pieza', 1_000n, 1_890_000n, 1_000, 'equipo'],
  ['Filtro de arena de 24"', 'Incluye carga de arena sílica y válvula selectora de 6 posiciones.', 'pieza', 1_000n, 1_240_000n, 0, 'equipo'],
  ['Iluminación LED RGB subacuática', 'Luminarias de 35 W con control remoto y transformador de seguridad.', 'pieza', 4_000n, 425_000n, 0, 'equipo'],
  ['Sistema de cloración salina', null, 'pieza', 1_000n, 2_150_000n, 0, 'equipo'],
  ['Recubrimiento de mosaico veneciano', 'Mosaico de vidrio 2 × 2 cm en tonos arena, con adhesivo y boquilla epóxica.', 'm²', 64_000n, 89_000n, 0, 'acabados'],
  ['Coronamiento de cantera', null, 'ml', 34_000n, 105_000n, 0, 'acabados'],
  ['Supervisión técnica de obra', 'Visitas semanales del residente de obra y bitácora fotográfica.', 'servicio', 1_000n, 1_500_000n, 0, null],
];

const lines: QuotePdfLine[] = seeds.map(([name, description, unit, quantityMilliunits, unitPriceMinor, discountBasisPoints, sectionKey]) => {
  const gross = (quantityMilliunits * unitPriceMinor) / 1_000n;
  const discountMinor = (gross * BigInt(discountBasisPoints)) / 10_000n;
  const taxableMinor = gross - discountMinor;
  const taxMinor = (taxableMinor * 16n) / 100n;
  return { name, description, unit, quantityMilliunits, unitPriceMinor, discountBasisPoints, discountMinor, taxableMinor, taxMinor, totalMinor: taxableMinor + taxMinor, sectionKey };
});

const subtotalMinor = lines.reduce((sum, line) => sum + ((line.quantityMilliunits * line.unitPriceMinor) / 1_000n), 0n);
const discountTotalMinor = lines.reduce((sum, line) => sum + line.discountMinor, 0n);
const taxableTotalMinor = lines.reduce((sum, line) => sum + line.taxableMinor, 0n);
const taxTotalMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0n);

const rendered = await renderQuotePdf({
  folio: 'OCQ-2026-001156',
  versionNumber: 2,
  issuedAt: new Date('2026-09-28T18:00:00.000Z'),
  clientName: 'Residencial Las Palmas, S.A. de C.V.',
  contactName: 'Ana López',
  advisorName: 'Laura Méndez',
  projectType: 'Alberca residencial',
  location: 'Culiacán, Sinaloa',
  description: 'Alberca para residencia familiar.',
  currencyCode: 'MXN',
  validUntil: new Date('2026-10-16T05:59:59.999Z'),
  taxLabel: 'IVA 16%',
  sections,
  lines,
  scopeText: 'Diseño ejecutivo, construcción y equipamiento de una alberca residencial de 8.00 × 4.00 m con profundidad variable de 1.20 a 1.80 m.\n- Trazo, excavación y obra civil completa del vaso.\n- Suministro e instalación del sistema de filtración, iluminación y cloración salina.\n- Acabados de mosaico veneciano y coronamiento de cantera.\n- Pruebas hidráulicas, arranque y capacitación de uso.',
  exclusionsText: '- Permisos y licencias municipales.\n- Acometida eléctrica hasta el cuarto de máquinas.\n- Obras exteriores fuera del perímetro de la alberca.',
  paymentTermsText: '1. 50 % de anticipo a la aceptación.\n2. 30 % al concluir la obra civil.\n3. 20 % contra entrega y arranque del sistema.',
  warrantyText: 'Garantía de 5 años en estructura e impermeabilidad y de 1 año en equipos, conforme a las condiciones del fabricante.',
  publicNotesText: 'Tiempo estimado de ejecución: 8 a 10 semanas a partir del anticipo. Los precios incluyen materiales, mano de obra y fletes dentro de la zona metropolitana.',
  terms: {
    title: 'Condiciones comerciales y aviso de privacidad OCPOOL',
    versionTag: 'v1',
    bodyMarkdown: terms.slice(terms.indexOf('## 1. Objeto'), privacyStart).trim(),
    privacyMarkdown: terms.slice(privacyStart).trim(),
  },
  subtotalMinor,
  discountTotalMinor,
  taxableTotalMinor,
  taxTotalMinor,
  totalMinor: taxableTotalMinor + taxTotalMinor,
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, rendered.bytes);
console.log(JSON.stringify({ outputPath, ...rendered, bytes: undefined }, null, 2));
```

- [ ] **Step 3:**
  - `npx tsx scripts/render-quote-pdf-fixture.ts` → PDF de unas 3 a 4 páginas, menos de 150 KB.
  - `pdftoppm -r 80 -png output/pdf/quote-pdf-fixture.pdf <scratch>/pdf/page` → revisar cada página y ajustar espaciados.
  - `pdftotext` → confirmar que se extraen los textos, los acentos, el importe con letra y "Página X de Y".
- [ ] **Step 4:** `npm run typecheck` → sin errores (incluye `tests/integration/quotes-service.test.ts`, que usa el tipo `QuotePdfSnapshot`).
- [ ] **Step 5: Commit** — `git add src/server/modules/quote-documents/service.ts scripts/render-quote-pdf-fixture.ts && git commit -m "feat(pdf): la foto de la cotización incluye secciones, textos comerciales, condiciones y asesor"`

---

### Task 8: Verificación final

- [ ] `npm run typecheck` → sin errores.
- [ ] `npm run lint` → sin errores.
- [ ] `npx vitest run tests/unit` → todo en verde.
- [ ] `NEXT_DIST_DIR=.next-verify npm run build` → compila (valida que `@pdf-lib/fontkit` y las rutas de assets funcionen dentro del bundle de Next). Si la compilación exige una base de datos real para prerenderizar, documentarlo y apoyarse en typecheck y pruebas.
- [ ] Revisión visual final: 14 vistas previas de correo (escritorio y móvil) y todas las páginas del PDF de muestra.
- [ ] Crear el bundle de la rama para aplicarla en producción y redactar los pasos de despliegue (pull del bundle, `npm install`, `npm run build`, reiniciar `ocpool-website` y `ocpool-notifications`).
