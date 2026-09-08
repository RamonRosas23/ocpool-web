import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import type { Actor } from '@/server/auth/types';
import { getStaffDashboard } from '@/server/modules/analytics/service';

describe('analytics dashboard service', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const requestIds: string[] = [];
  const quoteIds: string[] = [];
  const generatedDocumentIds: string[] = [];
  const notificationDeliveryIds: string[] = [];
  const outboxEventIds: string[] = [];
  const now = new Date('2026-09-08T18:00:00.000Z');
  let sales: { id: string };
  let manager: { id: string };

  const actor = (userId: string, permissionKeys = ['metrics.read']): Actor => ({
    userId,
    type: 'EMPLOYEE',
    clientId: null,
    permissionKeys: new Set(permissionKeys),
    mfaVerified: true,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, managerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    [sales, manager] = await Promise.all([
      prisma.user.create({ data: { email: `analytics-sales-${suffix}@example.test`, emailNormalized: `analytics-sales-${suffix}@example.test`, displayName: 'Analytics Sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `analytics-manager-${suffix}@example.test`, emailNormalized: `analytics-manager-${suffix}@example.test`, displayName: 'Analytics Manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
    ]);
    userIds.push(sales.id, manager.id);
    const fixtureFolioSuffix = suffix.replace(/[^a-z0-9]/giu, '').slice(-9);

    const clients = await Promise.all([
      prisma.client.create({ data: { displayName: `Analytics Client A ${suffix}`, status: 'ACTIVE' } }),
      prisma.client.create({ data: { displayName: `Analytics Client B ${suffix}`, status: 'ACTIVE' } }),
      prisma.client.create({ data: { displayName: `Analytics Client C ${suffix}`, status: 'ACTIVE' } }),
    ]);
    clientIds.push(...clients.map((client) => client.id));
    const contacts = await Promise.all(clients.map((client, index) => prisma.clientContact.create({
      data: {
        clientId: client.id,
        displayName: `Analytics Contact ${index} ${suffix}`,
        email: `analytics-contact-${index}-${suffix}@example.test`,
        emailNormalized: `analytics-contact-${index}-${suffix}@example.test`,
      },
    })));
    contactIds.push(...contacts.map((contact) => contact.id));

    const requestData = [
      { clientId: clientIds[0], contactId: contactIds[0], currentAssigneeId: sales.id, status: 'RECIBIDA' as const, origin: 'PUBLIC_FORM' as const, createdAt: new Date('2026-09-02T12:00:00.000Z') },
      { clientId: clientIds[1], contactId: contactIds[1], currentAssigneeId: manager.id, status: 'EN_REVISION' as const, origin: 'STAFF_CREATED' as const, createdAt: new Date('2026-09-03T12:00:00.000Z') },
      { clientId: clientIds[2], contactId: contactIds[2], currentAssigneeId: null, status: 'RECIBIDA' as const, origin: 'PUBLIC_FORM' as const, createdAt: new Date('2026-09-04T12:00:00.000Z') },
    ];
    for (const [index, item] of requestData.entries()) {
      const request = await prisma.quoteRequest.create({
        data: {
          folio: `OCQ-2026-${String(index + 1).padStart(5, '0')}${fixtureFolioSuffix}`,
          clientId: item.clientId,
          contactId: item.contactId,
          currentAssigneeId: item.currentAssigneeId,
          origin: item.origin,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
          statusHistory: { create: { toStatus: item.status, createdAt: item.createdAt, changedById: manager.id } },
        },
      });
      requestIds.push(request.id);
    }
    await prisma.requestAssignment.create({
      data: {
        quoteRequestId: requestIds[0],
        assignedToId: sales.id,
        assignedById: manager.id,
        assignedAt: new Date('2026-09-02T13:00:00.000Z'),
      },
    });

    const salesQuote = await prisma.quote.create({
      data: {
        quoteRequestId: requestIds[0],
        clientId: clientIds[0],
        createdAt: new Date('2026-09-02T13:30:00.000Z'),
        updatedAt: new Date('2026-09-03T10:00:00.000Z'),
      },
    });
    quoteIds.push(salesQuote.id);
    const salesVersion = await prisma.quoteVersion.create({
      data: {
        quoteId: salesQuote.id,
        versionNumber: 1,
        status: 'ACEPTADA',
        currencyCode: 'MXN',
        subtotalMinor: 100000n,
        taxableTotalMinor: 100000n,
        taxTotalMinor: 0n,
        totalMinor: 100000n,
        createdById: sales.id,
        createdAt: new Date('2026-09-02T14:00:00.000Z'),
        statusHistory: {
          create: [
            { toStatus: 'ENVIADA', changedById: sales.id, createdAt: new Date('2026-09-02T14:00:00.000Z') },
            { fromStatus: 'ENVIADA', toStatus: 'ACEPTADA', changedById: manager.id, createdAt: new Date('2026-09-03T10:00:00.000Z') },
          ],
        },
      },
    });
    await prisma.quote.update({ where: { id: salesQuote.id }, data: { currentVersionId: salesVersion.id } });
    const salesDocument = await prisma.generatedDocument.create({
      data: {
        quoteId: salesQuote.id,
        quoteVersionId: salesVersion.id,
        templateVersion: 'analytics-test-v1',
        status: 'PENDING',
        createdAt: new Date('2026-09-02T14:05:00.000Z'),
      },
    });
    await prisma.quoteAcceptance.create({
      data: {
        quoteId: salesQuote.id,
        quoteVersionId: salesVersion.id,
        generatedDocumentId: salesDocument.id,
        acceptedById: manager.id,
        documentSha256: 'a'.repeat(64),
        signerName: 'Analytics Signer',
        termsVersion: 'analytics-v1',
        idempotencyKeyHash: 'b'.repeat(64),
        acceptedAt: new Date('2026-09-03T10:00:00.000Z'),
      },
    });
    generatedDocumentIds.push(salesDocument.id);

    const managerQuote = await prisma.quote.create({
      data: {
        quoteRequestId: requestIds[1],
        clientId: clientIds[1],
        createdAt: new Date('2026-09-03T13:30:00.000Z'),
      },
    });
    quoteIds.push(managerQuote.id);
    const managerVersion = await prisma.quoteVersion.create({
      data: {
        quoteId: managerQuote.id,
        versionNumber: 1,
        status: 'ENVIADA',
        currencyCode: 'USD',
        subtotalMinor: 250000n,
        taxableTotalMinor: 250000n,
        taxTotalMinor: 0n,
        totalMinor: 250000n,
        createdById: manager.id,
        createdAt: new Date('2026-09-03T14:00:00.000Z'),
        statusHistory: { create: { toStatus: 'ENVIADA', changedById: manager.id, createdAt: new Date('2026-09-03T14:00:00.000Z') } },
      },
    });
    await prisma.quote.update({ where: { id: managerQuote.id }, data: { currentVersionId: managerVersion.id } });
    const outboxEvent = await prisma.outboxEvent.create({
      data: {
        eventType: 'analytics.test.notification',
        aggregateType: 'QuoteRequest',
        aggregateId: requestIds[0],
        payload: { privateEmail: `analytics-private-${suffix}@example.test` },
        createdAt: new Date('2026-09-05T10:00:00.000Z'),
      },
    });
    outboxEventIds.push(outboxEvent.id);
    const notificationDelivery = await prisma.notificationDelivery.create({
      data: {
        outboxEventId: outboxEvent.id,
        templateKey: 'analytics-test',
        templateVersion: 'v1',
        recipientAddressCiphertext: 'analytics-test-ciphertext',
        recipientAddressHash: 'c'.repeat(64),
        status: 'FAILED',
        lastErrorCode: 'TEMPORARY_PROVIDER',
        createdAt: new Date('2026-09-05T10:00:00.000Z'),
        updatedAt: new Date('2026-09-05T10:00:00.000Z'),
      },
    });
    notificationDeliveryIds.push(notificationDelivery.id);
  });

  it('limits sales metrics to assigned requests and returns safe operational aggregates', async () => {
    const result = await getStaffDashboard(actor(sales.id), { from: '2026-09-01', to: '2026-09-08', timezone: 'UTC' }, { prisma, now });

    expect(result.meta).toMatchObject({ scope: 'self', timezone: 'UTC' });
    expect(result.requests.received).toBe(1);
    expect(result.requests.unassigned).toBe(0);
    expect(result.requests.byStatus).toEqual([{ status: 'RECIBIDA', count: 1 }]);
    expect(result.notifications).toBeDefined();
    expect(result.quotes).toMatchObject({ sent: 1, accepted: 1, acceptanceRateBps: 10000 });
    expect(result.quotes.acceptedTotals).toEqual([{ currencyCode: 'MXN', totalMinor: '100000', count: 1 }]);
    expect(result.quotes.byStatus).toEqual([{ status: 'ACEPTADA', count: 1 }]);
    expect(result.notifications.failedInPeriod).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result)).not.toMatch(/analytics-contact|@example\.test|Analytics Client|clientId|email|payload|secret/i);
  });

  it('allows manager global metrics and keeps unassigned work visible', async () => {
    const result = await getStaffDashboard(actor(manager.id, ['metrics.read', 'metrics.read.global']), { from: '2026-09-01', to: '2026-09-08', timezone: 'UTC' }, { prisma, now });

    expect(result.meta.scope).toBe('global');
    expect(result.requests.received).toBe(3);
    expect(result.requests.unassigned).toBe(1);
    expect(result.requests.byOrigin).toEqual([
      { origin: 'PUBLIC_FORM', count: 2 },
      { origin: 'STAFF_CREATED', count: 1 },
    ]);
    expect(result.quotes).toMatchObject({ sent: 2, accepted: 1, acceptanceRateBps: 5000 });
    expect(result.quotes.acceptedTotals).toEqual([{ currencyCode: 'MXN', totalMinor: '100000', count: 1 }]);
    expect(result.quotes.byStatus).toEqual([
      { status: 'ACEPTADA', count: 1 },
      { status: 'ENVIADA', count: 1 },
    ]);
    expect(result.workload.every((row) => row.suppressed || row.displayName.includes('Analytics'))).toBe(true);
  });

  it('denies dashboard access to an actor without the metrics permission', async () => {
    await expect(getStaffDashboard(actor(manager.id, []), { from: '2026-09-01', to: '2026-09-08', timezone: 'UTC' }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(getStaffDashboard({ ...actor(manager.id), type: 'CUSTOMER', clientId: clientIds[1] }, { from: '2026-09-01', to: '2026-09-08', timezone: 'UTC' }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rate limits expensive reads before executing aggregates', async () => {
    await expect(getStaffDashboard(actor(sales.id), { from: '2026-09-01', to: '2026-09-08', timezone: 'UTC' }, {
      prisma,
      now,
      rateLimit: async () => ({ allowed: false, retryAfterSeconds: 60 }),
    })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.authRateLimit.deleteMany({ where: { scope: 'analytics-dashboard-read', keyHash: { in: [fingerprintToken(sales.id), fingerprintToken(manager.id)] } } });
    await prisma.requestAssignment.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await prisma.generatedDocument.deleteMany({ where: { id: { in: generatedDocumentIds } } });
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.notificationDelivery.deleteMany({ where: { id: { in: notificationDeliveryIds } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
    await prisma.requestStatusHistory.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
});
