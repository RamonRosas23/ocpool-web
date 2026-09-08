import { describe, expect, it } from 'vitest';
import { readServerEnv } from '@/server/env';

describe('readServerEnv', () => {
  it('accepts a valid PostgreSQL environment', () => {
    expect(readServerEnv({
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      APP_URL: 'http://localhost:3000',
      APP_TIMEZONE: 'America/Chihuahua',
      LOG_LEVEL: 'info',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '11025',
      SMTP_SECURE: 'false',
      SMTP_FROM_EMAIL: 'no-reply@ocpool.local',
      SMTP_FROM_NAME: 'OCPOOL',
      NOTIFICATION_BATCH_SIZE: '25',
      NOTIFICATION_LEASE_SECONDS: '300',
      NOTIFICATION_MAX_ATTEMPTS: '5',
      NOTIFICATION_POLL_INTERVAL_MS: '2000',
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
      TRUST_PROXY_HEADERS: 'false',
      SESSION_TTL_HOURS: '24',
      AUTH_TOKEN_TTL_MINUTES: '15',
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '5',
      AUTH_RATE_LIMIT_WINDOW_MINUTES: '15',
      AUTH_GLOBAL_RATE_LIMIT_MAX_ATTEMPTS: '300',
      AUTH_GLOBAL_RATE_LIMIT_WINDOW_MINUTES: '1',
      ANALYTICS_RATE_LIMIT_MAX_ATTEMPTS: '120',
      ANALYTICS_RATE_LIMIT_WINDOW_MINUTES: '1',
    })).toMatchObject({
      APP_URL: 'http://localhost:3000',
      APP_TIMEZONE: 'America/Chihuahua',
      LOG_LEVEL: 'info',
      SMTP_HOST: 'localhost',
      SMTP_PORT: 11025,
      SMTP_SECURE: false,
      SMTP_FROM_EMAIL: 'no-reply@ocpool.local',
      SMTP_FROM_NAME: 'OCPOOL',
      NOTIFICATION_BATCH_SIZE: 25,
      NOTIFICATION_LEASE_SECONDS: 300,
      NOTIFICATION_MAX_ATTEMPTS: 5,
      NOTIFICATION_POLL_INTERVAL_MS: 2000,
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
      TRUST_PROXY_HEADERS: false,
      SESSION_TTL_HOURS: 24,
      AUTH_TOKEN_TTL_MINUTES: 15,
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: 5,
      AUTH_RATE_LIMIT_WINDOW_MINUTES: 15,
      AUTH_GLOBAL_RATE_LIMIT_MAX_ATTEMPTS: 300,
      AUTH_GLOBAL_RATE_LIMIT_WINDOW_MINUTES: 1,
      ANALYTICS_RATE_LIMIT_MAX_ATTEMPTS: 120,
      ANALYTICS_RATE_LIMIT_WINDOW_MINUTES: 1,
    });
  });

  it('rejects an absent database URL', () => {
    expect(() => readServerEnv({ APP_URL: 'http://localhost:3000' })).toThrow();
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => readServerEnv({
      DATABASE_URL: 'sqlite://local.db',
      APP_URL: 'http://localhost:3000',
    })).toThrow();
  });

  it('rejects incomplete SMTP credentials and unsafe sender headers', () => {
    const base = {
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
    };

    expect(() => readServerEnv({ ...base, SMTP_USER: 'mailer' })).toThrow();
    expect(() => readServerEnv({ ...base, SMTP_FROM_NAME: 'OCPOOL\r\nBcc:evil@example.test' })).toThrow();
  });

  it('rejects an invalid MFA key and out-of-range auth policies', () => {
    expect(() => readServerEnv({
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      MFA_ENCRYPTION_KEY: 'not-a-32-byte-base64-key',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
      SESSION_TTL_HOURS: '0',
      AUTH_TOKEN_TTL_MINUTES: '60',
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '2',
      AUTH_RATE_LIMIT_WINDOW_MINUTES: '120',
      AUTH_GLOBAL_RATE_LIMIT_MAX_ATTEMPTS: '10',
    })).toThrow();
  });

  it('accepts the configured business timezone and rejects unknown zones', () => {
    const base = {
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      NOTIFICATION_RECIPIENT_ENCRYPTION_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
    };

    expect(readServerEnv({ ...base, APP_TIMEZONE: 'America/Chihuahua' }).APP_TIMEZONE).toBe('America/Chihuahua');
    expect(() => readServerEnv({ ...base, APP_TIMEZONE: 'Invalid/Zone' })).toThrow();
  });
});
