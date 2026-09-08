import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { seedIdentityCatalog } from '../../prisma/seed';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { readServerEnv } from '@/server/env';
import { createSession } from '@/server/auth/sessions';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { getPrivateStorage } from '@/server/modules/private-files/storage';
import { GET as portalPdfGet } from '@/app/api/portal/quotes/[id]/pdf/route';
import { POST as portalAcceptPost } from '@/app/api/portal/quotes/[id]/accept/route';
import { GET as staffPdfGet, POST as staffPdfPost } from '@/app/api/staff/quotes/versions/[versionId]/pdf/route';
import { GET as staffDocumentGet } from '@/app/api/staff/quotes/versions/[versionId]/document/route';

describe('quote PDF and acceptance API', () => {
  const prisma = getPrisma();
  const userIds: string[] = [];
  let customerAToken = '';
  let customerBToken = '';
  let salesToken = '';
  let requestId = '';
  let requestBId = '';
  let clientAId = '';
  let clientBId = '';
  let contactAId = '';
  let contactBId = '';
  let quoteId = '';
  let versionId = '';
  let priceListId = '';
  let itemId = '';
  let categoryId = '';
  let customerAId = '';
  let customerBId = '';
  let salesId = '';

  const endpoint = (path: string, token?: string, method = 'GET', body?: unknown, origin = readServerEnv().APP_URL) => new NextRequest(`${readServerEnv().APP_URL}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `ocpool_session=${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const versionContext = () => ({ params: Promise.resolve({ versionId }) });
  const quoteContext = () => ({ params: Promise.resolve({ id: quoteId }) });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const [salesRole, customerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
      prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
    ]);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date('2026-09-08T15:00:00.000Z');
    const [requestA, requestB] = await Promise.all([
      createQuoteRequest({ idempotencyKey: `quote-documents-api-a-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Quote PDF API A ${suffix}`, email: `quote-pdf-api-a-${suffix}@example.test` }, detail: { projectType: 'Residencial', location: 'Chihuahua', description: 'Quote PDF API A', consentAt: now } }, { prisma, now }),
      createQuoteRequest({ idempotencyKey: `quote-documents-api-b-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Quote PDF API B ${suffix}`, email: `quote-pdf-api-b-${suffix}@example.test` }, detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Quote PDF API B', consentAt: now } }, { prisma, now }),
    ]);
    requestId = requestA.quoteRequestId;
    requestBId = requestB.quoteRequestId;
    clientAId = requestA.clientId;
    contactAId = requestA.contactId;
    clientBId = requestB.clientId;
    contactBId = requestB.contactId;
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { status: 'EN_ELABORACION' } });

    const [sales, customerA, customerB] = await Promise.all([
      prisma.user.create({ data: { email: `quote-pdf-api-sales-${suffix}@example.test`, emailNormalized: `quote-pdf-api-sales-${suffix}@example.test`, displayName: 'Quote PDF API sales', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } }),
      prisma.user.create({ data: { email: `quote-pdf-api-customer-a-${suffix}@example.test`, emailNormalized: `quote-pdf-api-customer-a-${suffix}@example.test`, displayName: 'Quote PDF API customer A', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientAId, roles: { create: { roleId: customerRole.id } } } }),
      prisma.user.create({ data: { email: `quote-pdf-api-customer-b-${suffix}@example.test`, emailNormalized: `quote-pdf-api-customer-b-${suffix}@example.test`, displayName: 'Quote PDF API customer B', type: 'CUSTOMER', status: 'ACTIVE', clientId: clientBId, roles: { create: { roleId: customerRole.id } } } }),
    ]);
    salesId = sales.id;
    customerAId = customerA.id;
    customerBId = customerB.id;
    userIds.push(sales.id, customerA.id, customerB.id);
    salesToken = `quote-pdf-api-sales-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerAToken = `quote-pdf-api-customer-a-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    customerBToken = `quote-pdf-api-customer-b-${suffix}-abcdefghijklmnopqrstuvwxyz`;
    await Promise.all([
      createSession({ userId: sales.id, ipAddress: null, userAgent: 'quote-pdf-api-test' }, { prisma, tokenGenerator: () => salesToken }),
      createSession({ userId: customerA.id, ipAddress: null, userAgent: 'quote-pdf-api-test' }, { prisma, tokenGenerator: () => customerAToken }),
      createSession({ userId: customerB.id, ipAddress: null, userAgent: 'quote-pdf-api-test' }, { prisma, tokenGenerator: () => customerBToken }),
    ]);

    const codeSuffix = suffix.toUpperCase();
    const category = await prisma.catalogCategory.create({ data: { code: `QPDF-${codeSuffix}`, name: 'Quote PDF API' } });
    categoryId = category.id;
    const item = await prisma.catalogItem.create({ data: { code: `QPDF-ITEM-${codeSuffix}`, name: 'Quote PDF API item', unit: 'pieza', categoryId: category.id } });
    itemId = item.id;
    const priceList = await prisma.priceList.create({ data: { code: `QPDF-PRICE-${codeSuffix}`, name: 'Quote PDF API prices', currencyCode: 'MXN', validFrom: now } });
    priceListId = priceList.id;
    await prisma.priceListItem.create({ data: { priceListId, catalogItemId: itemId, unitPriceMinor: 10000n, validFrom: now } });
    const salesActor: Actor = { userId: sales.id, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['sales']), mfaVerified: true };
    const created = await createQuoteVersion(salesActor, { quoteRequestId: requestId, priceListId, lines: [{ catalogItemId: itemId, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
    quoteId = created.quoteId;
    versionId = created.versionId;
    await transitionQuoteVersion(salesActor, versionId, 'EN_REVISION', { prisma, now });
    await transitionQuoteVersion(salesActor, versionId, 'ENVIADA', { prisma, now });
  });

  it('protects PDF generation and download with role, scope, CSRF and no-store controls', async () => {
    const initialStatus = await staffDocumentGet(endpoint(`/api/staff/quotes/versions/${versionId}/document`, salesToken), versionContext());
    expect(initialStatus.status).toBe(200);
    expect(initialStatus.headers.get('cache-control')).toBe('no-store');
    const initialStatusBody = await initialStatus.json() as Record<string, unknown>;
    expect(initialStatusBody).toMatchObject({ quoteId, quoteVersionId: versionId, document: { status: 'MISSING' }, acceptance: null, actions: { canGenerate: true, canDownload: false } });
    expect(JSON.stringify(initialStatusBody)).not.toContain('storageKey');
    expect(JSON.stringify(initialStatusBody)).not.toContain('sha256');
    expect((await staffDocumentGet(endpoint(`/api/staff/quotes/versions/${versionId}/document`, customerAToken), versionContext())).status).toBe(403);

    expect((await staffPdfGet(endpoint(`/api/staff/quotes/versions/${versionId}`, customerAToken), versionContext())).status).toBe(403);
    const foreignGeneration = await staffPdfPost(endpoint(`/api/staff/quotes/versions/${versionId}`, salesToken, 'POST', {}, 'https://attacker.example'), versionContext());
    expect(foreignGeneration.status).toBe(403);
    const generated = await staffPdfPost(endpoint(`/api/staff/quotes/versions/${versionId}`, salesToken, 'POST', {}), versionContext());
    expect(generated.status).toBe(200);
    expect(generated.headers.get('cache-control')).toBe('no-store');
    const generatedBody = await generated.json() as Record<string, unknown>;
    expect(generatedBody).toMatchObject({ quoteId, quoteVersionId: versionId, status: 'READY', contentType: 'application/pdf' });
    expect(generatedBody).not.toHaveProperty('storageKey');
    expect(generatedBody).not.toHaveProperty('sha256');

    const staffDownload = await staffPdfGet(endpoint(`/api/staff/quotes/versions/${versionId}`, salesToken), versionContext());
    expect(staffDownload.status).toBe(200);
    expect(staffDownload.headers.get('cache-control')).toBe('no-store');
    const staffDownloadBody = await staffDownload.json() as { document: Record<string, unknown>; downloadUrl: string };
    expect(staffDownloadBody.document).toMatchObject({ quoteId, quoteVersionId: versionId, contentType: 'application/pdf' });
    expect(staffDownloadBody.downloadUrl).toEqual(expect.any(String));
    expect(JSON.stringify(staffDownloadBody)).not.toContain('storageKey');
    expect(JSON.stringify(staffDownloadBody)).not.toContain('sha256');

    const readyStatus = await staffDocumentGet(endpoint(`/api/staff/quotes/versions/${versionId}/document`, salesToken), versionContext());
    expect(readyStatus.status).toBe(200);
    const readyStatusBody = await readyStatus.json() as Record<string, unknown>;
    expect(readyStatusBody).toMatchObject({ document: { id: generatedBody.id, status: 'READY', contentType: 'application/pdf' }, actions: { canGenerate: false, canDownload: true }, acceptance: null });
    expect(JSON.stringify(readyStatusBody)).not.toContain('storageKey');
    expect(JSON.stringify(readyStatusBody)).not.toContain('sha256');

    expect((await portalPdfGet(endpoint(`/api/portal/quotes/${quoteId}/pdf`), quoteContext())).status).toBe(401);
    expect((await portalPdfGet(endpoint(`/api/portal/quotes/${quoteId}/pdf`, customerBToken), quoteContext())).status).toBe(404);
    const ownDownload = await portalPdfGet(endpoint(`/api/portal/quotes/${quoteId}/pdf`, customerAToken), quoteContext());
    expect(ownDownload.status).toBe(200);
    expect(ownDownload.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts only through same-origin, enforces strict input and replays safely', async () => {
    const foreignOrigin = await portalAcceptPost(endpoint(`/api/portal/quotes/${quoteId}/accept`, customerAToken, 'POST', { signerName: 'Ana', termsVersion: 'quote-terms-2026-01', idempotencyKey: 'api-accept-origin-01' }, 'https://attacker.example'), quoteContext());
    expect(foreignOrigin.status).toBe(403);
    const extraField = await portalAcceptPost(endpoint(`/api/portal/quotes/${quoteId}/accept`, customerAToken, 'POST', { signerName: 'Ana', termsVersion: 'quote-terms-2026-01', idempotencyKey: 'api-accept-extra-01', quoteId }, readServerEnv().APP_URL), quoteContext());
    expect(extraField.status).toBe(400);
    const accepted = await portalAcceptPost(endpoint(`/api/portal/quotes/${quoteId}/accept`, customerAToken, 'POST', { signerName: '  Ana   López Rivera ', termsVersion: ' quote-terms-2026-01 ', idempotencyKey: 'api-accept-success-01' }), quoteContext());
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('cache-control')).toBe('no-store');
    const acceptedBody = await accepted.json() as Record<string, unknown>;
    expect(acceptedBody).toMatchObject({ quoteId, quoteVersionId: versionId, status: 'ACEPTADA', signerName: 'Ana López Rivera', termsVersion: 'quote-terms-2026-01' });
    expect(acceptedBody).not.toHaveProperty('documentSha256');
    const replay = await portalAcceptPost(endpoint(`/api/portal/quotes/${quoteId}/accept`, customerAToken, 'POST', { signerName: 'Otro nombre', termsVersion: 'quote-terms-2026-01', idempotencyKey: 'api-accept-success-01' }), quoteContext());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ id: acceptedBody.id, status: 'ACEPTADA' });
    const secondKey = await portalAcceptPost(endpoint(`/api/portal/quotes/${quoteId}/accept`, customerAToken, 'POST', { signerName: 'Otro nombre', termsVersion: 'quote-terms-2026-01', idempotencyKey: 'api-accept-second-01' }), quoteContext());
    expect(secondKey.status).toBe(409);
    const acceptedStatus = await staffDocumentGet(endpoint(`/api/staff/quotes/versions/${versionId}/document`, salesToken), versionContext());
    expect(acceptedStatus.status).toBe(200);
    const acceptedStatusBody = await acceptedStatus.json() as Record<string, unknown>;
    expect(acceptedStatusBody).toMatchObject({ document: { status: 'READY' }, actions: { canGenerate: false, canDownload: true }, acceptance: { id: acceptedBody.id, signerName: 'Ana López Rivera', termsVersion: 'quote-terms-2026-01' } });
    expect(JSON.stringify(acceptedStatusBody)).not.toContain('storageKey');
    expect(JSON.stringify(acceptedStatusBody)).not.toContain('sha256');
    expect((await prisma.quoteVersion.findUnique({ where: { id: versionId }, select: { status: true } }))).toMatchObject({ status: 'ACEPTADA' });
    expect((await prisma.quoteRequest.findUnique({ where: { id: requestId }, select: { status: true } }))).toMatchObject({ status: 'ACEPTADA' });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const documents = quoteId ? await prisma.generatedDocument.findMany({ where: { quoteId }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } }) : [];
    const storage = getPrivateStorage();
    for (const document of documents) if (document.storageObject?.storageKey) await storage.delete(document.storageObject.storageKey);
    if (quoteId) await prisma.quoteAcceptance.deleteMany({ where: { quoteId } });
    await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
    await prisma.storageObject.deleteMany({ where: { id: { in: documents.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });
    if (quoteId) await prisma.quote.delete({ where: { id: quoteId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, requestBId, quoteId].filter(Boolean) } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [requestId, requestBId, quoteId, ...documents.map(({ id }) => id)].filter(Boolean) } }, { actorUserId: { in: userIds } }] } });
    if (requestId) await prisma.quoteRequest.delete({ where: { id: requestId } });
    if (requestBId) await prisma.quoteRequest.delete({ where: { id: requestBId } });
    if (contactAId) await prisma.clientContact.delete({ where: { id: contactAId } });
    if (contactBId) await prisma.clientContact.delete({ where: { id: contactBId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (clientAId) await prisma.client.delete({ where: { id: clientAId } });
    if (clientBId) await prisma.client.delete({ where: { id: clientBId } });
    if (priceListId) {
      await prisma.priceListItem.deleteMany({ where: { priceListId } });
      await prisma.priceList.delete({ where: { id: priceListId } });
    }
    if (itemId) await prisma.catalogItem.delete({ where: { id: itemId } });
    if (categoryId) await prisma.catalogCategory.delete({ where: { id: categoryId } });
    void customerAId;
    void customerBId;
    void salesId;
    await prisma.$disconnect();
  });
});
