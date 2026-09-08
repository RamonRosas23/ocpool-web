import { createHash } from 'node:crypto';
import {
  agingBucketForSeconds,
  calculatePercentileSeconds,
  calculateAcceptanceRateBps,
  type DashboardQuery,
  type DashboardResponse,
  type DashboardScope,
  type MetricSummary,
} from '@/server/modules/analytics/domain';
import type { DashboardAggregates } from '@/server/modules/analytics/repository';

export type DashboardSerializationInput = {
  aggregates: DashboardAggregates;
  query: DashboardQuery;
  scope: DashboardScope;
  now: Date;
};

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

export function serializeDashboardResponse({ aggregates, query, scope, now }: DashboardSerializationInput): DashboardResponse {
  const usersById = new Map(aggregates.users.map((user) => [user.id, user]));
  const workload = aggregates.workload.map((row) => {
    const user = usersById.get(row.actorId);
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
    timing: {
      assignment: metricSummary(aggregates.requests.assignmentSeconds),
      quoteSent: metricSummary(aggregates.quotes.sentSeconds),
      acceptance: metricSummary(aggregates.quotes.acceptanceSeconds),
    },
    workload,
    notifications: {
      byStatus: aggregates.notifications.byStatus,
      oldestPendingAt: aggregates.notifications.oldestPendingAt?.toISOString() ?? null,
      failedInPeriod: aggregates.notifications.failedInPeriod,
    },
  };
}
