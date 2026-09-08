import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { createSession } from '@/server/auth/sessions';
import { upsertNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import { GET as notificationsGet } from '@/app/api/staff/notifications/route';
import { POST as notificationRetryPost } from '@/app/api/staff/notifications/[id]/retry/route';

describe('staff notifications API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const outboxIds: string[] = [];
  const deliveryIds: string[] = [];
  let salesToken = '';
  let managerToken = '';
  let customerToken = '';
  let failedDeliveryId = '';
  let permanentDeliveryId = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `ocpool_session=${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, managerRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [sales, manager, customer] = await Promise.all([
      prisma.user.create({ data: { email: `notification-api-sales-${suffix}@example.test`, emailNormalized: `notification-api-sales-${suffix}@example.test`, displayName: 'Notification API Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `notification-api-manager-${suffix}@example.test`, emailNormalized: `notification-api-manager-${suffix}@example.test`, displayName: 'Notification API Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `notification-api-customer-${suffix}@example.test`, emailNormalized: `notification-api-customer-${suffix}@example.test`, displayName: 'Notification API Customer', type: 'CUSTOMER', status: 'ACTIVE', roles: { create: { roleId: customerRole.id } } } }),
    ]);
    userIds.push(sales.id, manager.id, customer.id);
    salesToken = `notification-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `notification-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerToken = `notification-api-customer-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    const sessions = await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: customer.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerToken }),
    ]);
    sessionIds.push(...sessions.map(({ sessionId }) => sessionId));

    const retryEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `notification-api-retry-${suffix}` } } });
    const permanentEvent = await prisma.outboxEvent.create({ data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `notification-api-permanent-${suffix}` } } });
    outboxIds.push(retryEvent.id, permanentEvent.id);
    const [retry, permanent] = await Promise.all([
      upsertNotificationDelivery(prisma, { outboxEventId: retryEvent.id, recipientUserId: null, recipientEmail: `notification-api-retry-${suffix}@example.test`, templateKey: 'message.created', templateVersion: 'v1', safePayload: { recipientName: 'No exponer', folio: 'OCQ-2026-API-01', preview: 'No exponer' } }),
      upsertNotificationDelivery(prisma, { outboxEventId: permanentEvent.id, recipientUserId: null, recipientEmail: `notification-api-permanent-${suffix}@example.test`, templateKey: 'message.created', templateVersion: 'v1', safePayload: { recipientName: 'No exponer', folio: 'OCQ-2026-API-02', preview: 'No exponer' } }),
    ]);
    failedDeliveryId = retry.id;
    permanentDeliveryId = permanent.id;
    deliveryIds.push(retry.id, permanent.id);
    await prisma.notificationDelivery.updateMany({ where: { id: { in: deliveryIds } }, data: { status: 'FAILED', lastErrorCode: 'TEMPORARY_PROVIDER' } });
    await prisma.notificationDelivery.update({ where: { id: permanent.id }, data: { lastErrorCode: 'TEMPLATE_ERROR' } });
  });

  it('enforces staff authentication, permission boundaries and safe read payloads', async () => {
    expect((await notificationsGet(endpoint('/api/staff/notifications'))).status).toBe(401);
    expect((await notificationsGet(endpoint('/api/staff/notifications', customerToken))).status).toBe(403);
    expect((await notificationsGet(endpoint('/api/staff/notifications', salesToken))).status).toBe(200);

    const response = await notificationsGet(endpoint('/api/staff/notifications?status=FAILED', managerToken));
    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    const item = body.items.find((candidate) => candidate.id === failedDeliveryId);
    expect(item).toBeTruthy();
    expect(item).toMatchObject({ status: 'FAILED', errorCategory: 'TEMPORARY_PROVIDER', retryable: true });
    expect(Object.keys(item ?? {})).not.toEqual(expect.arrayContaining(['payload', 'recipientAddressCiphertext', 'recipientAddressHash', 'recipientUserId', 'providerMessageId']));
  });

  it('protects manual retry with same-origin, RBAC and idempotent outcomes', async () => {
    expect((await notificationRetryPost(endpoint(`/api/staff/notifications/${failedDeliveryId}/retry`, salesToken, 'POST', {}, readServerEnv().APP_URL), { params: Promise.resolve({ id: failedDeliveryId }) })).status).toBe(403);
    expect((await notificationRetryPost(endpoint(`/api/staff/notifications/${failedDeliveryId}/retry`, managerToken, 'POST', {}, 'https://attacker.example'), { params: Promise.resolve({ id: failedDeliveryId }) })).status).toBe(403);

    const first = await notificationRetryPost(endpoint(`/api/staff/notifications/${failedDeliveryId}/retry`, managerToken, 'POST', {}), { params: Promise.resolve({ id: failedDeliveryId }) });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ outcome: 'REQUEUED', delivery: { status: 'PENDING' } });

    const second = await notificationRetryPost(endpoint(`/api/staff/notifications/${failedDeliveryId}/retry`, managerToken, 'POST', {}), { params: Promise.resolve({ id: failedDeliveryId }) });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ outcome: 'ALREADY_PENDING' });

    const permanent = await notificationRetryPost(endpoint(`/api/staff/notifications/${permanentDeliveryId}/retry`, managerToken, 'POST', {}), { params: Promise.resolve({ id: permanentDeliveryId }) });
    expect(permanent.status).toBe(409);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.auditLog.deleteMany({ where: { action: 'notification.retry', entityId: { in: deliveryIds } } });
    await prisma.notificationDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: outboxIds } } });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
});
