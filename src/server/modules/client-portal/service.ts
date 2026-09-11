import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import type { Actor } from '@/server/auth/types';
import { requirePermission } from '@/server/auth/permissions';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { getCurrentQuoteTermsLabel, getCurrentQuoteTermsVersion } from '@/server/modules/quote-documents/domain';
import { CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES, isCustomerVisibleQuoteVersionStatus } from '@/server/modules/quotes/customer-visibility';

export type ClientPortalServiceDependencies = Readonly<{ prisma?: PrismaClient; now?: Date }>;

export type CustomerQuoteRequestFilters = Readonly<{
  query?: string;
  page?: number;
  pageSize?: number;
}>;

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function serializePortalMoney(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function requireCustomerScope(actor: Actor): string {
  if (actor.type !== 'CUSTOMER' || !actor.clientId || !UUID_PATTERN.test(actor.clientId)) {
    throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  }
  requirePermission(actor, 'portal.self.read');
  return actor.clientId;
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);
  return value;
}

function normalizePagination(filters: CustomerQuoteRequestFilters): { page: number; pageSize: number } {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new AppError('VALIDATION_ERROR', 'La paginación no es válida.', 400);
  }
  return { page, pageSize };
}

function normalizeQuery(value: string | undefined): string | undefined {
  const query = value?.trim() || undefined;
  if (query && query.length > 100) throw new AppError('VALIDATION_ERROR', 'La búsqueda no es válida.', 400);
  return query;
}

function publicRequestStatus(status: string): string {
  if (status === 'EN_REVISION') return 'RECIBIDA';
  if (status === 'PENDIENTE_DE_APROBACION') return 'COTIZACION_DISPONIBLE';
  return status;
}

function publicQuoteStatus(status: string): string {
  return status;
}

function serializeLine(line: {
  catalogItemCode: string;
  name: string;
  description: string | null;
  unit: string;
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
    catalogItemCode: line.catalogItemCode,
    name: line.name,
    description: line.description,
    unit: line.unit,
    quantityMilliunits: line.quantityMilliunits.toString(),
    currencyCode: line.currencyCode,
    unitPriceMinor: line.unitPriceMinor.toString(),
    discountBasisPoints: line.discountBasisPoints,
    discountMinor: line.discountMinor.toString(),
    taxableMinor: line.taxableMinor.toString(),
    taxBasisPoints: line.taxBasisPoints,
    taxMinor: line.taxMinor.toString(),
    subtotalMinor: line.subtotalMinor.toString(),
    totalMinor: line.totalMinor.toString(),
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
  createdAt: Date;
  updatedAt: Date;
  pdfReady: boolean;
  lines: Parameters<typeof serializeLine>[0][];
}) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    termsVersion: getCurrentQuoteTermsVersion(),
    termsLabel: getCurrentQuoteTermsLabel(),
    status: publicQuoteStatus(version.status),
    currencyCode: version.currencyCode,
    validUntil: version.validUntil,
    subtotalMinor: version.subtotalMinor.toString(),
    discountTotalMinor: version.discountTotalMinor.toString(),
    taxableTotalMinor: version.taxableTotalMinor.toString(),
    taxTotalMinor: version.taxTotalMinor.toString(),
    totalMinor: version.totalMinor.toString(),
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    pdfReady: version.pdfReady,
    lines: version.lines.map(serializeLine),
  };
}

function isQuotePdfReady(document: {
  status: string;
  contentType: string;
  byteSize: bigint | null;
  sha256: string | null;
  readyAt: Date | null;
  deletedAt: Date | null;
  storageObject: {
    contentType: string;
    byteSize: bigint;
    sha256: string | null;
    scanStatus: string;
    deletedAt: Date | null;
  } | null;
} | undefined): boolean {
  return Boolean(
    document
      && document.status === 'READY'
      && document.contentType === 'application/pdf'
      && document.byteSize
      && document.byteSize > 0n
      && document.sha256
      && document.readyAt
      && !document.deletedAt
      && document.storageObject
      && document.storageObject.contentType === 'application/pdf'
      && document.storageObject.byteSize === document.byteSize
      && document.storageObject.sha256 === document.sha256
      && document.storageObject.scanStatus === 'PASSED'
      && !document.storageObject.deletedAt,
  );
}

function visibleVersions<T extends { status: string }>(versions: readonly T[]): T[] {
  return versions.filter((version) => isCustomerVisibleQuoteVersionStatus(version.status));
}

function selectVisibleVersion<T extends { id: string; status: string }>(versions: readonly T[], currentVersionId: string | null): T | null {
  const visible = visibleVersions(versions);
  if (visible.length === 0) return null;
  return visible.find((version) => version.id === currentVersionId) ?? visible[0];
}

function serializeStatusHistory(history: Array<{ id: string; fromStatus: string | null; toStatus: string; createdAt: Date }>) {
  return history.filter((entry) => isCustomerVisibleQuoteVersionStatus(entry.toStatus)).map((entry) => ({
    id: entry.id,
    fromStatus: entry.fromStatus && isCustomerVisibleQuoteVersionStatus(entry.fromStatus) ? publicQuoteStatus(entry.fromStatus) : null,
    toStatus: publicQuoteStatus(entry.toStatus),
    createdAt: entry.createdAt,
  }));
}

const quoteVersionSummarySelect = {
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
} as const;

export async function listCustomerQuoteRequests(actor: Actor, filters: CustomerQuoteRequestFilters = {}, dependencies: ClientPortalServiceDependencies = {}) {
  const clientId = requireCustomerScope(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const { page, pageSize } = normalizePagination(filters);
  const query = normalizeQuery(filters.query);
  const where: Prisma.QuoteRequestWhereInput = {
    clientId,
    ...(query ? {
      OR: [
        { folio: { contains: query, mode: 'insensitive' } },
        { detail: { projectType: { contains: query, mode: 'insensitive' } } },
        { detail: { location: { contains: query, mode: 'insensitive' } } },
      ],
    } : {}),
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
        origin: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, displayName: true } },
        detail: { select: { projectType: true, location: true, currencyCode: true } },
        quotes: {
          select: {
            id: true,
            currentVersionId: true,
            publishedVersionId: true,
            versions: {
              where: { status: { in: [...CUSTOMER_VISIBLE_QUOTE_VERSION_STATUSES] } },
              orderBy: [{ versionNumber: 'desc' }],
              take: 1,
              select: quoteVersionSummarySelect,
            },
          },
          take: 1,
        },
      },
    }),
  ]);

  return {
    items: requests.map((request) => {
      const version = request.quotes[0]?.versions[0] ?? null;
      return {
        id: request.id,
        folio: request.folio,
        origin: request.origin,
        status: publicRequestStatus(request.status),
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        client: request.client,
        detail: request.detail,
        quote: request.quotes[0] ? {
          id: request.quotes[0].id,
          currentVersion: version ? {
            id: version.id,
            versionNumber: version.versionNumber,
            status: publicQuoteStatus(version.status),
            currencyCode: version.currencyCode,
            validUntil: version.validUntil,
            subtotalMinor: version.subtotalMinor.toString(),
            discountTotalMinor: version.discountTotalMinor.toString(),
            taxableTotalMinor: version.taxableTotalMinor.toString(),
            taxTotalMinor: version.taxTotalMinor.toString(),
            totalMinor: version.totalMinor.toString(),
          } : null,
        } : null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getCustomerQuoteRequest(actor: Actor, requestId: string, dependencies: ClientPortalServiceDependencies = {}) {
  const clientId = requireCustomerScope(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(requestId);
  const request = await prisma.quoteRequest.findFirst({
    where: { id, clientId },
    select: {
      id: true,
      folio: true,
      origin: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, displayName: true } },
      contact: { select: { displayName: true, email: true, phone: true } },
      detail: { select: { projectType: true, location: true, budgetCents: true, currencyCode: true, dimensions: true, description: true } },
      quotes: {
        select: {
          id: true,
            currentVersionId: true,
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
              lines: {
                orderBy: { id: 'asc' },
                select: {
                  catalogItemCode: true,
                  name: true,
                  description: true,
                  unit: true,
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
              statusHistory: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
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
          },
        },
        take: 1,
      },
    },
  });
  if (!request) throw new AppError('NOT_FOUND', 'El expediente no existe.', 404);

  const quote = request.quotes[0] ?? null;
  const versions = quote ? visibleVersions(quote.versions) : [];
  const currentVersion = quote ? selectVisibleVersion(versions, quote.publishedVersionId ?? quote.currentVersionId) : null;
  const serializedVersions = versions.map((version) => serializeVersion({ ...version, pdfReady: isQuotePdfReady(version.generatedDocuments[0]) }));
  const serializedCurrentVersion = currentVersion ? serializeVersion({ ...currentVersion, pdfReady: isQuotePdfReady(currentVersion.generatedDocuments[0]) }) : null;
  return {
    request: {
      id: request.id,
      folio: request.folio,
      origin: request.origin,
      status: publicRequestStatus(request.status),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      client: request.client,
      contact: request.contact,
      detail: request.detail ? { ...request.detail, budgetCents: serializePortalMoney(request.detail.budgetCents) } : null,
    },
    quote: quote ? {
      id: quote.id,
      currentVersionId: serializedCurrentVersion?.id ?? null,
      currentVersion: serializedCurrentVersion,
      versions: serializedVersions,
      history: serializeStatusHistory(versions.flatMap((version) => version.statusHistory)),
    } : null,
  };
}

export async function getCustomerQuote(actor: Actor, quoteId: string, dependencies: ClientPortalServiceDependencies = {}) {
  const clientId = requireCustomerScope(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(quoteId);
  const quote = await prisma.quote.findFirst({ where: { id, clientId }, select: { quoteRequestId: true } });
  if (!quote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  const workspace = await getCustomerQuoteRequest(actor, quote.quoteRequestId, { prisma });
  if (!workspace.quote) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
  return { request: workspace.request, quote: workspace.quote };
}
