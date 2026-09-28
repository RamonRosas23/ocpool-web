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
  // Cada dato de contacto va entero (el teléfono no se parte); el renglón sólo se corta entre datos.
  const link = `color:${C.navy};text-decoration:none;white-space:nowrap;`;
  if (audience === 'staff') {
    return `<tr><td align="center" style="padding:26px 32px 0;font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:${C.muted};">${escapeHtml(STAFF_EMAIL_FOOTER)}</td></tr>`
      + `<tr><td align="center" style="padding:12px 32px 0;font-family:${FONT_SERIF};font-size:13px;line-height:1.4;letter-spacing:4px;color:${C.navy};">${brandIdentity.name}</td></tr>`;
  }
  const separator = '&nbsp;&nbsp;&middot;&nbsp; ';
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
