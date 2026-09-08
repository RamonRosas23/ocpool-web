import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('quote document and acceptance relational schema', () => {
  it('keeps generated PDFs and acceptance evidence scoped and immutable at database level', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-08T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-documents-schema-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `PDF schema ${suffix}`, email: `pdf-schema-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'PDF schema fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `pdf-schema-employee-${suffix}@example.test`,
        emailNormalized: `pdf-schema-employee-${suffix}@example.test`,
        displayName: 'PDF schema employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const quote = await prisma.quote.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
    const version = await prisma.quoteVersion.create({ data: { quoteId: quote.id, currencyCode: 'MXN', createdById: employee.id, status: 'ENVIADA' } });
    const storageObject = await prisma.storageObject.create({
      data: {
        storageKey: `private-files/generated-documents/${version.id}.pdf`,
        contentType: 'application/pdf',
        byteSize: 4096n,
        sha256: 'a'.repeat(64),
        scanStatus: 'PASSED',
        verifiedAt: now,
      },
    });

    try {
      const document = await prisma.generatedDocument.create({
        data: {
          quoteId: quote.id,
          quoteVersionId: version.id,
          storageObjectId: storageObject.id,
          templateVersion: 'quote-pdf-v1',
          status: 'READY',
          byteSize: 4096n,
          sha256: 'a'.repeat(64),
          generatedAt: now,
          readyAt: now,
        },
      });

      expect(document.status).toBe('READY');
      await expect(prisma.generatedDocument.create({
        data: { quoteId: quote.id, quoteVersionId: version.id, templateVersion: 'quote-pdf-v1' },
      })).rejects.toThrow();
      await expect(prisma.generatedDocument.create({
        data: {
          quoteId: quote.id,
          quoteVersionId: version.id,
          templateVersion: 'quote-pdf-v1-invalid',
          status: 'READY',
          readyAt: now,
        },
      })).rejects.toThrow();

      const acceptance = await prisma.quoteAcceptance.create({
        data: {
          quoteId: quote.id,
          quoteVersionId: version.id,
          generatedDocumentId: document.id,
          acceptedById: employee.id,
          documentSha256: 'a'.repeat(64),
          signerName: 'Ana López Rivera',
          termsVersion: 'quote-terms-2026-01',
          idempotencyKeyHash: 'b'.repeat(64),
          ipFingerprint: 'c'.repeat(64),
          userAgentFingerprint: 'd'.repeat(64),
          acceptedAt: now,
        },
      });

      expect(acceptance.documentSha256).toBe('a'.repeat(64));
      await expect(prisma.quoteAcceptance.create({
        data: {
          quoteId: quote.id,
          quoteVersionId: version.id,
          generatedDocumentId: document.id,
          acceptedById: employee.id,
          documentSha256: 'z'.repeat(64),
          signerName: 'Otra persona',
          termsVersion: 'quote-terms-2026-01',
          idempotencyKeyHash: 'e'.repeat(64),
        },
      })).rejects.toThrow();
    } finally {
      await prisma.quoteAcceptance.deleteMany({ where: { quoteId: quote.id } });
      await prisma.generatedDocument.deleteMany({ where: { quoteId: quote.id } });
      await prisma.storageObject.delete({ where: { id: storageObject.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, version.id] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
    }
  }, 30_000);
});
