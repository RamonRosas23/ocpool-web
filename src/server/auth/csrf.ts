import { AUTH_SESSION_COOKIE } from '@/server/auth/constants';
import { AppError } from '@/server/http/errors';

const OCPOOL_PUBLIC_HOSTS = new Set(['ocpool.com.mx', 'www.ocpool.com.mx']);

function acceptedOrigins(expectedAppUrl: string): Set<string> {
  const expected = new URL(expectedAppUrl);
  const origins = new Set([expected.origin]);

  if (OCPOOL_PUBLIC_HOSTS.has(expected.hostname)) {
    const alternateHostname = expected.hostname === 'www.ocpool.com.mx' ? 'ocpool.com.mx' : 'www.ocpool.com.mx';
    origins.add(new URL(`${expected.protocol}//${alternateHostname}${expected.port ? `:${expected.port}` : ''}`).origin);
  }

  return origins;
}

function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.split(';').some((item) => item.trim().startsWith(`${AUTH_SESSION_COOKIE}=`));
}

export function assertSameOrigin(request: Request, expectedAppUrl: string): void {
  const origin = request.headers.get('origin');

  if (!origin) {
    if (hasSessionCookie(request)) {
      throw new AppError('FORBIDDEN', 'Solicitud no permitida.', 403);
    }
    return;
  }

  try {
    const received = new URL(origin);
    if (!acceptedOrigins(expectedAppUrl).has(received.origin)) throw new Error('Foreign origin.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('FORBIDDEN', 'Solicitud no permitida.', 403);
  }
}
