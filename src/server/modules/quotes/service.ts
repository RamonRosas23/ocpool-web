import { createHash, randomUUID } from 'node:crypto';
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
import { getQuoteVersionDigest, hasValidApprovedQuoteApproval } from '@/server/modules/quotes/approval-service';
import { generateQuotePdf, invalidateQuoteVersionDocument } from '@/server/modules/quote-documents/service';
import { provisionCustomerPortalAccess } from '@/server/modules/customer-onboarding/service';
import { requireStaffRequestReadScope } from '@/server/auth/request-scope';

export type CatalogPricingLineInput = Readonly<{
  catalogItemId: string;
  quantity: string;
  unitPriceMinorOverride?: string | bigint;
  discountBasisPoints?: string | number | bigint;
  taxBasisPoints?: string | number | bigint;
  /// Q1-03: index into this same request's `sections` array. Omitted/null
  /// means the line stands alone, outside any section.
  sectionIndex?: number | null;
}>;

export type SpecialPricingLineInput = Readonly<{
  special: true;
  name: string;
  description?: string | null;
  unit: string;
  quantity: string;
  unitPriceMinor: string | bigint;
  reason: string;
  discountBasisPoints?: string | number | bigint;
  taxBasisPoints?: string | number | bigint;
  sectionIndex?: number | null;
}>;

export type QuotePricingLineInput = CatalogPricingLineInput | SpecialPricingLineInput;

/// Q1-03/D1-02: a named grouping of lines (title + optional description),
/// stored as its own snapshot table so a section's own text is versioned
/// exactly like everything else. Position is the array order submitted.
export type QuoteSectionInput = Readonly<{ title: string; description?: string | null }>;

/// Q1-03/D1-02: structured commercial content, published verbatim to
/// client/PDF once the version is sent. All optional/nullable -- a version
/// with none of this filled in is still a valid, sendable quote.
export type QuoteContentInput = Readonly<{
  scopeText?: string | null;
  exclusionsText?: string | null;
  paymentTermsText?: string | null;
  warrantyText?: string | null;
  publicNotesText?: string | null;
}>;

export type CreateQuoteVersionInput = Readonly<{
  quoteRequestId: string;
  priceListId: string;
  lines: readonly QuotePricingLineInput[];
  sections?: readonly QuoteSectionInput[];
  validUntil?: Date | null;
  expectedCurrentVersionNumber?: number | null;
  /// K1-04: when provided, its rate overrides every line's tax uniformly.
  /// Omitted keeps the exact prior per-line behavior (see resolveTaxProfile).
  taxProfileId?: string;
}> & QuoteContentInput;

export type ReplaceQuoteDraftInput = Readonly<{
  priceListId: string;
  lines: readonly QuotePricingLineInput[];
  sections?: readonly QuoteSectionInput[];
  validUntil?: Date | null;
  expectedUpdatedAt?: Date;
  taxProfileId?: string;
}> & QuoteContentInput;

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
  currentAssigneeId: string | null;
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
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  commercialPolicyId: string | null;
  termsVersionId: string | null;
  revision: number;
  contentDigest: string | null;
  updatedAt: Date;
  currentVersionId: string | null;
  workingVersionId: string | null;
  publishedVersionId: string | null;
  quoteRequestId: string;
  folio: string;
  requestStatus: QuoteRequestStatus;
  requestCurrencyCode: string;
  currentAssigneeId: string | null;
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

const MAX_CONTENT_FIELD_LENGTH = 10_000;

function normalizeContentField(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_CONTENT_FIELD_LENGTH) validation('El contenido de la propuesta excede la longitud permitida.');
  return trimmed;
}

function normalizeContentFields(input: QuoteContentInput) {
  return {
    scopeText: normalizeContentField(input.scopeText),
    exclusionsText: normalizeContentField(input.exclusionsText),
    paymentTermsText: normalizeContentField(input.paymentTermsText),
    warrantyText: normalizeContentField(input.warrantyText),
    publicNotesText: normalizeContentField(input.publicNotesText),
  };
}

const MAX_SECTION_TITLE_LENGTH = 180;
const MAX_SECTION_DESCRIPTION_LENGTH = 2_000;
const MAX_SECTIONS_PER_VERSION = 20;

type NormalizedSection = Readonly<{ id: string; position: number; title: string; description: string | null }>;

/// Q1-03: sections are wholesale-replaced on every save, exactly like lines
/// already are -- IDs are generated here (not left to the DB default) so a
/// line submitted in the same request can reference its section by array
/// index without a round-trip.
function normalizeSections(sections: readonly QuoteSectionInput[] | undefined): NormalizedSection[] {
  if (!sections || sections.length === 0) return [];
  if (sections.length > MAX_SECTIONS_PER_VERSION) validation('No se pueden crear más de 20 secciones.');
  return sections.map((section, position) => {
    const title = section.title.trim();
    if (!title || title.length > MAX_SECTION_TITLE_LENGTH) validation('El título de la sección no es válido.');
    const description = section.description?.trim() || null;
    if (description && description.length > MAX_SECTION_DESCRIPTION_LENGTH) validation('La descripción de la sección no es válida.');
    return { id: randomUUID(), position, title, description };
  });
}

function resolveLineSectionIds(lines: readonly QuotePricingLineInput[], sections: readonly NormalizedSection[]): Array<string | null> {
  return lines.map((line) => {
    const index = line.sectionIndex;
    if (index === undefined || index === null) return null;
    const section = sections[index];
    if (!section) validation('La sección de una línea no es válida.');
    return section.id;
  });
}

function normalizeDate(value: Date | null | undefined, now: Date): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value <= now) validation('La vigencia de la cotización no es válida.');
  return value;
}

function normalizePricingLine(line: QuotePricingLineInput): QuotePricingLineInput {
  try {
    parseQuantity(line.quantity);
    normalizeBasisPoints(line.discountBasisPoints ?? 0);
    normalizeBasisPoints(line.taxBasisPoints ?? 0);
  } catch {
    validation('La línea de cotización no es válida.');
  }
  if ('special' in line) {
    if (typeof line.unitPriceMinor === 'bigint' ? line.unitPriceMinor < 0n : typeof line.unitPriceMinor !== 'string' || !/^\d+$/u.test(line.unitPriceMinor.trim())) {
      validation('El precio de la línea no es válido.');
    }
    return line;
  }
  const catalogItemId = requireUuid(line.catalogItemId, 'El concepto no es válido.');
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
    SELECT qr."id", qr."folio", qr."clientId", qr."status", qr."currentAssigneeId", qrd."currencyCode"
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
    SELECT qv."id", qv."quoteId", qv."versionNumber", qv."status", qv."currencyCode", qv."subtotalMinor", qv."discountTotalMinor", qv."commercialPolicyId", qv."termsVersionId", qv."revision", qv."contentDigest", qv."updatedAt", q."currentVersionId", q."workingVersionId", q."publishedVersionId",
           q."quoteRequestId", qr."folio", qr."status" AS "requestStatus", qr."currentAssigneeId", qrd."currencyCode" AS "requestCurrencyCode"
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

type PricingSnapshotResult = Readonly<{
  snapshot: ReturnType<typeof buildQuoteVersionSnapshot>;
  taxProfileId: string | null;
}>;

/// K1-04/D1-03: when a tax profile is provided, its rate overrides every line's
/// tax uniformly (a quote has one applicable IVA zone, not a per-line choice) --
/// this is what lets the UI stop asking sales to type a rate on every line.
/// Omitting it keeps the exact prior behavior (per-line client value, default
/// 0) so every existing caller/test that never knew about tax profiles is
/// unaffected.
async function resolveTaxProfile(transaction: Prisma.TransactionClient, taxProfileId: string | undefined): Promise<{ id: string; ratePercentBasisPoints: number } | null> {
  if (taxProfileId === undefined) return null;
  const normalizedId = requireUuid(taxProfileId, 'El perfil fiscal no es válido.');
  const profile = await transaction.taxProfileVersion.findUnique({ where: { id: normalizedId }, select: { id: true, active: true, ratePercentBasisPoints: true } });
  if (!profile || !profile.active) conflict('El perfil fiscal seleccionado no está vigente.');
  return profile;
}

async function resolvePricingSnapshot(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  priceListId: string,
  lines: readonly QuotePricingLineInput[],
  at: Date,
  previousPricesByItem?: ReadonlyMap<string, bigint>,
  taxProfileId?: string,
): Promise<PricingSnapshotResult> {
  const normalizedPriceListId = requireUuid(priceListId, 'La lista de precios no es válida.');
  if (lines.length < 1 || lines.length > 100) validation('La cotización debe contener entre 1 y 100 conceptos.');
  const resolvedTaxProfile = await resolveTaxProfile(transaction, taxProfileId);
  const normalizedLines = lines.map(normalizePricingLine);
  const catalogLines = normalizedLines.filter((line): line is CatalogPricingLineInput => !('special' in line));
  const itemIds = catalogLines.map(({ catalogItemId }) => catalogItemId);
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
    const discountBasisPoints = normalizeBasisPoints(line.discountBasisPoints ?? 0);
    if (discountBasisPoints > 0) requireEmployeePermission(actor, 'quotes.apply_discount');
    const taxBasisPoints = resolvedTaxProfile ? resolvedTaxProfile.ratePercentBasisPoints : normalizeBasisPoints(line.taxBasisPoints ?? 0);

    if ('special' in line) {
      let unitPrice;
      try {
        unitPrice = createMoney(line.unitPriceMinor, currencyCode);
      } catch {
        validation('El precio de la línea no es válido.');
      }
      return {
        catalogItemId: null,
        catalogItemCode: null,
        name: line.name,
        description: line.description,
        unit: line.unit,
        specialReason: line.reason,
        quantity: parseQuantity(line.quantity),
        unitPrice,
        discountBasisPoints,
        taxBasisPoints,
      };
    }

    const price = pricesByItem.get(line.catalogItemId);
    if (!price) conflict('Uno o más conceptos no tienen precio vigente.');
    if (line.unitPriceMinorOverride !== undefined) {
      const overrideMinor = BigInt(line.unitPriceMinorOverride);
      const previousMinor = previousPricesByItem?.get(line.catalogItemId);
      // Reenviar el mismo precio ya congelado en esta versión (fidelidad S0-02 en cada autosave)
      // no es un override real y no debe exigir el permiso; sólo un valor que de verdad cambia lo exige.
      if (previousMinor === undefined || previousMinor !== overrideMinor) requireEmployeePermission(actor, 'quotes.edit_prices');
    }
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
      taxBasisPoints,
    };
  });

  try {
    return { snapshot: buildQuoteVersionSnapshot(snapshotLines), taxProfileId: resolvedTaxProfile?.id ?? null };
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

function versionCreateData(snapshot: ReturnType<typeof buildQuoteVersionSnapshot>, taxProfileId: string | null) {
  return {
    ...versionTotalsData(snapshot),
    taxProfileId,
  };
}

/// Q1-03: sections must be inserted before the lines that reference them --
/// nesting both under the same `quoteVersion.create()` would leave Prisma
/// free to order the two nested writes either way, and a line's `sectionId`
/// FK would fail if its section hadn't landed yet. Two explicit, awaited
/// `createMany` calls (still inside the same transaction) guarantee the order.
function buildSectionRows(quoteVersionId: string, sections: readonly NormalizedSection[]) {
  return sections.map((section) => ({ id: section.id, quoteVersionId, position: section.position, title: section.title, description: section.description }));
}

function buildLineRows(quoteVersionId: string, snapshot: ReturnType<typeof buildQuoteVersionSnapshot>, sectionIdsByLine: readonly (string | null)[]) {
  return snapshot.lines.map((line, position) => ({
    quoteVersionId,
    position,
    sectionId: sectionIdsByLine[position] ?? null,
    catalogItemId: line.catalogItemId,
    catalogItemCode: line.catalogItemCode,
    name: line.name,
    description: line.description,
    unit: line.unit,
    specialReason: line.specialReason,
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
  }));
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
    requireStaffRequestReadScope(actor, request.currentAssigneeId);
    assertBuildableRequest(request);
    const { snapshot, taxProfileId } = await resolvePricingSnapshot(transaction, actor, input.priceListId, input.lines, now, undefined, input.taxProfileId);
    assertSameCurrency(request.currencyCode, snapshot.currency);
    const sections = normalizeSections(input.sections);
    const sectionIdsByLine = resolveLineSectionIds(input.lines, sections);

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
        ...versionCreateData(snapshot, taxProfileId),
        ...normalizeContentFields(input),
        statusHistory: { create: { toStatus: 'BORRADOR', changedById: actor.userId, createdAt: now } },
      },
    });
    if (sections.length > 0) await transaction.quoteSectionSnapshot.createMany({ data: buildSectionRows(version.id, sections) });
    await transaction.quoteLineSnapshot.createMany({ data: buildLineRows(version.id, snapshot, sectionIdsByLine) });
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
    requireStaffRequestReadScope(actor, version.currentAssigneeId);
    if (version.workingVersionId !== version.id || version.status !== 'BORRADOR') conflict('La versión ya no es editable.');
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt.getTime() !== version.updatedAt.getTime()) {
      conflict('La versión cambió desde la última lectura. Recarga el borrador antes de guardar.');
    }
    const request: LockedQuoteRequest = {
      id: version.quoteRequestId,
      folio: version.folio,
      clientId: '',
      status: version.requestStatus,
      currencyCode: version.requestCurrencyCode,
      currentAssigneeId: version.currentAssigneeId,
    };
    assertBuildableRequest(request);
    const existingLines = await transaction.quoteLineSnapshot.findMany({
      where: { quoteVersionId: version.id, catalogItemId: { not: null } },
      select: { catalogItemId: true, unitPriceMinor: true },
    });
    const previousPricesByItem = new Map(existingLines.map((line) => [line.catalogItemId as string, line.unitPriceMinor]));
    const { snapshot, taxProfileId } = await resolvePricingSnapshot(transaction, actor, input.priceListId, input.lines, now, previousPricesByItem, input.taxProfileId);
    assertSameCurrency(version.currencyCode, snapshot.currency);
    const sections = normalizeSections(input.sections);
    const sectionIdsByLine = resolveLineSectionIds(input.lines, sections);
    const updated = await transaction.quoteVersion.update({
      where: { id: version.id },
      data: {
        validUntil,
        taxProfileId,
        ...versionTotalsData(snapshot),
        ...normalizeContentFields(input),
      },
    });
    await transaction.quoteLineSnapshot.deleteMany({ where: { quoteVersionId: version.id } });
    await transaction.quoteSectionSnapshot.deleteMany({ where: { quoteVersionId: version.id } });
    if (sections.length > 0) await transaction.quoteSectionSnapshot.createMany({ data: buildSectionRows(version.id, sections) });
    await transaction.quoteLineSnapshot.createMany({ data: buildLineRows(version.id, snapshot, sectionIdsByLine) });
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

/// A1-01/BIZ-06/BIZ-07: resolve the discount-approval threshold from the
/// version's own frozen policy when it has one (so a later policy change
/// never retroactively changes what an existing version already required),
/// falling back to the currently active default policy for versions created
/// before D1-03. If neither exists, fail closed -- ANY discount requires
/// approval, matching the original V1 policy default -- rather than silently
/// skip the control.
export async function resolveDiscountApprovalThresholdBps(transaction: Prisma.TransactionClient, commercialPolicyId: string | null): Promise<number> {
  const policy = commercialPolicyId
    ? await transaction.commercialPolicyVersion.findUnique({ where: { id: commercialPolicyId }, select: { discountApprovalThresholdBps: true } })
    : await transaction.commercialPolicyVersion.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' }, select: { discountApprovalThresholdBps: true } });
  return policy?.discountApprovalThresholdBps ?? 0;
}

/// P1-01/C1-05: shared by the publish path (freezes `termsVersionId` so a later change of the
/// active terms never rewrites what an already-published version pointed to) and by the customer
/// portal/acceptance (reads the exact terms a specific version was frozen to, falling back to
/// whatever is active for a version published before this existed, same fallback shape as
/// `resolveDiscountApprovalThresholdBps`). A version's own `termsVersionId`, once frozen, always
/// wins over "whatever is active now" -- that is the entire point of freezing it.
export async function resolveCommercialTermsRecord(transaction: Prisma.TransactionClient, termsVersionId: string | null): Promise<{ id: string; versionTag: string; title: string }> {
  const terms = termsVersionId
    ? await transaction.commercialTermsVersion.findUnique({ where: { id: termsVersionId }, select: { id: true, versionTag: true, title: true } })
    : await transaction.commercialTermsVersion.findFirst({ where: { active: true }, orderBy: { publishedAt: 'desc' }, select: { id: true, versionTag: true, title: true } });
  if (!terms) conflict('No hay términos y condiciones vigentes configurados.');
  return terms;
}

type PerformTransitionOptions = Readonly<{
  reason?: string | null;
  auditAction?: string;
  outboxEventType?: string;
  /// P1-05: the digest the caller reviewed at preflight time (see
  /// `GET .../document` — it now also returns the live digest). Omitting it
  /// preserves the exact pre-P1-05 behaviour (no check, no idempotent retry).
  expectedContentDigest?: string;
  /// P1-01/P1-05: the READY document to attach to this publication. Required
  /// by `publishQuoteVersion` for any real ENVIADA transition; irrelevant for
  /// every other transition.
  documentId?: string;
}>;

async function performQuoteVersionTransition(actor: Actor, quoteVersionId: string, toStatus: QuoteVersionStatus, options: PerformTransitionOptions, dependencies: QuoteServiceDependencies): Promise<{ versionId: string; quoteId: string; fromStatus: QuoteVersionStatus; toStatus: QuoteVersionStatus }> {
  if (toStatus === 'ACEPTADA') conflict('La aceptación digital todavía no está habilitada.');
  requireEmployeePermission(actor, requiredPermissionForTransition(toStatus));
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const versionId = requireUuid(quoteVersionId, 'La versión no es válida.');
  const auditAction = options.auditAction ?? 'quote.version.status_changed';
  const outboxEventType = options.outboxEventType ?? 'QUOTE.VERSION_STATUS_CHANGED';

  return prisma.$transaction(async (transaction) => {
    const version = await lockQuoteVersion(transaction, versionId);
    if (!version) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);
    requireStaffRequestReadScope(actor, version.currentAssigneeId);
    if (version.workingVersionId !== version.id && !(version.publishedVersionId === version.id && version.status !== 'BORRADOR' && version.status !== 'EN_REVISION')) conflict('Sólo la versión vigente puede cambiar de estado.');
    // P1-05: computed unconditionally whenever the target is ENVIADA (needed either way to freeze
    // `contentDigest` below), but only ever COMPARED against something when the caller opted in by
    // passing `expectedContentDigest` -- every existing caller that omits it keeps the exact prior
    // behaviour, including the CONFLICT this used to throw unconditionally on ENVIADA -> ENVIADA.
    const freshContentDigest = toStatus === 'ENVIADA' && (options.documentId !== undefined || options.expectedContentDigest !== undefined)
      ? await getQuoteVersionDigest(transaction, version.id)
      : null;
    if (toStatus === 'ENVIADA' && options.expectedContentDigest !== undefined) {
      if (version.status === 'ENVIADA' && version.publishedVersionId === version.id) {
        if (freshContentDigest !== version.contentDigest || freshContentDigest !== options.expectedContentDigest) {
          conflict('La cotización ya fue enviada con un contenido distinto.');
        }
        // Idempotent retry: an earlier attempt already published this exact content (e.g. the client
        // never saw the success response and retried) -- return the same receipt, not a fresh error.
        return { versionId: version.id, quoteId: version.quoteId, fromStatus: version.status, toStatus };
      }
      if (freshContentDigest !== options.expectedContentDigest) {
        conflict('El contenido cambió desde que se abrió la confirmación de envío. Vuelve a revisarlo.');
      }
    }
    if (!canTransitionQuoteVersion(version.status, toStatus)) conflict('La transición de cotización no está permitida.');
    if (toStatus === 'ENVIADA' && version.discountTotalMinor > 0n) {
      const discountRatioBps = version.subtotalMinor > 0n ? (version.discountTotalMinor * 10_000n) / version.subtotalMinor : 10_000n;
      const thresholdBps = await resolveDiscountApprovalThresholdBps(transaction, version.commercialPolicyId);
      if (discountRatioBps > BigInt(thresholdBps) && !(await hasValidApprovedQuoteApproval(transaction, version.id, 'DISCOUNT', now))) {
        conflict('La cotización requiere una aprobación vigente antes de enviarse.');
      }
    }
    if (toStatus === 'ENVIADA' && await transaction.quoteLineSnapshot.count({ where: { quoteVersionId: version.id, catalogItemId: null } }) > 0) {
      if (!(await hasValidApprovedQuoteApproval(transaction, version.id, 'SPECIAL_CONCEPT', now))) {
        conflict('La cotización tiene conceptos especiales y requiere una aprobación vigente antes de enviarse.');
      }
    }
    if (toStatus === 'ENVIADA' && await transaction.quoteLineSnapshot.count({ where: { quoteVersionId: version.id } }) === 0) {
      conflict('No se puede enviar una cotización sin conceptos.');
    }
    const remainsWorking = toStatus === 'BORRADOR' || toStatus === 'EN_REVISION';
    // P1-01: only a real publication (one `publishQuoteVersion` drove, carrying a READY document)
    // freezes revision/digest/terms/publishedAt -- the bare test-fixture shortcut above (no
    // `documentId`) still just flips status, exactly as it did before this piece existed.
    const resolvedTermsVersionId = toStatus === 'ENVIADA' && options.documentId ? (await resolveCommercialTermsRecord(transaction, version.termsVersionId)).id : null;
    await transaction.quoteVersion.update({
      where: { id: version.id },
      data: {
        status: toStatus,
        ...(toStatus === 'ENVIADA' && options.documentId ? {
          revision: { increment: 1 },
          contentDigest: freshContentDigest,
          publishedAt: now,
          termsVersionId: resolvedTermsVersionId,
        } : {}),
      },
    });
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
    await transaction.quoteStatusHistory.create({ data: { quoteVersionId: version.id, fromStatus: version.status, toStatus, reason: options.reason ?? null, changedById: actor.userId, createdAt: now } });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: auditAction,
        entityType: 'quote_version',
        entityId: version.id,
        outcome: 'SUCCESS',
        metadata: { quoteId: version.quoteId, quoteRequestId: version.quoteRequestId, folio: version.folio, fromStatus: version.status, toStatus, reason: options.reason ?? null },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: outboxEventType,
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
    if (toStatus === 'ENVIADA' && options.documentId) {
      // D1-04: one row per real publication, never the version row itself -- lets D2/P1 ask "when
      // and with what digest was this actually published" without inferring it from status history.
      if (version.publishedVersionId && version.publishedVersionId !== version.id) {
        await transaction.quoteVersion.update({ where: { id: version.publishedVersionId }, data: { supersededAt: now } });
        await transaction.quotePublication.updateMany({ where: { quoteVersionId: version.publishedVersionId, status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      }
      const request = await transaction.quoteRequest.findUniqueOrThrow({
        where: { id: version.quoteRequestId },
        select: { contact: { select: { email: true, user: { select: { status: true } } } } },
      });
      const publicationData = {
        documentId: options.documentId,
        termsVersionId: resolvedTermsVersionId!,
        preflightDigest: freshContentDigest!,
        // Hash only -- never the recipient email in clear, same policy already applied elsewhere
        // in the audit trail (analytics IDs, storage checksums).
        recipientEmailHash: createHash('sha256').update(request.contact.email.trim().toLowerCase()).digest('hex'),
        status: 'PUBLISHED' as const,
        publishedAt: now,
        publishedById: actor.userId,
      };
      await transaction.quotePublication.upsert({
        where: { quoteVersionId_quoteId: { quoteVersionId: version.id, quoteId: version.quoteId } },
        create: { quoteId: version.quoteId, quoteVersionId: version.id, ...publicationData },
        update: publicationData,
      });
      // P1-06: best-effort -- a first-time client gets a working portal link automatically instead
      // of self-serving through /portal/access, but an onboarding hiccup (contact/client not yet
      // ACTIVE, no customer role configured, etc.) must never block the send itself; the existing
      // QUOTE.PUBLISHED notification already falls back to the self-service path if this fails.
      if (request.contact.user?.status !== 'ACTIVE') {
        try {
          await provisionCustomerPortalAccess(actor, transaction, version.quoteRequestId, { now });
        } catch { /* best-effort, see comment above */ }
      }
    }
    return { versionId: version.id, quoteId: version.quoteId, fromStatus: version.status, toStatus };
  });
}

export async function transitionQuoteVersion(actor: Actor, quoteVersionId: string, toStatus: QuoteVersionStatus, dependencies: QuoteServiceDependencies = {}): Promise<{ versionId: string; quoteId: string; fromStatus: QuoteVersionStatus; toStatus: QuoteVersionStatus }> {
  return performQuoteVersionTransition(actor, quoteVersionId, toStatus, {}, dependencies);
}

function requireTransitionReason(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 500) validation('Indica un motivo válido para este cambio.');
  return normalized;
}

export async function submitQuoteForReview(actor: Actor, quoteVersionId: string, dependencies: QuoteServiceDependencies = {}) {
  return performQuoteVersionTransition(actor, quoteVersionId, 'EN_REVISION', {
    auditAction: 'quote.version.submitted',
    outboxEventType: 'QUOTE.VERSION_SUBMITTED',
  }, dependencies);
}

export async function returnQuoteToDraft(actor: Actor, quoteVersionId: string, input: Readonly<{ reason: string }>, dependencies: QuoteServiceDependencies = {}) {
  const result = await performQuoteVersionTransition(actor, quoteVersionId, 'BORRADOR', {
    reason: requireTransitionReason(input.reason),
    auditAction: 'quote.version.returned_to_draft',
    outboxEventType: 'QUOTE.VERSION_REOPENED',
  }, dependencies);
  // generateQuotePdf es idempotente por diseño (reutiliza el documento READY existente); sin invalidar
  // aquí, editar y reenviar publicaría el PDF con el contenido previo a la corrección.
  await invalidateQuoteVersionDocument(result.versionId, { prisma: dependencies.prisma });
  return result;
}

export async function rejectQuoteVersion(actor: Actor, quoteVersionId: string, input: Readonly<{ reason: string }>, dependencies: QuoteServiceDependencies = {}) {
  return performQuoteVersionTransition(actor, quoteVersionId, 'RECHAZADA', {
    reason: requireTransitionReason(input.reason),
    auditAction: 'quote.version.rejected',
    outboxEventType: 'QUOTE.VERSION_REJECTED',
  }, dependencies);
}

function quantityMilliunitsToDecimalString(quantityMilliunits: bigint): string {
  const whole = quantityMilliunits / 1_000n;
  const fraction = (quantityMilliunits % 1_000n).toString().padStart(3, '0').replace(/0+$/u, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export async function clonePublishedVersion(actor: Actor, quoteRequestId: string, input: Readonly<{ priceListId: string }>, dependencies: QuoteServiceDependencies = {}): Promise<QuoteVersionResult> {
  requireEmployeePermission(actor, 'quotes.create');
  const prisma = dependencies.prisma ?? getPrisma();
  const requestId = requireUuid(quoteRequestId, 'La solicitud no es válida.');
  const priceListId = requireUuid(input.priceListId, 'La lista de precios no es válida.');

  const request = await prisma.quoteRequest.findUnique({ where: { id: requestId }, select: { currentAssigneeId: true } });
  if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
  requireStaffRequestReadScope(actor, request.currentAssigneeId);

  const quote = await prisma.quote.findUnique({ where: { quoteRequestId: requestId }, select: { workingVersionId: true, publishedVersionId: true } });
  if (!quote || !quote.publishedVersionId) conflict('No hay una versión publicada para clonar.');
  if (quote.workingVersionId) conflict('Ya existe una versión de trabajo pendiente; resuélvela antes de clonar.');

  const publishedVersion = await prisma.quoteVersion.findUnique({ where: { id: quote.publishedVersionId }, select: { taxProfileId: true } });

  // Q1-03: sections carry over by identity (old section id -> new array index)
  // so cloned lines keep their grouping without needing the old section rows.
  const publishedSections = await prisma.quoteSectionSnapshot.findMany({
    where: { quoteVersionId: quote.publishedVersionId },
    orderBy: { position: 'asc' },
    select: { id: true, title: true, description: true },
  });
  const sections: QuoteSectionInput[] = publishedSections.map((section) => ({ title: section.title, description: section.description }));
  const sectionIndexById = new Map(publishedSections.map((section, index) => [section.id, index]));

  const publishedLines = await prisma.quoteLineSnapshot.findMany({
    where: { quoteVersionId: quote.publishedVersionId },
    orderBy: { position: 'asc' },
    select: { catalogItemId: true, name: true, description: true, unit: true, specialReason: true, quantityMilliunits: true, unitPriceMinor: true, discountBasisPoints: true, taxBasisPoints: true, sectionId: true },
  });

  const lines: QuotePricingLineInput[] = publishedLines.map((line) => {
    const sectionIndex = line.sectionId ? sectionIndexById.get(line.sectionId) ?? null : null;
    return line.catalogItemId === null
      ? {
        special: true as const,
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantity: quantityMilliunitsToDecimalString(line.quantityMilliunits),
        unitPriceMinor: line.unitPriceMinor,
        reason: line.specialReason ?? '',
        discountBasisPoints: line.discountBasisPoints,
        taxBasisPoints: line.taxBasisPoints,
        sectionIndex,
      }
      : {
        catalogItemId: line.catalogItemId,
        quantity: quantityMilliunitsToDecimalString(line.quantityMilliunits),
        discountBasisPoints: line.discountBasisPoints,
        taxBasisPoints: line.taxBasisPoints,
        sectionIndex,
      };
  });

  return createQuoteVersion(actor, { quoteRequestId: requestId, priceListId, lines, sections, taxProfileId: publishedVersion?.taxProfileId ?? undefined }, dependencies);
}

/**
 * Publicación comercial: el documento debe quedar listo antes de que la
 * transición ENVIADA escriba su evento de publicación/notificación. La ruta
 * de estado usa esta operación; `transitionQuoteVersion` queda como primitive
 * de dominio para transiciones internas y pruebas de máquina de estados.
 */
export async function publishQuoteVersion(actor: Actor, quoteVersionId: string, input: Readonly<{ expectedContentDigest?: string }> = {}, dependencies: QuoteServiceDependencies = {}) {
  requireEmployeePermission(actor, 'quotes.send');
  const document = await generateQuotePdf(actor, quoteVersionId, { prisma: dependencies.prisma, now: dependencies.now });
  return performQuoteVersionTransition(actor, quoteVersionId, 'ENVIADA', {
    auditAction: 'quote.version.published',
    outboxEventType: 'QUOTE.PUBLISHED',
    documentId: document.id,
    expectedContentDigest: input.expectedContentDigest,
  }, dependencies);
}
