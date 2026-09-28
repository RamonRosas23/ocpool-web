import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { closeQuoteRequest, getStaffQuoteRequest, listWaitingOnCustomerForActor, reopenQuoteRequest } from '@/server/modules/quote-requests/staff-service';
import { createQuoteVersion, transitionQuoteVersion } from '@/server/modules/quotes/service';

function employeeActor(userId: string, roles: string[] = ['sales']): Actor {
  return { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(roles), mfaVerified: true };
}

const DAY = 86_400_000;

describe('quote request lifecycle: follow-up, close and reopen', () => {
  it('flags a sent proposal with no answer, closes it with a reason (retiring the proposal) and reopens it back to review', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const stamp = Date.now().toString();
    const suffix = `life-${stamp}`;
    const now = new Date();
    const request = await createQuoteRequest({
      idempotencyKey: `lifecycle-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Lifecycle ${suffix}`, email: `lifecycle-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Lifecycle fixture', consentAt: now },
    }, { prisma, now });
    const salesUser = await prisma.user.create({ data: { email: `life-sales-${suffix}@example.test`, emailNormalized: `life-sales-${suffix}@example.test`, displayName: 'Lifecycle sales', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const otherSalesUser = await prisma.user.create({ data: { email: `life-other-${suffix}@example.test`, emailNormalized: `life-other-${suffix}@example.test`, displayName: 'Other sales', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const customerUser = await prisma.user.create({ data: { email: `life-customer-${suffix}@example.test`, emailNormalized: `life-customer-${suffix}@example.test`, displayName: 'Lifecycle customer', type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId } });
    const category = await prisma.catalogCategory.create({ data: { code: `LIFE-${stamp}`, name: 'Lifecycle fixture' } });
    const item = await prisma.catalogItem.create({ data: { code: `LIFE-ITEM-${stamp}`, name: 'Lifecycle item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `LIFE-PRICE-${stamp}`, name: 'Lifecycle prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 50_000n, validFrom: now } });
    const sales = employeeActor(salesUser.id);
    const otherSales = employeeActor(otherSalesUser.id);
    let quoteId: string | null = null;
    let versionId: string | null = null;
    const isWaiting = async (actor: Actor) => (await listWaitingOnCustomerForActor(actor, { prisma, now })).items.some((entry) => entry.id === request.quoteRequestId);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesUser.id } });
      const created = await createQuoteVersion(sales, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', taxBasisPoints: 1600 }] }, { prisma, now });
      quoteId = created.quoteId;
      versionId = created.versionId;
      await transitionQuoteVersion(sales, created.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(sales, created.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toMatchObject({ status: 'COTIZACION_DISPONIBLE' });

      // Recién enviada no se sugiere seguimiento; seis días sin movimiento, sí (sólo a quien lo lleva).
      expect(await isWaiting(sales)).toBe(false);
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { updatedAt: new Date(now.getTime() - 6 * DAY) } });
      expect(await isWaiting(sales)).toBe(true);
      expect(await isWaiting(otherSales)).toBe(false);

      // Si el último mensaje compartido es del cliente, la pelota está del lado del equipo: no es "sin respuesta".
      const conversation = await prisma.conversation.create({ data: { quoteRequestId: request.quoteRequestId, clientId: request.clientId } });
      await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: customerUser.id, visibility: 'CUSTOMER', body: '¿Pueden cambiar el azulejo?', createdAt: new Date(now.getTime() - 6 * DAY) } });
      expect(await isWaiting(sales)).toBe(false);
      // Una nota interna posterior no cuenta como respuesta al cliente.
      await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: salesUser.id, visibility: 'INTERNAL', body: 'Revisar con proveedor.', createdAt: new Date(now.getTime() - 5 * DAY) } });
      expect(await isWaiting(sales)).toBe(false);
      await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderUserId: salesUser.id, visibility: 'CUSTOMER', body: 'Sí, te compartimos opciones.', createdAt: new Date(now.getTime() - 5 * DAY) } });
      expect(await isWaiting(sales)).toBe(true);

      const open = await getStaffQuoteRequest(sales, request.quoteRequestId, { prisma, now });
      expect(open.availableActions).toContain('request.close');
      expect(open.availableActions).not.toContain('request.reopen');

      await expect(closeQuoteRequest(sales, request.quoteRequestId, { reason: 'NOT_A_REASON' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const closed = await closeQuoteRequest(sales, request.quoteRequestId, { reason: 'NO_RESPONSE', note: 'Sin contacto tras tres intentos' }, { prisma, now });
      expect(closed).toMatchObject({ fromStatus: 'COTIZACION_DISPONIBLE', toStatus: 'RECHAZADA' });
      expect(await prisma.requestStatusHistory.findFirst({ where: { quoteRequestId: request.quoteRequestId, toStatus: 'RECHAZADA' }, select: { reason: true } })).toEqual({ reason: 'Sin respuesta del cliente: Sin contacto tras tres intentos' });
      // La propuesta enviada se retira: el cliente ya no puede aceptarla.
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toEqual({ status: 'RECHAZADA' });
      expect(await prisma.quoteStatusHistory.findFirst({ where: { quoteVersionId: created.versionId, toStatus: 'RECHAZADA' }, select: { fromStatus: true } })).toEqual({ fromStatus: 'ENVIADA' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: request.quoteRequestId, action: 'quote_request.closed' }, select: { metadata: true } })).toMatchObject({ metadata: { reason: 'Sin respuesta del cliente', fromStatus: 'COTIZACION_DISPONIBLE' } });
      expect(await isWaiting(sales)).toBe(false);
      await expect(closeQuoteRequest(sales, request.quoteRequestId, { reason: 'OTHER' }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT' });

      const closedDetail = await getStaffQuoteRequest(sales, request.quoteRequestId, { prisma, now });
      expect(closedDetail.availableActions).toContain('request.reopen');
      expect(closedDetail.availableActions).not.toContain('request.close');

      // Con cotización, reabrir lo deja en elaboración: el constructor puede crear la nueva versión de inmediato.
      const reopened = await reopenQuoteRequest(sales, request.quoteRequestId, { note: 'El cliente volvió a escribir' }, { prisma, now });
      expect(reopened).toMatchObject({ fromStatus: 'RECHAZADA', toStatus: 'EN_ELABORACION' });
      expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toEqual({ status: 'EN_ELABORACION' });
      expect(await prisma.auditLog.count({ where: { entityId: request.quoteRequestId, action: 'quote_request.reopened' } })).toBe(1);
      await expect(reopenQuoteRequest(sales, request.quoteRequestId, {}, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT' });
      // El constructor reenvía el precio congelado de la versión anterior: Ventas (sin quotes.edit_prices)
      // puede conservarlo, pero no cambiarlo.
      await expect(createQuoteVersion(sales, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '2', unitPriceMinorOverride: '45000', taxBasisPoints: 1600 }] }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const second = await createQuoteVersion(sales, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '2', unitPriceMinorOverride: '50000', taxBasisPoints: 1600 }] }, { prisma, now });
      expect(await prisma.quoteVersion.findUnique({ where: { id: second.versionId }, select: { versionNumber: true, status: true } })).toEqual({ versionNumber: 2, status: 'BORRADOR' });
    } finally {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...(versionId ? [versionId] : [])] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [request.quoteRequestId, ...(quoteId ? [quoteId] : []), ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.deleteMany({ where: { id: { in: [salesUser.id, otherSalesUser.id, customerUser.id] } } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
