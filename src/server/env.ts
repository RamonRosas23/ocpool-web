import { z } from 'zod';

const integerEnv = (defaultValue: number, minimum: number, maximum: number) => z.coerce.number().int().min(minimum).max(maximum).default(defaultValue);

const encryptionKey = z.string().refine((value) => {
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
  MFA_ENCRYPTION_KEY: encryptionKey,
  AUTH_DELIVERY_ENCRYPTION_KEY: encryptionKey,
  STORAGE_S3_ENDPOINT: z.string().url().default('http://localhost:19000'),
  STORAGE_S3_REGION: z.string().min(1).max(32).default('us-east-1'),
  STORAGE_S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).default('ocpool-private'),
  STORAGE_S3_ACCESS_KEY: z.string().min(8).max(128).default('ocpool_minio'),
  STORAGE_S3_SECRET_KEY: z.string().min(8).max(256).default('ocpool_minio_dev'),
  STORAGE_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  STORAGE_MAX_FILE_BYTES: integerEnv(25 * 1024 * 1024, 1, 25 * 1024 * 1024),
  TRUST_PROXY_HEADERS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SESSION_TTL_HOURS: integerEnv(24, 1, 168),
  AUTH_TOKEN_TTL_MINUTES: integerEnv(15, 5, 30),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: integerEnv(5, 3, 20),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: integerEnv(15, 1, 60),
  AUTH_GLOBAL_RATE_LIMIT_MAX_ATTEMPTS: integerEnv(300, 20, 10_000),
  AUTH_GLOBAL_RATE_LIMIT_WINDOW_MINUTES: integerEnv(1, 1, 10),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(source: Partial<NodeJS.ProcessEnv> = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
