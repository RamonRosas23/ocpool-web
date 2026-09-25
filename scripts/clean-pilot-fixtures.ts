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
  await prisma.notificationDelivery.deleteMany({ where: { outboxEvent: { aggregateId: { in: [...manifest.requestIds, ...quoteIds] } } } });
  await prisma.quoteApproval.deleteMany({ where: { quoteVersionId: { in: versionIds } } });
  await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await prisma.quotePublication.deleteMany({ where: { documentId: { in: documents.map(({ id }) => id) } } });
  await prisma.generatedDocument.deleteMany({ where: { id: { in: documents.map(({ id }) => id) } } });
  await prisma.storageObject.deleteMany({ where: { id: { in: documents.flatMap(({ storageObjectId }) => storageObjectId ? [storageObjectId] : []) } } });

  console.log('Retirando cotizaciones y expedientes…');
  await prisma.quote.deleteMany({ where: { quoteRequestId: { in: manifest.requestIds } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...manifest.requestIds, ...quoteIds] } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...manifest.requestIds, ...quoteIds, ...versionIds] } } });
  await prisma.quoteRequest.deleteMany({ where: { id: { in: manifest.requestIds } } });
  await prisma.clientContact.deleteMany({ where: { id: { in: manifest.contactIds } } });

  console.log('Retirando tokens, eventos de autenticación y cuentas…');
  await prisma.authToken.deleteMany({ where: { id: { in: manifest.tokenIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: manifest.userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: manifest.userIds } } });
  // RequestAssignment.assignedToId/assignedById son onDelete: Restrict -- el cascade de
  // QuoteRequest sólo retira las asignaciones de sus propias peticiones; una asignación
  // que sobreviva (p. ej. de una corrida previa no limpiada del todo) bloquearía el borrado
  // de estos usuarios si no se retira aquí explícitamente.
  await prisma.requestAssignment.deleteMany({ where: { OR: [{ assignedToId: { in: manifest.userIds } }, { assignedById: { in: manifest.userIds } }] } });
  // Los usuarios cliente creados para los enlaces mágicos referencian Client vía clientId --
  // deben retirarse antes que los propios clientes, o la FK lo rechaza. Publicar una cotización
  // puede además aprovisionar en automático un usuario de portal adicional (mismo efecto de P1)
  // que nunca quedó en el manifiesto -- se retira por clientId, no sólo por los IDs registrados.
  await prisma.user.deleteMany({ where: { id: { in: manifest.userIds } } });
  await prisma.user.deleteMany({ where: { clientId: { in: manifest.clientIds }, type: 'CUSTOMER' } });
  await prisma.client.deleteMany({ where: { id: { in: manifest.clientIds } } });

  console.log('Retirando catálogo y precios…');
  await prisma.priceListItem.deleteMany({ where: { priceListId: { in: manifest.priceListIds } } });
  await prisma.priceList.deleteMany({ where: { id: { in: manifest.priceListIds } } });
  await prisma.catalogItem.deleteMany({ where: { id: { in: manifest.itemIds } } });
  await prisma.catalogCategory.deleteMany({ where: { id: { in: manifest.categoryIds } } });

  await rm(MANIFEST_PATH, { force: true });
  console.log('\nPiloto retirado por completo.');
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
