import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { clonePublishedVersion, createQuoteVersion, rejectQuoteVersion, replaceQuoteDraft, returnQuoteToDraft, submitQuoteForReview, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { decideQuoteApproval, listQuoteApprovals, requestQuoteApproval } from '@/server/modules/quotes/approval-service';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';

const salesActor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('quote pricing and versioning service', () => {
  it('resolves the active price and preserves a historical snapshot after catalog changes', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-10T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-snapshot`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote service ${suffix}`, email: `quote-service-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Quote service fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-service-employee-${suffix}@example.test`,
        emailNormalized: `quote-service-employee-${suffix}@example.test`,
        displayName: 'Quote service employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `QUOTE-${suffix}`, name: 'Quote service' } });
    const item = await prisma.catalogItem.create({ data: { code: `QUOTE-ITEM-${suffix}`, name: 'Quote service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `QUOTE-PRICE-${suffix}`, name: 'Quote service prices', currencyCode: 'MXN', validFrom: now } });
    const price = await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const actor = salesActor(employee.id, ['quotes.create', 'prices.read']);
      const created = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', taxBasisPoints: 1600 }],
        expectedCurrentVersionNumber: null,
      }, { prisma, now });
      quoteId = created.quoteId;

      expect(created.versionNumber).toBe(1);
      expect(created.totalMinor).toBe(23200n);
      const lineBeforeChange = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId } });
      expect(lineBeforeChange).toMatchObject({ catalogItemId: item.id, unitPriceMinor: 10000n, subtotalMinor: 20000n, totalMinor: 23200n });

      await prisma.priceListItem.update({ where: { id: price.id }, data: { unitPriceMinor: 12000n } });
      const lineAfterChange = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId } });
      expect(lineAfterChange).toMatchObject({ unitPriceMinor: 10000n, subtotalMinor: 20000n, totalMinor: 23200n });
      expect(await prisma.auditLog.count({ where: { entityId: created.versionId, action: 'quote.version.created' } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_CREATED' } })).toBe(1);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('requires permissions, blocks edits after sending and serializes concurrent version creation', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-11T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-version`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote version ${suffix}`, email: `quote-version-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Quote version fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-version-employee-${suffix}@example.test`,
        emailNormalized: `quote-version-employee-${suffix}@example.test`,
        displayName: 'Quote version employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `VERSION-${suffix}`, name: 'Version service' } });
    const item = await prisma.catalogItem.create({ data: { code: `VERSION-ITEM-${suffix}`, name: 'Version service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `VERSION-PRICE-${suffix}`, name: 'Version service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 5000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read']);
      const manager = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read', 'quotes.edit_prices']);
      await expect(createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', unitPriceMinorOverride: '6000' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const first = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1' }],
      }, { prisma, now });
      quoteId = first.quoteId;
      expect(await prisma.quote.findUnique({ where: { id: first.quoteId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: first.versionId, publishedVersionId: null });
      const editedDraft = await replaceQuoteDraft(actor, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now });
      expect(editedDraft.totalMinor).toBe(10000n);
      expect(await prisma.quoteLineSnapshot.count({ where: { quoteVersionId: first.versionId } })).toBe(1);
      await transitionQuoteVersion(actor, first.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(actor, first.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quote.findUnique({ where: { id: first.quoteId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: null, publishedVersionId: first.versionId });
      await expect(transitionQuoteVersion(actor, first.versionId, 'ACEPTADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(replaceQuoteDraft(manager, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const [second, concurrent] = await Promise.allSettled([
        createQuoteVersion(actor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '2' }],
          expectedCurrentVersionNumber: 1,
        }, { prisma, now }),
        createQuoteVersion(actor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '3' }],
          expectedCurrentVersionNumber: 1,
        }, { prisma, now }),
      ]);
      expect([second, concurrent].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect([second, concurrent].filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await prisma.quoteVersion.count({ where: { quote: { quoteRequestId: request.quoteRequestId } } })).toBe(2);
      expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toMatchObject({ status: 'COTIZACION_DISPONIBLE' });

      const draftResult = second.status === 'fulfilled' ? second.value : concurrent.status === 'fulfilled' ? concurrent.value : null;
      expect(draftResult).not.toBeNull();
      expect(await prisma.quote.findUnique({ where: { id: first.quoteId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: draftResult!.versionId, publishedVersionId: first.versionId });
      const discountEditor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
      await replaceQuoteDraft(discountEditor, draftResult!.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now });
      await transitionQuoteVersion(discountEditor, draftResult!.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(discountEditor, draftResult!.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('requires an independent, current approval before sending a discounted quote', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-12T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-approval`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote approval ${suffix}`, email: `quote-approval-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Approval fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: {
        email: `quote-approval-requester-${suffix}@example.test`,
        emailNormalized: `quote-approval-requester-${suffix}@example.test`,
        displayName: 'Quote approval requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const approver = await prisma.user.create({
      data: {
        email: `quote-approval-approver-${suffix}@example.test`,
        emailNormalized: `quote-approval-approver-${suffix}@example.test`,
        displayName: 'Quote approval approver',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `APPROVAL-${suffix}`, name: 'Approval service' } });
    const item = await prisma.catalogItem.create({ data: { code: `APPROVAL-ITEM-${suffix}`, name: 'Approval service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `APPROVAL-PRICE-${suffix}`, name: 'Approval service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });

      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });
      expect(approval).toMatchObject({ status: 'REQUESTED', type: 'DISCOUNT', policyVersion: 'discount-v1' });
      expect(approval.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect((await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
      }, { prisma, now })).id).toBe(approval.id);

      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(decideQuoteApproval({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount']) }, approval.id, { decision: 'APPROVED' }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const approved = await decideQuoteApproval(approverActor, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');

      await transitionQuoteVersion(requesterActor, created.versionId, 'BORRADOR', { prisma, now });
      expect(await prisma.quoteApproval.findUnique({ where: { id: approval.id }, select: { status: true } })).toMatchObject({ status: 'SUPERSEDED' });
      await replaceQuoteDraft(requesterActor, created.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 600 }],
      }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const refreshedApproval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 600,
      }, { prisma, now });
      expect(refreshedApproval.id).not.toBe(approval.id);
      await decideQuoteApproval(approverActor, refreshedApproval.id, { decision: 'APPROVED' }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toMatchObject({ status: 'ENVIADA' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('lets only quotes.approval.override bypass the separation-of-duties block on a self-requested approval (D2-02)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-override`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote override ${suffix}`, email: `quote-override-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Override fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: {
        email: `quote-override-requester-${suffix}@example.test`,
        emailNormalized: `quote-override-requester-${suffix}@example.test`,
        displayName: 'Quote override requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `OVERRIDE-${suffix}`, name: 'Override service' } });
    const item = await prisma.catalogItem.create({ data: { code: `OVERRIDE-ITEM-${suffix}`, name: 'Override service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `OVERRIDE-PRICE-${suffix}`, name: 'Override service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });

      await expect(decideQuoteApproval({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount']) }, approval.id, { decision: 'APPROVED' }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const approved = await decideQuoteApproval({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount', 'quotes.approval.override']) }, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');
      expect(approved.decidedById).toBe(requester.id);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: requester.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('scopes approval requests, decisions and listings to the request\'s assigned responsible', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-13T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-approval-scope`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Approval scope ${suffix}`, email: `approval-scope-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Culiacán', description: 'Approval scope fixture', consentAt: now },
    }, { prisma, now });
    const rival = await prisma.user.create({
      data: { email: `approval-scope-rival-${suffix}@example.test`, emailNormalized: `approval-scope-rival-${suffix}@example.test`, displayName: 'Approval scope rival', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const outsider = await prisma.user.create({
      data: { email: `approval-scope-outsider-${suffix}@example.test`, emailNormalized: `approval-scope-outsider-${suffix}@example.test`, displayName: 'Approval scope outsider', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `APPROVAL-SCOPE-${suffix}`, name: 'Approval scope service' } });
    const item = await prisma.catalogItem.create({ data: { code: `APPROVAL-SCOPE-ITEM-${suffix}`, name: 'Approval scope item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `APPROVAL-SCOPE-PRICE-${suffix}`, name: 'Approval scope prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const rivalActor = salesActor(rival.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'quotes.read', 'quotes.approve_discount', 'prices.read']);
    const outsiderActor = salesActor(outsider.id, ['quotes.create', 'quotes.read', 'quotes.approve_discount']);
    const globalOutsiderActor = { ...outsiderActor, permissionKeys: new Set([...outsiderActor.permissionKeys, 'requests.read.global']) };

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: rival.id } });
      const created = await createQuoteVersion(rivalActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(rivalActor, created.versionId, 'EN_REVISION', { prisma, now });

      await expect(requestQuoteApproval(outsiderActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Intento de un responsable ajeno.',
      }, { prisma, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      const approval = await requestQuoteApproval(rivalActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });

      await expect(decideQuoteApproval(outsiderActor, approval.id, { decision: 'APPROVED' }, { prisma, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(listQuoteApprovals(outsiderActor, created.versionId, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      await expect(listQuoteApprovals(globalOutsiderActor, created.versionId, { prisma })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: approval.id })]));
      const approved = await decideQuoteApproval(globalOutsiderActor, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [rival.id, outsider.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('requires a SPECIAL_CONCEPT approval before sending a quote with a special line, and invalidates it on edit (K1-05)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-14T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-special`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote special ${suffix}`, email: `quote-special-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special concept fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: { email: `quote-special-requester-${suffix}@example.test`, emailNormalized: `quote-special-requester-${suffix}@example.test`, displayName: 'Quote special requester', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const approver = await prisma.user.create({
      data: { email: `quote-special-approver-${suffix}@example.test`, emailNormalized: `quote-special-approver-${suffix}@example.test`, displayName: 'Quote special approver', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `SPECIAL-${suffix}`, name: 'Special concept service' } });
    const item = await prisma.catalogItem.create({ data: { code: `SPECIAL-ITEM-${suffix}`, name: 'Special concept item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `SPECIAL-PRICE-${suffix}`, name: 'Special concept prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [
          { catalogItemId: item.id, quantity: '1' },
          { special: true, name: 'Ajuste especial de sitio', unit: 'servicio', quantity: '1', unitPriceMinor: '5000', reason: 'Condición del terreno no catalogada' },
        ],
      }, { prisma, now });
      quoteId = created.quoteId;
      expect(created.totalMinor).toBe(15000n);
      const specialLine = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId, catalogItemId: null } });
      expect(specialLine).toMatchObject({ catalogItemId: null, catalogItemCode: null, name: 'Ajuste especial de sitio', specialReason: 'Condición del terreno no catalogada' });

      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      await expect(requestQuoteApproval(requesterActor, created.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'SPECIAL_CONCEPT',
        policyVersion: 'special-concept-v1',
        reason: 'Ajuste de sitio autorizado por el cliente.',
      }, { prisma, now });
      expect(approval).toMatchObject({ status: 'REQUESTED', type: 'SPECIAL_CONCEPT' });

      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const approved = await decideQuoteApproval(approverActor, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');

      await transitionQuoteVersion(requesterActor, created.versionId, 'BORRADOR', { prisma, now });
      expect(await prisma.quoteApproval.findUnique({ where: { id: approval.id }, select: { status: true } })).toMatchObject({ status: 'SUPERSEDED' });
      await replaceQuoteDraft(requesterActor, created.versionId, {
        priceListId: priceList.id,
        lines: [
          { catalogItemId: item.id, quantity: '1' },
          { special: true, name: 'Ajuste especial de sitio', unit: 'servicio', quantity: '1', unitPriceMinor: '5000', reason: 'Motivo actualizado tras revisión' },
        ],
      }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const refreshedApproval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'SPECIAL_CONCEPT',
        policyVersion: 'special-concept-v1',
      }, { prisma, now });
      expect(refreshedApproval.id).not.toBe(approval.id);
      await decideQuoteApproval(approverActor, refreshedApproval.id, { decision: 'APPROVED' }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toMatchObject({ status: 'ENVIADA' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('clones a published version into a fresh draft, re-pricing catalog lines and copying special lines verbatim (D2-04)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-clone`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote clone ${suffix}`, email: `quote-clone-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Clone fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-clone-employee-${suffix}@example.test`, emailNormalized: `quote-clone-employee-${suffix}@example.test`, displayName: 'Quote clone employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const manager = await prisma.user.create({
      data: { email: `quote-clone-manager-${suffix}@example.test`, emailNormalized: `quote-clone-manager-${suffix}@example.test`, displayName: 'Quote clone manager', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `CLONE-${suffix}`, name: 'Clone service' } });
    const item = await prisma.catalogItem.create({ data: { code: `CLONE-ITEM-${suffix}`, name: 'Clone service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `CLONE-PRICE-${suffix}`, name: 'Clone service prices', currencyCode: 'MXN', validFrom: now } });
    const price = await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read']);

    try {
      const noPublicationYet = clonePublishedVersion(actor, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      await expect(noPublicationYet).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [
          { catalogItemId: item.id, quantity: '2' },
          { special: true, name: 'Ajuste especial', unit: 'lote', quantity: '1', unitPriceMinor: '5000', reason: 'Sin equivalente en catálogo' },
        ],
      }, { prisma, now });
      quoteId = created.quoteId;
      await submitQuoteForReview(actor, created.versionId, { prisma, now });
      const specialApproval = await requestQuoteApproval(actor, created.versionId, { type: 'SPECIAL_CONCEPT', policyVersion: 'special-concept-v1' }, { prisma, now });
      await decideQuoteApproval(salesActor(manager.id, ['quotes.approve_discount']), specialApproval.id, { decision: 'APPROVED' }, { prisma, now });
      await transitionQuoteVersion(actor, created.versionId, 'ENVIADA', { prisma, now });

      await prisma.priceListItem.update({ where: { id: price.id }, data: { unitPriceMinor: 15_000n } });

      const noPermission = clonePublishedVersion(salesActor(employee.id, []), request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      await expect(noPermission).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const cloned = await clonePublishedVersion(actor, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      expect(cloned.versionNumber).toBe(2);
      expect(cloned.versionId).not.toBe(created.versionId);
      const clonedLines = await prisma.quoteLineSnapshot.findMany({ where: { quoteVersionId: cloned.versionId }, orderBy: { unitPriceMinor: 'desc' } });
      expect(clonedLines).toHaveLength(2);
      expect(clonedLines.find((line) => line.catalogItemId === item.id)).toMatchObject({ unitPriceMinor: 15_000n });
      expect(clonedLines.find((line) => line.catalogItemId === null)).toMatchObject({ name: 'Ajuste especial', unit: 'lote', unitPriceMinor: 5000n, specialReason: 'Sin equivalente en catálogo' });
      expect(await prisma.quote.findUnique({ where: { quoteRequestId: request.quoteRequestId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: cloned.versionId, publishedVersionId: created.versionId });

      const workingConflict = clonePublishedVersion(actor, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      await expect(workingConflict).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [employee.id, manager.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('rejects a stale draft save and accepts one that matches the last known updatedAt (D2-04)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-occ`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote OCC ${suffix}`, email: `quote-occ-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Concurrency fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-occ-employee-${suffix}@example.test`, emailNormalized: `quote-occ-employee-${suffix}@example.test`, displayName: 'Quote OCC employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `OCC-${suffix}`, name: 'OCC service' } });
    const item = await prisma.catalogItem.create({ data: { code: `OCC-ITEM-${suffix}`, name: 'OCC service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `OCC-PRICE-${suffix}`, name: 'OCC service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 8000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'prices.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now: new Date('2026-09-17T12:00:00.000Z') });
      quoteId = created.quoteId;
      const originalUpdatedAt = (await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { updatedAt: true } })).updatedAt;

      const stale = replaceQuoteDraft(actor, created.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
        expectedUpdatedAt: new Date(originalUpdatedAt.getTime() - 1000),
      }, { prisma, now: new Date('2026-09-17T12:05:00.000Z') });
      await expect(stale).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const matching = await replaceQuoteDraft(actor, created.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '3' }],
        expectedUpdatedAt: originalUpdatedAt,
      }, { prisma, now: new Date('2026-09-17T12:10:00.000Z') });
      expect(matching.totalMinor).toBe(24000n);

      const secondUpdatedAt = (await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { updatedAt: true } })).updatedAt;
      const omitted = await replaceQuoteDraft(actor, created.versionId, { priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '4' }] }, { prisma, now: new Date('2026-09-17T12:15:00.000Z') });
      expect(omitted.totalMinor).toBe(32000n);
      expect(secondUpdatedAt).not.toBeNull();
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('names submit/return/reject as distinct audited commands while leaving transitionQuoteVersion behavior-preserving (D2-04)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-named`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote named ${suffix}`, email: `quote-named-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Named transitions fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-named-employee-${suffix}@example.test`, emailNormalized: `quote-named-employee-${suffix}@example.test`, displayName: 'Quote named employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `NAMED-${suffix}`, name: 'Named service' } });
    const item = await prisma.catalogItem.create({ data: { code: `NAMED-ITEM-${suffix}`, name: 'Named service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `NAMED-PRICE-${suffix}`, name: 'Named service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 9000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read', 'quotes.apply_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 300 }] }, { prisma, now });
      quoteId = created.quoteId;

      const submitted = await submitQuoteForReview(actor, created.versionId, { prisma, now });
      expect(submitted).toMatchObject({ fromStatus: 'BORRADOR', toStatus: 'EN_REVISION' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: created.versionId, action: 'quote.version.submitted' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_SUBMITTED' } })).not.toBeNull();

      await expect(returnQuoteToDraft(actor, created.versionId, { reason: '' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const returned = await returnQuoteToDraft(actor, created.versionId, { reason: 'Falta ajustar el alcance.' }, { prisma, now });
      expect(returned).toMatchObject({ fromStatus: 'EN_REVISION', toStatus: 'BORRADOR' });
      expect(await prisma.quoteStatusHistory.findFirst({ where: { quoteVersionId: created.versionId, toStatus: 'BORRADOR', fromStatus: 'EN_REVISION' } })).toMatchObject({ reason: 'Falta ajustar el alcance.' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: created.versionId, action: 'quote.version.returned_to_draft' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_REOPENED' } })).not.toBeNull();

      await submitQuoteForReview(actor, created.versionId, { prisma, now });
      await expect(rejectQuoteVersion(actor, created.versionId, { reason: '' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const rejected = await rejectQuoteVersion(actor, created.versionId, { reason: 'El cliente ya no continuará.' }, { prisma, now });
      expect(rejected).toMatchObject({ fromStatus: 'EN_REVISION', toStatus: 'RECHAZADA' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: created.versionId, action: 'quote.version.rejected' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_REJECTED' } })).not.toBeNull();

      const secondVersion = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      const legacy = await transitionQuoteVersion(actor, secondVersion.versionId, 'EN_REVISION', { prisma, now });
      expect(legacy).toMatchObject({ fromStatus: 'BORRADOR', toStatus: 'EN_REVISION' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: secondVersion.versionId, action: 'quote.version.status_changed' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: secondVersion.quoteId, eventType: 'QUOTE.VERSION_STATUS_CHANGED' } })).not.toBeNull();

      // D2-06 non-regression: reaching ENVIADA through the generic primitive (bypassing
      // publishQuoteVersion) must keep emitting the OLD generic audit action/event, not
      // the new dedicated QUOTE.PUBLISHED ones — only the named command owns that signal.
      const legacyPublish = await transitionQuoteVersion(actor, secondVersion.versionId, 'ENVIADA', { prisma, now });
      expect(legacyPublish).toMatchObject({ fromStatus: 'EN_REVISION', toStatus: 'ENVIADA' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: secondVersion.versionId, action: 'quote.version.status_changed', outcome: 'SUCCESS' } })).not.toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { entityId: secondVersion.versionId, action: 'quote.version.published' } })).toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: secondVersion.quoteId, eventType: 'QUOTE.VERSION_STATUS_CHANGED', payload: { path: ['toStatus'], equals: 'ENVIADA' } } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: secondVersion.quoteId, eventType: 'QUOTE.PUBLISHED' } })).toBeNull();
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
