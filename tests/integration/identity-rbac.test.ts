import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from '@/server/auth/constants';
import { seedIdentityCatalog } from '../../prisma/seed';

describe('identity and RBAC foundation', () => {
  it('persists the identity relationships and unique security records', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const email = `identity-${suffix}@example.test`;

    const client = await prisma.client.create({
      data: { displayName: `Identity test ${suffix}` },
    });
    const role = await prisma.role.create({
      data: {
        key: `identity-test-${suffix}`,
        name: 'Identity test role',
        description: 'Disposable role for the identity integration contract',
        systemManaged: false,
      },
    });
    const permission = await prisma.permission.create({
      data: {
        key: `identity.test.${suffix}`,
        description: 'Disposable permission for the identity integration contract',
      },
    });
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: 'Identity Test',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        clientId: client.id,
        roles: { create: { roleId: role.id } },
      },
    });

    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(user.clientId).toBe(client.id);
    expect((await prisma.userRole.findUnique({ where: { userId_roleId: { userId: user.id, roleId: role.id } } }))?.roleId).toBe(role.id);
    expect((await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } }))?.permissionId).toBe(permission.id);
    await expect(prisma.user.create({
      data: { email, emailNormalized: email, displayName: 'Duplicate', type: 'CUSTOMER', clientId: client.id },
    })).rejects.toThrow();

    await prisma.session.delete({ where: { id: session.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    await prisma.permission.delete({ where: { id: permission.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.client.delete({ where: { id: client.id } });
  }, 15_000);

  it('seeds the catalog idempotently without duplicating system records', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    await seedIdentityCatalog(prisma);
    await seedIdentityCatalog(prisma);

    const permissionKeys = PERMISSION_CATALOG.map(({ key }) => key);
    const roles = await prisma.role.findMany({ where: { key: { in: Object.keys(ROLE_DEFINITIONS) } } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });

    expect(roles).toHaveLength(Object.keys(ROLE_DEFINITIONS).length);
    expect(permissions).toHaveLength(PERMISSION_CATALOG.length);

    for (const [roleKey, definition] of Object.entries(ROLE_DEFINITIONS)) {
      const role = roles.find((candidate) => candidate.key === roleKey);
      expect(role).toBeDefined();
      const assignments = await prisma.rolePermission.count({ where: { roleId: role?.id } });
      expect(assignments).toBe(definition.permissions.length);
    }
  }, 15_000);

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS === '1') await getPrisma().$disconnect();
  });
});
