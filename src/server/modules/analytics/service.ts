import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { hasPermission, requirePermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { readServerEnv } from '@/server/env';
import { AppError } from '@/server/http/errors';
import {
  calculateAcceptanceRateBps,
  calculatePercentileSeconds,
  agingBucketForSeconds,
  normalizeDashboardQuery,
  type DashboardQueryInput,
  type DashboardResponse,
  type MetricSummary,
} from '@/server/modules/analytics/domain';
import { readDashboardAggregates, type DashboardRepositoryQuery } from '@/server/modules/analytics/repository';
import { getPrisma } from '@/server/db/client';

export type AnalyticsServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  timezone?: string;
};

function requireDashboardAccess(actor: Actor): 'self' | 'global' {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'metrics.read');
  return hasPermission(actor, 'metrics.read.global') ? 'global' : 'self';
}

function actorKey(id: string): string {
  return createHash('sha256').update(`ocpool-analytics:${id}`).digest('hex').slice(0, 16);
}

function metricSummary(values: readonly number[]): MetricSummary {
  const suppressed = values.length < 5;
  return {
    sampleSize: suppressed ? null : values.length,
    p50Seconds: calculatePercentileSeconds(values, 0.5),
    p90Seconds: calculatePercentileSeconds(values, 0.9),
    suppressed,
  };
}

export async function getStaffDashboard(
  actor: Actor,
  input: DashboardQueryInput = {},
  dependencies: AnalyticsServiceDependencies = {},
): Promise<DashboardResponse> {
  const scope = requireDashboardAccess(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  let query;
  try {
    query = normalizeDashboardQuery({ ...input, now, timezone: input.timezone ?? dependencies.timezone ?? readServerEnv().APP_TIMEZONE });
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', 'El rango de fechas no es válido.', 400, { cause: error });
  }
  const repositoryQuery: DashboardRepositoryQuery = { ...query, scope, actorUserId: scope === 'self' ? actor.userId : null, now };
  const aggregates = await readDashboardAggregates(prisma, repositoryQuery);
  const timing = {
    assignment: metricSummary(aggregates.requests.assignmentSeconds),
    quoteSent: metricSummary(aggregates.quotes.sentSeconds),
    acceptance: metricSummary(aggregates.quotes.acceptanceSeconds),
  };
  const workload = aggregates.workload.map((row) => {
    const user = aggregates.users.find((candidate) => candidate.id === row.actorId);
    const suppressed = row.activeRequests + row.draftQuotes < 5;
    return {
      actorKey: actorKey(row.actorId),
      displayName: user?.displayName ?? 'Responsable activo',
      activeRequests: suppressed ? null : row.activeRequests,
      draftQuotes: suppressed ? null : row.draftQuotes,
      oldestOpenAt: suppressed ? null : row.oldestOpenAt?.toISOString() ?? null,
      suppressed,
    };
  });
  const aging = new Map<string, number>();
  for (const seconds of aggregates.requests.agingSeconds) {
    const bucket = agingBucketForSeconds(seconds);
    aging.set(bucket, (aging.get(bucket) ?? 0) + 1);
  }
  return {
    meta: {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      timezone: query.timezone,
      generatedAt: now.toISOString(),
      freshness: 'fresh',
      scope,
    },
    requests: {
      received: aggregates.requests.received,
      unassigned: aggregates.requests.unassigned,
      byStatus: aggregates.requests.byStatus,
      byOrigin: aggregates.requests.byOrigin,
      aging: [...aging.entries()].map(([bucket, count]) => ({ bucket, count })),
    },
    quotes: {
      sent: aggregates.quotes.sent,
      accepted: aggregates.quotes.accepted,
      acceptanceRateBps: calculateAcceptanceRateBps(aggregates.quotes.sent, aggregates.quotes.accepted),
      acceptedTotals: aggregates.quotes.acceptedTotals.map((row) => ({ ...row, totalMinor: row.totalMinor.toString() })),
      byStatus: aggregates.quotes.byStatus,
    },
    timing,
    workload,
    notifications: {
      byStatus: aggregates.notifications.byStatus,
      oldestPendingAt: aggregates.notifications.oldestPendingAt?.toISOString() ?? null,
      failedInPeriod: aggregates.notifications.failedInPeriod,
    },
  };
}
