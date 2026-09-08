import type { PrismaClient } from '@/generated/prisma/client';
import { hasPermission, requirePermission } from '@/server/auth/permissions';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import type { Actor } from '@/server/auth/types';
import { readServerEnv } from '@/server/env';
import { AppError } from '@/server/http/errors';
import {
  normalizeDashboardQuery,
  type DashboardQueryInput,
  type DashboardResponse,
} from '@/server/modules/analytics/domain';
import { readDashboardAggregates, type DashboardRepositoryQuery } from '@/server/modules/analytics/repository';
import { serializeDashboardResponse } from '@/server/modules/analytics/serialization';
import { getPrisma } from '@/server/db/client';

export type AnalyticsServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  timezone?: string;
  rateLimit?: (input: { key: string; now: Date }) => Promise<{ allowed: boolean; retryAfterSeconds: number | null }>;
};

const ANALYTICS_RATE_LIMIT_SCOPE = 'analytics-dashboard-read';

function requireDashboardAccess(actor: Actor): 'self' | 'global' {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'metrics.read');
  return hasPermission(actor, 'metrics.read.global') ? 'global' : 'self';
}

export async function getStaffDashboard(
  actor: Actor,
  input: DashboardQueryInput = {},
  dependencies: AnalyticsServiceDependencies = {},
): Promise<DashboardResponse> {
  const scope = requireDashboardAccess(actor);
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const environment = readServerEnv();
  let query;
  try {
    query = normalizeDashboardQuery({ ...input, now, timezone: input.timezone ?? dependencies.timezone ?? environment.APP_TIMEZONE });
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', 'El rango de fechas no es válido.', 400, { cause: error });
  }
  const rateLimit = dependencies.rateLimit ?? ((rateLimitInput) => checkAuthRateLimit({
    scope: ANALYTICS_RATE_LIMIT_SCOPE,
    key: rateLimitInput.key,
    maxAttempts: environment.ANALYTICS_RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: environment.ANALYTICS_RATE_LIMIT_WINDOW_MINUTES,
    now: rateLimitInput.now,
  }));
  const rateLimitDecision = await rateLimit({ key: actor.userId, now });
  if (!rateLimitDecision.allowed) throw new AppError('RATE_LIMITED', 'Has alcanzado el límite temporal de consultas.', 429);
  const repositoryQuery: DashboardRepositoryQuery = { ...query, scope, actorUserId: scope === 'self' ? actor.userId : null, now };
  const aggregates = await readDashboardAggregates(prisma, repositoryQuery);
  return serializeDashboardResponse({ aggregates, query, scope, now });
}
