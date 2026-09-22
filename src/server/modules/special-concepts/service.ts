import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { createCatalogItem } from '@/server/modules/catalog/service';

export type SpecialConceptServiceDependencies = Readonly<{ prisma?: PrismaClient }>;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/gu;
const RECENT_FOLIO_LIMIT = 5;

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

/** Same normalization family as normalizeAcceptanceName (quote-documents/domain.ts), plus lowercasing for dedupe. */
function normalizeConceptKey(value: string): string {
  return value.normalize('NFC').replace(CONTROL_CHARACTERS, '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function normalizeRequiredText(value: string, maxLength: number, message: string): string {
  if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR', message, 400);
  const normalized = value.normalize('NFC').replace(CONTROL_CHARACTERS, '').trim().replace(/\s+/gu, ' ');
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

async function audit(transaction: Prisma.TransactionClient, actor: Actor, action: string, entityType: string, entityId: string, metadata: Record<string, string | number | null>): Promise<void> {
  await transaction.auditLog.create({ data: { actorUserId: actor.userId, action, entityType, entityId, outcome: 'SUCCESS', metadata } });
}

async function outbox(transaction: Prisma.TransactionClient, eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, string | number | null>): Promise<void> {
  await transaction.outboxEvent.create({ data: { eventType, aggregateType, aggregateId, payload } });
}

export type SpecialConceptGroupStatus = 'PENDING' | 'MATCHES_EXISTING' | 'PROMOTED';

export type SpecialConceptGroup = Readonly<{
  normalizedName: string;
  unit: string;
  name: string;
  occurrences: number;
  recentFolios: readonly string[];
  status: SpecialConceptGroupStatus;
  matchingCatalogItem: Readonly<{ id: string; code: string; name: string }> | null;
}>;

// H1-05: la normalización real (NFC + retirar controles ASCII 0x00-0x1F/0x7F +
// colapsar espacios + minúsculas) reproducida en SQL, para agrupar en la base
// de datos en vez de cargar cada línea especial de toda la historia a Node.
// Verificada contra `normalizeConceptKey` con casos reales de control/Unicode
// antes de usarse (ver tests/integration/special-concepts-service.test.ts).
const SQL_NORMALIZE_EXPRESSION = (column: string) => `LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE(${column}, NFC), '[\\x00-\\x1f\\x7f]', '', 'g'), '\\s+', ' ', 'g')))`;

type SpecialConceptGroupRow = {
  normalizedName: string;
  normalizedUnit: string;
  name: string;
  unit: string;
  occurrences: bigint;
  recentFolios: string[];
};

/**
 * K1-05 parte 2: agrupa todas las líneas de cotización especiales (sin
 * catalogItemId) de todo el sistema por nombre+unidad normalizados,
 * resolviendo si cada grupo ya fue promovido o ya coincide con un concepto de
 * catálogo existente. No hay scoping por responsable — es una vista de
 * administración de catálogo (catalog.manage), no de solicitudes.
 *
 * H1-05: la agregación (conteo de ocurrencias, folios más recientes) corre en
 * SQL, no en Node -- antes se cargaban TODAS las líneas especiales de la
 * historia completa a memoria sólo para agruparlas con un Map, sin ningún
 * límite; con volumen real de cotizaciones esto se degrada indefinidamente.
 * Un `take` ingenuo sobre las líneas crudas habría subcontado `occurrences` y
 * truncado `recentFolios` de forma silenciosa para cualquier concepto cuyas
 * líneas se extendieran más allá de esa ventana -- exactamente el error que
 * W1-01 ya enseñó esta sesión (un candidato acotado sólo es seguro cuando el
 * conjunto real es autolimitado). Aquí Postgres agrega el conjunto completo
 * sin cargarlo entero a Node; sólo la lista final de grupos (naturalmente
 * pequeña, un vocabulario de texto libre, no una tabla transaccional) llega
 * a la aplicación.
 */
export async function listSpecialConcepts(actor: Actor, dependencies: SpecialConceptServiceDependencies = {}): Promise<SpecialConceptGroup[]> {
  requireStaffPermission(actor, 'catalog.manage');
  const prisma = dependencies.prisma ?? getPrisma();

  const groupRows = await prisma.$queryRaw<SpecialConceptGroupRow[]>(Prisma.sql([
    `
    WITH normalized_lines AS (
      SELECT
        qls.name,
        qls.unit,
        qv."createdAt" AS created_at,
        qr.folio,
        ${SQL_NORMALIZE_EXPRESSION('qls.name')} AS normalized_name,
        ${SQL_NORMALIZE_EXPRESSION('qls.unit')} AS normalized_unit
      FROM quote_line_snapshots qls
      JOIN quote_versions qv ON qv.id = qls."quoteVersionId"
      JOIN quotes q ON q.id = qv."quoteId"
      JOIN quote_requests qr ON qr.id = q."quoteRequestId"
      WHERE qls."catalogItemId" IS NULL
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY normalized_name, normalized_unit ORDER BY created_at DESC) AS rn,
        COUNT(*) OVER (PARTITION BY normalized_name, normalized_unit) AS occurrences
      FROM normalized_lines
    )
    SELECT
      normalized_name AS "normalizedName",
      normalized_unit AS "normalizedUnit",
      MAX(name) FILTER (WHERE rn = 1) AS name,
      MAX(unit) FILTER (WHERE rn = 1) AS unit,
      MAX(occurrences) AS occurrences,
      MAX(created_at) FILTER (WHERE rn = 1) AS latest_at,
      ARRAY_AGG(folio ORDER BY rn) FILTER (WHERE rn <= ${RECENT_FOLIO_LIMIT}) AS "recentFolios"
    FROM ranked
    GROUP BY normalized_name, normalized_unit
    ORDER BY MAX(created_at) FILTER (WHERE rn = 1) DESC
    `,
  ]));

  if (groupRows.length === 0) return [];

  const promotions = await prisma.specialConceptPromotion.findMany({
    where: { OR: groupRows.map((group) => ({ normalizedName: group.normalizedName, unit: group.normalizedUnit })) },
    select: { normalizedName: true, unit: true, catalogItem: { select: { id: true, code: true, name: true } } },
  });
  const promotionByKey = new Map(promotions.map((promotion) => [`${promotion.normalizedName}::${promotion.unit}`, promotion.catalogItem]));

  // El catálogo activo se escanea completo a propósito (no narrowed por nombre): coincidir por
  // `normalizeConceptKey` exige comparar cada ítem normalizado contra el grupo, y un filtro `in`
  // con el nombre crudo del grupo perdería coincidencias reales que sólo difieren en mayúsculas o
  // espacios. El catálogo de una sola empresa es un conjunto de configuración acotado por diseño
  // (crece con el catálogo real, no con el volumen transaccional) -- misma excepción que el resto
  // de catálogo/listas de precios ya documentada en H1-05, no la query genuinamente sin límite.
  const namesInGroups = new Set(groupRows.map((group) => group.normalizedName));
  const matchingItems = namesInGroups.size ? await prisma.catalogItem.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, code: true, name: true, unit: true },
  }) : [];
  // La clave de identidad de un grupo (y de `SpecialConceptPromotion`) es nombre+unidad, no sólo
  // nombre -- dos conceptos especiales pueden compartir nombre con unidades distintas ("Ajuste de
  // terreno" en m2 vs. en servicio). Antes de esta corrección, esta coincidencia comparaba sólo el
  // nombre, así que un grupo podía marcarse "MATCHES_EXISTING" contra un ítem de catálogo activo
  // con el mismo nombre pero una unidad distinta, y el botón "Vincular" del panel (que no muestra la
  // unidad del ítem coincidente) lo habría enlazado en silencio.
  const matchingByKey = new Map<string, { id: string; code: string; name: string }>();
  for (const item of matchingItems) {
    const normalizedName = normalizeConceptKey(item.name);
    if (!namesInGroups.has(normalizedName)) continue;
    const key = `${normalizedName}::${normalizeConceptKey(item.unit)}`;
    if (!matchingByKey.has(key)) matchingByKey.set(key, { id: item.id, code: item.code, name: item.name });
  }

  return groupRows.map((group) => {
    const key = `${group.normalizedName}::${group.normalizedUnit}`;
    const promoted = promotionByKey.get(key);
    const base = { normalizedName: group.normalizedName, unit: group.unit, name: group.name, occurrences: Number(group.occurrences), recentFolios: group.recentFolios };
    if (promoted) return { ...base, status: 'PROMOTED' as const, matchingCatalogItem: promoted };
    const matching = matchingByKey.get(key);
    if (matching) return { ...base, status: 'MATCHES_EXISTING' as const, matchingCatalogItem: matching };
    return { ...base, status: 'PENDING' as const, matchingCatalogItem: null };
  });
}

export type PromoteSpecialConceptInput = Readonly<{
  name: string;
  unit: string;
  description?: string | null;
  categoryId?: string | null;
  code?: string;
}>;

export type PromoteSpecialConceptResult = Readonly<{
  catalogItem: { id: string; code: string; name: string };
  alreadyPromoted: boolean;
}>;

/**
 * Crea (o vincula, si ya existe) un CatalogItem real para un texto de
 * concepto especial, y deja constancia en el ledger de dedupe. Nunca toca
 * QuoteLineSnapshot — las cotizaciones históricas conservan su línea especial
 * exactamente como se enviaron.
 */
export async function promoteSpecialConcept(actor: Actor, input: PromoteSpecialConceptInput, dependencies: SpecialConceptServiceDependencies = {}): Promise<PromoteSpecialConceptResult> {
  requireStaffPermission(actor, 'catalog.manage');
  const prisma = dependencies.prisma ?? getPrisma();
  const name = normalizeRequiredText(input.name, 180, 'El nombre del concepto no es válido.');
  const unit = normalizeRequiredText(input.unit, 40, 'La unidad del concepto no es válida.');
  const description = normalizeOptionalText(input.description, 2_000, 'La descripción del concepto no es válida.');
  const categoryId = input.categoryId ? requireUuid(input.categoryId, 'La categoría no es válida.') : undefined;
  const normalizedName = normalizeConceptKey(name);
  const normalizedUnit = normalizeConceptKey(unit);

  const existingPromotion = await prisma.specialConceptPromotion.findUnique({
    where: { normalizedName_unit: { normalizedName, unit: normalizedUnit } },
    select: { catalogItem: { select: { id: true, code: true, name: true } } },
  });
  if (existingPromotion) return { catalogItem: existingPromotion.catalogItem, alreadyPromoted: true };

  // Mismo hallazgo que `listSpecialConcepts`: enlazar por nombre sin filtrar por unidad podía
  // vincular un concepto especial a un ítem de catálogo activo homónimo pero de unidad distinta.
  const existingItem = await prisma.catalogItem.findFirst({
    where: { status: 'ACTIVE', name: { equals: name, mode: 'insensitive' }, unit: { equals: unit, mode: 'insensitive' } },
    select: { id: true, code: true, name: true },
  });
  const catalogItem = existingItem ?? await createCatalogItem(actor, { code: input.code, name, description, unit, categoryId }, { prisma });

  try {
    await prisma.$transaction(async (transaction) => {
      const promotion = await transaction.specialConceptPromotion.create({
        data: { normalizedName, unit: normalizedUnit, catalogItemId: catalogItem.id, promotedById: actor.userId },
      });
      await audit(transaction, actor, 'catalog.special_concept.promoted', 'catalog_item', catalogItem.id, {
        promotionId: promotion.id,
        normalizedName,
        unit: normalizedUnit,
        linkedExisting: existingItem ? 'true' : 'false',
      });
      await outbox(transaction, 'CATALOG.SPECIAL_CONCEPT_PROMOTED', 'CATALOG_ITEM', catalogItem.id, { catalogItemId: catalogItem.id, promotionId: promotion.id });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.specialConceptPromotion.findUnique({
        where: { normalizedName_unit: { normalizedName, unit: normalizedUnit } },
        select: { catalogItem: { select: { id: true, code: true, name: true } } },
      });
      if (raced) return { catalogItem: raced.catalogItem, alreadyPromoted: true };
    }
    throw error;
  }

  return { catalogItem, alreadyPromoted: false };
}
