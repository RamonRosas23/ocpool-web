import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';

describe('quote request relational schema', () => {
  it('persists client contacts, request detail, initial history and unique folios', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const firstClient = await prisma.client.create({ data: { displayName: `Schema Client A ${suffix}` } });
    const secondClient = await prisma.client.create({ data: { displayName: `Schema Client B ${suffix}` } });
    const firstContact = await prisma.clientContact.create({
      data: {
        clientId: firstClient.id,
        displayName: 'Contacto de prueba',
        email: `schema-${suffix}@example.test`,
        emailNormalized: `schema-${suffix}@example.test`,
        phone: '+52 667 000 0000',
        isPrimary: true,
      },
    });
    const secondContact = await prisma.clientContact.create({
      data: {
        clientId: secondClient.id,
        displayName: 'Mismo correo en otro cliente',
        email: `schema-${suffix}@example.test`,
        emailNormalized: `schema-${suffix}@example.test`,
      },
    });

    const request = await prisma.quoteRequest.create({
      data: {
        folio: `OCQ-2026-${suffix.slice(-6)}`,
        origin: 'PUBLIC_FORM',
        clientId: firstClient.id,
        contactId: firstContact.id,
        detail: {
          create: {
            projectType: 'Alberca residencial',
            location: 'Culiacán, Sinaloa',
            description: 'Solicitud de prueba de schema',
            consentAt: new Date(),
          },
        },
        statusHistory: { create: { toStatus: 'RECIBIDA' } },
      },
      include: { detail: true, statusHistory: true },
    });

    expect(request.folio).toMatch(/^OCQ-2026-\d{6}$/);
    expect(request.status).toBe('RECIBIDA');
    expect(request.detail?.projectType).toBe('Alberca residencial');
    expect(request.statusHistory).toHaveLength(1);
    expect(firstContact.clientId).not.toBe(secondContact.clientId);

    await expect(prisma.quoteRequest.create({
      data: { folio: request.folio, origin: 'STAFF_CREATED', clientId: firstClient.id, contactId: firstContact.id },
    })).rejects.toThrow();

    await prisma.quoteRequest.delete({ where: { id: request.id } });
    await prisma.clientContact.deleteMany({ where: { id: { in: [firstContact.id, secondContact.id] } } });
    await prisma.client.deleteMany({ where: { id: { in: [firstClient.id, secondClient.id] } } });
  }, 15_000);
});
