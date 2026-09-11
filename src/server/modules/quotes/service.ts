import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import {
  buildQuoteVersionSnapshot,
  canTransitionQuoteVersion,
  createMoney,
  normalizeBasisPoints,
  normalizeCurrencyCode,
  parseQuantity,
  type QuoteLineSnapshotInput,
  type QuoteVersionStatus,
} from '@/server/modules/quotes/domain';
import { canTransitionQuoteRequest, type QuoteRequestStatus } from '@/server/modules/quote-requests/domain';
import { hasValidApprovedQuoteApproval } from '@/server/modules/quotes/approval-service';
import { generateQuotePdf } from '@/server/modules/quote-documents/service';

export type QuotePricingLineInput = Readonly<{
  catalogItemId: string;
  quantity: string;
  unitPriceMinorOverride?: string | bigint;
  discountBasisPoints?: string | number | bigint;
  taxBasisPoints?: string | number | bigint;
}>;

export type CreateQuoteVersionInput = Readonly<{
  quoteRequestId: string;
  priceListId: string;
  lines: readonly QuotePricingLineInput[];
  validUntil?: Date | null;
  expectedCurrentVersionNumber?: number | null;
}>;

export type ReplaceQuoteDraftInput = Readonly<{
  priceListId: string;
  lines: readonly QuotePricingLineInput[];
  validUntil?: Date | null;
}>;

export type QuoteServiceDependencies = Readonly<{
  prisma?: PrismaClient;
  now?: Date;
}>;

export type QuoteVersionResult = Readonly<{
  quoteId: string;
  versionId: string;
  versionNumber: number;
  folio: string;
  status: QuoteVersionStatus;
  currencyCode: string;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxableTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
}>;

export function serializeQuoteVersionResult(result: QuoteVersionResult) {
  return {
    ...result,
    subtotalMinor: result.subtotalMinor.toString(),
    discountTotalMinor: result.discountTotalMinor.toString(),
    taxableTotalMinor: result.taxableTotalMinor.toString(),
    taxTotalMinor: result.taxTotalMinor.toString(),
    totalMinor: result.totalMinor.toString(),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const QUOTE_BUILDABLE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'];

type LockedQuoteRequest = {
  id: string;
  folio: string;
  clientId: string;
  status: QuoteRequestStatus;
  currencyCode: string;
};

type LockedQuote = {
  id: string;
  currentVersionId: string | null;
  workingVersionId: string | null;
  publishedVersionId: string | null;
};

type LockedQuoteVersion = {
  id: string;
  quoteId: string;
  versionNumber: number;
  status: QuoteVersionStatus;
  currencyCode: string;
  discountTotalMinor: bigint;
  currentVersionId: string | null;
  workingVersionId: string | null;
  publishedVersionId: string | null;
  quoteRequestId: string;
  folio: string;
  requestStatus: QuoteRequestStatus;
  requestCurrencyCode: string;
};

function requireEmployeePermission(actor: Actor, permission: string): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, permission);
}

function requireUuid(value: string, message: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', message, 400);
  return value;
}

function validation(message: string): never {
  throw new AppError('VALIDATION_ERROR', message, 400);
}

function conflict(message: string): never {
  throw new AppError('CONFLICT', message, 409);
}

function normalizeDate(value: Date | null | undefined, now: Date): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value <= now) validation('La vigencia de la cotización no es válida.');
  return value;
}

function normalizePricingLine(line: QuotePricingLineInput): QuotePricingLineInput {
  const catalogItemId = requireUuid(line.catalogItemId, 'El concepto no es válido.');
  try {
    parseQuantity(line.quantity);
    normalizeBasisPoints(line.discountBasisPoints ?? 0);
    normalizeBasisPoints(line.taxBasisPoints ?? 0);
  } catch {
    validation('La línea de cotización no es válida.');
  }
  if (line.unitPriceMinorOverride !== undefined
    && (typeof line.unitPriceMinorOverride === 'bigint'
      ? line.unitPriceMinorOverride < 0n
      : typeof line.unitPriceMinorOverride !== 'string' || !/^\d+$/u.test(line.unitPriceMinorOverride.trim()))) {
    validation('El precio de la línea no es válido.');
  }
  return { ...line, catalogItemId };
}

async function lockQuoteRequest(transaction: Prisma.TransactionClient, quoteRequestId: string): Promise<LockedQuoteRequest | null> {
  const rows = await transaction.$queryRaw<LockedQuoteRequest[]>(Prisma.sql`
    SELECT qr."id", qr."folio", qr."clientId", qr."status", qrd."currencyCode"
    FROM "quote_requests" qr
    INNER JOIN "quote_request_details" qrd ON qrd."quoteRequestId" = qr."id"
    WHERE qr."id" = ${quoteRequestId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockQuote(transaction: Prisma.TransactionClient, quoteId: string): Promise<LockedQuote | null> {
  const rows = await transaction.$queryRaw<LockedQuote[]>(Prisma.sql`
    SELECT "id", "currentVersionId", "workingVersionId", "publishedVersionId"
    FROM "quotes"
    WHERE "id" = ${quoteId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockQuoteVersion(transaction: Prisma.TransactionClient, quoteVersionId: string): Promise<LockedQuoteVersion | null> {
  const rows = await transaction.$queryRaw<LockedQuoteVersion[]>(Prisma.sql`
    SELECT qv."id", qv."quoteId", qv."versionNumber", qv."status", qv."currencyCode", qv."discountTotalMinor", q."currentVersionId", q."workingVersionId", q."publishedVersionId",
           q."quoteRequestId", qr."folio", qr."status" AS "requestStatus", qrd."currencyCode" AS "requestCurrencyCode"
    FROM "quote_versions" qv
    INNER JOIN "quotes" q ON q."id" = qv."quoteId"
    INNER JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
    INNER JOIN "quote_request_details" qrd ON qrd."quoteRequestId" = qr."id"
    WHERE qv."id" = ${quoteVersionId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function assertBuildableRequest(request: LockedQuoteRequest): void {
  if (!QUOTE_BUILDABLE_REQUEST_STATUSES.includes(request.status)) {
    conflict('La solicitud todavía no está lista para cotizar.');
  }
}

function assertSameCurrency(first: string, second: string): void {
  let normalizedFirst: string;
  let normalizedSecond: string;
  try {
    normalizedFirst = normalizeCurrencyCode(first);
    normalizedSecond = normalizeCurrencyCode(second);
  } catch {
    validation('La moneda de la cotización no es válida.');
  }
  if (normalizedFirst !== normalizedSecond) conflict('La moneda de la cotización no coincide con la solicitud.');
}

async function resolvePricingSnapshot(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  priceListId: string,
  lines: readonly QuotePricingLineInput[],
  at: Date,
): Promise<ReturnType<typeof buildQuoteVersionSnapshot>> {
  const normalizedPriceListId = requireUuid(priceListId, 'La lista de precios no es válida.');
  if (lines.length < 1 || lines.length > 100) validation('La cotización debe contener entre 1 y 100 conceptos.');
  const normalizedLines = lines.map(normalizePricingLine);
  const itemIds = normalizedLines.map(({ catalogItemId }) => catalogItemId);
  if (new Set(itemIds).size !== itemIds.length) validation('No se puede repetir un concepto dentro de la misma versión.');

  const priceList = await transaction.priceList.findUnique({
    where: { id: normalizedPriceListId },
    include: {
      items: {
        where: {
          catalogItemId: { in: itemIds },
          validFrom: { lte: at },
          OR: [{ validUntil: null }, { validUntil: { gt: at } }],
          catalogItem: { status: 'ACTIVE' },
        },
        include: { catalogItem: true },
      },
    },
  });
  if (!priceList || priceList.status !== 'ACTIVE' || priceList.validFrom > at || (priceList.validUntil && priceList.validUntil <= at)) {
    conflict('La lista de precios no está vigente.');
  }

  let currencyCode: string;
  try {
    currencyCode = normalizeCurrencyCode(priceList.currencyCode);
  } catch {
    validation('La moneda de la lista de precios no es válida.');
  }
  const pricesByItem = new Map(priceList.items.map((price) => [price.catalogItemId, price]));
  if (pricesByItem.size !== itemIds.length) conflict('Uno o más conceptos no tienen precio vigente.');

  const snapshotLines: QuoteLineSnapshotInput[] = normalizedLines.map((line) => {
    const price = pricesByItem.get(line.catalogItemId);
    if (!price) conflict('Uno o más conceptos no tienen precio vigente.');
    if (line.unitPriceMinorOverride !== undefined) requireEmployeePermission(actor, 'quotes.edit_prices');
    const discountBasisPoints = normalizeBasisPoints(line.discountBasisPoints ?? 0);
    if (discountBasisPoints > 0) requireEmployeePermission(actor, 'quotes.apply_discount');
    let unitPrice;
    try {
      unitPrice = createMoney(line.unitPriceMinorOverride ?? price.unitPriceMinor, currencyCode);
    } catch {
      validation('El precio de la línea no es válido.');
    }
    return {
      catalogItemId: price.catalogItem.id,
      catalogItemCode: price.catalogItem.code,
      name: price.catalogItem.name,
      description: price.catalogItem.description,
      unit: price.catalogItem.unit,
      quantity: parseQuantity(line.quantity),
      unitPrice,
      discountBasisPoints,
      taxBasisPoints: normalizeBasisPoints(line.taxBasisPoints ?? 0),
    };
  });

  try {
    return buildQuoteVersionSnapshot(snapshotLines);
  } catch (error) {
    if (error instanceof AppError) throw error;
    validation('No fue posible calcular la cotización con los datos recibidos.');
  }
}

function versionTotalsData(snapshot: ReturnType<typeof buildQuoteVersionSnapshot>) {
  return {
    currencyCode: snapshot.currency,
    subtotalMinor: snapshot.subtotal.amountMinor,
    discountTotalMinor: snapshot.discountTotal.amountMinor,
    taxableTotalMinor: snapshot.taxableTotal.amountMinor,
    taxTotalMinor: snapshot.taxTotal.amountMinor,
    totalMinor: snapshot.total.amountMinor,
  };
}

function versionCreateData(snapshot: ReturnType<typeof buildQuoteVersionSnapshot>) {
  return {
    ...versionTotalsData(snapshot),
    lines: {
      create: snapshot.lines.map((line) => ({
        catalogItemId: line.catalogItemId,
        catalogItemCode: line.catalogItemCode,
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantityMilliunits: line.quantity.milliunits,
        currencyCode: line.unitPrice.currency,
        unitPriceMinor: line.unitPrice.amountMinor,
        discountBasisPoints: line.discountBasisPoints,
        discountMinor: line.discount.amountMinor,
        taxableMinor: line.taxable.amountMinor,
        taxBasisPoints: line.taxBasisPoints,
        taxMinor: line.tax.amountMinor,
        subtotalMinor: line.subtotal.amountMinor,
        totalMinor: line.total.amountMinor,
      })),
    },
  };
}

function toResult(input: {
  quoteId: string;
  versionId: string;
  versionNumber: number;
  folio: string;
  status: QuoteVersionStatus;
  snapshot: ReturnType<typeof buildQuoteVersionSnapshot>;
}): QuoteVersionResult {
  return {
    quoteId: input.quoteId,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    folio: input.folio,
    status: input.status,
    currencyCode: input.snapshot.currency,
    subtotalMinor: input.snapshot.subtotal.amountMinor,
    discountTotalMinor: input.snapshot.discountTotal.amountMinor,
    taxableTotalMinor: input.snapshot.taxableTotal.amountMinor,
    taxTotalMinor: input.snapshot.taxTotal.amountMinor,
    totalMinor: input.snapshot.total.amountMinor,
  };
}

export async function createQuoteVersion(actor: Actor, input: CreateQuoteVersionInput, dependencies: QuoteServiceDependencies = {}): Promise<QuoteVersionResult> {
  requireEmployeePermission(actor, 'quotes.create');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const quoteRequestId = requireUuid(input.quoteRequestId, 'La solicitud no es válida.');
  const validUntil = normalizeDate(input.validUntil, now);

  return prisma.$transaction(async (transaction) => {
    const request = await lockQuoteRequest(transaction, quoteRequestId);
    if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
    assertBuildableRequest(request);
    const snapshot = await resolvePricingSnapshot(transaction, actor, input.priceListId, input.lines, now);
    assertSameCurrency(request.currencyCode, snapshot.currency);

    const existingQuote = await transaction.quote.findUnique({ where: { quoteRequestId }, select: { id: true } });
    let quote: LockedQuote | { id: string };
    let currentVersion: { id: string; versionNumber: number; status: QuoteVersionStatus; currencyCode: string } | null = null;

    if (!existingQuote) {
      if (input.expectedCurrentVersionNumber !== undefined && input.expectedCurrentVersionNumber !== null) conflict('La versión esperada no coincide.');
      quote = await transaction.quote.create({ data: { quoteRequestId, clientId: request.clientId } });
    } else {
      const lockedQuote = await lockQuote(transaction, existingQuote.id);
      if (!lockedQuote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
      quote = lockedQuote;
      const baseVersionId = lockedQuote.workingVersionId ?? lockedQuote.publishedVersionId ?? lockedQuote.currentVersionId;
      currentVersion = baseVersionId
        ? await transaction.quoteVersion.findUnique({ where: { id: baseVersionId }, select: { id: true, versionNumber: true, status: true, currencyCode: true } })
        : null;
      if (!currentVersion) conflict('La cotización no tiene una versión vigente.');
      if (currentVersion.status === 'BORRADOR') conflict('Ya existe un borrador editable para esta cotización.');
      if (lockedQuote.workingVersionId) conflict('La cotización tiene una versión en revisión pendiente de resolución.');
      if (input.expectedCurrentVersionNumber !== undefined && input.expectedCurrentVersionNumber !== currentVersion.versionNumber) conflict('La versión esperada ya cambió.');
      assertSameCurrency(currentVersion.currencyCode, snapshot.currency);
    }

    const versionNumber = currentVersion ? currentVersion.versionNumber + 1 : 1;
    const version = await transaction.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNumber,
        status: 'BORRADOR',
        validUntil,
        createdById: actor.userId,
        ...versionCreateData(snapshot),
        statusHistory: { create: { toStatus: 'BORRADOR', changedById: actor.userId, createdAt: now } },
      },
    });
    await transaction.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id, workingVersionId: version.id } });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote.version.created',
        entityType: 'quote_version',
        entityId: version.id,
        outcome: 'SUCCESS',
        metadata: { quoteId: quote.id, quoteRequestId, folio: request.folio, versionNumber, currencyCode: snapshot.currency },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'QUOTE.VERSION_CREATED',
        aggregateType: 'QUOTE',
        aggregateId: quote.id,
        payload: { quoteId: quote.id, quoteVersionId: version.id, quoteRequestId, folio: request.folio, versionNumber },
      },
    });
    return toResult({ quoteId: quote.id, versionId: version.id, versionNumber, folio: request.folio, status: 'BORRADOR', snapshot });
  });
}

export async function replaceQuoteDraft(actor: Actor, quoteVersionId: string, input: ReplaceQuoteDraftInput, dependencies: QuoteServiceDependencies = {}): Promise<QuoteVersionResult> {
  requireEmployeePermission(actor, 'quotes.create');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const versionId = requireUuid(quoteVersionId, 'La versión no es válida.');
  const validUntil = normalizeDate(input.validUntil, now);

  return prisma.$transaction(async (transaction) => {
    const version = await lockQuoteVersion(transaction, versionId);
    if (!version) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);
    if (version.workingVersionId !== version.id || version.status !== 'BORRADOR') conflict('La versión ya no es editable.');
    const request: LockedQuoteRequest = {
      id: version.quoteRequestId,
      folio: version.folio,
      clientId: '',
      status: version.requestStatus,
      currencyCode: version.requestCurrencyCode,
    };
    assertBuildableRequest(request);
    const snapshot = await resolvePricingSnapshot(transaction, actor, input.priceListId, input.lines, now);
    assertSameCurrency(version.currencyCode, snapshot.currency);
    const updated = await transaction.quoteVersion.update({
      where: { id: version.id },
      data: {
        validUntil,
        ...versionTotalsData(snapshot),
      },
    });
    await transaction.quoteLineSnapshot.deleteMany({ where: { quoteVersionId: version.id } });
    await transaction.quoteLineSnapshot.createMany({ data: snapshot.lines.map((line) => ({
      quoteVersionId: version.id,
      catalogItemId: line.catalogItemId,
      catalogItemCode: line.catalogItemCode,
      name: line.name,
      description: line.description,
      unit: line.unit,
      quantityMilliunits: line.quantity.milliunits,
      currencyCode: line.unitPrice.currency,
      unitPriceMinor: line.unitPrice.amountMinor,
      discountBasisPoints: line.discountBasisPoints,
      discountMinor: line.discount.amountMinor,
      taxableMinor: line.taxable.amountMinor,
      taxBasisPoints: line.taxBasisPoints,
      taxMinor: line.tax.amountMinor,
      subtotalMinor: line.subtotal.amountMinor,
      totalMinor: line.total.amountMinor,
    })) });
    await transaction.quoteApproval.updateMany({
      where: { quoteVersionId: version.id, status: { in: ['REQUESTED', 'APPROVED'] } },
      data: { status: 'SUPERSEDED', decidedAt: null, decidedById: null },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote.version.updated',
        entityType: 'quote_version',
        entityId: version.id,
        outcome: 'SUCCESS',
        metadata: { quoteId: version.quoteId, quoteRequestId: version.quoteRequestId, folio: version.folio, versionNumber: version.versionNumber },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'QUOTE.VERSION_UPDATED',
        aggregateType: 'QUOTE',
        aggregateId: version.quoteId,
        payload: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: version.quoteRequestId, folio: version.folio, versionNumber: version.versionNumber },
      },
    });
    return toResult({ quoteId: version.quoteId, versionId: updated.id, versionNumber: version.versionNumber, folio: version.folio, status: 'BORRADOR', snapshot });
  });
}

function requiredPermissionForTransition(status: QuoteVersionStatus): string {
  if (status === 'EN_REVISION') return 'quotes.create';
  return 'quotes.send';
}

export async function transitionQuoteVersion(actor: Actor, quoteVersionId: string, toStatus: QuoteVersionStatus, dependencies: QuoteServiceDependencies = {}): Promise<{ versionId: string; quoteId: string; fromStatus: QuoteVersionStatus; toStatus: QuoteVersionStatus }> {
  if (toStatus === 'ACEPTADA') conflict('La aceptación digital todavía no está habilitada.');
  requireEmployeePermission(actor, requiredPermissionForTransition(toStatus));
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const versionId = requireUuid(quoteVersionId, 'La versión no es válida.');

  return prisma.$transaction(async (transaction) => {
    const version = await lockQuoteVersion(transaction, versionId);
    if (!version) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);
    if (version.workingVersionId !== version.id && !(version.publishedVersionId === version.id && version.status !== 'BORRADOR' && version.status !== 'EN_REVISION')) conflict('Sólo la versión vigente puede cambiar de estado.');
    if (!canTransitionQuoteVersion(version.status, toStatus)) conflict('La transición de cotización no está permitida.');
    if (toStatus === 'ENVIADA' && version.discountTotalMinor > 0n) {
      if (!(await hasValidApprovedQuoteApproval(transaction, version.id, 'DISCOUNT', now))) {
        conflict('La cotización requiere una aprobación vigente antes de enviarse.');
      }
    }
    if (toStatus === 'ENVIADA' && await transaction.quoteLineSnapshot.count({ where: { quoteVersionId: version.id } }) === 0) {
      conflict('No se puede enviar una cotización sin conceptos.');
    }
    const remainsWorking = toStatus === 'BORRADOR' || toStatus === 'EN_REVISION';
    await transaction.quoteVersion.update({ where: { id: version.id }, data: { status: toStatus } });
    await transaction.quote.update({
      where: { id: version.quoteId },
      data: {
        currentVersionId: version.id,
        workingVersionId: remainsWorking ? version.id : null,
        publishedVersionId: toStatus === 'ENVIADA' ? version.id : version.publishedVersionId,
      },
    });
    if (toStatus === 'BORRADOR') {
      await transaction.quoteApproval.updateMany({
        where: { quoteVersionId: version.id, status: { in: ['REQUESTED', 'APPROVED'] } },
        data: { status: 'SUPERSEDED', decidedAt: null, decidedById: null },
      });
    }
    await transaction.quoteStatusHistory.create({ data: { quoteVersionId: version.id, fromStatus: version.status, toStatus, changedById: actor.userId, createdAt: now } });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote.version.status_changed',
        entityType: 'quote_version',
        entityId: version.id,
        outcome: 'SUCCESS',
        metadata: { quoteId: version.quoteId, quoteRequestId: version.quoteRequestId, folio: version.folio, fromStatus: version.status, toStatus },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'QUOTE.VERSION_STATUS_CHANGED',
        aggregateType: 'QUOTE',
        aggregateId: version.quoteId,
        payload: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: version.quoteRequestId, folio: version.folio, fromStatus: version.status, toStatus },
      },
    });

    if (toStatus === 'ENVIADA' && version.requestStatus === 'EN_ELABORACION' && canTransitionQuoteRequest(version.requestStatus, 'COTIZACION_DISPONIBLE')) {
      await transaction.quoteRequest.update({ where: { id: version.quoteRequestId }, data: { status: 'COTIZACION_DISPONIBLE' } });
      await transaction.requestStatusHistory.create({ data: { quoteRequestId: version.quoteRequestId, fromStatus: version.requestStatus, toStatus: 'COTIZACION_DISPONIBLE', changedById: actor.userId, createdAt: now } });
      await transaction.auditLog.create({ data: { actorUserId: actor.userId, action: 'quote_request.status_changed', entityType: 'quote_request', entityId: version.quoteRequestId, outcome: 'SUCCESS', metadata: { folio: version.folio, fromStatus: version.requestStatus, toStatus: 'COTIZACION_DISPONIBLE', source: 'quote.version.status_changed' } } });
      await transaction.outboxEvent.create({ data: { eventType: 'REQUEST.STATUS_CHANGED', aggregateType: 'QUOTE_REQUEST', aggregateId: version.quoteRequestId, payload: { quoteRequestId: version.quoteRequestId, folio: version.folio, fromStatus: version.requestStatus, toStatus: 'COTIZACION_DISPONIBLE' } } });
    }
    return { versionId: version.id, quoteId: version.quoteId, fromStatus: version.status, toStatus };
  });
}

/**
 * Publicación comercial: el documento debe quedar listo antes de que la
 * transición ENVIADA escriba su evento de publicación/notificación. La ruta
 * de estado usa esta operación; `transitionQuoteVersion` queda como primitive
 * de dominio para transiciones internas y pruebas de máquina de estados.
 */
export async function publishQuoteVersion(actor: Actor, quoteVersionId: string, dependencies: QuoteServiceDependencies = {}) {
  requireEmployeePermission(actor, 'quotes.send');
  await generateQuotePdf(actor, quoteVersionId, { prisma: dependencies.prisma, now: dependencies.now });
  return transitionQuoteVersion(actor, quoteVersionId, 'ENVIADA', dependencies);
}
