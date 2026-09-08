import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { seedIdentityCatalog } from '../../prisma/seed';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { inviteCustomerPortalAccess } from '@/server/modules/customer-onboarding/service';

describe('customer onboarding service', () => {
  const prisma = getPrisma();
  const requestIds: string[] = [];
  const clientIds: string[] = [];
  const contactIds: string[] = [];
  const userIds: string[] = [];

  const actor = (userId: string, permissions: string[]): Actor => ({
    userId,
    type: 'EMPLOYEE',
    clientId: null,
    permissionKeys: new Set(permissions),
    mfaVerified: true,
  });

  async function createRequest(suffix: string, email = `onboarding-${suffix}@example.test`) {
    const result = await createQuoteRequest({
      idempotencyKey: `customer-onboarding-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: `Onboarding ${suffix}`, email, phone: '+52 667 000 8899' },
      detail: {
        projectType: 'Residencial',
        location: 'Culiacán',
        description: 'Customer onboarding integration test',
        consentAt: new Date('2026-09-08T12:00:00.000Z'),
      },
    }, { prisma, now: new Date('2026-09-08T12:00:00.000Z') });
    requestIds.push(result.quoteRequestId);
    clientIds.push(result.clientId);
    contactIds.push(result.contactId);
    return result;
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
  });

  it('creates a pending customer account, links the contact and issues one invitation', async () => {
    const suffix = `${Date.now()}-create`;
    const manager = await prisma.user.create({
      data: { email: `manager-${suffix}@example.test`, emailNormalized: `manager-${suffix}@example.test`, displayName: 'Onboarding manager', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    userIds.push(manager.id);
    const request = await createRequest(suffix);

    const result = await inviteCustomerPortalAccess(actor(manager.id, ['identity.users.manage']), request.quoteRequestId, {
      prisma,
      now: new Date('2026-09-08T12:10:00.000Z'),
      tokenGenerator: () => `invite-token-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`,
    });

    const contact = await prisma.clientContact.findUnique({ where: { id: request.contactId }, include: { user: { include: { roles: { include: { role: true } } } } } });
    const token = contact?.user ? await prisma.authToken.findFirst({ where: { userId: contact.user.id, type: 'MAGIC_LINK' } }) : null;
    const outbox = contact?.user ? await prisma.outboxEvent.findFirst({ where: { aggregateId: contact.user.id, eventType: 'AUTH.CUSTOMER_MAGIC_LINK' } }) : null;
    const audit = await prisma.auditLog.findFirst({ where: { entityId: request.quoteRequestId, action: 'customer_access.invited' } });

    expect(result).toMatchObject({ quoteRequestId: request.quoteRequestId, folio: request.folio, status: 'INVITED', email: `onboarding-${suffix}@example.test` });
    expect(contact?.user).toMatchObject({ type: 'CUSTOMER', status: 'INVITED', clientId: request.clientId });
    expect(contact?.user?.roles.some(({ role }) => role.key === 'customer')).toBe(true);
    expect(token).toMatchObject({ consumedAt: null });
    expect(outbox).toBeTruthy();
    expect(JSON.stringify(outbox?.payload)).not.toContain('invite-token-');
    expect(audit).toMatchObject({ outcome: 'SUCCESS', metadata: { folio: request.folio, outcome: 'INVITED' } });
  });

  it('is idempotent for a pending invitation and denies employees without the capability', async () => {
    const suffix = `${Date.now()}-pending`;
    const sales = await prisma.user.create({
      data: { email: `sales-${suffix}@example.test`, emailNormalized: `sales-${suffix}@example.test`, displayName: 'Onboarding sales', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    userIds.push(sales.id);
    const request = await createRequest(suffix);

    await expect(inviteCustomerPortalAccess(actor(sales.id, ['requests.read']), request.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const first = await inviteCustomerPortalAccess(actor(sales.id, ['identity.users.manage']), request.quoteRequestId, {
      prisma,
      now: new Date('2026-09-08T12:20:00.000Z'),
      tokenGenerator: () => `pending-token-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`,
    });
    const second = await inviteCustomerPortalAccess(actor(sales.id, ['identity.users.manage']), request.quoteRequestId, {
      prisma,
      now: new Date('2026-09-08T12:21:00.000Z'),
      tokenGenerator: () => `pending-token-2-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`,
    });

    expect(first.status).toBe('INVITED');
    expect(second).toMatchObject({ status: 'ALREADY_PENDING', email: `onboarding-${suffix}@example.test` });
    expect(await prisma.authToken.count({ where: { user: { contactProfile: { id: request.contactId } }, type: 'MAGIC_LINK', consumedAt: null } })).toBe(1);
  });

  it('does not attach an identity already owned by another client or an employee', async () => {
    const suffix = `${Date.now()}-collision`;
    const manager = await prisma.user.create({
      data: { email: `manager-collision-${suffix}@example.test`, emailNormalized: `manager-collision-${suffix}@example.test`, displayName: 'Collision manager', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    userIds.push(manager.id);
    const foreignClient = await prisma.client.create({ data: { displayName: `Foreign onboarding ${suffix}` } });
    clientIds.push(foreignClient.id);
    const foreignCustomer = await prisma.user.create({
      data: { email: `collision-${suffix}@example.test`, emailNormalized: `collision-${suffix}@example.test`, displayName: 'Foreign customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: foreignClient.id },
    });
    userIds.push(foreignCustomer.id);
    const request = await createRequest(suffix, `collision-${suffix}@example.test`);

    await expect(inviteCustomerPortalAccess(actor(manager.id, ['identity.users.manage']), request.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect((await prisma.clientContact.findUnique({ where: { id: request.contactId } }))?.userId).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: foreignCustomer.id } }))?.clientId).toBe(foreignClient.id);
  });

  it('reuses an active customer safely and rejects archived contacts or malformed identifiers', async () => {
    const suffix = `${Date.now()}-states`;
    const manager = await prisma.user.create({
      data: { email: `manager-states-${suffix}@example.test`, emailNormalized: `manager-states-${suffix}@example.test`, displayName: 'States manager', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    userIds.push(manager.id);
    const activeRequest = await createRequest(`${suffix}-active`);
    const activeEmail = `active-${suffix}@example.test`;
    const activeCustomer = await prisma.user.create({
      data: { email: activeEmail, emailNormalized: activeEmail, displayName: 'Active customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: activeRequest.clientId },
    });
    userIds.push(activeCustomer.id);
    await prisma.clientContact.update({ where: { id: activeRequest.contactId }, data: { email: activeCustomer.email, emailNormalized: activeCustomer.emailNormalized } });

    const activeResult = await inviteCustomerPortalAccess(actor(manager.id, ['identity.users.manage']), activeRequest.quoteRequestId, {
      prisma,
      now: new Date('2026-09-08T12:30:00.000Z'),
      tokenGenerator: () => `active-token-${suffix}-abcdefghijklmnopqrstuvwxyz-123456`,
    });
    expect(activeResult.status).toBe('ALREADY_ACTIVE');
    expect((await prisma.clientContact.findUnique({ where: { id: activeRequest.contactId } }))?.userId).toBe(activeCustomer.id);

    const archivedRequest = await createRequest(`${suffix}-archived`);
    await prisma.clientContact.update({ where: { id: archivedRequest.contactId }, data: { status: 'ARCHIVED' } });
    await expect(inviteCustomerPortalAccess(actor(manager.id, ['identity.users.manage']), archivedRequest.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(inviteCustomerPortalAccess(actor(manager.id, ['identity.users.manage']), 'not-a-uuid', { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: userIds } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { clientId: { in: clientIds } }] } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.$disconnect();
  });
});
