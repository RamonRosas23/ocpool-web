import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { getPrisma } from '@/server/db/client';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import { applyInboxEffects } from '@/server/modules/inbox/record';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('inbox rules for quotes and approvals', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const roleIds: string[] = [];
  const userIds: string[] = [];
  let requestId = '';
  let folio = '';
  let clientId = '';
  let contactId = '';
  let authorId = '';
  let approverId = '';
  let managerId = '';
  let pricingId = '';
  let customerId = '';
  let quoteId = '';
  let sentVersionId = '';
  let draftVersionId = '';
  let priceListId = '';
  let catalogItemId = '';

  async function role(key: string, permissions: string[]): Promise<string> {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    const created = await prisma.role.create({ data: { key: `${key}-${suffix}`, name: key, description: 'Rol temporal de prueba', systemManaged: false, permissions: { create: rows.map(({ id }) => ({ permissionId: id })) } } });
    roleIds.push(created.id);
    return created.id;
  }

  async function user(name: string, type: 'EMPLOYEE' | 'CUSTOMER', roleId?: string): Promise<string> {
    const email = `inbox-quote-${name}-${suffix}@example.test`;
    const created = await prisma.user.create({ data: { email, emailNormalized: email, displayName: `${name} ${suffix}`, type, status: 'ACTIVE', ...(type === 'CUSTOMER' ? { clientId } : {}), ...(roleId ? { roles: { create: { roleId } } } : {}) } });
    userIds.push(created.id);
    return created.id;
  }

  const approval = (status: 'REQUESTED' | 'SUPERSEDED' | 'APPROVED', digestChar: string) => prisma.quoteApproval.create({ data: { quoteId, quoteVersionId: sentVersionId, type: 'DISCOUNT', status, policyVersion: 'policy-test', digest: digestChar.repeat(64), requestedById: authorId } });
  const event = (eventType: string, actor: { userId: string; type: 'EMPLOYEE' | 'CUSTOMER' } | null, payload: Record<string, unknown>) => prisma.$transaction((tx) => notifyInbox(tx, { actor, eventType, aggregateType: 'QUOTE', aggregateId: quoteId, payload: { quoteId, quoteRequestId: requestId, folio, ...payload } }, { now }));
  const inboxOf = (recipientId: string) => prisma.inboxNotification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const request = await createQuoteRequest({ idempotencyKey: `inbox-quotes-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: `Juan ${suffix}`, email: `inbox-quote-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca residencial', location: 'Culiacán', description: 'Fixture de reglas de cotizaciones', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    folio = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId }, select: { folio: true } })).folio;
    authorId = await user('author', 'EMPLOYEE', await role('inbox-quote-sales', ['quotes.create']));
    approverId = await user('approver', 'EMPLOYEE', await role('inbox-quote-approver', ['quotes.approve_discount']));
    managerId = await user('manager', 'EMPLOYEE', await role('inbox-quote-manager', ['requests.read.global']));
    pricingId = await user('pricing', 'EMPLOYEE', await role('inbox-quote-pricing', ['prices.manage']));
    customerId = await user('customer', 'CUSTOMER');
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    await prisma.quoteRequest.update({ where: { id: requestId }, data: { currentAssigneeId: authorId } });
    const quote = await prisma.quote.create({ data: { quoteRequestId: requestId, clientId } });
    quoteId = quote.id;
    sentVersionId = (await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 1, status: 'ENVIADA', currencyCode: 'MXN', subtotalMinor: 48_500_000n, taxableTotalMinor: 48_500_000n, totalMinor: 48_500_000n, createdById: authorId } })).id;
    priceListId = (await prisma.priceList.create({ data: { code: `INBOX-${suffix}`, name: `Lista ${suffix}`, currencyCode: 'MXN' } })).id;
    catalogItemId = (await prisma.catalogItem.create({ data: { code: `INBOX-ITEM-${suffix}`, name: `Bomba ${suffix}`, unit: 'pieza' } })).id;
    draftVersionId = (await prisma.quoteVersion.create({ data: { quoteId, versionNumber: 2, status: 'BORRADOR', currencyCode: 'MXN', createdById: authorId, sourcePriceListId: priceListId } })).id;
    await prisma.quoteLineSnapshot.create({ data: { quoteVersionId: draftVersionId, position: 0, catalogItemId, catalogItemCode: `INBOX-ITEM-${suffix}`, name: `Bomba ${suffix}`, unit: 'pieza', quantityMilliunits: 1000n, currencyCode: 'MXN', unitPriceMinor: 0n, pricePending: true } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.catalogItem.deleteMany({ where: { id: catalogItemId } });
    await prisma.priceList.deleteMany({ where: { id: priceListId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
    await prisma.quoteRequest.delete({ where: { id: requestId } });
    await prisma.clientContact.delete({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  it('tells the customer a proposal is ready and closes pending change requests', async () => {
    await prisma.$transaction((tx) => applyInboxEffects(tx, { intents: [{ recipientId: authorId, kind: 'quote.changes_requested', priority: 'URGENT', quoteRequestId: requestId, actorId: customerId, groupKey: `changes:${requestId}`, actionPath: '/staff/requests', actionRequired: true, data: { versionNumber: 1 } }], resolutions: [] }, now));
    await event('QUOTE.PUBLISHED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, fromStatus: 'EN_REVISION', toStatus: 'ENVIADA' });
    expect(await inboxOf(customerId)).toEqual([expect.objectContaining({ kind: 'quote.ready', title: 'Tu propuesta V1 está lista', body: `Total: MXN 485,000.00 · ${folio}` })]);
    expect((await inboxOf(authorId)).find((row) => row.kind === 'quote.changes_requested')).toMatchObject({ resolvedNote: 'Se envió la propuesta V1' });
  });

  it('asks approvers to decide, drops superseded requests and tells the requester the outcome', async () => {
    const first = await approval('REQUESTED', 'a');
    await event('QUOTE.APPROVAL_REQUESTED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, versionNumber: 1, approvalId: first.id, type: 'DISCOUNT' });
    expect((await inboxOf(approverId)).find((row) => row.groupKey === `approval:${first.id}`)).toMatchObject({ kind: 'approval.requested', actionRequired: true, title: `author ${suffix} pide aprobar un descuento en ${folio}` });
    expect((await inboxOf(authorId)).some((row) => row.kind === 'approval.requested')).toBe(false);

    await prisma.quoteApproval.update({ where: { id: first.id }, data: { status: 'SUPERSEDED' } });
    const second = await approval('REQUESTED', 'b');
    await event('QUOTE.APPROVAL_REQUESTED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, versionNumber: 1, approvalId: second.id, type: 'DISCOUNT' });
    expect((await inboxOf(approverId)).find((row) => row.groupKey === `approval:${first.id}`)).toMatchObject({ resolvedNote: 'Ya no aplica: la cotización cambió' });

    await prisma.quoteApproval.update({ where: { id: second.id }, data: { status: 'APPROVED', decidedById: approverId, decidedAt: now } });
    await event('QUOTE.APPROVAL_RESOLVED', { userId: approverId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, versionNumber: 1, approvalId: second.id, status: 'APPROVED', type: 'DISCOUNT' });
    expect((await inboxOf(authorId)).find((row) => row.kind === 'approval.resolved')).toMatchObject({ title: `approver ${suffix} aprobó tu descuento en ${folio}`, body: 'Ya puedes enviar la propuesta V1' });
    expect((await inboxOf(approverId)).find((row) => row.groupKey === `approval:${second.id}`)).toMatchObject({ resolvedNote: 'La aprobaste' });
  });

  it('tells the author when a version is sent back with its reason', async () => {
    await event('QUOTE.VERSION_REOPENED', { userId: approverId, type: 'EMPLOYEE' }, { quoteVersionId: sentVersionId, fromStatus: 'EN_REVISION', toStatus: 'BORRADOR', reason: 'Falta el calentador' });
    expect((await inboxOf(authorId)).find((row) => row.kind === 'quote.returned')).toMatchObject({ title: `approver ${suffix} devolvió a borrador la propuesta V1 de ${folio}`, body: 'Motivo: Falta el calentador' });
  });

  it('asks price managers for a missing price once, however often the draft autosaves', async () => {
    for (let save = 0; save < 2; save += 1) await event('QUOTE.VERSION_UPDATED', { userId: authorId, type: 'EMPLOYEE' }, { quoteVersionId: draftVersionId, versionNumber: 2 });
    const pending = (await inboxOf(pricingId)).filter((row) => row.kind === 'price.pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ occurrences: 1, actionRequired: true, groupKey: `price:${priceListId}:${catalogItemId}`, title: `Bomba ${suffix} necesita precio en Lista ${suffix}`, body: `Lo espera ${folio}` });
  });

  it('celebrates an acceptance with the assignee and managers', async () => {
    await event('QUOTE.ACCEPTED', { userId: customerId, type: 'CUSTOMER' }, { quoteVersionId: sentVersionId, versionNumber: 1 });
    for (const recipientId of [authorId, managerId]) {
      expect((await inboxOf(recipientId)).find((row) => row.kind === 'quote.accepted'), recipientId).toMatchObject({ priority: 'URGENT', title: `customer ${suffix} aceptó la propuesta V1`, body: 'Total aceptado: MXN 485,000.00' });
    }
    expect((await inboxOf(customerId)).some((row) => row.kind === 'quote.accepted')).toBe(false);
  });
});
