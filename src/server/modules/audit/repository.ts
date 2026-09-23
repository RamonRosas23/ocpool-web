import { Prisma } from '@/generated/prisma/client';
import type { AuthEventType } from '@/generated/prisma/enums';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  auditActionsForCategory,
  auditRangeUpperBound,
  knownAuthEventTypes,
  type AuditCategory,
  type AuditOutcome,
  type AuditQuery,
  type AuditSource,
} from '@/server/modules/audit/domain';

export type AuditRepositoryQuery = AuditQuery & {
  source: AuditSource;
};

export type OperationalAuditRow = {
  source: 'operational';
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  outcome: AuditOutcome;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

export type SecurityAuditRow = {
  source: 'security';
  id: string;
  userId: string | null;
  eventType: string;
  outcome: AuditOutcome;
  createdAt: Date;
};

export type AuditRow = OperationalAuditRow | SecurityAuditRow;

export type AuditPage = {
  rows: AuditRow[];
  hasMore: boolean;
  actorIds: string[];
};

function cursorWhere(query: AuditRepositoryQuery): Prisma.AuditLogWhereInput[] {
  if (!query.cursor) return [];
  return [{
    OR: [
      { createdAt: { lt: new Date(query.cursor.createdAt) } },
      { createdAt: new Date(query.cursor.createdAt), id: { lt: query.cursor.id } },
    ],
  }];
}

function dateWhere(query: AuditRepositoryQuery): { createdAt: { gte: Date; lt: Date } } {
  return { createdAt: { gte: query.from, lt: auditRangeUpperBound(query.to, query.timezone) } };
}

function actionFilter(category: AuditCategory | null): { in: string[] } {
  return { in: auditActionsForCategory(category === 'security' ? null : category) };
}

export async function readAuditPage(prisma: PrismaClient, query: AuditRepositoryQuery): Promise<AuditPage> {
  if (query.source === 'operational') {
    const where: Prisma.AuditLogWhereInput = {
      AND: [...cursorWhere(query)],
      ...dateWhere(query),
      action: actionFilter(query.category),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: { id: true, actorUserId: true, action: true, entityType: true, outcome: true, metadata: true, createdAt: true },
    });
    const pageRows = rows.slice(0, query.limit).map((row) => ({ ...row, source: 'operational' as const, outcome: row.outcome as AuditOutcome }));
    return {
      rows: pageRows,
      hasMore: rows.length > query.limit,
      actorIds: [...new Set(pageRows.map((row) => row.actorUserId).filter((value): value is string => Boolean(value)))],
    };
  }

  const securityWhere: Prisma.AuthEventWhereInput = {
    AND: query.cursor ? [{
      OR: [
        { createdAt: { lt: new Date(query.cursor.createdAt) } },
        { createdAt: new Date(query.cursor.createdAt), id: { lt: query.cursor.id } },
      ],
    }] : [],
    ...dateWhere(query),
    eventType: { in: knownAuthEventTypes() as AuthEventType[] },
    ...(query.outcome ? { outcome: query.outcome } : {}),
  };
  const rows = await prisma.authEvent.findMany({
    where: securityWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: { id: true, userId: true, eventType: true, outcome: true, createdAt: true },
  });
  const pageRows = rows.slice(0, query.limit).map((row) => ({ ...row, source: 'security' as const, outcome: row.outcome as AuditOutcome, eventType: String(row.eventType) }));
  return {
    rows: pageRows,
    hasMore: rows.length > query.limit,
    actorIds: [...new Set(pageRows.map((row) => row.userId).filter((value): value is string => Boolean(value)))],
  };
}
