import { z } from 'zod';

const integerEnv = (defaultValue: number, minimum: number, maximum: number) => z.coerce.number().int().min(minimum).max(maximum).default(defaultValue);

const mfaEncryptionKey = z.string().refine((value) => {
  if (value.length !== 44 || !value.endsWith('=')) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}, 'MFA_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key');

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must be a PostgreSQL connection string',
  }),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MFA_ENCRYPTION_KEY: mfaEncryptionKey,
  SESSION_TTL_HOURS: integerEnv(24, 1, 168),
  AUTH_TOKEN_TTL_MINUTES: integerEnv(15, 5, 30),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: integerEnv(5, 3, 20),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: integerEnv(15, 1, 60),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
