import 'dotenv/config';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getPrisma } from '@/server/db/client';
import { hashPassword, encryptSecret, fingerprintToken, generateOpaqueToken } from '@/server/auth/crypto';
import { createMfaEnrollment } from '@/server/auth/mfa';
import { readServerEnv } from '@/server/env';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion, transitionQuoteVersion, publishQuoteVersion } from '@/server/modules/quotes/service';
import { requestQuoteApproval } from '@/server/modules/quotes/approval-service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { fanOutNotificationEvent, type ClaimedNotificationOutbox } from '@/server/modules/notifications/fanout';
import type { Actor } from '@/server/auth/types';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Provisiona, en una sola corrida, todos los datos que el protocolo de T1
 * necesita (docs/runbooks/pilot-usability-protocol.md): cuentas staff reales,
 * un catálogo de precios, y un expediente/cotización por tarea del guion. No
 * reemplaza la coordinación humana (reclutar, agendar, moderar) -- sólo evita
 * que cada sesión empiece con una hora de preparación manual de base de datos.
 *
 * Se niega a correr si ya existe un manifiesto previo sin limpiar -- usar
 * `npm run pilot:clean` primero. Esto es intencional: nunca se sobreescribe
 * o duplica en silencio una cohorte de piloto ya provisionada.
 */

const MANIFEST_PATH = path.resolve('docs/ocpool-commercial-v2/pilot-fixtures.json');
const PILOT_PASSWORD = 'Piloto2026Ocpool!';
const PORTAL_BASE_URL = process.env.APP_URL ?? 'http://127.0.0.1:3008';

type Manifest = {
  createdAt: string;
  userIds: string[];
  clientIds: string[];
  contactIds: string[];
  requestIds: string[];
  categoryIds: string[];
  itemIds: string[];
  priceListIds: string[];
  tokenIds: string[];
  staff: { role: string; email: string; password: string; note?: string }[];
  customers: { label: string; magicLinkUrl: string; folio: string }[];
  folios: Record<string, string>;
};

async function fail(message: string): Promise<never> {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

/**
 * Reclama y procesa UN evento específico de Outbox por id, sin pasar por el
 * lote genérico de `processNotificationFanoutBatch`. Este entorno compartido
 * acumula un backlog grande de eventos `PENDING` de sesiones anteriores no
 * limpiadas del todo -- un lote de tamaño fijo ordenado por antigüedad nunca
 * alcanzaría el evento recién creado de este script, que siempre queda al
 * final de la fila. Reutiliza `fanOutNotificationEvent` (el mismo código que
 * usa el worker real), sólo reemplaza el paso de reclamo por lote con uno
 * acotado a un solo id.
 */
async function fanOutOneEvent(prisma: PrismaClient, eventId: string, leaseSeconds: number, now: Date): Promise<void> {
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
  const claimed = await prisma.outboxEvent.updateMany({ where: { id: eventId, status: 'PENDING' }, data: { status: 'PROCESSING', attempts: { increment: 1 }, availableAt: leaseUntil, processedAt: null, lastError: null } });
  if (claimed.count !== 1) { console.warn(`  Aviso: no se pudo reclamar el evento ${eventId} para envío de notificación.`); return; }
  const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
  const claimedEvent: ClaimedNotificationOutbox = { id: event.id, eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, payload: event.payload as Record<string, unknown>, attempts: event.attempts, availableAt: event.availableAt, createdAt: event.createdAt };
  await fanOutNotificationEvent(prisma, claimedEvent, leaseUntil, now);
}

async function main(): Promise<void> {
  const existing = await stat(MANIFEST_PATH).then(() => true).catch(() => false);
  if (existing) await fail(`Ya existe un manifiesto de piloto en ${MANIFEST_PATH}. Corre "npm run pilot:clean" antes de generar uno nuevo.`);

  const prisma = getPrisma();
  const env = readServerEnv();
  const now = new Date();
  const manifest: Manifest = {
    createdAt: now.toISOString(),
    userIds: [], clientIds: [], contactIds: [], requestIds: [],
    categoryIds: [], itemIds: [], priceListIds: [], tokenIds: [],
    staff: [], customers: [], folios: {},
  };

  console.log('Provisionando cuentas staff…');
  const [salesRole, managerRole, adminRole, customerRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { key: 'sales' } }),
    prisma.role.findUniqueOrThrow({ where: { key: 'manager' } }),
    prisma.role.findUniqueOrThrow({ where: { key: 'admin' } }),
    prisma.role.findUniqueOrThrow({ where: { key: 'customer' } }),
  ]);
  const passwordHash = await hashPassword(PILOT_PASSWORD);

  const salesA = await prisma.user.create({ data: { email: 'pilot-ventas-a@ocpool.test', emailNormalized: 'pilot-ventas-a@ocpool.test', displayName: 'Piloto Ventas A', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash, roles: { create: { roleId: salesRole.id } } } });
  const salesB = await prisma.user.create({ data: { email: 'pilot-ventas-b@ocpool.test', emailNormalized: 'pilot-ventas-b@ocpool.test', displayName: 'Piloto Ventas B', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash, roles: { create: { roleId: salesRole.id } } } });
  const manager = await prisma.user.create({ data: { email: 'pilot-gerente@ocpool.test', emailNormalized: 'pilot-gerente@ocpool.test', displayName: 'Piloto Gerente', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash, roles: { create: { roleId: managerRole.id } } } });
  const adminMfa = createMfaEnrollment({ accountLabel: 'pilot-admin@ocpool.test', issuer: 'OCPOOL' });
  const admin = await prisma.user.create({ data: { email: 'pilot-admin@ocpool.test', emailNormalized: 'pilot-admin@ocpool.test', displayName: 'Piloto Admin', type: 'EMPLOYEE', status: 'ACTIVE', passwordHash, mfaRequired: true, mfaSecretCiphertext: encryptSecret(adminMfa.secret, env.MFA_ENCRYPTION_KEY), mfaEnrolledAt: now, roles: { create: { roleId: adminRole.id } } } });
  manifest.userIds.push(salesA.id, salesB.id, manager.id, admin.id);
  manifest.staff.push(
    { role: 'Ventas A', email: salesA.email, password: PILOT_PASSWORD },
    { role: 'Ventas B', email: salesB.email, password: PILOT_PASSWORD },
    { role: 'Gerente', email: manager.email, password: PILOT_PASSWORD },
    { role: 'Admin', email: admin.email, password: PILOT_PASSWORD, note: `MFA obligatorio -- agrega esta clave TOTP a una app autenticadora antes de la sesión: ${adminMfa.secret} (URI: ${adminMfa.uri})` },
  );

  // Historial previo de inicio de sesión del admin, para que la tarea "¿quién
  // inició sesión esta semana?" tenga algo que encontrar además de la sesión
  // en vivo del propio participante.
  await prisma.authEvent.create({ data: { userId: admin.id, eventType: 'LOGIN_SUCCESS', outcome: 'SUCCESS', identifierHash: fingerprintToken(admin.emailNormalized), ipAddress: '203.0.113.5', userAgent: 'pilot-fixture-seed', createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) } });

  console.log('Provisionando catálogo y precios…');
  const category = await prisma.catalogCategory.create({ data: { code: 'PILOTO-ALBERCAS', name: 'Piloto — instalación de albercas' } });
  manifest.categoryIds.push(category.id);
  const itemNames = ['Excavación y preparación de terreno', 'Estructura de fibra de vidrio', 'Sistema de filtración', 'Bomba de recirculación', 'Calentador solar', 'Iluminación LED sumergible', 'Recubrimiento de azulejo', 'Escalera de acceso', 'Cubierta automática', 'Sistema de cloración salina', 'Andador perimetral', 'Deck de madera tratada'];
  const items = await Promise.all(itemNames.map((name, index) => prisma.catalogItem.create({ data: { code: `PILOTO-ITEM-${String(index + 1).padStart(2, '0')}`, name, unit: 'pieza', categoryId: category.id } })));
  manifest.itemIds.push(...items.map((item) => item.id));
  const priceList = await prisma.priceList.create({ data: { code: 'PILOTO-PRECIOS', name: 'Piloto — lista de precios', currencyCode: 'MXN', validFrom: now } });
  manifest.priceListIds.push(priceList.id);
  await prisma.priceListItem.createMany({ data: items.map((item, index) => ({ priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: BigInt(15_000 + index * 5_000), validFrom: now })) });

  const salesActor = (userId: string): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read', 'requests.claim', 'requests.assign', 'requests.status.update', 'messaging.send', 'quotes.create', 'quotes.read', 'quotes.send', 'quotes.apply_discount', 'quotes.pdf.read', 'quotes.pdf.generate', 'prices.read']), mfaVerified: true });

  async function seedRequest(label: string, projectType: string, location: string, description: string) {
    const request = await createQuoteRequest({
      idempotencyKey: `pilot-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Cliente piloto — ${label}`, email: `pilot-contacto-${label}@ocpool.test`, phone: '+52 667 000 0000' },
      detail: { projectType, location, description, consentAt: now },
    }, { prisma, now });
    manifest.requestIds.push(request.quoteRequestId);
    manifest.clientIds.push(request.clientId);
    manifest.contactIds.push(request.contactId);
    manifest.folios[label] = request.folio;
    return request;
  }

  console.log('R1 — pendiente propio de Ventas A (revisar + pedir información)…');
  const r1 = await seedRequest('r1-propio', 'Residencial', 'Culiacán', 'Alberca residencial, falta confirmar medidas exactas del patio.');
  await prisma.quoteRequest.update({ where: { id: r1.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesA.id } });

  console.log('R2 — sin asignar (visibilidad de "siguiente pendiente")…');
  const r2 = await seedRequest('r2-sin-asignar', 'Residencial', 'Mazatlán', 'Solicitud entrante todavía sin responsable asignado.');
  await prisma.quoteRequest.update({ where: { id: r2.quoteRequestId }, data: { status: 'RECIBIDA' } });

  console.log('R3 — Ventas B construye 3 y 10 conceptos + concepto especial…');
  const r3 = await seedRequest('r3-constructor', 'Comercial', 'Culiacán', 'Alberca de club deportivo, alcance por definir con el cliente en la sesión.');
  await prisma.quoteRequest.update({ where: { id: r3.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesB.id } });

  // R4 y R4b son independientes a propósito: las sesiones de ventas y gerencia
  // probablemente no ocurren en el mismo momento, así que ninguna tarea puede
  // depender de que la otra ya haya ocurrido en vivo.
  console.log('R4 — Ventas A pide una aprobación de descuento (acción en vivo, todavía sin solicitar)…');
  const r4 = await seedRequest('r4-aprobacion', 'Residencial', 'Culiacán', 'Cliente frecuente solicitó condición comercial preferente.');
  await prisma.quoteRequest.update({ where: { id: r4.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesA.id } });
  const r4Version = await createQuoteVersion(salesActor(salesA.id), { quoteRequestId: r4.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: items[0].id, quantity: '1', discountBasisPoints: 1500 }, { catalogItemId: items[1].id, quantity: '1', discountBasisPoints: 1500 }] }, { prisma, now });
  await transitionQuoteVersion(salesActor(salesA.id), r4Version.versionId, 'EN_REVISION', { prisma, now });

  console.log('R4b — aprobación ya solicitada, lista para que el Gerente la resuelva en vivo…');
  const r4b = await seedRequest('r4b-por-resolver', 'Residencial', 'Los Mochis', 'Otro cliente frecuente con condición comercial preferente, ya en espera de autorización.');
  await prisma.quoteRequest.update({ where: { id: r4b.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesB.id } });
  const r4bVersion = await createQuoteVersion(salesActor(salesB.id), { quoteRequestId: r4b.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: items[0].id, quantity: '1', discountBasisPoints: 1500 }, { catalogItemId: items[1].id, quantity: '1', discountBasisPoints: 1500 }] }, { prisma, now });
  await transitionQuoteVersion(salesActor(salesB.id), r4bVersion.versionId, 'EN_REVISION', { prisma, now });
  await requestQuoteApproval(salesActor(salesB.id), r4bVersion.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: 1000, reason: 'Condición comercial preferente por antigüedad del cliente.' }, { prisma, now });

  console.log('R5 — Ventas B publica una cotización lista (sin descuento)…');
  const r5 = await seedRequest('r5-publicar', 'Residencial', 'Culiacán', 'Cotización lista para enviar, el cliente ya confirmó el alcance por teléfono.');
  await prisma.quoteRequest.update({ where: { id: r5.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesB.id } });
  const r5Version = await createQuoteVersion(salesActor(salesB.id), { quoteRequestId: r5.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: items[2].id, quantity: '1' }, { catalogItemId: items[3].id, quantity: '1' }, { catalogItemId: items[4].id, quantity: '1' }] }, { prisma, now });
  await transitionQuoteVersion(salesActor(salesB.id), r5Version.versionId, 'EN_REVISION', { prisma, now });
  await generateQuotePdf(salesActor(salesB.id), r5Version.versionId, { prisma, now });

  console.log('R6 — entrega de notificación fallida + contacto con correo por corregir…');
  const r6 = await seedRequest('r6-notificacion', 'Residencial', 'Chihuahua', 'Expediente con un envío que falló y un correo de contacto que necesita corrección.');
  await prisma.quoteRequest.update({ where: { id: r6.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
  const r6Version = await createQuoteVersion(salesActor(salesA.id), { quoteRequestId: r6.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: items[5].id, quantity: '1' }] }, { prisma, now });
  await transitionQuoteVersion(salesActor(salesA.id), r6Version.versionId, 'EN_REVISION', { prisma, now });
  await publishQuoteVersion(salesActor(salesA.id), r6Version.versionId, {}, { prisma, now });
  const r6Event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: r6Version.quoteId, eventType: 'QUOTE.PUBLISHED' }, orderBy: { createdAt: 'desc' } });
  await fanOutOneEvent(prisma, r6Event.id, env.NOTIFICATION_LEASE_SECONDS, new Date());
  const r6Delivery = await prisma.notificationDelivery.findFirst({ where: { outboxEventId: r6Event.id }, orderBy: { createdAt: 'desc' } });
  if (r6Delivery) await prisma.notificationDelivery.update({ where: { id: r6Delivery.id }, data: { status: 'FAILED', attempts: 3, lastErrorCode: 'TEMPORARY_PROVIDER' } });
  else console.warn('  Aviso: no se encontró una entrega de notificación real para R6 -- la tarea de "envío fallido" no tendrá datos.');

  console.log('C1/C2/C3 — clientes con cotización enviada y enlace de acceso…');
  for (const [index, label] of ['c1', 'c2', 'c3'].entries()) {
    const request = await seedRequest(`${label}-cliente`, 'Residencial', ['Culiacán', 'Mazatlán', 'Los Mochis'][index], 'Cotización lista para revisión del cliente en la sesión de piloto.');
    await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: salesB.id } });
    const version = await createQuoteVersion(salesActor(salesB.id), { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: items[6 + index].id, quantity: '1' }, { catalogItemId: items[9].id, quantity: '2' }] }, { prisma, now });
    await transitionQuoteVersion(salesActor(salesB.id), version.versionId, 'EN_REVISION', { prisma, now });
    await publishQuoteVersion(salesActor(salesB.id), version.versionId, {}, { prisma, now });
    const customerEmail = `pilot-cliente-${label}@ocpool.test`;
    const customerUser = await prisma.user.create({ data: { email: customerEmail, emailNormalized: customerEmail, displayName: `Cliente piloto ${label.toUpperCase()}`, type: 'CUSTOMER', status: 'ACTIVE', clientId: request.clientId, roles: { create: { roleId: customerRole.id } } } });
    manifest.userIds.push(customerUser.id);
    // consumeCustomerMagicLink exige al menos 40 caracteres en el token crudo -- se usa el mismo
    // generador que un magic link real (aleatorio, no derivado de un patrón predecible).
    const rawToken = generateOpaqueToken();
    const token = await prisma.authToken.create({ data: { userId: customerUser.id, type: 'MAGIC_LINK', tokenHash: fingerprintToken(rawToken), expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) } });
    manifest.tokenIds.push(token.id);
    manifest.customers.push({ label: `Cliente ${label.toUpperCase()}`, magicLinkUrl: `${PORTAL_BASE_URL}/auth/customer/consume-link?token=${rawToken}`, folio: request.folio });
  }

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('\n=== Piloto listo ===\n');
  console.log('Cuentas staff (todas con la misma contraseña):');
  for (const staff of manifest.staff) {
    console.log(`  ${staff.role}: ${staff.email} / ${PILOT_PASSWORD}`);
    if (staff.note) console.log(`    ${staff.note}`);
  }
  console.log('\nEnlaces de cliente (un solo uso recomendado, válidos 14 días):');
  for (const customer of manifest.customers) {
    console.log(`  ${customer.label} (expediente ${customer.folio}):`);
    console.log(`    ${customer.magicLinkUrl}`);
  }
  console.log(`\nExpedientes de tareas staff: ${Object.entries(manifest.folios).filter(([label]) => !label.includes('cliente')).map(([label, folio]) => `${label}=${folio}`).join(', ')}`);
  console.log(`\nManifiesto guardado en ${MANIFEST_PATH} -- usar "npm run pilot:clean" para retirar todo al terminar.`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
