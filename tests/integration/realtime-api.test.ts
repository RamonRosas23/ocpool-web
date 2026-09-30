import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityCatalog } from '../../prisma/seed';
import { GET as realtimeGet } from '@/app/api/realtime/route';
import { createSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { recordInboxIntents } from '@/server/modules/inbox/record';
import { markInboxRead } from '@/server/modules/inbox/service';
import { publishSessionsClosed } from '@/server/realtime/publish';
import { shutdownRealtimeForTests } from '@/server/realtime/runtime';

type SseEvent = { event: string; id?: string; data: Record<string, unknown> };

function sseReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const queue: SseEvent[] = [];
  let buffer = '';
  let ended = false;
  let pending: Promise<void> | null = null;
  const pump = () => (pending ??= reader.read().then((chunk) => {
    pending = null;
    if (chunk.done) {
      ended = true;
      return;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event: Partial<SseEvent> = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event.event = line.slice(7);
        else if (line.startsWith('id: ')) event.id = line.slice(4);
        else if (line.startsWith('data: ')) event.data = JSON.parse(line.slice(6)) as Record<string, unknown>;
      }
      if (event.event) queue.push(event as SseEvent);
      index = buffer.indexOf('\n\n');
    }
  }, () => {
    pending = null;
    ended = true;
  }));
  const wait = () => Promise.race([pump(), new Promise((resolve) => setTimeout(resolve, 100))]);
  return {
    async next(name: string, match: (event: SseEvent) => boolean = () => true, timeoutMs = 5000): Promise<SseEvent> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = queue.findIndex((event) => event.event === name && match(event));
        if (index >= 0) return queue.splice(index, 1)[0];
        if (ended) throw new Error(`The stream ended before "${name}".`);
        if (Date.now() > deadline) throw new Error(`Timed out waiting for "${name}".`);
        await wait();
      }
    },
    async ended(timeoutMs = 3000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (!ended && Date.now() < deadline) await wait();
      return ended;
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

describe('realtime API', () => {
  const prisma = getPrisma();
  const suffix = Date.now().toString();
  const appUrl = readServerEnv().APP_URL;
  const aborts: AbortController[] = [];
  let userId = '';
  let token = '';
  let sessionId = '';
  let actor: Actor;

  const open = (headers: Record<string, string> = {}) => {
    const abort = new AbortController();
    aborts.push(abort);
    return realtimeGet(new NextRequest(`${appUrl}/api/realtime`, { headers: { cookie: `ocpool_session=${token}`, ...headers }, signal: abort.signal }));
  };
  const notice = (fromName: string) => prisma.$transaction((tx) => recordInboxIntents(tx, [{ recipientId: userId, kind: 'team.work_reassigned', priority: 'HIGH', quoteRequestId: null, actorId: null, groupKey: null, actionPath: '/staff/requests', actionRequired: false, data: { fromName, requestsCount: 1 } }], new Date()));

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    await seedIdentityCatalog(prisma);
    const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: 'sales' } });
    userId = (await prisma.user.create({ data: { email: `rt-api-${suffix}@example.test`, emailNormalized: `rt-api-${suffix}@example.test`, displayName: 'RT Api', type: 'EMPLOYEE', status: 'ACTIVE', roles: { create: { roleId: salesRole.id } } } })).id;
    actor = { userId, type: 'EMPLOYEE', clientId: null, permissionKeys: new Set(['requests.read']), mfaVerified: true };
    token = `rt-api-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
    ({ sessionId } = await createSession({ userId, ipAddress: null, userAgent: 'realtime-api' }, { prisma, tokenGenerator: () => token }));
  });

  afterAll(async () => {
    for (const abort of aborts) abort.abort();
    await shutdownRealtimeForTests();
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rejects anonymous connections and honours the kill switch', async () => {
    expect((await realtimeGet(new NextRequest(`${appUrl}/api/realtime`))).status).toBe(401);
    const previous = process.env.REALTIME_ENABLED;
    process.env.REALTIME_ENABLED = 'false';
    try {
      const response = await open();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ mode: 'polling' });
    } finally {
      if (previous === undefined) delete process.env.REALTIME_ENABLED;
      else process.env.REALTIME_ENABLED = previous;
    }
  });

  it('streams hello, then each notice and the counts as soon as they commit', async () => {
    const response = await open();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const events = sseReader(response);
    expect((await events.next('hello')).data).toMatchObject({ unread: 0, actionRequired: 0 });
    const [recorded] = await notice(`Carlos ${suffix}`);
    const arrived = await events.next('notification');
    expect(arrived.id).toMatch(new RegExp(`^\\d+-${recorded.id}$`));
    expect(arrived.data).toMatchObject({ mode: 'created', unread: 1, actionRequired: 0, requestUnread: null, notification: { id: recorded.id, title: expect.stringContaining(`Carlos ${suffix}`) } });
    await markInboxRead(actor, { all: true }, { prisma });
    expect((await events.next('counts')).data).toEqual({ unread: 0, actionRequired: 0 });
    await events.cancel();
  });

  it('replays what changed while disconnected after Last-Event-ID', async () => {
    const [before] = await notice(`Antes ${suffix}`);
    const row = await prisma.inboxNotification.findUniqueOrThrow({ where: { id: before.id } });
    const [missed] = await notice(`Mientras ${suffix}`);
    const events = sseReader(await open({ 'last-event-id': `${row.updatedAt.getTime()}-${row.id}` }));
    await events.next('hello');
    const replayed = await events.next('notification', (event) => (event.data.notification as { id?: string } | undefined)?.id === missed.id);
    expect(replayed.data).toMatchObject({ notification: { title: expect.stringContaining(`Mientras ${suffix}`) } });
    await events.cancel();
  });

  it('streams request changes to whoever can open the file', async () => {
    const events = sseReader(await open());
    await events.next('hello');
    // Solicitud propia, creada por el equipo y sin responsable: no avisa al pool y se borra al terminar.
    const { createQuoteRequest } = await import('@/server/modules/quote-requests/service');
    const request = await createQuoteRequest({ idempotencyKey: `rt-api-request-${suffix}`, origin: 'STAFF_CREATED', contact: { displayName: 'RT Api Cliente', email: `rt-api-contact-${suffix}@example.test` }, detail: { projectType: 'Alberca', location: 'Durango', description: 'Fixture del evento request', consentAt: new Date() } }, { prisma });
    try {
      expect((await events.next('request', (event) => event.data.requestId === request.quoteRequestId)).data).toMatchObject({ parts: ['created'], self: false });
    } finally {
      await events.cancel();
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: request.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: request.quoteRequestId } });
      await prisma.quoteRequest.deleteMany({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.deleteMany({ where: { id: request.contactId } });
      await prisma.client.deleteMany({ where: { id: request.clientId } });
    }
  }, 10_000);

  it('says bye and ends the stream when the session is revoked', async () => {
    const events = sseReader(await open());
    await events.next('hello');
    await publishSessionsClosed(prisma, { userId, sessionId });
    expect((await events.next('bye')).data).toEqual({ reason: 'session' });
    expect(await events.ended()).toBe(true);
  });
});
