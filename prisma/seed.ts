import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from '../src/server/auth/constants.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

export async function seedIdentityCatalog(client: PrismaClient): Promise<void> {
  const permissions = new Map<string, string>();
  for (const permission of PERMISSION_CATALOG) {
    const record = await client.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
    permissions.set(record.key, record.id);
  }

  for (const [key, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await client.role.upsert({
      where: { key },
      update: {
        name: definition.name,
        description: definition.description,
        systemManaged: definition.systemManaged,
      },
      create: {
        key,
        name: definition.name,
        description: definition.description,
        systemManaged: definition.systemManaged,
      },
    });

    for (const permissionKey of definition.permissions) {
      const permissionId = permissions.get(permissionKey);
      if (!permissionId) throw new Error(`Permission catalog is missing ${permissionKey}.`);

      await client.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
}

export async function seedCatalogDemo(client: PrismaClient): Promise<void> {
  const category = await client.catalogCategory.upsert({
    where: { code: 'DEMO-SERVICES' },
    update: { name: 'Servicios demo locales', status: 'ACTIVE', sortOrder: 100 },
    create: { code: 'DEMO-SERVICES', name: 'Servicios demo locales', status: 'ACTIVE', sortOrder: 100 },
  });
  const item = await client.catalogItem.upsert({
    where: { code: 'DEMO-CONSULTA' },
    update: {
      name: 'Consultoría demo local',
      description: 'Concepto no comercial para validar el entorno local.',
      unit: 'servicio',
      status: 'ACTIVE',
      categoryId: category.id,
    },
    create: {
      code: 'DEMO-CONSULTA',
      name: 'Consultoría demo local',
      description: 'Concepto no comercial para validar el entorno local.',
      unit: 'servicio',
      status: 'ACTIVE',
      categoryId: category.id,
    },
  });
  const priceList = await client.priceList.upsert({
    where: { code: 'DEMO-MXN' },
    update: { name: 'Lista demo MXN local', currencyCode: 'MXN', status: 'ACTIVE' },
    create: { code: 'DEMO-MXN', name: 'Lista demo MXN local', currencyCode: 'MXN', status: 'ACTIVE', validFrom: new Date('2026-01-01T00:00:00.000Z') },
  });
  await client.priceListItem.upsert({
    where: {
      priceListId_catalogItemId_validFrom: {
        priceListId: priceList.id,
        catalogItemId: item.id,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    },
    update: { unitPriceMinor: 1000n, validUntil: null },
    create: {
      priceListId: priceList.id,
      catalogItemId: item.id,
      unitPriceMinor: 1000n,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
}

export async function seedDatabase(client: PrismaClient): Promise<void> {
  await client.systemSetting.upsert({
    where: { key: 'system.schema_version' },
    update: { value: { version: 3 } },
    create: { key: 'system.schema_version', value: { version: 3 } },
  });
  await seedIdentityCatalog(client);
  await seedCatalogDemo(client);
  await client.folioSequence.upsert({
    where: { key: 'quote_request' },
    update: {},
    create: { key: 'quote_request', nextValue: 1 },
  });
}

const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  try {
    await seedDatabase(prisma);
    console.log('Foundation and identity seed completed.');
  } finally {
    await prisma.$disconnect();
  }
}
