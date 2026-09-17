import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import {
  assignQuoteRequest,
  createStaffQuoteRequest,
  findStaffQuoteRequestMatches,
  getStaffQuoteRequest,
  listStaffAssignees,
  listStaffQuoteRequestActivity,
  listStaffQuoteRequests,
  markInformationReviewedQuoteRequest,
  requestInformationQuoteRequest,
  takeQuoteRequest,
  transitionQuoteRequest,
  updateStaffQuoteRequest,
} from '@/server/modules/quote-requests/staff-service';
import {
  normalizeRequestWorkspaceQuery,
  requestWorkspaceQueryToListFilters,
} from '@/lib/request-workspace-query';

describe('staff quote request operations', () => {
  const prisma = getPrisma();
  const actorUserIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdContactIds: string[] = [];
  const createdCustomerUserIds: string[] = [];

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
      detail: {
        projectType: 'Hotel',
        location: 'Nayarit',
        projectStage: 'UNDER_CONSTRUCTION',
        dimensions: '12 x 5 m',
        timeline: 'THREE_TO_SIX_MONTHS',
        budgetRange: 'FROM_500K_TO_1M',
        description: 'Staff operation contract',
        consentAt: new Date('2026-01-04T12:00:00.000Z'),
      },
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
    expect(detail).toMatchObject({
      id: request.quoteRequestId,
      folio: request.folio,
      availableStatusTransitions: [],
      availableActions: [],
      detail: {
        description: 'Staff operation contract',
        projectStage: 'UNDER_CONSTRUCTION',
        dimensions: '12 x 5 m',
        timeline: 'THREE_TO_SIX_MONTHS',
        budgetRange: 'FROM_500K_TO_1M',
      },
      statusHistory: [{ toStatus: 'RECIBIDA' }],
    });
    expect(JSON.stringify(detail)).not.toContain('idempotencyKeyHash');
  });

  it('applies workspace views, non-overlapping age filters and stable sorting', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const operator = await createStaffUser(`workspace-query-operator-${Date.now()}`);
    const requests = await Promise.all([
      createRequest(`workspace-query-${Date.now()}-old`),
      createRequest(`workspace-query-${Date.now()}-mine`),
      createRequest(`workspace-query-${Date.now()}-recent`),
    ]);
    const now = new Date('2026-09-12T18:00:00.000Z');
    const timestamps = [
      new Date('2026-08-01T18:00:00.000Z'),
      new Date('2026-09-10T18:00:00.000Z'),
      new Date('2026-09-11T18:00:00.000Z'),
    ];
    for (const [index, request] of requests.entries()) {
      await prisma.quoteRequest.update({
        where: { id: request.quoteRequestId },
        data: { createdAt: timestamps[index], updatedAt: timestamps[index] },
      });
    }
    await assignQuoteRequest(staffActor(operator.id, ['requests.assign']), requests[1].quoteRequestId, { assignedToId: operator.id }, { prisma, now });

    const operatorActor = staffActor(operator.id, ['requests.read', 'requests.assign']);
    const prefix = 'workspace-query-';
    const sorted = await listStaffQuoteRequests(operatorActor, {
      ...requestWorkspaceQueryToListFilters(normalizeRequestWorkspaceQuery({ query: prefix, sort: 'oldest' }), operator.id, now),
    }, { prisma, now });
    expect(sorted.items.map(({ id }) => id)).toEqual([
      requests[0].quoteRequestId,
      requests[1].quoteRequestId,
      requests[2].quoteRequestId,
    ]);

    const recent = await listStaffQuoteRequests(operatorActor, requestWorkspaceQueryToListFilters(
      normalizeRequestWorkspaceQuery({ query: prefix, age: '0-1' }),
      operator.id,
      now,
    ), { prisma, now });
    expect(recent.items.map(({ id }) => id)).toEqual([requests[2].quoteRequestId]);

    const mine = await listStaffQuoteRequests(operatorActor, requestWorkspaceQueryToListFilters(
      normalizeRequestWorkspaceQuery({ query: prefix, view: 'mine' }),
      operator.id,
      now,
    ), { prisma, now });
    expect(mine.items.map(({ id }) => id)).toEqual([requests[1].quoteRequestId]);

    const unassigned = await listStaffQuoteRequests(operatorActor, requestWorkspaceQueryToListFilters(
      normalizeRequestWorkspaceQuery({ query: prefix, view: 'unassigned' }),
      operator.id,
      now,
    ), { prisma, now });
    expect(unassigned.items.map(({ id }) => id)).toEqual(expect.arrayContaining([requests[0].quoteRequestId, requests[2].quoteRequestId]));
    expect(unassigned.items).toHaveLength(2);
  });

  it('limits non-global staff to their own and unassigned requests', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const operator = await createStaffUser(`scope-operator-${Date.now()}`);
    const rival = await createStaffUser(`scope-rival-${Date.now()}`);
    const own = await createRequest(`scope-own-${Date.now()}`);
    const unassigned = await createRequest(`scope-free-${Date.now()}`);
    const foreign = await createRequest(`scope-foreign-${Date.now()}`);
    await assignQuoteRequest(staffActor(operator.id, ['requests.assign', 'requests.read.global']), own.quoteRequestId, { assignedToId: operator.id }, { prisma });
    await assignQuoteRequest(staffActor(operator.id, ['requests.assign', 'requests.read.global']), foreign.quoteRequestId, { assignedToId: rival.id }, { prisma });

    const reader = staffActor(operator.id, ['requests.read']);
    const scoped = await listStaffQuoteRequests(reader, { query: 'scope-', sort: 'oldest' }, { prisma });
    expect(scoped.items.map(({ id }) => id)).toEqual(expect.arrayContaining([own.quoteRequestId, unassigned.quoteRequestId]));
    expect(scoped.items.map(({ id }) => id)).not.toContain(foreign.quoteRequestId);
    const globalReader = staffActor(operator.id, ['requests.read', 'requests.read.global']);
    const global = await listStaffQuoteRequests(globalReader, { query: 'scope-', sort: 'oldest' }, { prisma });
    expect(global.items.map(({ id }) => id)).toEqual(expect.arrayContaining([own.quoteRequestId, unassigned.quoteRequestId, foreign.quoteRequestId]));
    await expect(listStaffQuoteRequests(globalReader, { assignedToId: rival.id }, { prisma })).resolves.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: foreign.quoteRequestId })]) });
    await expect(listStaffQuoteRequests(reader, { assignedToId: rival.id }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(getStaffQuoteRequest(reader, foreign.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(listStaffQuoteRequestActivity(reader, foreign.quoteRequestId, {}, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('paginates the combined status and assignment activity with a stable cursor', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`activity-${Date.now()}`);
    const request = await createRequest(`activity-${Date.now()}`);
    await prisma.requestStatusHistory.createMany({
      data: Array.from({ length: 35 }, (_, index) => ({
        quoteRequestId: request.quoteRequestId,
        fromStatus: 'RECIBIDA' as const,
        toStatus: 'EN_REVISION' as const,
        reason: `Actividad ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 5, 12, index)),
      })),
    });

    const operator = staffActor(actor.id, ['requests.read']);
    const firstPage = await listStaffQuoteRequestActivity(operator, request.quoteRequestId, { limit: 10 }, { prisma });
    const secondPage = await listStaffQuoteRequestActivity(operator, request.quoteRequestId, { limit: 10, cursor: firstPage.nextCursor ?? undefined }, { prisma });
    const firstIds = firstPage.items.map((item) => item.id);
    const secondIds = secondPage.items.map((item) => item.id);

    expect(firstPage.items).toHaveLength(10);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.items).toHaveLength(10);
    expect(secondIds).not.toEqual(expect.arrayContaining(firstIds));
    await expect(listStaffQuoteRequestActivity(operator, request.quoteRequestId, { cursor: 'not-a-cursor' }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('assigns with history and transitions atomically, rejecting invalid operations', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`actor-${Date.now()}`);
    const assignee = await createStaffUser(`assignee-${Date.now()}`);
    const request = await createRequest(`mutate-${Date.now()}`);
    const operator = staffActor(actor.id, ['requests.read', 'requests.read.global', 'requests.assign', 'requests.status.update', 'quotes.create']);

    const assignment = await assignQuoteRequest(operator, request.quoteRequestId, { assignedToId: assignee.id, reason: 'Distribución operativa' }, { prisma, now: new Date('2026-01-04T12:10:00.000Z') });
    const status = await transitionQuoteRequest(operator, request.quoteRequestId, { toStatus: 'EN_REVISION', reason: 'Inicio de revisión' }, { prisma, now: new Date('2026-01-04T12:11:00.000Z') });
    const detail = await getStaffQuoteRequest(operator, request.quoteRequestId, { prisma });

    expect(assignment).toMatchObject({ quoteRequestId: request.quoteRequestId, currentAssigneeId: assignee.id });
    expect(status).toMatchObject({ quoteRequestId: request.quoteRequestId, fromStatus: 'RECIBIDA', toStatus: 'EN_REVISION' });
    expect(detail).toMatchObject({ currentAssignee: { id: assignee.id }, status: 'EN_REVISION' });
    expect(detail.availableStatusTransitions).toEqual(expect.arrayContaining(['EN_ELABORACION', 'RECHAZADA']));
    expect(detail.availableActions).not.toContain('quote.open');
    expect(detail.assignments).toHaveLength(1);
    expect(detail.statusHistory).toHaveLength(2);
    await transitionQuoteRequest(operator, request.quoteRequestId, { toStatus: 'EN_ELABORACION' }, { prisma, now: new Date('2026-01-04T12:12:00.000Z') });
    const quoteReadyDetail = await getStaffQuoteRequest(operator, request.quoteRequestId, { prisma });
    expect(quoteReadyDetail.availableActions).toContain('quote.open');
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
    await expect(assignQuoteRequest(staffActor(actor.id, ['requests.assign', 'requests.read.global']), request.quoteRequestId, { assignedToId: inactive.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
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

  it('takes only free requests and protects manager-only reassignment', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`take-actor-${Date.now()}`);
    const rival = await createStaffUser(`take-rival-${Date.now()}`);
    const request = await createRequest(`take-${Date.now()}`);
    const actorPermissions = staffActor(actor.id, ['requests.read', 'requests.assign', 'requests.claim']);

    await expect(takeQuoteRequest(staffActor(actor.id, ['requests.read', 'requests.assign']), request.quoteRequestId, {}, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(takeQuoteRequest(actorPermissions, request.quoteRequestId, {}, { prisma, now: new Date('2026-01-05T12:00:00.000Z') })).resolves.toMatchObject({
      quoteRequestId: request.quoteRequestId,
      currentAssigneeId: actor.id,
      status: 'TAKEN',
    });
    await expect(takeQuoteRequest(staffActor(rival.id, ['requests.claim']), request.quoteRequestId, {}, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(assignQuoteRequest(actorPermissions, request.quoteRequestId, { assignedToId: rival.id }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const globalOperator = staffActor(actor.id, ['requests.assign', 'requests.reassign', 'requests.read.global']);
    await expect(assignQuoteRequest(globalOperator, request.quoteRequestId, { assignedToId: rival.id }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(assignQuoteRequest(globalOperator, request.quoteRequestId, { assignedToId: rival.id, reason: 'Balancear carga operativa' }, { prisma })).resolves.toMatchObject({ currentAssigneeId: rival.id });
  });

  it('updates commercial profile and project fields with safe before/after audit', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`edit-actor-${Date.now()}`);
    const request = await createRequest(`edit-${Date.now()}`);
    const operator = staffActor(actor.id, ['requests.read', 'requests.edit']);
    await expect(updateStaffQuoteRequest(operator, request.quoteRequestId, {
      contact: { displayName: 'Contacto corregido', email: `edited-${Date.now()}@example.test`, phone: '+52 667 000 1111', roleTitle: 'Directora de proyecto' },
      detail: { location: 'La Paz', dimensions: '14 x 6 m', timeline: 'ONE_TO_THREE_MONTHS', budgetRange: 'OVER_1M' },
      reason: 'Corrección de contacto y proyecto.',
    }, { prisma })).resolves.toMatchObject({ quoteRequestId: request.quoteRequestId, changedFields: expect.arrayContaining(['contact.displayName', 'contact.email', 'detail.location', 'detail.budgetRange']) });
    const updated = await getStaffQuoteRequest(operator, request.quoteRequestId, { prisma });
    expect(updated).toMatchObject({ contact: { displayName: 'Contacto corregido', email: expect.stringMatching(/^edited-/) }, detail: { location: 'La Paz', dimensions: '14 x 6 m', timeline: 'ONE_TO_THREE_MONTHS', budgetRange: 'OVER_1M' } });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: request.quoteRequestId, action: 'quote_request.updated' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.metadata)).not.toContain('edited-');

    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'COTIZACION_DISPONIBLE' } });
    await expect(updateStaffQuoteRequest(operator, request.quoteRequestId, { detail: { location: 'Monterrey' } }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(updateStaffQuoteRequest(operator, request.quoteRequestId, { detail: { location: 'Monterrey' }, reason: 'Corrección posterior a revisión' }, { prisma })).resolves.toMatchObject({ quoteRequestId: request.quoteRequestId });
    await expect(updateStaffQuoteRequest(staffActor(actor.id, ['requests.read']), request.quoteRequestId, { detail: { location: 'Mérida' } }, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('requests information as one idempotent intent with message, access and recovery evidence', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`information-actor-${Date.now()}`);
    const informationSuffix = `information-${Date.now()}`;
    const request = await createRequest(informationSuffix);
    const operator = staffActor(actor.id, ['requests.read', 'requests.status.update', 'messaging.send', 'customer.portal.invite']);
    await transitionQuoteRequest(operator, request.quoteRequestId, { toStatus: 'EN_REVISION', reason: 'Revisión inicial' }, { prisma });

    const input = {
      message: 'Para preparar tu propuesta necesitamos confirmar las dimensiones y el calendario del proyecto.',
      idempotencyKey: `request-information-${Date.now()}-1234`,
      missingFields: ['detail.dimensions', 'detail.timeline'] as const,
      enablePortalAccess: true,
    };
    const result = await requestInformationQuoteRequest(operator, request.quoteRequestId, input, { prisma, now: new Date('2026-09-13T12:00:00.000Z'), tokenGenerator: () => `information-token-${Date.now()}-abcdefghijklmnopqrstuvwxyz` });
    expect(result).toMatchObject({ quoteRequestId: request.quoteRequestId, fromStatus: 'EN_REVISION', toStatus: 'INFORMACION_REQUERIDA', portalAccess: { status: 'INVITED' } });

    const customerUser = await prisma.user.findUnique({ where: { emailNormalized: `staff-client-${informationSuffix}@example.test` }, select: { id: true } });
    if (customerUser) createdCustomerUserIds.push(customerUser.id);
    const stored = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: request.quoteRequestId }, include: { conversation: { include: { messages: true } }, statusHistory: true } });
    expect(stored.status).toBe('INFORMACION_REQUERIDA');
    expect(stored.conversation?.messages).toHaveLength(1);
    expect(stored.conversation?.messages[0]).toMatchObject({ body: input.message, visibility: 'CUSTOMER' });
    expect(stored.statusHistory.filter((entry) => entry.toStatus === 'INFORMACION_REQUERIDA')).toHaveLength(1);
    expect(await prisma.auditLog.findFirst({ where: { entityId: request.quoteRequestId, action: 'quote_request.information_requested' } })).not.toBeNull();
    expect(await prisma.outboxEvent.count({ where: { aggregateId: request.quoteRequestId, eventType: { in: ['REQUEST.STATUS_CHANGED'] } } })).toBeGreaterThan(0);

    const retry = await requestInformationQuoteRequest(operator, request.quoteRequestId, input, { prisma, now: new Date('2026-09-13T12:01:00.000Z'), tokenGenerator: () => 'unused-information-token-abcdefghijklmnopqrstuvwxyz' });
    expect(retry).toMatchObject({ quoteRequestId: request.quoteRequestId, status: 'ALREADY_REQUESTED' });
    await expect(requestInformationQuoteRequest(operator, request.quoteRequestId, { ...input, message: 'Otro mensaje con la misma clave de idempotencia.' }, { prisma, now: new Date('2026-09-13T12:02:00.000Z') })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    const afterRetry = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: request.quoteRequestId }, include: { conversation: { include: { messages: true } }, statusHistory: true } });
    expect(afterRetry.conversation?.messages).toHaveLength(1);
    expect(afterRetry.statusHistory.filter((entry) => entry.toStatus === 'INFORMACION_REQUERIDA')).toHaveLength(1);

    const direct = await createRequest(`information-direct-${Date.now()}`);
    await expect(transitionQuoteRequest(operator, direct.quoteRequestId, { toStatus: 'INFORMACION_REQUERIDA' }, { prisma })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('requires an explicit dedupe decision before staff creation', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`create-${Date.now()}`);
    const existing = await createRequest(`create-match-${Date.now()}`);
    const operator = staffActor(actor.id, ['requests.create', 'requests.read']);
    const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: existing.contactId }, select: { email: true, phone: true } });
    const matches = await findStaffQuoteRequestMatches(operator, contact, { prisma });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: existing.contactId, client: { id: existing.clientId } });

    const input = {
      idempotencyKey: `staff-create-${Date.now()}-1234`,
      contact: { displayName: 'Contacto reutilizado', email: contact.email, phone: contact.phone },
      detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Solicitud creada desde staff.' },
    };
    await expect(createStaffQuoteRequest(operator, input, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    const reused = await createStaffQuoteRequest(operator, { ...input, contactMatchId: existing.contactId }, { prisma, now: new Date('2026-09-12T18:00:00.000Z') });
    createdRequestIds.push(reused.quoteRequestId);
    createdClientIds.push(reused.clientId);
    createdContactIds.push(reused.contactId);
    expect(reused).toMatchObject({ clientId: existing.clientId, contactId: existing.contactId });

    const newClient = await createStaffQuoteRequest(operator, { ...input, idempotencyKey: `staff-create-new-${Date.now()}-1234`, confirmNewContact: true }, { prisma });
    createdRequestIds.push(newClient.quoteRequestId);
    createdClientIds.push(newClient.clientId);
    createdContactIds.push(newClient.contactId);
    expect(newClient.clientId).not.toBe(existing.clientId);
    expect(newClient.contactId).not.toBe(existing.contactId);
  });

  it('only marks information reviewed once a real customer reply exists (D2-03)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const actor = await createStaffUser(`mark-reviewed-${Date.now()}`);
    const suffix = `mark-reviewed-${Date.now()}`;
    const request = await createRequest(suffix);
    const operator = staffActor(actor.id, ['requests.read', 'requests.status.update', 'messaging.send']);
    await transitionQuoteRequest(operator, request.quoteRequestId, { toStatus: 'EN_REVISION', reason: 'Revisión inicial' }, { prisma });

    await expect(markInformationReviewedQuoteRequest(operator, request.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

    await requestInformationQuoteRequest(operator, request.quoteRequestId, {
      message: 'Necesitamos confirmar las dimensiones del proyecto.',
      idempotencyKey: `mark-reviewed-info-${Date.now()}`,
    }, { prisma, now: new Date('2026-09-17T12:00:00.000Z') });

    await expect(markInformationReviewedQuoteRequest(operator, request.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(markInformationReviewedQuoteRequest(staffActor(actor.id, []), request.quoteRequestId, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const customerUser = await prisma.user.create({
      data: { email: `mark-reviewed-customer-${suffix}@example.test`, emailNormalized: `mark-reviewed-customer-${suffix}@example.test`, displayName: 'Mark reviewed customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId },
    });
    createdCustomerUserIds.push(customerUser.id);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { quoteRequestId_clientId: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } }, select: { id: true } });
    await prisma.conversationMessage.create({
      data: { conversationId: conversation.id, senderUserId: customerUser.id, visibility: 'CUSTOMER', body: 'Las dimensiones son 10x5m.', createdAt: new Date('2026-09-17T12:05:00.000Z') },
    });

    const result = await markInformationReviewedQuoteRequest(operator, request.quoteRequestId, { prisma });
    expect(result).toMatchObject({ quoteRequestId: request.quoteRequestId, fromStatus: 'INFORMACION_REQUERIDA', toStatus: 'EN_REVISION' });
    expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toMatchObject({ status: 'EN_REVISION' });
    expect(await prisma.auditLog.findFirst({ where: { entityId: request.quoteRequestId, action: 'quote_request.customer_response_reviewed' } })).not.toBeNull();
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: request.quoteRequestId, eventType: 'REQUEST.CUSTOMER_RESPONSE' } })).not.toBeNull();
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdRequestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdRequestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: createdContactIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdCustomerUserIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: actorUserIds } } });
    await prisma.$disconnect();
  });
});
