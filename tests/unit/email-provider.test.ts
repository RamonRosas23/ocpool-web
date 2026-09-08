import { describe, expect, it } from 'vitest';
import type { SendMailOptions } from 'nodemailer';
import { createSmtpEmailProvider, type SmtpTransportOptions } from '@/server/modules/notifications/email-provider';

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
});
