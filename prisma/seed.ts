import 'dotenv/config';
import { readFileSync } from 'node:fs';
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

/// D1-03/BIZ-03: tax RATE profiles only (never a fiscal identity/RFC — see
/// ADR 2026-09-19). IVA varies by zone in Mexico, so both are seeded active
/// and selectable rather than picking one as the only option.
export async function seedTaxProfiles(client: PrismaClient): Promise<void> {
  await client.taxProfileVersion.upsert({
    where: { code: 'IVA_GENERAL' },
    update: {},
    create: {
      code: 'IVA_GENERAL',
      name: 'IVA general',
      ratePercentBasisPoints: 1600,
      roundingRule: 'HALF_UP',
      currencyCode: 'MXN',
    },
  });
  await client.taxProfileVersion.upsert({
    where: { code: 'IVA_FRONTERA' },
    update: {},
    create: {
      code: 'IVA_FRONTERA',
      name: 'IVA zona fronteriza',
      ratePercentBasisPoints: 800,
      roundingRule: 'HALF_UP',
      currencyCode: 'MXN',
    },
  });
}

/// D1-03/BIZ-06/07: default commercial policy — MXN/2 decimals, business
/// timezone already used as APP_TIMEZONE, and the 10% no-approval discount
/// threshold from ADR 2026-09-19. `createdById` stays null: this is a
/// system default, not a staff action.
export async function seedDefaultCommercialPolicy(client: PrismaClient): Promise<void> {
  await client.commercialPolicyVersion.upsert({
    where: { versionTag: 'v1' },
    update: {},
    create: {
      versionTag: 'v1',
      currencyCode: 'MXN',
      precision: 2,
      timezone: 'America/Chihuahua',
      discountApprovalThresholdBps: 1000,
    },
  });
}

const TERMS_MARKDOWN_PATH = resolve(fileURLToPath(new URL('../docs/legal/terminos-y-privacidad-comercial.md', import.meta.url)));
const PRIVACY_HEADING = '## Aviso de privacidad simplificado';
const TERMS_BODY_START = '## 1. Objeto';

function splitTermsDocument(): { bodyMarkdown: string; privacyMarkdown: string } {
  const raw = readFileSync(TERMS_MARKDOWN_PATH, 'utf8');
  const bodyStart = raw.indexOf(TERMS_BODY_START);
  const privacyStart = raw.indexOf(PRIVACY_HEADING);
  if (bodyStart === -1 || privacyStart === -1 || privacyStart <= bodyStart) {
    throw new Error(`Unexpected structure in ${TERMS_MARKDOWN_PATH}: cannot locate the terms/privacy split.`);
  }
  return {
    bodyMarkdown: raw.slice(bodyStart, privacyStart).trim(),
    privacyMarkdown: raw.slice(privacyStart).trim(),
  };
}

/// D1-03/BIZ-10: v1 of the real terms/privacy content authored per
/// ADR 2026-09-19, sourced from docs/legal/terminos-y-privacidad-comercial.md
/// so the seeded DB copy and the reviewable document never drift apart.
export async function seedCommercialTerms(client: PrismaClient): Promise<void> {
  const { bodyMarkdown, privacyMarkdown } = splitTermsDocument();
  await client.commercialTermsVersion.upsert({
    where: { versionTag: 'v1' },
    update: { bodyMarkdown, privacyMarkdown },
    create: {
      versionTag: 'v1',
      title: 'Condiciones comerciales y aviso de privacidad OCPOOL',
      bodyMarkdown,
      privacyMarkdown,
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
  await seedTaxProfiles(client);
  await seedDefaultCommercialPolicy(client);
  await seedCommercialTerms(client);
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
