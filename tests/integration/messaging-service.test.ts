import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import {
  closeConversation,
  createInternalNote,
  listConversationMessages,
  reopenConversation,
  sendCustomerMessage,
  sendStaffMessage,
} from '@/server/modules/messaging/service';
import type { Actor } from '@/server/auth/types';

const actor = (userId: string, type: Actor['type'], clientId: string | null, permissions: string[]): Actor => ({
  userId,
  type,
  clientId,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('transactional messaging service', () => {
  it('isolates clients, separates internal notes, deduplicates retries and emits safe outbox events', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T09:00:00.000Z');
    const requestA = await createQuoteRequest({ idempotencyKey: `messaging-service-a-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Messaging A ${suffix}`, email: `messaging-a-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Messaging A', consentAt: now } }, { prisma, now });
    const requestB = await createQuoteRequest({ idempotencyKey: `messaging-service-b-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Messaging B ${suffix}`, email: `messaging-b-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Messaging B', consentAt: now } }, { prisma, now });
    const [customerA, customerB, employee] = await Promise.all([
      prisma.user.create({ data: { email: `messaging-customer-a-${suffix}@example.test`, emailNormalized: `messaging-customer-a-${suffix}@example.test`, displayName: 'Messaging customer A', type: 'CUSTOMER', status: 'ACTIVE', clientId: requestA.clientId } }),
      prisma.user.create({ data: { email: `messaging-customer-b-${suffix}@example.test`, emailNormalized: `messaging-customer-b-${suffix}@example.test`, displayName: 'Messaging customer B', type: 'CUSTOMER', status: 'ACTIVE', clientId: requestB.clientId } }),
      prisma.user.create({ data: { email: `messaging-employee-${suffix}@example.test`, emailNormalized: `messaging-employee-${suffix}@example.test`, displayName: 'Messaging employee', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    const customerPermissions = ['messaging.read', 'messaging.send'];
    const staffPermissions = ['requests.read', 'messaging.read', 'messaging.send', 'messaging.internal_notes.read', 'messaging.internal_notes.write', 'messaging.manage'];
    const customerActorA = actor(customerA.id, 'CUSTOMER', requestA.clientId, customerPermissions);
    const customerActorB = actor(customerB.id, 'CUSTOMER', requestB.clientId, customerPermissions);
    const staffActor = actor(employee.id, 'EMPLOYEE', null, staffPermissions);
    const limitedStaffActor = actor(`limited-${suffix}`, 'EMPLOYEE', null, ['requests.read', 'messaging.read', 'messaging.send']);
    const noMessagingStaffActor = actor(`no-messaging-${suffix}`, 'EMPLOYEE', null, ['requests.read']);
    const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
    const deniedRateLimit = async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 60 });

    try {
      const first = await sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Hola equipo', idempotencyKey: 'message-retry-01' }, { prisma, now, rateLimit });
      const repeated = await sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Este cuerpo no debe duplicarse', idempotencyKey: 'message-retry-01' }, { prisma, now, rateLimit });
      expect(repeated).toMatchObject({ id: first.id, body: 'Hola equipo', visibility: 'CUSTOMER' });
      expect(await prisma.conversationMessage.count({ where: { conversationId: first.conversationId } })).toBe(1);

      const concurrent = await Promise.all([
        sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Mensaje concurrente', idempotencyKey: 'concurrent-01' }, { prisma, now, rateLimit }),
        sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Cuerpo alterno', idempotencyKey: 'concurrent-01' }, { prisma, now, rateLimit }),
      ]);
      expect(concurrent[0].id).toBe(concurrent[1].id);
      expect(await prisma.conversationMessage.count({ where: { conversationId: first.conversationId } })).toBe(2);

      const response = await sendStaffMessage(staffActor, requestA.quoteRequestId, { body: 'Te compartimos el siguiente avance.', idempotencyKey: 'staff-message-01' }, { prisma, now, rateLimit });
      const note = await createInternalNote(staffActor, requestA.quoteRequestId, { body: 'Validar acabado con ingeniería.', idempotencyKey: 'staff-note-01' }, { prisma, now, rateLimit });
      expect(response.visibility).toBe('CUSTOMER');
      expect(note.visibility).toBe('INTERNAL');

      const customerView = await listConversationMessages(customerActorA, requestA.quoteRequestId, {}, { prisma });
      expect(customerView.items).toHaveLength(3);
      expect(JSON.stringify(customerView)).not.toContain('Validar acabado');
      const staffView = await listConversationMessages(staffActor, requestA.quoteRequestId, {}, { prisma });
      expect(staffView.items).toHaveLength(4);
      const limitedView = await listConversationMessages(limitedStaffActor, requestA.quoteRequestId, {}, { prisma });
      expect(limitedView.items).toHaveLength(3);

      await expect(sendStaffMessage(noMessagingStaffActor, requestA.quoteRequestId, { body: 'No permitido', idempotencyKey: 'staff-denied-01' }, { prisma, now, rateLimit })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Rate limited', idempotencyKey: 'rate-limited-01' }, { prisma, now, rateLimit: deniedRateLimit })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      await expect(sendCustomerMessage(customerActorA, requestB.quoteRequestId, { body: 'Cruce', idempotencyKey: 'cross-client-01' }, { prisma, now, rateLimit })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(createInternalNote(customerActorA, requestA.quoteRequestId, { body: 'No permitido', idempotencyKey: 'customer-note-01' }, { prisma, now, rateLimit })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(createInternalNote(limitedStaffActor, requestA.quoteRequestId, { body: 'No permitido', idempotencyKey: 'limited-note-01' }, { prisma, now, rateLimit })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(listConversationMessages(customerActorB, requestA.quoteRequestId, {}, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(listConversationMessages(staffActor, 'not-a-uuid', {}, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      await closeConversation(staffActor, requestA.quoteRequestId, { prisma, now });
      await expect(sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Después del cierre', idempotencyKey: 'closed-01' }, { prisma, now, rateLimit })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(reopenConversation(limitedStaffActor, requestA.quoteRequestId, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await reopenConversation(staffActor, requestA.quoteRequestId, { prisma, now: new Date(now.getTime() + 1_000) });
      const afterReopen = await sendCustomerMessage(customerActorA, requestA.quoteRequestId, { body: 'Conversación reabierta', idempotencyKey: 'reopened-01' }, { prisma, now: new Date(now.getTime() + 2_000), rateLimit });
      expect(afterReopen.visibility).toBe('CUSTOMER');

      const events = await prisma.outboxEvent.findMany({ where: { aggregateType: 'CONVERSATION', aggregateId: first.conversationId } });
      expect(events.length).toBeGreaterThanOrEqual(7);
      expect(JSON.stringify(events)).not.toContain('Hola equipo');
      expect(JSON.stringify(events)).not.toContain('Validar acabado');
      expect(JSON.stringify(events)).not.toContain('Conversación reabierta');
    } finally {
      const requestIds = [requestA.quoteRequestId, requestB.quoteRequestId];
      await prisma.conversation.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: [requestA.contactId, requestB.contactId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [customerA.id, customerB.id, employee.id] } } });
      await prisma.client.deleteMany({ where: { id: { in: [requestA.clientId, requestB.clientId] } } });
    }
  }, 30_000);
});
