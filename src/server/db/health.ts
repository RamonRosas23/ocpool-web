import type { PrismaClient } from '@/generated/prisma/client';
import { getPrisma } from '@/server/db/client';

export type DatabaseHealth =
  | { status: 'ok' }
  | { status: 'unavailable' };

export async function checkDatabase(client?: PrismaClient): Promise<DatabaseHealth> {
  try {
    const database = client ?? getPrisma();
    await database.$queryRawUnsafe('SELECT 1');
    return { status: 'ok' };
  } catch {
    return { status: 'unavailable' };
  }
}
