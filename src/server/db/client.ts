import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { readServerEnv } from '@/server/env';

type PrismaGlobal = typeof globalThis & { __ocpoolPrisma?: PrismaClient };
let localPrisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  const globalWithPrisma = globalThis as PrismaGlobal;
  if (globalWithPrisma.__ocpoolPrisma) return globalWithPrisma.__ocpoolPrisma;

  if (localPrisma) return localPrisma;

  const { DATABASE_URL } = readServerEnv();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const client = new PrismaClient({ adapter });

  localPrisma = client;
  if (process.env.NODE_ENV !== 'production') globalWithPrisma.__ocpoolPrisma = client;
  return client;
}
