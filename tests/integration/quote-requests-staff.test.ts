import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import {
  assignQuoteRequest,
  getStaffQuoteRequest,
  listStaffAssignees,
  listStaffQuoteRequests,
  transitionQuoteRequest,
} from '@/server/modules/quote-requests/staff-service';

describe('staff quote request operations', () => {
  const prisma = getPrisma();
  const actorUserIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdContactIds: string[] = [];

  const staffActor = (userId: string, permissions: string[]): Actor => ({
    userId,
    type: 'EMPLOYEE',
    clientId: null,
    permissionKeys: new Set(permissions),
    mfaVerified: true,
  });

  async function createStaffUser(suffix: string) {
    const email = `staff-${suffix}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        displayName: `Staff ${suffix}`,
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    actorUserIds.push(user.id);
    return user;
  }

  async function createRequest(suffix: string) {
    const result = await createQuoteRequest({
      idempotencyKey: `staff-request-${suffix}-1234`,
      origin: 'PUBLIC_FORM',
      contact: { displayName: `Staff client ${suffix}`, email: `staff-client-${suffix}@example.test`, phone: '+52 667 000 8899' },
      detail: { projectType: 'Hotel', location: 'Nayarit', description: 'Staff operation contract', consentAt: new Date('2026-01-04T12:00:00.000Z') },
    }, { prisma, now: new Date('2026-01-04T12:00:00.000Z') });
    createdRequestIds.push(result.quoteRequestId);
    createdClientIds.push(result.clientId);
    createdContactIds.push(result.contactId);
    return result;
  }

  it('lists and reads only the staff-safe projection with pagination filters', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const staff = await createStaffUser(`read-${Date.now()}`);
    const request = await createRequest(`read-${Date.now()}`);
    const result = await listStaffQuoteRequests(staffActor(staff.id, ['requests.read']), { query: request.folio, page: 1, pageSize: 10 }, { prisma });
    const detail = await getStaffQuoteRequest(staffActor(staff.id, ['requests.read']), request.quoteRequestId, { prisma });

    expect(result).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ id: request.quoteRequestId, folio: request.folio, status: 'RECIBIDA', client: { displayName: expect.stringContaining('Staff client read-') } });
    expect(detail).toMatchObject({ id: request.quoteRequestId, folio: request.folio, detail: { description: 'Staff operation contract' }, statusHistory: [{ toStatus: 'RECIBIDA' }] });
    expect(JSON.stringify(detail)).not.toContain('idempotencyKeyHash');
  });

  it('assigns with history and transitions atomically, rejecting invalid operations', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`actor-${Date.now()}`);
    const assignee = await createStaffUser(`assignee-${Date.now()}`);
    const request = await createRequest(`mutate-${Date.now()}`);
    const operator = staffActor(actor.id, ['requests.read', 'requests.assign', 'requests.status.update']);

    const assignment = await assignQuoteRequest(operator, request.quoteRequestId, { assignedToId: assignee.id, reason: 'Distribución operativa' }, { prisma, now: new Date('2026-01-04T12:10:00.000Z') });
    const status = await transitionQuoteRequest(operator, request.quoteRequestId, { toStatus: 'EN_REVISION', reason: 'Inicio de revisión' }, { prisma, now: new Date('2026-01-04T12:11:00.000Z') });
    const detail = await getStaffQuoteRequest(operator, request.quoteRequestId, { prisma });

    expect(assignment).toMatchObject({ quoteRequestId: request.quoteRequestId, currentAssigneeId: assignee.id });
    expect(status).toMatchObject({ quoteRequestId: request.quoteRequestId, fromStatus: 'RECIBIDA', toStatus: 'EN_REVISION' });
    expect(detail).toMatchObject({ currentAssignee: { id: assignee.id }, status: 'EN_REVISION' });
    expect(detail.assignments).toHaveLength(1);
    expect(detail.statusHistory).toHaveLength(2);
    await expect(transitionQuoteRequest(operator, request.quoteRequestId, { toStatus: 'ACEPTADA' }, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(assignQuoteRequest(staffActor(actor.id, ['requests.read']), request.quoteRequestId, { assignedToId: assignee.id }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('denies customers and validates active employee assignees', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const customer = await prisma.user.create({
      data: {
        email: `staff-customer-${Date.now()}@example.test`,
        emailNormalized: `staff-customer-${Date.now()}@example.test`,
        displayName: 'Staff test customer',
        type: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });
    actorUserIds.push(customer.id);
    const actor = await createStaffUser(`inactive-${Date.now()}`);
    const inactive = await createStaffUser(`disabled-${Date.now()}`);
    await prisma.user.update({ where: { id: inactive.id }, data: { status: 'DISABLED' } });
    const request = await createRequest(`security-${Date.now()}`);

    await expect(listStaffQuoteRequests(staffActor(customer.id, ['portal.self.read']), {}, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(assignQuoteRequest(staffActor(actor.id, ['requests.assign']), request.quoteRequestId, { assignedToId: inactive.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(getStaffQuoteRequest(staffActor(actor.id, ['requests.read']), '00000000-0000-4000-8000-000000000000', { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('lists only active employee assignees', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const active = await createStaffUser(`assignees-active-${Date.now()}`);
    const disabled = await createStaffUser(`assignees-disabled-${Date.now()}`);
    await prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });
    const assignees = await listStaffAssignees(staffActor(active.id, ['requests.assign']), { prisma });
    expect(assignees.some(({ id }) => id === active.id)).toBe(true);
    expect(assignees.some(({ id }) => id === disabled.id)).toBe(false);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdRequestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdRequestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: createdContactIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: actorUserIds } } });
    await prisma.$disconnect();
  });
});
