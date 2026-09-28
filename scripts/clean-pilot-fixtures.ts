import 'dotenv/config';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { getPrisma } from '@/server/db/client';
import { getPrivateStorage } from '@/server/modules/private-files/storage';

/**
 * Retira exactamente lo que `npm run pilot:seed` creó, leyendo el manifiesto
 * que esa corrida dejó -- nunca borra por patrón de nombre ni por fecha, sólo
 * los IDs registrados. Seguro de correr aunque una corrida anterior haya
 * fallado a la mitad (cada paso es best-effort sobre listas que pueden venir
 * vacías).
 */

const MANIFEST_PATH = path.resolve('docs/ocpool-commercial-v2/pilot-fixtures.json');

type Manifest = {
  userIds: string[];
  clientIds: string[];
  contactIds: string[];
  requestIds: string[];
  categoryIds: string[];
  itemIds: string[];
  priceListIds: string[];
  tokenIds: string[];
};

async function main(): Promise<void> {
  const raw = await readFile(MANIFEST_PATH, 'utf8').catch(() => null);
  if (!raw) {
    console.log(`No hay manifiesto en ${MANIFEST_PATH} -- nada que limpiar.`);
    return;
  }
  const manifest = JSON.parse(raw) as Manifest;
  const prisma = getPrisma();
  const storage = getPrivateStorage();

  console.log('Retirando objetos de storage (PDFs generados)…');
  const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: manifest.requestIds } } }, select: { id: true } })).map(({ id }) => id);
  const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
  for (const document of documents) {
    if (document.storageObject?.storageKey) await storage.delete(document.storageObject.storageKey).catch(() => undefined);
  }

  console.log('Retirando notificaciones, aceptaciones y documentos…');
  const quoteIds = (await prisma.quote.findMany({ where: { quoteRequestId: { in: manifest.requestIds } }, select: { id: true } })).map(({ id }) => id);
  // Lo que las sesiones del piloto generan además de expedientes y cotizaciones: mensajes, archivos,
  // aprobaciones y cuentas de portal aprovisionadas al publicar. Sus avisos (outbox) se agregan por
  // conversación, archivo, documento o usuario, no por expediente -- sin esto quedaban entregas
  // pendientes de conversaciones ya borradas que el worker seguía intentando enviar.
  const conversationIds = (await prisma.conversation.findMany({ where: { quoteRequestId: { in: manifest.requestIds } }, select: { id: true } })).map(({ id }) => id);
  const messageIds = (await prisma.conversationMessage.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } })).map(({ id }) => id);
  const files = await prisma.fileAttachment.findMany({ where: { quoteRequestId: { in: manifest.requestIds } }, select: { id: true, storageObjectId: true, storageObject: { select: { storageKey: true } } } });
  const fileIds = files.map(({ id }) => id);
  const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
  const customerUserIds = (await prisma.user.findMany({ where: { clientId: { in: manifest.clientIds }, type: 'CUSTOMER' }, select: { id: true } })).map(({ id }) => id);
  const pilotUserIds = [...new Set([...manifest.userIds, ...customerUserIds])];
  // Aceptar una propuesta crea el proyecto de arranque: se retira antes que la aceptación.
  const projectIds = (await prisma.project.findMany({ where: { quoteRequestId: { in: manifest.requestIds } }, select: { id: true } })).map(({ id }) => id);
  const aggregateIds = [...manifest.requestIds, ...quoteIds, ...conversationIds, ...fileIds, ...documents.map(({ id }) => id), ...pilotUserIds, ...projectIds];
  await prisma.notificationDelivery.deleteMany({ where: { outboxEvent: { aggregateId: { in: aggregateIds } } } });
  await prisma.projectChecklistItem.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.quoteApproval.deleteMany({ where: { quoteVersionId: { in: versionIds } } });
  await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await prisma.quotePublication.deleteMany({ where: { documentId: { in: documents.map(({ id }) => id) } } });
  await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
  await prisma.storageObject.deleteMany({ where: { id: { in: documents.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });

  console.log('Retirando cotizaciones y expedientes…');
  await prisma.quote.deleteMany({ where: { quoteRequestId: { in: manifest.requestIds } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
  // La auditoría no tiene FK: se retira lo del piloto por entidad y por cuenta del piloto.
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...manifest.requestIds, ...quoteIds, ...versionIds, ...conversationIds, ...messageIds, ...fileIds, ...approvalIds, ...documents.map(({ id }) => id), ...projectIds] } }, { actorUserId: { in: pilotUserIds } }] } });
  await prisma.quoteRequest.deleteMany({ where: { id: { in: manifest.requestIds } } });
  // Los archivos subidos durante el piloto se fueron en cascada con su expediente; sus objetos no.
  for (const file of files) {
    if (file.storageObject?.storageKey) await storage.delete(file.storageObject.storageKey).catch(() => undefined);
  }
  await prisma.storageObject.deleteMany({ where: { id: { in: files.map(({ storageObjectId }) => storageObjectId) } } });
  await prisma.clientContact.deleteMany({ where: { id: { in: manifest.contactIds } } });

  console.log('Retirando tokens, eventos de autenticación y cuentas…');
  await prisma.authToken.deleteMany({ where: { id: { in: manifest.tokenIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: pilotUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: pilotUserIds } } });
  // RequestAssignment.assignedToId/assignedById son onDelete: Restrict -- el cascade de
  // QuoteRequest sólo retira las asignaciones de sus propias peticiones; una asignación
  // que sobreviva (p. ej. de una corrida previa no limpiada del todo) bloquearía el borrado
  // de estos usuarios si no se retira aquí explícitamente.
  await prisma.requestAssignment.deleteMany({ where: { OR: [{ assignedToId: { in: pilotUserIds } }, { assignedById: { in: pilotUserIds } }] } });
  // Los usuarios cliente creados para los enlaces mágicos referencian Client vía clientId --
  // deben retirarse antes que los propios clientes, o la FK lo rechaza. Publicar una cotización
  // puede además aprovisionar en automático un usuario de portal adicional (mismo efecto de P1)
  // que nunca quedó en el manifiesto -- se retira por clientId, no sólo por los IDs registrados.
  await prisma.user.deleteMany({ where: { id: { in: manifest.userIds } } });
  await prisma.user.deleteMany({ where: { clientId: { in: manifest.clientIds }, type: 'CUSTOMER' } });
  await prisma.client.deleteMany({ where: { id: { in: manifest.clientIds } } });

  console.log('Retirando catálogo y precios…');
  // Además de los precios de las listas del piloto, cualquier precio que otra lista le haya puesto
  // después a un concepto del piloto: sin esto, la FK de price_list_items impedía borrar el concepto
  // (pasó con una lista de pruebas que había programado precios a PILOTO-ITEM-07/09/10).
  await prisma.priceListItem.deleteMany({ where: { OR: [{ priceListId: { in: manifest.priceListIds } }, { catalogItemId: { in: manifest.itemIds } }] } });
  await prisma.priceList.deleteMany({ where: { id: { in: manifest.priceListIds } } });

  // Un concepto del piloto usado por una cotización o una promoción AJENA al piloto no se puede borrar
  // sin romper ese historial. En vez de fallar, se archiva y se libera su clave (las líneas de
  // cotización guardan su propia copia de la clave, así que su historial no cambia): el siguiente
  // `pilot:seed` vuelve a poder crear PILOTO-ITEM-xx.
  const referencedItemIds = new Set([
    ...(await prisma.quoteLineSnapshot.findMany({ where: { catalogItemId: { in: manifest.itemIds } }, select: { catalogItemId: true }, distinct: ['catalogItemId'] })).flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : []),
    ...(await prisma.specialConceptPromotion.findMany({ where: { catalogItemId: { in: manifest.itemIds } }, select: { catalogItemId: true }, distinct: ['catalogItemId'] })).map(({ catalogItemId }) => catalogItemId),
  ]);
  await prisma.catalogItem.deleteMany({ where: { id: { in: manifest.itemIds.filter((id) => !referencedItemIds.has(id)) } } });
  const retiredSuffix = `-RETIRADO-${Date.now().toString(36).toUpperCase()}`;
  const keptItems = await prisma.catalogItem.findMany({ where: { id: { in: [...referencedItemIds] } }, select: { id: true, code: true } });
  for (const item of keptItems) {
    await prisma.catalogItem.update({ where: { id: item.id }, data: { status: 'ARCHIVED', code: `${item.code}${retiredSuffix}`.slice(0, 64) } });
  }

  // Igual para las categorías: sólo se borran las que ya no tienen conceptos ni subcategorías.
  const keptCategories = await prisma.catalogCategory.findMany({ where: { id: { in: manifest.categoryIds }, OR: [{ items: { some: {} } }, { children: { some: {} } }] }, select: { id: true, code: true } });
  await prisma.catalogCategory.deleteMany({ where: { id: { in: manifest.categoryIds.filter((id) => !keptCategories.some((category) => category.id === id)) } } });
  for (const category of keptCategories) {
    await prisma.catalogCategory.update({ where: { id: category.id }, data: { status: 'ARCHIVED', code: `${category.code}${retiredSuffix}`.slice(0, 64) } });
  }

  await rm(MANIFEST_PATH, { force: true });
  if (keptItems.length || keptCategories.length) {
    console.warn(`\nAviso: ${keptItems.length} concepto(s) y ${keptCategories.length} categoría(s) del piloto siguen en uso fuera del piloto; se archivaron con la clave liberada (sufijo ${retiredSuffix}) en vez de borrarse.`);
  }
  console.log('\nPiloto retirado por completo.');
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
