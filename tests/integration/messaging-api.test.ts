import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { GET as portalMessagesGet, POST as portalMessagesPost } from '@/app/api/portal/requests/[id]/messages/route';
import { GET as staffMessagesGet, POST as staffMessagesPost } from '@/app/api/staff/quote-requests/[id]/messages/route';
import { POST as staffNotesPost } from '@/app/api/staff/quote-requests/[id]/notes/route';
import { POST as conversationStatusPost } from '@/app/api/staff/quote-requests/[id]/conversation-status/route';
import { GET as capabilitiesGet } from '@/app/api/staff/capabilities/route';

describe('private messaging API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  let customerAToken = '';
  let customerBToken = '';
  let managerToken = '';
  let limitedStaffToken = '';
  let requestAId = '';
  let requestBId = '';
  let customerAId = '';
  let clientAId = '';
  let clientBId = '';
  let contactAId = '';
  let contactBId = '';
  let limitedRoleId = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `ocpool_session=${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const readerPermissions = await prisma.permission.findMany({ where: { key: { in: ['requests.read', 'messaging.read', 'messaging.send'] } }, select: { id: true } });
    const limitedRole = await prisma.role.create({
      data: {
        key: `messaging-reader-${suffix}`,
        name: 'Messaging API reader',
        description: 'Temporary API integration role',
        systemManaged: false,
        permissions: { create: readerPermissions.map(({ id: permissionId }) => ({ permissionId })) },
      },
    });
    limitedRoleId = limitedRole.id;
    const now = new Date('2026-09-08T10:00:00.000Z');
    const [requestA, requestB] = await Promise.all([
      createQuoteRequest({ idempotencyKey: `messaging-api-a-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Messaging API A ${suffix}`, email: `messaging-api-a-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Messaging API A', consentAt: now } }, { prisma, now }),
      createQuoteRequest({ idempotencyKey: `messaging-api-b-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Messaging API B ${suffix}`, email: `messaging-api-b-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Messaging API B', consentAt: now } }, { prisma, now }),
    ]);
    requestAId = requestA.quoteRequestId;
    requestBId = requestB.quoteRequestId;
    clientAId = requestA.clientId;
    clientBId = requestB.clientId;
    contactAId = requestA.contactId;
    contactBId = requestB.contactId;
    const [customerA, customerB, manager, limitedStaff] = await Promise.all([
      prisma.user.create({ data: { email: `messaging-api-customer-a-${suffix}@example.test`, emailNormalized: `messaging-api-customer-a-${suffix}@example.test`, displayName: 'Messaging API customer A', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `messaging-api-customer-b-${suffix}@example.test`, emailNormalized: `messaging-api-customer-b-${suffix}@example.test`, displayName: 'Messaging API customer B', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientBId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `messaging-api-manager-${suffix}@example.test`, emailNormalized: `messaging-api-manager-${suffix}@example.test`, displayName: 'Messaging API manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `messaging-api-reader-${suffix}@example.test`, emailNormalized: `messaging-api-reader-${suffix}@example.test`, displayName: 'Messaging API reader', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: limitedRole.id } } } }),
    ]);
    customerAId = customerA.id;
    userIds.push(customerA.id, customerB.id, manager.id, limitedStaff.id);
    customerAToken = `messaging-api-customer-a-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerBToken = `messaging-api-customer-b-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `messaging-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    limitedStaffToken = `messaging-api-reader-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: customerA.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerAToken }),
      createSession({ userId: customerB.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerBToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: limitedStaff.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => limitedStaffToken }),
    ]);
  });

  it('exposes messaging capabilities without permission details', async () => {
    const manager = await capabilitiesGet(endpoint('/api/staff/capabilities', managerToken));
    expect(manager.status).toBe(200);
    await expect(manager.json()).resolves.toMatchObject({
      messagingRead: true,
      messagingSend: true,
      messagingInternalNotesRead: true,
      messagingInternalNotesWrite: true,
      messagingManage: true,
    });

    const limited = await capabilitiesGet(endpoint('/api/staff/capabilities', limitedStaffToken));
    expect(limited.status).toBe(200);
    const limitedBody = await limited.json() as Record<string, unknown>;
    expect(limitedBody).toMatchObject({
      messagingRead: true,
      messagingSend: true,
      messagingInternalNotesRead: false,
      messagingInternalNotesWrite: false,
      messagingManage: false,
    });
    expect(Object.keys(limitedBody)).not.toContain('permissions');
  });

  it('protects access, scope and safe cache headers', async () => {
    expect((await portalMessagesGet(endpoint(`/api/portal/requests/${requestAId}/messages`), context(requestAId))).status).toBe(401);
    expect((await portalMessagesGet(endpoint(`/api/portal/requests/${requestAId}/messages`, managerToken), context(requestAId))).status).toBe(403);

    const own = await portalMessagesGet(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken), context(requestAId));
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('no-store');
    await expect(own.json()).resolves.toMatchObject({ conversation: null, items: [], nextCursor: null });
    expect((await portalMessagesGet(endpoint(`/api/portal/requests/${requestBId}/messages`, customerAToken), context(requestBId))).status).toBe(404);
    expect((await portalMessagesGet(endpoint('/api/portal/requests/not-a-uuid/messages', customerAToken), context('not-a-uuid'))).status).toBe(404);
  });

  it('publishes customer and staff contracts without leaking internal notes', async () => {
    const foreignOrigin = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken, 'POST', { body: 'No cross origin', idempotencyKey: 'api-origin-01' }, 'https://attacker.example'), context(requestAId));
    expect(foreignOrigin.status).toBe(403);

    const customerMessage = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken, 'POST', { body: 'Mensaje desde portal', idempotencyKey: 'api-customer-01' }), context(requestAId));
    expect(customerMessage.status).toBe(201);
    expect(customerMessage.headers.get('cache-control')).toBe('no-store');
    const customerBody = await customerMessage.json() as Record<string, unknown>;
    expect(customerBody).toMatchObject({ visibility: 'CUSTOMER', body: 'Mensaje desde portal' });
    expect(JSON.stringify(customerBody)).not.toContain('clientId');
    expect(JSON.stringify(customerBody)).not.toContain('senderUserId');

    const staffMessage = await staffMessagesPost(endpoint(`/api/staff/quote-requests/${requestAId}/messages`, managerToken, 'POST', { body: 'Respuesta del equipo', idempotencyKey: 'api-staff-01' }), context(requestAId));
    expect(staffMessage.status).toBe(201);
    const staffMessageBody = await staffMessage.json() as Record<string, unknown>;
    expect(JSON.stringify(staffMessageBody)).not.toContain('idempotencyKey');
    const note = await staffNotesPost(endpoint(`/api/staff/quote-requests/${requestAId}/notes`, managerToken, 'POST', { body: 'Nota operativa privada', idempotencyKey: 'api-note-01' }), context(requestAId));
    expect(note.status).toBe(201);

    const portal = await portalMessagesGet(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken), context(requestAId));
    const portalBody = await portal.json() as Record<string, unknown>;
    expect(JSON.stringify(portalBody)).toContain('Respuesta del equipo');
    expect(JSON.stringify(portalBody)).not.toContain('Nota operativa privada');
    expect(JSON.stringify(portalBody)).not.toContain('clientId');
    expect(JSON.stringify(portalBody)).not.toContain('senderUserId');

    const staff = await staffMessagesGet(endpoint(`/api/staff/quote-requests/${requestAId}/messages`, managerToken), context(requestAId));
    expect(staff.status).toBe(200);
    expect(staff.headers.get('cache-control')).toBe('no-store');
    await expect(staff.json()).resolves.toMatchObject({ items: expect.arrayContaining([
      expect.objectContaining({ visibility: 'CUSTOMER', body: 'Mensaje desde portal' }),
      expect.objectContaining({ visibility: 'CUSTOMER', body: 'Respuesta del equipo' }),
      expect.objectContaining({ visibility: 'INTERNAL', body: 'Nota operativa privada' }),
    ]) });
    const limitedStaff = await staffMessagesGet(endpoint(`/api/staff/quote-requests/${requestAId}/messages`, limitedStaffToken), context(requestAId));
    expect(limitedStaff.status).toBe(200);
    const limitedStaffBody = await limitedStaff.json() as Record<string, unknown>;
    expect(JSON.stringify(limitedStaffBody)).not.toContain('Nota operativa privada');
    const forbiddenNote = await staffNotesPost(endpoint(`/api/staff/quote-requests/${requestAId}/notes`, limitedStaffToken, 'POST', { body: 'Sin permiso', idempotencyKey: 'api-limited-note-01' }), context(requestAId));
    expect(forbiddenNote.status).toBe(403);
  });

  it('rejects malformed mutations, unknown fields and closed conversations', async () => {
    const extraField = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken, 'POST', { body: 'No', idempotencyKey: 'api-extra-01', visibility: 'INTERNAL' }), context(requestAId));
    expect(extraField.status).toBe(400);
    const invalidBody = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken, 'POST', { body: '', idempotencyKey: 'api-invalid-01' }), context(requestAId));
    expect(invalidBody.status).toBe(400);
    const invalidQuery = await staffMessagesGet(endpoint(`/api/staff/quote-requests/${requestAId}/messages?limit=101`, managerToken), context(requestAId));
    expect(invalidQuery.status).toBe(400);
    const foreignCustomer = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerBToken, 'POST', { body: 'Cruce', idempotencyKey: 'api-cross-01' }), context(requestAId));
    expect(foreignCustomer.status).toBe(404);

    const limitedClose = await conversationStatusPost(endpoint(`/api/staff/quote-requests/${requestAId}/conversation-status`, limitedStaffToken, 'POST', { status: 'CLOSED' }), context(requestAId));
    expect(limitedClose.status).toBe(403);

    const close = await conversationStatusPost(endpoint(`/api/staff/quote-requests/${requestAId}/conversation-status`, managerToken, 'POST', { status: 'CLOSED' }), context(requestAId));
    expect(close.status).toBe(200);
    const closedSend = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken, 'POST', { body: 'Bloqueado', idempotencyKey: 'api-closed-01' }), context(requestAId));
    expect(closedSend.status).toBe(409);
    const limitedReopen = await conversationStatusPost(endpoint(`/api/staff/quote-requests/${requestAId}/conversation-status`, limitedStaffToken, 'POST', { status: 'OPEN' }), context(requestAId));
    expect(limitedReopen.status).toBe(403);
    const reopen = await conversationStatusPost(endpoint(`/api/staff/quote-requests/${requestAId}/conversation-status`, managerToken, 'POST', { status: 'OPEN' }), context(requestAId));
    expect(reopen.status).toBe(200);

    const rateLimitKeyHash = fingerprintToken(`${customerAId}:${requestAId}`);
    await prisma.authRateLimit.upsert({
      where: { scope_keyHash: { scope: 'messaging-send', keyHash: rateLimitKeyHash } },
      update: { attempts: 20, blockedUntil: new Date(Date.now() + 60_000), updatedAt: new Date() },
      create: { scope: 'messaging-send', keyHash: rateLimitKeyHash, windowStarted: new Date(), attempts: 20, blockedUntil: new Date(Date.now() + 60_000) },
    });
    const rateLimited = await portalMessagesPost(endpoint(`/api/portal/requests/${requestAId}/messages`, customerAToken, 'POST', { body: 'Rate limited', idempotencyKey: 'api-rate-limit-01' }), context(requestAId));
    expect(rateLimited.status).toBe(429);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: { in: [requestAId, requestBId] } }, select: { id: true } });
    const conversationIds = conversations.map(({ id }) => id);
    const messageIds = (await prisma.conversationMessage.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } })).map(({ id }) => id);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestAId, requestBId, ...conversationIds] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [requestAId, requestBId, ...conversationIds, ...messageIds] } }, { actorUserId: { in: userIds } }] } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: [requestAId, requestBId] } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: [contactAId, contactBId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.authRateLimit.deleteMany({ where: { scope: 'messaging-send', keyHash: fingerprintToken(`${customerAId}:${requestAId}`) } });
    await prisma.role.delete({ where: { id: limitedRoleId } });
    await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } });
  });
});
