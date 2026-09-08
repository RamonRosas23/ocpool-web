import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('messaging persistence constraints', () => {
  it('enforces one conversation per request and database body/state invariants', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T08:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `messaging-schema-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Messaging schema ${suffix}`, email: `messaging-schema-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Messaging schema fixture', consentAt: now },
    }, { prisma, now });

    try {
      const conversation = await prisma.conversation.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
      await prisma.conversationMessage.create({ data: { conversationId: conversation.id, visibility: 'CUSTOMER', body: 'Mensaje válido' } });
      await expect(prisma.conversation.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } })).rejects.toThrow();
      await expect(prisma.conversationMessage.create({ data: { conversationId: conversation.id, visibility: 'CUSTOMER', body: '   ' } })).rejects.toThrow();
      await expect(prisma.conversationMessage.create({ data: { conversationId: conversation.id, visibility: 'CUSTOMER', body: 'x'.repeat(10_001) } })).rejects.toThrow();
      await expect(prisma.conversation.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId, status: 'OPEN', closedAt: now } })).rejects.toThrow();
    } finally {
      await prisma.conversation.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
    }
  }, 30_000);
});
