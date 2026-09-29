import type { PrismaClient } from '@/generated/prisma/client';
import { logger } from '@/server/logging/logger';
import { notifyInbox } from '@/server/modules/inbox/domain-events';
import type { ClaimedNotificationDelivery } from '@/server/modules/notifications/dispatcher';

type DeliveryRef = Pick<ClaimedNotificationDelivery, 'id' | 'templateKey' | 'payload' | 'outboxEvent'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Sólo los correos a clientes (su enlace va al portal) de un expediente conocido generan aviso interno. */
export function customerFacingRequestId(delivery: DeliveryRef): string | null {
  const actionPath = typeof delivery.payload?.actionPath === 'string' ? delivery.payload.actionPath : '';
  if (!actionPath.startsWith('/portal')) return null;
  const requestId = delivery.outboxEvent.payload.quoteRequestId;
  return typeof requestId === 'string' && UUID_PATTERN.test(requestId) ? requestId : null;
}

/** Una entrega quedó FAILED definitiva: el responsable se entera de que su cliente no recibió el correo. */
export async function reportDeliveryFailure(prisma: PrismaClient, delivery: DeliveryRef, now: Date): Promise<void> {
  const requestId = customerFacingRequestId(delivery);
  if (!requestId) return;
  try {
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: null, eventType: 'EMAIL.DELIVERY_FAILED', aggregateType: 'NOTIFICATION_DELIVERY', aggregateId: delivery.id, payload: { quoteRequestId: requestId, templateKey: delivery.templateKey } }, { now }));
  } catch (error) {
    logger.warn({ deliveryId: delivery.id, error: error instanceof Error ? error.message : String(error) }, 'Could not report a failed delivery to the inbox');
  }
}

/**
 * Un correo a cliente se entregó: si había un aviso de rebote abierto para ese expediente, se cierra.
 * Nunca lanza: corre después de marcar el envío y un error aquí no debe tratarse como fallo del correo.
 */
export async function reportDeliveryRecovered(prisma: PrismaClient, delivery: DeliveryRef, now: Date): Promise<void> {
  const requestId = customerFacingRequestId(delivery);
  if (!requestId) return;
  try {
    const open = await prisma.inboxNotification.count({ where: { groupKey: `email-failed:${requestId}`, resolvedAt: null } });
    if (open === 0) return;
    await prisma.$transaction((tx) => notifyInbox(tx, { actor: null, eventType: 'EMAIL.DELIVERY_RECOVERED', aggregateType: 'NOTIFICATION_DELIVERY', aggregateId: delivery.id, payload: { quoteRequestId: requestId } }, { now }));
  } catch (error) {
    logger.warn({ deliveryId: delivery.id, error: error instanceof Error ? error.message : String(error) }, 'Could not close a delivery warning in the inbox');
  }
}
