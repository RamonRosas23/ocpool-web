import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';

describe('quote request transactional service', () => {
  it('creates the commercial aggregate, history, audit and outbox atomically', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-01-04T12:00:00.000Z');
    const input = {
      idempotencyKey: `service-${suffix}-one`,
      origin: 'PUBLIC_FORM' as const,
      contact: { displayName: 'Cliente de servicio', email: `service-${suffix}@example.test`, phone: '+52 667 000 1111' },
      detail: {
        projectType: 'Alberca residencial',
        location: 'Mazatlán, Sinaloa',
        projectStage: 'SITE_READY' as const,
        dimensions: '8 x 4 m',
        timeline: 'ONE_TO_THREE_MONTHS' as const,
        budgetRange: 'FROM_250K_TO_500K' as const,
        description: 'Solicitud transaccional',
        consentAt: now,
      },
    };

    const result = await createQuoteRequest(input, { prisma, now });
    const stored = await prisma.quoteRequest.findUnique({ where: { id: result.quoteRequestId }, include: { detail: true, statusHistory: true, client: true, contact: true } });
    const outbox = await prisma.outboxEvent.findFirst({ where: { aggregateId: result.quoteRequestId, eventType: 'REQUEST.RECEIVED' } });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: result.quoteRequestId, action: 'quote_request.created' } });

    expect(result.folio).toMatch(/^OCQ-2026-\d{6}$/);
    expect(stored).toMatchObject({ id: result.quoteRequestId, folio: result.folio, status: 'RECIBIDA', origin: 'PUBLIC_FORM' });
    expect(stored?.detail?.description).toBe('Solicitud transaccional');
    expect(stored?.detail?.projectStage).toBe('SITE_READY');
    expect(stored?.detail?.dimensions).toBe('8 x 4 m');
    expect(stored?.detail?.timeline).toBe('ONE_TO_THREE_MONTHS');
    expect(stored?.detail?.budgetRange).toBe('FROM_250K_TO_500K');
    expect(stored?.statusHistory).toHaveLength(1);
    expect(outbox?.payload).toMatchObject({ folio: result.folio, quoteRequestId: result.quoteRequestId });
    expect(JSON.stringify(outbox?.payload)).not.toContain(input.contact.email);
    expect(audit?.metadata).toMatchObject({ folio: result.folio });

    await prisma.outboxEvent.deleteMany({ where: { aggregateId: result.quoteRequestId } });
    await prisma.auditLog.deleteMany({ where: { entityId: result.quoteRequestId } });
    await prisma.quoteRequest.delete({ where: { id: result.quoteRequestId } });
    await prisma.clientContact.delete({ where: { id: result.contactId } });
    await prisma.client.delete({ where: { id: result.clientId } });
  }, 15_000);

  it('allocates unique folios under concurrent requests and replays idempotently', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-01-04T12:05:00.000Z');
    const input = (key: string, email: string) => ({
      idempotencyKey: key,
      origin: 'PUBLIC_FORM' as const,
      contact: { displayName: `Concurrent ${key}`, email },
      detail: { projectType: 'Hotel', location: 'Nayarit', description: 'Concurrent request', consentAt: now },
    });

    const [first, second] = await Promise.all([
      createQuoteRequest(input(`service-${suffix}-a`, `service-a-${suffix}@example.test`), { prisma, now }),
      createQuoteRequest(input(`service-${suffix}-b`, `service-b-${suffix}@example.test`), { prisma, now }),
    ]);
    const replay = await createQuoteRequest(input(`service-${suffix}-a`, `service-a-${suffix}@example.test`), { prisma, now: new Date(now.getTime() + 1_000) });

    expect(new Set([first.folio, second.folio]).size).toBe(2);
    expect(replay).toEqual(first);
    expect(await prisma.quoteRequest.count({ where: { idempotencyKeyHash: { not: null } } })).toBeGreaterThanOrEqual(2);

    const requestIds = [first.quoteRequestId, second.quoteRequestId];
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    const contacts = await prisma.clientContact.findMany({ where: { emailNormalized: { in: [`service-a-${suffix}@example.test`, `service-b-${suffix}@example.test`] } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: contacts.map(({ id }) => id) } } });
    await prisma.client.deleteMany({ where: { id: { in: contacts.map(({ clientId }) => clientId) } } });
  }, 20_000);

  it('H1-02: rejects a replayed idempotency key whose detail payload actually differs', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-01-04T12:10:00.000Z');
    const key = `service-${suffix}-mismatch`;
    const email = `service-mismatch-${suffix}@example.test`;
    const baseInput = {
      idempotencyKey: key,
      origin: 'PUBLIC_FORM' as const,
      contact: { displayName: 'Cliente idempotencia', email },
      detail: { projectType: 'Alberca residencial', location: 'Culiacán', description: 'Solicitud original', consentAt: now },
    };

    const first = await createQuoteRequest(baseInput, { prisma, now });
    try {
      // Misma llave, mismo cuerpo real: sigue siendo un reintento legítimo, no un conflicto.
      const sameReplay = await createQuoteRequest(baseInput, { prisma, now });
      expect(sameReplay).toEqual(first);

      // Misma llave, descripción distinta: nunca debe regresar en silencio la solicitud original.
      await expect(createQuoteRequest({ ...baseInput, detail: { ...baseInput.detail, description: 'Solicitud alterada' } }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      // Misma llave, ubicación distinta: cualquier campo del detalle cuenta, no sólo la descripción.
      await expect(createQuoteRequest({ ...baseInput, detail: { ...baseInput.detail, location: 'Mazatlán' } }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(await prisma.quoteRequest.count({ where: { idempotencyKeyHash: { not: null }, contactId: first.contactId } })).toBe(1);
    } finally {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: first.quoteRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: first.quoteRequestId } });
      await prisma.quoteRequest.delete({ where: { id: first.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: first.contactId } });
      await prisma.client.delete({ where: { id: first.clientId } });
    }
  }, 15_000);
});
