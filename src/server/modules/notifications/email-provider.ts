import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { normalizeNotificationEmail } from '@/server/modules/notifications/domain';
import { readServerEnv } from '@/server/env';

export type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SentMessageInfo = { messageId?: string | null };
type EmailTransport = { sendMail: (message: SendMailOptions) => Promise<SentMessageInfo> };
type EmailProviderDependencies = { transportFactory?: (options: SmtpTransportOptions) => EmailTransport };

export type SmtpEmailProviderConfig = SmtpTransportOptions & {
  fromEmail: string;
  fromName: string;
  replyTo?: string;
};

export type EmailProviderErrorCode = 'SMTP_PROVIDER_ERROR' | 'SMTP_CONFIGURATION_ERROR' | 'SMTP_INVALID_RECIPIENT';

export class EmailProviderError extends Error {
  readonly code: EmailProviderErrorCode;

  constructor(code: EmailProviderErrorCode = 'SMTP_PROVIDER_ERROR') {
    super('The email provider could not accept the message.');
    this.name = 'EmailProviderError';
    this.code = code;
  }
}

type NodemailerErrorLike = { code?: unknown; command?: unknown; responseCode?: unknown };

/**
 * Nodemailer's SMTP transport reports a small, documented set of failure shapes (`err.code`,
 * plus `err.command`/`err.responseCode` when the failure came from an actual server response).
 * Collapsing all of them into one generic, always-retryable error would retry a broken
 * credential or a permanently bounced address forever instead of surfacing it. `EENVELOPE`
 * without a `responseCode` is a local pre-flight rejection (malformed address, never reached
 * the server) and a 5xx `responseCode` is a permanent server rejection — both mean retrying
 * won't help. A 4xx `responseCode` (e.g. greylisting) is genuinely temporary and falls through
 * to the default, retryable classification.
 */
function classifySmtpFailure(error: unknown): EmailProviderErrorCode {
  const err = error as NodemailerErrorLike;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  const command = typeof err?.command === 'string' ? err.command : undefined;
  const responseCode = typeof err?.responseCode === 'number' ? err.responseCode : undefined;
  if (code === 'EAUTH') return 'SMTP_CONFIGURATION_ERROR';
  if (code === 'EENVELOPE' && command === 'MAIL FROM') return 'SMTP_CONFIGURATION_ERROR';
  if (code === 'EENVELOPE' && (responseCode === undefined || responseCode >= 500)) return 'SMTP_INVALID_RECIPIENT';
  return 'SMTP_PROVIDER_ERROR';
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const MAX_BODY_CHARACTERS = 200_000;

function validateHeader(value: string, field: string): string {
  if (!value || CONTROL_CHARACTERS.test(value) || value.length > 240) throw new Error(`Invalid email ${field}.`);
  return value;
}

function validateConfig(config: SmtpEmailProviderConfig): SmtpEmailProviderConfig {
  if (!config.host || config.host.length > 253 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw new Error('Invalid SMTP configuration.');
  if (typeof config.secure !== 'boolean') throw new Error('Invalid SMTP security configuration.');
  const fromEmail = normalizeNotificationEmail(config.fromEmail);
  const replyTo = config.replyTo ? normalizeNotificationEmail(config.replyTo) : undefined;
  return { ...config, fromEmail, fromName: validateHeader(config.fromName, 'from name'), ...(replyTo ? { replyTo } : {}) };
}

function defaultTransportFactory(options: SmtpTransportOptions): EmailTransport {
  return nodemailer.createTransport({ ...options, disableFileAccess: true, disableUrlAccess: true });
}

export function createSmtpEmailProvider(input: SmtpEmailProviderConfig, dependencies: EmailProviderDependencies = {}): EmailProvider {
  const config = validateConfig(input);
  const transport = (dependencies.transportFactory ?? defaultTransportFactory)({ host: config.host, port: config.port, secure: config.secure, ...(config.auth ? { auth: config.auth } : {}) });

  return {
    async send(message) {
      const to = normalizeNotificationEmail(message.to);
      const subject = validateHeader(message.subject, 'subject');
      if (!message.text || !message.html || message.text.length > MAX_BODY_CHARACTERS || message.html.length > MAX_BODY_CHARACTERS) throw new Error('Invalid email body.');
      try {
        const info = await transport.sendMail({
          to,
          subject,
          text: message.text,
          html: message.html,
          from: { name: config.fromName, address: config.fromEmail },
          ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        });
        return { providerMessageId: info.messageId ?? null };
      } catch (error) {
        throw new EmailProviderError(classifySmtpFailure(error));
      }
    },
  };
}

export function createSmtpEmailProviderFromEnv(): EmailProvider {
  const env = readServerEnv();
  return createSmtpEmailProvider({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    fromEmail: env.SMTP_FROM_EMAIL,
    fromName: env.SMTP_FROM_NAME,
    ...(env.SMTP_REPLY_TO ? { replyTo: env.SMTP_REPLY_TO } : {}),
    ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });
}
