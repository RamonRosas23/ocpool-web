import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { applyInboxEffects, recordInboxIntents, resolveInboxGroups, type InboxIntent } from '@/server/modules/inbox/record';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('inbox recording', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const received: string[] = [];
  let listener: pg.Client;
  let recipientId = '';
  let otherRecipientId = '';

  const intent = (overrides: Partial<InboxIntent> = {}): InboxIntent => ({
    recipientId,
    kind: 'customer.activity',
    priority: 'HIGH',
    quoteRequestId: null,
    actorId: null,
    groupKey: `activity:record-${suffix}`,
    actionPath: '/staff/requests',
    actionRequired: false,
    data: { actorName: 'Laura Méndez', folio: 'OCQ-2026-000118', messages: 1, files: 0, preview: '“Hola”' },
    ...overrides,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    listener = new pg.Client({ connectionString: DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN ocpool_realtime');
    listener.on('notification', (message) => { if (message.payload) received.push(message.payload); });
    const [first, second] = await Promise.all([
      prisma.user.create({ data: { email: `inbox-record-a-${suffix}@example.test`, emailNormalized: `inbox-record-a-${suffix}@example.test`, displayName: 'Record A', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `inbox-record-b-${suffix}@example.test`, emailNormalized: `inbox-record-b-${suffix}@example.test`, displayName: 'Record B', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    recipientId = first.id;
    otherRecipientId = second.id;
  });

  afterAll(async () => {
    await listener?.end();
    await prisma.user.deleteMany({ where: { id: { in: [recipientId, otherRecipientId].filter(Boolean) } } });
  });

  it('writes nothing and signals nothing when the transaction rolls back', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await recordInboxIntents(tx, [intent()], new Date());
      throw new Error('rollback on purpose');
    })).rejects.toThrow('rollback on purpose');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received.filter((payload) => payload.includes(recipientId))).toHaveLength(0);
    expect(await prisma.inboxNotification.count({ where: { recipientId } })).toBe(0);
  });

  it('groups open activity, signals on commit and starts a new notification once read', async () => {
    const now = new Date();
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], now));
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent({ data: { actorName: 'Laura Méndez', folio: 'OCQ-2026-000118', messages: 0, files: 1, preview: 'Archivo: plano.pdf' } })], new Date(now.getTime() + 1000)));
    const [grouped] = await prisma.inboxNotification.findMany({ where: { recipientId } });
    expect(grouped).toMatchObject({ occurrences: 2, title: 'Laura Méndez subió un archivo y dejó un mensaje', body: 'Archivo: plano.pdf' });
    await waitFor(() => received.filter((payload) => payload.includes(grouped.id)).length >= 2);
    expect(received.map((payload) => JSON.parse(payload) as { m?: string }).filter((signal) => signal.m === 'updated').length).toBeGreaterThanOrEqual(1);

    await prisma.inboxNotification.update({ where: { id: grouped.id }, data: { readAt: new Date() } });
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], new Date(now.getTime() + 2000)));
    expect(await prisma.inboxNotification.count({ where: { recipientId } })).toBe(2);
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('serializes two concurrent transactions into one open notification', async () => {
    const now = new Date();
    await Promise.all([
      prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], now)),
      prisma.$transaction((tx) => recordInboxIntents(tx, [intent()], now)),
    ]);
    const rows = await prisma.inboxNotification.findMany({ where: { recipientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrences: 2, title: 'Laura Méndez te escribió 2 mensajes' });
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('keeps the highest priority when a rule targets the same person twice', async () => {
    await prisma.$transaction((tx) => recordInboxIntents(tx, [intent({ kind: 'quote.changes_requested', priority: 'NORMAL', groupKey: `changes:${suffix}` }), intent({ kind: 'quote.changes_requested', priority: 'URGENT', groupKey: `changes:${suffix}` })], new Date()));
    const rows = await prisma.inboxNotification.findMany({ where: { recipientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].priority).toBe('URGENT');
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('does not rewrite a pending-price notice when the same draft saves again', async () => {
    const pending = intent({ kind: 'price.pending', priority: 'NORMAL', groupKey: `price:list-${suffix}:item`, actionRequired: true, actionPath: '/staff/catalog?tab=pending-prices', data: { itemName: 'Bomba', priceListName: 'Lista MXN', requestIds: ['req-1'], requestFolios: ['OCQ-1'] } });
    const first = await prisma.$transaction((tx) => recordInboxIntents(tx, [pending], new Date()));
    const second = await prisma.$transaction((tx) => recordInboxIntents(tx, [pending], new Date()));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await prisma.inboxNotification.findFirst({ where: { recipientId } })).toMatchObject({ occurrences: 1 });
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });

  it('resolves a group for everyone and speaks to the actor in second person', async () => {
    const pool = (userId: string): InboxIntent => intent({ recipientId: userId, kind: 'request.new_unassigned', groupKey: `pool:${suffix}`, actionRequired: true, data: { folio: 'OCQ-1', projectType: 'Alberca', location: 'Monterrey' } });
    await prisma.$transaction((tx) => recordInboxIntents(tx, [pool(recipientId), pool(otherRecipientId)], new Date()));
    await prisma.$transaction((tx) => resolveInboxGroups(tx, [{ groupKey: `pool:${suffix}`, note: 'Tomada por Record A', actorId: recipientId, actorNote: 'La tomaste' }], new Date()));
    const rows = await prisma.inboxNotification.findMany({ where: { groupKey: `pool:${suffix}` } });
    expect(rows.find((row) => row.recipientId === recipientId)).toMatchObject({ resolvedNote: 'La tomaste' });
    expect(rows.find((row) => row.recipientId === otherRecipientId)).toMatchObject({ resolvedNote: 'Tomada por Record A' });
    expect(rows.every((row) => row.resolvedAt !== null)).toBe(true);
    await prisma.inboxNotification.deleteMany({ where: { groupKey: `pool:${suffix}` } });
  });

  it('applies resolutions before new intents', async () => {
    const now = new Date();
    await prisma.$transaction((tx) => applyInboxEffects(tx, { intents: [intent({ groupKey: `changes:order-${suffix}`, kind: 'quote.changes_requested' })], resolutions: [] }, now));
    await prisma.$transaction((tx) => applyInboxEffects(tx, { intents: [intent({ groupKey: `changes:order-${suffix}`, kind: 'quote.changes_requested' })], resolutions: [{ groupKey: `changes:order-${suffix}`, note: 'Se envió la propuesta V2' }] }, now));
    const rows = await prisma.inboxNotification.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.resolvedAt === null)).toHaveLength(1);
    await prisma.inboxNotification.deleteMany({ where: { recipientId } });
  });
});
