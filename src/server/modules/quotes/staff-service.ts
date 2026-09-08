import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';

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
  catalogItemId: string;
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
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string };
  lines: Parameters<typeof serializeLine>[0][];
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
    lines: version.lines.map(serializeLine),
  };
}

type WorkspaceVersion = Parameters<typeof serializeVersion>[0];

function serializeHistory(history: Array<{
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: Date;
  changedBy: { id: string; displayName: string } | null;
}>) {
  return history.map((entry) => ({ ...entry })).sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
}

export async function listQuoteWorkspaces(actor: Actor, filters: QuoteWorkspaceListFilters = {}, dependencies: QuoteStaffServiceDependencies = {}) {
  requireQuoteRead(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const { page, pageSize } = normalizePagination(filters);
  const query = normalizeQuery(filters.query);
  const where: Prisma.QuoteRequestWhereInput = {
    status: { in: [...BUILDABLE_REQUEST_STATUSES] },
    ...(query ? {
      OR: [
        { folio: { contains: query, mode: 'insensitive' } },
        { client: { displayName: { contains: query, mode: 'insensitive' } } },
        { contact: { displayName: { contains: query, mode: 'insensitive' } } },
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
        status: true,
        updatedAt: true,
        client: { select: { id: true, displayName: true } },
        detail: { select: { projectType: true, location: true, currencyCode: true } },
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
        currentVersion: request.quotes[0].currentVersion ? {
          ...request.quotes[0].currentVersion,
          totalMinor: serializeBigInt(request.quotes[0].currentVersion.totalMinor),
          discountTotalMinor: serializeBigInt(request.quotes[0].currentVersion.discountTotalMinor),
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
  const request = await prisma.quoteRequest.findUnique({
    where: { id },
    select: {
      id: true,
      folio: true,
      origin: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, displayName: true, status: true } },
      contact: { select: { id: true, displayName: true, email: true, phone: true, roleTitle: true, status: true } },
      detail: { select: { id: true, projectType: true, location: true, budgetCents: true, currencyCode: true, dimensions: true, description: true, consentAt: true } },
      quotes: {
        select: {
          id: true,
          currentVersionId: true,
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
              lines: {
                orderBy: { id: 'asc' },
                select: {
                  id: true,
                  catalogItemId: true,
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
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  fromStatus: true,
                  toStatus: true,
                  reason: true,
                  createdAt: true,
                  changedBy: { select: { id: true, displayName: true } },
                },
              },
            },
          },
        },
        take: 1,
      },
    },
  });
  if (!request) throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);

  const priceLists = await prisma.priceList.findMany({
    where: {
      status: 'ACTIVE',
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: [{ currencyCode: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, currencyCode: true },
  });

  const quote = request.quotes[0] ?? null;
  const versions = quote?.versions ?? [];
  const currentVersion = quote?.currentVersionId ? versions.find((version) => version.id === quote.currentVersionId) ?? null : null;
  const history = serializeHistory(versions.flatMap((version) => version.statusHistory));
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
      currentVersionId: quote.currentVersionId,
      currentVersion: currentVersion ? serializeVersion(currentVersion as WorkspaceVersion) : null,
      versions: versions.map((version) => serializeVersion(version as WorkspaceVersion)),
      history,
    } : null,
    priceLists,
  };
}
