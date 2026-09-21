import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { createQuoteVersion } from '@/server/modules/quotes/service';
import { listSpecialConcepts, promoteSpecialConcept } from '@/server/modules/special-concepts/service';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';

const actor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('special concept promotion service (K1-05 parte 2)', () => {
  it('groups special lines by normalized name+unit, requires catalog.manage, and rejects other permissions', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-04-01T12:00:00.000Z');
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.manage', 'quotes.create']);
    const sales = actor(manager.userId, ['catalog.read', 'quotes.create']);
    const user = await prisma.user.create({
      data: { email: `special-concepts-${suffix}@example.test`, emailNormalized: `special-concepts-${suffix}@example.test`, displayName: 'Special concepts employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    sales.userId = user.id;
    const priceList = await prisma.priceList.create({ data: { code: `SPECIAL-GROUP-${suffix}`, name: 'Special group prices', currencyCode: 'MXN', validFrom: now } });
    const requestIds: string[] = [];
    const clientIds: string[] = [];
    const quoteIds: string[] = [];

    try {
      await expect(listSpecialConcepts(sales, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const namesToCreate = [
        { name: 'Ajuste de Terreno', unit: 'servicio' },
        { name: '  ajuste   DE terreno  ', unit: ' Servicio ' },
      ];
      for (const line of namesToCreate) {
        const request = await createQuoteRequest({
          idempotencyKey: `special-group-${suffix}-${requestIds.length}`,
          origin: 'STAFF_CREATED',
          contact: { displayName: `Special group ${suffix}-${requestIds.length}`, email: `special-group-${suffix}-${requestIds.length}@example.test` },
          detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special concept grouping fixture', consentAt: now },
        }, { prisma, now });
        requestIds.push(request.quoteRequestId);
        clientIds.push(request.clientId);
        await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
        const version = await createQuoteVersion(manager, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ special: true, name: line.name, unit: line.unit, quantity: '1', unitPriceMinor: '5000', reason: 'Fixture de agrupación' }],
        }, { prisma, now });
        quoteIds.push(version.quoteId);
      }

      const groups = await listSpecialConcepts(manager, { prisma });
      const group = groups.find((candidate) => candidate.normalizedName === 'ajuste de terreno');
      expect(group).toBeTruthy();
      expect(group!.occurrences).toBe(2);
      expect(group!.status).toBe('PENDING');
      expect(group!.matchingCatalogItem).toBeNull();
      expect(group!.recentFolios).toHaveLength(2);
    } finally {
      for (const quoteId of quoteIds) {
        const versionIds = (await prisma.quoteVersion.findMany({ where: { quoteId }, select: { id: true } })).map(({ id }) => id);
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: quoteId } });
        await prisma.auditLog.deleteMany({ where: { entityId: { in: [quoteId, ...versionIds] } } });
      }
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      for (const requestId of requestIds) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
        await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      }
      const contactIds = requestIds.length ? (await prisma.quoteRequest.findMany({ where: { id: { in: requestIds } }, select: { contactId: true } })).map(({ contactId }) => contactId) : [];
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('H1-05: counts every occurrence correctly and caps only recentFolios, never occurrences, beyond the display limit', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-04-01T12:00:00.000Z');
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.manage', 'quotes.create']);
    const user = await prisma.user.create({
      data: { email: `special-scale-${suffix}@example.test`, emailNormalized: `special-scale-${suffix}@example.test`, displayName: 'Special scale employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    const priceList = await prisma.priceList.create({ data: { code: `SPECIAL-SCALE-${suffix}`, name: 'Special scale prices', currencyCode: 'MXN', validFrom: now } });
    const requestIds: string[] = [];
    const clientIds: string[] = [];
    const quoteIds: string[] = [];

    // Un `take` ingenuo sobre las líneas crudas (ordenadas por antigüedad, como hacía la versión
    // anterior) habría cortado antes de llegar a estas 7 ocurrencias reales si hubiera suficiente
    // volumen ajeno por delante en la tabla -- este caso prueba que el conteo real (7) y el límite
    // de folios recientes (5) son cosas distintas, y que ninguna se trunca en silencio.
    for (let index = 0; index < 7; index += 1) {
      const request = await createQuoteRequest({
        idempotencyKey: `special-scale-${suffix}-${index}`,
        origin: 'STAFF_CREATED',
        contact: { displayName: `Special scale ${suffix}-${index}`, email: `special-scale-${suffix}-${index}@example.test` },
        detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special concept scale fixture', consentAt: new Date(now.getTime() + index * 1000) },
      }, { prisma, now: new Date(now.getTime() + index * 1000) });
      requestIds.push(request.quoteRequestId);
      clientIds.push(request.clientId);
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const version = await createQuoteVersion(manager, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ special: true, name: 'Reparación de domo geodésico', unit: 'servicio', quantity: '1', unitPriceMinor: '5000', reason: 'Fixture de escala' }],
      }, { prisma, now: new Date(now.getTime() + index * 1000) });
      quoteIds.push(version.quoteId);
    }
    // Un segundo grupo, con un solo integrante, para probar que agrupar por separado no oculta
    // ni mezcla al primero -- ambos deben aparecer completos en el mismo resultado.
    const otherRequest = await createQuoteRequest({
      idempotencyKey: `special-scale-other-${suffix}`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Special scale other ${suffix}`, email: `special-scale-other-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special concept scale fixture (other group)', consentAt: now },
    }, { prisma, now });
    requestIds.push(otherRequest.quoteRequestId);
    clientIds.push(otherRequest.clientId);
    await prisma.quoteRequest.update({ where: { id: otherRequest.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
    const otherVersion = await createQuoteVersion(manager, {
      quoteRequestId: otherRequest.quoteRequestId,
      priceListId: priceList.id,
      lines: [{ special: true, name: 'Instalación de tobogán a medida', unit: 'servicio', quantity: '1', unitPriceMinor: '5000', reason: 'Fixture de escala' }],
    }, { prisma, now });
    quoteIds.push(otherVersion.quoteId);

    try {
      const groups = await listSpecialConcepts(manager, { prisma });
      const mainGroup = groups.find((candidate) => candidate.normalizedName === 'reparación de domo geodésico');
      const otherGroup = groups.find((candidate) => candidate.normalizedName === 'instalación de tobogán a medida');
      expect(mainGroup).toBeTruthy();
      expect(mainGroup!.occurrences).toBe(7);
      expect(mainGroup!.recentFolios).toHaveLength(5);
      expect(new Set(mainGroup!.recentFolios).size).toBe(5);
      expect(otherGroup).toBeTruthy();
      expect(otherGroup!.occurrences).toBe(1);
      expect(otherGroup!.recentFolios).toHaveLength(1);
    } finally {
      for (const quoteId of quoteIds) {
        const versionIds = (await prisma.quoteVersion.findMany({ where: { quoteId }, select: { id: true } })).map(({ id }) => id);
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: quoteId } });
        await prisma.auditLog.deleteMany({ where: { entityId: { in: [quoteId, ...versionIds] } } });
      }
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      for (const requestId of requestIds) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: requestId } });
        await prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      }
      const contactIds = requestIds.length ? (await prisma.quoteRequest.findMany({ where: { id: { in: requestIds } }, select: { contactId: true } })).map(({ contactId }) => contactId) : [];
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);

  it('promotes a special concept idempotently and dedupes against an existing catalog item (K1-05 parte 2)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const manager = actor(`00000000-0000-4000-8000-${suffix.slice(-12).padStart(12, '0')}`, ['catalog.manage']);
    const user = await prisma.user.create({
      data: { email: `special-promote-${suffix}@example.test`, emailNormalized: `special-promote-${suffix}@example.test`, displayName: 'Special promote employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    manager.userId = user.id;
    let firstPromotedItemId = '';
    let preexistingItemId = '';

    try {
      const first = await promoteSpecialConcept(manager, { name: `Concepto promovido ${suffix}`, unit: 'servicio' }, { prisma });
      expect(first.alreadyPromoted).toBe(false);
      expect(first.catalogItem.code).toMatch(/^ITEM-\d{6}$/);
      firstPromotedItemId = first.catalogItem.id;
      expect(await prisma.specialConceptPromotion.count({ where: { catalogItemId: first.catalogItem.id } })).toBe(1);

      const second = await promoteSpecialConcept(manager, { name: `  CONCEPTO   Promovido ${suffix}  `, unit: ' SERVICIO ' }, { prisma });
      expect(second.alreadyPromoted).toBe(true);
      expect(second.catalogItem.id).toBe(first.catalogItem.id);
      expect(await prisma.catalogItem.count({ where: { name: { contains: suffix } } })).toBe(1);
      expect(await prisma.specialConceptPromotion.count()).toBe(1);

      const category = await prisma.catalogCategory.create({ data: { code: `SPECIAL-PREEXIST-CAT-${suffix}`, name: 'Special preexisting category' } });
      const preexisting = await prisma.catalogItem.create({ data: { code: `SPECIAL-PREEXIST-${suffix}`, name: `Concepto Preexistente ${suffix}`, unit: 'pieza', categoryId: category.id } });
      preexistingItemId = preexisting.id;

      const linked = await promoteSpecialConcept(manager, { name: `concepto preexistente ${suffix}`, unit: 'pieza' }, { prisma });
      expect(linked.alreadyPromoted).toBe(false);
      expect(linked.catalogItem.id).toBe(preexisting.id);
      expect(await prisma.catalogItem.count({ where: { id: preexisting.id } })).toBe(1);
      expect(await prisma.specialConceptPromotion.count({ where: { catalogItemId: preexisting.id } })).toBe(1);

      await prisma.catalogCategory.delete({ where: { id: category.id } });
    } finally {
      await prisma.specialConceptPromotion.deleteMany({ where: { catalogItemId: { in: [firstPromotedItemId, preexistingItemId].filter(Boolean) } } });
      if (firstPromotedItemId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: firstPromotedItemId } });
        await prisma.auditLog.deleteMany({ where: { entityId: firstPromotedItemId } });
        await prisma.catalogItem.delete({ where: { id: firstPromotedItemId } });
      }
      if (preexistingItemId) {
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: preexistingItemId } });
        await prisma.auditLog.deleteMany({ where: { entityId: preexistingItemId } });
        await prisma.catalogItem.delete({ where: { id: preexistingItemId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30_000);
});
