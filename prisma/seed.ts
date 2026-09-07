import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

try {
  await prisma.systemSetting.upsert({
    where: { key: 'system.schema_version' },
    update: { value: { version: 1 } },
    create: { key: 'system.schema_version', value: { version: 1 } },
  });
  console.log('Foundation seed completed.');
} finally {
  await prisma.$disconnect();
}
