import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { readServerEnv } from '@/server/env';
import { staffRequestReadScopeWhere } from '@/server/auth/request-scope';
import { deriveGeneratedDocumentState } from '@/server/modules/quote-documents/domain';
import { isRecoverableNotificationErrorCode } from '@/server/modules/notifications/domain';
import { getLatestAggregateNotificationDelivery } from '@/server/modules/notifications/operations';
import { resolveQuoteWorkspaceProjection, type WorkspaceApprovalStatus, type WorkspaceVersionInput } from '@/server/modules/quotes/workspace-projection';
import type { QuoteVersionStatus } from '@/server/modules/quotes/domain';
import { resolveDiscountApprovalThresholdBps } from '@/server/modules/quotes/service';

export type QuoteStaffServiceDependencies = Readonly<{ prisma?: PrismaClient; now?: Date }>;

export type QuoteWorkspaceListFilters = Readonly<{
  query?: string;
  page?: number;
  pageSize?: number;
}>;

const BUILDABLE_REQUEST_STATUSES = ['EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requireQuoteRead(actor: Actor): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'quotes.read');
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR', 'La solicitud no es válida.', 400);
  return value;
}

function normalizePagination(filters: QuoteWorkspaceListFilters): { page: number; pageSize: number } {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new AppError('VALIDATION_ERROR', 'La paginación no es válida.', 400);
  }
  return { page, pageSize };
}

function normalizeQuery(value: string | undefined): string | undefined {
  const query = value?.trim() || undefined;
  if (query && query.length > 100) throw new AppError('VALIDATION_ERROR', 'La búsqueda no es válida.', 400);
  return query;
}

function serializeBigInt(value: bigint): string {
  return value.toString();
}

function serializeLine(line: {
  id: string;
  catalogItemId: string | null;
  catalogItemCode: string | null;
  name: string;
  description: string | null;
  unit: string;
  specialReason: string | null;
  quantityMilliunits: bigint;
  currencyCode: string;
  unitPriceMinor: bigint;
  discountBasisPoints: number;
  discountMinor: bigint;
  taxableMinor: bigint;
  taxBasisPoints: number;
  taxMinor: bigint;
  subtotalMinor: bigint;
  totalMinor: bigint;
}) {
  return {
    ...line,
    quantityMilliunits: serializeBigInt(line.quantityMilliunits),
    unitPriceMinor: serializeBigInt(line.unitPriceMinor),
    discountMinor: serializeBigInt(line.discountMinor),
    taxableMinor: serializeBigInt(line.taxableMinor),
    taxMinor: serializeBigInt(line.taxMinor),
    subtotalMinor: serializeBigInt(line.subtotalMinor),
    totalMinor: serializeBigInt(line.totalMinor),
  };
}

function serializeVersion(version: {
  id: string;
  versionNumber: number;
  status: string;
  currencyCode: string;
  validUntil: Date | null;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxableTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
  taxProfileId: string | null;
  requiresDiscountApproval: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string };
  lines: Parameters<typeof serializeLine>[0][];
  approvals: Array<{
    id: string;
    type: string;
    status: string;
    policyVersion: string;
    thresholdBps: number | null;
    reason: string | null;
    requestedById: string;
    decidedById: string | null;
    requestedAt: Date;
    decidedAt: Date | null;
    expiresAt: Date | null;
  }>;
}) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    currencyCode: version.currencyCode,
    validUntil: version.validUntil,
    subtotalMinor: serializeBigInt(version.subtotalMinor),
    discountTotalMinor: serializeBigInt(version.discountTotalMinor),
    taxableTotalMinor: serializeBigInt(version.taxableTotalMinor),
    taxTotalMinor: serializeBigInt(version.taxTotalMinor),
    totalMinor: serializeBigInt(version.totalMinor),
    taxProfileId: version.taxProfileId,
    requiresDiscountApproval: version.requiresDiscountApproval,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    createdBy: version.createdBy,
    lines: version.lines.map(serializeLine),
    approvals: version.approvals.map((approval) => ({ ...approval })),
  };
}

type WorkspaceVersion = Parameters<typeof serializeVersion>[0];

function serializeVersionSummary(version: {
  id: string;
  versionNumber: number;
  status: string;
  currencyCode: string;
  validUntil: Date | null;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxableTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string };
}) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    currencyCode: version.currencyCode,
    validUntil: version.validUntil,
    subtotalMinor: serializeBigInt(version.subtotalMinor),
    discountTotalMinor: serializeBigInt(version.discountTotalMinor),
    taxableTotalMinor: serializeBigInt(version.taxableTotalMinor),
    taxTotalMinor: serializeBigInt(version.taxTotalMinor),
    totalMinor: serializeBigInt(version.totalMinor),
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    createdBy: version.createdBy,
  };
}

const DEFAULT_QUOTE_HISTORY_PAGE_SIZE = 30;
const MAX_QUOTE_HISTORY_PAGE_SIZE = 50;

type QuoteHistoryCursor = { createdAt: string; id: string };
type QuoteHistoryEntry = {
  id: string;
  quoteVersionId: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: Date;
  changedBy: { id: string; displayName: string } | null;
};

function encodeQuoteHistoryCursor(entry: { id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ createdAt: entry.createdAt.toISOString(), id: entry.id }), 'utf8').toString('base64url');
}

function decodeQuoteHistoryCursor(value: string | undefined): QuoteHistoryCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<QuoteHistoryCursor>;
    if (typeof decoded.id !== 'string' || !UUID_PATTERN.test(decoded.id) || typeof decoded.createdAt !== 'string' || Number.isNaN(new Date(decoded.createdAt).getTime())) {
      throw new Error('invalid cursor');
    }
    return { id: decoded.id, createdAt: decoded.createdAt };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El cursor de historial no es válido.', 400);
  }
}

function normalizeQuoteHistoryLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_QUOTE_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUOTE_HISTORY_PAGE_SIZE) throw new AppError('VALIDATION_ERROR', 'El límite de historial no es válido.', 400);
  return limit;
}

async function loadQuoteHistoryPage(prisma: PrismaClient, versionIds: readonly string[], cursor: QuoteHistoryCursor | undefined, limit: number): Promise<{ items: QuoteHistoryEntry[]; nextCursor: string | null }> {
  if (versionIds.length === 0) return { items: [], nextCursor: null };
  const rows = await prisma.quoteStatusHistory.findMany({
    where: {
      quoteVersionId: { in: [...versionIds] },
      ...(cursor ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      quoteVersionId: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      createdAt: true,
      changedBy: { select: { id: true, displayName: true } },
    },
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? encodeQuoteHistoryCursor(last) : null };
}

export async function listQuoteWorkspaces(actor: Actor, filters: QuoteWorkspaceListFilters = {}, dependencies: QuoteStaffServiceDependencies = {}) {
  requireQuoteRead(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const { page, pageSize } = normalizePagination(filters);
  const query = normalizeQuery(filters.query);
  const where: Prisma.QuoteRequestWhereInput = {
    AND: [
      staffRequestReadScopeWhere(actor),
      { status: { in: [...BUILDABLE_REQUEST_STATUSES] } },
      ...(query ? [{
        OR: [
          { folio: { contains: query, mode: 'insensitive' as const } },
          { client: { displayName: { contains: query, mode: 'insensitive' as const } } },
          { contact: { displayName: { contains: query, mode: 'insensitive' as const } } },
        ],
      }] : []),
    ],
  };
  const [total, requests] = await Promise.all([
    prisma.quoteRequest.count({ where }),
    prisma.quoteRequest.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        folio: true,
        status: true,
        updatedAt: true,
        client: { select: { id: true, displayName: true } },
        detail: { select: { projectType: true, location: true, currencyCode: true, projectStage: true, dimensions: true, timeline: true, budgetRange: true } },
        quotes: {
          select: {
            id: true,
            currentVersion: {
              select: {
                id: true,
                versionNumber: true,
                status: true,
                currencyCode: true,
                totalMinor: true,
                discountTotalMinor: true,
                validUntil: true,
              },
            },
            workingVersion: {
              select: {
                id: true,
                versionNumber: true,
                status: true,
                currencyCode: true,
                totalMinor: true,
                discountTotalMinor: true,
                validUntil: true,
              },
            },
            publishedVersion: {
              select: {
                id: true,
                versionNumber: true,
                status: true,
                currencyCode: true,
                totalMinor: true,
                discountTotalMinor: true,
                validUntil: true,
              },
            },
          },
          take: 1,
        },
      },
    }),
  ]);

  return {
    items: requests.map((request) => ({
      id: request.id,
      folio: request.folio,
      status: request.status,
      updatedAt: request.updatedAt,
      client: request.client,
      detail: request.detail,
      quote: request.quotes[0] ? {
        id: request.quotes[0].id,
        currentVersion: (request.quotes[0].workingVersion ?? request.quotes[0].publishedVersion ?? request.quotes[0].currentVersion) ? {
          ...(request.quotes[0].workingVersion ?? request.quotes[0].publishedVersion ?? request.quotes[0].currentVersion)!,
          totalMinor: serializeBigInt((request.quotes[0].workingVersion ?? request.quotes[0].publishedVersion ?? request.quotes[0].currentVersion)!.totalMinor),
          discountTotalMinor: serializeBigInt((request.quotes[0].workingVersion ?? request.quotes[0].publishedVersion ?? request.quotes[0].currentVersion)!.discountTotalMinor),
        } : null,
      } : null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getQuoteWorkspace(actor: Actor, quoteRequestId: string, dependencies: QuoteStaffServiceDependencies = {}) {
  requireQuoteRead(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const id = requireUuid(quoteRequestId);
  const request = await prisma.quoteRequest.findFirst({
    where: { id, ...staffRequestReadScopeWhere(actor) },
    select: {
      id: true,
      folio: true,
      origin: true,
      status: true,
      currentAssigneeId: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, displayName: true, status: true } },
      contact: { select: { id: true, displayName: true, email: true, phone: true, roleTitle: true, status: true } },
      detail: { select: { id: true, projectType: true, location: true, budgetCents: true, currencyCode: true, dimensions: true, projectStage: true, timeline: true, budgetRange: true, description: true, consentAt: true } },
      quotes: {
        select: {
          id: true,
          updatedAt: true,
          currentVersionId: true,
          workingVersionId: true,
          publishedVersionId: true,
          versions: {
            orderBy: [{ versionNumber: 'desc' }],
            select: {
              id: true,
              versionNumber: true,
              status: true,
              currencyCode: true,
              validUntil: true,
              subtotalMinor: true,
              discountTotalMinor: true,
              taxableTotalMinor: true,
              taxTotalMinor: true,
              totalMinor: true,
              createdAt: true,
              updatedAt: true,
              createdBy: { select: { id: true, displayName: true } },
            },
          },
        },
        take: 1,
      },
    },
  });
  if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);

  const quote = request.quotes[0] ?? null;
  const versionSummaries = quote?.versions ?? [];
  const displayedVersionId = quote?.workingVersionId ?? quote?.publishedVersionId ?? quote?.currentVersionId ?? null;
  const detailVersionIds = [...new Set([quote?.workingVersionId, quote?.publishedVersionId].filter((value): value is string => Boolean(value)))];
  if (detailVersionIds.length === 0 && displayedVersionId) detailVersionIds.push(displayedVersionId);
  const detailVersions = detailVersionIds.length > 0 ? await prisma.quoteVersion.findMany({
    where: { id: { in: detailVersionIds } },
    select: {
      id: true,
      versionNumber: true,
      status: true,
      currencyCode: true,
      validUntil: true,
      subtotalMinor: true,
      discountTotalMinor: true,
      taxableTotalMinor: true,
      taxTotalMinor: true,
      totalMinor: true,
      taxProfileId: true,
      commercialPolicyId: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, displayName: true } },
      lines: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          catalogItemId: true,
          catalogItemCode: true,
          name: true,
          description: true,
          unit: true,
          specialReason: true,
          quantityMilliunits: true,
          currencyCode: true,
          unitPriceMinor: true,
          discountBasisPoints: true,
          discountMinor: true,
          taxableMinor: true,
          taxBasisPoints: true,
          taxMinor: true,
          subtotalMinor: true,
          totalMinor: true,
        },
      },
      approvals: {
        orderBy: { requestedAt: 'desc' },
        select: {
          id: true,
          type: true,
          status: true,
          policyVersion: true,
          thresholdBps: true,
          reason: true,
          requestedById: true,
          decidedById: true,
          requestedAt: true,
          decidedAt: true,
          expiresAt: true,
        },
      },
      generatedDocuments: {
        where: { documentType: 'QUOTE_PDF' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          status: true,
          contentType: true,
          byteSize: true,
          sha256: true,
          readyAt: true,
          deletedAt: true,
          storageObject: { select: { contentType: true, byteSize: true, sha256: true, scanStatus: true, deletedAt: true } },
        },
      },
    },
  }) : [];
  const detailVersionsWithApprovalFlag = await Promise.all(detailVersions.map(async (version) => {
    const thresholdBps = await resolveDiscountApprovalThresholdBps(prisma, version.commercialPolicyId);
    const discountRatioBps = version.subtotalMinor > 0n ? (version.discountTotalMinor * 10_000n) / version.subtotalMinor : 10_000n;
    return { ...version, requiresDiscountApproval: version.discountTotalMinor > 0n && discountRatioBps > BigInt(thresholdBps) };
  }));
  const detailVersionById = new Map(detailVersionsWithApprovalFlag.map((version) => [version.id, version]));
  const currentVersion = displayedVersionId ? detailVersionById.get(displayedVersionId) ?? null : null;
  const currentVersionItemIds = [...new Set(currentVersion?.lines.map((line) => line.catalogItemId).filter((id): id is string => id !== null) ?? [])];
  const workingVersionRaw = quote?.workingVersionId ? detailVersionById.get(quote.workingVersionId) ?? null : null;
  const publishedVersionRaw = quote?.publishedVersionId ? detailVersionById.get(quote.publishedVersionId) ?? null : null;

  const priceListCandidates = await prisma.priceList.findMany({
    where: {
      status: 'ACTIVE',
      currencyCode: currentVersion?.currencyCode,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: [{ currencyCode: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      currencyCode: true,
      items: {
        where: {
          catalogItemId: { in: currentVersionItemIds },
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          catalogItem: { status: 'ACTIVE' },
        },
        select: { catalogItemId: true },
      },
    },
  });

  const priceLists = priceListCandidates
    .filter((priceList) => currentVersionItemIds.length === 0 || currentVersionItemIds.every((itemId) => priceList.items.some((item) => item.catalogItemId === itemId)))
    .map((priceList) => ({
      id: priceList.id,
      code: priceList.code,
      name: priceList.name,
      currencyCode: priceList.currencyCode,
    }));
  const [historyPage, latestDelivery, lastCustomerVisibleMessage, taxProfiles] = await Promise.all([
    loadQuoteHistoryPage(prisma, versionSummaries.map((version) => version.id), undefined, DEFAULT_QUOTE_HISTORY_PAGE_SIZE),
    quote ? getLatestAggregateNotificationDelivery(prisma, 'QUOTE', quote.id) : Promise.resolve(null),
    prisma.conversationMessage.findFirst({
      where: { conversation: { quoteRequestId: request.id }, visibility: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      select: { sender: { select: { type: true } } },
    }),
    prisma.taxProfileVersion.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, ratePercentBasisPoints: true },
    }),
  ]);

  const projection = resolveQuoteWorkspaceProjection({
    request: { status: request.status, currentAssigneeId: request.currentAssigneeId, updatedAt: request.updatedAt },
    workingVersion: workingVersionRaw ? toProjectionVersion(workingVersionRaw) : null,
    publishedVersion: publishedVersionRaw ? toProjectionVersion(publishedVersionRaw) : null,
    document: workingVersionRaw ? { state: deriveGeneratedDocumentState(workingVersionRaw.generatedDocuments[0]) } : null,
    delivery: latestDelivery ? {
      state: latestDelivery.status,
      retryable: latestDelivery.status === 'FAILED' && isRecoverableNotificationErrorCode(latestDelivery.lastErrorCode),
      updatedAt: latestDelivery.updatedAt,
    } : null,
    conversation: { lastMessageFromCustomer: lastCustomerVisibleMessage?.sender?.type === 'CUSTOMER' },
    project: null,
    actor: { userId: actor.userId, permissionKeys: actor.permissionKeys },
    now,
  });

  return {
    request: {
      id: request.id,
      folio: request.folio,
      origin: request.origin,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      client: request.client,
      contact: request.contact,
      detail: request.detail ? { ...request.detail, budgetCents: request.detail.budgetCents === null ? null : serializeBigInt(request.detail.budgetCents) } : null,
    },
    quote: quote ? {
      id: quote.id,
      currentVersionId: displayedVersionId,
      currentVersion: currentVersion ? serializeVersion(currentVersion as WorkspaceVersion) : null,
      workingVersion: workingVersionRaw ? serializeVersion(workingVersionRaw as WorkspaceVersion) : null,
      publishedVersion: publishedVersionRaw ? serializeVersion(publishedVersionRaw as WorkspaceVersion) : null,
      versions: versionSummaries.map(serializeVersionSummary),
      history: historyPage.items,
      historyNextCursor: historyPage.nextCursor,
    } : null,
    priceLists,
    taxProfiles,
    projection,
    meta: {
      timezone: readServerEnv().APP_TIMEZONE,
      revision: new Date(Math.max(
        request.updatedAt.getTime(),
        quote?.updatedAt.getTime() ?? 0,
        currentVersion?.updatedAt.getTime() ?? 0,
      )).toISOString(),
    },
  };
}

export type ListQuoteVersionHistoryFilters = Readonly<{ cursor?: string; limit?: number }>;

export async function listQuoteVersionHistory(actor: Actor, quoteRequestId: string, filters: ListQuoteVersionHistoryFilters = {}, dependencies: QuoteStaffServiceDependencies = {}) {
  requireQuoteRead(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(quoteRequestId);
  const limit = normalizeQuoteHistoryLimit(filters.limit);
  const cursor = decodeQuoteHistoryCursor(filters.cursor);
  const request = await prisma.quoteRequest.findFirst({
    where: { id, ...staffRequestReadScopeWhere(actor) },
    select: { id: true, quotes: { select: { versions: { select: { id: true } } }, take: 1 } },
  });
  if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
  const versionIds = request.quotes[0]?.versions.map((version) => version.id) ?? [];
  return loadQuoteHistoryPage(prisma, versionIds, cursor, limit);
}

function toProjectionVersion(version: {
  id: string;
  versionNumber: number;
  status: string;
  validUntil: Date | null;
  updatedAt: Date;
  approvals: ReadonlyArray<{ status: string; requestedById: string; requestedAt: Date }>;
}): WorkspaceVersionInput {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status as QuoteVersionStatus,
    validUntil: version.validUntil,
    updatedAt: version.updatedAt,
    approvals: version.approvals.map((approval) => ({
      status: approval.status as WorkspaceApprovalStatus,
      requestedById: approval.requestedById,
      requestedAt: approval.requestedAt,
    })),
  };
}
