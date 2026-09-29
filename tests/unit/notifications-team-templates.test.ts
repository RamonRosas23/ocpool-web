import { describe, expect, it } from 'vitest';
import { renderNotificationTemplate } from '@/server/modules/notifications/templates';

const base = { appUrl: 'http://localhost:3000', recipientName: 'Ana', actionUrl: 'http://localhost:3000/staff/requests?request=abc', folio: 'OCQ-2026-000130' };

describe('team notification templates', () => {
  it('announces a new web request to managers', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'request.new_for_team', templateVersion: 'v1', data: { ...base, senderName: 'Sofía Garza', preview: 'Alberca con jacuzzi en Monterrey' } });
    expect(rendered.subject).toBe('Nueva solicitud OCQ-2026-000130');
    expect(rendered.text).toContain('Sofía Garza envió la solicitud OCQ-2026-000130');
    expect(rendered.html).toContain('Alberca con jacuzzi en Monterrey');
    expect(rendered.text).toContain('Aviso automático del espacio interno');
  });

  it('quotes a change request safely', () => {
    const rendered = renderNotificationTemplate({ templateKey: 'quote.changes_requested', templateVersion: 'v1', data: { ...base, versionNumber: 2, senderName: 'Juan <b>', preview: '<script>alert(1)</script>' } });
    expect(rendered.subject).toBe('Juan <b> pidió cambios en OCQ-2026-000130');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.text).toContain('pidió cambios a la propuesta versión 2');
  });
});
