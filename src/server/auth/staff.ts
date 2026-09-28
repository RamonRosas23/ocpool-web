import type { NextRequest } from 'next/server';
import { sessionToken } from '@/server/auth/http';
import { getActorFromSession, getSessionContext } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { AppError } from '@/server/http/errors';

export async function requireStaffActor(request: NextRequest): Promise<Actor> {
  const token = sessionToken(request);
  if (!token) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  const actor = await getActorFromSession(token);
  if (!actor) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  if (actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  return actor;
}

/** Igual que requireStaffActor, pero también devuelve la sesión actual (Mi cuenta la distingue de las demás). */
export async function requireStaffSession(request: NextRequest): Promise<{ actor: Actor; sessionId: string }> {
  const token = sessionToken(request);
  if (!token) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  const session = await getSessionContext(token);
  if (!session) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  if (session.actor.type !== 'EMPLOYEE') throw new AppError('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  return { actor: session.actor, sessionId: session.sessionId };
}
