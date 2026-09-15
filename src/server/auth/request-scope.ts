import type { Prisma } from '@/generated/prisma/client';
import { hasPermission } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import { AppError } from '@/server/http/errors';

export function canReadGlobalStaffRequests(actor: Actor): boolean {
  return actor.type === 'EMPLOYEE' && hasPermission(actor, 'requests.read.global');
}

export function isStaffRequestInReadScope(actor: Actor, currentAssigneeId: string | null): boolean {
  if (actor.type !== 'EMPLOYEE') return false;
  return canReadGlobalStaffRequests(actor) || currentAssigneeId === null || currentAssigneeId === actor.userId;
}

export function requireStaffRequestReadScope(actor: Actor, currentAssigneeId: string | null): void {
  if (isStaffRequestInReadScope(actor, currentAssigneeId)) return;
  throw new AppError('NOT_FOUND', 'La solicitud no existe.', 404);
}

export function staffRequestReadScopeWhere(actor: Actor): Prisma.QuoteRequestWhereInput {
  if (actor.type !== 'EMPLOYEE' || canReadGlobalStaffRequests(actor)) return {};
  return { OR: [{ currentAssigneeId: null }, { currentAssigneeId: actor.userId }] };
}

export function assertStaffAssigneeFilterScope(actor: Actor, assignedToId: string | null | undefined): void {
  if (assignedToId === undefined || assignedToId === null || canReadGlobalStaffRequests(actor) || assignedToId === actor.userId) return;
  throw new AppError('FORBIDDEN', 'No tienes permisos para consultar la carga de otro responsable.', 403);
}

export function assertStaffAssigneeTargetScope(actor: Actor, assignedToId: string): void {
  if (actor.type === 'EMPLOYEE' && (canReadGlobalStaffRequests(actor) || assignedToId === actor.userId)) return;
  throw new AppError('FORBIDDEN', 'No tienes permisos para asignar la solicitud a otro responsable.', 403);
}
