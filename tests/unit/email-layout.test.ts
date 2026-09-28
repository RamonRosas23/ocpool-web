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
    expect(output).not.toContain('background-color:#F9F7F2;border:1px solid #E6E0D4;');
  });
});
