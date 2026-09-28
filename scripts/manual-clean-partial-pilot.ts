import 'dotenv/config';
import { getPrisma } from '@/server/db/client';

async function main(): Promise<void> {
  const prisma = getPrisma();
  const staffEmails = ['pilot-ventas-a@ocpool.test', 'pilot-ventas-b@ocpool.test', 'pilot-gerente@ocpool.test', 'pilot-admin@ocpool.test'];
  const staffUsers = await prisma.user.findMany({ where: { emailNormalized: { in: staffEmails } }, select: { id: true } });
  const staffUserIds = staffUsers.map((u) => u.id);
  const contacts = await prisma.clientContact.findMany({ where: { email: { startsWith: 'pilot-contacto-' } }, select: { id: true, clientId: true } });
  const contactIds = contacts.map((c) => c.id);
  const clientIds = [...new Set(contacts.map((c) => c.clientId))];
  const requests = await prisma.quoteRequest.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } });
  const requestIds = requests.map((r) => r.id);
  const quotes = await prisma.quote.findMany({ where: { quoteRequestId: { in: requestIds } }, select: { id: true } });
  const quoteIds = quotes.map((q) => q.id);
  const versions = await prisma.quoteVersion.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } });
  const versionIds = versions.map((v) => v.id);
  const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true, storageObjectId: true } });
  const documentIds = documents.map((d) => d.id);
  const storageObjectIds = documents.flatMap((d) => (d.storageObjectId ? [d.storageObjectId] : []));
  const customerUsers = await prisma.user.findMany({ where: { clientId: { in: clientIds }, type: 'CUSTOMER' }, select: { id: true } });
  const customerUserIds = customerUsers.map((u) => u.id);
  const allUserIds = [...staffUserIds, ...customerUserIds];
  const tokens = await prisma.authToken.findMany({ where: { userId: { in: allUserIds } }, select: { id: true } });
  const tokenIds = tokens.map((t) => t.id);
  const category = await prisma.catalogCategory.findUnique({ where: { code: 'PILOTO-ALBERCAS' }, select: { id: true } });
  const items = await prisma.catalogItem.findMany({ where: { code: { startsWith: 'PILOTO-ITEM-' } }, select: { id: true } });
  const itemIds = items.map((i) => i.id);
  const priceList = await prisma.priceList.findUnique({ where: { code: 'PILOTO-PRECIOS' }, select: { id: true } });
  console.log('Encontrado:', { staffUserIds, contactIds, clientIds, requestIds, quoteIds, versionIds, documentIds, customerUserIds, tokenIds, categoryId: category?.id, priceListId: priceList?.id });
  await prisma.notificationDelivery.deleteMany({ where: { outboxEvent: { aggregateId: { in: [...requestIds, ...quoteIds] } } } });
  await prisma.quoteApproval.deleteMany({ where: { quoteVersionId: { in: versionIds } } });
  await prisma.quoteAcceptance.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await prisma.quotePublication.deleteMany({ where: { documentId: { in: documentIds } } });
  await prisma.generatedDocument.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.storageObject.deleteMany({ where: { id: { in: storageObjectIds } } });
  await prisma.quote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...requestIds, ...quoteIds] } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...requestIds, ...quoteIds, ...versionIds] } } });
  await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.authToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: allUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: allUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: customerUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: staffUserIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  if (priceList) { await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } }); await prisma.priceList.delete({ where: { id: priceList.id } }); }
  await prisma.catalogItem.deleteMany({ where: { id: { in: itemIds } } });
  if (category) await prisma.catalogCategory.delete({ where: { id: category.id } });
  console.log('Limpieza manual completa.');
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
