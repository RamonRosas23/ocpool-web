import { createHash } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { hasPermission, requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { getPrisma } from '@/server/db/client';
import { AppError } from '@/server/http/errors';
import { requireStaffRequestReadScope, staffRequestReadScopeWhere } from '@/server/auth/request-scope';

export const QUOTE_APPROVAL_TYPES = ['DISCOUNT', 'PRICE_OVERRIDE', 'SPECIAL_CONCEPT'] as const;
export type QuoteApprovalType = (typeof QUOTE_APPROVAL_TYPES)[number];
export const QUOTE_APPROVAL_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'] as const;
export type QuoteApprovalStatus = (typeof QUOTE_APPROVAL_STATUSES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/u;
const MAX_APPROVAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type RequestQuoteApprovalInput = Readonly<{
  type: QuoteApprovalType;
  policyVersion: string;
  thresholdBps?: number | null;
  reason?: string | null;
  expiresAt?: Date | null;
}>;

export type DecideQuoteApprovalInput = Readonly<{
  decision: 'APPROVED' | 'REJECTED';
  reason?: string | null;
}>;

export type QuoteApprovalResult = Readonly<{
  id: string;
  quoteId: string;
  quoteVersionId: string;
  type: QuoteApprovalType;
  status: QuoteApprovalStatus;
  policyVersion: string;
  digest: string;
  thresholdBps: number | null;
  reason: string | null;
  requestedById: string;
  decidedById: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
}>;

export type ApprovalServiceDependencies = Readonly<{
  prisma?: PrismaClient;
  now?: Date;
}>;

type QuoteVersionDigestRecord = Readonly<{
  id: string;
  quoteId: string;
  versionNumber: number;
  currencyCode: string;
  validUntil: Date | null;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxableTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
  lines: ReadonlyArray<Readonly<{
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
  }>>;
}>;

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

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason === undefined || reason === null) return null;
  const normalized = reason.trim();
  if (!normalized) return null;
  if (normalized.length > 500) validation('El motivo no puede superar 500 caracteres.');
  return normalized;
}

function normalizeExpiry(expiresAt: Date | null | undefined, now: Date): Date | null {
  if (expiresAt === undefined || expiresAt === null) return null;
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    validation('La fecha de expiración de la aprobación no es válida.');
  }
  if (expiresAt.getTime() > now.getTime() + MAX_APPROVAL_WINDOW_MS) {
    validation('La aprobación no puede tener una vigencia mayor a 30 días.');
  }
  return expiresAt;
}

function normalizeInput(input: RequestQuoteApprovalInput, now: Date) {
  if (!QUOTE_APPROVAL_TYPES.includes(input.type)) validation('El tipo de aprobación no es válido.');
  const policyVersion = input.policyVersion.trim();
  if (!POLICY_VERSION_PATTERN.test(policyVersion)) validation('La política de aprobación no es válida.');
  const thresholdBps = input.thresholdBps ?? null;
  if (thresholdBps !== null && (!Number.isInteger(thresholdBps) || thresholdBps < 0 || thresholdBps > 10_000)) {
    validation('El umbral de aprobación no es válido.');
  }
  return {
    type: input.type,
    policyVersion,
    thresholdBps,
    reason: normalizeReason(input.reason),
    expiresAt: normalizeExpiry(input.expiresAt, now),
  } as const;
}

function canonicalBigInt(value: bigint): string {
  return value.toString();
}

/** Digest immutable enough to detect any pricing change after approval. */
export function calculateQuoteVersionDigest(version: QuoteVersionDigestRecord): string {
  const canonical = {
    schemaVersion: 1,
    id: version.id,
    quoteId: version.quoteId,
    versionNumber: version.versionNumber,
    currencyCode: version.currencyCode,
    validUntil: version.validUntil?.toISOString() ?? null,
    totals: {
      subtotalMinor: canonicalBigInt(version.subtotalMinor),
      discountTotalMinor: canonicalBigInt(version.discountTotalMinor),
      taxableTotalMinor: canonicalBigInt(version.taxableTotalMinor),
      taxTotalMinor: canonicalBigInt(version.taxTotalMinor),
      totalMinor: canonicalBigInt(version.totalMinor),
    },
    lines: [...version.lines]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((line) => ({
        id: line.id,
        catalogItemId: line.catalogItemId,
        catalogItemCode: line.catalogItemCode,
        name: line.name,
        description: line.description,
        unit: line.unit,
        specialReason: line.specialReason,
        quantityMilliunits: canonicalBigInt(line.quantityMilliunits),
        currencyCode: line.currencyCode,
        unitPriceMinor: canonicalBigInt(line.unitPriceMinor),
        discountBasisPoints: line.discountBasisPoints,
        discountMinor: canonicalBigInt(line.discountMinor),
        taxableMinor: canonicalBigInt(line.taxableMinor),
        taxBasisPoints: line.taxBasisPoints,
        taxMinor: canonicalBigInt(line.taxMinor),
        subtotalMinor: canonicalBigInt(line.subtotalMinor),
        totalMinor: canonicalBigInt(line.totalMinor),
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

async function loadVersionForDigest(transaction: Prisma.TransactionClient, versionId: string) {
  const version = await transaction.quoteVersion.findUnique({
    where: { id: versionId },
    include: { lines: true },
  });
  if (!version) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);
  return version;
}

export async function getQuoteVersionDigest(transaction: Prisma.TransactionClient, versionId: string): Promise<string> {
  return calculateQuoteVersionDigest(await loadVersionForDigest(transaction, versionId));
}

function serializeApproval(approval: QuoteApprovalResult): QuoteApprovalResult {
  return approval;
}

export async function requestQuoteApproval(
  actor: Actor,
  quoteVersionId: string,
  input: RequestQuoteApprovalInput,
  dependencies: ApprovalServiceDependencies = {},
): Promise<QuoteApprovalResult> {
  requireEmployeePermission(actor, 'quotes.create');
  const versionId = requireUuid(quoteVersionId, 'La versión no es válida.');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const normalized = normalizeInput(input, now);
  if (normalized.type === 'PRICE_OVERRIDE') {
    validation('La aprobación de ajustes de precio todavía no está habilitada.');
  }

  return prisma.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string; quoteId: string; status: string; discountTotalMinor: bigint; hasSpecialLine: boolean; quoteRequestId: string; folio: string; currentAssigneeId: string | null }>>(Prisma.sql`
      SELECT qv."id", qv."quoteId", qv."status", qv."discountTotalMinor",
        EXISTS (SELECT 1 FROM "quote_line_snapshots" qls WHERE qls."quoteVersionId" = qv."id" AND qls."catalogItemId" IS NULL) AS "hasSpecialLine",
        q."quoteRequestId", qr."folio", qr."currentAssigneeId"
      FROM "quote_versions" qv
      INNER JOIN "quotes" q ON q."id" = qv."quoteId"
      INNER JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
      WHERE qv."id" = ${versionId}
      FOR UPDATE
    `);
    const row = locked[0];
    if (!row) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);
    requireStaffRequestReadScope(actor, row.currentAssigneeId);
    if (row.status !== 'EN_REVISION') conflict('La cotización debe estar en revisión antes de solicitar una aprobación.');
    if (normalized.type === 'DISCOUNT' && row.discountTotalMinor <= 0n) {
      validation('La versión no contiene un descuento que requiera aprobación.');
    }
    if (normalized.type === 'SPECIAL_CONCEPT' && !row.hasSpecialLine) {
      validation('La versión no contiene conceptos especiales que requieran aprobación.');
    }

    const version = await loadVersionForDigest(transaction, versionId);
    const digest = calculateQuoteVersionDigest(version);
    // `(quoteVersionId, type, digest)` is unique regardless of status: a version whose discount
    // was REJECTED (now easy to trigger for real from the staff UI, see the reject-reason dialog
    // added alongside this fix) keeps that REJECTED row on the exact same digest. Re-requesting an
    // unchanged version used to try to INSERT a second row on that same key and crash with a
    // Postgres unique-violation 500. Any pre-existing row for this digest — live or not — must be
    // revived in place instead of a fresh one being created.
    const existing = await transaction.quoteApproval.findFirst({
      where: { quoteVersionId: versionId, type: normalized.type, digest },
      orderBy: { requestedAt: 'desc' },
    });
    if (existing && (existing.status === 'REQUESTED' || existing.status === 'APPROVED') && (existing.expiresAt === null || existing.expiresAt > now)) {
      return serializeApproval(existing as QuoteApprovalResult);
    }

    await transaction.quoteApproval.updateMany({
      where: { quoteVersionId: versionId, type: normalized.type, status: { in: ['REQUESTED', 'APPROVED'] }, ...(existing ? { id: { not: existing.id } } : {}) },
      data: { status: 'SUPERSEDED', decidedAt: null, decidedById: null },
    });
    const approval = existing
      ? await transaction.quoteApproval.update({
          where: { id: existing.id },
          data: {
            status: 'REQUESTED',
            policyVersion: normalized.policyVersion,
            thresholdBps: normalized.thresholdBps,
            reason: normalized.reason,
            requestedById: actor.userId,
            expiresAt: normalized.expiresAt,
            requestedAt: now,
            decidedAt: null,
            decidedById: null,
          },
        })
      : await transaction.quoteApproval.create({
          data: {
            quoteId: version.quoteId,
            quoteVersionId: version.id,
            type: normalized.type,
            status: 'REQUESTED',
            policyVersion: normalized.policyVersion,
            digest,
            thresholdBps: normalized.thresholdBps,
            reason: normalized.reason,
            requestedById: actor.userId,
            expiresAt: normalized.expiresAt,
            requestedAt: now,
          },
        });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'quote.approval.requested',
        entityType: 'quote_approval',
        entityId: approval.id,
        outcome: 'SUCCESS',
        // `quoteRequestId` is not surfaced in the Audit Log's displayed details for this action (see
        // AUDIT_ACTION_DEFINITIONS), but it's what lets the log link this entry to the actual request
        // (/staff/quotes?request=<id> is the only staff surface that can reach an approval today).
        metadata: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: row.quoteRequestId, type: normalized.type, policyVersion: normalized.policyVersion, digest },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'QUOTE.APPROVAL_REQUESTED',
        aggregateType: 'QUOTE',
        aggregateId: version.quoteId,
        payload: { quoteId: version.quoteId, quoteVersionId: version.id, quoteRequestId: row.quoteRequestId, folio: row.folio, versionNumber: version.versionNumber, approvalId: approval.id, type: normalized.type },
      },
    });
    return serializeApproval(approval as QuoteApprovalResult);
  });
}

export async function decideQuoteApproval(
  actor: Actor,
  approvalId: string,
  input: DecideQuoteApprovalInput,
  dependencies: ApprovalServiceDependencies = {},
): Promise<QuoteApprovalResult> {
  requireEmployeePermission(actor, 'quotes.approve_discount');
  const normalizedId = requireUuid(approvalId, 'La aprobación no es válida.');
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') validation('La decisión no es válida.');
  const reason = normalizeReason(input.reason);
  if (input.decision === 'REJECTED' && !reason) validation('Indica el motivo del rechazo.');
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();

  return prisma.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string; quoteId: string; quoteVersionId: string; status: string; requestedById: string; digest: string; type: string; expiresAt: Date | null; currentAssigneeId: string | null }>>(Prisma.sql`
      SELECT qa."id", qa."quoteId", qa."quoteVersionId", qa."status", qa."requestedById", qa."digest", qa."type", qa."expiresAt", qr."currentAssigneeId"
      FROM "quote_approvals" qa
      INNER JOIN "quote_versions" qv ON qv."id" = qa."quoteVersionId"
      INNER JOIN "quotes" q ON q."id" = qv."quoteId"
      INNER JOIN "quote_requests" qr ON qr."id" = q."quoteRequestId"
      WHERE qa."id" = ${normalizedId}
      FOR UPDATE
    `);
    const row = locked[0];
    if (!row) throw new AppError('NOT_FOUND', 'La aprobación no existe.', 404);
    requireStaffRequestReadScope(actor, row.currentAssigneeId);
    if (row.status !== 'REQUESTED') conflict('La aprobación ya fue resuelta.');
    if (row.expiresAt && row.expiresAt <= now) conflict('La aprobación ya expiró.');
    if (row.requestedById === actor.userId && !hasPermission(actor, 'quotes.approval.override')) conflict('La aprobación debe resolverla otra persona.');
    const currentDigest = await getQuoteVersionDigest(transaction, row.quoteVersionId);
    if (currentDigest !== row.digest) conflict('La cotización cambió; solicita una nueva aprobación.');
    const quoteContext = await transaction.quote.findUnique({
      where: { id: row.quoteId },
      select: { quoteRequestId: true, quoteRequest: { select: { folio: true } } },
    });
    if (!quoteContext) throw new AppError('NOT_FOUND', 'La cotización no existe.', 404);
    const versionContext = await transaction.quoteVersion.findUnique({ where: { id: row.quoteVersionId }, select: { versionNumber: true } });
    if (!versionContext) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);

    const approval = await transaction.quoteApproval.update({
      where: { id: normalizedId },
      data: { status: input.decision, decidedById: actor.userId, decidedAt: now, reason: reason ?? undefined },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: `quote.approval.${input.decision.toLowerCase()}`,
        entityType: 'quote_approval',
        entityId: approval.id,
        outcome: 'SUCCESS',
        // `quoteRequestId` is not surfaced in the Audit Log's displayed details for this action (see
        // AUDIT_ACTION_DEFINITIONS), but it's what lets the log link this entry to the actual request
        // (/staff/quotes?request=<id> is the only staff surface that can reach an approval today).
        metadata: { quoteId: row.quoteId, quoteVersionId: row.quoteVersionId, quoteRequestId: quoteContext.quoteRequestId, type: row.type, digest: row.digest },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'QUOTE.APPROVAL_RESOLVED',
        aggregateType: 'QUOTE',
        aggregateId: row.quoteId,
        payload: { quoteId: row.quoteId, quoteVersionId: row.quoteVersionId, quoteRequestId: quoteContext.quoteRequestId, folio: quoteContext.quoteRequest.folio, versionNumber: versionContext.versionNumber, approvalId: approval.id, status: input.decision, type: row.type },
      },
    });
    return serializeApproval(approval as QuoteApprovalResult);
  });
}

export async function listQuoteApprovals(
  actor: Actor,
  quoteVersionId: string,
  dependencies: ApprovalServiceDependencies = {},
): Promise<QuoteApprovalResult[]> {
  requireEmployeePermission(actor, 'quotes.read');
  const versionId = requireUuid(quoteVersionId, 'La versión no es válida.');
  const prisma = dependencies.prisma ?? getPrisma();
  const version = await prisma.quoteVersion.findFirst({
    where: { id: versionId, quote: { quoteRequest: staffRequestReadScopeWhere(actor) } },
    select: { id: true },
  });
  if (!version) throw new AppError('NOT_FOUND', 'La versión no existe.', 404);
  const rows = await prisma.quoteApproval.findMany({ where: { quoteVersionId: versionId }, orderBy: { requestedAt: 'desc' } });
  return rows as QuoteApprovalResult[];
}

export type PendingQuoteApprovalSummary = Readonly<{
  id: string;
  type: QuoteApprovalType;
  requestedAt: Date;
  requestId: string;
  folio: string;
  clientDisplayName: string;
  versionNumber: number;
  totalMinor: string;
  currencyCode: string;
}>;

// W1-02: cola global de aprobaciones pendientes que este actor puede resolver — mismo scope de
// lectura de R1 (mine/global) y la misma regla de separación de funciones que decideQuoteApproval,
// para no listar como "tuyas" aprobaciones que el propio servidor rechazaría si se intentan resolver.
export async function listPendingQuoteApprovalsForActor(actor: Actor, dependencies: ApprovalServiceDependencies = {}): Promise<PendingQuoteApprovalSummary[]> {
  if (!hasPermission(actor, 'quotes.approve_discount')) return [];
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const canOverride = hasPermission(actor, 'quotes.approval.override');
  const rows = await prisma.quoteApproval.findMany({
    where: {
      status: 'REQUESTED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(canOverride ? {} : { requestedById: { not: actor.userId } }),
      quoteVersion: { quote: { quoteRequest: staffRequestReadScopeWhere(actor) } },
    },
    orderBy: { requestedAt: 'asc' },
    take: 20,
    select: {
      id: true,
      type: true,
      requestedAt: true,
      quoteVersion: {
        select: {
          versionNumber: true,
          totalMinor: true,
          currencyCode: true,
          quote: { select: { quoteRequest: { select: { id: true, folio: true, client: { select: { displayName: true } } } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    requestedAt: row.requestedAt,
    requestId: row.quoteVersion.quote.quoteRequest.id,
    folio: row.quoteVersion.quote.quoteRequest.folio,
    clientDisplayName: row.quoteVersion.quote.quoteRequest.client.displayName,
    versionNumber: row.quoteVersion.versionNumber,
    totalMinor: row.quoteVersion.totalMinor.toString(),
    currencyCode: row.quoteVersion.currencyCode,
  }));
}

export type PendingQuoteApprovalDetail = Readonly<{
  id: string;
  type: QuoteApprovalType;
  requestedAt: Date;
  reason: string | null;
  policyVersion: string;
  requestedByDisplayName: string;
  requestId: string;
  folio: string;
  clientDisplayName: string;
  projectType: string | null;
  versionNumber: number;
  subtotalMinor: string;
  discountTotalMinor: string;
  totalMinor: string;
  currencyCode: string;
}>;

export type PendingQuoteApprovalPage = Readonly<{ items: PendingQuoteApprovalDetail[]; page: number; pageSize: number; total: number; totalPages: number }>;

/// A1-03/A1-05: `/staff/approvals` is "an authorized view, not a separate universe" -- same
/// eligibility/scope rules as `listPendingQuoteApprovalsForActor` (the dashboard card), just paged
/// and with the pricing/reason detail a manager actually needs to decide without opening the
/// expediente first. Order is oldest-first only, the one documented rule the plan calls for --
/// no opaque "urgent" weighting on top of it.
export async function listPendingQuoteApprovalsPageForActor(actor: Actor, filters: Readonly<{ page?: number; pageSize?: number }> = {}, dependencies: ApprovalServiceDependencies = {}): Promise<PendingQuoteApprovalPage> {
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 20));
  const page = Math.max(1, filters.page ?? 1);
  if (!hasPermission(actor, 'quotes.approve_discount')) return { items: [], page: 1, pageSize, total: 0, totalPages: 0 };
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const canOverride = hasPermission(actor, 'quotes.approval.override');
  const where = {
    status: 'REQUESTED' as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    ...(canOverride ? {} : { requestedById: { not: actor.userId } }),
    quoteVersion: { quote: { quoteRequest: staffRequestReadScopeWhere(actor) } },
  };
  const [total, rows] = await Promise.all([
    prisma.quoteApproval.count({ where }),
    prisma.quoteApproval.findMany({
      where,
      orderBy: { requestedAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        requestedAt: true,
        reason: true,
        policyVersion: true,
        requestedBy: { select: { displayName: true } },
        quoteVersion: {
          select: {
            versionNumber: true,
            subtotalMinor: true,
            discountTotalMinor: true,
            totalMinor: true,
            currencyCode: true,
            quote: { select: { quoteRequest: { select: { id: true, folio: true, client: { select: { displayName: true } }, detail: { select: { projectType: true } } } } } },
          },
        },
      },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      requestedAt: row.requestedAt,
      reason: row.reason,
      policyVersion: row.policyVersion,
      requestedByDisplayName: row.requestedBy.displayName,
      requestId: row.quoteVersion.quote.quoteRequest.id,
      folio: row.quoteVersion.quote.quoteRequest.folio,
      clientDisplayName: row.quoteVersion.quote.quoteRequest.client.displayName,
      projectType: row.quoteVersion.quote.quoteRequest.detail?.projectType ?? null,
      versionNumber: row.quoteVersion.versionNumber,
      subtotalMinor: row.quoteVersion.subtotalMinor.toString(),
      discountTotalMinor: row.quoteVersion.discountTotalMinor.toString(),
      totalMinor: row.quoteVersion.totalMinor.toString(),
      currencyCode: row.quoteVersion.currencyCode,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function hasValidApprovedQuoteApproval(
  transaction: Prisma.TransactionClient,
  versionId: string,
  type: QuoteApprovalType,
  now: Date,
): Promise<boolean> {
  const digest = await getQuoteVersionDigest(transaction, versionId);
  const approval = await transaction.quoteApproval.findFirst({
    where: { quoteVersionId: versionId, type, status: 'APPROVED', digest, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true },
  });
  return Boolean(approval);
}
