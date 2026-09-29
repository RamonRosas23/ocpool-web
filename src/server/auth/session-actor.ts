import type { NextRequest } from 'next/server';
import { sessionToken } from '@/server/auth/http';
import { getActorFromSession } from '@/server/auth/sessions';
import type { Actor } from '@/server/auth/types';
import { AppError } from '@/server/http/errors';

/** Cualquier sesión válida (equipo o cliente). Los permisos de cada operación los exige el servicio. */
export async function requireSessionActor(request: NextRequest): Promise<Actor> {
  const token = sessionToken(request);
  if (!token) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  const actor = await getActorFromSession(token);
  if (!actor) throw new AppError('UNAUTHORIZED', 'La sesión no está autenticada.', 401);
  return actor;
}
