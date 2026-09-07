import { describe, expect, it } from 'vitest';
import { readServerEnv } from '@/server/env';

describe('readServerEnv', () => {
  it('accepts a valid PostgreSQL environment', () => {
    expect(readServerEnv({
      DATABASE_URL: 'postgresql://ocpool:secret@localhost:55432/ocpool_dev?schema=public',
      APP_URL: 'http://localhost:3000',
      LOG_LEVEL: 'info',
    })).toMatchObject({
      APP_URL: 'http://localhost:3000',
      LOG_LEVEL: 'info',
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
});
