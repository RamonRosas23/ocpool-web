import { AUTH_SESSION_COOKIE } from '@/server/auth/constants';
import { AppError } from '@/server/http/errors';

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
    const expected = new URL(expectedAppUrl);
    const received = new URL(origin);
    if (received.origin !== expected.origin) throw new Error('Foreign origin.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('FORBIDDEN', 'Solicitud no permitida.', 403);
  }
}
