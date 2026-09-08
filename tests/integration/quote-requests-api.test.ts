import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { fingerprintToken } from '@/server/auth/crypto';
import { getPrisma } from '@/server/db/client';
import { readServerEnv } from '@/server/env';
import { POST } from '@/app/api/quote-requests/route';

describe('public quote request API', () => {
  const prisma = getPrisma();
  const createdFolios: string[] = [];

  const validBody = (suffix: string) => ({
    displayName: `API Client ${suffix}`,
    phone: '+52 667 000 2211',
    email: `api-${suffix}@example.test`,
    projectType: 'Alberca residencial',
    location: 'Culiacán, Sinaloa',
    description: 'Solicitud recibida desde el contrato público.',
    consent: true,
  });

  const request = (body: Record<string, unknown>, headers: Record<string, string> = {}) => new NextRequest(`${readServerEnv().APP_URL}/api/quote-requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: readServerEnv().APP_URL,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  it('rejects foreign origins, missing idempotency and missing consent safely', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const body = validBody(`reject-${Date.now()}`);
    const foreign = await POST(request(body, { origin: 'https://attacker.example', 'idempotency-key': 'api-reject-foreign-1234' }));
    expect(foreign.status).toBe(403);

    const missingKey = await POST(request(body));
    expect(missingKey.status).toBe(400);

    const missingConsent = await POST(request({ ...body, consent: false }, { 'idempotency-key': 'api-reject-consent-1234' }));
    expect(missingConsent.status).toBe(400);
  });

  it('persists a public request and returns only a replay-safe folio', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = validBody(suffix);
    const idempotencyKey = `api-create-${suffix}-1234`;
    const response = await POST(request(body, { 'idempotency-key': idempotencyKey }));
    const payload = await response.json() as { accepted?: boolean; folio?: string; requestId?: string; error?: unknown };

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({ accepted: true, folio: expect.stringMatching(/^OCQ-\d{4}-\d{6}$/) });
    expect(payload.requestId).toBeUndefined();
    expect(payload.error).toBeUndefined();
    createdFolios.push(payload.folio as string);

    const replay = await POST(request({ ...body, description: 'No debe crear otro expediente.' }, { 'idempotency-key': idempotencyKey }));
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toEqual(payload);

    const stored = await prisma.quoteRequest.findUnique({ where: { folio: payload.folio }, include: { detail: true, contact: true, client: true } });
    expect(stored).toMatchObject({ status: 'RECIBIDA', origin: 'PUBLIC_FORM', detail: { description: body.description }, contact: { emailNormalized: body.email } });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== '1') return;
    const requests = await prisma.quoteRequest.findMany({ where: { folio: { in: createdFolios } }, select: { id: true, clientId: true, contactId: true } });
    const requestIds = requests.map(({ id }) => id);
    const clientIds = requests.map(({ clientId }) => clientId);
    const emails = requests.length ? await prisma.clientContact.findMany({ where: { id: { in: requests.map(({ contactId }) => contactId) } }, select: { emailNormalized: true } }) : [];
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.clientContact.deleteMany({ where: { id: { in: requests.map(({ contactId }) => contactId) } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.authRateLimit.deleteMany({ where: { scope: 'quote-request-email', keyHash: { in: emails.map(({ emailNormalized }) => fingerprintToken(emailNormalized)) } } });
    await prisma.$disconnect();
  });
});
