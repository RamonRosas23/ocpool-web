import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import type { DashboardQuery } from '@/server/modules/analytics/domain';
import { getNotificationOperationalHealth } from '@/server/modules/notifications/operations';

const OPEN_REQUEST_STATUSES = ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION'] as const;

export type DashboardRepositoryQuery = DashboardQuery & {
  actorUserId: string | null;
  now: Date;
};

export type DashboardAggregates = {
  requests: {
    received: number;
    unassigned: number;
    byStatus: Array<{ status: string; count: number }>;
    byOrigin: Array<{ origin: string; count: number }>;
    agingSeconds: number[];
    assignmentSeconds: number[];
  };
  quotes: {
    sent: number;
    accepted: number;
    acceptedTotals: Array<{ currencyCode: string; totalMinor: bigint; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
    sentSeconds: number[];
    acceptanceSeconds: number[];
  };
  workload: Array<{ actorId: string; activeRequests: number; draftQuotes: number; oldestOpenAt: Date | null }>;
  users: Array<{ id: string; displayName: string }>;
  notifications: {
    byStatus: Array<{ status: string; count: number }>;
    oldestPendingAt: Date | null;
    failedInPeriod: number;
  };
};

function requestScopeWhere(query: DashboardRepositoryQuery): Prisma.QuoteRequestWhereInput {
  return query.scope === 'self' ? { currentAssigneeId: query.actorUserId } : {};
}

function quoteScopeWhere(query: DashboardRepositoryQuery): Prisma.QuoteWhereInput {
  return query.scope === 'self' ? { quoteRequest: { currentAssigneeId: query.actorUserId } } : {};
}

function sortCounts<T extends { count: number }>(rows: T[], key: keyof T): T[] {
  return [...rows].sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

export async function readDashboardAggregates(prisma: PrismaClient, query: DashboardRepositoryQuery): Promise<DashboardAggregates> {
  const requestPeriodWhere: Prisma.QuoteRequestWhereInput = {
    ...requestScopeWhere(query),
    createdAt: { gte: query.from, lt: query.to },
  };
  const quotePeriodWhere: Prisma.QuoteWhereInput = quoteScopeWhere(query);
  const quoteVersionPeriodWhere: Prisma.QuoteVersionWhereInput = {
    createdAt: { gte: query.from, lt: query.to },
    quote: quotePeriodWhere,
  };
  const statusHistoryPeriodWhere: Prisma.QuoteStatusHistoryWhereInput = {
    createdAt: { gte: query.from, lt: query.to },
    toStatus: 'ENVIADA',
    quoteVersion: { quote: quotePeriodWhere },
  };

  const [
    received,
    unassigned,
    statusRows,
    originRows,
    agingRows,
    assignments,
    sentRows,
    acceptedRows,
    quoteStatusRows,
    workloadRequests,
    workloadQuotes,
    notificationHealth,
    failedInPeriod,
  ] = await Promise.all([
    prisma.quoteRequest.count({ where: requestPeriodWhere }),
    query.scope === 'self'
      ? Promise.resolve(0)
      : prisma.quoteRequest.count({ where: { ...requestPeriodWhere, currentAssigneeId: null } }),
    prisma.quoteRequest.groupBy({ by: ['status'], where: requestPeriodWhere, _count: { _all: true } }),
    prisma.quoteRequest.groupBy({ by: ['origin'], where: requestPeriodWhere, _count: { _all: true } }),
    prisma.quoteRequest.findMany({
      where: { ...requestScopeWhere(query), status: { in: [...OPEN_REQUEST_STATUSES] }, createdAt: { lt: query.now } },
      orderBy: { createdAt: 'asc' },
      take: 5_000,
      select: { createdAt: true },
    }),
    prisma.requestAssignment.findMany({
      where: {
        assignedAt: { gte: query.from, lt: query.to },
        ...(query.scope === 'self' && query.actorUserId ? { assignedToId: query.actorUserId } : {}),
        quoteRequest: requestScopeWhere(query),
      },
      select: { assignedAt: true, quoteRequest: { select: { createdAt: true } } },
    }),
    prisma.quoteStatusHistory.findMany({
      where: statusHistoryPeriodWhere,
      select: { createdAt: true, quoteVersion: { select: { quote: { select: { quoteRequest: { select: { createdAt: true } } } } } } },
    }),
    prisma.quoteAcceptance.findMany({
      where: { acceptedAt: { gte: query.from, lt: query.to }, quote: quotePeriodWhere },
      select: {
        acceptedAt: true,
        quoteVersion: {
          select: {
            totalMinor: true,
            currencyCode: true,
            statusHistory: { where: { toStatus: 'ENVIADA' }, orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } },
          },
        },
      },
    }),
    prisma.quoteVersion.groupBy({ by: ['status'], where: quoteVersionPeriodWhere, _count: { _all: true } }),
    prisma.quoteRequest.findMany({
      where: { ...requestScopeWhere(query), status: { in: [...OPEN_REQUEST_STATUSES] } },
      select: { currentAssigneeId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5_000,
    }),
    prisma.quoteVersion.findMany({
      where: { status: { in: ['BORRADOR', 'EN_REVISION'] }, quote: quotePeriodWhere },
      select: { createdById: true },
      take: 5_000,
    }),
    getNotificationOperationalHealth(prisma),
    prisma.notificationDelivery.count({ where: { status: 'FAILED', updatedAt: { gte: query.from, lt: query.to } } }),
  ]);

  const workloadMap = new Map<string, { activeRequests: number; draftQuotes: number; oldestOpenAt: Date | null }>();
  for (const request of workloadRequests) {
    if (!request.currentAssigneeId) continue;
    const current = workloadMap.get(request.currentAssigneeId) ?? { activeRequests: 0, draftQuotes: 0, oldestOpenAt: null };
    current.activeRequests += 1;
    if (!current.oldestOpenAt || request.createdAt < current.oldestOpenAt) current.oldestOpenAt = request.createdAt;
    workloadMap.set(request.currentAssigneeId, current);
  }
  for (const quote of workloadQuotes) {
    const current = workloadMap.get(quote.createdById) ?? { activeRequests: 0, draftQuotes: 0, oldestOpenAt: null };
    current.draftQuotes += 1;
    workloadMap.set(quote.createdById, current);
  }
  const workloadActorIds = [...workloadMap.keys()];
  const users = workloadActorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: workloadActorIds }, type: 'EMPLOYEE', status: 'ACTIVE' }, select: { id: true, displayName: true } });

  const acceptedTotals = new Map<string, { totalMinor: bigint; count: number }>();
  const acceptanceSeconds: number[] = [];
  for (const accepted of acceptedRows) {
    const current = acceptedTotals.get(accepted.quoteVersion.currencyCode) ?? { totalMinor: 0n, count: 0 };
    current.totalMinor += accepted.quoteVersion.totalMinor;
    current.count += 1;
    acceptedTotals.set(accepted.quoteVersion.currencyCode, current);
    const sentAt = accepted.quoteVersion.statusHistory[0]?.createdAt;
    if (sentAt) acceptanceSeconds.push(Math.max(0, (accepted.acceptedAt.getTime() - sentAt.getTime()) / 1000));
  }

  return {
    requests: {
      received,
      unassigned,
      byStatus: sortCounts(statusRows.map((row) => ({ status: row.status, count: row._count._all })), 'status'),
      byOrigin: sortCounts(originRows.map((row) => ({ origin: row.origin, count: row._count._all })), 'origin'),
      agingSeconds: agingRows.map((row) => Math.max(0, (query.now.getTime() - row.createdAt.getTime()) / 1000)),
      assignmentSeconds: assignments.map((row) => Math.max(0, (row.assignedAt.getTime() - row.quoteRequest.createdAt.getTime()) / 1000)),
    },
    quotes: {
      sent: sentRows.length,
      accepted: acceptedRows.length,
      acceptedTotals: [...acceptedTotals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currencyCode, value]) => ({ currencyCode, ...value })),
      byStatus: sortCounts(quoteStatusRows.map((row) => ({ status: row.status, count: row._count._all })), 'status'),
      sentSeconds: sentRows.map((row) => Math.max(0, (row.createdAt.getTime() - row.quoteVersion.quote.quoteRequest.createdAt.getTime()) / 1000)),
      acceptanceSeconds,
    },
    workload: workloadActorIds.sort().map((actorId) => ({ actorId, ...workloadMap.get(actorId)! })),
    users,
    notifications: {
      byStatus: [
        { status: 'CANCELLED', count: notificationHealth.cancelled },
        { status: 'FAILED', count: notificationHealth.failed },
        { status: 'PENDING', count: notificationHealth.pending },
        { status: 'PROCESSING', count: notificationHealth.processing },
        { status: 'SENT', count: notificationHealth.sent },
      ],
      oldestPendingAt: notificationHealth.oldestPendingAt,
      failedInPeriod,
    },
  };
}
