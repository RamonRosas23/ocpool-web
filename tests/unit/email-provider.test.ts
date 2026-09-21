import { describe, expect, it } from 'vitest';
import type { SendMailOptions } from 'nodemailer';
import { createSmtpEmailProvider, EmailProviderError, type SmtpTransportOptions } from '@/server/modules/notifications/email-provider';

function providerThatRejectsWith(rejection: unknown) {
  return createSmtpEmailProvider({ host: 'localhost', port: 11025, secure: false, fromEmail: 'no-reply@ocpool.local', fromName: 'OCPOOL' }, {
    transportFactory: () => ({ sendMail: async () => { throw rejection; } }),
  });
}

describe('SMTP email provider', () => {
  it('sends a safe HTML/text message through the injected transport contract', async () => {
    let capturedOptions: SmtpTransportOptions | undefined;
    let capturedMessage: SendMailOptions | undefined;
    const provider = createSmtpEmailProvider({ host: 'localhost', port: 11025, secure: false, fromEmail: 'no-reply@ocpool.local', fromName: 'OCPOOL', replyTo: 'soporte@ocpool.local' }, {
      transportFactory: (options) => {
        capturedOptions = options;
        return { sendMail: async (message) => { capturedMessage = message; return { messageId: '<mailpit-id@example.test>' }; } };
      },
    });

    await expect(provider.send({ to: 'ana@example.test', subject: 'Nueva cotización', text: 'Texto', html: '<p>Texto</p>' })).resolves.toEqual({ providerMessageId: '<mailpit-id@example.test>' });
    expect(capturedOptions).toMatchObject({ host: 'localhost', port: 11025, secure: false });
    expect(capturedMessage).toMatchObject({
      to: 'ana@example.test',
      subject: 'Nueva cotización',
      text: 'Texto',
      html: '<p>Texto</p>',
      from: { name: 'OCPOOL', address: 'no-reply@ocpool.local' },
      replyTo: 'soporte@ocpool.local',
    });
  });

  it('rejects header injection and invalid recipient data before transport', async () => {
    const provider = createSmtpEmailProvider({ host: 'localhost', port: 11025, secure: false, fromEmail: 'no-reply@ocpool.local', fromName: 'OCPOOL' }, {
      transportFactory: () => ({ sendMail: async () => ({ messageId: 'never' }) }),
    });

    await expect(provider.send({ to: 'ana@example.test\r\nBcc:evil@example.test', subject: 'Hola', text: 'Texto', html: '<p>Texto</p>' })).rejects.toThrow();
    await expect(provider.send({ to: 'ana@example.test', subject: 'Hola\nBcc:evil@example.test', text: 'Texto', html: '<p>Texto</p>' })).rejects.toThrow();
  });

  const message = { to: 'ana@example.test', subject: 'Hola', text: 'Texto', html: '<p>Texto</p>' };

  it('H1-03 SMTP fix: classifies a bad credential as a configuration error, never a retryable one', async () => {
    const provider = providerThatRejectsWith(Object.assign(new Error('Invalid login'), { code: 'EAUTH', command: 'AUTH PLAIN' }));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_CONFIGURATION_ERROR' });
  });

  it('H1-03 SMTP fix: classifies a rejected MAIL FROM as a configuration error, not the recipient', async () => {
    const provider = providerThatRejectsWith(Object.assign(new Error('Sender rejected'), { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 550 }));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_CONFIGURATION_ERROR' });
  });

  it('H1-03 SMTP fix: classifies a permanent RCPT TO rejection (5xx) as an invalid recipient', async () => {
    const provider = providerThatRejectsWith(Object.assign(new Error('550 no such user'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_INVALID_RECIPIENT' });
  });

  it('H1-03 SMTP fix: classifies a local pre-flight envelope rejection (no server response) as an invalid recipient', async () => {
    const provider = providerThatRejectsWith(Object.assign(new Error("Invalid recipient '<>'"), { code: 'EENVELOPE', command: 'API' }));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_INVALID_RECIPIENT' });
  });

  it('H1-03 SMTP fix: keeps a temporary RCPT TO rejection (4xx, e.g. greylisting) retryable rather than invalid-recipient', async () => {
    const provider = providerThatRejectsWith(Object.assign(new Error('450 mailbox temporarily unavailable'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450 }));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_PROVIDER_ERROR' });
  });

  it('H1-03 SMTP fix: keeps connection/timeout failures as the generic retryable provider error', async () => {
    const provider = providerThatRejectsWith(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_PROVIDER_ERROR' });
  });

  it('H1-03 SMTP fix: defaults to the generic retryable provider error for a rejection with no code at all', async () => {
    const provider = providerThatRejectsWith(new Error('socket hang up'));
    await expect(provider.send(message)).rejects.toBeInstanceOf(EmailProviderError);
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'SMTP_PROVIDER_ERROR' });
  });
});
