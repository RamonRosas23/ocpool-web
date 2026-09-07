import { describe, expect, it } from 'vitest';
import { checkDatabase } from '@/server/db/health';

describe('checkDatabase', () => {
  it('returns ok when the database query succeeds', async () => {
    const client = {
      $queryRawUnsafe: async () => [],
    };

    await expect(checkDatabase(client as never)).resolves.toEqual({ status: 'ok' });
  });

  it('returns unavailable when the database query fails', async () => {
    const client = {
      $queryRawUnsafe: async () => {
        throw new Error('connection refused');
      },
    };

    await expect(checkDatabase(client as never)).resolves.toEqual({ status: 'unavailable' });
  });
});
