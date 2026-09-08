import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('private file persistence constraints', () => {
  it('enforces file size, key, hash, visibility and request/client scope invariants', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T08:00:00.000Z');
    const [requestA, requestB] = await Promise.all([
      createQuoteRequest({
        idempotencyKey: `private-files-schema-a-${suffix}`,
        origin: 'STAFF_CREATED',
        contact: { displayName: `Private files A ${suffix}`, email: `private-files-a-${suffix}@example.test` },
        detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Private files schema A', consentAt: now },
      }, { prisma, now }),
      createQuoteRequest({
        idempotencyKey: `private-files-schema-b-${suffix}`,
        origin: 'STAFF_CREATED',
        contact: { displayName: `Private files B ${suffix}`, email: `private-files-b-${suffix}@example.test` },
        detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Private files schema B', consentAt: now },
      }, { prisma, now }),
    ]);
    const user = await prisma.user.create({
      data: {
        email: `private-files-uploader-${suffix}@example.test`,
        emailNormalized: `private-files-uploader-${suffix}@example.test`,
        displayName: 'Private files uploader',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const storageObjectId = crypto.randomUUID();
    const internalStorageObjectId = crypto.randomUUID();
    const crossScopeStorageObjectId = crypto.randomUUID();

    try {
      await prisma.storageObject.create({
        data: {
          id: storageObjectId,
          storageKey: `private-files/${storageObjectId}`,
          contentType: 'application/pdf',
          byteSize: 1024n,
          sha256: 'a'.repeat(64),
        },
      });
      const attachment = await prisma.fileAttachment.create({
        data: {
          quoteRequestId: requestA.quoteRequestId,
          clientId: requestA.clientId,
          storageObjectId,
          originalFileName: 'planos.pdf',
          category: 'TECHNICAL_DOCUMENT',
          visibility: 'CUSTOMER',
          uploadedById: user.id,
        },
      });
      expect(attachment.status).toBe('PENDING_SCAN');

      await prisma.storageObject.createMany({
        data: [
          { id: internalStorageObjectId, storageKey: `private-files/${internalStorageObjectId}`, contentType: 'application/pdf', byteSize: 1024n, sha256: 'b'.repeat(64) },
          { id: crossScopeStorageObjectId, storageKey: `private-files/${crossScopeStorageObjectId}`, contentType: 'application/pdf', byteSize: 1024n, sha256: 'c'.repeat(64) },
        ],
      });

      await expect(prisma.storageObject.create({
        data: {
          storageKey: `private-files/${crypto.randomUUID()}`,
          contentType: 'application/pdf',
          byteSize: 0n,
          sha256: 'a'.repeat(64),
        },
      })).rejects.toThrow();
      await expect(prisma.storageObject.create({
        data: {
          storageKey: '../escape',
          contentType: 'application/pdf',
          byteSize: 1024n,
          sha256: 'a'.repeat(64),
        },
      })).rejects.toThrow();
      await expect(prisma.storageObject.create({
        data: {
          storageKey: `private-files/${crypto.randomUUID()}`,
          contentType: 'application/pdf',
          byteSize: 1024n,
          sha256: 'not-a-hash',
        },
      })).rejects.toThrow();
      await expect(prisma.fileAttachment.create({
        data: {
          quoteRequestId: requestA.quoteRequestId,
          clientId: requestA.clientId,
          storageObjectId: internalStorageObjectId,
          originalFileName: 'interno.pdf',
          category: 'INTERNAL_DOCUMENT',
          visibility: 'CUSTOMER',
          uploadedById: user.id,
        },
      })).rejects.toThrow();
      await expect(prisma.fileAttachment.create({
        data: {
          quoteRequestId: requestB.quoteRequestId,
          clientId: requestA.clientId,
          storageObjectId: crossScopeStorageObjectId,
          originalFileName: 'cruce.pdf',
          category: 'TECHNICAL_DOCUMENT',
          visibility: 'CUSTOMER',
          uploadedById: user.id,
        },
      })).rejects.toThrow();
    } finally {
      await prisma.fileAttachment.deleteMany({ where: { OR: [{ quoteRequestId: requestA.quoteRequestId }, { quoteRequestId: requestB.quoteRequestId }] } });
      await prisma.storageObject.deleteMany({ where: { id: { in: [storageObjectId, internalStorageObjectId, crossScopeStorageObjectId] } } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestA.quoteRequestId, requestB.quoteRequestId] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestA.quoteRequestId, requestB.quoteRequestId] } } });
      await prisma.quoteRequest.deleteMany({ where: { id: { in: [requestA.quoteRequestId, requestB.quoteRequestId] } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: [requestA.contactId, requestB.contactId] } } });
      await prisma.client.deleteMany({ where: { id: { in: [requestA.clientId, requestB.clientId] } } });
    }
  }, 30_000);
});
