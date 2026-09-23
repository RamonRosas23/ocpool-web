import type { PrismaClient } from '@/generated/prisma/client';
import { requirePermission } from '@/server/auth/permissions';
import { checkAuthRateLimit } from '@/server/auth/rate-limit';
import type { Actor } from '@/server/auth/types';
import { readServerEnv } from '@/server/env';
import { AppError } from '@/server/http/errors';
import {
  auditActionLabel,
  auditEntryLink,
  authEventActionLabel,
  classifyAuditAction,
  classifyAuthEvent,
  encodeAuditCursor,
  entityLabelForType,
  normalizeAuditQuery,
  opaqueAuditKey,
  projectAuditMetadata,
  type AuditEntry,
  type AuditQueryInput,
  type AuditResponse,
  type AuditSource,
} from '@/server/modules/audit/domain';
import { readAuditPage, type AuditRow } from '@/server/modules/audit/repository';
import { getPrisma } from '@/server/db/client';

export type AuditRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
};

export type AuditRateLimit = (input: { key: string; now: Date }) => Promise<AuditRateLimitDecision>;

export type AuditServiceDependencies = {
  prisma?: PrismaClient;
  now?: Date;
  timezone?: string;
  cursorSecret?: string;
  rateLimit?: AuditRateLimit;
};

const AUDIT_RATE_LIMIT_SCOPE = 'audit-read';

function sourceForInput(input: AuditQueryInput): AuditSource {
  return input.category === 'security' ? 'security' : 'operational';
}

function requireAuditAccess(actor: Actor, source: AuditSource): void {
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, source === 'security' ? 'audit.security.read' : 'audit.read');
}

function projectActor(actorId: string | null, users: Map<string, { id: string; displayName: string; type: string }>, secret: string): { actorLabel: string; actorKey: string | null } {
  if (!actorId) return { actorLabel: 'Sistema', actorKey: null };
  const user = users.get(actorId);
  if (!user || user.type !== 'EMPLOYEE') return { actorLabel: 'Cuenta autenticada', actorKey: null };
  return { actorLabel: user.displayName, actorKey: opaqueAuditKey('actor', user.id, secret) };
}

function projectRow(row: AuditRow, users: Map<string, { id: string; displayName: string; type: string }>, secret: string): AuditEntry {
  if (row.source === 'operational') {
    const definition = classifyAuditAction(row.action);
    if (!definition) throw new AppError('INTERNAL_ERROR', 'No fue posible proyectar la auditoría.', 500);
    const actor = projectActor(row.actorUserId, users, secret);
    return {
      eventKey: opaqueAuditKey('event', row.id, secret),
      occurredAt: row.createdAt.toISOString(),
      category: definition.category,
      action: auditActionLabel(row.action),
      outcome: row.outcome,
      actorLabel: actor.actorLabel,
      actorKey: actor.actorKey,
      entityLabel: entityLabelForType(row.entityType),
      entityLink: auditEntryLink(row.entityType, row.entityId, row.metadata),
      details: projectAuditMetadata(row.action, row.metadata),
    };
  }

  const definition = classifyAuthEvent(row.eventType);
  if (!definition) throw new AppError('INTERNAL_ERROR', 'No fue posible proyectar la auditoría de seguridad.', 500);
  const actor = projectActor(row.userId, users, secret);
  return {
    eventKey: opaqueAuditKey('event', row.id, secret),
    occurredAt: row.createdAt.toISOString(),
    category: 'security',
    action: authEventActionLabel(row.eventType),
    outcome: row.outcome,
    actorLabel: actor.actorLabel,
    actorKey: actor.actorKey,
    entityLabel: entityLabelForType('auth_event'),
    entityLink: null,
    details: [],
  };
}

export async function getStaffAudit(actor: Actor, input: AuditQueryInput = {}, dependencies: AuditServiceDependencies = {}): Promise<AuditResponse> {
  const source = sourceForInput(input);
  requireAuditAccess(actor, source);

  const environment = readServerEnv();
  const prisma = dependencies.prisma ?? getPrisma();
  const now = dependencies.now ?? new Date();
  const cursorSecret = dependencies.cursorSecret ?? environment.AUDIT_CURSOR_SECRET;
  let query;
  try {
    query = normalizeAuditQuery(input, { now, timezone: dependencies.timezone ?? environment.APP_TIMEZONE, source, cursorSecret });
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', 'Los filtros de auditoría no son válidos.', 400, { cause: error });
  }

  const rateLimit = dependencies.rateLimit ?? ((rateLimitInput) => checkAuthRateLimit({
    scope: AUDIT_RATE_LIMIT_SCOPE,
    key: rateLimitInput.key,
    maxAttempts: environment.AUDIT_RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: environment.AUDIT_RATE_LIMIT_WINDOW_MINUTES,
    now: rateLimitInput.now,
  }));
  const rateLimitDecision = await rateLimit({ key: actor.userId, now });
  if (!rateLimitDecision.allowed) throw new AppError('RATE_LIMITED', 'Has alcanzado el límite temporal de consultas.', 429);

  const page = await readAuditPage(prisma, { ...query, source });
  const users = page.actorIds.length === 0
    ? []
    : await prisma.user.findMany({ where: { id: { in: page.actorIds } }, select: { id: true, displayName: true, type: true } });
  const userMap = new Map(users.map((user) => [user.id, user]));
  const items = page.rows.map((row) => projectRow(row, userMap, cursorSecret));
  const last = page.rows.at(-1);
  const nextCursor = page.hasMore && last
    ? encodeAuditCursor({
      version: 1,
      source,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      category: query.category,
      outcome: query.outcome,
      limit: query.limit,
      createdAt: last.createdAt.toISOString(),
      id: last.id,
    }, cursorSecret)
    : null;

  return {
    items,
    nextCursor,
    meta: {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      timezone: query.timezone,
      scope: source,
      freshness: 'fresh',
    },
  };
}
