import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { readServerEnv } from '@/server/env';
import { getPrisma } from '@/server/db/client';
import { fingerprintToken } from '@/server/auth/crypto';
import { createSession } from '@/server/auth/sessions';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { GET as portalFilesGet, POST as portalFilesPost } from '@/app/api/portal/requests/[id]/files/route';
import { DELETE as portalFileDelete } from '@/app/api/portal/requests/[id]/files/[fileId]/route';
import { POST as portalFileComplete } from '@/app/api/portal/requests/[id]/files/[fileId]/complete/route';
import { GET as portalFileDownload } from '@/app/api/portal/requests/[id]/files/[fileId]/download/route';
import { GET as staffFilesGet, POST as staffFilesPost } from '@/app/api/staff/quote-requests/[id]/files/route';
import { POST as staffFileComplete } from '@/app/api/staff/quote-requests/[id]/files/[fileId]/complete/route';
import { GET as capabilitiesGet } from '@/app/api/staff/capabilities/route';

describe('private files API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  let customerAToken = '';
  let customerBToken = '';
  let managerToken = '';
  let limitedStaffToken = '';
  let requestAId = '';
  let requestBId = '';
  let customerAUserId = '';
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
  const fileContext = (id: string, fileId: string) => ({ params: Promise.resolve({ id, fileId }) });
  const reserveBody = (key: string, visibility: 'CUSTOMER' | 'INTERNAL' = 'CUSTOMER') => ({ originalFileName: visibility === 'INTERNAL' ? 'interno.pdf' : 'planos.pdf', contentType: 'application/pdf', byteSize: 5, category: visibility === 'INTERNAL' ? 'INTERNAL_DOCUMENT' : 'TECHNICAL_DOCUMENT', visibility, idempotencyKey: key });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const readerPermissions = await prisma.permission.findMany({ where: { key: { in: ['requests.read', 'files.read', 'files.download'] } }, select: { id: true } });
    const limitedRole = await prisma.role.create({ data: { key: `files-reader-${suffix}`, name: 'Files API reader', description: 'Temporary files integration role', systemManaged: false, permissions: { create: readerPermissions.map(({ id: permissionId }) => ({ permissionId })) } } });
    limitedRoleId = limitedRole.id;
    const now = new Date('2026-09-08T10:30:00.000Z');
    const [requestA, requestB] = await Promise.all([
      createQuoteRequest({ idempotencyKey: `files-api-a-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Files API A ${suffix}`, email: `files-api-a-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Files API A', consentAt: now } }, { prisma, now }),
      createQuoteRequest({ idempotencyKey: `files-api-b-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Files API B ${suffix}`, email: `files-api-b-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Mazatlán', description: 'Files API B', consentAt: now } }, { prisma, now }),
    ]);
    requestAId = requestA.quoteRequestId;
    requestBId = requestB.quoteRequestId;
    clientAId = requestA.clientId;
    clientBId = requestB.clientId;
    contactAId = requestA.contactId;
    contactBId = requestB.contactId;
    const [customerA, customerB, manager, limitedStaff] = await Promise.all([
      prisma.user.create({ data: { email: `files-api-customer-a-${suffix}@example.test`, emailNormalized: `files-api-customer-a-${suffix}@example.test`, displayName: 'Files API customer A', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `files-api-customer-b-${suffix}@example.test`, emailNormalized: `files-api-customer-b-${suffix}@example.test`, displayName: 'Files API customer B', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientBId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `files-api-manager-${suffix}@example.test`, emailNormalized: `files-api-manager-${suffix}@example.test`, displayName: 'Files API manager', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } }),
      prisma.user.create({ data: { email: `files-api-reader-${suffix}@example.test`, emailNormalized: `files-api-reader-${suffix}@example.test`, displayName: 'Files API reader', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: limitedRole.id } } } }),
    ]);
    customerAUserId = customerA.id;
    userIds.push(customerA.id, customerB.id, manager.id, limitedStaff.id);
    customerAToken = `files-api-customer-a-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerBToken = `files-api-customer-b-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    managerToken = `files-api-manager-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    limitedStaffToken = `files-api-reader-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: customerA.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerAToken }),
      createSession({ userId: customerB.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => customerBToken }),
      createSession({ userId: manager.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => managerToken }),
      createSession({ userId: limitedStaff.id, ipAddress: null, userAgent: 'integration-test' }, { prisma, tokenGenerator: () => limitedStaffToken }),
    ]);
  });

  it('exposes file capabilities without raw permission details', async () => {
    const manager = await capabilitiesGet(endpoint('/api/staff/capabilities', managerToken));
    expect(manager.status).toBe(200);
    await expect(manager.json()).resolves.toMatchObject({ filesRead: true, filesUpload: true, filesDownload: true, filesInternalRead: true, filesManage: true });
    const limited = await capabilitiesGet(endpoint('/api/staff/capabilities', limitedStaffToken));
    const limitedBody = await limited.json() as Record<string, unknown>;
    expect(limitedBody).toMatchObject({ filesRead: true, filesUpload: false, filesDownload: true, filesInternalRead: false, filesManage: false });
    expect(Object.keys(limitedBody)).not.toContain('permissions');
  });

  it('protects file scope, same-origin, strict schemas and safe cache headers', async () => {
    expect((await portalFilesGet(endpoint(`/api/portal/requests/${requestAId}/files`), context(requestAId))).status).toBe(401);
    expect((await portalFilesGet(endpoint(`/api/portal/requests/${requestAId}/files`, managerToken), context(requestAId))).status).toBe(403);
    expect((await portalFilesGet(endpoint(`/api/portal/requests/${requestBId}/files`, customerAToken), context(requestBId))).status).toBe(404);
    const foreignMutation = await portalFilesPost(endpoint(`/api/portal/requests/${requestAId}/files`, customerAToken, 'POST', reserveBody('files-foreign-01'), 'https://attacker.example'), context(requestAId));
    expect(foreignMutation.status).toBe(403);
    const extraField = await portalFilesPost(endpoint(`/api/portal/requests/${requestAId}/files`, customerAToken, 'POST', { ...reserveBody('files-extra-01'), clientId: clientAId }), context(requestAId));
    expect(extraField.status).toBe(400);
  });

  it('uploads a customer file, completes it, hides internal storage fields and blocks cross-client download', async () => {
    const reserved = await portalFilesPost(endpoint(`/api/portal/requests/${requestAId}/files`, customerAToken, 'POST', reserveBody('files-customer-01')), context(requestAId));
    expect(reserved.status).toBe(201);
    expect(reserved.headers.get('cache-control')).toBe('no-store');
    const reservedBody = await reserved.json() as { file: { id: string; status: string }; uploadUrl: string };
    expect(reservedBody.file.status).toBe('PENDING_SCAN');
    expect(reservedBody).not.toHaveProperty('storageKey');
    const upload = await fetch(reservedBody.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: '%PDF-' });
    expect(upload.ok).toBe(true);
    const complete = await portalFileComplete(endpoint(`/api/portal/requests/${requestAId}/files/${reservedBody.file.id}/complete`, customerAToken, 'POST', {}), fileContext(requestAId, reservedBody.file.id));
    expect(complete.status).toBe(200);
    const list = await portalFilesGet(endpoint(`/api/portal/requests/${requestAId}/files`, customerAToken), context(requestAId));
    const listBody = await list.json() as { items: Array<Record<string, unknown>> };
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(listBody.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: reservedBody.file.id, status: 'AVAILABLE', category: 'TECHNICAL_DOCUMENT' })]));
    expect(JSON.stringify(listBody)).not.toContain('storageKey');
    expect(JSON.stringify(listBody)).not.toContain('clientId');
    expect((await portalFileDownload(endpoint(`/api/portal/requests/${requestBId}/files/${reservedBody.file.id}/download`, customerAToken), fileContext(requestBId, reservedBody.file.id))).status).toBe(404);
    const managerList = await staffFilesGet(endpoint(`/api/staff/quote-requests/${requestAId}/files`, managerToken), context(requestAId));
    expect(managerList.status).toBe(200);
    const managerBody = await managerList.json() as { items: Array<Record<string, unknown>> };
    expect(managerBody.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: reservedBody.file.id, visibility: 'CUSTOMER' })]));
    const deleted = await portalFileDelete(endpoint(`/api/portal/requests/${requestAId}/files/${reservedBody.file.id}`, customerAToken, 'DELETE'), fileContext(requestAId, reservedBody.file.id));
    expect(deleted.status).toBe(200);
  });

  it('keeps internal files out of customer API and enforces file reserve rate limiting', async () => {
    const reserved = await staffFilesPost(endpoint(`/api/staff/quote-requests/${requestAId}/files`, managerToken, 'POST', reserveBody('files-internal-01', 'INTERNAL')), context(requestAId));
    expect(reserved.status).toBe(201);
    const reservedBody = await reserved.json() as { file: { id: string }; uploadUrl: string };
    const upload = await fetch(reservedBody.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: '%PDF-' });
    expect(upload.ok).toBe(true);
    expect((await staffFileComplete(endpoint(`/api/staff/quote-requests/${requestAId}/files/${reservedBody.file.id}/complete`, managerToken, 'POST', {}), fileContext(requestAId, reservedBody.file.id))).status).toBe(200);
    const customerList = await portalFilesGet(endpoint(`/api/portal/requests/${requestAId}/files`, customerAToken), context(requestAId));
    expect(JSON.stringify(await customerList.json())).not.toContain('interno.pdf');
    const limitedList = await staffFilesGet(endpoint(`/api/staff/quote-requests/${requestAId}/files`, limitedStaffToken), context(requestAId));
    expect(JSON.stringify(await limitedList.json())).not.toContain('interno.pdf');
    const rateLimitHash = fingerprintToken(`${customerAUserId}:${requestAId}`);
    await prisma.authRateLimit.upsert({ where: { scope_keyHash: { scope: 'private-file-reserve', keyHash: rateLimitHash } }, update: { attempts: 10, blockedUntil: new Date(Date.now() + 60_000), updatedAt: new Date() }, create: { scope: 'private-file-reserve', keyHash: rateLimitHash, windowStarted: new Date(), attempts: 10, blockedUntil: new Date(Date.now() + 60_000) } });
    expect((await portalFilesPost(endpoint(`/api/portal/requests/${requestAId}/files`, customerAToken, 'POST', reserveBody('files-rate-01')), context(requestAId))).status).toBe(429);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const attachments = await prisma.fileAttachment.findMany({ where: { quoteRequestId: { in: [requestAId, requestBId] } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
    const storageObjectIds = attachments.map(({ storageObjectId }) => storageObjectId);
    const attachmentIds = attachments.map(({ id }) => id);
    const storage = getPrivateStorage();
    for (const { storageObject } of attachments) await storage.delete(storageObject.storageKey);
    await prisma.fileAttachment.deleteMany({ where: { id: { in: attachmentIds } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: storageObjectIds } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestAId, requestBId, ...attachmentIds] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [requestAId, requestBId, ...attachmentIds] } }, { actorUserId: { in: userIds } }] } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: [requestAId, requestBId] } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: [contactAId, contactBId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.authRateLimit.deleteMany({ where: { scope: 'private-file-reserve', keyHash: fingerprintToken(`${customerAUserId}:${requestAId}`) } });
    await prisma.role.delete({ where: { id: limitedRoleId } });
    await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } });
  });
});
