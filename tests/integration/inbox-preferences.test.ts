import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { createSession } from '@/server/auth/sessions';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { GET as preferencesGet, PATCH as preferencesPatch } from '@/app/api/notifications/preferences/route';

describe('inbox preferences API', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const userIds: string[] = [];
  let clientId = '';
  let employeeId = '';
  let customerId = '';
  let employeeToken = '';
  let customerToken = '';

  const endpoint = (method: string, token?: string, body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(readServerEnv().APP_URL + '/api/notifications/preferences', {
    method,
    headers: {
      ...(token ? { cookie: 'ocpool_session=' + token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const client = await prisma.client.create({ data: { displayName: 'Inbox preference ' + suffix } });
    clientId = client.id;
    const employee = await prisma.user.create({
      data: {
        email: 'inbox-preferences-employee-' + suffix + '@example.test',
        emailNormalized: 'inbox-preferences-employee-' + suffix + '@example.test',
        displayName: 'Preferences Employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
        roles: { create: { roleId: salesRole.id } },
      },
    });
    const customer = await prisma.user.create({
      data: {
        email: 'inbox-preferences-customer-' + suffix + '@example.test',
        emailNormalized: 'inbox-preferences-customer-' + suffix + '@example.test',
        displayName: 'Preferences Customer',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        clientId,
        roles: { create: { roleId: customerRole.id } },
      },
    });
    employeeId = employee.id;
    customerId = customer.id;
    userIds.push(employeeId, customerId);
    employeeToken = 'inbox-preferences-employee-' + suffix + '-abcdefghijklmnopqrstuvwxyz-0123456789';
    customerToken = 'inbox-preferences-customer-' + suffix + '-abcdefghijklmnopqrstuvwxyz-0123456789';
    await Promise.all([
      createSession({ userId: employeeId, ipAddress: null, userAgent: 'inbox-preferences-test' }, { prisma, tokenGenerator: () => employeeToken }),
      createSession({ userId: customerId, ipAddress: null, userAgent: 'inbox-preferences-test' }, { prisma, tokenGenerator: () => customerToken }),
    ]);
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.inboxPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it('returns role defaults without creating rows and never caches preferences', async () => {
    expect((await preferencesGet(endpoint('GET'))).status).toBe(401);

    const employee = await preferencesGet(endpoint('GET', employeeToken));
    expect(employee.status).toBe(200);
    expect(employee.headers.get('cache-control')).toBe('no-store');
    expect(await employee.json()).toEqual({ sound: true, desktop: false, activityEmail: 'DIGEST', saved: false });

    const customer = await preferencesGet(endpoint('GET', customerToken));
    expect(customer.status).toBe(200);
    expect(await customer.json()).toEqual({ sound: false, desktop: false, activityEmail: 'DIGEST', saved: false });
    expect(await prisma.inboxPreference.count()).toBe(0);
  });

  it('persists only the authenticated user preferences and applies partial updates', async () => {
    const updatedEmployee = await preferencesPatch(endpoint('PATCH', employeeToken, { activityEmail: 'OFF' }));
    expect(updatedEmployee.status).toBe(200);
    expect(await updatedEmployee.json()).toEqual({ sound: true, desktop: false, activityEmail: 'OFF', saved: true });

    const updatedCustomer = await preferencesPatch(endpoint('PATCH', customerToken, { desktop: true }));
    expect(updatedCustomer.status).toBe(200);
    expect(await updatedCustomer.json()).toEqual({ sound: false, desktop: true, activityEmail: 'DIGEST', saved: true });

    expect(await preferencesGet(endpoint('GET', employeeToken)).then((response) => response.json())).toEqual({
      sound: true, desktop: false, activityEmail: 'OFF', saved: true,
    });
    expect(await preferencesPatch(endpoint('PATCH', employeeToken, { sound: 'off' })).then((response) => response.status)).toBe(400);
    expect(await preferencesPatch(endpoint('PATCH', employeeToken, { sound: false, unknown: true })).then((response) => response.status)).toBe(400);
  });

  it('rejects cross-origin writes', async () => {
    const response = await preferencesPatch(endpoint('PATCH', employeeToken, { sound: false }, 'https://attacker.example'));
    expect(response.status).toBe(403);
  });
});