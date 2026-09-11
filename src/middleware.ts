import { NextResponse, type NextRequest } from 'next/server';

const PRIVATE_ROUTE_PREFIXES = ['/auth', '/login', '/portal', '/staff'];

function isPrivateRoute(pathname: string): boolean {
  return PRIVATE_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-ocpool-private-locale', isPrivateRoute(request.nextUrl.pathname) ? 'es-MX' : 'es');

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
