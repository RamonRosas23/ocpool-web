import { describe, expect, it } from 'vitest';
import { assertProductionPolicy } from '@/server/security/production-policy';

const exampleKeyA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const exampleKeyB = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const exampleKeyC = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';

const baseProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://ocpool:production-secret@db.example.net:5432/ocpool?schema=public',
  APP_URL: 'https://app.example.net',
  SMTP_HOST: 'smtp.example.net',
  SMTP_PORT: '587',
  SMTP_SECURE: 'true',
  SMTP_FROM_EMAIL: 'no-reply@example.net',
  SMTP_FROM_NAME: 'OCPOOL',
  SMTP_USER: 'mailer@example.net',
  SMTP_PASSWORD: 'production-password',
  MFA_ENCRYPTION_KEY: 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
  AUTH_DELIVERY_ENCRYPTION_KEY: 'MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMQ=',
  NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMg=',
  STORAGE_S3_ENDPOINT: 'https://storage.example.net',
  STORAGE_S3_ACCESS_KEY: 'production-access',
  STORAGE_S3_SECRET_KEY: 'production-secret',
  STORAGE_S3_FORCE_PATH_STYLE: 'false',
  TRUST_PROXY_HEADERS: 'true',
};

describe('assertProductionPolicy', () => {
  it('blocks local app, crypto, SMTP and storage configuration in production', () => {
    const result = assertProductionPolicy({
      ...baseProductionEnv,
      APP_URL: 'http://localhost:3000',
      SMTP_HOST: 'localhost',
      SMTP_SECURE: 'false',
      SMTP_FROM_EMAIL: 'no-reply@ocpool.local',
      STORAGE_S3_ENDPOINT: 'http://localhost:19000',
      STORAGE_S3_ACCESS_KEY: 'ocpool_minio',
      STORAGE_S3_SECRET_KEY: 'ocpool_minio_dev',
      MFA_ENCRYPTION_KEY: exampleKeyA,
      AUTH_DELIVERY_ENCRYPTION_KEY: exampleKeyB,
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: exampleKeyC,
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockingCodes).toEqual(expect.arrayContaining([
      'APP_URL_NOT_HTTPS',
      'APP_URL_DEVELOPMENT_HOST',
      'EXAMPLE_ENCRYPTION_KEY',
      'SMTP_DEVELOPMENT_ENDPOINT',
      'SMTP_NOT_SECURE',
      'SMTP_DEVELOPMENT_SENDER',
      'STORAGE_DEVELOPMENT_ENDPOINT',
      'STORAGE_DEVELOPMENT_CREDENTIALS',
    ]));
  });

  it('accepts an explicit non-local production configuration', () => {
    expect(assertProductionPolicy(baseProductionEnv)).toEqual({
      status: 'PASS',
      blockingCodes: [],
      warnings: [],
    });
  });

  it('does not include secret values in diagnostics', () => {
    const result = assertProductionPolicy({ ...baseProductionEnv, SMTP_PASSWORD: 'super-secret-password' });
    expect(JSON.stringify(result)).not.toContain('super-secret-password');
    expect(JSON.stringify(result)).not.toContain('production-secret');
  });

  it('warns when trusted proxy handling is not explicitly enabled', () => {
    expect(assertProductionPolicy({ ...baseProductionEnv, TRUST_PROXY_HEADERS: 'false' }).warnings).toContain('TRUST_PROXY_REVIEW_REQUIRED');
  });
});
