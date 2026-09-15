import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { createMoney, normalizeCurrencyCode } from '@/server/modules/quotes/domain';

export type CatalogServiceDependencies = Readonly<{ prisma?: PrismaClient; now?: Date }>;
export type CatalogStatus = 'ACTIVE' | 'ARCHIVED';
export type PriceListStatus = 'ACTIVE' | 'ARCHIVED';

export type CatalogListFilters = Readonly<{
  query?: string;
  status?: CatalogStatus;
  categoryId?: string;
  page?: number;
  pageSize?: number;
}>;

function requireStaffPermission(actor: Actor, permission: string): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, permission);
}

function requireUuid(value: string, message: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new AppError('VALIDATION_ERROR', message, 400);
  }
  return value;
}

function normalizeCode(value: string, message: string): string {
  if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR', message, 400);
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/u.test(normalized)) throw new AppError('VALIDATION_ERROR', message, 400);
  return normalized;
}

function normalizeText(value: string, maxLength: number, message: string): string {
  if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR', message, 400);
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > maxLength) throw new AppError('VALIDATION_ERROR', message, 400);
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number, message: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length > maxLength) throw new AppError('VALIDATION_ERROR', message, 400);
  return normalized || null;
}

function normalizeStatus(value: string | undefined, fallback: CatalogStatus): CatalogStatus {
  const status = value ?? fallback;
  if (status !== 'ACTIVE' && status !== 'ARCHIVED') throw new AppError('VALIDATION_ERROR', 'El estado no es válido.', 400);
  return status;
}

function normalizePagination(filters: CatalogListFilters): { page: number; pageSize: number } {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new AppError('VALIDATION_ERROR', 'La paginación no es válida.', 400);
  }
  return { page, pageSize };
}

function normalizeDate(value: Date, message: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new AppError('VALIDATION_ERROR', message, 400);
  return value;
}

function normalizeMoney(value: string | bigint, currencyCode: string): bigint {
  try {
    return createMoney(value, currencyCode).amountMinor;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El importe no es válido.', 400);
  }
}

function isPersistenceConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2004', 'P2010'].includes(error.code);
}

function conflict(message: string): never {
  throw new AppError('CONFLICT', message, 409);
}

async function audit(transaction: Prisma.TransactionClient, actor: Actor, action: string, entityType: string, entityId: string, metadata: Record<string, string | number | null>): Promise<void> {
  await transaction.auditLog.create({ data: { actorUserId: actor.userId, action, entityType, entityId, outcome: 'SUCCESS', metadata } });
}

async function outbox(transaction: Prisma.TransactionClient, eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, string | number | null>): Promise<void> {
  await transaction.outboxEvent.create({ data: { eventType, aggregateType, aggregateId, payload } });
}

export async function listCatalogCategories(actor: Actor, status?: CatalogStatus, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'catalog.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const normalizedStatus = status === undefined ? undefined : normalizeStatus(status, 'ACTIVE');
  return prisma.catalogCategory.findMany({
    where: { status: normalizedStatus },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, description: true, status: true, sortOrder: true, parentId: true },
  });
}

export async function createCatalogCategory(actor: Actor, input: { code: string; name: string; description?: string | null; sortOrder?: number }, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'catalog.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const code = normalizeCode(input.code, 'La clave de categoría no es válida.');
  const name = normalizeText(input.name, 180, 'El nombre de categoría no es válido.');
  const description = normalizeOptionalText(input.description, 500, 'La descripción de categoría no es válida.');
  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) throw new AppError('VALIDATION_ERROR', 'El orden no es válido.', 400);

  try {
    return await prisma.$transaction(async (transaction) => {
      const category = await transaction.catalogCategory.create({ data: { code, name, description, sortOrder } });
      await audit(transaction, actor, 'catalog.category.created', 'catalog_category', category.id, { code, name });
      await outbox(transaction, 'CATALOG.CATEGORY_CREATED', 'CATALOG_CATEGORY', category.id, { categoryId: category.id, code });
      return category;
    });
  } catch (error) {
    if (isPersistenceConflict(error)) conflict('La clave de categoría ya existe o no es válida.');
    throw error;
  }
}

export async function listCatalogItems(actor: Actor, filters: CatalogListFilters = {}, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'catalog.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const { page, pageSize } = normalizePagination(filters);
  const query = filters.query?.trim() || undefined;
  if (query && query.length > 100) throw new AppError('VALIDATION_ERROR', 'La búsqueda no es válida.', 400);
  const categoryId = filters.categoryId ? requireUuid(filters.categoryId, 'La categoría no es válida.') : undefined;
  const status = filters.status ? normalizeStatus(filters.status, 'ACTIVE') : undefined;
  const where: Prisma.CatalogItemWhereInput = {
    status,
    categoryId,
    ...(query ? { OR: [{ code: { contains: query.toUpperCase(), mode: 'insensitive' } }, { name: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.catalogItem.count({ where }),
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, code: true, name: true, description: true, unit: true, status: true, category: { select: { id: true, code: true, name: true } }, createdAt: true, updatedAt: true },
    }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function createCatalogItem(actor: Actor, input: { code: string; name: string; description?: string | null; unit: string; categoryId?: string | null }, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'catalog.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const code = normalizeCode(input.code, 'La clave de concepto no es válida.');
  const name = normalizeText(input.name, 180, 'El nombre de concepto no es válido.');
  const description = normalizeOptionalText(input.description, 2_000, 'La descripción de concepto no es válida.');
  const unit = normalizeText(input.unit, 40, 'La unidad de concepto no es válida.');
  const categoryId = input.categoryId ? requireUuid(input.categoryId, 'La categoría no es válida.') : null;
  try {
    return await prisma.$transaction(async (transaction) => {
      if (categoryId) {
        const category = await transaction.catalogCategory.findUnique({ where: { id: categoryId }, select: { id: true, status: true } });
        if (!category || category.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'La categoría no está disponible.', 400);
      }
      const item = await transaction.catalogItem.create({ data: { code, name, description, unit, categoryId } });
      await audit(transaction, actor, 'catalog.item.created', 'catalog_item', item.id, { code, name });
      await outbox(transaction, 'CATALOG.ITEM_CREATED', 'CATALOG_ITEM', item.id, { itemId: item.id, code });
      return item;
    });
  } catch (error) {
    if (isPersistenceConflict(error)) conflict('La clave de concepto ya existe o no es válida.');
    throw error;
  }
}

export async function updateCatalogItem(actor: Actor, itemId: string, input: { code?: string; name?: string; description?: string | null; unit?: string; categoryId?: string | null; status?: CatalogStatus }, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'catalog.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(itemId, 'El concepto no es válido.');
  const current = await prisma.catalogItem.findUnique({ where: { id }, select: { id: true } });
  if (!current) throw new AppError('NOT_FOUND', 'El concepto no existe.', 404);
  const data: Prisma.CatalogItemUpdateInput = {};
  if (input.code !== undefined) data.code = normalizeCode(input.code, 'La clave de concepto no es válida.');
  if (input.name !== undefined) data.name = normalizeText(input.name, 180, 'El nombre de concepto no es válido.');
  if (input.description !== undefined) data.description = normalizeOptionalText(input.description, 2_000, 'La descripción de concepto no es válida.');
  if (input.unit !== undefined) data.unit = normalizeText(input.unit, 40, 'La unidad de concepto no es válida.');
  if (input.status !== undefined) data.status = normalizeStatus(input.status, 'ACTIVE');
  if (input.categoryId !== undefined) {
    const categoryId = input.categoryId === null ? null : requireUuid(input.categoryId, 'La categoría no es válida.');
    if (categoryId) {
      const category = await prisma.catalogCategory.findUnique({ where: { id: categoryId }, select: { status: true } });
      if (!category || category.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'La categoría no está disponible.', 400);
      data.category = { connect: { id: categoryId } };
    } else data.category = { disconnect: true };
  }
  if (Object.keys(data).length === 0) throw new AppError('VALIDATION_ERROR', 'No hay cambios para guardar.', 400);
  try {
    return await prisma.$transaction(async (transaction) => {
      const item = await transaction.catalogItem.update({ where: { id }, data });
      await audit(transaction, actor, 'catalog.item.updated', 'catalog_item', item.id, { code: item.code, status: item.status });
      await outbox(transaction, 'CATALOG.ITEM_UPDATED', 'CATALOG_ITEM', item.id, { itemId: item.id, code: item.code, status: item.status });
      return item;
    });
  } catch (error) {
    if (isPersistenceConflict(error)) conflict('No fue posible actualizar el concepto.');
    throw error;
  }
}

export async function listPriceLists(actor: Actor, status?: PriceListStatus, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'prices.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const normalizedStatus = status === undefined ? undefined : normalizeStatus(status, 'ACTIVE');
  return prisma.priceList.findMany({
    where: { status: normalizedStatus },
    orderBy: [{ status: 'asc' }, { currencyCode: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, currencyCode: true, status: true, validFrom: true, validUntil: true, _count: { select: { items: true } } },
  });
}

export async function createPriceList(actor: Actor, input: { code: string; name: string; currencyCode: string; validFrom: Date; validUntil?: Date | null }, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'prices.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const code = normalizeCode(input.code, 'La clave de lista no es válida.');
  const name = normalizeText(input.name, 180, 'El nombre de lista no es válido.');
  let currencyCode: string;
  try { currencyCode = normalizeCurrencyCode(input.currencyCode); } catch { throw new AppError('VALIDATION_ERROR', 'La moneda no es válida.', 400); }
  const validFrom = normalizeDate(input.validFrom, 'La vigencia inicial no es válida.');
  const validUntil = input.validUntil === undefined || input.validUntil === null ? null : normalizeDate(input.validUntil, 'La vigencia final no es válida.');
  if (validUntil && validUntil <= validFrom) throw new AppError('VALIDATION_ERROR', 'La vigencia final debe ser posterior.', 400);
  try {
    return await prisma.$transaction(async (transaction) => {
      const priceList = await transaction.priceList.create({ data: { code, name, currencyCode, validFrom, validUntil } });
      await audit(transaction, actor, 'prices.list.created', 'price_list', priceList.id, { code, currencyCode });
      await outbox(transaction, 'PRICES.LIST_CREATED', 'PRICE_LIST', priceList.id, { priceListId: priceList.id, code, currencyCode });
      return priceList;
    });
  } catch (error) {
    if (isPersistenceConflict(error)) conflict('La clave de lista ya existe o no es válida.');
    throw error;
  }
}

export async function getPriceList(actor: Actor, priceListId: string, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'prices.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const id = requireUuid(priceListId, 'La lista de precios no es válida.');
  const priceList = await prisma.priceList.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, currencyCode: true, status: true, validFrom: true, validUntil: true, items: { orderBy: [{ validFrom: 'desc' }, { id: 'desc' }], select: { id: true, catalogItemId: true, unitPriceMinor: true, validFrom: true, validUntil: true, catalogItem: { select: { code: true, name: true, unit: true, status: true } } } } },
  });
  if (!priceList) throw new AppError('NOT_FOUND', 'La lista de precios no existe.', 404);
  return { ...priceList, items: priceList.items.map((item) => ({ ...item, unitPriceMinor: item.unitPriceMinor.toString() })) };
}

export type SchedulePriceInput = Readonly<{
  catalogItemId: string;
  unitPriceMinor: string | bigint;
  effectiveFrom: Date;
  reason?: string | null;
}>;

export type SchedulePriceResult = Readonly<{
  priceListItemId: string;
  unitPriceMinor: string;
  effectiveFrom: string;
  closedPreviousPriceId: string | null;
  closedPreviousValidUntil: string | null;
}>;

/**
 * Atomic "change the price going forward" command (K1-02): locks the price
 * list so two concurrent schedules for the same concept can't both leave an
 * open-ended row behind, closes whatever price would still be in effect at
 * `effectiveFrom`, and opens the new one. Repeating the exact same schedule
 * is a no-op; correcting a not-yet-effective schedule updates it in place.
 */
export async function schedulePrice(actor: Actor, priceListId: string, input: SchedulePriceInput, dependencies: CatalogServiceDependencies = {}): Promise<SchedulePriceResult> {
  requireStaffPermission(actor, 'prices.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const listId = requireUuid(priceListId, 'La lista de precios no es válida.');
  const catalogItemId = requireUuid(input.catalogItemId, 'El concepto no es válido.');
  const effectiveFrom = normalizeDate(input.effectiveFrom, 'La fecha de vigencia no es válida.');
  const reason = input.reason === undefined || input.reason === null ? null : normalizeText(input.reason, 300, 'El motivo no es válido.');

  try {
    return await prisma.$transaction(async (transaction) => {
      const [lockedList] = await transaction.$queryRaw<Array<{ id: string; status: PriceListStatus; currencyCode: string; validFrom: Date; validUntil: Date | null }>>(
        Prisma.sql`SELECT "id", "status", "currencyCode", "validFrom", "validUntil" FROM "price_lists" WHERE "id" = ${listId} FOR UPDATE`,
      );
      if (!lockedList) throw new AppError('NOT_FOUND', 'La lista de precios no existe.', 404);
      if (lockedList.status !== 'ACTIVE') conflict('La lista de precios está archivada.');
      if (effectiveFrom < lockedList.validFrom || (lockedList.validUntil !== null && effectiveFrom >= lockedList.validUntil)) {
        throw new AppError('VALIDATION_ERROR', 'La fecha de vigencia debe estar dentro de la lista.', 400);
      }
      const item = await transaction.catalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true, status: true } });
      if (!item || item.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'El concepto no está disponible.', 400);
      const unitPriceMinor = normalizeMoney(input.unitPriceMinor, lockedList.currencyCode);

      const existingExact = await transaction.priceListItem.findUnique({
        where: { priceListId_catalogItemId_validFrom: { priceListId: listId, catalogItemId, validFrom: effectiveFrom } },
      });
      if (existingExact && existingExact.unitPriceMinor === unitPriceMinor) {
        return {
          priceListItemId: existingExact.id,
          unitPriceMinor: existingExact.unitPriceMinor.toString(),
          effectiveFrom: existingExact.validFrom.toISOString(),
          closedPreviousPriceId: null,
          closedPreviousValidUntil: null,
        };
      }

      const futureConflict = await transaction.priceListItem.findFirst({
        where: {
          priceListId: listId,
          catalogItemId,
          validFrom: { gte: effectiveFrom },
          id: existingExact ? { not: existingExact.id } : undefined,
        },
      });
      if (futureConflict) conflict('Ya existe un precio programado en o después de esa fecha; ajusta esa vigencia primero.');

      const overlapping = await transaction.priceListItem.findFirst({
        where: {
          priceListId: listId,
          catalogItemId,
          validFrom: { lt: effectiveFrom },
          OR: [{ validUntil: null }, { validUntil: { gt: effectiveFrom } }],
        },
        orderBy: { validFrom: 'desc' },
      });

      let closedPreviousPriceId: string | null = null;
      if (overlapping) {
        await transaction.priceListItem.update({ where: { id: overlapping.id }, data: { validUntil: effectiveFrom } });
        closedPreviousPriceId = overlapping.id;
      }

      const scheduled = existingExact
        ? await transaction.priceListItem.update({ where: { id: existingExact.id }, data: { unitPriceMinor } })
        : await transaction.priceListItem.create({ data: { priceListId: listId, catalogItemId, unitPriceMinor, validFrom: effectiveFrom, validUntil: null } });

      await audit(transaction, actor, 'prices.item.scheduled', 'price_list_item', scheduled.id, {
        priceListId: listId,
        catalogItemId,
        unitPriceMinor: unitPriceMinor.toString(),
        effectiveFrom: effectiveFrom.toISOString(),
        closedPreviousPriceId,
        reason,
      });
      await outbox(transaction, 'PRICES.ITEM_SCHEDULED', 'PRICE_LIST', listId, { priceListId: listId, priceListItemId: scheduled.id, catalogItemId, closedPreviousPriceId });

      return {
        priceListItemId: scheduled.id,
        unitPriceMinor: scheduled.unitPriceMinor.toString(),
        effectiveFrom: scheduled.validFrom.toISOString(),
        closedPreviousPriceId,
        closedPreviousValidUntil: closedPreviousPriceId ? effectiveFrom.toISOString() : null,
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isPersistenceConflict(error)) conflict('No fue posible programar el precio.');
    throw error;
  }
}

export type CatalogSearchFilters = Readonly<{
  query?: string;
  categoryId?: string;
  cursor?: string;
  limit?: number;
}>;

export type CatalogSearchBlocker = 'NO_PRICE_IN_LIST';

export type CatalogSearchItem = Readonly<{
  id: string;
  code: string;
  name: string;
  unit: string;
  category: { id: string; code: string; name: string } | null;
  price: { priceListItemId: string; unitPriceMinor: string } | null;
  blocker: CatalogSearchBlocker | null;
}>;

const CATALOG_SEARCH_DEFAULT_LIMIT = 25;
const CATALOG_SEARCH_MAX_LIMIT = 50;

function encodeCatalogSearchCursor(item: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify({ name: item.name, id: item.id }), 'utf8').toString('base64url');
}

function decodeCatalogSearchCursor(value: string | undefined): { name: string; id: string } | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { name?: unknown; id?: unknown };
    if (typeof decoded.name !== 'string' || typeof decoded.id !== 'string') throw new Error('Invalid cursor.');
    return { name: decoded.name, id: decoded.id };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'El cursor no es válido.', 400);
  }
}

/**
 * Contextual catalog search used by the quote builder (K1-01): paginated by
 * cursor so a large catalog never truncates silently, and resolves each
 * item's currently-effective price within the given price list instead of
 * requiring the caller to preload the whole list.
 */
export async function searchQuoteCatalogItems(actor: Actor, priceListId: string, filters: CatalogSearchFilters = {}, dependencies: CatalogServiceDependencies = {}): Promise<{ items: CatalogSearchItem[]; nextCursor: string | null }> {
  requireStaffPermission(actor, 'catalog.read');
  requireStaffPermission(actor, 'prices.read');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const listId = requireUuid(priceListId, 'La lista de precios no es válida.');
  const priceList = await prisma.priceList.findUnique({ where: { id: listId }, select: { id: true } });
  if (!priceList) throw new AppError('NOT_FOUND', 'La lista de precios no existe.', 404);

  const query = filters.query?.trim() || undefined;
  if (query && query.length > 100) throw new AppError('VALIDATION_ERROR', 'La búsqueda no es válida.', 400);
  const categoryId = filters.categoryId ? requireUuid(filters.categoryId, 'La categoría no es válida.') : undefined;
  const limit = filters.limit ?? CATALOG_SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > CATALOG_SEARCH_MAX_LIMIT) throw new AppError('VALIDATION_ERROR', 'El límite no es válido.', 400);
  const cursor = decodeCatalogSearchCursor(filters.cursor);

  const conditions: Prisma.CatalogItemWhereInput[] = [{ status: 'ACTIVE' }];
  if (categoryId) conditions.push({ categoryId });
  if (query) {
    conditions.push({
      OR: [
        { code: { contains: query.toUpperCase(), mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    });
  }
  if (cursor) {
    conditions.push({
      OR: [
        { name: { gt: cursor.name } },
        { AND: [{ name: cursor.name }, { id: { gt: cursor.id } }] },
      ],
    });
  }

  const items = await prisma.catalogItem.findMany({
    where: { AND: conditions },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: { id: true, code: true, name: true, unit: true, category: { select: { id: true, code: true, name: true } } },
  });
  const hasNext = items.length > limit;
  const page = hasNext ? items.slice(0, limit) : items;

  const itemIds = page.map((item) => item.id);
  const prices = itemIds.length ? await prisma.priceListItem.findMany({
    where: {
      priceListId: listId,
      catalogItemId: { in: itemIds },
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    select: { id: true, catalogItemId: true, unitPriceMinor: true },
  }) : [];
  const priceByItemId = new Map(prices.map((price) => [price.catalogItemId, price]));

  return {
    items: page.map((item) => {
      const price = priceByItemId.get(item.id);
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        category: item.category,
        price: price ? { priceListItemId: price.id, unitPriceMinor: price.unitPriceMinor.toString() } : null,
        blocker: price ? null : 'NO_PRICE_IN_LIST',
      };
    }),
    nextCursor: hasNext ? encodeCatalogSearchCursor(page[page.length - 1]) : null,
  };
}

export async function upsertPriceListItem(actor: Actor, priceListId: string, input: { catalogItemId: string; unitPriceMinor: string | bigint; validFrom: Date; validUntil?: Date | null }, dependencies: CatalogServiceDependencies = {}) {
  requireStaffPermission(actor, 'prices.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const listId = requireUuid(priceListId, 'La lista de precios no es válida.');
  const catalogItemId = requireUuid(input.catalogItemId, 'El concepto no es válido.');
  const validFrom = normalizeDate(input.validFrom, 'La vigencia inicial no es válida.');
  const validUntil = input.validUntil === undefined || input.validUntil === null ? null : normalizeDate(input.validUntil, 'La vigencia final no es válida.');
  if (validUntil && validUntil <= validFrom) throw new AppError('VALIDATION_ERROR', 'La vigencia final debe ser posterior.', 400);

  try {
    return await prisma.$transaction(async (transaction) => {
      const priceList = await transaction.priceList.findUnique({ where: { id: listId }, select: { id: true, code: true, currencyCode: true, status: true, validFrom: true, validUntil: true } });
      if (!priceList) throw new AppError('NOT_FOUND', 'La lista de precios no existe.', 404);
      if (priceList.status !== 'ACTIVE') conflict('La lista de precios está archivada.');
      if (validFrom < priceList.validFrom || priceList.validUntil && validFrom >= priceList.validUntil || priceList.validUntil && (!validUntil || validUntil > priceList.validUntil)) {
        throw new AppError('VALIDATION_ERROR', 'La vigencia del precio debe estar dentro de la lista.', 400);
      }
      const item = await transaction.catalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true, status: true } });
      if (!item || item.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'El concepto no está disponible.', 400);
      const unitPriceMinor = normalizeMoney(input.unitPriceMinor, priceList.currencyCode);
      const existing = await transaction.priceListItem.findUnique({ where: { priceListId_catalogItemId_validFrom: { priceListId: listId, catalogItemId, validFrom } }, select: { id: true } });
      const overlap = await transaction.priceListItem.findFirst({
        where: {
          priceListId: listId,
          catalogItemId,
          id: existing ? { not: existing.id } : undefined,
          validFrom: { lt: validUntil ?? new Date('9999-12-31T23:59:59.999Z') },
          OR: [{ validUntil: null }, { validUntil: { gt: validFrom } }],
        },
        select: { id: true },
      });
      if (overlap) conflict('La vigencia se cruza con otro precio del mismo concepto.');
      const price = existing
        ? await transaction.priceListItem.update({ where: { id: existing.id }, data: { unitPriceMinor, validUntil } })
        : await transaction.priceListItem.create({ data: { priceListId: listId, catalogItemId, unitPriceMinor, validFrom, validUntil } });
      await audit(transaction, actor, existing ? 'prices.item.updated' : 'prices.item.created', 'price_list_item', price.id, { priceListId: listId, catalogItemId, unitPriceMinor: unitPriceMinor.toString() });
      await outbox(transaction, existing ? 'PRICES.ITEM_UPDATED' : 'PRICES.ITEM_CREATED', 'PRICE_LIST', listId, { priceListId: listId, priceListItemId: price.id, catalogItemId });
      return { ...price, unitPriceMinor: price.unitPriceMinor.toString() };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isPersistenceConflict(error)) conflict('La vigencia se cruza con otro precio del mismo concepto.');
    throw error;
  }
}
