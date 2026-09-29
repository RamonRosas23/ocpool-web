import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('inbox rules for projects, reassigned work and prices', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let ownerId = '';
  let managerId = '';
  let otherManagerId = '';
  let heirId = '';
  let pricingId = '';
  let customerId = '';
  let quoteId = '';
  let storageObjectId = '';
  let projectId = '';
  let priceListId = '';
  let catalogItemId = '';

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function user(name: string, type: 'EMPLOYEE' | 'CUSTOMER', roleId?: string): Promise<string> {
    const email = `inbox-ptp-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type, status: 'ACTIVE', ...(type === 'CUSTOMER' ? { clientId } : {}), ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(created.id);
    return created.id;
  }

  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
  const signal = (eventType: string, actor: { userId: string; type: 'EMPLOYEE' } | null, payload: Record<string, unknown>) => prisma.$transaction((tx) => notifyInbox(tx, { actor, eventType, aggregateType: 'TEST', aggregateId: null, payload }, { now }));

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-ptp-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Cliente ${suffix}`, email: `inbox-ptp-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Mazatlán', description: 'Fixture de proyectos', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    const managerRole = await role('inbox-ptp-manager', ['requests.read.global']);
    ownerId = await user('owner', 'EMPLOYEE');
    managerId = await user('manager', 'EMPLOYEE', managerRole);
    otherManagerId = await user('othermanager', 'EMPLOYEE', managerRole);
    heirId = await user('heir', 'EMPLOYEE');
    pricingId = await user('pricing', 'EMPLOYEE', await role('inbox-ptp-pricing', ['prices.manage']));
    customerId = await user('customer', 'CUSTOMER');
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: ownerId } });
    const quote = await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } });
    quoteId = quote.id;
    const version = await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 1, status: 'ACEPTADA', currencyCode: 'MXN', subtotalMinor: 100_000n, taxableTotalMinor: 100_000n, totalMinor: 100_000n, createdById: ownerId } });
    const storage = await prisma.storageObject.create({ data: { storageKey: `private-files/inbox-ptp/${suffix}.pdf`, contentType: 'application/pdf', byteSize: 10n, sha256: 'e'.repeat(64), scanStatus: 'PASSED', verifiedAt: now } });
    storageObjectId = storage.id;
    const document = await prisma.generatedDocument.create({ data: { quoteId, quoteVersionId: version.id, storageObjectId: storage.id, templateVersion: 'quote-pdf-test', status: 'READY', byteSize: 10n, sha256: 'e'.repeat(64), generatedAt: now, readyAt: now } });
    const acceptance = await prisma.quoteAcceptance.create({ data: { quoteId, quoteVersionId: version.id, generatedDocumentId: document.id, acceptedById: customerId, documentSha256: 'e'.repeat(64), signerName: 'Cliente', termsVersion: 'terms-test', idempotencyKeyHash: 'f'.repeat(64) } });
    projectId = (await prisma.project.create({ data: { folio: `OCP-${suffix}`, quoteAcceptanceId: acceptance.id, quoteRequestId: requestId, clientId, contactId, ownerId, createdById: managerId } })).id;
    priceListId = (await prisma.priceList.create({ data: { code: `INBOX-PTP-${suffix}`, name: `Lista ${suffix}`, currencyCode: 'MXN' } })).id;
    catalogItemId = (await prisma.catalogItem.create({ data: { code: `INBOX-PTP-ITEM-${suffix}`, name: `Filtro ${suffix}`, unit: 'pieza' } })).id;
    const draft = await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 2, status: 'BORRADOR', currencyCode: 'MXN', createdById: ownerId, sourcePriceListId: priceListId } });
    await prisma.quoteLineSnapshot.create({ data: { quoteVersionId: draft.id, position: 0, catalogItemId, name: `Filtro ${suffix}`, unit: 'pieza', quantityMilliunits: 1000n, currencyCode: 'MXN', unitPriceMinor: 0n, pricePending: true } });
  });

  // Tolera una preparación a medias: cada id vacío se salta, para no dejar datos en la base compartida.
  afterAll(async () => {
    // El aviso "necesita precio" agrupa expedientes (sin quoteRequestId): no cae en cascada con la solicitud.
    if (priceListId) await prisma.inboxNotification.deleteMany({ where: { groupKey: { startsWith: `price:${priceListId}:` } } });
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
    if (quoteId) {
      await prisma.quoteAcceptance.deleteMany({ where: { quoteId } });
      await prisma.generatedDocument.deleteMany({ where: { quoteId } });
      await prisma.quote.deleteMany({ where: { id: quoteId } });
    }
    if (storageObjectId) await prisma.storageObject.deleteMany({ where: { id: storageObjectId } });
    if (catalogItemId) await prisma.catalogItem.deleteMany({ where: { id: catalogItemId } });
    if (priceListId) await prisma.priceList.deleteMany({ where: { id: priceListId } });
    if (requestId) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      await prisma.quoteRequest.delete({ where: { id: requestId } });
    }
    if (contactId) await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('announces a manually created project to its owner, other managers and the customer', async () => {
    await signal('PROJECT.CREATED', { userId: managerId, type: 'EMPLOYEE' }, { projectId, folio: `OCP-${suffix}`, quoteRequestId: requestId, source: 'staff', ownerId });
    expect((await inboxOf(ownerId)).map((row) => row.kind)).toEqual(['project.assigned']);
    expect((await inboxOf(otherManagerId)).find((row) => row.kind === 'project.created')).toMatchObject({ title: `manager ${suffix} creó el proyecto OCP-${suffix}` });
    expect(await inboxOf(managerId)).toHaveLength(0);
    expect((await inboxOf(customerId)).find((row) => row.kind === 'project.started')).toMatchObject({ title: `Tu proyecto OCP-${suffix} arrancó`, body: `Tu responsable es owner ${suffix}` });
  });

  it('does not repeat the acceptance for the owner when the customer accepted', async () => {
    await prisma.inboxNotification.deleteMany({ where: { recipientId: { in: [ownerId, otherManagerId, customerId] } } });
    await signal('PROJECT.CREATED', null, { projectId, folio: `OCP-${suffix}`, quoteRequestId: requestId, source: 'customer_acceptance', ownerId });
    expect(await inboxOf(ownerId)).toHaveLength(0);
    expect(await inboxOf(otherManagerId)).toHaveLength(0);
    expect((await inboxOf(customerId)).map((row) => row.kind)).toEqual(['project.started']);
  });

  it('tells a new project owner and whoever inherits a suspended colleague\'s work', async () => {
    await signal('PROJECT.OWNER_CHANGED', { userId: managerId, type: 'EMPLOYEE' }, { projectId, ownerId: heirId });
    await signal('TEAM.WORK_REASSIGNED', { userId: managerId, type: 'EMPLOYEE' }, { heirId, fromName: `owner ${suffix}`, requestsCount: 3, projectsCount: 1 });
    const kinds = await inboxOf(heirId);
    expect(kinds.find((row) => row.kind === 'project.assigned')).toMatchObject({ title: `Te asignaron el proyecto OCP-${suffix}` });
    expect(kinds.find((row) => row.kind === 'team.work_reassigned')).toMatchObject({ quoteRequestId: null, title: `Recibiste 3 expedientes y un proyecto de owner ${suffix}` });
  });

  it('closes the pending-price request and tells the draft author it can continue', async () => {
    const draft = await prisma.quoteVersion.findFirstOrThrow({ where: { quoteId, versionNumber: 2 } });
    const folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })).folio;
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: { userId: ownerId, type: 'EMPLOYEE' }, eventType: 'QUOTE.VERSION_UPDATED', aggregateType: 'QUOTE', aggregateId: quoteId, payload: { quoteId, quoteVersionId: draft.id, quoteRequestId: requestId, folio, versionNumber: 2 } }, { now }));
    await signal('PRICES.PENDING_RESOLVED', { userId: pricingId, type: 'EMPLOYEE' }, { priceListId, catalogItemId });
    expect((await inboxOf(pricingId)).find((row) => row.kind === 'price.pending')).toMatchObject({ resolvedNote: 'Le asignaste precio' });
    expect((await inboxOf(ownerId)).find((row) => row.kind === 'price.assigned')).toMatchObject({ title: `Filtro ${suffix} ya tiene precio en Lista ${suffix}`, body: `Tu propuesta ${folio} puede continuar` });
  });
});
