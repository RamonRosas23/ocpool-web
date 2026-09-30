import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { listConversationMessages, sendStaffMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('customer read receipts', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  const readSignals: Array<{ r: string; v?: string }> = [];
  let listener: pg.Client | null = null;
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let staffId = '';
  let customerId = '';
  let staff: Actor;
  let customer: Actor;

  const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the signal.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    listener = new pg.Client({ connectionString: readServerEnv().DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => {
      const signal = message.payload ? JSON.parse(message.payload) as { t: string; r: string; v?: string; p?: string[] } : null;
      if (signal?.t === 'r' && signal.p?.includes('read')) readSignals.push(signal);
    });
    const [managerRole, customerRole] = await Promise.all(['manager', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    staffId = (await prisma.user.create({ data: { email: `rt-read-staff-${suffix}@example.test`, emailNormalized: `rt-read-staff-${suffix}@example.test`, displayName: 'RT Equipo', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `rt-read-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'RT Lectora', email: `rt-read-contact-${suffix}@example.test` }, detail: { projectType: 'Jacuzzi', location: 'Colima', description: 'Fixture de lectura del cliente', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `rt-read-customer-${suffix}@example.test`, emailNormalized: `rt-read-customer-${suffix}@example.test`, displayName: 'RT Lectora', type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
    staff = { userId: staffId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['manager']), mfaVerified: true };
    customer = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
  });

  afterAll(async () => {
    await listener?.end();
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [staffId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
  });

  it('records when the customer reads the thread and shows it to the team', async () => {
    const first = await sendStaffMessage(staff, requestId, { body: 'Tu propuesta está lista.', idempotencyKey: `rt-read-1-${suffix}` }, { prisma, rateLimit });
    expect(await listConversationMessages(staff, requestId, {}, { prisma })).toMatchObject({ customerRead: null });
    await listConversationMessages(customer, requestId, {}, { prisma });
    await waitFor(() => readSignals.some((signal) => signal.r === requestId));
    expect(readSignals.find((signal) => signal.r === requestId)).toMatchObject({ v: 'I' });
    const seen = await listConversationMessages(staff, requestId, {}, { prisma });
    expect(seen.customerRead?.through.toISOString()).toBe(new Date(first.createdAt).toISOString());
    // Volver a abrirlo sin mensajes nuevos no avisa de nuevo.
    await listConversationMessages(customer, requestId, {}, { prisma });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readSignals.filter((signal) => signal.r === requestId)).toHaveLength(1);
    // Un mensaje nuevo queda sin ver hasta que el cliente vuelve.
    const second = await sendStaffMessage(staff, requestId, { body: '¿La revisamos el jueves?', idempotencyKey: `rt-read-2-${suffix}` }, { prisma, rateLimit });
    const pending = await listConversationMessages(staff, requestId, {}, { prisma });
    expect(pending.customerRead!.through.getTime()).toBeLessThan(new Date(second.createdAt).getTime());
    // El cliente nunca ve la lectura del equipo ni la propia.
    expect(await listConversationMessages(customer, requestId, {}, { prisma })).not.toHaveProperty('customerRead');
  });

  it('returns a cursor that brings only what came after', async () => {
    const all = await listConversationMessages(staff, requestId, { limit: 100 }, { prisma });
    expect(all.latestCursor).toEqual(expect.any(String));
    const nothingNew = await listConversationMessages(staff, requestId, { cursor: all.latestCursor!, limit: 100 }, { prisma });
    expect(nothingNew.items).toEqual([]);
    expect(nothingNew.latestCursor).toBe(all.latestCursor);
    await sendStaffMessage(staff, requestId, { body: 'Uno más', idempotencyKey: `rt-read-3-${suffix}` }, { prisma, rateLimit });
    const newer = await listConversationMessages(staff, requestId, { cursor: all.latestCursor!, limit: 100 }, { prisma });
    expect(newer.items.map((item) => item.body)).toEqual(['Uno más']);
  });
});
