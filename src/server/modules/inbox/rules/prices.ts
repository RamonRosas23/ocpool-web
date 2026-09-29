import type { Prisma } from '@/generated/prisma/client';
import { activeEmployees, displayNameOf, uuidOf } from '../audience';
import { staffRequestPath } from '../paths';
import { NO_INBOX_EFFECTS, type InboxEffects, type InboxIntent } from '../record';
import type { DomainEventInput } from './types';

/** Un precio entró en vigor: cierra el pedido a quienes administran precios y avisa a cada borrador que lo esperaba. */
export async function pendingPriceResolvedEffects(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<InboxEffects> {
  const priceListId = uuidOf(event.payload.priceListId);
  const catalogItemId = uuidOf(event.payload.catalogItemId);
  if (!priceListId || !catalogItemId) return NO_INBOX_EFFECTS;
  const actorId = event.actor?.userId ?? null;
  const actorName = (await displayNameOf(tx, actorId)) ?? 'Alguien del equipo';
  const lines = await tx.quoteLineSnapshot.findMany({
    where: { pricePending: true, catalogItemId, quoteVersion: { status: 'BORRADOR', sourcePriceListId: priceListId } },
    select: { catalogItem: { select: { name: true } }, quoteVersion: { select: { createdById: true, sourcePriceList: { select: { name: true } }, quote: { select: { quoteRequest: { select: { id: true, folio: true, currentAssigneeId: true } } } } } } },
  });
  const intents: InboxIntent[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const request = line.quoteVersion.quote.quoteRequest;
    for (const user of await activeEmployees(tx, [line.quoteVersion.createdById, request.currentAssigneeId])) {
      const key = `${user.id}:${request.id}`;
      if (user.id === actorId || seen.has(key)) continue;
      seen.add(key);
      intents.push({ recipientId: user.id, kind: 'price.assigned', priority: 'NORMAL', quoteRequestId: request.id, actorId, groupKey: null, actionPath: staffRequestPath(request.id, 'quote'), actionRequired: false, data: { folio: request.folio, itemName: line.catalogItem?.name, priceListName: line.quoteVersion.sourcePriceList?.name, actorName } });
    }
  }
  return { intents, resolutions: [{ groupKey: `price:${priceListId}:${catalogItemId}`, note: `Precio asignado por ${actorName}`, actorId, actorNote: 'Le asignaste precio' }] };
}
