import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createQuoteRequest } from '@/server/modules/quote-requests/service';
import { clonePublishedVersion, createQuoteVersion, listReadyToPublishForActor, publishQuoteVersion, rejectQuoteVersion, replaceQuoteDraft, returnQuoteToDraft, submitQuoteForReview, transitionQuoteVersion } from '@/server/modules/quotes/service';
import { decideQuoteApproval, listPendingQuoteApprovalsForActor, listPendingQuoteApprovalsPageForActor, listQuoteApprovals, requestQuoteApproval } from '@/server/modules/quotes/approval-service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';
import { getQuoteDocumentStatusForVersion } from '@/server/modules/quote-documents/access-service';
import { getQuoteWorkspace } from '@/server/modules/quotes/staff-service';
import { listPendingPriceRequests } from '@/server/modules/catalog/service';
import type { QuotePdfSnapshot, RenderedQuotePdf } from '@/server/modules/quote-documents/pdf-renderer';
import { getPrisma } from '@/server/db/client';
import type { Actor } from '@/server/auth/types';

const salesActor = (userId: string, permissions: string[]): Actor => ({
  userId,
  type: 'EMPLOYEE',
  clientId: null,
  permissionKeys: new Set(permissions),
  mfaVerified: true,
});

describe('quote pricing and versioning service', () => {
  it('resolves the active price and preserves a historical snapshot after catalog changes', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-10T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-snapshot`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote service ${suffix}`, email: `quote-service-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Quote service fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-service-employee-${suffix}@example.test`,
        emailNormalized: `quote-service-employee-${suffix}@example.test`,
        displayName: 'Quote service employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `QUOTE-${suffix}`, name: 'Quote service' } });
    const item = await prisma.catalogItem.create({ data: { code: `QUOTE-ITEM-${suffix}`, name: 'Quote service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `QUOTE-PRICE-${suffix}`, name: 'Quote service prices', currencyCode: 'MXN', validFrom: now } });
    const price = await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const actor = salesActor(employee.id, ['quotes.create', 'prices.read']);
      const created = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', taxBasisPoints: 1600 }],
        expectedCurrentVersionNumber: null,
      }, { prisma, now });
      quoteId = created.quoteId;

      expect(created.versionNumber).toBe(1);
      expect(created.totalMinor).toBe(23200n);
      const lineBeforeChange = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId } });
      expect(lineBeforeChange).toMatchObject({ catalogItemId: item.id, unitPriceMinor: 10000n, subtotalMinor: 20000n, totalMinor: 23200n });

      await prisma.priceListItem.update({ where: { id: price.id }, data: { unitPriceMinor: 12000n } });
      const lineAfterChange = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId } });
      expect(lineAfterChange).toMatchObject({ unitPriceMinor: 10000n, subtotalMinor: 20000n, totalMinor: 23200n });
      expect(await prisma.auditLog.count({ where: { entityId: created.versionId, action: 'quote.version.created' } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_CREATED' } })).toBe(1);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('quotes a catalog concept that has no price in the list at a manual price, for that quote only', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-manual`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote manual ${suffix}`, email: `quote-manual-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Manual price fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-manual-employee-${suffix}@example.test`, emailNormalized: `quote-manual-employee-${suffix}@example.test`, displayName: 'Quote manual employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `MANUAL-${suffix}`, name: 'Manual price' } });
    const listed = await prisma.catalogItem.create({ data: { code: `MANUAL-LISTED-${suffix}`, name: 'Con precio', unit: 'pieza', categoryId: category.id } });
    const unpriced = await prisma.catalogItem.create({ data: { code: `MANUAL-UNPRICED-${suffix}`, name: 'Sin precio', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `MANUAL-PRICE-${suffix}`, name: 'Manual price list', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: listed.id, unitPriceMinor: 10_000n, validFrom: now } });
    const otherList = await prisma.priceList.create({ data: { code: `MANUAL-OTHER-${suffix}`, name: 'Manual other list', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: otherList.id, catalogItemId: listed.id, unitPriceMinor: 11_000n, validFrom: now } });
    let quoteId: string | null = null;
    const seller = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read', 'quotes.edit_prices']);
    const reader = salesActor(employee.id, ['quotes.read', 'quotes.create', 'prices.read']);
    const buildOnly = salesActor(employee.id, ['quotes.create', 'prices.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const base = { quoteRequestId: request.quoteRequestId, priceListId: priceList.id };

      // Sin precio ni motivo, el concepto sigue sin poder cotizarse.
      await expect(createQuoteVersion(seller, { ...base, lines: [{ catalogItemId: unpriced.id, quantity: '1' }] }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(createQuoteVersion(seller, { ...base, lines: [{ catalogItemId: unpriced.id, quantity: '1', unitPriceMinorOverride: '25000' }] }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      // Fijar un precio fuera de lista exige quotes.edit_prices.
      await expect(createQuoteVersion(buildOnly, { ...base, lines: [{ catalogItemId: unpriced.id, quantity: '1', unitPriceMinorOverride: '25000', manualPriceReason: 'Cotizado por proveedor' }] }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const lines = [
        { catalogItemId: listed.id, quantity: '1' },
        { catalogItemId: unpriced.id, quantity: '2', unitPriceMinorOverride: '25000', manualPriceReason: 'Cotizado por proveedor' },
      ];
      const created = await createQuoteVersion(seller, { ...base, lines }, { prisma, now });
      quoteId = created.quoteId;
      expect(created.totalMinor).toBe(60_000n);
      const manualLine = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId, catalogItemId: unpriced.id } });
      expect(manualLine).toMatchObject({ unitPriceMinor: 25_000n, baseUnitPriceMinor: null, overrideReason: 'Cotizado por proveedor', catalogItemCode: unpriced.code });
      const listedLine = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId, catalogItemId: listed.id } });
      expect(listedLine).toMatchObject({ unitPriceMinor: 10_000n, overrideReason: null });
      // La lista de precios no se modificó.
      expect(await prisma.priceListItem.count({ where: { priceListId: priceList.id, catalogItemId: unpriced.id } })).toBe(0);

      // El espacio de trabajo expone la marca y no restringe las listas por el concepto de precio manual.
      const workspace = await getQuoteWorkspace(reader, request.quoteRequestId, { prisma });
      const workspaceLines = workspace.quote?.currentVersion?.lines ?? [];
      expect(workspaceLines.find((line) => line.catalogItemId === unpriced.id)).toMatchObject({ manualPriceReason: 'Cotizado por proveedor' });
      expect(workspaceLines.find((line) => line.catalogItemId === listed.id)).toMatchObject({ manualPriceReason: null });
      expect(workspace.priceLists.map(({ id }) => id)).toEqual(expect.arrayContaining([priceList.id, otherList.id]));

      // Sólo fijar o cambiar un precio manual deja rastro en la auditoría; reenviar el mismo borrador
      // (autoguardado) no exige quotes.edit_prices ni duplica el registro.
      const manualAudits = () => prisma.auditLog.count({ where: { entityId: created.versionId, action: 'quote.price.manual' } });
      expect(await manualAudits()).toBe(1);
      expect(await prisma.auditLog.findFirstOrThrow({ where: { entityId: created.versionId, action: 'quote.price.manual' } })).toMatchObject({ actorUserId: employee.id, metadata: expect.objectContaining({ catalogItemCode: unpriced.code, unitPriceMinor: '25000', reason: 'Cotizado por proveedor', folio: request.folio }) });
      await replaceQuoteDraft(buildOnly, created.versionId, { ...base, lines }, { prisma, now });
      expect(await manualAudits()).toBe(1);
      const repriced = [lines[0], { ...lines[1], unitPriceMinorOverride: '26000' }];
      await expect(replaceQuoteDraft(buildOnly, created.versionId, { ...base, lines: repriced }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await replaceQuoteDraft(seller, created.versionId, { ...base, lines: repriced }, { prisma, now });
      expect(await manualAudits()).toBe(2);

      // Si el concepto recibe después precio en la lista, la línea sigue marcada como manual (con su motivo y el
      // precio de lista del que se apartó) hasta que se reprecie a propósito; reenviarla igual no exige permiso.
      await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: unpriced.id, unitPriceMinor: 20_000n, validFrom: now } });
      await replaceQuoteDraft(buildOnly, created.versionId, { ...base, lines: repriced }, { prisma, now });
      expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { quoteVersionId: created.versionId, catalogItemId: unpriced.id } })).toMatchObject({ unitPriceMinor: 26_000n, baseUnitPriceMinor: 20_000n, overrideReason: 'Cotizado por proveedor' });
      expect((await getQuoteWorkspace(reader, request.quoteRequestId, { prisma })).quote?.currentVersion?.lines.find((line) => line.catalogItemId === unpriced.id)).toMatchObject({ manualPriceReason: 'Cotizado por proveedor' });
      expect(await manualAudits()).toBe(2);
      // Una versión nueva a partir de la publicada conserva el precio manual y su motivo.
      await submitQuoteForReview(seller, created.versionId, { prisma, now });
      await transitionQuoteVersion(seller, created.versionId, 'ENVIADA', { prisma, now });
      const cloned = await clonePublishedVersion(buildOnly, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      const clonedManual = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: cloned.versionId, catalogItemId: unpriced.id } });
      expect(clonedManual).toMatchObject({ unitPriceMinor: 26_000n, baseUnitPriceMinor: 20_000n, overrideReason: 'Cotizado por proveedor' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: { in: [priceList.id, otherList.id] } } });
      await prisma.priceList.deleteMany({ where: { id: { in: [priceList.id, otherList.id] } } });
      await prisma.catalogItem.deleteMany({ where: { id: { in: [listed.id, unpriced.id] } } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('adds a concept "por cotizar" without a price, keeps the draft from leaving BORRADOR and heals once the list has a price', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-pending`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote pending ${suffix}`, email: `quote-pending-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Pending price fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-pending-employee-${suffix}@example.test`, emailNormalized: `quote-pending-employee-${suffix}@example.test`, displayName: 'Quote pending employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `PENDING-${suffix}`, name: 'Pending price' } });
    const listed = await prisma.catalogItem.create({ data: { code: `PENDING-LISTED-${suffix}`, name: 'Con precio', unit: 'pieza', categoryId: category.id } });
    const unpriced = await prisma.catalogItem.create({ data: { code: `PENDING-UNPRICED-${suffix}`, name: 'Por cotizar', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PENDING-PRICE-${suffix}`, name: 'Pending price list', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: listed.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    // Un vendedor común: arma cotizaciones pero no fija precios ni aplica descuentos.
    const seller = salesActor(employee.id, ['quotes.create', 'prices.read', 'quotes.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const base = { quoteRequestId: request.quoteRequestId, priceListId: priceList.id };
      const pendingLine = { catalogItemId: unpriced.id, quantity: '3', pricePending: true };

      // "Por cotizar" no admite precio ni motivo de precio manual.
      await expect(createQuoteVersion(seller, { ...base, lines: [{ ...pendingLine, unitPriceMinorOverride: '5000' }] }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      // Cualquiera que pueda cotizar puede dejar un concepto por cotizar: sin precio, sin descuento, fuera del total.
      const created = await createQuoteVersion(seller, { ...base, lines: [{ catalogItemId: listed.id, quantity: '1' }, { ...pendingLine, discountBasisPoints: 1500 }] }, { prisma, now });
      quoteId = created.quoteId;
      expect(created.totalMinor).toBe(10_000n);
      const pendingRow = await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { quoteVersionId: created.versionId, catalogItemId: unpriced.id } });
      expect(pendingRow).toMatchObject({ pricePending: true, unitPriceMinor: 0n, discountBasisPoints: 0, totalMinor: 0n, overrideReason: null, catalogItemCode: unpriced.code });
      expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { quoteVersionId: created.versionId, catalogItemId: listed.id } })).toMatchObject({ pricePending: false });
      // La versión recuerda con qué lista se armó (lo que permite saber qué precio falta y dónde).
      expect(await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { sourcePriceListId: true } })).toEqual({ sourcePriceListId: priceList.id });

      // El espacio de trabajo lo expone y el paso a revisión queda bloqueado (también en el servidor).
      const workspace = await getQuoteWorkspace(seller, request.quoteRequestId, { prisma });
      expect(workspace.quote?.currentVersion?.lines.find((line) => line.catalogItemId === unpriced.id)).toMatchObject({ pricePending: true, manualPriceReason: null });
      expect(workspace.quote?.currentVersion?.lines.find((line) => line.catalogItemId === listed.id)).toMatchObject({ pricePending: false });
      expect(workspace.projection).toMatchObject({ stage: 'BORRADOR_GUARDADO', primaryAction: null, blockers: ['PRICE_PENDING'] });
      // Al reabrir la propuesta se restaura la lista con la que se armó, aunque no tenga precio del concepto pendiente.
      expect(workspace.quote?.currentVersion?.sourcePriceListId).toBe(priceList.id);
      expect(workspace.priceLists.map(({ id }) => id)).toContain(priceList.id);
      await expect(submitQuoteForReview(seller, created.versionId, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409, message: expect.stringContaining('por cotizar') });
      expect((await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { status: true } })).status).toBe('BORRADOR');

      // Reenviar el borrador mientras el concepto sigue sin precio lo conserva por cotizar (autoguardado).
      const resaved = await replaceQuoteDraft(seller, created.versionId, { ...base, lines: [{ catalogItemId: listed.id, quantity: '1' }, pendingLine] }, { prisma, now });
      expect(resaved.totalMinor).toBe(10_000n);
      expect(await prisma.quoteLineSnapshot.count({ where: { quoteVersionId: created.versionId, pricePending: true } })).toBe(1);

      // Quien administra los precios lo ve en "Precios por asignar" (sólo él): la línea pendiente es la solicitud.
      const priceManager = salesActor(employee.id, ['prices.manage']);
      const worklist = await listPendingPriceRequests(priceManager, { prisma });
      expect(worklist.truncated).toBe(false);
      expect(worklist.items.find((group) => group.item.id === unpriced.id)).toMatchObject({
        priceList: { id: priceList.id, currencyCode: 'MXN' },
        item: { code: unpriced.code, unit: 'servicio' },
        requests: [{ quoteRequestId: request.quoteRequestId, folio: request.folio, quantityMilliunits: '3000', requestedBy: 'Quote pending employee' }],
      });
      await expect(listPendingPriceRequests(seller, { prisma })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      // Alguien asigna el precio en la lista: al guardar, el servidor resuelve la línea con ese precio.
      await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: unpriced.id, unitPriceMinor: 25_000n, validFrom: now } });
      // Un concepto "por cotizar" guarda cero, que no es un precio ya pactado: forzar ese cero sobre un concepto que ya
      // tiene precio sigue exigiendo quotes.edit_prices (no basta con reenviar "el mismo precio").
      await expect(replaceQuoteDraft(seller, created.versionId, { ...base, lines: [{ catalogItemId: listed.id, quantity: '1' }, { catalogItemId: unpriced.id, quantity: '3', unitPriceMinorOverride: '0' }] }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { quoteVersionId: created.versionId, catalogItemId: unpriced.id } })).toMatchObject({ pricePending: true, unitPriceMinor: 0n });

      const healed = await replaceQuoteDraft(seller, created.versionId, { ...base, lines: [{ catalogItemId: listed.id, quantity: '1' }, pendingLine] }, { prisma, now });
      expect(healed.totalMinor).toBe(85_000n);
      expect(await prisma.quoteLineSnapshot.findFirstOrThrow({ where: { quoteVersionId: created.versionId, catalogItemId: unpriced.id } })).toMatchObject({ pricePending: false, unitPriceMinor: 25_000n, totalMinor: 75_000n, overrideReason: null });
      expect((await getQuoteWorkspace(seller, request.quoteRequestId, { prisma })).projection).toMatchObject({ primaryAction: 'QUOTE_SUBMIT_FOR_REVIEW', blockers: [] });
      expect((await listPendingPriceRequests(priceManager, { prisma })).items.find((group) => group.item.id === unpriced.id)).toBeUndefined();

      // Sin conceptos por cotizar el borrador ya puede pasar a revisión.
      await submitQuoteForReview(seller, created.versionId, { prisma, now });
      expect((await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { status: true } })).status).toBe('EN_REVISION');
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      // El aviso "necesita precio" agrupa expedientes (sin quoteRequestId): no cae en cascada con la solicitud.
      await prisma.inboxNotification.deleteMany({ where: { groupKey: { startsWith: `price:${priceList.id}:` } } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.deleteMany({ where: { id: { in: [listed.id, unpriced.id] } } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('requires permissions, blocks edits after sending and serializes concurrent version creation', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-11T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-version`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote version ${suffix}`, email: `quote-version-${suffix}@example.test` },
      detail: { projectType: 'Comercial', location: 'Culiacán', description: 'Quote version fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: {
        email: `quote-version-employee-${suffix}@example.test`,
        emailNormalized: `quote-version-employee-${suffix}@example.test`,
        displayName: 'Quote version employee',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `VERSION-${suffix}`, name: 'Version service' } });
    const item = await prisma.catalogItem.create({ data: { code: `VERSION-ITEM-${suffix}`, name: 'Version service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `VERSION-PRICE-${suffix}`, name: 'Version service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 5000n, validFrom: now } });
    let quoteId: string | null = null;

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read']);
      const manager = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read', 'quotes.edit_prices']);
      await expect(createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', unitPriceMinorOverride: '6000' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const first = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1' }],
      }, { prisma, now });
      quoteId = first.quoteId;
      expect(await prisma.quote.findUnique({ where: { id: first.quoteId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: first.versionId, publishedVersionId: null });
      const editedDraft = await replaceQuoteDraft(actor, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now });
      expect(editedDraft.totalMinor).toBe(10000n);
      expect(await prisma.quoteLineSnapshot.count({ where: { quoteVersionId: first.versionId } })).toBe(1);

      // Q1-05: un autosave reenvía el precio ya congelado de la línea (para que no se repriecie en
      // silencio si el catálogo cambia mientras tanto) sin exigir quotes.edit_prices — sólo un valor
      // que de verdad difiere del ya persistido en esta versión cuenta como un override real.
      const resent = await replaceQuoteDraft(actor, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', unitPriceMinorOverride: '5000' }],
      }, { prisma, now });
      expect(resent.totalMinor).toBe(10000n);
      await expect(replaceQuoteDraft(actor, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', unitPriceMinorOverride: '7000' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      const genuinelyOverridden = await replaceQuoteDraft(manager, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2', unitPriceMinorOverride: '7000' }],
      }, { prisma, now });
      expect(genuinelyOverridden.totalMinor).toBe(14000n);
      // Deja la versión de vuelta en el precio de catálogo para que el resto del escenario no se altere.
      const restored = await replaceQuoteDraft(actor, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now });
      expect(restored.totalMinor).toBe(10000n);

      await transitionQuoteVersion(actor, first.versionId, 'EN_REVISION', { prisma, now });
      await transitionQuoteVersion(actor, first.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quote.findUnique({ where: { id: first.quoteId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: null, publishedVersionId: first.versionId });
      await expect(transitionQuoteVersion(actor, first.versionId, 'ACEPTADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(replaceQuoteDraft(manager, first.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
      }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const [second, concurrent] = await Promise.allSettled([
        createQuoteVersion(actor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '2' }],
          expectedCurrentVersionNumber: 1,
        }, { prisma, now }),
        createQuoteVersion(actor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '3' }],
          expectedCurrentVersionNumber: 1,
        }, { prisma, now }),
      ]);
      expect([second, concurrent].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect([second, concurrent].filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await prisma.quoteVersion.count({ where: { quote: { quoteRequestId: request.quoteRequestId } } })).toBe(2);
      expect(await prisma.quoteRequest.findUnique({ where: { id: request.quoteRequestId }, select: { status: true } })).toMatchObject({ status: 'COTIZACION_DISPONIBLE' });

      const draftResult = second.status === 'fulfilled' ? second.value : concurrent.status === 'fulfilled' ? concurrent.value : null;
      expect(draftResult).not.toBeNull();
      expect(await prisma.quote.findUnique({ where: { id: first.quoteId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: draftResult!.versionId, publishedVersionId: first.versionId });
      const discountEditor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
      // A1-01/BIZ-06/BIZ-07: > 10% (umbral por defecto de CommercialPolicyVersion) para seguir
      // exigiendo aprobación de verdad en esta prueba, no un descuento ya autorizado sin aprobar.
      await replaceQuoteDraft(discountEditor, draftResult!.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1500 }],
      }, { prisma, now });
      await transitionQuoteVersion(discountEditor, draftResult!.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(discountEditor, draftResult!.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('requires an independent, current approval before sending a discounted quote', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-12T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-approval`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote approval ${suffix}`, email: `quote-approval-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Approval fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: {
        email: `quote-approval-requester-${suffix}@example.test`,
        emailNormalized: `quote-approval-requester-${suffix}@example.test`,
        displayName: 'Quote approval requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const approver = await prisma.user.create({
      data: {
        email: `quote-approval-approver-${suffix}@example.test`,
        emailNormalized: `quote-approval-approver-${suffix}@example.test`,
        displayName: 'Quote approval approver',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `APPROVAL-${suffix}`, name: 'Approval service' } });
    const item = await prisma.catalogItem.create({ data: { code: `APPROVAL-ITEM-${suffix}`, name: 'Approval service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `APPROVAL-PRICE-${suffix}`, name: 'Approval service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      // A1-01/BIZ-06/BIZ-07: > 10% (umbral por defecto) para que la aprobación siga siendo
      // realmente exigida en esta prueba, no un descuento que la nueva policy ya deja pasar.
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });

      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });
      expect(approval).toMatchObject({ status: 'REQUESTED', type: 'DISCOUNT', policyVersion: 'discount-v1' });
      expect(approval.digest).toMatch(/^[a-f0-9]{64}$/u);

      // W1-02: la cola de aprobaciones pendientes sólo existe para quien puede resolverlas, y
      // nunca lista las que el propio actor solicitó (separación de funciones), salvo con override.
      expect(await listPendingQuoteApprovalsForActor(requesterActor, { prisma, now })).toEqual([]);
      const approverQueue = await listPendingQuoteApprovalsForActor(approverActor, { prisma, now });
      expect(approverQueue).toHaveLength(1);
      expect(approverQueue[0]).toMatchObject({ id: approval.id, type: 'DISCOUNT', folio: request.folio });
      const overrideRequesterQueue = await listPendingQuoteApprovalsForActor({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount', 'quotes.approval.override']) }, { prisma, now });
      expect(overrideRequesterQueue).toHaveLength(1);

      expect((await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
      }, { prisma, now })).id).toBe(approval.id);

      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(decideQuoteApproval({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount']) }, approval.id, { decision: 'APPROVED' }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const approved = await decideQuoteApproval(approverActor, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');
      expect(await listPendingQuoteApprovalsForActor(approverActor, { prisma, now })).toEqual([]);

      await transitionQuoteVersion(requesterActor, created.versionId, 'BORRADOR', { prisma, now });
      expect(await prisma.quoteApproval.findUnique({ where: { id: approval.id }, select: { status: true } })).toMatchObject({ status: 'SUPERSEDED' });
      await replaceQuoteDraft(requesterActor, created.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1600 }],
      }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const refreshedApproval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 600,
      }, { prisma, now });
      expect(refreshedApproval.id).not.toBe(approval.id);
      await decideQuoteApproval(approverActor, refreshedApproval.id, { decision: 'APPROVED' }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toMatchObject({ status: 'ENVIADA' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('UX audit fix: revives a REJECTED approval on re-request instead of crashing on the digest unique constraint', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-12T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-reject-revive`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote reject-revive ${suffix}`, email: `quote-reject-revive-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Reject-revive fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: { email: `quote-reject-revive-requester-${suffix}@example.test`, emailNormalized: `quote-reject-revive-requester-${suffix}@example.test`, displayName: 'Reject-revive requester', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const approver = await prisma.user.create({
      data: { email: `quote-reject-revive-approver-${suffix}@example.test`, emailNormalized: `quote-reject-revive-approver-${suffix}@example.test`, displayName: 'Reject-revive approver', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `REJREV-${suffix}`, name: 'Reject-revive service' } });
    const item = await prisma.catalogItem.create({ data: { code: `REJREV-ITEM-${suffix}`, name: 'Reject-revive item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `REJREV-PRICE-${suffix}`, name: 'Reject-revive prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });

      const requested = await requestQuoteApproval(requesterActor, created.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: 500 }, { prisma, now });
      const rejected = await decideQuoteApproval(approverActor, requested.id, { decision: 'REJECTED', reason: 'El descuento supera lo autorizado para este cliente.' }, { prisma, now });
      expect(rejected.status).toBe('REJECTED');

      // Same version, same discount, same digest as the rejected row — this used to try to INSERT
      // a second (quoteVersionId, type, digest) row and crash on the unique constraint instead of
      // reviving the existing one (a 500 a manager would hit on the very next click after rejecting).
      const revived = await requestQuoteApproval(requesterActor, created.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: 500 }, { prisma, now });
      expect(revived.id).toBe(rejected.id);
      expect(revived.status).toBe('REQUESTED');
      expect(revived.digest).toBe(rejected.digest);
      const approvedAgain = await decideQuoteApproval(approverActor, revived.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approvedAgain.status).toBe('APPROVED');
      await transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toMatchObject({ status: 'ENVIADA' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('excludes a discounted EN_REVISION version from "listas para publicar" until its approval clears (W1-03)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-20T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-ready`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote ready ${suffix}`, email: `quote-ready-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Ready-to-publish fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: {
        email: `quote-ready-requester-${suffix}@example.test`,
        emailNormalized: `quote-ready-requester-${suffix}@example.test`,
        displayName: 'Quote ready requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const approver = await prisma.user.create({
      data: {
        email: `quote-ready-approver-${suffix}@example.test`,
        emailNormalized: `quote-ready-approver-${suffix}@example.test`,
        displayName: 'Quote ready approver',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `READY-${suffix}`, name: 'Ready to publish' } });
    const item = await prisma.catalogItem.create({ data: { code: `READY-ITEM-${suffix}`, name: 'Ready to publish item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `READY-PRICE-${suffix}`, name: 'Ready to publish prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.pdf.generate', 'quotes.apply_discount', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      // A1-01: 15% > el umbral por defecto (10%), así que de entrada exige aprobación real.
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });

      // Sin aprobación vigente todavía: no debe aparecer como "lista para publicar" -- ésa es
      // exactamente la responsabilidad de la cola de "Aprobaciones", no de ésta.
      expect(await listReadyToPublishForActor(requesterActor, { prisma, now })).toEqual([]);

      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });
      expect(await listReadyToPublishForActor(requesterActor, { prisma, now })).toEqual([]);
      await decideQuoteApproval(approverActor, approval.id, { decision: 'APPROVED' }, { prisma, now });

      // Aprobada: ahora sí sólo falta el clic real de "Enviar cotización".
      const ready = await listReadyToPublishForActor(requesterActor, { prisma, now });
      expect(ready).toHaveLength(1);
      expect(ready[0]).toMatchObject({ versionId: created.versionId, requestId: request.quoteRequestId, folio: request.folio, versionNumber: 1 });

      // Un actor sin quotes.send/quotes.pdf.generate no vería el botón de enviar, así que tampoco
      // debe ver la cola -- mismo criterio ya usado por listPendingQuoteApprovalsForActor.
      expect(await listReadyToPublishForActor(salesActor(requester.id, ['quotes.create']), { prisma, now })).toEqual([]);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('paginates the full pending-approvals queue with the pricing/reason detail a manager needs (A1-03/A1-05)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-20T12:00:00.000Z');
    const requester = await prisma.user.create({
      data: {
        email: `quote-approvals-page-requester-${suffix}@example.test`,
        emailNormalized: `quote-approvals-page-requester-${suffix}@example.test`,
        displayName: 'Quote approvals page requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const approver = await prisma.user.create({
      data: {
        email: `quote-approvals-page-approver-${suffix}@example.test`,
        emailNormalized: `quote-approvals-page-approver-${suffix}@example.test`,
        displayName: 'Quote approvals page approver',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `APPROVALS-PAGE-${suffix}`, name: 'Approvals page' } });
    const item = await prisma.catalogItem.create({ data: { code: `APPROVALS-PAGE-ITEM-${suffix}`, name: 'Approvals page item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `APPROVALS-PAGE-PRICE-${suffix}`, name: 'Approvals page prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);
    const requestIds: string[] = [];
    const quoteIds: string[] = [];

    try {
      for (const index of [1, 2]) {
        const request = await createQuoteRequest({
          idempotencyKey: `quote-approvals-page-${suffix}-${index}`,
          origin: 'STAFF_CREATED',
          contact: { displayName: `Approvals page ${suffix}-${index}`, email: `approvals-page-${suffix}-${index}@example.test` },
          detail: { projectType: `Proyecto ${index}`, location: 'Mazatlán', description: 'Approvals page fixture', consentAt: now },
        }, { prisma, now });
        requestIds.push(request.quoteRequestId);
        await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
        const created = await createQuoteVersion(requesterActor, {
          quoteRequestId: request.quoteRequestId,
          priceListId: priceList.id,
          lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1500 }],
        }, { prisma, now: new Date(now.getTime() + index * 1000) });
        quoteIds.push(created.quoteId);
        await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
        await requestQuoteApproval(requesterActor, created.versionId, {
          type: 'DISCOUNT',
          policyVersion: 'discount-v1',
          reason: `Motivo comercial ${index}`,
        }, { prisma, now: new Date(now.getTime() + index * 1000) });
      }

      const firstPage = await listPendingQuoteApprovalsPageForActor(approverActor, { page: 1, pageSize: 1 }, { prisma, now });
      expect(firstPage).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.items[0]).toMatchObject({
        type: 'DISCOUNT',
        reason: 'Motivo comercial 1',
        policyVersion: 'discount-v1',
        requestedByDisplayName: 'Quote approvals page requester',
        folio: (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestIds[0] }, select: { folio: true } })).folio,
        projectType: 'Proyecto 1',
        subtotalMinor: '10000',
        discountTotalMinor: '1500',
      });

      const secondPage = await listPendingQuoteApprovalsPageForActor(approverActor, { page: 2, pageSize: 1 }, { prisma, now });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0].reason).toBe('Motivo comercial 2');
      expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);

      // Separación de funciones: quien solicitó ambas no ve ninguna sin override, aunque exista más
      // de una página -- mismo criterio ya probado para listPendingQuoteApprovalsForActor.
      expect(await listPendingQuoteApprovalsPageForActor(requesterActor, {}, { prisma, now })).toMatchObject({ total: 0, items: [] });
    } finally {
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: { in: requestIds } } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: { in: requestIds } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [...requestIds, ...quoteIds] } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...requestIds, ...quoteIds, ...versionIds, ...approvalIds] } } });
      const contactIds = (await prisma.quoteRequest.findMany({ where: { id: { in: requestIds } }, select: { contactId: true } })).map((r) => r.contactId);
      const clientIds = (await prisma.quoteRequest.findMany({ where: { id: { in: requestIds } }, select: { clientId: true } })).map((r) => r.clientId);
      await prisma.quoteRequest.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.clientContact.deleteMany({ where: { id: { in: contactIds } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('lets only quotes.approval.override bypass the separation-of-duties block on a self-requested approval (D2-02)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-override`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote override ${suffix}`, email: `quote-override-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Override fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: {
        email: `quote-override-requester-${suffix}@example.test`,
        emailNormalized: `quote-override-requester-${suffix}@example.test`,
        displayName: 'Quote override requester',
        type: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `OVERRIDE-${suffix}`, name: 'Override service' } });
    const item = await prisma.catalogItem.create({ data: { code: `OVERRIDE-ITEM-${suffix}`, name: 'Override service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `OVERRIDE-PRICE-${suffix}`, name: 'Override service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });

      await expect(decideQuoteApproval({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount']) }, approval.id, { decision: 'APPROVED' }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const approved = await decideQuoteApproval({ ...requesterActor, permissionKeys: new Set([...requesterActor.permissionKeys, 'quotes.approve_discount', 'quotes.approval.override']) }, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');
      expect(approved.decidedById).toBe(requester.id);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: requester.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('scopes approval requests, decisions and listings to the request\'s assigned responsible', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-13T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-approval-scope`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Approval scope ${suffix}`, email: `approval-scope-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Culiacán', description: 'Approval scope fixture', consentAt: now },
    }, { prisma, now });
    const rival = await prisma.user.create({
      data: { email: `approval-scope-rival-${suffix}@example.test`, emailNormalized: `approval-scope-rival-${suffix}@example.test`, displayName: 'Approval scope rival', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const outsider = await prisma.user.create({
      data: { email: `approval-scope-outsider-${suffix}@example.test`, emailNormalized: `approval-scope-outsider-${suffix}@example.test`, displayName: 'Approval scope outsider', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `APPROVAL-SCOPE-${suffix}`, name: 'Approval scope service' } });
    const item = await prisma.catalogItem.create({ data: { code: `APPROVAL-SCOPE-ITEM-${suffix}`, name: 'Approval scope item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `APPROVAL-SCOPE-PRICE-${suffix}`, name: 'Approval scope prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const rivalActor = salesActor(rival.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'quotes.read', 'quotes.approve_discount', 'prices.read']);
    const outsiderActor = salesActor(outsider.id, ['quotes.create', 'quotes.read', 'quotes.approve_discount']);
    const globalOutsiderActor = { ...outsiderActor, permissionKeys: new Set([...outsiderActor.permissionKeys, 'requests.read.global']) };

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION', currentAssigneeId: rival.id } });
      const created = await createQuoteVersion(rivalActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 500 }],
      }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(rivalActor, created.versionId, 'EN_REVISION', { prisma, now });

      await expect(requestQuoteApproval(outsiderActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Intento de un responsable ajeno.',
      }, { prisma, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      const approval = await requestQuoteApproval(rivalActor, created.versionId, {
        type: 'DISCOUNT',
        policyVersion: 'discount-v1',
        thresholdBps: 500,
        reason: 'Condición comercial autorizada para el cliente.',
      }, { prisma, now });

      await expect(decideQuoteApproval(outsiderActor, approval.id, { decision: 'APPROVED' }, { prisma, now })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(listQuoteApprovals(outsiderActor, created.versionId, { prisma })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      await expect(listQuoteApprovals(globalOutsiderActor, created.versionId, { prisma })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: approval.id })]));
      const approved = await decideQuoteApproval(globalOutsiderActor, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [rival.id, outsider.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('requires a SPECIAL_CONCEPT approval before sending a quote with a special line, and invalidates it on edit (K1-05)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-02-14T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-special`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote special ${suffix}`, email: `quote-special-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Mazatlán', description: 'Special concept fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({
      data: { email: `quote-special-requester-${suffix}@example.test`, emailNormalized: `quote-special-requester-${suffix}@example.test`, displayName: 'Quote special requester', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const approver = await prisma.user.create({
      data: { email: `quote-special-approver-${suffix}@example.test`, emailNormalized: `quote-special-approver-${suffix}@example.test`, displayName: 'Quote special approver', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `SPECIAL-${suffix}`, name: 'Special concept service' } });
    const item = await prisma.catalogItem.create({ data: { code: `SPECIAL-ITEM-${suffix}`, name: 'Special concept item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `SPECIAL-PRICE-${suffix}`, name: 'Special concept prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;

    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'prices.read']);
    const approverActor = salesActor(approver.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [
          { catalogItemId: item.id, quantity: '1' },
          { special: true, name: 'Ajuste especial de sitio', unit: 'servicio', quantity: '1', unitPriceMinor: '5000', reason: 'Condición del terreno no catalogada' },
        ],
      }, { prisma, now });
      quoteId = created.quoteId;
      expect(created.totalMinor).toBe(15000n);
      const specialLine = await prisma.quoteLineSnapshot.findFirst({ where: { quoteVersionId: created.versionId, catalogItemId: null } });
      expect(specialLine).toMatchObject({ catalogItemId: null, catalogItemCode: null, name: 'Ajuste especial de sitio', specialReason: 'Condición del terreno no catalogada' });

      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      await expect(requestQuoteApproval(requesterActor, created.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      const approval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'SPECIAL_CONCEPT',
        policyVersion: 'special-concept-v1',
        reason: 'Ajuste de sitio autorizado por el cliente.',
      }, { prisma, now });
      expect(approval).toMatchObject({ status: 'REQUESTED', type: 'SPECIAL_CONCEPT' });

      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      const approved = await decideQuoteApproval(approverActor, approval.id, { decision: 'APPROVED' }, { prisma, now });
      expect(approved.status).toBe('APPROVED');

      await transitionQuoteVersion(requesterActor, created.versionId, 'BORRADOR', { prisma, now });
      expect(await prisma.quoteApproval.findUnique({ where: { id: approval.id }, select: { status: true } })).toMatchObject({ status: 'SUPERSEDED' });
      await replaceQuoteDraft(requesterActor, created.versionId, {
        priceListId: priceList.id,
        lines: [
          { catalogItemId: item.id, quantity: '1' },
          { special: true, name: 'Ajuste especial de sitio', unit: 'servicio', quantity: '1', unitPriceMinor: '5000', reason: 'Motivo actualizado tras revisión' },
        ],
      }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      await expect(transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const refreshedApproval = await requestQuoteApproval(requesterActor, created.versionId, {
        type: 'SPECIAL_CONCEPT',
        policyVersion: 'special-concept-v1',
      }, { prisma, now });
      expect(refreshedApproval.id).not.toBe(approval.id);
      await decideQuoteApproval(approverActor, refreshedApproval.id, { decision: 'APPROVED' }, { prisma, now });
      await transitionQuoteVersion(requesterActor, created.versionId, 'ENVIADA', { prisma, now });
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toMatchObject({ status: 'ENVIADA' });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approver.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('clones a published version into a fresh draft, re-pricing catalog lines and copying special lines verbatim (D2-04)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-clone`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote clone ${suffix}`, email: `quote-clone-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Clone fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-clone-employee-${suffix}@example.test`, emailNormalized: `quote-clone-employee-${suffix}@example.test`, displayName: 'Quote clone employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const manager = await prisma.user.create({
      data: { email: `quote-clone-manager-${suffix}@example.test`, emailNormalized: `quote-clone-manager-${suffix}@example.test`, displayName: 'Quote clone manager', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `CLONE-${suffix}`, name: 'Clone service' } });
    const item = await prisma.catalogItem.create({ data: { code: `CLONE-ITEM-${suffix}`, name: 'Clone service item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `CLONE-PRICE-${suffix}`, name: 'Clone service prices', currencyCode: 'MXN', validFrom: now } });
    const price = await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read']);

    try {
      const noPublicationYet = clonePublishedVersion(actor, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      await expect(noPublicationYet).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, {
        quoteRequestId: request.quoteRequestId,
        priceListId: priceList.id,
        lines: [
          { catalogItemId: item.id, quantity: '2' },
          { special: true, name: 'Ajuste especial', unit: 'lote', quantity: '1', unitPriceMinor: '5000', reason: 'Sin equivalente en catálogo' },
        ],
      }, { prisma, now });
      quoteId = created.quoteId;
      await submitQuoteForReview(actor, created.versionId, { prisma, now });
      const specialApproval = await requestQuoteApproval(actor, created.versionId, { type: 'SPECIAL_CONCEPT', policyVersion: 'special-concept-v1' }, { prisma, now });
      await decideQuoteApproval(salesActor(manager.id, ['quotes.approve_discount']), specialApproval.id, { decision: 'APPROVED' }, { prisma, now });
      await transitionQuoteVersion(actor, created.versionId, 'ENVIADA', { prisma, now });

      await prisma.priceListItem.update({ where: { id: price.id }, data: { unitPriceMinor: 15_000n } });

      const noPermission = clonePublishedVersion(salesActor(employee.id, []), request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      await expect(noPermission).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      const cloned = await clonePublishedVersion(actor, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      expect(cloned.versionNumber).toBe(2);
      expect(cloned.versionId).not.toBe(created.versionId);
      const clonedLines = await prisma.quoteLineSnapshot.findMany({ where: { quoteVersionId: cloned.versionId }, orderBy: { unitPriceMinor: 'desc' } });
      expect(clonedLines).toHaveLength(2);
      expect(clonedLines.find((line) => line.catalogItemId === item.id)).toMatchObject({ unitPriceMinor: 15_000n });
      expect(clonedLines.find((line) => line.catalogItemId === null)).toMatchObject({ name: 'Ajuste especial', unit: 'lote', unitPriceMinor: 5000n, specialReason: 'Sin equivalente en catálogo' });
      expect(await prisma.quote.findUnique({ where: { quoteRequestId: request.quoteRequestId }, select: { workingVersionId: true, publishedVersionId: true } })).toMatchObject({ workingVersionId: cloned.versionId, publishedVersionId: created.versionId });

      const workingConflict = clonePublishedVersion(actor, request.quoteRequestId, { priceListId: priceList.id }, { prisma, now });
      await expect(workingConflict).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [employee.id, manager.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('rejects a stale draft save and accepts one that matches the last known updatedAt (D2-04)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-occ`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote OCC ${suffix}`, email: `quote-occ-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Concurrency fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-occ-employee-${suffix}@example.test`, emailNormalized: `quote-occ-employee-${suffix}@example.test`, displayName: 'Quote OCC employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `OCC-${suffix}`, name: 'OCC service' } });
    const item = await prisma.catalogItem.create({ data: { code: `OCC-ITEM-${suffix}`, name: 'OCC service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `OCC-PRICE-${suffix}`, name: 'OCC service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 8000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'prices.read']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now: new Date('2026-09-17T12:00:00.000Z') });
      quoteId = created.quoteId;
      const originalUpdatedAt = (await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { updatedAt: true } })).updatedAt;

      const stale = replaceQuoteDraft(actor, created.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '2' }],
        expectedUpdatedAt: new Date(originalUpdatedAt.getTime() - 1000),
      }, { prisma, now: new Date('2026-09-17T12:05:00.000Z') });
      await expect(stale).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      const matching = await replaceQuoteDraft(actor, created.versionId, {
        priceListId: priceList.id,
        lines: [{ catalogItemId: item.id, quantity: '3' }],
        expectedUpdatedAt: originalUpdatedAt,
      }, { prisma, now: new Date('2026-09-17T12:10:00.000Z') });
      expect(matching.totalMinor).toBe(24000n);

      const secondUpdatedAt = (await prisma.quoteVersion.findUniqueOrThrow({ where: { id: created.versionId }, select: { updatedAt: true } })).updatedAt;
      const omitted = await replaceQuoteDraft(actor, created.versionId, { priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '4' }] }, { prisma, now: new Date('2026-09-17T12:15:00.000Z') });
      expect(omitted.totalMinor).toBe(32000n);
      expect(secondUpdatedAt).not.toBeNull();
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('names submit/return/reject as distinct audited commands while leaving transitionQuoteVersion behavior-preserving (D2-04)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-17T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-named`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote named ${suffix}`, email: `quote-named-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Named transitions fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-named-employee-${suffix}@example.test`, emailNormalized: `quote-named-employee-${suffix}@example.test`, displayName: 'Quote named employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `NAMED-${suffix}`, name: 'Named service' } });
    const item = await prisma.catalogItem.create({ data: { code: `NAMED-ITEM-${suffix}`, name: 'Named service item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `NAMED-PRICE-${suffix}`, name: 'Named service prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 9000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'quotes.send', 'prices.read', 'quotes.apply_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 300 }] }, { prisma, now });
      quoteId = created.quoteId;

      const submitted = await submitQuoteForReview(actor, created.versionId, { prisma, now });
      expect(submitted).toMatchObject({ fromStatus: 'BORRADOR', toStatus: 'EN_REVISION' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: created.versionId, action: 'quote.version.submitted' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_SUBMITTED' } })).not.toBeNull();

      await expect(returnQuoteToDraft(actor, created.versionId, { reason: '' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const returned = await returnQuoteToDraft(actor, created.versionId, { reason: 'Falta ajustar el alcance.' }, { prisma, now });
      expect(returned).toMatchObject({ fromStatus: 'EN_REVISION', toStatus: 'BORRADOR' });
      expect(await prisma.quoteStatusHistory.findFirst({ where: { quoteVersionId: created.versionId, toStatus: 'BORRADOR', fromStatus: 'EN_REVISION' } })).toMatchObject({ reason: 'Falta ajustar el alcance.' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: created.versionId, action: 'quote.version.returned_to_draft' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_REOPENED' } })).not.toBeNull();

      await submitQuoteForReview(actor, created.versionId, { prisma, now });
      await expect(rejectQuoteVersion(actor, created.versionId, { reason: '' }, { prisma, now })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      const rejected = await rejectQuoteVersion(actor, created.versionId, { reason: 'El cliente ya no continuará.' }, { prisma, now });
      expect(rejected).toMatchObject({ fromStatus: 'EN_REVISION', toStatus: 'RECHAZADA' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: created.versionId, action: 'quote.version.rejected' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: created.quoteId, eventType: 'QUOTE.VERSION_REJECTED' } })).not.toBeNull();

      const secondVersion = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      const legacy = await transitionQuoteVersion(actor, secondVersion.versionId, 'EN_REVISION', { prisma, now });
      expect(legacy).toMatchObject({ fromStatus: 'BORRADOR', toStatus: 'EN_REVISION' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: secondVersion.versionId, action: 'quote.version.status_changed' } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: secondVersion.quoteId, eventType: 'QUOTE.VERSION_STATUS_CHANGED' } })).not.toBeNull();

      // D2-06 non-regression: reaching ENVIADA through the generic primitive (bypassing
      // publishQuoteVersion) must keep emitting the OLD generic audit action/event, not
      // the new dedicated QUOTE.PUBLISHED ones — only the named command owns that signal.
      const legacyPublish = await transitionQuoteVersion(actor, secondVersion.versionId, 'ENVIADA', { prisma, now });
      expect(legacyPublish).toMatchObject({ fromStatus: 'EN_REVISION', toStatus: 'ENVIADA' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: secondVersion.versionId, action: 'quote.version.status_changed', outcome: 'SUCCESS' } })).not.toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { entityId: secondVersion.versionId, action: 'quote.version.published' } })).toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: secondVersion.quoteId, eventType: 'QUOTE.VERSION_STATUS_CHANGED', payload: { path: ['toStatus'], equals: 'ENVIADA' } } })).not.toBeNull();
      expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: secondVersion.quoteId, eventType: 'QUOTE.PUBLISHED' } })).toBeNull();
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('invalidates a generated PDF when a reviewed version returns to draft (bug fix: generateQuotePdf is idempotent and would otherwise resend stale content)', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-19T12:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-pdf-invalidate`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote PDF invalidate ${suffix}`, email: `quote-pdf-invalidate-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'PDF invalidation fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-pdf-invalidate-employee-${suffix}@example.test`, emailNormalized: `quote-pdf-invalidate-employee-${suffix}@example.test`, displayName: 'Quote PDF invalidate employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `PDFINV-${suffix}`, name: 'PDF invalidate service' } });
    const item = await prisma.catalogItem.create({ data: { code: `PDFINV-ITEM-${suffix}`, name: 'PDF invalidate item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `PDFINV-PRICE-${suffix}`, name: 'PDF invalidate prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'quotes.read', 'quotes.send', 'quotes.pdf.generate', 'quotes.pdf.read', 'prices.read']);
    const fakeRenderer = async (snapshot: QuotePdfSnapshot): Promise<RenderedQuotePdf> => {
      const bytes = new TextEncoder().encode(`fake-pdf-total:${snapshot.totalMinor}`);
      return { bytes, byteSize: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 1, templateVersion: 'test-fake' };
    };

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      quoteId = created.quoteId;
      await submitQuoteForReview(actor, created.versionId, { prisma, now });

      const firstDocument = await generateQuotePdf(actor, created.versionId, { prisma, now, renderer: fakeRenderer });
      expect(firstDocument.status).toBe('READY');
      expect(await prisma.generatedDocument.count({ where: { quoteVersionId: created.versionId } })).toBe(1);

      await returnQuoteToDraft(actor, created.versionId, { reason: 'Ajustar cantidad antes de reenviar.' }, { prisma, now });
      // La fila del documento generado debe desaparecer de inmediato: generateQuotePdf reutiliza
      // cualquier documento READY existente, así que dejarla viva habría reenviado el PDF viejo.
      expect(await prisma.generatedDocument.count({ where: { quoteVersionId: created.versionId } })).toBe(0);

      await replaceQuoteDraft(actor, created.versionId, { priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '5' }] }, { prisma, now });
      await submitQuoteForReview(actor, created.versionId, { prisma, now });
      const secondDocument = await generateQuotePdf(actor, created.versionId, { prisma, now, renderer: fakeRenderer });
      expect(secondDocument.status).toBe('READY');
      expect(secondDocument.id).not.toBe(firstDocument.id);
      expect(secondDocument.sha256).not.toBe(firstDocument.sha256);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      await prisma.generatedDocument.deleteMany({ where: { quoteVersionId: { in: versionIds } } });
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('H1-02: rejects publishing with a preflight digest that went stale before confirmation', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-20T20:00:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-stale-digest`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote stale digest ${suffix}`, email: `quote-stale-digest-${suffix}@example.test` },
      detail: { projectType: 'Residencial', location: 'Culiacán', description: 'Stale preflight digest fixture', consentAt: now },
    }, { prisma, now });
    const employee = await prisma.user.create({
      data: { email: `quote-stale-digest-employee-${suffix}@example.test`, emailNormalized: `quote-stale-digest-employee-${suffix}@example.test`, displayName: 'Quote stale digest employee', type: 'EMPLOYEE', status: 'ACTIVE' },
    });
    const category = await prisma.catalogCategory.create({ data: { code: `STALEDIG-${suffix}`, name: 'Stale digest service' } });
    const item = await prisma.catalogItem.create({ data: { code: `STALEDIG-ITEM-${suffix}`, name: 'Stale digest item', unit: 'pieza', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `STALEDIG-PRICE-${suffix}`, name: 'Stale digest prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const actor = salesActor(employee.id, ['quotes.create', 'quotes.read', 'quotes.send', 'quotes.pdf.generate', 'quotes.pdf.read', 'prices.read']);
    const fakeRenderer = async (snapshot: QuotePdfSnapshot): Promise<RenderedQuotePdf> => {
      const bytes = new TextEncoder().encode(`fake-pdf-total:${snapshot.totalMinor}`);
      return { bytes, byteSize: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 1, templateVersion: 'test-fake' };
    };

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(actor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1' }] }, { prisma, now });
      quoteId = created.quoteId;
      await submitQuoteForReview(actor, created.versionId, { prisma, now });
      await generateQuotePdf(actor, created.versionId, { prisma, now, renderer: fakeRenderer });

      // P1-05: la digest que el diálogo de preflight leyó al abrirse -- se queda "vieja" en cuanto
      // el contenido cambia después, exactamente el escenario que este mecanismo debe detectar.
      const staleDigest = (await getQuoteDocumentStatusForVersion(actor, created.versionId, { prisma, now })).contentDigest;

      const [line] = await prisma.quoteLineSnapshot.findMany({ where: { quoteVersionId: created.versionId } });
      if (!line) throw new Error('The stale-digest fixture line was not created.');
      // Simula otra pestaña/persona editando el contenido mientras el diálogo de confirmación sigue
      // abierto con la digest ya leída -- sin pasar por status, tal como una repreciación real.
      await prisma.quoteLineSnapshot.update({ where: { id: line.id }, data: { quantityMilliunits: line.quantityMilliunits * 2n } });

      await expect(publishQuoteVersion(actor, created.versionId, { expectedContentDigest: staleDigest }, { prisma, now })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true } })).toMatchObject({ status: 'EN_REVISION' });

      // Control positivo: la MISMA operación con la digest fresca (la que el staff vería si
      // recargara el preflight) sí debe publicar -- el mecanismo detecta el cambio real, no bloquea
      // indiscriminadamente.
      const freshDigest = (await getQuoteDocumentStatusForVersion(actor, created.versionId, { prisma, now })).contentDigest;
      expect(freshDigest).not.toBe(staleDigest);
      const published = await publishQuoteVersion(actor, created.versionId, { expectedContentDigest: freshDigest }, { prisma, now });
      expect(published.toStatus).toBe('ENVIADA');
      expect(await prisma.quoteVersion.findUnique({ where: { id: created.versionId }, select: { status: true, contentDigest: true } })).toMatchObject({ status: 'ENVIADA', contentDigest: freshDigest });
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const documents = await prisma.generatedDocument.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } });
      await prisma.quotePublication.deleteMany({ where: { documentId: { in: documents.map(({ id }) => id) } } });
      await prisma.generatedDocument.deleteMany({ where: { quoteVersionId: { in: versionIds } } });
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.user.deleteMany({ where: { clientId: request.clientId, type: 'CUSTOMER' } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.delete({ where: { id: employee.id } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);

  it('H1-03: resolves two concurrent decisions on the same approval to exactly one winner', async () => {
    if (process.env.RUN_DB_TESTS !== '1') {
      throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');
    }

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const now = new Date('2026-09-20T20:30:00.000Z');
    const request = await createQuoteRequest({
      idempotencyKey: `quote-service-${suffix}-approval-race`,
      origin: 'STAFF_CREATED',
      contact: { displayName: `Quote approval race ${suffix}`, email: `quote-approval-race-${suffix}@example.test` },
      detail: { projectType: 'Industrial', location: 'Mazatlán', description: 'Concurrent approval decision fixture', consentAt: now },
    }, { prisma, now });
    const requester = await prisma.user.create({ data: { email: `quote-approval-race-requester-${suffix}@example.test`, emailNormalized: `quote-approval-race-requester-${suffix}@example.test`, displayName: 'Quote approval race requester', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const [approverA, approverB] = await Promise.all([
      prisma.user.create({ data: { email: `quote-approval-race-a-${suffix}@example.test`, emailNormalized: `quote-approval-race-a-${suffix}@example.test`, displayName: 'Quote approval race approver A', type: 'EMPLOYEE', status: 'ACTIVE' } }),
      prisma.user.create({ data: { email: `quote-approval-race-b-${suffix}@example.test`, emailNormalized: `quote-approval-race-b-${suffix}@example.test`, displayName: 'Quote approval race approver B', type: 'EMPLOYEE', status: 'ACTIVE' } }),
    ]);
    const category = await prisma.catalogCategory.create({ data: { code: `APPROVALRACE-${suffix}`, name: 'Approval race service' } });
    const item = await prisma.catalogItem.create({ data: { code: `APPROVALRACE-ITEM-${suffix}`, name: 'Approval race item', unit: 'servicio', categoryId: category.id } });
    const priceList = await prisma.priceList.create({ data: { code: `APPROVALRACE-PRICE-${suffix}`, name: 'Approval race prices', currencyCode: 'MXN', validFrom: now } });
    await prisma.priceListItem.create({ data: { priceListId: priceList.id, catalogItemId: item.id, unitPriceMinor: 10_000n, validFrom: now } });
    let quoteId: string | null = null;
    const requesterActor = salesActor(requester.id, ['quotes.create', 'quotes.send', 'quotes.apply_discount', 'prices.read']);
    const approverActorA = salesActor(approverA.id, ['quotes.read', 'quotes.approve_discount']);
    const approverActorB = salesActor(approverB.id, ['quotes.read', 'quotes.approve_discount']);

    try {
      await prisma.quoteRequest.update({ where: { id: request.quoteRequestId }, data: { status: 'EN_ELABORACION' } });
      const created = await createQuoteVersion(requesterActor, { quoteRequestId: request.quoteRequestId, priceListId: priceList.id, lines: [{ catalogItemId: item.id, quantity: '1', discountBasisPoints: 1500 }] }, { prisma, now });
      quoteId = created.quoteId;
      await transitionQuoteVersion(requesterActor, created.versionId, 'EN_REVISION', { prisma, now });
      const approval = await requestQuoteApproval(requesterActor, created.versionId, { type: 'DISCOUNT', policyVersion: 'discount-v1', thresholdBps: 500, reason: 'Condición comercial autorizada para el cliente.' }, { prisma, now });

      // FOR UPDATE serializa el par: quien confirme segundo relee status ya resuelto y debe
      // encontrar 'La aprobación ya fue resuelta.', nunca sobreescribir la decisión ganadora.
      const results = await Promise.allSettled([
        decideQuoteApproval(approverActorA, approval.id, { decision: 'APPROVED' }, { prisma, now }),
        decideQuoteApproval(approverActorB, approval.id, { decision: 'REJECTED', reason: 'No corresponde a esta cuenta.' }, { prisma, now }),
      ]);
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof decideQuoteApproval>>> => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(['APPROVED', 'REJECTED']).toContain(fulfilled[0].value.status);
      const persisted = await prisma.quoteApproval.findUnique({ where: { id: approval.id }, select: { status: true, decidedById: true } });
      expect(persisted?.status).toBe(fulfilled[0].value.status);
      expect([approverA.id, approverB.id]).toContain(persisted?.decidedById);
    } finally {
      const aggregateIds = [request.quoteRequestId, ...(quoteId ? [quoteId] : [])];
      const versionIds = (await prisma.quoteVersion.findMany({ where: { quote: { quoteRequestId: request.quoteRequestId } }, select: { id: true } })).map(({ id }) => id);
      const approvalIds = (await prisma.quoteApproval.findMany({ where: { quoteVersionId: { in: versionIds } }, select: { id: true } })).map(({ id }) => id);
      await prisma.quote.deleteMany({ where: { quoteRequestId: request.quoteRequestId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...aggregateIds, ...versionIds, ...approvalIds] } } });
      await prisma.quoteRequest.delete({ where: { id: request.quoteRequestId } });
      await prisma.clientContact.delete({ where: { id: request.contactId } });
      await prisma.client.delete({ where: { id: request.clientId } });
      await prisma.user.deleteMany({ where: { id: { in: [requester.id, approverA.id, approverB.id] } } });
      await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
      await prisma.priceList.delete({ where: { id: priceList.id } });
      await prisma.catalogItem.delete({ where: { id: item.id } });
      await prisma.catalogCategory.delete({ where: { id: category.id } });
    }
  }, 30_000);
});
