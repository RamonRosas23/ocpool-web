import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';
import { upsertNotificationDelivery } from '@/server/modules/notifications/dispatcher';
import {
  listStaffNotificationDeliveries,
  retryStaffNotificationDelivery,
} from '@/server/modules/notifications/staff-service';

function actor(userId: string, permissions: string[]): Actor {
  return {
    userId,
    type: 'EMPLOYEE',
    clientId: null,
    permissionKeys: new Set(permissions),
    mfaVerified: true,
  };
}

describe('staff notification operations', () => {
  it('returns a minimal operational projection without recipient or payload secrets', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const user = await prisma.user.create({
      data: {
        email: `staff-notification-reader-${suffix}@example.test`,
        emailNormalized: `staff-notification-reader-${suffix}@example.test`,
        displayName: 'Staff notification reader',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const outbox = await prisma.outboxEvent.create({
      data: {
        eventType: 'MESSAGE.CREATED',
        aggregateType: 'CONVERSATION',
        payload: { fixture: `staff-list-${suffix}` },
      },
    });
    try {
      const delivery = await upsertNotificationDelivery(prisma, {
        outboxEventId: outbox.id,
        recipientUserId: user.id,
        recipientEmail: `recipient-${suffix}@example.test`,
        templateKey: 'message.created',
        templateVersion: 'v1',
        subjectSnapshot: 'Mensaje privado',
        safePayload: { recipientName: 'No debe salir', folio: 'OCQ-2026-000001', preview: 'No debe salir' },
      });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', attempts: 3, lastErrorCode: 'TEMPORARY_PROVIDER' },
      });

      const result = await listStaffNotificationDeliveries(actor(user.id, ['notifications.read']), { status: 'FAILED' }, { prisma, now: new Date('2026-09-08T12:00:00.000Z') });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: delivery.id,
        status: 'FAILED',
        templateKey: 'message.created',
        attempts: 3,
        errorCategory: 'TEMPORARY_PROVIDER',
        retryable: true,
      });
      expect(result.items[0]).not.toHaveProperty('recipientAddressCiphertext');
      expect(result.items[0]).not.toHaveProperty('recipientAddressHash');
      expect(result.items[0]).not.toHaveProperty('recipientUserId');
      expect(result.items[0]).not.toHaveProperty('payload');
      expect(result.items[0]).not.toHaveProperty('providerMessageId');
      expect(result.items[0]).not.toHaveProperty('subjectSnapshot');
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: outbox.id } });
      await prisma.outboxEvent.delete({ where: { id: outbox.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('retries recoverable failures once and is idempotent on repetition', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const user = await prisma.user.create({
      data: {
        email: `staff-notification-retry-${suffix}@example.test`,
        emailNormalized: `staff-notification-retry-${suffix}@example.test`,
        displayName: 'Staff notification retry',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const outbox = await prisma.outboxEvent.create({
      data: {
        eventType: 'MESSAGE.CREATED',
        aggregateType: 'CONVERSATION',
        payload: { fixture: `staff-retry-${suffix}` },
      },
    });
    let deliveryId = '';

    try {
      const delivery = await upsertNotificationDelivery(prisma, {
        outboxEventId: outbox.id,
        recipientUserId: null,
        recipientEmail: `retry-${suffix}@example.test`,
        templateKey: 'message.created',
        templateVersion: 'v1',
        safePayload: { recipientName: 'Cliente', folio: 'OCQ-2026-000002', preview: 'Mensaje' },
      });
      deliveryId = delivery.id;
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', attempts: 5, lastErrorCode: 'RATE_LIMIT', providerMessageId: 'provider-private-id' },
      });

      const staffActor = actor(user.id, ['notifications.read', 'notifications.manage']);
      const first = await retryStaffNotificationDelivery(staffActor, delivery.id, { prisma, now: new Date('2026-09-08T12:00:00.000Z') });
      expect(first.outcome).toBe('REQUEUED');
      expect(first.delivery).toMatchObject({ id: delivery.id, status: 'PENDING', attempts: 0, errorCategory: null, retryable: false });
      expect(await prisma.notificationDelivery.findUnique({ where: { id: delivery.id }, select: { status: true, attempts: true, lastErrorCode: true, processedAt: true, processingStartedAt: true, providerMessageId: true } })).toEqual({ status: 'PENDING', attempts: 0, lastErrorCode: null, processedAt: null, processingStartedAt: null, providerMessageId: null });

      const second = await retryStaffNotificationDelivery(staffActor, delivery.id, { prisma, now: new Date('2026-09-08T12:00:01.000Z') });
      expect(second.outcome).toBe('ALREADY_PENDING');
      expect(await prisma.auditLog.count({ where: { action: 'notification.retry', entityId: delivery.id } })).toBe(1);
    } finally {
      if (deliveryId) await prisma.auditLog.deleteMany({ where: { action: 'notification.retry', entityId: deliveryId } });
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: outbox.id } });
      await prisma.outboxEvent.delete({ where: { id: outbox.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('rejects unauthorized reads and non-recoverable manual retries', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const user = await prisma.user.create({
      data: {
        email: `staff-notification-denied-${suffix}@example.test`,
        emailNormalized: `staff-notification-denied-${suffix}@example.test`,
        displayName: 'Staff notification denied',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const outbox = await prisma.outboxEvent.create({
      data: { eventType: 'MESSAGE.CREATED', aggregateType: 'CONVERSATION', payload: { fixture: `staff-denied-${suffix}` } },
    });

    try {
      const delivery = await upsertNotificationDelivery(prisma, {
        outboxEventId: outbox.id,
        recipientUserId: null,
        recipientEmail: `denied-${suffix}@example.test`,
        templateKey: 'message.created',
        templateVersion: 'v1',
        safePayload: { recipientName: 'Cliente', folio: 'OCQ-2026-000003', preview: 'Mensaje' },
      });
      await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', lastErrorCode: 'TEMPLATE_ERROR' } });

      await expect(listStaffNotificationDeliveries(actor(user.id, []), {}, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(retryStaffNotificationDelivery(actor(user.id, ['notifications.read']), delivery.id, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(retryStaffNotificationDelivery(actor(user.id, ['notifications.manage']), delivery.id, { prisma })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await prisma.notificationDelivery.findUnique({ where: { id: delivery.id }, select: { status: true, attempts: true, lastErrorCode: true } })).toEqual({ status: 'FAILED', attempts: 0, lastErrorCode: 'TEMPLATE_ERROR' });
    } finally {
      await prisma.notificationDelivery.deleteMany({ where: { outboxEventId: outbox.id } });
      await prisma.outboxEvent.delete({ where: { id: outbox.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);
});
