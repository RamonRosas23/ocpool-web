import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { signalRequestChange } from '@/server/modules/inbox/domain-events';
import { createInternalNote, sendCustomerMessage } from '@/server/modules/messaging/service';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { assignQuoteRequest, updateStaffQuoteRequest } from '@/server/modules/quote-requests/staff-service';

type Signal = { t: string; r?: string; c?: string; a?: string | null; pa?: string; b?: string; p?: string[]; v?: string };

describe('request signals on commit', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const now = new Date();
  const received: Signal[] = [];
  const rateLimit = async () => ({ allowed: true, remaining: 20, retryAfterSeconds: null });
  let listener: pg.Client | null = null;
  let requestId = '';
  let clientId = '';
  let contactId = '';
  let managerId = '';
  let salesId = '';
  let customerId = '';

  const forRequest = () => received.filter((signal) => signal.t === 'r' && signal.r === requestId);
  const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the signal.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const actorFor = (userId: string, role: 'manager' | 'sales'): Actor => ({ userId, type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles([role]), mfaVerified: true });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    listener = new pg.Client({ connectionString: readServerEnv().DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => {
      if (message.payload) received.push(JSON.parse(message.payload) as Signal);
    });
    const [managerRole, salesRole, customerRole] = await Promise.all(['manager', 'sales', 'customer'].map((key) => prisma.role.findUniqueOrThrow({ where: { key } })));
    managerId = (await prisma.user.create({ data: { email: `rt-signals-manager-${suffix}@example.test`, emailNormalized: `rt-signals-manager-${suffix}@example.test`, displayName: 'RT Gerencia', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: managerRole.id } } } })).id;
    salesId = (await prisma.user.create({ data: { email: `rt-signals-sales-${suffix}@example.test`, emailNormalized: `rt-signals-sales-${suffix}@example.test`, displayName: 'RT Ventas', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    const request = await createQuoteRequest({ idempotencyKey: `rt-signals-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'RT Cliente', email: `rt-signals-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Tepic', description: 'Fixture de señales de expediente', consentAt: now } }, { prisma, now });
    requestId = request.quoteRequestId;
    clientId = request.clientId;
    contactId = request.contactId;
    customerId = (await prisma.user.create({ data: { email: `rt-signals-customer-${suffix}@example.test`, emailNormalized: `rt-signals-customer-${suffix}@example.test`, displayName: 'RT Cliente', type: 'CUSTOMER', status: 'ACTIVE', clientId, roles: { create: { roleId: customerRole.id } } } })).id;
    await prisma.clientContact.update({ where: { id: contactId }, data: { userId: customerId } });
  });

  afterAll(async () => {
    await listener?.end();
    const conversations = await prisma.conversation.findMany({ where: { quoteRequestId: requestId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [requestId, ...conversations.map(({ id }) => id)] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { actorUserId: { in: [managerId, salesId, customerId] } }] } });
    await prisma.conversation.deleteMany({ where: { quoteRequestId: requestId } });
    await prisma.quoteRequest.deleteMany({ where: { id: requestId } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: { in: [managerId, salesId, customerId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
  });

  it('announces the new request, then its assignment with the previous owner', async () => {
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('created')));
    expect(forRequest().find((signal) => signal.p?.includes('created'))).toMatchObject({ c: clientId, a: null, v: 'C' });
    await assignQuoteRequest(actorFor(managerId, 'manager'), requestId, { assignedToId: salesId }, { prisma });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('assignment')));
    expect(forRequest().find((signal) => signal.p?.includes('assignment'))).toMatchObject({ a: salesId, b: managerId, v: 'I' });
    await assignQuoteRequest(actorFor(managerId, 'manager'), requestId, { assignedToId: managerId, reason: 'Cambio de responsable de prueba' }, { prisma });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('assignment') && signal.pa === salesId && signal.a === managerId));
  });

  it('marks customer messages as visible to the customer and internal notes as internal', async () => {
    const customer: Actor = { userId: customerId, type: 'CUSTOMER', clientId, permissionKeys: new Set(['messaging.read', 'messaging.send']), mfaVerified: false };
    await sendCustomerMessage(customer, requestId, { body: 'Hola equipo', idempotencyKey: `rt-signals-c-${suffix}` }, { prisma, rateLimit });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('messages') && signal.v === 'C' && signal.b === customerId));
    await createInternalNote(actorFor(managerId, 'manager'), requestId, { body: 'Nota del equipo', idempotencyKey: `rt-signals-n-${suffix}` }, { prisma, rateLimit });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('messages') && signal.v === 'I'));
  });

  it('announces edits to the request details', async () => {
    await updateStaffQuoteRequest(actorFor(managerId, 'manager'), requestId, { detail: { location: 'Tepic, Nayarit' } }, { prisma });
    await waitFor(() => forRequest().some((signal) => signal.p?.includes('status') && signal.b === managerId && signal.v === 'C'));
  });

  it('sends nothing when the transaction rolls back', async () => {
    const before = forRequest().length;
    await expect(prisma.$transaction(async (tx) => {
      await signalRequestChange(tx, { requestId, parts: ['files'], visibility: 'C' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(forRequest()).toHaveLength(before);
  });
});
