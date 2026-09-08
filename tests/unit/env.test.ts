import { describe, expect, it } from 'vitest';
import { readServerEnv } from '@/server/env';

describe('readServerEnv', () => {
  it('accepts a valid PostgreSQL environment', () => {
    expect(readServerEnv({
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      APP_URL: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      TRUST_PROXY_HEADERS: 'false',
      SESSION_TTL_HOURS: '24',
      AUTH_TOKEN_TTL_MINUTES: '15',
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '5',
      AUTH_RATE_LIMIT_WINDOW_MINUTES: '15',
    })).toMatchObject({
      APP_URL: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      TRUST_PROXY_HEADERS: false,
      SESSION_TTL_HOURS: 24,
      AUTH_TOKEN_TTL_MINUTES: 15,
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: 5,
      AUTH_RATE_LIMIT_WINDOW_MINUTES: 15,
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

  it('rejects an invalid MFA key and out-of-range auth policies', () => {
    expect(() => readServerEnv({
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      MFA_ENCRYPTION_KEY: 'not-a-32-byte-base64-key',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      SESSION_TTL_HOURS: '0',
      AUTH_TOKEN_TTL_MINUTES: '60',
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '2',
      AUTH_RATE_LIMIT_WINDOW_MINUTES: '120',
    })).toThrow();
  });
});
