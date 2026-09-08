import { describe, expect, it } from 'vitest';
import {
  buildNotificationUrl,
  mapNotificationEvent,
  NOTIFICATION_TEMPLATE_KEYS,
  renderNotificationTemplate,
} from '@/server/modules/notifications/templates';

const recipient = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  displayName: 'Ana <script>alert(1)</script>',
  audience: 'CUSTOMER' as const,
};

describe('notification mappers and templates', () => {
  it('maps only allowlisted events and keeps authentication ciphertext out of safe payloads', () => {
    const result = mapNotificationEvent({
      eventType: 'AUTH.CUSTOMER_MAGIC_LINK',
      aggregateType: 'USER',
      aggregateId: recipient.userId,
      payload: {
        tokenId: '00000000-0000-4000-8000-000000000002',
        tokenCiphertext: 'v1.secret-material-that-must-not-be-rendered',
        tokenType: 'MAGIC_LINK',
      },
    }, { recipient, expiresMinutes: 15 });

    expect(result.kind).toBe('INTENT');
    if (result.kind !== 'INTENT') throw new Error('Expected notification intent.');
    expect(result.templateKey).toBe('auth.customer.magic_link');
    expect(JSON.stringify(result.safePayload)).not.toContain('secret-material');
    expect(result.transient?.tokenCiphertext).toContain('secret-material');

    const wrongAggregate = mapNotificationEvent({
      eventType: 'AUTH.CUSTOMER_MAGIC_LINK',
      aggregateType: 'QUOTE',
      aggregateId: recipient.userId,
      payload: {
        tokenId: '00000000-0000-4000-8000-000000000002',
        tokenCiphertext: 'v1.secret-material-that-must-not-be-rendered',
        tokenType: 'MAGIC_LINK',
      },
    }, { recipient });
    expect(wrongAggregate.kind).toBe('REJECTED');

    expect(mapNotificationEvent({ eventType: 'UNKNOWN.EVENT', aggregateType: 'UNKNOWN', aggregateId: null, payload: {} }, { recipient }).kind).toBe('UNSUPPORTED_EVENT');
  });

  it('rejects internal messages and payloads with unexpected fields', () => {
    const internal = mapNotificationEvent({
      eventType: 'MESSAGE.CREATED',
      aggregateType: 'CONVERSATION',
      aggregateId: '00000000-0000-4000-8000-000000000003',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000003',
        quoteRequestId: '00000000-0000-4000-8000-000000000004',
        clientId: '00000000-0000-4000-8000-000000000005',
        messageId: '00000000-0000-4000-8000-000000000006',
        visibility: 'INTERNAL',
        folio: 'OCQ-2026-000001',
      },
    }, { recipient });

    expect(internal.kind).toBe('REJECTED');
    expect(() => mapNotificationEvent({
      eventType: 'REQUEST.RECEIVED',
      aggregateType: 'QUOTE_REQUEST',
      aggregateId: '00000000-0000-4000-8000-000000000007',
      payload: { quoteRequestId: '00000000-0000-4000-8000-000000000007', folio: 'OCQ-2026-000002', origin: 'PUBLIC_FORM', extra: 'unexpected' },
    }, { recipient })).not.toThrow();
  });

  it('bounds enriched user-controlled notification fields before persistence', () => {
    const result = mapNotificationEvent({
      eventType: 'MESSAGE.CREATED',
      aggregateType: 'CONVERSATION',
      aggregateId: '00000000-0000-4000-8000-000000000003',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000003',
        quoteRequestId: '00000000-0000-4000-8000-000000000004',
        clientId: '00000000-0000-4000-8000-000000000005',
        messageId: '00000000-0000-4000-8000-000000000006',
        visibility: 'CUSTOMER',
        folio: 'OCQ-2026-000001',
      },
    }, { recipient: { ...recipient, displayName: 'Ana\u0000' }, senderName: 'S'.repeat(1000), messagePreview: 'P'.repeat(10_000) });

    expect(result.kind).toBe('REJECTED');

    const bounded = mapNotificationEvent({
      eventType: 'MESSAGE.CREATED',
      aggregateType: 'CONVERSATION',
      aggregateId: '00000000-0000-4000-8000-000000000003',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000003',
        quoteRequestId: '00000000-0000-4000-8000-000000000004',
        clientId: '00000000-0000-4000-8000-000000000005',
        messageId: '00000000-0000-4000-8000-000000000006',
        visibility: 'CUSTOMER',
        folio: 'OCQ-2026-000001',
      },
    }, { recipient, senderName: 'S'.repeat(1000), messagePreview: 'P'.repeat(10_000) });

    expect(bounded.kind).toBe('INTENT');
    if (bounded.kind === 'INTENT') {
      expect(String(bounded.safePayload.senderName)).toHaveLength(180);
      expect(String(bounded.safePayload.preview)).toHaveLength(500);
    }
  });

  it('escapes dynamic HTML and preserves a text alternative', () => {
    const rendered = renderNotificationTemplate({
      templateKey: 'message.created',
      templateVersion: 'v1',
      data: {
        appUrl: 'http://localhost:3000',
        recipientName: 'Ana <script>alert(1)</script>',
        folio: 'OCQ-2026-000001',
        senderName: 'Carlos & Asociados',
        preview: '<img src=x onerror=alert(1)>',
        actionUrl: 'http://localhost:3000/portal/requests/00000000-0000-4000-8000-000000000001/messages',
      },
    });

    expect(rendered.subject).toBe('Nuevo mensaje sobre tu expediente OCQ-2026-000001');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.text).toContain('<img src=x onerror=alert(1)>');
    expect(rendered.html).toContain('href="http://localhost:3000/portal/requests/00000000-0000-4000-8000-000000000001/messages"');
  });

  it('only creates links under the configured application origin and allowlisted paths', () => {
    expect(buildNotificationUrl('https://portal.example.test', '/portal/requests/abc')).toBe('https://portal.example.test/portal/requests/abc');
    expect(() => buildNotificationUrl('https://portal.example.test', 'https://evil.example.test/phishing')).toThrow();
    expect(() => buildNotificationUrl('https://portal.example.test', '/admin/users')).toThrow();
    expect(() => buildNotificationUrl('https://portal.example.test', '/portal/%0d%0aBcc:attacker@example.test')).toThrow();
  });

  it('renders every registered v1 template with both delivery representations', () => {
    for (const templateKey of NOTIFICATION_TEMPLATE_KEYS) {
      const rendered = renderNotificationTemplate({
        templateKey,
        templateVersion: 'v1',
        data: {
          appUrl: 'http://localhost:3000',
          recipientName: 'Ana',
          actionUrl: 'http://localhost:3000/portal',
          folio: 'OCQ-2026-000001',
          versionNumber: 2,
          totalLabel: '$10,000 MXN',
          senderName: 'OCPOOL',
          preview: 'Mensaje de prueba',
          fileName: 'planos.pdf',
          expiresMinutes: 15,
        },
      });

      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(rendered.html).toContain('<!doctype html>');
    }
  });
});
