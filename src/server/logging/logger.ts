import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'authorization',
      'cookie',
      'set-cookie',
      'DATABASE_URL',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.authorization',
      '*.cookie',
      '*.set-cookie',
      '*.DATABASE_URL',
    ],
    censor: '[REDACTED]',
  },
});
