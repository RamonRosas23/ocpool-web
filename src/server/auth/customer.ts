import type { NextRequest } from 'next/server';
import { sessionToken } from '@/server/auth/http';
import { getActorFromSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { requirePermission } from '@/server/auth/permissions';
import { AppError } from '@/server/http/errors';

export async function requireCustomerActor(request: NextRequest): Promise<Actor> {
  const token = sessionToken(request);
  if (!token) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  const actor = await getActorFromSession(token);
  if (!actor) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  if (actor.type !== 'CUSTOMER' || !actor.clientId) throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  requirePermission(actor, 'portal.self.read');
  return actor;
}
