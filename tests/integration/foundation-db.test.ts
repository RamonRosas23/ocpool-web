import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';

describe('foundation PostgreSQL schema', () => {
  it('persists and reads an idempotent system setting', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const key = 'test.foundation.schema';
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value: { verified: true } },
      create: { key, value: { verified: true } },
    });

    expect(setting.key).toBe(key);
    expect(setting.value).toEqual({ verified: true });

    await prisma.systemSetting.delete({ where: { key } });
  }, 15_000);

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS === '1') await getPrisma().$disconnect();
  });
});
